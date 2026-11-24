// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).

import { existsSync } from "node:fs";
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

/**
 * Queries `yuanmou-slide-index.db` by bidirectional slot fingerprint (`purpose`, `imageCount`, `textSlots`, `keywords`).
 * Works identically for both V1 `ZsxqPlanetProvider` and V2 `YuanmouCloudR2Provider`!
 */
export async function querySlideIndexDb(dbPath, filter = {}, providerId = "zsxq") {
  if (!dbPath || !existsSync(dbPath)) return [];

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
  // Check if `tier` / `group_id` columns exist (backward compatible with v1.0 DBs)
  const sql = `
    SELECT *
    FROM slides
    WHERE ${clauses.join(" AND ")}
    ORDER BY sku ASC, slide_no ASC
    LIMIT ${safeLimit}
  `;

  const db = await openNodeSqlite(dbPath, true);
  let rows = [];
  if (db) {
    try {
      rows = db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  } else {
    // Fallback to system `sqlite3 -json`
    const inlinedSql = sql.replace(/\?/g, () => {
      const v = params.shift();
      if (typeof v === "number") return String(v);
      return `'${String(v ?? "").replace(/'/g, "''")}'`;
    });
    const res = spawnSync("sqlite3", ["-json", dbPath, inlinedSql], { encoding: "utf8" });
    if (res.status === 0 && res.stdout.trim()) {
      rows = JSON.parse(res.stdout);
    }
  }

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
