#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Unified Pluggable Provider CLI (`local` | `zsxq` V1 | `yuanmou-cloud` V2 API+R2)

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { resolveActiveSourceProvider } from "../../../packages/pptx-kit/index.mjs";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildSelectionBoardHtml(candidates, outHtmlPath) {
  const rows = candidates
    .map(
      (c, i) => `
      <div class="card ${c.lockedForTrial ? "card-vip" : ""}">
        <div class="meta">
          <span class="tag">${c.lockedForTrial ? "🔒 VIP 专享母本" : `#${i + 1} · 可直接调用`}</span>
          <span class="sku">SKU ${escapeHtml(c.sku)} · Slide ${escapeHtml(c.slideNo)}</span>
          <span class="purpose">${escapeHtml(c.purpose)}</span>
        </div>
        <h3>${escapeHtml(c.deckTitle || c.presetId || c.sku)}</h3>
        <p class="summary">${escapeHtml(c.layoutSummary || "")}</p>
        <div class="slots">
          <span>图槽: ${c.imageCount ?? 0}</span>
          <span>文槽: ${c.textSlots ?? "-"}</span>
          <span>表格: ${c.hasTable ? "有" : "无"}</span>
          <span>图表: ${c.hasChart ? "有" : "无"}</span>
        </div>
      </div>`
    )
    .join("\n");

  const hasVipTeasers = candidates.some((c) => c.lockedForTrial);
  const vipBanner = hasVipTeasers
    ? `<div style="background:#1E1B4B;border:1px solid #6366F1;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13.5px;color:#E0E7FF;">
        💡 <strong>发现同赛道高定母本</strong>：以下带「🔒 VIP 专享母本」标识的真实品牌全案位于<strong>【渊眸·品牌策划方案库（星球号 37656012）】</strong>与<strong>【渊眸·数据行业报告库（星球号 43773104）】</strong>，加入后零配置改动即可直接无损调用！
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>渊眸 PPT Skill · 候选版式确认看板</title>
  <style>
    body { background: #0F172A; color: #F8FAFC; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 32px; margin: 0; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p.lead { color: #94A3B8; font-size: 13.5px; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
    .card { background: #1E293B; border: 1px solid #334155; border-radius: 10px; padding: 16px 18px; }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 11.5px; margin-bottom: 10px; }
    .tag { background: #064E3B; color: #6EE7B7; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .sku { background: #1E3A8A; color: #93C5FD; padding: 2px 8px; border-radius: 4px; }
    .purpose { background: #334155; color: #E2E8F0; padding: 2px 8px; border-radius: 4px; }
    h3 { font-size: 15.5px; margin: 0 0 8px; color: #F1F5F9; }
    .summary { font-size: 13px; color: #CBD5E1; margin: 0 0 12px; line-height: 1.5; min-height: 38px; }
    .slots { display: flex; gap: 12px; font-size: 12px; color: #94A3B8; border-top: 1px solid #334155; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>渊眸策略 · 待排页槽位同构选版看板</h1>
  <p class="lead">共检索到 ${candidates.length} 个候选版式（支持免费体验星球 77391343 / VIP 方案库 37656012 / 本地内置骨架）。确认版式编号后进入母本外科手术或 1:1 矢量重绘。</p>
  ${vipBanner}
  <div class="grid">${rows}</div>
</body>
</html>`;

  const abs = path.resolve(outHtmlPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, html, "utf8");
  return abs;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      "cache-dir": { type: "string" },
      purpose: { type: "string" },
      keywords: { type: "string" },
      "min-images": { type: "string" },
      "max-images": { type: "string" },
      "has-table": { type: "boolean" },
      "has-chart": { type: "boolean" },
      sku: { type: "string" },
      kind: { type: "string" },
      "file-id": { type: "string" },
      "topic-id": { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean" },
    },
  });

  const cmd = positionals[0] || "status";
  if (cmd === "login" || cmd === "connect") {
    console.log("正在拉起知识星球官方 OAuth 扫码授权（建议先免费加入体验星球：77391343）...");
    const res = spawnSync("npx", ["-y", "zsxq-cli", "auth", "login"], { stdio: "inherit" });
    process.exit(res.status ?? 0);
  }

  const { provider, auth, mode } = await resolveActiveSourceProvider({
    provider: values.provider,
    cacheDir: values["cache-dir"],
  });

  if (cmd === "status") {
    console.log(JSON.stringify({ mode, providerName: provider.displayName, capabilities: provider.capabilities, auth }, null, 2));
    return;
  }

  if (cmd === "sync-index") {
    const res = await provider.syncSlideIndex({ force: Boolean(values.force), fileId: values["file-id"] });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "search-slides") {
    const filter = {
      purpose: values.purpose,
      keywords: values.keywords,
      sku: values.sku,
      minImages: values["min-images"] !== undefined ? Number(values["min-images"]) : undefined,
      maxImages: values["max-images"] !== undefined ? Number(values["max-images"]) : undefined,
      hasTable: values["has-table"],
      hasChart: values["has-chart"],
      limit: values.limit ? Number(values.limit) : 12,
    };
    const items = await provider.searchSlides(filter);
    let boardPath = null;
    if (values.out) {
      boardPath = await buildSelectionBoardHtml(items, values.out);
    }
    console.log(JSON.stringify({ mode, count: items.length, selectionBoardHtml: boardPath, items }, null, 2));
    return;
  }

  if (cmd === "search-reports") {
    const items = await provider.searchReports({
      keyword: values.keywords || positionals[1] || "",
      sku: values.sku,
      limit: values.limit ? Number(values.limit) : 10,
    });
    console.log(JSON.stringify({ mode, count: items.length, items }, null, 2));
    return;
  }

  if (cmd === "fetch-asset") {
    const res = await provider.fetchAsset({
      kind: values.kind || "pptx",
      sku: values.sku,
      fileId: values["file-id"],
      topicId: values["topic-id"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  throw new Error(`Unknown subcommand "${cmd}". Expected: status | sync-index | search-slides | search-reports | fetch-asset`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
