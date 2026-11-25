// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { SlideSourceProvider, defaultCacheRoot, sha256File } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

const gunzipAsync = promisify(zlib.gunzip);
const DEFAULT_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;

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
          // ignore
        }
      })
    );
  } catch {
    // ignore
  }
}

export const DEFAULT_FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
export const DEFAULT_FEISHU_CALLBACK_PORT = 38421;

function openBrowserUrl(url) {
  const plat = process.platform;
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open";
  const args = plat === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Fallback: user can open the printed URL manually
  }
}

/**
 * Feishu Drive Provider (`provider: "feishu"`).
 *
 * Design:
 * - Zero third-party dependencies (native `fetch` + `node:zlib` + `node:http`).
 * - Uses OAuth `user_access_token` (with silent 30-day `refresh_token` renewal), so permissions
 *   mirror your Feishu Drive folder sharing 1:1: granting/revoking access in Feishu takes effect immediately.
 * - Index (`ppt-index-dist.db.gz`) is synced once to `~/.cache/yuanmou-ppt/feishu/` and queried locally (0 API calls).
 * - Original lossless preview PNGs (`CP_*.png`) are fetched on-demand by `feishu_file_token` and cached locally forever.
 */
export class FeishuDriveProvider extends SlideSourceProvider {
  constructor(options = {}) {
    super("feishu", "Feishu Drive (Trial & VIP Pure-Image Library)", options);
    this.apiBaseUrl = (options.apiBaseUrl || process.env.FEISHU_API_BASE || DEFAULT_FEISHU_API_BASE).replace(/\/+$/, "");
    this.appId = options.appId || process.env.FEISHU_APP_ID || "";
    this.appSecret = options.appSecret || process.env.FEISHU_APP_SECRET || "";
    this.indexFileToken = options.indexFileToken || process.env.FEISHU_INDEX_FILE_TOKEN || "";
    this.folderToken = options.folderToken || process.env.FEISHU_FOLDER_TOKEN || "";
    this.staticUserToken = options.userAccessToken || process.env.FEISHU_USER_ACCESS_TOKEN || "";
    const cacheBase = this.cache?.rootDir || defaultCacheRoot(options.cacheDir);
    this.authFilePath = path.join(cacheBase, "feishu-auth.json");
    this.feishuCacheDir = path.join(cacheBase, "feishu");
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
    this.previewsCacheDir = options.cacheDir
      ? path.join(options.cacheDir, "tmp-feishu-previews")
      : path.join(os.tmpdir(), "yuanmou-ppt-tmp-previews", "feishu");
    this.indexDbPath = path.join(this.feishuCacheDir, "ppt-index-dist.db");

    this.capabilities = {
      slideIndex: true,
      pptxTemplates: false,
      pdfReports: false,
      pureImagePreviews: true,
      presignedDirectDownload: true,
    };
  }

  async _readSavedAuth() {
    if (!existsSync(this.authFilePath)) return null;
    try {
      return JSON.parse(await fs.readFile(this.authFilePath, "utf8"));
    } catch {
      return null;
    }
  }

