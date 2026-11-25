// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SLIDE_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slides (
  slide_uid TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  deck_title TEXT NOT NULL,
  slide_no INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  image_count INTEGER NOT NULL DEFAULT 0,
  text_slots INTEGER NOT NULL DEFAULT 3,
  result_count INTEGER NOT NULL DEFAULT 0,
  has_table INTEGER NOT NULL DEFAULT 0,
  has_chart INTEGER NOT NULL DEFAULT 0,
  layout_summary TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  style_tags TEXT NOT NULL DEFAULT '',
  topic_id TEXT DEFAULT '',
  file_id TEXT DEFAULT '',
  group_id TEXT DEFAULT '15554411848482',
  tier TEXT NOT NULL DEFAULT 'vip',
  r2_object_key TEXT DEFAULT '',
  preview_key TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_slides_purpose ON slides(purpose);
CREATE INDEX IF NOT EXISTS idx_slides_slots ON slides(image_count, text_slots, result_count);
CREATE INDEX IF NOT EXISTS idx_slides_sku ON slides(sku);
`;

const NON_CONTENT_PAGE_TYPES = new Set([
  "封面",
  "封底",
  "目录",
  "致谢",
  "空白页",
  "占位页",
  "广告附页",
  "目录；章节页",
  "章节页",
  "版权说明",
]);

function splitTerms(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    for (const tok of String(item).split(/[,，|｜/;；]+/)) {
      const clean = tok.trim();
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

function parseExcludeIds(exclude) {
  const out = new Set();
  if (!exclude) return out;
  const arr = Array.isArray(exclude) ? exclude : [exclude];
  for (const item of arr) {
    for (const tok of String(item).split(/[\s,，;；]+/)) {
      const clean = tok.trim();
      if (clean) out.add(clean);
    }
  }
  return out;
}

async function openNodeSqlite(dbPath, readOnly = false) {
  try {
    const sqlite = await import("node:sqlite");
    if (sqlite?.DatabaseSync) {
      return new sqlite.DatabaseSync(dbPath, { open: true, readOnly });
    }
  } catch {
    // Fallback to sqlite3 CLI on older Node <22.5
  }
  return null;
}

async function runSqliteQuery(dbPath, sql, params = []) {
  const db = await openNodeSqlite(dbPath, true);
  if (db) {
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }
  const pCopy = [...params];
  const inlinedSql = sql.replace(/\?/g, () => {
    const v = pCopy.shift();
    if (typeof v === "number") return String(v);
    return `'${String(v ?? "").replace(/'/g, "''")}'`;
  });
  const res = spawnSync("sqlite3", ["-json", dbPath, inlinedSql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status === 0 && res.stdout.trim()) {
    return JSON.parse(res.stdout);
  }
  return [];
}

/**
 * Full-pool bidirectional slot-fingerprint scoring (ported from production `search_index.py`,
 * schema-adaptive for both 38-col sanitized external DBs and 48-col internal DBs).
 */
