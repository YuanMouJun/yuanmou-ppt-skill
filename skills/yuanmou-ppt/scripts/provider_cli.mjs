#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Unified Pluggable Provider CLI (`local` Zero-Login Public Trial | `feishu` VIP | `yuanmou-cloud` | `zsxq`)

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

async function buildSelectionBoardHtml(candidates, outHtmlPath, slideLabel = "当前待排页") {
  const cardParts = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cid = c.contentPageId || c.sku;
    let imgHtml = `<div class="thumb empty">暂无预览图</div>`;
    if (c.localPreviewPath && existsSync(c.localPreviewPath)) {
      const buf = await fs.readFile(c.localPreviewPath);
      const ext = path.extname(c.localPreviewPath).toLowerCase() === ".webp" ? "webp" : "png";
      const dataUrl = `data:image/${ext};base64,${buf.toString("base64")}`;
      imgHtml = `<div class="thumb" onclick="openLightbox(this.querySelector('img').src, '${escapeHtml(cid)}')" title="点击放大查看高清原图"><img src="${dataUrl}" alt="${escapeHtml(cid)}" /></div>`;
    }
    const famBadge = c.diagramFamily
      ? `<span class="fam">${escapeHtml(c.diagramFamily)}${c.diagramLabels ? ` · ${escapeHtml(c.diagramLabels)}` : ""}</span>`
      : "";
    const scoreBadge = c.matchScore !== undefined ? `<span class="score">匹配分 ${c.matchScore}</span>` : "";
    cardParts.push(`
      <div class="card" data-cid="${escapeHtml(cid)}" data-title="${escapeHtml(c.deckTitle || cid)}">
        ${imgHtml}
        <div class="meta">
          <span class="tag">#${i + 1}</span>
          <span class="sku">${escapeHtml(cid)}</span>
          <span class="purpose">${escapeHtml(c.purpose)}</span>
          ${famBadge}
          ${scoreBadge}
        </div>
        <h3>${escapeHtml(c.deckTitle || cid)}</h3>
        <p class="summary">${escapeHtml(c.layoutSummary || "")}</p>
        <div class="slots">
          <span>图槽: ${c.imageCount ?? 0}</span>
          <span>文槽: ${c.textSlots ?? "-"}</span>
          <span>成果: ${c.resultCount ?? 0}</span>
          <span>表格: ${c.hasTable ? "有" : "无"}</span>
          <span>图表: ${c.hasChart ? "有" : "无"}</span>
        </div>
        <button class="pick-btn" type="button" onclick="toggleSelect(this.closest('.card'))">选择此版式（单选）</button>
      </div>`);
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>渊眸 PPT Skill · 交互式单选选版看板</title>
  <style>
    * { box-sizing: border-box; }
    body { background: #0F172A; color: #F8FAFC; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 28px 32px 96px; margin: 0; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p.lead { color: #94A3B8; font-size: 13.5px; margin: 0 0 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 18px; }
    .card { background: #1E293B; border: 2px solid #334155; border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; transition: border-color .15s, box-shadow .15s; }
    .card.selected { border-color: #38BDF8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25); background: #172554; }
    .thumb { width: 100%; aspect-ratio: 16/9; background: #0B1220; border-radius: 8px; overflow: hidden; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; cursor: zoom-in; }
    .thumb.empty { cursor: default; color: #64748B; font-size: 13px; }
    .thumb img { width: 100%; height: 100%; object-fit: contain; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11.5px; margin-bottom: 8px; }
    .tag { background: #064E3B; color: #6EE7B7; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .sku { background: #1E3A8A; color: #93C5FD; padding: 2px 8px; border-radius: 4px; font-family: ui-monospace, monospace; }
    .purpose { background: #334155; color: #E2E8F0; padding: 2px 8px; border-radius: 4px; }
    .fam { background: #4C1D95; color: #DDD6FE; padding: 2px 8px; border-radius: 4px; }
    .score { background: #78350F; color: #FDE68A; padding: 2px 8px; border-radius: 4px; }
    h3 { font-size: 15px; margin: 0 0 6px; color: #F1F5F9; }
    .summary { font-size: 12.5px; color: #CBD5E1; margin: 0 0 12px; line-height: 1.5; flex: 1; }
    .slots { display: flex; gap: 12px; font-size: 12px; color: #94A3B8; border-top: 1px solid #334155; padding-top: 10px; margin-bottom: 12px; }
    .pick-btn { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid #475569; background: #0F172A; color: #E2E8F0; font-size: 13px; font-weight: 600; cursor: pointer; }
    .card.selected .pick-btn { background: #0284C7; border-color: #38BDF8; color: #FFFFFF; }
    .footer-bar { position: fixed; left: 0; right: 0; bottom: 0; background: rgba(15, 23, 42, 0.96); border-top: 1px solid #334155; padding: 14px 32px; display: flex; align-items: center; justify-content: space-between; gap: 16px; backdrop-filter: blur(8px); }
    .status-text { font-size: 13.5px; color: #CBD5E1; }
    .status-text strong { color: #38BDF8; }
    .copy-btn { padding: 10px 20px; border-radius: 8px; border: none; background: #2563EB; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer; }
    .copy-btn:hover { background: #1D4ED8; }
    .lightbox { position: fixed; inset: 0; background: rgba(2, 6, 23, 0.92); display: none; align-items: center; justify-content: center; flex-direction: column; padding: 24px; z-index: 999; cursor: zoom-out; }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 94vw; max-height: 84vh; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
    .lightbox .cap { margin-top: 12px; color: #CBD5E1; font-family: ui-monospace, monospace; font-size: 13px; }
  </style>
</head>
<body>
  <h1>渊眸策略 · 待排页槽位同构选版看板（${escapeHtml(slideLabel)}）</h1>
  <p class="lead">共检索到 ${candidates.length} 个候选版式（点击图片可放大查看高清原图；默认不勾选，严格单选，再次点击可取消）。选完后点击底部「一键复制确认回复」发给 Agent。</p>
  <div class="grid">${cardParts.join("\n")}</div>

  <div class="footer-bar">
    <div class="status-text" id="statusText">当前选择：<strong>未选（再找一批）</strong></div>
    <button class="copy-btn" type="button" id="copyBtn" onclick="copySelection()">一键复制确认回复</button>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <img id="lbImg" src="" alt="" />
    <div class="cap" id="lbCap"></div>
  </div>

  <script>
    let selectedCard = null;
    function toggleSelect(card) {
      if (selectedCard === card) {
        card.classList.remove("selected");
        card.querySelector(".pick-btn").textContent = "选择此版式（单选）";
        selectedCard = null;
      } else {
        // Strict single-select: clear any previously selected card
        document.querySelectorAll(".card.selected").forEach((el) => {
          el.classList.remove("selected");
          el.querySelector(".pick-btn").textContent = "选择此版式（单选）";
        });
        card.classList.add("selected");
        card.querySelector(".pick-btn").textContent = "✓ 已选中（再次点击可取消）";
        selectedCard = card;
      }
      updateStatus();
    }
    function updateStatus() {
      const st = document.getElementById("statusText");
      if (!selectedCard) {
        st.innerHTML = '当前选择：<strong>未选（再找一批）</strong>';
      } else {
        const cid = selectedCard.dataset.cid;
        const title = selectedCard.dataset.title;
        st.innerHTML = '当前选择：<strong>' + cid + '</strong>（' + title + '）';
      }
    }
    function copySelection() {
      const text = selectedCard
        ? "【选版确认】\\n${escapeHtml(slideLabel)}：" + selectedCard.dataset.cid + "（" + selectedCard.dataset.title + "）"
        : "【选版确认】\\n${escapeHtml(slideLabel)}：未选（再找一批）";
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("copyBtn");
        btn.textContent = "✓ 已复制到剪贴板";
        setTimeout(() => { btn.textContent = "一键复制确认回复"; }, 1800);
      });
    }
    function openLightbox(src, cap) {
      document.getElementById("lbImg").src = src;
      document.getElementById("lbCap").textContent = cap + "（点击空白处关闭）";
      document.getElementById("lightbox").classList.add("open");
    }
    function closeLightbox() {
      document.getElementById("lightbox").classList.remove("open");
    }
  </script>
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
      "target-images": { type: "string" },
      "target-text-slots": { type: "string" },
      "target-results": { type: "string" },
      layout: { type: "string" },
      logic: { type: "string" },
      exclude: { type: "string" },
      keywords: { type: "string" },
      "min-images": { type: "string" },
      "max-images": { type: "string" },
      "has-table": { type: "boolean" },
      "has-chart": { type: "boolean" },
      "fetch-previews": { type: "boolean" },
      "slide-label": { type: "string" },
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
      targetImages: values["target-images"] !== undefined ? Number(values["target-images"]) : undefined,
      targetTextSlots: values["target-text-slots"] !== undefined ? Number(values["target-text-slots"]) : undefined,
      targetResults: values["target-results"] !== undefined ? Number(values["target-results"]) : undefined,
      layout: values.layout,
      logic: values.logic,
      exclude: values.exclude,
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
      boardPath = await buildSelectionBoardHtml(items, values.out, values["slide-label"] || "当前待排页");
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
