// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readZipBuffer } from "../xml.mjs";

export function unwrapSlideIndexDbBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // Transparently unpack PKZIP (`yuanmou-slide-index.zip` on Knowledge Planet / CDN) -> `.db` buffer!
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const entries = readZipBuffer(b);
    for (const [name, data] of entries.entries()) {
      if (name.endsWith(".db") || name.endsWith(".sqlite")) return data;
    }
  }
  return b;
}

export function defaultCacheRoot(customDir) {
  return path.resolve(
    customDir || process.env.YUANMOU_CACHE_DIR || path.join(os.homedir(), ".cache", "yuanmou-ppt")
  );
}

export async function atomicReplaceFile(tmpPath, targetPath) {
  try {
    await fs.rename(tmpPath, targetPath);
  } catch {
    try {
      await fs.rm(targetPath, { force: true });
      await fs.rename(tmpPath, targetPath);
    } catch {
      await fs.copyFile(tmpPath, targetPath);
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  }
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function sha256File(filePath) {
  const buf = await fs.readFile(filePath);
  return sha256Buffer(buf);
}

/**
 * Shared local cache (`~/.cache/yuanmou-ppt/`) reused across V1 `zsxq` and V2 `yuanmou-cloud` (API + R2).
 */
export class SlideCacheStore {
  constructor(cacheRoot) {
    this.rootDir = defaultCacheRoot(cacheRoot);
    this.templatesDir = path.join(this.rootDir, "templates");
    this.reportsDir = path.join(this.rootDir, "reports");
    this.previewsDir = path.join(this.rootDir, "previews");
    // Co-locate `yuanmou-slide-index.db` directly alongside `.pptx` templates in the same folder!
    this.indexDbPath = path.join(this.templatesDir, "yuanmou-slide-index.db");
    this.manifestPath = path.join(this.rootDir, "cache-manifest.json");
  }

  async ensureDirs() {
    await Promise.all([
      fs.mkdir(this.templatesDir, { recursive: true }),
      fs.mkdir(this.reportsDir, { recursive: true }),
      fs.mkdir(this.previewsDir, { recursive: true }),
    ]);
  }

  async readManifest() {
    try {
      const raw = await fs.readFile(this.manifestPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return { index: null, assets: {} };
    }
  }

  async writeManifest(manifest) {
    await this.ensureDirs();
    const tmp = `${this.manifestPath}.${randomUUID().slice(0, 6)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    await atomicReplaceFile(tmp, this.manifestPath);
  }

  resolveAssetTargetPath({ kind = "pptx", sku = "", filename = "" }) {
    const safeSku = String(sku || "asset").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeName = filename
      ? path.basename(filename)
      : `${safeSku}.${kind === "pdf" ? "pdf" : kind === "preview" ? "png" : "pptx"}`;
    const subDir =
      kind === "pdf"
        ? this.reportsDir
        : kind === "preview"
          ? this.previewsDir
          : this.templatesDir;
    return path.join(subDir, safeName);
  }

  async getCachedAsset(cacheKey, expectedSha256) {
    const manifest = await this.readManifest();
    const entry = manifest.assets?.[cacheKey];
    if (!entry?.localPath || !existsSync(entry.localPath)) return null;
    if (expectedSha256) {
      const actual = await sha256File(entry.localPath).catch(() => "");
      if (actual.toLowerCase() !== expectedSha256.toLowerCase()) return null;
    }
    return entry;
  }

  async saveAssetBuffer({ cacheKey, targetPath, buffer, providerId, expectedSha256, meta = {} }) {
    await this.ensureDirs();
    const actualSha = sha256Buffer(buffer);
    if (expectedSha256 && actualSha.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch when caching ${path.basename(targetPath)}: expected ${expectedSha256}, got ${actualSha}`
      );
    }

    const tmpPath = `${targetPath}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(tmpPath, buffer);
    await atomicReplaceFile(tmpPath, targetPath);

    const manifest = await this.readManifest();
    const record = {
      localPath: targetPath,
      bytes: buffer.length,
      sha256: actualSha,
      sourceProvider: providerId,
      updatedAt: new Date().toISOString(),
      ...meta,
    };
    manifest.assets = manifest.assets || {};
    manifest.assets[cacheKey] = record;
    await this.writeManifest(manifest);
    return { ...record, cached: false };
  }
}

export async function downloadUrlToBuffer(url, { headers = {}, timeoutMs = 60_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching ${new URL(url).origin}`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pluggable Data Source Provider SPI (`SlideSourceProvider`).
 * V1: `ZsxqPlanetProvider` (`zsxq-cli`)
 * V2 (Reserved): `YuanmouCloudR2Provider` (Self-hosted Cloud API + Cloudflare R2)
 * Fallback: `LocalStandaloneProvider` (Open-source standalone mode)
 */
export class SlideSourceProvider {
  constructor(id, displayName, options = {}) {
    this.id = id;
    this.displayName = displayName;
    this.cache = options.cache instanceof SlideCacheStore ? options.cache : new SlideCacheStore(options.cacheDir);
    this.capabilities = {
      slideIndex: false,
      pptxTemplates: false,
      pdfReports: false,
      presignedDirectDownload: false,
    };
  }

  async checkAuth() {
    return { authenticated: false, tier: "free", reason: "Not implemented" };
  }

  async syncSlideIndex(_options = {}) {
    return { synced: false, dbPath: null, source: this.id };
  }

  async searchSlides(_filter = {}) {
    return [];
  }

  async searchDecks(_filter = {}) {
    return { supported: false, reason: `Provider "${this.id}" does not support deck-level filename search`, count: 0, decks: [] };
  }

  async getDeckOutline(_filter = {}) {
    return { supported: false, reason: `Provider "${this.id}" does not support deck outline inspection`, deck: null, pages: [] };
  }

  async searchReports(_query = {}) {
    return [];
  }

  async fetchAsset(_request = {}) {
    throw new Error(`Provider "${this.id}" does not support remote asset fetching`);
  }
}
