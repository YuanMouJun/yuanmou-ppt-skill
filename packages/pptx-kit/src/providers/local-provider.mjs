// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { SlideSourceProvider, defaultCacheRoot, sha256File } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

const gunzipAsync = promisify(zlib.gunzip);
const DEFAULT_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours ephemeral preview TTL (prevents stale local bias)

async function pruneExpiredPreviews(dir, ttlMs) {
  if (!existsSync(dir)) return;
  try {
    const now = Date.now();
    const files = await fs.readdir(dir);
    await Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f);
        try {
          const st = await fs.stat(full);
          if (st.isFile() && now - st.mtimeMs > ttlMs) {
            await fs.unlink(full).catch(() => {});
          }
        } catch {
          // ignore race
        }
      })
    );
  } catch {
    // ignore
  }
}

export const DEFAULT_PUBLIC_TRIAL_BASE_URL = "https://ppt-trial.resourcehub.dpdns.org";
export const TRIAL_CLIENT_HEADER_NAME = "X-Yuanmou-Client";
export const TRIAL_CLIENT_HEADER_VALUE = "yuanmou-ppt-skill";

function buildTrialRateLimitError() {
  return new Error(
    "[RATE_LIMITED] 为防止公共免费体验图库滥用，当前已触发频率限制（30 次 / 10 秒）。\n" +
      "如需高频大方案批量选版或解锁 10W+ 持续日更高质量商业模板，欢迎加入「渊眸飞书云盘 VIP 版式库」" +
      "（运行 `node skills/yuanmou-ppt/scripts/provider_cli.mjs connect --provider feishu`），或稍等 10 秒后重试。"
  );
}

/**
 * Default Open-Source Provider (`provider: "local"`).
 *
 * Works with ZERO login and ZERO configuration:
 * 1) If `YUANMOU_LOCAL_DIR` is set and contains a local SQLite index (`ppt-index-dist.db` / `ppt-index-lite.db` / etc.),
 *    queries that local directory 100% offline.
 * 2) Otherwise (unless `YUANMOU_OFFLINE=1` or `enablePublicTrial: false`), seamlessly syncs the free public
 *    16,000+ slide commercial reference library (`ppt-index-trial.db.gz`) from Cloudflare R2 CDN
 *    into `~/.cache/yuanmou-ppt/trial/` and fetches lossless preview PNGs on demand into an ephemeral
 *    temp directory (`os.tmpdir()`, auto-pruned after 2 hours so Agents never lazily reuse old local images).
 */
export class LocalStandaloneProvider extends SlideSourceProvider {
  constructor(options = {}) {
    super("local", "Local & Zero-Login Public Trial Library (10,000+ Slides)", options);
    this.localLibraryDir = options.localLibraryDir || process.env.YUANMOU_LOCAL_DIR || "";
    this.trialBaseUrl = (
      options.trialBaseUrl ||
      process.env.YUANMOU_TRIAL_URL ||
      DEFAULT_PUBLIC_TRIAL_BASE_URL
    ).replace(/\/+$/, "");
    this.enablePublicTrial =
      options.enablePublicTrial !== undefined
        ? Boolean(options.enablePublicTrial)
        : process.env.YUANMOU_OFFLINE !== "1";

    const cacheBase = this.cache?.rootDir || defaultCacheRoot(options.cacheDir);
    this.trialCacheDir = path.join(cacheBase, "trial");
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
    this.trialPreviewsDir = options.cacheDir
      ? path.join(options.cacheDir, "tmp-trial-previews")
      : path.join(os.tmpdir(), "yuanmou-ppt-tmp-previews", "trial");
    this.trialIndexDbPath = path.join(this.trialCacheDir, "ppt-index-trial.db");

    this.capabilities = {
      slideIndex: Boolean(this.localLibraryDir || this.enablePublicTrial),
      pptxTemplates: Boolean(this.localLibraryDir),
      pdfReports: Boolean(this.localLibraryDir),
      pureImagePreviews: Boolean(this.localLibraryDir || this.enablePublicTrial),
      presignedDirectDownload: false,
    };
  }

  async checkAuth() {
    return {
      authenticated: true,
      tier: "free",
      identity: this.localLibraryDir ? "standalone-local-dir" : "zero-login-public-trial",
      localLibraryDir: this.localLibraryDir || null,
      trialBaseUrl: this.enablePublicTrial ? this.trialBaseUrl : null,
      trialIndexCached: existsSync(this.trialIndexDbPath),
    };
  }

  _findColocatedDb() {
    if (!this.localLibraryDir) return "";
    const candidates = [
      "ppt-index-dist.db",
      "ppt-index-trial.db",
      "ppt-index-lite.db",
      "ppt-index.db",
      "yuanmou-slide-index.db",
    ];
    for (const name of candidates) {
      const full = path.join(this.localLibraryDir, name);
      if (existsSync(full)) return full;
    }
    return "";
  }

