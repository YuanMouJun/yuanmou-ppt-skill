// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SlideSourceProvider, downloadUrlToBuffer, sha256File, unwrapSlideIndexDbBuffer } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

export const DEFAULT_YUANMOU_API_BASE_URL = "https://api.yuanmou.cc/v1";

function loadSavedCloudCredentials() {
  const credPath =
    process.env.YUANMOU_CREDENTIALS_FILE ||
    path.join(os.homedir(), ".config", "yuanmou-ppt", "credentials.json");
  if (!existsSync(credPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * V2 Reserved VIP / Enterprise Provider (`provider: "yuanmou-cloud"`).
 * Architecture: Self-Hosted Cloud API Gateway + Cloudflare R2 Presigned Object Storage.
 *
 * REST + R2 Contract:
 *   - `GET  /auth/whoami`     -> `{ authenticated, tier, identity, expiresAt }`
 *   - `GET  /index/latest`    -> `{ version, sha256, slideCount, r2PresignedUrl }`
 *   - `POST /slides/search`   -> `{ items: SlideCandidate[] }` (optional remote hybrid search)
 *   - `POST /reports/search`  -> `{ items: ReportCandidate[] }`
 *   - `POST /assets/presign`  -> `{ r2PresignedUrl, sha256, filename, bytes, expiresAt }`
 *
 * Shares the exact same `~/.cache/yuanmou-ppt/` cache & `yuanmou-slide-index.db` SQLite schema
 * as V1 `ZsxqPlanetProvider`, enabling zero-code-change migration from Knowledge Planet to Cloud API + R2.
 */
export class YuanmouCloudR2Provider extends SlideSourceProvider {
  constructor(options = {}) {
    super("yuanmou-cloud", "Yuanmou Cloud API + Cloudflare R2 (V2)", options);
    const saved = loadSavedCloudCredentials();

    this.apiBaseUrl = String(
      options.apiBaseUrl || process.env.YUANMOU_API_BASE_URL || saved.apiBaseUrl || DEFAULT_YUANMOU_API_BASE_URL
    ).replace(/\/+$/, "");
    this.apiKey = String(options.apiKey || process.env.YUANMOU_API_KEY || saved.apiKey || "");
    this.r2PublicCdnUrl = String(
      options.r2PublicCdnUrl || process.env.YUANMOU_R2_CDN_URL || saved.r2PublicCdnUrl || ""
    ).replace(/\/+$/, "");
    this.preferRemoteSearch = Boolean(options.preferRemoteSearch);
    this.timeoutMs = options.timeoutMs ?? 30_000;

    this.capabilities = {
      slideIndex: true,
      pptxTemplates: true,
      pdfReports: true,
      presignedDirectDownload: true,
    };
  }

  hasCredentials() {
    return Boolean(this.apiKey);
  }

  async _apiJson(method, route, { body, headers = {} } = {}) {
    if (!this.apiKey) {
      throw new Error("YuanmouCloudR2Provider requires YUANMOU_API_KEY or ~/.config/yuanmou-ppt/credentials.json");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(`${this.apiBaseUrl}${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (resp.status === 304) {
        return { notModified: true };
      }
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`Yuanmou Cloud API ${method} ${route} -> HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async checkAuth() {
    if (!this.apiKey) {
      return { authenticated: false, tier: "free", reason: "No YUANMOU_API_KEY configured" };
    }
    try {
      const data = await this._apiJson("GET", "/auth/whoami");
      return {
        authenticated: Boolean(data.authenticated ?? true),
        tier: data.tier || "vip",
        identity: data.identity || data.userId,
        expiresAt: data.expiresAt,
      };
    } catch (err) {
      return { authenticated: false, tier: "free", reason: err.message };
    }
  }

  async syncSlideIndex(options = {}) {
    await this.cache.ensureDirs();
    const localExists = existsSync(this.cache.indexDbPath);
    const currentSha = localExists ? await sha256File(this.cache.indexDbPath).catch(() => "") : "";

    const meta = await this._apiJson("GET", "/index/latest", {
      headers: !options.force && currentSha ? { "If-None-Match": `"${currentSha}"` } : {},
    });

    if (meta.notModified || (!options.force && currentSha && meta.sha256 === currentSha)) {
      return {
        synced: true,
        cached: true,
        dbPath: this.cache.indexDbPath,
        sha256: currentSha,
        version: meta.version,
        source: "yuanmou-cloud-r2",
      };
    }

    if (!meta.r2PresignedUrl) {
      throw new Error("Yuanmou Cloud API /index/latest response missing r2PresignedUrl");
    }

    // Stream directly from Cloudflare R2 presigned object URL (supports raw .db or .zip!)
    const rawBuf = await downloadUrlToBuffer(meta.r2PresignedUrl, { timeoutMs: 60_000 });
    const buf = unwrapSlideIndexDbBuffer(rawBuf);
    const saved = await this.cache.saveAssetBuffer({
      cacheKey: "index:yuanmou-cloud:latest",
      targetPath: this.cache.indexDbPath,
      buffer: buf,
      providerId: "yuanmou-cloud",
      expectedSha256: meta.sha256,
      meta: { version: meta.version, slideCount: meta.slideCount },
    });

    return {
      synced: true,
      cached: false,
      dbPath: saved.localPath,
      sha256: saved.sha256,
      slideCount: meta.slideCount,
      version: meta.version,
      source: "yuanmou-cloud-r2",
    };
  }

  async searchSlides(filter = {}) {
    // Fast offline-capable local SQLite slot-fingerprint query over R2-synced `yuanmou-slide-index.db`
    if (!this.preferRemoteSearch && existsSync(this.cache.indexDbPath)) {
      const rows = await querySlideIndexDb(this.cache.indexDbPath, filter, "yuanmou-cloud");
      return rows.map((r) => ({
        ...r,
        previewUrl:
          r.previewKey && this.r2PublicCdnUrl ? `${this.r2PublicCdnUrl}/${r.previewKey}` : undefined,
      }));
    }

    const data = await this._apiJson("POST", "/slides/search", { body: filter });
    return (data.items || []).map((item) => ({ ...item, provider: "yuanmou-cloud" }));
  }

  async searchReports(query = {}) {
    const data = await this._apiJson("POST", "/reports/search", { body: query });
    return (data.items || []).map((item) => ({ ...item, provider: "yuanmou-cloud" }));
  }

  async fetchAsset(request = {}) {
    const { kind = "pptx", sku = "", fileId, r2ObjectKey, sha256 } = request;
    const keyToken = r2ObjectKey || fileId || sku;
    if (!keyToken) {
      throw new Error("YuanmouCloudR2Provider.fetchAsset requires sku, fileId, or r2ObjectKey");
    }

    const cacheKey = `yuanmou-cloud:${kind}:${keyToken}`;
    const hit = await this.cache.getCachedAsset(cacheKey, sha256);
    if (hit) {
      return { ...hit, cached: true };
    }

    // Request short-lived Cloudflare R2 presigned GET URL from Cloud API
    const presigned = await this._apiJson("POST", "/assets/presign", {
      body: { kind, sku, fileId, r2ObjectKey },
    });
    if (!presigned.r2PresignedUrl) {
      throw new Error(`Yuanmou Cloud API /assets/presign did not return r2PresignedUrl for ${keyToken}`);
    }

    const buf = await downloadUrlToBuffer(presigned.r2PresignedUrl, { timeoutMs: 90_000 });
    const targetPath = this.cache.resolveAssetTargetPath({
      kind,
      sku: sku || keyToken,
      filename: presigned.filename,
    });

    return this.cache.saveAssetBuffer({
      cacheKey,
      targetPath,
      buffer: buf,
      providerId: "yuanmou-cloud",
      expectedSha256: presigned.sha256 || sha256,
      meta: { sku, fileId, r2ObjectKey },
    });
  }
}
