#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Unified Pluggable Provider CLI (`feishu` | `local` | `yuanmou-cloud` | `zsxq` optional)

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createSourceProvider, resolveActiveSourceProvider } from "../../../packages/pptx-kit/index.mjs";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildSelectionBoardHtml(candidates, outHtmlPath) {
  const cardParts = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let imgHtml = "";
    if (c.localPreviewPath && existsSync(c.localPreviewPath)) {
      const buf = await fs.readFile(c.localPreviewPath);
      const ext = path.extname(c.localPreviewPath).toLowerCase() === ".webp" ? "webp" : "png";
      imgHtml = `<div class="thumb"><img src="data:image/${ext};base64,${buf.toString("base64")}" alt="${escapeHtml(c.contentPageId || c.sku)}" /></div>`;
    }
    const famBadge = c.diagramFamily
      ? `<span class="fam">${escapeHtml(c.diagramFamily)}${c.diagramLabels ? ` · ${escapeHtml(c.diagramLabels)}` : ""}</span>`
      : "";
    cardParts.push(`
      <div class="card ${c.lockedForTrial ? "card-vip" : ""}">
        ${imgHtml}
        <div class="meta">
          <span class="tag">${c.lockedForTrial ? "🔒 VIP 专享" : `#${i + 1} · 可直接复刻`}</span>
          <span class="sku">${escapeHtml(c.contentPageId || c.sku)}</span>
          <span class="purpose">${escapeHtml(c.purpose)}</span>
          ${famBadge}
        </div>
        <h3>${escapeHtml(c.deckTitle || c.contentPageId || c.sku)}</h3>
        <p class="summary">${escapeHtml(c.layoutSummary || "")}</p>
        <div class="slots">
          <span>图槽: ${c.imageCount ?? 0}</span>
          <span>文槽: ${c.textSlots ?? "-"}</span>
          <span>成果: ${c.resultCount ?? 0}</span>
          <span>表格: ${c.hasTable ? "有" : "无"}</span>
          <span>图表: ${c.hasChart ? "有" : "无"}</span>
        </div>
      </div>`);
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>渊眸 PPT Skill · 候选版式确认看板</title>
  <style>
    body { background: #0F172A; color: #F8FAFC; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 32px; margin: 0; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p.lead { color: #94A3B8; font-size: 13.5px; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px; }
    .card { background: #1E293B; border: 1px solid #334155; border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; }
    .thumb { width: 100%; aspect-ratio: 16/9; background: #0B1220; border-radius: 6px; overflow: hidden; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; }
    .thumb img { width: 100%; height: 100%; object-fit: contain; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11.5px; margin-bottom: 8px; }
    .tag { background: #064E3B; color: #6EE7B7; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .sku { background: #1E3A8A; color: #93C5FD; padding: 2px 8px; border-radius: 4px; font-family: ui-monospace, monospace; }
    .purpose { background: #334155; color: #E2E8F0; padding: 2px 8px; border-radius: 4px; }
    .fam { background: #4C1D95; color: #DDD6FE; padding: 2px 8px; border-radius: 4px; }
    h3 { font-size: 15px; margin: 0 0 6px; color: #F1F5F9; }
    .summary { font-size: 12.5px; color: #CBD5E1; margin: 0 0 12px; line-height: 1.5; flex: 1; }
    .slots { display: flex; gap: 12px; font-size: 12px; color: #94A3B8; border-top: 1px solid #334155; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>渊眸策略 · 待排页槽位同构选版看板</h1>
  <p class="lead">共检索到 ${candidates.length} 个候选版式（支持飞书云盘体验仓 / VIP 全量仓 / 本地索引目录）。确认版式编号（CP_xxx）后直接进入 1:1 矢量复刻或母本无损改版。</p>
  <div class="grid">${cardParts.join("\n")}</div>
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
      "page-type": { type: "string" },
      "diagram-family": { type: "string" },
      keywords: { type: "string" },
      "min-images": { type: "string" },
      "max-images": { type: "string" },
      "has-table": { type: "boolean" },
      "has-chart": { type: "boolean" },
      "fetch-previews": { type: "boolean" },
      sku: { type: "string" },
      cid: { type: "string" },
      kind: { type: "string" },
      "file-id": { type: "string" },
      "file-token": { type: "string" },
      "preview-file": { type: "string" },
      "topic-id": { type: "string" },
      limit: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean" },
    },
  });

  const cmd = positionals[0] || "status";
  if (cmd === "login" || cmd === "connect") {
    const target = values.provider || "feishu";
    if (target === "zsxq") {
      console.log("正在拉起知识星球 OAuth 扫码授权（可选外部资料源）...");
      const res = spawnSync("npx", ["-y", "zsxq-cli", "auth", "login"], { stdio: "inherit" });
      process.exit(res.status ?? 0);
    }
    const feishu = createSourceProvider("feishu", { cacheDir: values["cache-dir"] });
    const authRes = await feishu.connect();
    console.log(JSON.stringify(authRes, null, 2));
    return;
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
    const res = await provider.syncSlideIndex({
      force: Boolean(values.force),
      fileId: values["file-id"] || values["file-token"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "search-slides") {
    const filter = {
      purpose: values.purpose,
      pageType: values["page-type"],
      diagramFamily: values["diagram-family"],
      keywords: values.keywords,
      sku: values.sku,
      contentPageId: values.cid,
      minImages: values["min-images"] !== undefined ? Number(values["min-images"]) : undefined,
      maxImages: values["max-images"] !== undefined ? Number(values["max-images"]) : undefined,
      hasTable: values["has-table"],
      hasChart: values["has-chart"],
      limit: values.limit ? Number(values.limit) : 12,
    };
    const items = await provider.searchSlides(filter);
    if (values["fetch-previews"]) {
      for (const item of items) {
        try {
          const asset = await provider.fetchAsset({
            kind: "preview",
            contentPageId: item.contentPageId,
            previewFile: item.previewFile,
            feishuFileToken: item.feishuFileToken,
          });
          item.localPreviewPath = asset.localPath;
        } catch {
          // Leave localPreviewPath unset if token/file unavailable
        }
      }
    }
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
      kind: values.kind || (values["file-token"] || values["preview-file"] ? "preview" : "pptx"),
      sku: values.sku,
      contentPageId: values.cid,
      previewFile: values["preview-file"],
      feishuFileToken: values["file-token"],
      fileId: values["file-id"] || values["file-token"],
      topicId: values["topic-id"],
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  throw new Error(`Unknown subcommand "${cmd}". Expected: connect | status | sync-index | search-slides | search-reports | fetch-asset`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
