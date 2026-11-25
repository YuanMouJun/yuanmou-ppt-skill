// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { SlideSourceProvider, sha256File } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

/**
 * Route 1 Free / Offline Provider (`provider: "local"`).
 * Works out-of-the-box with zero cloud credentials using the user's own local folder (`YUANMOU_LOCAL_DIR`)
 * containing `.pptx` templates, `.pdf` reports, and an optional co-located `yuanmou-slide-index.db`.
 */
export class LocalStandaloneProvider extends SlideSourceProvider {
  constructor(options = {}) {
    super("local", "Local Standalone Folder", options);
    this.localLibraryDir = options.localLibraryDir || process.env.YUANMOU_LOCAL_DIR || "";
    this.capabilities = {
      slideIndex: Boolean(this.localLibraryDir),
      pptxTemplates: Boolean(this.localLibraryDir),
      pdfReports: Boolean(this.localLibraryDir),
      presignedDirectDownload: false,
    };
  }

  async checkAuth() {
    return {
      authenticated: true,
      tier: "free",
      identity: "standalone-local",
      localLibraryDir: this.localLibraryDir || null,
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

  async syncSlideIndex() {
    const colocatedDb = this._findColocatedDb();
    if (colocatedDb) {
      return {
        synced: true,
        dbPath: colocatedDb,
        source: "local-colocated-db",
      };
    }
    return {
      synced: true,
      dbPath: null,
      slideCount: 0,
      source: "local-no-index",
    };
  }

  async searchSlides(filter = {}) {
    const colocatedDb = this._findColocatedDb();
    if (colocatedDb) {
      return querySlideIndexDb(colocatedDb, filter, "local");
    }
    return [];
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
    throw new Error(
      `LocalStandaloneProvider cannot fetch remote SKU "${request.sku || ""}". Configure ZsxqPlanetProvider (zsxq-cli) or YuanmouCloudR2Provider (YUANMOU_API_KEY).`
    );
  }
}
