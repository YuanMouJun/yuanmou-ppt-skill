// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { SlideSourceProvider, atomicReplaceFile, defaultCacheRoot, sha256File } from "./base-provider.mjs";
import { querySlideIndexDb, queryDecksByFilename, queryDeckOutline } from "./sqlite-index.mjs";

const gunzipAsync = promisify(zlib.gunzip);
const DEFAULT_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours ephemeral preview TTL (prevents stale local bias)
const DEFAULT_INDEX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours lazy index revalidation TTL (0ms within window)
const DEFAULT_INDEX_CHECK_TIMEOUT_MS = 2500; // Fast HEAD ETag probe timeout; falls back to local cache if offline
const DEFAULT_OFFLINE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after an offline/failed HEAD probe

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
      "（运行 `node <SKILL_DIR>/scripts/provider_cli.mjs connect --provider feishu`），或稍等 10 秒后重试。"
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
    super("local", "Local & Zero-Login Public Trial Library (16,000+ Slides)", options);
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
    this.indexTtlMs = options.indexTtlMs ?? DEFAULT_INDEX_TTL_MS;
    this.indexCheckTimeoutMs = options.indexCheckTimeoutMs ?? DEFAULT_INDEX_CHECK_TIMEOUT_MS;
    this.offlineCooldownMs = options.offlineCooldownMs ?? DEFAULT_OFFLINE_COOLDOWN_MS;
    this._lastHeadFailAt = 0;
    this._refreshedOn404 = false;
    this.trialPreviewsDir = options.cacheDir
      ? path.join(options.cacheDir, "tmp-trial-previews")
      : path.join(os.tmpdir(), "yuanmou-ppt-tmp-previews", "trial");
    this.trialIndexDbPath = path.join(this.trialCacheDir, "ppt-index-trial.db");
    this.trialIndexMetaPath = path.join(this.trialCacheDir, "ppt-index-trial.meta.json");

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

  async _readTrialIndexMeta() {
    if (!existsSync(this.trialIndexMetaPath)) return null;
    try {
      return JSON.parse(await fs.readFile(this.trialIndexMetaPath, "utf8"));
    } catch {
      return null;
    }
  }

  async _writeTrialIndexMeta(meta) {
    try {
      await fs.mkdir(this.trialCacheDir, { recursive: true });
      const tmp = `${this.trialIndexMetaPath}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
      await atomicReplaceFile(tmp, this.trialIndexMetaPath);
    } catch {
      // non-fatal sidecar metadata error
    }
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
    const hasLocalCache = existsSync(this.trialIndexDbPath);
    const baseIndexUrl = `${this.trialBaseUrl}/ppt-index-trial.db.gz`;

    if (!force && hasLocalCache) {
      const st = await fs.stat(this.trialIndexDbPath);
      const meta = await this._readTrialIndexMeta();
      const now = Date.now();
      const lastCheckedAt = Number(meta?.lastCheckedAt || st.mtimeMs || 0);
      const withinTtl = this.indexTtlMs > 0 && now - lastCheckedAt < this.indexTtlMs;
      const inOfflineCooldown =
        this._lastHeadFailAt > 0 && now - this._lastHeadFailAt < this.offlineCooldownMs;

      if (withinTtl || inOfflineCooldown) {
        return {
          synced: true,
          cached: true,
          dbPath: this.trialIndexDbPath,
          bytes: st.size,
          etag: meta?.etag || null,
          source: inOfflineCooldown ? "public-trial-cache-offline-fallback" : "public-trial-cache",
        };
      }

      // Lazy ETag probe after TTL expiry: fast timeout + graceful offline fallback
      try {
        const headRes = await fetch(baseIndexUrl, {
          method: "HEAD",
          headers: { [TRIAL_CLIENT_HEADER_NAME]: TRIAL_CLIENT_HEADER_VALUE },
          signal: AbortSignal.timeout(this.indexCheckTimeoutMs),
        });
        if (headRes.ok) {
          this._lastHeadFailAt = 0;
          const remoteEtag = headRes.headers.get("etag") || null;
          if (remoteEtag && meta?.etag && remoteEtag === meta.etag) {
            await this._writeTrialIndexMeta({
              ...meta,
              etag: remoteEtag,
              lastCheckedAt: now,
            });
            return {
              synced: true,
              cached: true,
              revalidated: true,
              dbPath: this.trialIndexDbPath,
              bytes: st.size,
              etag: remoteEtag,
              source: "public-trial-cache-etag",
            };
          }
          // ETag changed (or legacy cache lacked ETag) -> proceed to fresh download below
        } else {
          this._lastHeadFailAt = now;
          return {
            synced: true,
            cached: true,
            dbPath: this.trialIndexDbPath,
            bytes: st.size,
            etag: meta?.etag || null,
            source: "public-trial-cache-offline-fallback",
          };
        }
      } catch {
        this._lastHeadFailAt = now;
        return {
          synced: true,
          cached: true,
          dbPath: this.trialIndexDbPath,
          bytes: st.size,
          etag: meta?.etag || null,
          source: "public-trial-cache-offline-fallback",
        };
      }
    }

    const indexUrl = force ? `${baseIndexUrl}?t=${Date.now()}` : baseIndexUrl;
    let res;
    try {
      res = await fetch(indexUrl, {
        headers: {
          [TRIAL_CLIENT_HEADER_NAME]: TRIAL_CLIENT_HEADER_VALUE,
          ...(force ? { "Cache-Control": "no-cache" } : {}),
        },
      });
    } catch (err) {
      if (!force && hasLocalCache) {
        this._lastHeadFailAt = Date.now();
        const st = await fs.stat(this.trialIndexDbPath);
        return {
          synced: true,
          cached: true,
          dbPath: this.trialIndexDbPath,
          bytes: st.size,
          source: "public-trial-cache-offline-fallback",
        };
      }
      throw err;
    }

    if (res.status === 429) {
      if (!force && hasLocalCache) {
        const st = await fs.stat(this.trialIndexDbPath);
        return {
          synced: true,
          cached: true,
          dbPath: this.trialIndexDbPath,
          bytes: st.size,
          source: "public-trial-cache-offline-fallback",
        };
      }
      throw buildTrialRateLimitError();
    }
    if (!res.ok) {
      if (!force && hasLocalCache) {
        this._lastHeadFailAt = Date.now();
        const st = await fs.stat(this.trialIndexDbPath);
        return {
          synced: true,
          cached: true,
          dbPath: this.trialIndexDbPath,
          bytes: st.size,
          source: "public-trial-cache-offline-fallback",
        };
      }
      throw new Error(`Failed to fetch public trial index (${res.status}) from ${indexUrl}`);
    }

    const etag = res.headers.get("etag") || null;
    const rawBuf = Buffer.from(await res.arrayBuffer());
    const isGzip = rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b;
    const dbBuf = isGzip ? await gunzipAsync(rawBuf) : rawBuf;

    await fs.mkdir(this.trialCacheDir, { recursive: true });
    const tmpPath = `${this.trialIndexDbPath}.tmp`;
    await fs.writeFile(tmpPath, dbBuf);
    await atomicReplaceFile(tmpPath, this.trialIndexDbPath);

    const sha256 = await sha256File(this.trialIndexDbPath);
    const now = Date.now();
    this._lastHeadFailAt = 0;
    await this._writeTrialIndexMeta({
      etag,
      lastCheckedAt: now,
      lastSyncedAt: now,
      bytes: dbBuf.length,
      sha256,
    });

    return {
      synced: true,
      cached: false,
      dbPath: this.trialIndexDbPath,
      bytes: dbBuf.length,
      etag,
      sha256,
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
    try {
      await this.syncSlideIndex();
    } catch {
      if (!existsSync(this.trialIndexDbPath)) return [];
    }
    if (!existsSync(this.trialIndexDbPath)) return [];
    return querySlideIndexDb(this.trialIndexDbPath, filter, "local");
  }

  async _resolveActiveDbPath() {
    const colocatedDb = this._findColocatedDb();
    if (colocatedDb) return colocatedDb;
    if (!this.enablePublicTrial) return "";
    try {
      await this.syncSlideIndex();
    } catch {
      // fall through to check existing local cache
    }
    return existsSync(this.trialIndexDbPath) ? this.trialIndexDbPath : "";
  }

  async searchDecks(filter = {}) {
    const dbPath = await this._resolveActiveDbPath();
    if (!dbPath) return { supported: false, reason: "No local index DB configured", count: 0, decks: [] };
    return queryDecksByFilename(dbPath, filter, "local");
  }

  async getDeckOutline(filter = {}) {
    const dbPath = await this._resolveActiveDbPath();
    if (!dbPath) return { supported: false, reason: "No local index DB configured", deck: null, pages: [] };
    return queryDeckOutline(dbPath, filter, "local");
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
      if (res.status === 404) {
        // Stale index may reference a pruned/retired preview -> invalidate & refresh once automatically
        await fs.unlink(this.trialIndexMetaPath).catch(() => {});
        let refreshed = false;
        if (!this._refreshedOn404) {
          this._refreshedOn404 = true;
          try {
            await this.syncSlideIndex({ force: true });
            refreshed = true;
          } catch {
            // keep original 404 context
          }
        }
        const err = new Error(
          `Public trial preview not found (404) for ${imgUrl}` +
            (refreshed ? " — local trial index has been auto-refreshed; re-run search-slides to pick from current curated slides." : "")
        );
        err.code = "PREVIEW_NOT_FOUND";
        err.indexRefreshed = refreshed;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`Public trial preview download failed (${res.status}) for ${imgUrl}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(this.trialPreviewsDir, { recursive: true });
      const tmpPath = `${cachedPath}.tmp`;
      await fs.writeFile(tmpPath, buf);
      await atomicReplaceFile(tmpPath, cachedPath);
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
