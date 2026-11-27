#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Unified Pluggable Provider CLI (`local` Zero-Login Public Trial | `feishu` VIP | `yuanmou-cloud` | `zsxq`)
// Selection Engine 2.0: <0.3s in-memory snapshot batch-search, sibling hardlink 15KB HTML board,
// `--portable` single-file export, `--auto-pick` silent selection, and `deck_blueprint.json` handoff.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  createSourceProvider,
  resolveActiveSourceProvider,
  normalizeArchetype,
  normalizeCapacityTier,
  OFFLINE_PATTERN_HINTS,
} from "../packages/pptx-kit/index.mjs";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(str, maxLen = 54) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aestheticBadgeLabel(tier) {
  if (tier >= 5) return "S";
  if (tier === 4) return "A";
  if (tier === 3) return "B";
  if (tier === 2) return "C";
  return "";
}

/**
 * Pure Node.js zero-dependency sibling asset staging:
 * hardlinks (`fs.link`) preview files into `<boardStem>_assets/` right next to the HTML board
 * (0ms, 0 extra disk bytes on same volume; graceful copy fallback across drives).
 */
async function stageBoardAsset(srcPath, assetsDir, assetsRelDir, preferredName) {
  const ext = path.extname(srcPath).toLowerCase() || ".png";
  const safeName = (preferredName || path.basename(srcPath)).replace(/[^a-zA-Z0-9._-]/g, "_");
  const finalName = safeName.endsWith(ext) ? safeName : `${safeName}${ext}`;
  const destPath = path.join(assetsDir, finalName);

  await fs.mkdir(assetsDir, { recursive: true });
  try {
    if (existsSync(destPath)) {
      await fs.unlink(destPath).catch(() => {});
    }
    await fs.link(srcPath, destPath);
  } catch {
    await fs.copyFile(srcPath, destPath);
  }
  return `./${assetsRelDir}/${encodeURIComponent(finalName)}`;
}

async function fileToDataUrl(filePath) {
  const buf = await fs.readFile(filePath);
  const rawExt = path.extname(filePath).toLowerCase();
  const ext = rawExt === ".webp" ? "webp" : rawExt === ".jpg" || rawExt === ".jpeg" ? "jpeg" : "png";
  return `data:image/${ext};base64,${buf.toString("base64")}`;
}

/**
 * Concurrency-bounded preview downloader: hits local cache first (0 requests),
 * and paces uncached fetches (concurrency=4) to stay safely under public CDN rate limits.
 */