  async _writeSavedAuth(data) {
    await fs.mkdir(path.dirname(this.authFilePath), { recursive: true });
    await fs.writeFile(this.authFilePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  hasCredentials() {
    return Boolean(this.staticUserToken || existsSync(this.authFilePath));
  }

  async _getAppAccessToken() {
    if (!this.appId || !this.appSecret) {
      throw new Error("Missing FEISHU_APP_ID / FEISHU_APP_SECRET for Feishu OAuth token exchange.");
    }
    const res = await fetch(`${this.apiBaseUrl}/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0 || !json.app_access_token) {
      throw new Error(`Feishu app_access_token failed: ${json.msg || res.statusText}`);
    }
    return json.app_access_token;
  }

  async _refreshUserToken(saved) {
    if (!saved?.refresh_token || !this.appId || !this.appSecret) return null;
    const appToken = await this._getAppAccessToken();
    const res = await fetch(`${this.apiBaseUrl}/authen/v1/oidc/refresh_access_token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: saved.refresh_token,
      }),
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0 || !json.data?.access_token) {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const updated = {
      ...saved,
      access_token: json.data.access_token,
      refresh_token: json.data.refresh_token || saved.refresh_token,
      expires_at: nowSec + Number(json.data.expires_in || 7200) - 120,
      refresh_expires_at: nowSec + Number(json.data.refresh_expires_in || 2592000),
      updated_at: new Date().toISOString(),
    };
    await this._writeSavedAuth(updated);
    return updated.access_token;
  }

  async _getValidUserToken() {
    if (this.staticUserToken) return this.staticUserToken;
    const saved = await this._readSavedAuth();
    if (!saved?.access_token) {
      throw new Error(
        "Feishu Drive not connected. Run `node skills/yuanmou-ppt/scripts/provider_cli.mjs connect --provider feishu` to sign in via QR code."
      );
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (saved.expires_at && nowSec >= saved.expires_at) {
      const refreshed = await this._refreshUserToken(saved);
      if (refreshed) return refreshed;
      throw new Error("Feishu user_access_token expired and refresh failed. Please re-run `connect --provider feishu`.");
    }
    return saved.access_token;
  }

  /**
   * Interactive 1-click OAuth QR login (opens browser, captures callback on 127.0.0.1).
   */
  async connect({ port = DEFAULT_FEISHU_CALLBACK_PORT, timeoutMs = 180000 } = {}) {
    if (!this.appId || !this.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET must be configured before running Feishu OAuth login.");
    }
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl =
      `${this.apiBaseUrl}/authen/v1/authorize` +
      `?app_id=${encodeURIComponent(this.appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent("drive:drive:readonly")}`;

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Feishu OAuth login timed out. Please retry."));
      }, timeoutMs);

      const server = http.createServer((req, res) => {
        const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const authCode = u.searchParams.get("code");
        clearTimeout(timer);
        if (!authCode) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h3>授权失败：未收到 code 参数，请关闭窗口重试。</h3>");
          server.close();
          reject(new Error("Feishu OAuth callback missing code"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>✅ 飞书云盘授权成功！可以关闭本窗口返回终端。</h2>");
        server.close();
        resolve(authCode);
      });

      server.listen(port, "127.0.0.1", () => {
        console.log(`\n正在拉起飞书扫码授权页面（若浏览器未自动打开，请手动复制访问）：\n${authUrl}\n`);
        openBrowserUrl(authUrl);
      });
    });

    const appToken = await this._getAppAccessToken();
    const res = await fetch(`${this.apiBaseUrl}/authen/v1/oidc/access_token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const json = await res.json();
    if (!res.ok || json.code !== 0 || !json.data?.access_token) {
      throw new Error(`Feishu code exchange failed: ${json.msg || res.statusText}`);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const saved = {
      access_token: json.data.access_token,
      refresh_token: json.data.refresh_token || "",
      expires_at: nowSec + Number(json.data.expires_in || 7200) - 120,
      refresh_expires_at: nowSec + Number(json.data.refresh_expires_in || 2592000),
      updated_at: new Date().toISOString(),
    };
    await this._writeSavedAuth(saved);
    return { authenticated: true, authFile: this.authFilePath };
  }

  async checkAuth() {
    if (!this.hasCredentials()) {
      return {
        authenticated: false,
        tier: "none",
        identity: null,
        hint: "Run `provider_cli.mjs connect --provider feishu` or set FEISHU_USER_ACCESS_TOKEN.",
      };
    }
    try {
      const token = await this._getValidUserToken();
      return {
        authenticated: Boolean(token),
        tier: "feishu",
        identity: this.staticUserToken ? "feishu-env-token" : "feishu-oauth-user",
        indexCached: existsSync(this.indexDbPath),
        indexDbPath: existsSync(this.indexDbPath) ? this.indexDbPath : null,
      };
    } catch (err) {
      return {
        authenticated: false,
        tier: "none",
        identity: null,
        error: err.message,
      };
    }
  }

  async _downloadFileByToken(fileToken) {
    const token = await this._getValidUserToken();
    const res = await fetch(`${this.apiBaseUrl}/drive/v1/files/${encodeURIComponent(fileToken)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Feishu Drive download failed (${res.status}) for token=${fileToken}: ${body.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async listFolderFiles(folderToken = this.folderToken) {
    if (!folderToken) throw new Error("Missing folderToken for Feishu listFolderFiles().");
    const token = await this._getValidUserToken();
    const files = [];
    let pageToken = "";
    while (true) {
      const qs = new URLSearchParams({ folder_token: folderToken, page_size: "200" });
      if (pageToken) qs.set("page_token", pageToken);
      const res = await fetch(`${this.apiBaseUrl}/drive/v1/files?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || json.code !== 0) {
        throw new Error(`Feishu list files failed: ${json.msg || res.statusText}`);
      }
      const batch = json.data?.files || [];
      files.push(...batch);
      if (!json.data?.has_more || !json.data?.next_page_token) break;
      pageToken = json.data.next_page_token;
    }
    return files;
  }

  async syncSlideIndex(options = {}) {
    const force = Boolean(options.force);
    if (!force && existsSync(this.indexDbPath)) {
      const st = await fs.stat(this.indexDbPath);
      return {
        synced: true,
        cached: true,
        dbPath: this.indexDbPath,
        bytes: st.size,
        source: "feishu-local-cache",
      };
    }

    let fileToken = options.fileId || options.fileToken || this.indexFileToken;
    if (!fileToken && this.folderToken) {
      const entries = await this.listFolderFiles(this.folderToken);
      const hit = entries.find(
        (f) =>
          f.name === "ppt-index-dist.db.gz" ||
          f.name === "ppt-index-trial.db.gz" ||
          f.name === "ppt-index-dist.db" ||
          f.name === "ppt-index-trial.db"
      );
      if (hit) fileToken = hit.token;
    }
    if (!fileToken) {
      throw new Error(
        "Missing Feishu index file token. Set FEISHU_INDEX_FILE_TOKEN or FEISHU_FOLDER_TOKEN (containing ppt-index-dist.db.gz)."
      );
    }

    const rawBuf = await this._downloadFileByToken(fileToken);
    const isGzip = rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b;
    const dbBuf = isGzip ? await gunzipAsync(rawBuf) : rawBuf;

    await fs.mkdir(this.feishuCacheDir, { recursive: true });
    const tmpPath = `${this.indexDbPath}.tmp`;
    await fs.writeFile(tmpPath, dbBuf);
    await fs.rename(tmpPath, this.indexDbPath);

    return {
      synced: true,
      cached: false,
      dbPath: this.indexDbPath,
      bytes: dbBuf.length,
      sha256: await sha256File(this.indexDbPath),
      source: "feishu-drive-download",
    };
  }

  async searchSlides(filter = {}) {
    if (!existsSync(this.indexDbPath)) {
      await this.syncSlideIndex();
    }
    return querySlideIndexDb(this.indexDbPath, filter, "feishu");
  }

  async searchReports() {
    return [];
  }

  async fetchAsset(request = {}) {
    await pruneExpiredPreviews(this.previewsCacheDir, this.previewTtlMs);
    const previewFile =
      request.previewFile ||
      (request.contentPageId ? `${request.contentPageId}.png` : "") ||
      (request.sku ? `${request.sku}.png` : "");
    const safeName = previewFile ? path.basename(previewFile) : "";
    const cachedPath = safeName ? path.join(this.previewsCacheDir, safeName) : "";

    if (cachedPath && existsSync(cachedPath)) {
      const st = await fs.stat(cachedPath);
      if (Date.now() - st.mtimeMs <= this.previewTtlMs) {
        return {
          localPath: cachedPath,
          cached: true,
          bytes: st.size,
          sha256: await sha256File(cachedPath),
          sourceProvider: "feishu",
        };
      }
    }

    const fileToken = request.feishuFileToken || request.fileToken || request.fileId;
    if (!fileToken) {
      throw new Error(
        `FeishuDriveProvider.fetchAsset requires feishuFileToken (or fileId) to download "${safeName || "preview"}".`
      );
    }

    const buf = await this._downloadFileByToken(fileToken);
    await fs.mkdir(this.previewsCacheDir, { recursive: true });
    const outPath = cachedPath || path.join(this.previewsCacheDir, `${fileToken}.png`);
    const tmpPath = `${outPath}.tmp`;
    await fs.writeFile(tmpPath, buf);
    await fs.rename(tmpPath, outPath);

    return {
      localPath: outPath,
      cached: false,
      bytes: buf.length,
      sha256: await sha256File(outPath),
      sourceProvider: "feishu",
    };
  }
}