function scorePagesRow(r, opts) {
  let score = 0;
  const reasons = [];

  const status = String(r.page_status || "");
  if (status.includes("受阻")) score -= 40;
  else score += 4;

  const purpose = String(r.business_purpose || "");
  const pageType = String(r.page_type || "");
  const layout = String(r.layout || "");
  const rawLayout = String(r.raw_layout || "");
  const logic = String(r.logic || "");
  const rawVis = String(r.raw_visual || r.visual_traits || "");
  const topic = String(r.business_topic || "");
  const rawTitle = String(r.raw_title || "");
  const localGfx = String(r.local_graphics || "");
  const resForm = String(r.result_form || "");
  const diagFam = String(r.diagram_family || "");
  const diagLabels = String(r.diagram_labels || "");
  const bg = String(r.background || "");

  // 1. Purpose affinity (multi-term symmetric)
  if (opts.purposeTerms.length > 0) {
    const matchedP = opts.purposeTerms.filter((t) => purpose.includes(t) || pageType.includes(t));
    const wantsCase = opts.purposeTerms.some((t) => t.includes("案例") || t.includes("复盘"));
    const wantsStrategy = opts.purposeTerms.some((t) =>
      ["策略", "方法", "洞察", "结构", "流程"].some((k) => t.includes(k))
    );
    if (matchedP.length > 0) {
      const primaryHit = matchedP.some((t) => purpose.startsWith(t) || purpose === t);
      score += primaryHit ? 28 : 20;
      reasons.push(`用途(${purpose || pageType})`);
    } else {
      score -= 16;
    }
    if (wantsCase) {
      if (r.mature_case === 1) {
        score += 12;
        reasons.push("成熟案例");
      } else if (["执行策略", "方法论", "资源介绍", "公司介绍"].includes(purpose)) {
        score -= 18;
      }
    } else if (wantsStrategy) {
      if (
        ["执行策略", "方法论", "洞察分析", "结构图示", "执行策略；结构图示", "方法论；结构图示"].includes(
          purpose
        )
      ) {
        score += 10;
      } else if (purpose === "作品展示") {
        score -= 18;
      }
    }
  }

  // 2. Diagram family affinity
  if (opts.diagramFamily) {
    if (diagFam.toLowerCase() === opts.diagramFamily.toLowerCase()) {
      score += 24;
      reasons.push(`图示(${diagFam})`);
    }
  } else if (diagFam) {
    score += 4;
  }

  // 3. Layout skeleton matching
  if (opts.layoutTerms.length > 0) {
    const hitShort = opts.layoutTerms.filter((t) => layout.includes(t));
    const hitRaw = opts.layoutTerms.filter((t) => rawLayout.includes(t) || localGfx.includes(t));
    if (hitShort.length > 0) {
      score += 24 + Math.min(6, 2 * (hitShort.length - 1));
      reasons.push(`布局(${hitShort.slice(0, 2).join(",")})`);
    } else if (hitRaw.length > 0) {
      score += 15 + Math.min(4, 2 * (hitRaw.length - 1));
      reasons.push(`详述布局(${hitRaw.slice(0, 2).join(",")})`);
    } else {
      score -= 22;
    }
  }

  // 4. Logic relationship matching
  if (opts.logicTerms.length > 0) {
    const hitL = opts.logicTerms.filter(
      (t) => logic.includes(t) || rawLayout.includes(t) || diagLabels.includes(t)
    );
    if (hitL.length > 0) {
      score += 16;
      reasons.push(`逻辑(${hitL.slice(0, 2).join(",")})`);
    } else {
      score -= 10;
    }
  }

  // 5. Topic & keyword tokens
  if (opts.topicTerms.length > 0) {
    const hitT = opts.topicTerms.filter((t) => topic.includes(t) || rawTitle.includes(t));
    if (hitT.length > 0) {
      score += 12;
      reasons.push(`主题(${hitT.slice(0, 2).join(",")})`);
    }
  }
  if (opts.kwTokens.length > 0) {
    const blob = `${layout}\n${rawLayout}\n${rawVis}\n${purpose}\n${topic}\n${logic}\n${localGfx}\n${diagLabels}\n${rawTitle}\n${r.search_text || ""}`;
    const hits = opts.kwTokens.filter((tok) => blob.includes(tok)).length;
    if (hits === opts.kwTokens.length) {
      score += 16;
      reasons.push(`关键词全命中(${hits}/${opts.kwTokens.length})`);
    } else if (hits > 0) {
      score += 8 * (hits / opts.kwTokens.length);
    } else {
      score -= 18;
    }
  }

  // 6. Bidirectional image slot isomorphism
  if (typeof opts.targetImages === "number" && Number.isFinite(opts.targetImages)) {
    const targetI = opts.targetImages;
    const img = r.image_slots;
    if (img === null || img === undefined) {
      score -= 6;
    } else if (targetI === 0) {
      if (img === 0) {
        score += 30;
        reasons.push("无图纯结构(图=0)");
      } else if (img === 1) {
        score += 4;
      } else {
        score -= Math.min(45, 8 * img);
      }
    } else {
      if (img === 0) {
        score -= 35;
      } else {
        const diff = Math.abs(img - targetI);
        score += Math.max(-24, 28 - 5 * diff);
        if (diff <= 2) reasons.push(`图槽同构(${img}≈${targetI})`);
      }
    }
  }

  // 7. Bidirectional text/density slot isomorphism
  if (typeof opts.targetTextSlots === "number" && Number.isFinite(opts.targetTextSlots)) {
    const targetT = opts.targetTextSlots;
    const txt = r.text_slots;
    if (txt === null || txt === undefined) {
      score -= 5;
    } else if (targetT <= 3) {
      const diff = Math.abs(txt - targetT);
      if (txt <= 4) {
        score += Math.max(4, 26 - 5 * diff);
        reasons.push(`少元素留白(文=${txt})`);
      } else {
        score -= Math.min(40, 6 * (txt - 3));
      }
      if (/留白高|留白充足|留白：high|极简|低密度|密度低|密度：low/.test(rawVis)) score += 8;
      if (/极高密度|密度高|高密度|密排|密度：high/.test(rawVis)) score -= 14;
    } else {
      if (txt <= 1) {
        score -= 32;
      } else if (txt === 2 && targetT >= 5) {
        score -= 18;
      } else {
        const diff = Math.abs(txt - targetT);
        score += Math.max(-20, 26 - 3.2 * diff);
        if (diff <= 2) reasons.push(`文槽同构(${txt}≈${targetT})`);
      }
      if (targetT >= 7 && (r.complex_structure === 1 || /高密度|密度高|密度：high/.test(rawVis))) {
        score += 6;
      }
    }
  }

  // 8. Bidirectional result/KPI slot isomorphism
  if (typeof opts.targetResults === "number" && Number.isFinite(opts.targetResults)) {
    const targetR = opts.targetResults;
    const res = r.result_slots || 0;
    const hasIndRes = r.independent_results_area === 1;
    const nonEmp = /非|无|未见/.test(resForm);
    if (targetR === 0) {
      if (res === 0 && !hasIndRes) {
        score += 18;
        reasons.push("无冗余成果栏");
      } else {
        score -= Math.min(20, 6 + 3 * res);
      }
    } else {
      if (res === 0 && !hasIndRes) {
        score -= 26;
      } else {
        const diff = res > 0 ? Math.abs(res - targetR) : 2;
        let pts = Math.max(-12, 22 - 3.5 * diff);
        if (hasIndRes) pts += 7;
        if (nonEmp) pts -= 10;
        score += pts;
        if (res > 0 && !nonEmp) reasons.push(`实证成果槽(${res})`);
      }
    }
  }

  // 9. Clean watermark-free tie-breaker
  if (rawVis.includes("水印")) score -= 20;
  if (r.white_background === 1 || bg.includes("白")) {
    score += 1.5;
  }

  return { score: Number(score.toFixed(1)), reasons };
}

