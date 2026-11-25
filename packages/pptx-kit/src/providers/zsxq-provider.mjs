// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SlideSourceProvider, downloadUrlToBuffer, unwrapSlideIndexDbBuffer } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

export const DEFAULT_ZSXQ_FREE_GROUP_ID = "48841185812248"; // 广告营销及各行业报告资料分享 (免费公开体验星球 · 星球号 77391343)
export const DEFAULT_ZSXQ_REPORT_GROUP_ID = "28512424458451"; // 渊眸·数据行业报告库 (付费 VIP 1xxx · 星球号 43773104)
export const DEFAULT_ZSXQ_TEMPLATE_GROUP_ID = "15554411848482"; // 渊眸·品牌策划方案库 (付费 VIP 5xxx · 星球号 37656012)
export const DEFAULT_SLIDE_INDEX_QUERY = "yuanmou-slide-index";

function sleepMs(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findZsxqRunner(explicitBin) {
  if (explicitBin && existsSync(explicitBin)) {
    return { cmd: explicitBin, prefixArgs: [] };
  }
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(whichCmd, ["zsxq-cli"], { encoding: "utf8" });
  if (res.status === 0 && res.stdout.trim()) {
    return { cmd: res.stdout.trim().split(/\r?\n/)[0], prefixArgs: [] };
  }
  // Zero-install fallback via official npm `npx -y zsxq-cli`!
  const npxRes = spawnSync(whichCmd, ["npx"], { encoding: "utf8" });
  if (npxRes.status === 0 && npxRes.stdout.trim()) {
    return { cmd: npxRes.stdout.trim().split(/\r?\n/)[0], prefixArgs: ["-y", "zsxq-cli"] };
  }
  return null;
}

/**
 * V1 Production VIP Provider (`provider: "zsxq"`).
 * Powered by `zsxq-cli` with persistent 4.5s anti-429 rate-limit guard & local SHA-256 cache.
 */
export class ZsxqPlanetProvider extends SlideSourceProvider {
  constructor(options = {}) {
    super("zsxq", "Knowledge Planet (Free Trial + VIP Planets)", options);
    this.runner = findZsxqRunner(options.zsxqBin || process.env.ZSXQ_CLI_BIN);
    this.freeGroupId = String(
      options.freeGroupId || process.env.YUANMOU_ZSXQ_FREE_GROUP || DEFAULT_ZSXQ_FREE_GROUP_ID
    );
    this.reportGroupId = String(
      options.reportGroupId || process.env.YUANMOU_ZSXQ_REPORT_GROUP || DEFAULT_ZSXQ_REPORT_GROUP_ID
    );
    this.templateGroupId = String(
      options.templateGroupId || process.env.YUANMOU_ZSXQ_TEMPLATE_GROUP || DEFAULT_ZSXQ_TEMPLATE_GROUP_ID
    );
    this.indexFileId = options.indexFileId || process.env.YUANMOU_ZSXQ_INDEX_FILE_ID || "";
    this.minIntervalMs = options.minIntervalMs ?? 4500;
    this._rateStampPath = path.join(this.cache.rootDir, ".zsxq_last_req_ts");
    this._cachedAuth = null;

    this.capabilities = {
      slideIndex: true,
      pptxTemplates: true,
      pdfReports: true,
      presignedDirectDownload: true,
    };
  }

  isCliAvailable() {
    return Boolean(this.runner);
  }

  async _enforceRateLimit() {
    await this.cache.ensureDirs();
    let lastTs = 0;
    try {
      lastTs = Number.parseInt(await fs.readFile(this._rateStampPath, "utf8"), 10) || 0;
    } catch {
      lastTs = 0;
    }
    const elapsed = Date.now() - lastTs;
    if (elapsed < this.minIntervalMs) {
      await sleepMs(this.minIntervalMs - elapsed);
    }
    await fs.writeFile(this._rateStampPath, String(Date.now()), "utf8");
  }

  async _execZsxqJson(args, { rateLimited = true } = {}) {
    if (!this.runner) {
      throw new Error("Node `npx` / `zsxq-cli` not found. Run `npx -y zsxq-cli auth login` to connect Knowledge Planet.");
    }
    if (rateLimited) {
      await this._enforceRateLimit();
    }
    const res = spawnSync(this.runner.cmd, [...this.runner.prefixArgs, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (res.status !== 0) {
      throw new Error(`zsxq-cli ${args.join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
    }
    const raw = res.stdout.trim();
    const jsonStart = raw.search(/[\[{]/);
    return jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart)) : {};
  }

  async checkAuth() {
    if (!this.runner) {
      return { authenticated: false, tier: "free", reason: "zsxq-cli / npx not available" };
    }
    try {
      const groupsPayload = await this._execZsxqJson(
        ["group", "+list", "--limit", "200", "--json"],
        { rateLimited: false }
      );
      const list = Array.isArray(groupsPayload)
        ? groupsPayload
        : groupsPayload?.groups || groupsPayload?.resp_data?.groups || [];
      const joinedIds = new Set(list.map((g) => String(g.group_id || g.id || "")));
      const hasTemplateGroup = joinedIds.has(this.templateGroupId);
      const hasReportGroup = joinedIds.has(this.reportGroupId);
      const hasFreeTrialGroup = joinedIds.has(this.freeGroupId);

      const tier = hasTemplateGroup || hasReportGroup ? "vip" : hasFreeTrialGroup ? "trial" : "free";
      const authenticated = tier === "vip" || tier === "trial";

      this._cachedAuth = {
        authenticated,
        tier,
        groups: {
          freeTrialPlanet: hasFreeTrialGroup,
          templatePlanet: hasTemplateGroup,
          reportPlanet: hasReportGroup,
        },
        reason: authenticated
          ? undefined
          : "Join Free Trial Planet (星球号 77391343) or VIP Planets (37656012 / 43773104) and run `npx -y zsxq-cli auth login`",
      };
      return this._cachedAuth;
    } catch (err) {
      return { authenticated: false, tier: "free", reason: err.message };
    }
  }

  async _getSignedFileDownloadUrl(fileId) {
    const resp = await this._execZsxqJson([
      "api",
      "raw",
      "--method",
      "GET",
      "--path",
      `/v2/files/${encodeURIComponent(String(fileId))}/download_url`,
    ]);
    const url = resp?.resp_data?.download_url || resp?.download_url;
    if (!url) {
      throw new Error(`Failed to obtain signed download URL for zsxq file_id=${fileId}`);
    }
    return url;
  }

  async _resolveFileFromTopic(topicId, extFilter = "") {
    const resp = await this._execZsxqJson([
      "api",
      "raw",
      "--method",
      "GET",
      "--path",
      `/v2/topics/${encodeURIComponent(String(topicId))}`,
    ]);
    const topic = resp?.resp_data?.topic || resp?.topic || {};
    const files = topic?.talk?.files || topic?.files || [];
    if (files.length === 0) return null;
    if (extFilter) {
      const cleanExt = extFilter.toLowerCase();
      const matched = files.find((f) => String(f.name || "").toLowerCase().endsWith(cleanExt));
      if (matched) return matched;
    }
    return files[0];
  }

  async syncSlideIndex(options = {}) {
    await this.cache.ensureDirs();
    if (!options.force && existsSync(this.cache.indexDbPath)) {
      return {
        synced: true,
        cached: true,
        dbPath: this.cache.indexDbPath,
        source: "zsxq",
      };
    }

    let targetFileId = options.fileId || this.indexFileId;
    if (!targetFileId) {
      const auth = this._cachedAuth || (await this.checkAuth());
      const indexGroup = auth.groups?.templatePlanet ? this.templateGroupId : this.freeGroupId;
      const searchRes = await this._execZsxqJson([
        "topic",
        "+search",
        "--group-id",
        indexGroup,
        "--query",
        DEFAULT_SLIDE_INDEX_QUERY,
        "--json",
      ]);
      const topics = Array.isArray(searchRes)
        ? searchRes
        : searchRes?.topics || searchRes?.resp_data?.topics || [];
      for (const item of topics) {
        const t = item.topic || item;
        const files = t?.talk?.files || t?.files || [];
        const dbFile = files.find((f) => /yuanmou-slide-index\.(?:zip|db)$/i.test(String(f.name || "")));
        if (dbFile?.file_id) {
          targetFileId = String(dbFile.file_id);
          break;
        }
      }
    }

    if (!targetFileId) {
      return {
        synced: false,
        dbPath: existsSync(this.cache.indexDbPath) ? this.cache.indexDbPath : null,
        source: "zsxq",
        reason: "yuanmou-slide-index not yet mounted on template planet",
      };
    }

    const signedUrl = await this._getSignedFileDownloadUrl(targetFileId);
    const rawBuf = await downloadUrlToBuffer(signedUrl);
    const buf = unwrapSlideIndexDbBuffer(rawBuf);
    const saved = await this.cache.saveAssetBuffer({
      cacheKey: `index:zsxq:${targetFileId}`,
      targetPath: this.cache.indexDbPath,
      buffer: buf,
      providerId: "zsxq",
      expectedSha256: options.sha256,
      meta: { fileId: targetFileId },
    });

    return {
      synced: true,
      cached: false,
      dbPath: saved.localPath,
      sha256: saved.sha256,
      bytes: saved.bytes,
      source: "zsxq",
    };
  }

  async searchSlides(filter = {}) {
    const auth = this._cachedAuth || (await this.checkAuth());
    if (existsSync(this.cache.indexDbPath)) {
      const allHits = await querySlideIndexDb(this.cache.indexDbPath, filter, "zsxq");
      // For `trial` (Free Planet) members, mark VIP-only hits as `lockedForTrial: true` so the Selection Board shows VIP teasers!
      return allHits.map((h) => ({
        ...h,
        lockedForTrial: auth.tier === "trial" && h.tier === "vip" ? true : undefined,
      }));
    }
    // Fallback to planet topic search if index DB isn't synced locally yet
    const targetTemplateGroup = auth.groups?.templatePlanet ? this.templateGroupId : this.freeGroupId;
    const kw = Array.isArray(filter.keywords)
      ? filter.keywords.join(" ")
      : filter.keywords || filter.purpose || "方案";
    const searchRes = await this._execZsxqJson([
      "topic",
      "+search",
      "--group-id",
      targetTemplateGroup,
      "--query",
      String(kw),
      "--json",
    ]);
    const topics = Array.isArray(searchRes)
      ? searchRes
      : searchRes?.topics || searchRes?.resp_data?.topics || [];
    return topics.slice(0, filter.limit || 10).map((item) => {
      const t = item.topic || item;
      const text = t?.talk?.text || t?.text || "";
      const files = t?.talk?.files || t?.files || [];
      const pptFile = files.find((f) => /\.pptx?$/i.test(f.name || "")) || files[0];
      const sku = (pptFile?.name || text).match(/【?(\d{4})】?/)?.[1] || "5XXX";
      return {
        provider: "zsxq",
        sku,
        deckTitle: pptFile?.name || text.slice(0, 60),
        slideNo: 1,
        purpose: filter.purpose || "general",
        topicId: String(t.topic_id || ""),
        fileId: pptFile?.file_id ? String(pptFile.file_id) : undefined,
        layoutSummary: text.replace(/\s+/g, " ").slice(0, 120),
      };
    });
  }

  async searchReports(query = {}) {
    const auth = this._cachedAuth || (await this.checkAuth());
    const targetReportGroup = auth.groups?.reportPlanet ? this.reportGroupId : this.freeGroupId;
    const q = String(query.keyword || query.sku || "行业报告");
    const searchRes = await this._execZsxqJson([
      "topic",
      "+search",
      "--group-id",
      targetReportGroup,
      "--query",
      q,
      "--json",
    ]);
    const topics = Array.isArray(searchRes)
      ? searchRes
      : searchRes?.topics || searchRes?.resp_data?.topics || [];
    return topics.slice(0, query.limit || 10).map((item) => {
      const t = item.topic || item;
      const text = t?.talk?.text || t?.text || "";
      const files = t?.talk?.files || t?.files || [];
      const pdfFile = files.find((f) => /\.pdf$/i.test(f.name || "")) || files[0];
      const sku = (pdfFile?.name || text).match(/【?(\d{4})】?/)?.[1] || "1XXX";
      return {
        provider: "zsxq",
        sku,
        title: pdfFile?.name || text.split("\n")[0]?.slice(0, 80) || sku,
        summary: text.replace(/\s+/g, " ").slice(0, 160),
        topicId: String(t.topic_id || ""),
        fileId: pdfFile?.file_id ? String(pdfFile.file_id) : undefined,
        publishedAt: t.create_time,
      };
    });
  }

  async fetchAsset(request = {}) {
    const { kind = "pptx", sku = "", fileId, topicId, filename, sha256 } = request;
    let resolvedFileId = fileId;
    let resolvedFilename = filename;

    if (!resolvedFileId && topicId) {
      const ext = kind === "pdf" ? ".pdf" : kind === "pptx" ? ".pptx" : "";
      const fileMeta = await this._resolveFileFromTopic(topicId, ext);
      if (fileMeta?.file_id) {
        resolvedFileId = String(fileMeta.file_id);
        resolvedFilename = resolvedFilename || fileMeta.name;
      }
    }

    if (!resolvedFileId) {
      throw new Error(`ZsxqPlanetProvider.fetchAsset requires fileId or topicId (sku=${sku})`);
    }

    const cacheKey = `zsxq:${kind}:${resolvedFileId}`;
    const hit = await this.cache.getCachedAsset(cacheKey, sha256);
    if (hit) {
      return { ...hit, cached: true };
    }

    const signedUrl = await this._getSignedFileDownloadUrl(resolvedFileId);
    const buf = await downloadUrlToBuffer(signedUrl);
    const targetPath = this.cache.resolveAssetTargetPath({
      kind,
      sku: sku || resolvedFileId,
      filename: resolvedFilename,
    });

    return this.cache.saveAssetBuffer({
      cacheKey,
      targetPath,
      buffer: buf,
      providerId: "zsxq",
      expectedSha256: sha256,
      meta: { sku, fileId: resolvedFileId, topicId },
    });
  }
}
