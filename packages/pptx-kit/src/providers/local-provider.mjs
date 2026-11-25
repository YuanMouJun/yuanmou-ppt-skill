// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { SlideSourceProvider, sha256File } from "./base-provider.mjs";
import { querySlideIndexDb } from "./sqlite-index.mjs";

export const BUILTIN_SKELETON_CATALOG = Object.freeze([
  { presetId: "ym-cover-editorial", purpose: "cover", title: "咨询级杂志感主视觉封面", imageCount: 1, textSlots: 3, hasTable: false, hasChart: false, layoutSummary: "左文右出血大图 / 撞色主副标题与日期署名栏" },
  { presetId: "ym-toc-4part", purpose: "agenda", title: "四章编号目录过渡页", imageCount: 0, textSlots: 4, hasTable: false, hasChart: false, layoutSummary: "左侧章节锚点 + 右侧 01-04 结构化议程矩阵" },
  { presetId: "ym-3pillar-insight", purpose: "insight", title: "三支柱核心洞察结论页", imageCount: 0, textSlots: 3, hasTable: false, hasChart: false, layoutSummary: "Action Title 判断句 + 三等分带顶边强调条卡片 + 底部 Takeaway 托架" },
  { presetId: "ym-2x2-quadrant", purpose: "framework", title: "2×2 战略象限矩阵页", imageCount: 0, textSlots: 4, hasTable: false, hasChart: false, layoutSummary: "十字坐标轴箭头 + 四象限差异化底色策略块" },
  { presetId: "ym-funnel-conversion", purpose: "funnel", title: "A5 全域种草转化漏斗页", imageCount: 0, textSlots: 4, hasTable: false, hasChart: false, layoutSummary: "左梯形渐变漏斗（曝光→互动→领券→复购）+ 右侧关键抓手拆解" },
  { presetId: "ym-timeline-roadmap", purpose: "timeline", title: "五阶段里程碑推进路线图", imageCount: 0, textSlots: 5, hasTable: false, hasChart: false, layoutSummary: "中轴同心靶心节点 + 上下交错指针卡片" },
  { presetId: "ym-competitor-table", purpose: "comparison", title: "竞品多维对标原生表格页", imageCount: 0, textSlots: 2, hasTable: true, hasChart: false, layoutSummary: "左结论摘要 + 右侧 fixed/fr 比例原生对比表" },
  { presetId: "ym-dual-chart-evidence", purpose: "data", title: "柱形趋势 + 环形占比双图实证页", imageCount: 0, textSlots: 2, hasTable: false, hasChart: true, layoutSummary: "左侧簇状柱形图 + 右侧结构环形图（均带内嵌 .xlsx）" },
  { presetId: "ym-persona-fan", purpose: "persona", title: "核心消费人群画像与圈层页", imageCount: 3, textSlots: 3, hasTable: false, hasChart: false, layoutSummary: "三大目标客群圆角头像卡 + 痛点/场景/货盘映射" },
  { presetId: "ym-case-breakdown", purpose: "case", title: "爆款案例视觉拆解页", imageCount: 2, textSlots: 3, hasTable: false, hasChart: false, layoutSummary: "左实拍样张圆角蒙版组 + 右三步打法与核心 ROI 指标卡" },
  { presetId: "ym-budget-roi-sheet", purpose: "budget", title: "投放配比与 ROI 测算总表页", imageCount: 0, textSlots: 2, hasTable: true, hasChart: true, layoutSummary: "顶部关键 KPI 卡 + 底部跨行合并预算与合计验算表" },
  { presetId: "ym-closing-summary", purpose: "closing", title: "核心行动清单与合作致谢页", imageCount: 0, textSlots: 3, hasTable: false, hasChart: false, layoutSummary: "三项近期落地 Next Steps + 品牌致谢封底" },
]);

/**
 * Route 1 Free / Offline Provider (`provider: "local"`).
 * Works out-of-the-box with zero cloud credentials using built-in consulting skeletons + optional local folder.
 */
export class LocalStandaloneProvider extends SlideSourceProvider {
  constructor(options = {}) {
    super("local", "Local Standalone & Built-in Presets", options);
    this.localLibraryDir = options.localLibraryDir || process.env.YUANMOU_LOCAL_DIR || "";
    this.capabilities = {
      slideIndex: true,
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

  async syncSlideIndex() {
    const colocatedDb = this.localLibraryDir
      ? path.join(this.localLibraryDir, "yuanmou-slide-index.db")
      : "";
    if (colocatedDb && existsSync(colocatedDb)) {
      return {
        synced: true,
        dbPath: colocatedDb,
        source: "local-colocated-db",
      };
    }
    return {
      synced: true,
      dbPath: null,
      slideCount: BUILTIN_SKELETON_CATALOG.length,
      source: "builtin-presets",
    };
  }

  async searchSlides(filter = {}) {
    // If user has a local folder where `yuanmou-slide-index.db` sits alongside `.pptx` templates, query it directly!
    if (this.localLibraryDir) {
      const colocatedDb = path.join(this.localLibraryDir, "yuanmou-slide-index.db");
      if (existsSync(colocatedDb)) {
        return querySlideIndexDb(colocatedDb, filter, "local");
      }
    }

    const { purpose, minImages, maxImages, hasTable, hasChart, keywords, limit = 12 } = filter;
    const kwList = Array.isArray(keywords)
      ? keywords
      : typeof keywords === "string" && keywords.trim()
        ? keywords.trim().toLowerCase().split(/\s+/)
        : [];

    const matches = BUILTIN_SKELETON_CATALOG.filter((item) => {
      if (purpose && purpose !== "any" && item.purpose !== purpose) return false;
      if (typeof minImages === "number" && item.imageCount < minImages) return false;
      if (typeof maxImages === "number" && item.imageCount > maxImages) return false;
      if (hasTable !== undefined && item.hasTable !== Boolean(hasTable)) return false;
      if (hasChart !== undefined && item.hasChart !== Boolean(hasChart)) return false;
      if (kwList.length > 0) {
        const hay = `${item.title} ${item.purpose} ${item.layoutSummary}`.toLowerCase();
        if (!kwList.some((k) => hay.includes(k))) return false;
      }
      return true;
    });

    return matches.slice(0, limit).map((m, idx) => ({
      provider: "local",
      presetId: m.presetId,
      sku: `PRESET-${String(idx + 1).padStart(2, "0")}`,
      deckTitle: m.title,
      slideNo: 1,
      purpose: m.purpose,
      imageCount: m.imageCount,
      textSlots: m.textSlots,
      resultCount: m.hasChart || m.hasTable ? 1 : 0,
      hasTable: m.hasTable,
      hasChart: m.hasChart,
      layoutSummary: m.layoutSummary,
    }));
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
    if (!resolvedPath && this.localLibraryDir && request.sku && existsSync(this.localLibraryDir)) {
      const ext = request.kind === "pdf" ? ".pdf" : ".pptx";
      const files = await fs.readdir(this.localLibraryDir);
      const hit = files.find(
        (f) => f.toLowerCase().endsWith(ext) && f.includes(String(request.sku))
      );
      if (hit) resolvedPath = path.join(this.localLibraryDir, hit);
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