/**
 * Queries either:
 * 1) Unified `pages` schema (`ppt-index-dist.db` / `ppt-index-trial.db` / `ppt-index.db`)
 *    with full-pool bidirectional slot_v2 scoring + `diagram_family` + `maxPerDeck` diversity; OR
 * 2) Legacy `slides` schema (`yuanmou-slide-index.db`).
 */
export async function querySlideIndexDb(dbPath, filter = {}, providerId = "feishu") {
  if (!dbPath || !existsSync(dbPath)) return [];

  const tableRows = await runSqliteQuery(dbPath, "SELECT name FROM sqlite_master WHERE type='table'");
  const tableSet = new Set(tableRows.map((r) => r.name));

  if (tableSet.has("pages")) {
    return queryPagesSchema(dbPath, filter, providerId);
  }
  if (tableSet.has("slides")) {
    return queryLegacySlidesSchema(dbPath, filter, providerId);
  }
  return [];
}

async function queryPagesSchema(dbPath, filter = {}, providerId = "feishu") {
  const colRows = await runSqliteQuery(dbPath, "PRAGMA table_info(pages)");
  const colSet = new Set(colRows.map((c) => c.name));

  const {
    purpose,
    topic,
    pageType,
    includeNonBody = false,
    diagramFamily,
    targetImages,
    targetTextSlots,
    targetResults,
    minImages,
    maxImages,
    minTextSlots,
    maxTextSlots,
    minResults,
    maxResults,
    stages,
    whiteBackground,
    matureCase,
    layout,
    logic,
    exclude,
    hasTable,
    hasChart,
    keywords,
    contentPageId,
    maxPerDeck = 3,
    limit = 12,
  } = filter;

  const clauses = ["1=1"];
  const params = [];

  if (contentPageId) {
    clauses.push("content_page_id = ?");
    params.push(String(contentPageId));
  }

  // Page-type filter: exclude Cover/TOC/Divider/Blank/Ad by default unless explicitly requested
  const pageTypeTerms = splitTerms(pageType === "any" ? "" : pageType);
  if (pageTypeTerms.length > 0 && colSet.has("page_type")) {
    clauses.push(`(${pageTypeTerms.map(() => "page_type LIKE ?").join(" OR ")})`);
    for (const pt of pageTypeTerms) params.push(`%${pt}%`);
  } else if (!includeNonBody && !contentPageId && colSet.has("page_type")) {
    const nonBody = [...NON_CONTENT_PAGE_TYPES];
    clauses.push(`(page_type IS NULL OR page_type NOT IN (${nonBody.map(() => "?").join(",")}))`);
    params.push(...nonBody);
  }

  if (diagramFamily && diagramFamily !== "any" && colSet.has("diagram_family")) {
    clauses.push("lower(diagram_family) = lower(?)");
    params.push(String(diagramFamily));
  }
  if (typeof stages === "number" && Number.isFinite(stages) && colSet.has("stage_count")) {
    clauses.push("stage_count = ?");
    params.push(stages);
  }
  if (whiteBackground === true) {
    if (colSet.has("white_background") && colSet.has("background")) {
      clauses.push("(white_background = 1 OR background LIKE '%白%')");
    } else if (colSet.has("background")) {
      clauses.push("background LIKE '%白%'");
    }
  }
  if (matureCase === true && colSet.has("mature_case")) {
    clauses.push("mature_case = 1");
  }
  if (typeof minImages === "number" && colSet.has("image_slots")) {
    clauses.push("image_slots >= ?");
    params.push(minImages);
  }
  if (typeof maxImages === "number" && colSet.has("image_slots")) {
    clauses.push("image_slots <= ?");
    params.push(maxImages);
  }
  if (typeof minTextSlots === "number" && colSet.has("text_slots")) {
    clauses.push("text_slots >= ?");
    params.push(minTextSlots);
  }
  if (typeof maxTextSlots === "number" && colSet.has("text_slots")) {
    clauses.push("text_slots <= ?");
    params.push(maxTextSlots);
  }
  if (typeof minResults === "number" && colSet.has("result_slots")) {
    clauses.push("result_slots >= ?");
    params.push(minResults);
  }
  if (typeof maxResults === "number" && colSet.has("result_slots")) {
    clauses.push("result_slots <= ?");
    params.push(maxResults);
  }
  if (hasTable === true && colSet.has("local_graphics")) {
    clauses.push(
      colSet.has("raw_layout")
        ? "(local_graphics LIKE '%表%' OR raw_layout LIKE '%表%')"
        : "local_graphics LIKE '%表%'"
    );
  }
  if (hasChart === true && colSet.has("local_graphics")) {
    clauses.push(
      "(local_graphics LIKE '%柱%' OR local_graphics LIKE '%折线%' OR local_graphics LIKE '%饼%' OR local_graphics LIKE '%环%' OR local_graphics LIKE '%图表%' OR local_graphics LIKE '%条形%')"
    );
  }

  // Only select columns that exist in the current DB (works identically on 38-col dist/trial & 48-col internal DBs)
  const wantedCols = [
    "content_page_id",
    "preview_file",
    "preview_path",
    "file_name",
    "physical_page",
    "page_status",
    "business_purpose",
    "business_topic",
    "page_type",
    "layout",
    "logic",
    "local_graphics",
    "visual_traits",
    "background",
    "stage_count",
    "result_slots",
    "independent_results_area",
    "mature_case",
    "white_background",
    "complex_structure",
    "text_slots",
    "image_slots",
    "raw_title",
    "raw_layout",
    "raw_visual",
    "result_form",
    "restore_note",
    "diagram_family",
    "diagram_labels",
    "feishu_file_token",
    "search_text",
  ].filter((c) => colSet.has(c));

  const sql = `SELECT ${wantedCols.join(", ")} FROM pages WHERE ${clauses.join(" AND ")}`;
  const rows = await runSqliteQuery(dbPath, sql, params);

  const excludeSet = parseExcludeIds(exclude);
  const purposeTerms = splitTerms(purpose === "any" ? "" : purpose);
  const layoutTerms = splitTerms(layout);
  const logicTerms = splitTerms(logic);
  const topicTerms = splitTerms(topic);
  const kwTokens = Array.isArray(keywords)
    ? keywords.map((k) => String(k).trim()).filter(Boolean)
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/).filter(Boolean)
      : [];

  const scoringOpts = {
    purposeTerms,
    layoutTerms,
    logicTerms,
    topicTerms,
    kwTokens,
    diagramFamily: diagramFamily && diagramFamily !== "any" ? String(diagramFamily) : "",
    targetImages,
    targetTextSlots,
    targetResults,
  };

  const hasScoring =
    purposeTerms.length > 0 ||
    layoutTerms.length > 0 ||
    logicTerms.length > 0 ||
    topicTerms.length > 0 ||
    kwTokens.length > 0 ||
    Boolean(scoringOpts.diagramFamily) ||
    typeof targetImages === "number" ||
    typeof targetTextSlots === "number" ||
    typeof targetResults === "number";

  const scored = [];
  const seenCid = new Set();

  for (const r of rows) {
    const cid = String(r.content_page_id || "");
    if (!cid || excludeSet.has(cid) || seenCid.has(cid)) continue;
    seenCid.add(cid);

    const { score, reasons } = hasScoring
      ? scorePagesRow(r, scoringOpts)
      : {
          score: String(r.page_status || "").includes("受阻") ? -40 : r.diagram_family ? 4 : 0,
          reasons: [],
        };
    scored.push({ r, score, reasons });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.r.content_page_id).localeCompare(String(b.r.content_page_id));
  });

  // Diversity control: cap repeats from same deck (internal DB: file_name; sanitized external DB: topic+layout fingerprint)
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const capPerGroup = maxPerDeck > 0 ? maxPerDeck : 999999;
  const groupCounts = new Map();
  const picked = [];

  for (const entry of scored) {
    const { r } = entry;
    const deckKey = r.file_name
      ? String(r.file_name)
      : `${r.business_topic || ""}|${r.layout || ""}|${r.diagram_family || ""}`;
    const used = groupCounts.get(deckKey) || 0;
    if (deckKey !== "||" && used >= capPerGroup) continue;
    groupCounts.set(deckKey, used + 1);
    picked.push(entry);
    if (picked.length >= safeLimit) break;
  }

  return picked.map(({ r, score, reasons }) => {
    const rawPrev = r.preview_file || r.preview_path || `${r.content_page_id}.png`;
    const previewFile = path.basename(String(rawPrev).replace(/\\/g, "/"));
    const lg = String(r.local_graphics || "");
    const bg = String(r.background || "");
    return {
      provider: providerId,
      slideUid: r.content_page_id,
      contentPageId: r.content_page_id,
      sku: r.content_page_id,
      deckTitle: r.business_topic || r.layout || r.content_page_id,
      slideNo: r.physical_page || 1,
      purpose: r.business_purpose || r.page_type || "general",
      pageType: r.page_type || undefined,
      diagramFamily: r.diagram_family || undefined,
      diagramLabels: r.diagram_labels || undefined,
      imageCount: r.image_slots ?? 0,
      textSlots: r.text_slots ?? 0,
      resultCount: r.result_slots ?? 0,
      whiteBackground: r.white_background === 1 || bg.includes("白"),
      hasTable: lg.includes("表"),
      hasChart: /柱|折线|饼|环|图表|条形/.test(lg),
      layoutSummary: r.raw_layout || r.layout || "",
      visualTraits: r.raw_visual || r.visual_traits || "",
      restoreNote: r.restore_note || undefined,
      previewFile,
      feishuFileToken: r.feishu_file_token || undefined,
      matchScore: hasScoring ? score : undefined,
      matchReasons: reasons.length > 0 ? reasons : undefined,
    };
  });
}