async function fetchPreviewsForItems(provider, items, { concurrency = 4, paceMs = 120 } = {}) {
  let idx = 0;
  let rateLimitErr = null;

  async function worker() {
    while (idx < items.length) {
      if (rateLimitErr) return;
      const cur = items[idx++];
      if (!cur || (cur.localPreviewPath && existsSync(cur.localPreviewPath))) continue;
      try {
        const asset = await provider.fetchAsset({
          kind: "preview",
          contentPageId: cur.contentPageId,
          previewFile: cur.previewFile,
          feishuFileToken: cur.feishuFileToken,
        });
        cur.localPreviewPath = asset.localPath;
        if (!asset.cached && paceMs > 0) {
          await sleep(paceMs);
        }
      } catch (err) {
        if (String(err?.message || "").includes("[RATE_LIMITED]")) {
          rateLimitErr = err;
          return;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);
  if (rateLimitErr) throw rateLimitErr;
}

/**
 * Optional progressive enhancement: generates a labeled contact-sheet JPEG when `python3 + Pillow`
 * is installed locally. Silently degrades (never blocks selection!) on pure-Node environments.
 */
async function maybeBuildContactSheet(sections, outSheetPath) {
  if (!outSheetPath) return { path: null, skipped: null };
  const pyBins = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  let pyBin = null;
  for (const bin of pyBins) {
    const chk = spawnSync(bin, ["-c", "import PIL.Image"], { encoding: "utf8" });
    if (chk.status === 0) {
      pyBin = bin;
      break;
    }
  }
  if (!pyBin) {
    return { path: null, skipped: "pillow-not-available" };
  }

  const tiles = [];
  for (const sec of sections) {
    const cands = sec.candidates || [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (c.localPreviewPath && existsSync(c.localPreviewPath)) {
        tiles.push({
          label: `${sec.pageBadge} #${i + 1} ${c.contentPageId} (${c.archetype || c.diagramFamily || ""})`,
          path: c.localPreviewPath,
        });
      }
    }
  }
  if (tiles.length === 0) {
    return { path: null, skipped: "no-local-previews" };
  }

  const absOut = path.resolve(outSheetPath);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  const pyCode = `
import json, math, sys
from PIL import Image, ImageDraw
cfg = json.loads(sys.stdin.read())
tiles = cfg["tiles"]
out_path = cfg["out"]
cols = min(4, max(1, cfg.get("cols", 3)))
rows = math.ceil(len(tiles) / cols)
tw, th, bar, gap = 480, 270, 28, 14
w = cols * tw + (cols + 1) * gap
h = rows * (th + bar) + (rows + 1) * gap
canvas = Image.new("RGB", (w, h), (15, 23, 42))
draw = ImageDraw.Draw(canvas)
for idx, t in enumerate(tiles):
    r, c = divmod(idx, cols)
    x = gap + c * (tw + gap)
    y = gap + r * (th + bar + gap)
    draw.rectangle([x, y, x + tw, y + bar], fill=(30, 41, 59))
    draw.text((x + 8, y + 7), t["label"][:58], fill=(226, 232, 240))
    try:
        im = Image.open(t["path"]).convert("RGB")
        im.thumbnail((tw, th), Image.Resampling.LANCZOS)
        ox = x + (tw - im.width) // 2
        oy = y + bar + (th - im.height) // 2
        canvas.paste(im, (ox, oy))
    except Exception:
        pass
canvas.save(out_path, quality=86, optimize=True)
`;
  const res = spawnSync(pyBin, ["-c", pyCode], {
    input: JSON.stringify({ tiles, out: absOut, cols: sections.length === 1 ? 3 : Math.min(4, Math.max(2, sections[0]?.candidates?.length || 3)) }),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0 || !existsSync(absOut)) {
    return { path: null, skipped: `contact-sheet-error: ${(res.stderr || "").slice(0, 160)}` };
  }
  return { path: absOut, skipped: null };
}

/**
 * Renders a lightweight, single-select-per-page, cross-browser compatible HTML selection board.
 * Default mode uses zero-copy sibling hardlinks (`<stem>_assets/` -> ~15-25 KB HTML, instant load).
 * Pass `{ portable: true }` for standalone base64-inlined HTML suitable for sending over chat/email.
 */
async function buildMultiPageSelectionBoardHtml(sections, outHtmlPath, options = {}) {
  const abs = path.resolve(outHtmlPath);
  const outDir = path.dirname(abs);
  const stem = path.basename(abs, path.extname(abs));
  const assetsRelDir = `${stem}_assets`;
  const assetsDir = path.join(outDir, assetsRelDir);
  const portable = Boolean(options.portable);
  const defaultChromePolicy = options.chromePolicy || (sections.length <= 1 ? "keep_all" : "auto");

  await fs.mkdir(outDir, { recursive: true });
  const sectionHtmlList = [];

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];
    const pageId = sec.pageId || `p${sIdx + 1}`;
    const pageBadge = sec.pageBadge || `P${sIdx + 1}`;
    const pageTitle = sec.pageTitle || `第 ${sIdx + 1} 页`;
    const brief = sec.brief || "";
    const candidates = sec.candidates || [];
    const fallbackBanner = sec.fallbackRecommended
      ? `<div class="fallback-banner">提示：当前库内高结构匹配偏少，如候选不理想可直接按离线高定语法卡 <code>${escapeHtml(sec.offlinePatternHint || "references/offline-layout-patterns.md")}</code> 原生绘制。</div>`
      : "";

    // Optional left-hand source preview (image or verbatim Markdown)
    let sourceColHtml = "";
    const hasSrcImg = sec.sourceImagePath && existsSync(sec.sourceImagePath);
    const hasSrcMd = Boolean(sec.sourceMarkdown && String(sec.sourceMarkdown).trim());
    if (hasSrcImg || hasSrcMd) {
      let inner = "";
      if (hasSrcImg) {
        const sUrl = portable
          ? await fileToDataUrl(sec.sourceImagePath)
          : await stageBoardAsset(sec.sourceImagePath, assetsDir, assetsRelDir, `src_${pageId}`);
        inner += `<div class="src-img" data-cap="${escapeHtml(pageBadge)} · 原稿参考" onclick="openLightboxFromEl(this)" title="点击放大原稿"><img src="${sUrl}" loading="lazy" alt="原稿" /></div>`;
      }
      if (hasSrcMd) {
        inner += `<pre class="src-md">${escapeHtml(sec.sourceMarkdown)}</pre>`;
      }
      sourceColHtml = `<aside class="src-pane"><div class="src-head">原稿内容（原文保真）</div>${inner}</aside>`;
    }

    const cards = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cid = c.contentPageId || c.sku;
      let imgHtml = `<div class="thumb empty">暂无预览图</div>`;
      if (c.localPreviewPath && existsSync(c.localPreviewPath)) {
        const imgUrl = portable
          ? await fileToDataUrl(c.localPreviewPath)
          : await stageBoardAsset(c.localPreviewPath, assetsDir, assetsRelDir, cid);
        imgHtml = `<div class="thumb" data-cap="${escapeHtml(pageBadge)} · ${escapeHtml(cid)}" onclick="openLightboxFromEl(this)" title="点击放大"><img src="${imgUrl}" loading="lazy" alt="${escapeHtml(cid)}" /></div>`;
      }
      const archTag = c.archetype ? `<span class="chip arch">${escapeHtml(c.archetype)}</span>` : "";
      const tierLabel = aestheticBadgeLabel(c.aestheticTier);
      const tierTag = tierLabel ? `<span class="chip tier-${tierLabel.toLowerCase()}">${tierLabel}级</span>` : "";
      const capTag = c.capacityTier ? `<span class="chip cap">${escapeHtml(c.capacityTier)}</span>` : "";
      const transTag =
        c.transferability === "universal"
          ? `<span class="chip univ">万能骨架</span>`
          : c.transferability === "scene_specific"
            ? `<span class="chip scene">场景专属</span>`
            : "";
      const toneTag = c.toneChrome ? `<span class="chip wb">${escapeHtml(c.toneChrome.split(":")[0] === "dark" ? "暗底" : "浅底")}</span>` : "";
      const reasons =
        Array.isArray(c.matchReasons) && c.matchReasons.length > 0
          ? `<div class="reason-line">${escapeHtml(c.matchReasons.slice(0, 4).join(" · "))}</div>`
          : "";
      const briefLine = truncateText(c.layoutSummary || c.deckTitle || "", 52);
      const slotLine = `图 ${c.imageCount ?? 0} · 文 ${c.textSlots ?? "-"} · 成果 ${c.resultCount ?? 0}${c.hasChart ? " · 图表" : ""}${c.hasTable ? " · 表格" : ""}`;

      cards.push(`
        <div class="card" data-page="${escapeHtml(pageId)}" data-cid="${escapeHtml(cid)}" data-note="${escapeHtml(truncateText(c.deckTitle || cid, 24))}">
          ${imgHtml}
          <div class="card-body">
            <div class="meta-row">
              <span class="chip idx">#${i + 1}</span>
              <span class="chip cid">${escapeHtml(cid)}</span>
              ${tierTag}${archTag}${capTag}${transTag}${toneTag}
            </div>
            ${reasons}
            <p class="brief">${escapeHtml(briefLine)}</p>
            <div class="slot-line">${escapeHtml(slotLine)}</div>
            <button class="pick-btn" type="button" onclick="toggleSelectFromBtn(this)">选此版式</button>
          </div>
        </div>`);
    }

    const bodyLayout = sourceColHtml
      ? `<div class="split-body">${sourceColHtml}<div class="grid">${cards.join("\n")}</div></div>`
      : `<div class="grid">${cards.join("\n")}</div>`;

    const policyTag = sec.copyPolicy === "preserve" ? `<span class="policy-pill preserve">保真少删</span>` : `<span class="policy-pill">文案随版精炼</span>`;
    sectionHtmlList.push(`
      <section class="page-section" id="sec-${escapeHtml(pageId)}" data-page="${escapeHtml(pageId)}" data-label="${escapeHtml(pageBadge)} ${escapeHtml(pageTitle)}">
        <div class="sec-header">
          <div class="sec-left">
            <span class="page-badge">${escapeHtml(pageBadge)}</span>
            <div>
              <h2 class="sec-title">${escapeHtml(pageTitle)} ${policyTag}</h2>
              ${brief ? `<p class="sec-brief">${escapeHtml(truncateText(brief, 110))}</p>` : ""}
            </div>
          </div>
          <span class="sec-status" id="st-${escapeHtml(pageId)}">未选（单选）</span>
        </div>
        ${fallbackBanner}
        ${bodyLayout}
      </section>`);
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>渊眸 PPT Skill · Selection Engine 2.0 选版看板</title>
  <style>
    * { box-sizing: border-box; }
    body { background: #0B1220; color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; padding: 24px 28px 104px; margin: 0; line-height: 1.45; }
    .top-bar { max-width: 1480px; margin: 0 auto 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
    h1 { font-size: 21px; margin: 0 0 6px; font-weight: 700; }
    p.lead { color: #94A3B8; font-size: 13px; margin: 0; }
    .chrome-bar { display: flex; align-items: center; gap: 8px; background: #111C30; border: 1px solid #24324A; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; color: #CBD5E1; }
    .chrome-bar select { background: #0B1220; color: #F8FAFC; border: 1px solid #334155; border-radius: 6px; padding: 4px 8px; font-size: 12.5px; }
    .page-section { max-width: 1480px; margin: 0 auto 28px; background: #111C30; border: 1px solid #24324A; border-top: 4px solid #38BDF8; border-radius: 12px; padding: 18px 20px 22px; }
    .sec-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid #1E2D45; padding-bottom: 14px; margin-bottom: 16px; }
    .sec-left { display: flex; align-items: center; gap: 12px; }
    .page-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 46px; height: 34px; padding: 0 10px; border-radius: 8px; background: #0284C7; color: #FFFFFF; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; }
    .sec-title { font-size: 17px; margin: 0; color: #F8FAFC; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .policy-pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #1E293B; color: #94A3B8; font-weight: 600; }
    .policy-pill.preserve { background: #7C2D12; color: #FDBA74; }
    .sec-brief { font-size: 12.5px; color: #94A3B8; margin: 3px 0 0; }
    .sec-status { font-size: 12.5px; padding: 5px 12px; border-radius: 999px; background: #1E293B; color: #94A3B8; border: 1px solid #334155; font-weight: 600; }
    .sec-status.picked { background: #0C4A6E; color: #7DD3FC; border-color: #38BDF8; }
    .fallback-banner { background: #2E1F0F; border: 1px solid #B45309; color: #FDE68A; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 14px; }
    .split-body { display: grid; grid-template-columns: 280px 1fr; gap: 18px; align-items: start; }
    @media (max-width: 960px) { .split-body { grid-template-columns: 1fr; } }
    .src-pane { background: #0D1627; border: 1px solid #24324A; border-radius: 10px; padding: 12px; }
    .src-head { font-size: 12px; font-weight: 700; color: #7DD3FC; margin-bottom: 8px; }
    .src-img { width: 100%; border-radius: 6px; overflow: hidden; cursor: zoom-in; margin-bottom: 8px; background: #080E1A; }
    .src-img img { width: 100%; display: block; object-fit: contain; }
    .src-md { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; color: #CBD5E1; max-height: 360px; overflow-y: auto; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .card { background: #18253C; border: 2px solid #2A3A55; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: border-color .15s, background .15s; }
    .card.selected { border-color: #38BDF8; background: #162E52; }
    .thumb { width: 100%; aspect-ratio: 16/9; background: #080E1A; display: flex; align-items: center; justify-content: center; cursor: zoom-in; border-bottom: 1px solid #24324A; }
    .thumb.empty { cursor: default; color: #64748B; font-size: 12.5px; }
    .thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .card-body { padding: 11px 13px 13px; display: flex; flex-direction: column; flex: 1; }
    .meta-row { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
    .chip { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .chip.idx { background: #064E3B; color: #6EE7B7; }
    .chip.cid { background: #1E3A8A; color: #93C5FD; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .chip.arch { background: #4C1D95; color: #DDD6FE; }
    .chip.cap { background: #1E293B; color: #CBD5E1; }
    .chip.univ { background: #065F46; color: #A7F3D0; }
    .chip.scene { background: #7C2D12; color: #FED7AA; }
    .chip.tier-s { background: #854D0E; color: #FEF08A; }
    .chip.tier-a { background: #0E7490; color: #CFFAFE; }
    .chip.tier-b, .chip.tier-c { background: #334155; color: #CBD5E1; }
    .chip.wb { background: #334155; color: #F1F5F9; }
    .reason-line { font-size: 11.5px; color: #7DD3FC; margin: 0 0 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .brief { font-size: 12.5px; color: #E2E8F0; margin: 0 0 8px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 36px; }
    .slot-line { font-size: 11.5px; color: #94A3B8; margin: 0 0 10px; }
    .pick-btn { margin-top: auto; width: 100%; padding: 8px 10px; border-radius: 7px; border: 1px solid #475569; background: #0F172A; color: #E2E8F0; font-size: 13px; font-weight: 600; cursor: pointer; }
    .card.selected .pick-btn { background: #0284C7; border-color: #38BDF8; color: #FFFFFF; }
    .footer-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #0F172A; border-top: 1px solid #2A3A55; padding: 13px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; z-index: 50; }
    .status-text { font-size: 13px; color: #CBD5E1; }
    .status-text strong { color: #38BDF8; }
    .copy-btn { padding: 9px 18px; border-radius: 8px; border: none; background: #2563EB; color: #FFFFFF; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .copy-btn:hover { background: #1D4ED8; }
    .lightbox { position: fixed; inset: 0; background: rgba(2, 6, 23, 0.94); display: none; align-items: center; justify-content: center; flex-direction: column; padding: 24px; z-index: 999; cursor: zoom-out; }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 94vw; max-height: 84vh; border-radius: 6px; }
    .lightbox .cap { margin-top: 10px; color: #CBD5E1; font-family: ui-monospace, monospace; font-size: 13px; }
    #fallbackBox { position: fixed; right: 28px; bottom: 68px; width: 380px; max-width: 90vw; background: #1E293B; border: 1px solid #38BDF8; border-radius: 8px; padding: 10px; display: none; z-index: 100; }
    #fallbackBox textarea { width: 100%; height: 110px; background: #0F172A; color: #F8FAFC; border: 1px solid #334155; border-radius: 6px; padding: 8px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div>
      <h1>渊眸策略 · 待排页选版看板（共 ${sections.length} 页 · ${portable ? "单文件便携版" : "极速轻量版"}）</h1>
      <p class="lead">点击图片可放大原图；每页严格单选（默认不选，再次点击取消）。选完后点右下角「一键复制确认回复」发给 Agent。</p>
    </div>
    <div class="chrome-bar">
      <label for="chromePolicy">母版外框策略：</label>
      <select id="chromePolicy">
        <option value="auto"${defaultChromePolicy === "auto" ? " selected" : ""}>自动（多页跨套脱L2强外框统一母版；单页/同套保壳）</option>
        <option value="strip_l2"${defaultChromePolicy === "strip_l2" ? " selected" : ""}>全套极简无外框（必清L1原Logo + 脱L2四周粗框）</option>
        <option value="keep_all"${defaultChromePolicy === "keep_all" ? " selected" : ""}>1:1 忠实保壳（仅清L1原Logo与水印）</option>
      </select>
    </div>
  </div>
  ${sectionHtmlList.join("\n")}

  <div id="fallbackBox">
    <div style="font-size:12px;color:#93C5FD;margin-bottom:6px;display:flex;justify-content:space-between;">
      <span>已生成确认文本（按 Ctrl/Cmd+C 复制）</span>
      <span style="cursor:pointer;color:#94A3B8;" onclick="document.getElementById('fallbackBox').style.display='none'">关闭</span>
    </div>
    <textarea id="fallbackText" readonly></textarea>
  </div>

  <div class="footer-bar">
    <div class="status-text" id="statusText">已选 <strong>0 / ${sections.length}</strong> 页</div>
    <button class="copy-btn" type="button" id="copyBtn" onclick="copySelection()">一键复制确认回复</button>
  </div>

  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <img id="lbImg" src="" alt="" />
    <div class="cap" id="lbCap"></div>
  </div>

  <script>
    var selections = {};
    function findParentByClass(el, cls) {
      var cur = el;
      while (cur && cur.nodeType === 1) {
        if (cur.classList && cur.classList.contains(cls)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    function toggleSelectFromBtn(btn) {
      var card = findParentByClass(btn, "card");
      if (!card) return;
      toggleSelect(card.getAttribute("data-page"), card);
    }
    function toggleSelect(pageId, card) {
      var sec = document.getElementById("sec-" + pageId);
      var stEl = document.getElementById("st-" + pageId);
      var already = card.classList.contains("selected");
      var allCards = sec.querySelectorAll(".card");
      for (var i = 0; i < allCards.length; i++) {
        allCards[i].classList.remove("selected");
        allCards[i].querySelector(".pick-btn").textContent = "选此版式";
      }
      if (already) {
        delete selections[pageId];
        stEl.textContent = "未选（单选）";
        stEl.classList.remove("picked");
      } else {
        card.classList.add("selected");
        card.querySelector(".pick-btn").textContent = "✓ 已选（再点取消）";
        selections[pageId] = { cid: card.getAttribute("data-cid"), note: card.getAttribute("data-note") };
        stEl.textContent = "✓ 已选 " + selections[pageId].cid;
        stEl.classList.add("picked");
      }
      updateFooter();
    }
    function updateFooter() {
      var total = document.querySelectorAll(".page-section").length;
      var count = Object.keys(selections).length;
      document.getElementById("statusText").innerHTML = "已选 <strong>" + count + " / " + total + "</strong> 页";
    }
    function buildReplyText() {
      var chromeSel = document.getElementById("chromePolicy");
      var lines = ["【选版确认】", "母版外框策略：" + (chromeSel ? chromeSel.value : "auto")];
      var secs = document.querySelectorAll(".page-section");
      for (var i = 0; i < secs.length; i++) {
        var pid = secs[i].getAttribute("data-page");
        var label = secs[i].getAttribute("data-label");
        var pick = selections[pid];
        lines.push((i + 1) + ". " + label + "：" + (pick ? (pick.cid + "（" + pick.note + "）") : "未选（再找一批）"));
      }
      return lines.join("\\n");
    }
    function copySelection() {
      var text = buildReplyText();
      var btn = document.getElementById("copyBtn");
      var done = function() {
        btn.textContent = "✓ 已复制";
        setTimeout(function() { btn.textContent = "一键复制确认回复"; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function() { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    }
    function fallbackCopy(text, onDone) {
      var box = document.getElementById("fallbackBox");
      var ta = document.getElementById("fallbackText");
      ta.value = text;
      box.style.display = "block";
      ta.focus();
      ta.select();
      try {
        if (document.execCommand("copy")) onDone();
      } catch (e) {}
    }
    function openLightboxFromEl(el) {
      var img = el.querySelector("img");
      if (!img) return;
      openLightbox(img.src, el.getAttribute("data-cap") || "");
    }
    function openLightbox(src, cap) {
      document.getElementById("lbImg").src = src;
      document.getElementById("lbCap").textContent = cap + "（点击空白关闭）";
      document.getElementById("lightbox").classList.add("open");
    }
    function closeLightbox() {
      document.getElementById("lightbox").classList.remove("open");
    }
  </script>
</body>
</html>`;

  await fs.writeFile(abs, html, "utf8");
  return abs;
}

async function buildSelectionBoardHtml(candidates, outHtmlPath, slideLabel = "当前待排页", options = {}) {
  return buildMultiPageSelectionBoardHtml(
    [{ pageId: "p1", pageBadge: "P1", pageTitle: slideLabel, brief: "", candidates }],
    outHtmlPath,
    options
  );
}

/**
 * Generates compact `deck_blueprint.json` handoff contract bridging Selection Engine 2.0 -> Channel B.
 * Preserves copyPolicy (`distill` vs `preserve`), L1/L2/L3 chrome rules, and offline pattern fallback hints.
 */
function buildDeckBlueprint({ mode, deckMeta = {}, sections = [], chromePolicy = "auto" }) {
  const pickedDeckKeys = new Set();
  for (const sec of sections) {
    const pick = sec.picked || sec.candidates?.[0];
    if (pick?.deckKey) pickedDeckKeys.add(pick.deckKey);
  }
  const isCrossDeckMultiPage = sections.length > 1 && pickedDeckKeys.size > 1;

  const pages = sections.map((sec) => {
    const pick = sec.picked || sec.candidates?.[0] || null;
    const toneChrome = pick?.toneChrome || "light:frameless";
    const chromePart = toneChrome.split(":")[1] || "frameless";
    let chromeAction = "keep_l2_strip_l1";
    if (chromePolicy === "strip_l2") {
      chromeAction = "strip_l2_unify_master";
    } else if (chromePolicy === "keep_all") {
      chromeAction = "keep_l2_strip_l1";
    } else if (isCrossDeckMultiPage && chromePart.includes("bordered")) {
      chromeAction = "strip_l2_unify_master";
    } else if (isCrossDeckMultiPage) {
      chromeAction = "unify_header_footer_strip_l1";
    }

    const reqArch = normalizeArchetype(sec.archetype) || pick?.archetype || "editorial_freeform";
    const fallbackRecommended = Boolean(sec.fallbackRecommended || !pick || pick.fallbackRecommended);

    return {
      pageId: sec.pageId,
      pageBadge: sec.pageBadge,
      pageTitle: sec.pageTitle,
      brief: sec.brief || "",
      archetype: reqArch,
      capacityTier: normalizeCapacityTier(sec.capacityTier) || pick?.capacityTier || "compact",
      copyPolicy: sec.copyPolicy === "preserve" ? "preserve" : "distill",
      tone: sec.tone || toneChrome.split(":")[0] || "light",
      chromeAction,
      chromeRules: {
        L1_alwaysStrip: ["原公司Logo", "品牌水印", "原项目名页眉", "原页码", "保密角标"],
        L2_shellAction:
          chromeAction === "strip_l2_unify_master"
            ? "脱除原参考页四周异质粗外框，套用全套统一母版安全区与标题体系"
            : chromeAction === "unify_header_footer_strip_l1"
              ? "保留原版精致细线呼吸感，仅统一页眉/页脚/色板基准线"
              : "1:1忠实保留原版外框与饰条，仅清理L1原品牌污染",
        L3_protectedSkeleton: "100%保留内容区承重分割线、屋顶支柱、时间轴主干、卡片强调色条与图表轴线（允许统一换色）",
      },
      refContentPageId: pick?.contentPageId || null,
      refPreviewPath: pick?.localPreviewPath || null,
      toneChrome,
      aestheticTier: pick?.aestheticTier ?? null,
      transferability: pick?.transferability || null,
      matchScore: pick?.matchScore ?? null,
      layoutSummary: pick?.layoutSummary || "",
      restoreNote: pick?.restoreNote || null,
      fallbackRecommended,
      offlinePatternHint: fallbackRecommended
        ? pick?.offlinePatternHint || OFFLINE_PATTERN_HINTS[reqArch] || OFFLINE_PATTERN_HINTS.editorial_freeform
        : null,
    };
  });

  return {
    schemaVersion: "deck_blueprint_v2",
    generatedAt: new Date().toISOString(),
    providerMode: mode,
    deckTokens: {
      title: deckMeta.title || "",
      deliveryMode: deckMeta.deliveryMode || "reading",
      coverTone: deckMeta.coverTone || "auto",
      bodyTone: deckMeta.bodyTone || "light",
      chromePolicy,
      isCrossDeckMultiPage,
      defaultCopyPolicy: deckMeta.copyPolicy || "distill",
    },
    pageCount: pages.length,
    pages,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const cur = rawArgs[i];
    const next = rawArgs[i + 1];
    if (cur.startsWith("--") && !cur.includes("=") && next !== undefined && /^-\d+(\.\d+)?$/.test(next)) {
      normalizedArgs.push(`${cur}=${next}`);
      i++;
    } else {
      normalizedArgs.push(cur);
    }
  }

  const { values, positionals } = parseArgs({
    args: normalizedArgs,
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      "cache-dir": { type: "string" },
      purpose: { type: "string" },
      topic: { type: "string" },
      "page-type": { type: "string" },
      "include-non-body": { type: "boolean" },
      "diagram-family": { type: "string" },
      archetype: { type: "string" },
      capacity: { type: "string" },
      "copy-policy": { type: "string" },
      tone: { type: "string" },
      "cross-domain": { type: "boolean" },
      "exclude-keywords": { type: "string" },
      blacklist: { type: "string" },
      "target-images": { type: "string" },
      "target-text-slots": { type: "string" },
      "target-results": { type: "string" },
      stages: { type: "string" },
      "white-background": { type: "boolean" },
      "mature-case": { type: "boolean" },
      "max-per-deck": { type: "string" },
      layout: { type: "string" },
      logic: { type: "string" },
      exclude: { type: "string" },
      keywords: { type: "string" },
      "min-images": { type: "string" },
      "max-images": { type: "string" },
      "has-table": { type: "boolean" },
      "has-chart": { type: "boolean" },
      "fetch-previews": { type: "boolean" },
      portable: { type: "boolean" },
      "auto-pick": { type: "boolean" },
      blueprint: { type: "string" },
      "contact-sheet": { type: "string" },
      "chrome-policy": { type: "string" },
      "slide-label": { type: "string" },
      plan: { type: "string" },
      picks: { type: "string" },
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
      console.log("正在拉起知识星球 OAuth 扫码授权（可选遗留资料源）...");
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
    const t0 = performance.now();
    const filter = {
      purpose: values.purpose,
      topic: values.topic,
      pageType: values["page-type"],
      includeNonBody: Boolean(values["include-non-body"]),
      diagramFamily: values["diagram-family"],
      archetype: values.archetype,
      capacityTier: values.capacity,
      copyPolicy: values["copy-policy"] || "distill",
      tone: values.tone,
      crossDomain: Boolean(values["cross-domain"]),
      excludeKeywords: values["exclude-keywords"],
      blacklistPath: values.blacklist,
      targetImages: values["target-images"] !== undefined ? Number(values["target-images"]) : undefined,
      targetTextSlots: values["target-text-slots"] !== undefined ? Number(values["target-text-slots"]) : undefined,
      targetResults: values["target-results"] !== undefined ? Number(values["target-results"]) : undefined,
      stages: values.stages !== undefined ? Number(values.stages) : undefined,
      whiteBackground: values["white-background"] ? true : undefined,
      matureCase: values["mature-case"] ? true : undefined,
      maxPerDeck: values["max-per-deck"] !== undefined ? Number(values["max-per-deck"]) : 3,
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
    const searchMs = Number((performance.now() - t0).toFixed(1));
    if (values["fetch-previews"] || values.out || values["contact-sheet"]) {
      await fetchPreviewsForItems(provider, items);
    }
    let boardPath = null;
    if (values.out) {
      boardPath = await buildSelectionBoardHtml(items, values.out, values["slide-label"] || "当前待排页", {
        portable: Boolean(values.portable),
        chromePolicy: values["chrome-policy"] || "keep_all",
      });
    }
    const sheet = await maybeBuildContactSheet(
      [{ pageId: "p1", pageBadge: "P1", pageTitle: values["slide-label"] || "当前待排页", candidates: items }],
      values["contact-sheet"]
    );
    console.log(
      JSON.stringify(
        {
          mode,
          searchMs,
          count: items.length,
          selectionBoardHtml: boardPath,
          contactSheet: sheet.path,
          contactSheetSkipped: sheet.skipped || undefined,
          items,
        },
        null,
        2
      )
    );
    return;
  }

  // One-shot multi-page search + adjacent anti-collision + dual-speed (`--auto-pick` / interactive 15KB board) + `deck_blueprint.json`
  if (cmd === "batch-search") {
    if (!values.plan) {
      throw new Error(
        "batch-search requires --plan <pages.json> [--fetch-previews] [--out <selection_board.html>] [--auto-pick] [--blueprint <deck_blueprint.json>]"
      );
    }
    const raw = JSON.parse(await fs.readFile(path.resolve(values.plan), "utf8"));
    const deckMeta = Array.isArray(raw) ? {} : (raw.deck || raw.meta || {});
    const pageSpecs = Array.isArray(raw) ? raw : (raw.pages || raw.sections || []);
    const autoPick = Boolean(values["auto-pick"]);
    const defaultLimit = values.limit ? Number(values.limit) : autoPick ? 1 : 3;
    const chromePolicy = values["chrome-policy"] || deckMeta.chromePolicy || (pageSpecs.length <= 1 ? "keep_all" : "auto");
    const globalExclude = new Set();
    const sections = [];
    const previewQueue = [];
    let prevTopLayoutSig = null;

    const t0 = performance.now();
    for (let i = 0; i < pageSpecs.length; i++) {
      const spec = pageSpecs[i];
      const specFilter = spec.filter || spec;
      const mergedExclude = [
        ...(Array.isArray(specFilter.exclude) ? specFilter.exclude : specFilter.exclude ? [specFilter.exclude] : []),
        ...(spec.uniqueAcrossPages !== false ? [...globalExclude] : []),
      ];
      const isCover = specFilter.pageType && String(specFilter.pageType).includes("封面");
      const pageTone =
        specFilter.tone ||
        (isCover ? deckMeta.coverTone : deckMeta.bodyTone) ||
        values.tone;
      const pageCopyPolicy = specFilter.copyPolicy || spec.copyPolicy || deckMeta.copyPolicy || values["copy-policy"] || "distill";
      const pageCrossDomain =
        specFilter.crossDomain !== undefined
          ? Boolean(specFilter.crossDomain)
          : deckMeta.crossDomain !== undefined
            ? Boolean(deckMeta.crossDomain)
            : Boolean(values["cross-domain"]);

      const items = await provider.searchSlides({
        purpose: specFilter.purpose,
        topic: specFilter.topic ?? deckMeta.topic,
        pageType: specFilter.pageType,
        includeNonBody: Boolean(specFilter.includeNonBody),
        diagramFamily: specFilter.diagramFamily,
        archetype: specFilter.archetype || spec.archetype,
        capacityTier: specFilter.capacityTier || spec.capacityTier,
        copyPolicy: pageCopyPolicy,
        tone: pageTone,
        crossDomain: pageCrossDomain,
        allowSceneSpecific: specFilter.allowSceneSpecific ?? deckMeta.allowSceneSpecific,
        excludeKeywords: specFilter.excludeKeywords ?? deckMeta.excludeKeywords ?? values["exclude-keywords"],
        blacklistPath: values.blacklist || deckMeta.blacklistPath,
        avoidLayouts: prevTopLayoutSig ? [prevTopLayoutSig] : undefined,
        cleanChromeBias: pageSpecs.length > 1 && chromePolicy !== "keep_all",
        targetImages: specFilter.targetImages,
        targetTextSlots: specFilter.targetTextSlots,
        targetResults: specFilter.targetResults,
        stages: specFilter.stages,
        whiteBackground: specFilter.whiteBackground,
        matureCase: specFilter.matureCase,
        maxPerDeck: specFilter.maxPerDeck ?? 2,
        layout: specFilter.layout,
        logic: specFilter.logic,
        exclude: mergedExclude,
        keywords: specFilter.keywords,
        minImages: specFilter.minImages,
        maxImages: specFilter.maxImages,
        hasTable: specFilter.hasTable,
        hasChart: specFilter.hasChart,
        limit: autoPick ? 1 : (specFilter.limit || defaultLimit),
      });

      const picked = items[0] || null;
      if (picked?.layoutSignature) prevTopLayoutSig = picked.layoutSignature;

      for (const it of items) {
        if (it.contentPageId) globalExclude.add(it.contentPageId);
        previewQueue.push(it);
      }
      sections.push({
        pageId: spec.pageId || `p${i + 1}`,
        pageBadge: spec.pageBadge || `P${i + 1}`,
        pageTitle: spec.pageTitle || `第 ${i + 1} 页`,
        brief: spec.brief || "",
        archetype: specFilter.archetype || spec.archetype,
        capacityTier: specFilter.capacityTier || spec.capacityTier,
        copyPolicy: pageCopyPolicy,
        tone: pageTone,
        sourceImagePath: spec.sourceImagePath,
        sourceMarkdown: spec.sourceMarkdown,
        fallbackRecommended: Boolean(items.length === 0 || items[0]?.fallbackRecommended),
        offlinePatternHint:
          items[0]?.offlinePatternHint ||
          OFFLINE_PATTERN_HINTS[normalizeArchetype(specFilter.archetype || spec.archetype) || "editorial_freeform"],
        picked: autoPick ? picked : null,
        candidates: items,
      });
    }
    const searchMs = Number((performance.now() - t0).toFixed(1));

    if (values["fetch-previews"] || values.out || values["contact-sheet"] || autoPick) {
      await fetchPreviewsForItems(provider, previewQueue, { concurrency: 4, paceMs: 120 });
    }
    let boardPath = null;
    if (values.out) {
      boardPath = await buildMultiPageSelectionBoardHtml(sections, values.out, {
        portable: Boolean(values.portable),
        chromePolicy,
      });
    }
    const sheet = await maybeBuildContactSheet(sections, values["contact-sheet"]);

    let blueprintPath = null;
    if (values.blueprint || autoPick) {
      const bp = buildDeckBlueprint({ mode, deckMeta, sections, chromePolicy });
      if (values.blueprint) {
        blueprintPath = path.resolve(values.blueprint);
        await fs.mkdir(path.dirname(blueprintPath), { recursive: true });
        await fs.writeFile(blueprintPath, `${JSON.stringify(bp, null, 2)}\n`, "utf8");
      }
    }

    console.log(
      JSON.stringify(
        {
          mode,
          autoPick,
          searchMs,
          pages: sections.length,
          totalCandidates: previewQueue.length,
          selectionBoardHtml: boardPath,
          deckBlueprintJson: blueprintPath,
          contactSheet: sheet.path,
          contactSheetSkipped: sheet.skipped || undefined,
          sections: sections.map((s) => ({
            pageId: s.pageId,
            pageBadge: s.pageBadge,
            pageTitle: s.pageTitle,
            copyPolicy: s.copyPolicy,
            fallbackRecommended: s.fallbackRecommended || undefined,
            offlinePatternHint: s.fallbackRecommended ? s.offlinePatternHint : undefined,
            pickedContentPageId: s.picked?.contentPageId || undefined,
            candidates: s.candidates.map((c) => ({
              contentPageId: c.contentPageId,
              archetype: c.archetype,
              capacityTier: c.capacityTier,
              transferability: c.transferability,
              aestheticTier: c.aestheticTier,
              toneChrome: c.toneChrome,
              diagramFamily: c.diagramFamily,
              matchScore: c.matchScore,
              matchReasons: c.matchReasons,
              layoutSummary: c.layoutSummary,
              restoreNote: c.restoreNote,
              localPreviewPath: c.localPreviewPath,
            })),
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "build-blueprint") {
    if (!values.plan || !values.out) {
      throw new Error("build-blueprint requires --plan <pages.json> --out <deck_blueprint.json> [--picks <picks.json>]");
    }
    const rawPlan = JSON.parse(await fs.readFile(path.resolve(values.plan), "utf8"));
    const deckMeta = Array.isArray(rawPlan) ? {} : (rawPlan.deck || rawPlan.meta || {});
    const pageSpecs = Array.isArray(rawPlan) ? rawPlan : (rawPlan.pages || rawPlan.sections || []);
    const picksMap = values.picks ? JSON.parse(await fs.readFile(path.resolve(values.picks), "utf8")) : {};
    const chromePolicy = values["chrome-policy"] || picksMap.chromePolicy || deckMeta.chromePolicy || "auto";

    const sections = [];
    const toFetch = [];
    for (let i = 0; i < pageSpecs.length; i++) {
      const spec = pageSpecs[i];
      const pid = spec.pageId || `p${i + 1}`;
      const pickedCid = spec.pickedContentPageId || picksMap[pid] || picksMap.picks?.[pid] || null;
      let picked = null;
      if (pickedCid) {
        const hits = await provider.searchSlides({ contentPageId: pickedCid, includeNonBody: true, limit: 1 });
        picked = hits[0] || { contentPageId: pickedCid, previewFile: `${pickedCid}.png` };
        toFetch.push(picked);
      }
      sections.push({
        pageId: pid,
        pageBadge: spec.pageBadge || `P${i + 1}`,
        pageTitle: spec.pageTitle || `第 ${i + 1} 页`,
        brief: spec.brief || "",
        archetype: spec.archetype || spec.filter?.archetype,
        capacityTier: spec.capacityTier || spec.filter?.capacityTier,
        copyPolicy: spec.copyPolicy || spec.filter?.copyPolicy || deckMeta.copyPolicy || "distill",
        tone: spec.tone || spec.filter?.tone || deckMeta.bodyTone,
        picked,
        candidates: picked ? [picked] : [],
      });
    }
    if (values["fetch-previews"] && toFetch.length > 0) {
      await fetchPreviewsForItems(provider, toFetch, { concurrency: 4, paceMs: 120 });
    }
    const bp = buildDeckBlueprint({ mode, deckMeta, sections, chromePolicy });
    const absOut = path.resolve(values.out);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, `${JSON.stringify(bp, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ mode, deckBlueprintJson: absOut, pageCount: bp.pageCount }, null, 2));
    return;
  }

  if (cmd === "build-board") {
    if (!values.plan || !values.out) {
      throw new Error("build-board requires --plan <board_plan.json> --out <selection_board.html>");
    }
    const raw = JSON.parse(await fs.readFile(path.resolve(values.plan), "utf8"));
    const sections = Array.isArray(raw) ? raw : (raw.sections || []);
    if (values["fetch-previews"]) {
      const flat = sections.flatMap((s) => s.candidates || []);
      await fetchPreviewsForItems(provider, flat, { concurrency: 4, paceMs: 120 });
    }
    const boardPath = await buildMultiPageSelectionBoardHtml(sections, values.out, {
      portable: Boolean(values.portable),
      chromePolicy: values["chrome-policy"] || "auto",
    });
    console.log(JSON.stringify({ mode, sections: sections.length, selectionBoardHtml: boardPath }, null, 2));
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

  throw new Error(
    `Unknown subcommand "${cmd}". Expected: connect | status | sync-index | search-slides | batch-search | build-blueprint | build-board | search-reports | fetch-asset`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