  async syncSlideIndex(options = {}) {
    const colocatedDb = this._findColocatedDb();
    if (colocatedDb) {
      return {
        synced: true,
        cached: true,
        dbPath: colocatedDb,
        source: "local-colocated-db",
      };
    }

    if (!this.enablePublicTrial || !this.trialBaseUrl) {
      return {
        synced: true,
        dbPath: null,
        slideCount: 0,
        source: "local-no-index",
      };
    }

    const force = Boolean(options.force);
    if (!force && existsSync(this.trialIndexDbPath)) {
      const st = await fs.stat(this.trialIndexDbPath);
      return {
        synced: true,
        cached: true,
        dbPath: this.trialIndexDbPath,
        bytes: st.size,
        source: "public-trial-cache",
      };
    }

    const indexUrl = force
      ? `${this.trialBaseUrl}/ppt-index-trial.db.gz?t=${Date.now()}`
      : `${this.trialBaseUrl}/ppt-index-trial.db.gz`;
    const res = await fetch(indexUrl, {
      headers: {
        [TRIAL_CLIENT_HEADER_NAME]: TRIAL_CLIENT_HEADER_VALUE,
        ...(force ? { "Cache-Control": "no-cache" } : {}),
      },
    });
    if (res.status === 429) {
      throw buildTrialRateLimitError();
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch public trial index (${res.status}) from ${indexUrl}`);
    }
    const rawBuf = Buffer.from(await res.arrayBuffer());
    const isGzip = rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b;
    const dbBuf = isGzip ? await gunzipAsync(rawBuf) : rawBuf;

    await fs.mkdir(this.trialCacheDir, { recursive: true });
    const tmpPath = `${this.trialIndexDbPath}.tmp`;
    await fs.writeFile(tmpPath, dbBuf);
    await fs.rename(tmpPath, this.trialIndexDbPath);

    return {
      synced: true,
      cached: false,
      dbPath: this.trialIndexDbPath,
      bytes: dbBuf.length,
      sha256: await sha256File(this.trialIndexDbPath),
      source: "public-trial-r2",
    };
  }

  async searchSlides(filter = {}) {
    const colocatedDb = this._findColocatedDb();
    if (colocatedDb) {
      return querySlideIndexDb(colocatedDb, filter, "local");
    }
    if (!this.enablePublicTrial) {
      return [];
    }
    if (!existsSync(this.trialIndexDbPath)) {
      try {
        await this.syncSlideIndex();
      } catch {
        return [];
      }
    }
    return querySlideIndexDb(this.trialIndexDbPath, filter, "local");
  }

  async searchReports(query = {}) {
    if (!this.localLibraryDir || !existsSync(this.localLibraryDir)) return [];
    const entries = await fs.readdir(this.localLibraryDir);
    const kw = String(query.keyword || "").toLowerCase();
    return entries
      .filter((f) => f.toLowerCase().endsWith(".pdf") && (!kw || f.toLowerCase().includes(kw)))
      .slice(0, query.limit || 10)
      .map((f) => ({
        provider: "local",
        sku: f.match(/【?(\d{4})】?/)?.[1] || "LOCAL",
        title: path.basename(f, ".pdf"),
        localPath: path.join(this.localLibraryDir, f),
      }));
  }

  async fetchAsset(request = {}) {
    let resolvedPath = request.localPath;
    if (!resolvedPath && this.localLibraryDir && existsSync(this.localLibraryDir)) {
      if (request.kind === "preview" || request.previewFile || request.contentPageId) {
        const fname = path.basename(request.previewFile || `${request.contentPageId}.png`);
        const p1 = path.join(this.localLibraryDir, "previews", fname);
        const p2 = path.join(this.localLibraryDir, fname);
        if (existsSync(p1)) resolvedPath = p1;
        else if (existsSync(p2)) resolvedPath = p2;
      } else if (request.sku) {
        const ext = request.kind === "pdf" ? ".pdf" : ".pptx";
        const files = await fs.readdir(this.localLibraryDir);
        const hit = files.find(
          (f) => f.toLowerCase().endsWith(ext) && f.includes(String(request.sku))
        );
        if (hit) resolvedPath = path.join(this.localLibraryDir, hit);
      }
    }
    if (resolvedPath && existsSync(resolvedPath)) {
      const st = await fs.stat(resolvedPath);
      return {
        localPath: path.resolve(resolvedPath),
        cached: true,
        bytes: st.size,
        sha256: await sha256File(resolvedPath),
        sourceProvider: "local",
      };
    }

    // Seamless zero-login preview PNG fetch into ephemeral temp dir (2h auto-prune, no persistent local bias)
    if (
      this.enablePublicTrial &&
      this.trialBaseUrl &&
      (request.kind === "preview" || request.previewFile || request.contentPageId)
    ) {
      await pruneExpiredPreviews(this.trialPreviewsDir, this.previewTtlMs);
      const fname = path.basename(request.previewFile || `${request.contentPageId}.png`);
      const cachedPath = path.join(this.trialPreviewsDir, fname);
      if (existsSync(cachedPath)) {
        const st = await fs.stat(cachedPath);
        if (Date.now() - st.mtimeMs <= this.previewTtlMs) {
          return {
            localPath: cachedPath,
            cached: true,
            bytes: st.size,
            sha256: await sha256File(cachedPath),
            sourceProvider: "local-public-trial-tmp",
          };
        }
      }
      const imgUrl = `${this.trialBaseUrl}/previews/${encodeURIComponent(fname)}`;
      const res = await fetch(imgUrl, {
        headers: { [TRIAL_CLIENT_HEADER_NAME]: TRIAL_CLIENT_HEADER_VALUE },
      });
      if (res.status === 429) {
        throw buildTrialRateLimitError();
      }
      if (!res.ok) {
        throw new Error(`Public trial preview download failed (${res.status}) for ${imgUrl}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(this.trialPreviewsDir, { recursive: true });
      const tmpPath = `${cachedPath}.tmp`;
      await fs.writeFile(tmpPath, buf);
      await fs.rename(tmpPath, cachedPath);
      return {
        localPath: cachedPath,
        cached: false,
        bytes: buf.length,
        sha256: await sha256File(cachedPath),
        sourceProvider: "local-public-trial-r2",
      };
    }

    throw new Error(
      `LocalStandaloneProvider cannot fetch remote asset "${request.sku || request.contentPageId || ""}".`
    );
  }
}