async function queryLegacySlidesSchema(dbPath, filter = {}, providerId = "zsxq") {
  const {
    purpose,
    minImages,
    maxImages,
    minTextSlots,
    maxTextSlots,
    hasTable,
    hasChart,
    keywords,
    sku,
    limit = 12,
  } = filter;

  const clauses = ["1=1"];
  const params = [];

  if (sku) {
    clauses.push("sku = ?");
    params.push(String(sku));
  }
  if (purpose && purpose !== "any") {
    clauses.push("(purpose = ? OR keywords LIKE ?)");
    params.push(String(purpose), `%${purpose}%`);
  }
  if (typeof minImages === "number") {
    clauses.push("image_count >= ?");
    params.push(minImages);
  }
  if (typeof maxImages === "number") {
    clauses.push("image_count <= ?");
    params.push(maxImages);
  }
  if (typeof minTextSlots === "number") {
    clauses.push("text_slots >= ?");
    params.push(minTextSlots);
  }
  if (typeof maxTextSlots === "number") {
    clauses.push("text_slots <= ?");
    params.push(maxTextSlots);
  }
  if (hasTable === true) {
    clauses.push("has_table = 1");
  }
  if (hasChart === true) {
    clauses.push("has_chart = 1");
  }
  const kwTokens = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/)
      : [];
  for (const kw of kwTokens) {
    const pat = `%${kw}%`;
    clauses.push("(deck_title LIKE ? OR layout_summary LIKE ? OR keywords LIKE ? OR style_tags LIKE ?)");
    params.push(pat, pat, pat, pat);
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const sql = `
    SELECT slide_uid, sku, deck_title, slide_no, purpose, image_count, text_slots, result_count,
           has_table, has_chart, layout_summary, keywords, style_tags, topic_id, file_id, group_id,
           tier, r2_object_key, preview_key
    FROM slides
    WHERE ${clauses.join(" AND ")}
    ORDER BY has_chart DESC, has_table DESC, sku ASC, slide_no ASC
    LIMIT ${safeLimit}
  `;

  const rows = await runSqliteQuery(dbPath, sql, params);
  return rows.map((r) => ({
    provider: providerId,
    slideUid: r.slide_uid,
    sku: r.sku,
    deckTitle: r.deck_title,
    slideNo: r.slide_no,
    purpose: r.purpose,
    imageCount: r.image_count,
    textSlots: r.text_slots,
    resultCount: r.result_count,
    hasTable: Boolean(r.has_table),
    hasChart: Boolean(r.has_chart),
    layoutSummary: r.layout_summary,
    keywords: r.keywords,
    styleTags: r.style_tags,
    topicId: r.topic_id || undefined,
    fileId: r.file_id || undefined,
    groupId: r.group_id || undefined,
    tier: r.tier,
    r2ObjectKey: r.r2_object_key || undefined,
    previewKey: r.preview_key || undefined,
  }));
}
