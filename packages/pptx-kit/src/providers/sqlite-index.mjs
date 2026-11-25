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
  const res = spawnSync("sqlite3", ["-json", dbPath, inlinedSql], { encoding: "utf8" });
  if (res.status === 0 && res.stdout.trim()) {
    return JSON.parse(res.stdout);
  }
  return [];
}

/**
 * Queries either:
 * 1) Unified `pages` schema (`ppt-index-dist.db` / `ppt-index-trial.db` / `ppt-index-lite.db`)
 *    with slot_v2 fingerprints + `diagram_family` + optional `feishu_file_token`; OR
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
    pageType,
    diagramFamily,
    targetImages,
    targetTextSlots,
    targetResults,
    minImages,
    maxImages,
    minTextSlots,
    maxTextSlots,
    layout,
    logic,
    exclude,
    hasTable,
    hasChart,
    keywords,
    contentPageId,
    limit = 12,
  } = filter;

  const clauses = ["1=1"];
  const params = [];

  if (contentPageId) {
    clauses.push("content_page_id = ?");
    params.push(String(contentPageId));
  }
  const excludeList = Array.isArray(exclude)
    ? exclude
    : typeof exclude === "string" && exclude.trim()
      ? exclude.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      : [];
  if (excludeList.length > 0) {
    clauses.push(`content_page_id NOT IN (${excludeList.map(() => "?").join(",")})`);
    params.push(...excludeList);
  }
  if (purpose && purpose !== "any") {
    clauses.push("(business_purpose LIKE ? OR search_text LIKE ?)");
    const pat = `%${purpose}%`;
    params.push(pat, pat);
  }
  if (pageType && pageType !== "any") {
    clauses.push("page_type LIKE ?");
    params.push(`%${pageType}%`);
  }
  if (diagramFamily && diagramFamily !== "any" && colSet.has("diagram_family")) {
    clauses.push("lower(diagram_family) = lower(?)");
    params.push(String(diagramFamily));
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
  if (hasTable === true && colSet.has("local_graphics")) {
    clauses.push("(local_graphics LIKE '%表%' OR raw_layout LIKE '%表%')");
  }
  if (hasChart === true && colSet.has("local_graphics")) {
    clauses.push("(local_graphics LIKE '%柱%' OR local_graphics LIKE '%折线%' OR local_graphics LIKE '%饼%' OR local_graphics LIKE '%环%' OR local_graphics LIKE '%图%')");
  }

  const kwTokens = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/)
      : [];
  for (const kw of kwTokens) {
    const pat = `%${kw}%`;
    if (colSet.has("diagram_labels")) {
      clauses.push("(search_text LIKE ? OR coalesce(diagram_labels, '') LIKE ? OR coalesce(layout, '') LIKE ?)");
      params.push(pat, pat, pat);
    } else {
      clauses.push("(search_text LIKE ? OR coalesce(layout, '') LIKE ?)");
      params.push(pat, pat);
    }
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const needsScoring =
    typeof targetImages === "number" ||
    typeof targetTextSlots === "number" ||
    typeof targetResults === "number" ||
    Boolean(layout) ||
    Boolean(logic);
  const fetchLimit = needsScoring ? Math.max(safeLimit * 20, 300) : safeLimit;
  const orderCol = colSet.has("diagram_family")
    ? "CASE WHEN diagram_family IS NOT NULL AND diagram_family != '' THEN 0 ELSE 1 END, content_page_id ASC"
    : "content_page_id ASC";
  const sql = `
    SELECT *
    FROM pages
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderCol}
    LIMIT ${fetchLimit}
  `;

  const rows = await runSqliteQuery(dbPath, sql, params);

  const layoutTokens = typeof layout === "string" && layout.trim() ? layout.split(/[,;，；\s]+/).filter(Boolean) : [];
  const logicTokens = typeof logic === "string" && logic.trim() ? logic.split(/[,;，；\s]+/).filter(Boolean) : [];

  const mapped = rows.map((r) => {
    const rawPrev = r.preview_file || r.preview_path || `${r.content_page_id}.png`;
    const previewFile = path.basename(String(rawPrev).replace(/\\/g, "/"));
    const lg = String(r.local_graphics || "");
    const imgSlots = r.image_slots ?? 0;
    const txtSlots = r.text_slots ?? 0;
    const resSlots = r.result_slots ?? 0;

    // Bidirectional slot-fingerprint isomorphism score
    let score = 0;
    if (typeof targetImages === "number") {
      const d = Math.abs(imgSlots - targetImages);
      score += d === 0 ? 30 : Math.max(-20, 22 - d * 10);
      if ((targetImages === 0) !== (imgSlots === 0)) score -= 18;
    }
    if (typeof targetTextSlots === "number") {
      const d = Math.abs(txtSlots - targetTextSlots);
      score += d === 0 ? 24 : Math.max(-15, 18 - d * 6);
    }
    if (typeof targetResults === "number") {
      const d = Math.abs(resSlots - targetResults);
      score += d === 0 ? 18 : Math.max(-12, 12 - d * 6);
    }
    if (layoutTokens.length > 0) {
      const hay = `${r.layout || ""} ${r.raw_layout || ""}`;
      if (layoutTokens.some((t) => hay.includes(t))) score += 20;
    }
    if (logicTokens.length > 0) {
      const hay = `${r.logic || ""} ${r.diagram_labels || ""}`;
      if (logicTokens.some((t) => hay.includes(t))) score += 20;
    }
    if (r.diagram_family) score += 8;
    if (String(r.raw_visual || "").includes("水印")) score -= 25;

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
      imageCount: imgSlots,
      textSlots: txtSlots,
      resultCount: resSlots,
      hasTable: lg.includes("表"),
      hasChart: /柱|折线|饼|环|图表|条形/.test(lg),
      layoutSummary: r.raw_layout || r.layout || "",
      visualTraits: r.raw_visual || r.visual_traits || "",
      restoreNote: r.restore_note || undefined,
      previewFile,
      feishuFileToken: r.feishu_file_token || undefined,
      matchScore: needsScoring ? score : undefined,
    };
  });

  if (needsScoring) {
    mapped.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  }
  return mapped.slice(0, safeLimit);
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
  if (hasTable !== undefined) {
    clauses.push("has_table = ?");
    params.push(hasTable ? 1 : 0);
  }
  if (hasChart !== undefined) {
    clauses.push("has_chart = ?");
    params.push(hasChart ? 1 : 0);
  }

  const kwTokens = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/)
      : [];
  for (const kw of kwTokens) {
    clauses.push("(deck_title LIKE ? OR layout_summary LIKE ? OR keywords LIKE ? OR style_tags LIKE ?)");
    const pat = `%${kw}%`;
    params.push(pat, pat, pat, pat);
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const sql = `
    SELECT *
    FROM slides
    WHERE ${clauses.join(" AND ")}
    ORDER BY sku ASC, slide_no ASC
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
    tier: r.tier || "vip",
    r2ObjectKey: r.r2_object_key || undefined,
    previewKey: r.preview_key || undefined,
  }));
}
