// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import path from "node:path";
import { Presentation } from "./presentation.mjs";
import { encodeRgbaPng } from "./brush-mask.mjs";

/**
 * Parses a 1-based page selection spec like `"1-8,13,42,56"` into an ordered, deduplicated list of page numbers.
 */
export function parsePageSelectionSpec(spec, maxPages = Infinity) {
  if (!spec || typeof spec !== "string") {
    const cap = Number.isFinite(maxPages) ? Math.min(maxPages, 20) : 1;
    return Array.from({ length: Math.max(1, cap) }, (_, i) => i + 1);
  }
  const seen = new Set();
  const out = [];
  for (const rawTok of spec.split(/[,;\s]+/)) {
    const tok = rawTok.trim();
    if (!tok) continue;
    const rangeM = tok.match(/^(\d+)\s*[-–—~]\s*(\d+)$/);
    if (rangeM) {
      const start = Number.parseInt(rangeM[1], 10);
      const end = Number.parseInt(rangeM[2], 10);
      const step = start <= end ? 1 : -1;
      for (let p = start; step > 0 ? p <= end : p >= end; p += step) {
        if (p >= 1 && p <= maxPages && !seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    } else if (/^\d+$/.test(tok)) {
      const p = Number.parseInt(tok, 10);
      if (p >= 1 && p <= maxPages && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    } else {
      throw new Error(`Invalid page selection token "${tok}". Expected e.g. "1-8,13,42,56".`);
    }
  }
  if (out.length === 0) {
    throw new Error(`Page selection "${spec}" matched 0 pages (valid range: 1..${maxPages}).`);
  }
  return out;
}

const NEUTRAL_CJK_CYCLE = "文字占位示例版式标题内容要点说明核心主题结构";

/**
 * Converts business text into a same-length, same-script, zero-business-leak neutral placeholder string
 * preserving punctuation, line breaks, and character density for Phase-1 master X-Ray verification.
 */
export function toNeutralPlaceholderText(rawText) {
  const src = String(rawText || "");
  if (!src.trim()) return src;
  let cjkIdx = 0;
  let out = "";
  for (const ch of src) {
    const code = ch.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) {
      out += NEUTRAL_CJK_CYCLE[cjkIdx % NEUTRAL_CJK_CYCLE.length];
      cjkIdx++;
    } else if (code >= 0x41 && code <= 0x5a) {
      out += "T";
    } else if (code >= 0x61 && code <= 0x7a) {
      out += "x";
    } else if (code >= 0x30 && code <= 0x39) {
      out += "0";
    } else {
      out += ch;
    }
  }
  return out;
}

function blendPixelRgba(rgba, w, h, x, y, fg, alpha) {
  if (x < 0 || y < 0 || x >= w || y >= h || alpha <= 0) return;
  const a = Math.min(1, alpha);
  const off = (y * w + x) * 4;
  rgba[off] = Math.round(rgba[off] * (1 - a) + fg[0] * a);
  rgba[off + 1] = Math.round(rgba[off + 1] * (1 - a) + fg[1] * a);
  rgba[off + 2] = Math.round(rgba[off + 2] * (1 - a) + fg[2] * a);
}

function sdRoundedRect(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawPictureIcon(rgba, w, h, cx0, cy0, iconH, fg, iconAlpha, tintAlpha) {
  const iconW = Math.round(iconH * 1.24);
  const halfW = iconW / 2;
  const halfH = iconH / 2;
  const rad = Math.max(3, iconH * 0.16);
  const stroke = Math.max(1.8, Math.min(4.2, iconH * 0.075));
  const innerHalfW = Math.max(2, halfW - stroke);
  const innerHalfH = Math.max(2, halfH - stroke);

  const sunX = -innerHalfW * 0.42;
  const sunY = -innerHalfH * 0.34;
  const sunR = Math.max(2.0, iconH * 0.105);

  const y0 = Math.max(0, Math.floor(cy0 - halfH - 2));
  const y1 = Math.min(h - 1, Math.ceil(cy0 + halfH + 2));
  const x0 = Math.max(0, Math.floor(cx0 - halfW - 2));
  const x1 = Math.min(w - 1, Math.ceil(cx0 + halfW + 2));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x - cx0;
      const py = y - cy0;
      const dOuter = sdRoundedRect(px, py, halfW, halfH, rad);
      const dInner = sdRoundedRect(px, py, innerHalfW, innerHalfH, Math.max(1.5, rad - stroke * 0.6));

      if (dInner < 0 && tintAlpha > 0) {
        blendPixelRgba(rgba, w, h, x, y, fg, tintAlpha);
      }

      const frameCov = Math.min(1, Math.max(0, 0.5 - dOuter)) * Math.min(1, Math.max(0, dInner + 0.5));
      if (frameCov > 0) {
        blendPixelRgba(rgba, w, h, x, y, fg, frameCov * iconAlpha);
      }

      if (dInner < -0.5) {
        const dSun = Math.hypot(px - sunX, py - sunY) - sunR;
        const sunCov = Math.min(1, Math.max(0, 0.5 - dSun));
        if (sunCov > 0) {
          blendPixelRgba(rgba, w, h, x, y, fg, sunCov * iconAlpha);
        }

        const nx = px / innerHalfW;
        const ny = py / innerHalfH;
        const m1Top = -0.18 + Math.abs(nx - 0.24) * 1.25;
        const m2Top = 0.16 + Math.abs(nx + 0.42) * 1.15;
        const mTop = Math.min(m1Top, m2Top);
        const mCov = Math.min(1, Math.max(0, (ny - mTop) * innerHalfH + 0.5));
        if (mCov > 0) {
          blendPixelRgba(rgba, w, h, x, y, fg, mCov * (iconAlpha * 0.82));
        }
      }
    }
  }
}

/**
 * Generates a crisp, unmistakable editorial image placeholder PNG (zero baked text, zero dependencies).
 * - Standard content slots: smooth gradient + symmetric dashed inset border + centered mountain-sun picture icon.
 * - Masked/clipped slots (`options.masked = true`): omits rectangular dashed border so organic/rounded masks stay clean.
 * - Full-bleed background/wide banner slots (`options.isBackground` or auto-detected): keeps slide center unobstructed
 *   for foreground titles and places a subtle replaceable-photo icon in the bottom-right corner instead.
 */
export async function makeNeutralPlaceholderPng(
  outPath,
  width,
  height,
  topRgbOrOpts = [226, 232, 240],
  botRgbArg = [203, 213, 225],
  optionsArg = {}
) {
  const isOpts4th =
    topRgbOrOpts && !Array.isArray(topRgbOrOpts) && typeof topRgbOrOpts === "object";
  const opts = isOpts4th ? topRgbOrOpts : optionsArg || {};
  const topRgb = Array.isArray(opts.topRgb)
    ? opts.topRgb
    : Array.isArray(topRgbOrOpts)
      ? topRgbOrOpts
      : [226, 232, 240];
  const botRgb = Array.isArray(opts.botRgb)
    ? opts.botRgb
    : Array.isArray(botRgbArg)
      ? botRgbArg
      : [203, 213, 225];

  const w = Math.max(16, Math.min(1280, Math.round(width)));
  const h = Math.max(16, Math.min(720, Math.round(height)));
  const rgba = new Uint8Array(w * h * 4);

  const avgLum =
    0.299 * ((topRgb[0] + botRgb[0]) / 2) +
    0.587 * ((topRgb[1] + botRgb[1]) / 2) +
    0.114 * ((topRgb[2] + botRgb[2]) / 2);
  const isLight = avgLum >= 145;
  const fg = isLight ? [51, 65, 85] : [255, 255, 255];

  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    const r = Math.round(topRgb[0] * (1 - t) + botRgb[0] * t);
    const g = Math.round(topRgb[1] * (1 - t) + botRgb[1] * t);
    const b = Math.round(topRgb[2] * (1 - t) + botRgb[2] * t);
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      rgba[off] = r;
      rgba[off + 1] = g;
      rgba[off + 2] = b;
      rgba[off + 3] = 255;
    }
  }

  const minSide = Math.min(w, h);
  const isBackground =
    opts.isBackground === true ||
    (opts.isBackground !== false && (w >= 1100 || w * h >= 1280 * 720 * 0.45));
  const masked = Boolean(opts.masked);

  // Symmetric dashed inset frame for unmasked slots >= 64px
  const showBorder =
    opts.showBorder !== undefined
      ? Boolean(opts.showBorder)
      : !masked && minSide >= 64;
  if (showBorder) {
    const inset = Math.max(6, Math.min(16, Math.round(minSide * 0.05)));
    const bw = Math.max(1.5, Math.min(2.4, minSide * 0.008));
    const dash = Math.max(6, Math.min(12, Math.round(minSide * 0.045)));
    const gap = Math.max(4, Math.round(dash * 0.7));
    const period = dash + gap;
    const borderAlpha = isBackground
      ? (isLight ? 0.22 : 0.28)
      : (isLight ? 0.42 : 0.50);

    const spanX = Math.max(1, w - 1 - 2 * inset);
    const spanY = Math.max(1, h - 1 - 2 * inset);
    const isSymDash = (pos, span) => {
      const dEdge = Math.min(pos, span - pos);
      return (dEdge % period) < dash;
    };

    for (let y = inset; y <= h - 1 - inset; y++) {
      for (let x = inset; x <= w - 1 - inset; x++) {
        const dTop = y - inset;
        const dBot = h - 1 - inset - y;
        const dLeft = x - inset;
        const dRight = w - 1 - inset - x;
        const onH = dTop < bw || dBot < bw;
        const onV = dLeft < bw || dRight < bw;
        if (onH && onV) {
          blendPixelRgba(rgba, w, h, x, y, fg, borderAlpha);
        } else if (onH) {
          if (isSymDash(x - inset, spanX)) blendPixelRgba(rgba, w, h, x, y, fg, borderAlpha);
        } else if (onV) {
          if (isSymDash(y - inset, spanY)) blendPixelRgba(rgba, w, h, x, y, fg, borderAlpha);
        }
      }
    }
  }

  // Picture icon: corner badge for full-bleed background/wide banners (avoids colliding with headlines);
  // centered icon for regular & masked photo slots.
  const showIcon = opts.showIcon !== undefined ? Boolean(opts.showIcon) : minSide >= 32;
  if (showIcon) {
    const iconAlpha = isBackground
      ? (isLight ? 0.46 : 0.56)
      : (isLight ? 0.72 : 0.88);
    const tintAlpha = isBackground ? 0.04 : (isLight ? 0.07 : 0.10);
    if (isBackground) {
      const cornerH = Math.max(20, Math.min(34, Math.round(minSide * 0.10)));
      const cornerW = Math.round(cornerH * 1.24);
      const pad = Math.max(20, Math.min(36, Math.round(minSide * 0.08)));
      drawPictureIcon(rgba, w, h, w - pad - cornerW / 2, h - pad - cornerH / 2, cornerH, fg, iconAlpha, tintAlpha);
    } else {
      const iconH = Math.max(18, Math.min(82, Math.round(minSide * 0.30)));
      drawPictureIcon(rgba, w, h, w / 2, h / 2, iconH, fg, iconAlpha, tintAlpha);
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, encodeRgbaPng(w, h, rgba));
  return outPath;
}

function inferFontStyle(pdfFontName = "") {
  const f = String(pdfFontName || "");
  const isSerif = /song|serif|ming|kai|fangsong|times|georgia|garamond/i.test(f);
  const bold = /bold|semibold|heavy|black|ees|zhonghei|zhongjianhei|demi|medium/i.test(f);
  const italic = /italic|oblique/i.test(f);
  return {
    fontFamily: isSerif ? "Songti SC" : "PingFang SC",
    bold,
    italic,
  };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compiles a structured PDF vector specification (extracted by PyMuPDF) into a pure Phase-1
 * editable `masters.pptx` with neutral placeholder `<p:pic>` slots, native `<a:custGeom>` masks,
 * vector geometry, and `slot:*` / `decor:*` semantic names.
 */
export async function compilePdfVectorSpecToMasterPptx({
  pages = [],
  outPptxPath,
  placeholdersDir,
  keepText = false,
  title = "Pure Phase-1 Layout Masters (Compiled from Vector PDF)",
} = {}) {
  if (!outPptxPath) throw new Error("compilePdfVectorSpecToMasterPptx requires `outPptxPath`");
  const phDir = path.resolve(placeholdersDir || path.join(path.dirname(path.resolve(outPptxPath)), "placeholders"));
  await fs.mkdir(phDir, { recursive: true });

  const deck = Presentation.create({ title, defaultFont: "PingFang SC" });
  const pageSummary = [];
  let totalImageSlots = 0;
  let totalTextSlots = 0;

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pg = pages[pIdx];
    const s = deck.slides.add({ background: pg.slideBgHex || "#FFFFFF" });
    let imgCount = 0;
    let textCount = 0;
    let vecCount = 0;

    if (pg.pdfKind === "raster") {
      // Raster-only page inside a mixed PDF: emit non-slot decor guide so verify-master naturally flags it for visual rebuild
      const stubPh = path.join(phDir, `m${String(pIdx + 1).padStart(2, "0")}_raster_stub.png`);
      await makeNeutralPlaceholderPng(stubPh, 1280, 720, [215, 220, 228], [185, 192, 202]);
      s.images.add({ name: "decor:raster_rebuild_guide", path: stubPh, left: 0, top: 0, width: 1280, height: 720, fit: "cover" });
      s.shapes.add({
        name: "decor:raster_notice",
        geometry: "roundRect",
        borderRadius: 12,
        left: 300,
        top: 310,
        width: 680,
        height: 100,
        fill: { color: "#0F172A", opacity: 0.85 },
        line: { fill: "none" },
        text: `PDF 第 ${pg.page} 页为纯光栅位图，请按位图复刻路线手工精绘纯骨架母版`,
        textStyle: { fontFamily: "PingFang SC", fontSize: 18, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
      });
      pageSummary.push({
        masterSlide: pIdx + 1,
        pdfPage: pg.page,
        pdfKind: "raster",
        needsVisualRebuild: true,
        expectedImageCount: pg.expectedImageCount ?? 0,
        emittedImageSlots: 0,
        emittedTextSlots: 0,
        emittedVectors: 0,
      });
      continue;
    }

    // 0) Container + Text Fusion: merge small painted buttons/pills/highlight bars with their enclosed text into ONE <p:sp>
    const SLIDE_AREA = 1280 * 720;
    const rawDrawings = (pg.drawings || []).map((dr, idx) => ({ dr, idx }));
    const rawTexts = (pg.texts || []).map((t, idx) => ({ t, idx }));
    const rawImages = (pg.images || []).map((im, idx) => ({ im, idx }));

    const claimedDrawingIdx = new Set();
    const claimedTextIdx = new Set();
    const fusedChips = [];

    const isEligibleFusionDrawing = (dr) => {
      const w = Number(dr.w) || 0;
      const h = Number(dr.h) || 0;
      if (w < 24 || h < 16 || dr.isStrokePath) return false;
      if (dr.x <= 2 && dr.y <= 2 && w >= 1270 && h >= 712 && dr.fill && (dr.fillOpacity ?? 1) >= 0.98 && !dr.stroke) {
        return false;
      }
      const hasVisible = Boolean(dr.fill && (dr.fillOpacity ?? 1) > 0) || Boolean(dr.stroke && (dr.strokeW || 0) > 0);
      if (!hasVisible) return false;
      const isHollowDecorFrame = !dr.fill && (w >= 300 || h >= 180);
      const area = w * h;
      if (isHollowDecorFrame || area >= SLIDE_AREA * 0.25) return false;
      return true;
    };

    const isHorizontalRegularText = (t) => {
      const rawTxt = String(t.text || "").trim();
      if (!rawTxt) return false;
      const fontPt = Number(t.fontPt) || 16;
      const dx = Number(t.dir?.[0] ?? 1);
      const dy = Number(t.dir?.[1] ?? 0);
      const rotDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      return Math.abs(rotDeg) < 30 && fontPt < 140;
    };

    // Match smallest-area containers first so inner pills claim their text before enclosing panels
    const fusionCandidates = rawDrawings
      .filter(({ dr }) => isEligibleFusionDrawing(dr))
      .sort((a, b) => a.dr.w * a.dr.h - b.dr.w * b.dr.h);

    for (const { dr, idx: dIdx } of fusionCandidates) {
      const drArea = Math.max(1, dr.w * dr.h);
      const drZ = typeof dr.zOrder === "number" ? dr.zOrder : dIdx;
      const matched = [];
      for (const { t, idx: tIdx } of rawTexts) {
        if (claimedTextIdx.has(tIdx) || !isHorizontalRegularText(t)) continue;
        const tZ = typeof t.zOrder === "number" ? t.zOrder : 2000 + tIdx;
        if (tZ < drZ - 1) continue;
        const tw = Math.max(12, Number(t.w) || 24);
        const th = Math.max(12, Number(t.h) || 20);
        const ix = Math.max(0, Math.min(dr.x + dr.w, t.x + tw) - Math.max(dr.x, t.x));
        const iy = Math.max(0, Math.min(dr.y + dr.h, t.y + th) - Math.max(dr.y, t.y));
        if (ix <= 4 || iy <= 4) continue;
        const tArea = Math.max(1, tw * th);
        const overlapMin = (ix * iy) / Math.min(drArea, tArea);
        const areaRatio = Math.max(drArea, tArea) / Math.min(drArea, tArea);
        const maxAreaRatio = drArea <= SLIDE_AREA * 0.16 && dr.h <= 150 ? 6.5 : 2.6;
        if (overlapMin >= 0.7 && areaRatio <= maxAreaRatio && tw <= dr.w * 1.18 && th <= dr.h * 1.35) {
          matched.push({ t, tIdx, tZ });
        }
      }
      if (matched.length >= 1 && matched.length <= 2) {
        matched.sort((a, b) => (Math.abs(a.t.y - b.t.y) > 8 ? a.t.y - b.t.y : a.t.x - b.t.x));
        claimedDrawingIdx.add(dIdx);
        for (const m of matched) claimedTextIdx.add(m.tIdx);
        fusedChips.push({
          dr,
          dIdx,
          texts: matched.map((m) => m.t),
          zOrder: Math.max(drZ, ...matched.map((m) => m.tZ)),
        });
      }
    }

    // Build unified painter's z-order queue across drawings, fused chips, images, and remaining texts
    const renderQueue = [];
    for (const { dr, idx } of rawDrawings) {
      if (claimedDrawingIdx.has(idx)) continue;
      renderQueue.push({
        kind: "drawing",
        zOrder: typeof dr.zOrder === "number" ? dr.zOrder : idx,
        kindRank: 0,
        order: idx,
        data: dr,
      });
    }
    for (let ci = 0; ci < fusedChips.length; ci++) {
      const chip = fusedChips[ci];
      renderQueue.push({
        kind: "chip",
        zOrder: chip.zOrder,
        kindRank: 2,
        order: chip.dIdx,
        data: chip,
      });
    }
    for (const { im, idx } of rawImages) {
      renderQueue.push({
        kind: "image",
        zOrder: typeof im.zOrder === "number" ? im.zOrder : 1000 + idx,
        kindRank: 1,
        order: idx,
        data: im,
      });
    }
    for (const { t, idx } of rawTexts) {
      if (claimedTextIdx.has(idx)) continue;
      renderQueue.push({
        kind: "text",
        zOrder: typeof t.zOrder === "number" ? t.zOrder : 2000 + idx,
        kindRank: 3,
        order: idx,
        data: t,
      });
    }
    renderQueue.sort((a, b) => a.zOrder - b.zOrder || a.kindRank - b.kindRank || a.order - b.order);

    let chipCount = 0;
    for (const item of renderQueue) {
      if (item.kind === "drawing") {
        const dr = item.data;
        const w = Number(dr.w) || 0;
        const h = Number(dr.h) || 0;
        if (w < 1 && h < 1) continue;
        // Skip full-canvas solid background rect
        if (dr.x <= 2 && dr.y <= 2 && w >= 1270 && h >= 712 && dr.fill && (dr.fillOpacity ?? 1) >= 0.98 && !dr.stroke) {
          continue;
        }
        const x = clamp(dr.x, -40, 1280);
        const y = clamp(dr.y, -40, 720);
        const cw = Math.max(1, Math.min(1360, w));
        const ch = Math.max(1, Math.min(760, h));

        if (dr.isStrokePath && dr.svgPath) {
          vecCount++;
          s.shapes.add({
            name: `decor:stroke_${vecCount}`,
            svgPath: dr.svgPath,
            viewBox: dr.viewBox || [dr.x, dr.y, w, h],
            left: dr.x,
            top: dr.y,
            width: w,
            height: h,
            fill: "none",
            line: { fill: dr.fill || dr.stroke || "#FF0036", width: Math.max(2, Number(dr.strokeW) || 5) },
          });
          continue;
        }

        const fillSpec = dr.fill
          ? (dr.fillOpacity ?? 1) < 0.99
            ? { color: dr.fill, opacity: dr.fillOpacity }
            : dr.fill
          : "none";
        const lineSpec = dr.stroke && (dr.strokeW || 0) > 0 ? { fill: dr.stroke, width: Math.max(0.8, dr.strokeW) } : { fill: "none" };
        if (fillSpec === "none" && lineSpec.fill === "none") continue;

        vecCount++;
        const name = `decor:vec_${vecCount}`;
        if (dr.opCount > 48 && cw >= 40 && ch >= 40 && Math.abs(cw / ch - 1) <= 0.25) {
          // High-segment PDF-flattened circular ring -> crisp native ellipse outline
          s.shapes.add({
            name,
            geometry: "ellipse",
            left: x,
            top: y,
            width: cw,
            height: ch,
            fill: "none",
            line: { fill: dr.fill || dr.stroke || "#CBD5E1", width: 1.5 },
          });
        } else if (dr.svgPath && dr.opCount >= 2 && dr.opCount <= 48) {
          s.shapes.add({
            name,
            svgPath: dr.svgPath,
            viewBox: dr.viewBox || [dr.x, dr.y, w, h],
            left: dr.x,
            top: dr.y,
            width: w,
            height: h,
            fill: fillSpec,
            line: lineSpec,
          });
        } else {
          s.shapes.add({
            name,
            geometry: dr.isCapsule ? "roundRect" : "rect",
            borderRadius: dr.isCapsule ? Math.round(Math.min(cw, ch) / 2) : undefined,
            left: x,
            top: y,
            width: cw,
            height: ch,
            fill: fillSpec,
            line: lineSpec,
          });
        }
        continue;
      }

      if (item.kind === "chip") {
        const { dr, texts: chipTexts } = item.data;
        const w = Math.max(24, Math.min(1280, Number(dr.w) || 24));
        const h = Math.max(16, Math.min(720, Number(dr.h) || 16));
        const left = clamp(dr.x, 0, Math.max(0, 1280 - w));
        const top = clamp(dr.y, 0, Math.max(0, 720 - h));
        const fillSpec = dr.fill
          ? (dr.fillOpacity ?? 1) < 0.99
            ? { color: dr.fill, opacity: dr.fillOpacity }
            : dr.fill
          : "none";
        const lineSpec = dr.stroke && (dr.strokeW || 0) > 0 ? { fill: dr.stroke, width: Math.max(0.8, dr.strokeW) } : { fill: "none" };
        const joinedRaw = chipTexts.map((ct) => String(ct.text || "").trim()).join(
          chipTexts.length === 2 && Math.abs(chipTexts[0].y - chipTexts[1].y) <= 8 ? " " : "\n"
        );
        const content = keepText ? joinedRaw : toNeutralPlaceholderText(joinedRaw);
        const domT = chipTexts.reduce((best, cur) => (String(cur.text || "").length > String(best.text || "").length ? cur : best), chipTexts[0]);
        const fontPt = Math.max(9, Math.min(120, Number(domT.fontPt) || 16));
        const { fontFamily, bold, italic } = inferFontStyle(domT.font);
        const tMidX = domT.x + (Number(domT.w) || 0) / 2;
        const drMidX = dr.x + w / 2;
        const alignment = Math.abs(tMidX - drMidX) <= w * 0.22 ? "center" : "left";

        chipCount++;
        textCount++;
        const chipCfg = {
          name: `slot:chip_${chipCount}`,
          left,
          top,
          width: w,
          height: h,
          fill: fillSpec,
          line: lineSpec,
          insets: { left: 3, right: 3, top: 1, bottom: 1 },
          text: content,
          textStyle: {
            fontFamily,
            fontSize: fontPt,
            bold,
            italic,
            color: domT.color || "#FFFFFF",
            alignment,
            verticalAlignment: "middle",
            lineSpacing: 1.12,
          },
        };
        if (dr.svgPath && !dr.isCapsule && dr.opCount >= 2 && dr.opCount <= 48) {
          chipCfg.svgPath = dr.svgPath;
          chipCfg.viewBox = dr.viewBox || [dr.x, dr.y, w, h];
        } else {
          chipCfg.geometry = dr.isCapsule ? "roundRect" : "rect";
          if (dr.isCapsule) chipCfg.borderRadius = Math.round(Math.min(w, h) / 2);
        }
        s.shapes.add(chipCfg);
        continue;
      }

      if (item.kind === "image") {
        const im = item.data;
        const rawX = Number(im.x) || 0;
        const rawY = Number(im.y) || 0;
        const rawW = Number(im.w) || 0;
        const rawH = Number(im.h) || 0;
        if (rawW < 12 || rawH < 12) continue;

        // Keep exact unclamped clipViewBox when organic vector clip exists (prevents custGeom distortion on edge-bleeding masks!)
        const left = im.clipViewBox ? im.clipViewBox[0] : clamp(rawX, 0, 1276);
        const top = im.clipViewBox ? im.clipViewBox[1] : clamp(rawY, 0, 716);
        const right = im.clipViewBox ? im.clipViewBox[0] + im.clipViewBox[2] : clamp(rawX + rawW, left + 12, 1280);
        const bottom = im.clipViewBox ? im.clipViewBox[1] + im.clipViewBox[3] : clamp(rawY + rawH, top + 12, 720);
        const width = Math.max(12, right - left);
        const height = Math.max(12, bottom - top);

        imgCount++;
        const phPath = path.join(phDir, `m${String(pIdx + 1).padStart(2, "0")}_img_${String(imgCount).padStart(2, "0")}.png`);
        await makeNeutralPlaceholderPng(
          phPath,
          width,
          height,
          im.topRgb || [136, 144, 154],
          im.botRgb || [74, 80, 90],
          { masked: Boolean(im.clipSvgPath && im.clipViewBox) }
        );

        const imgCfg = {
          name: `slot:img_${imgCount}`,
          path: phPath,
          left,
          top,
          width,
          height,
          fit: "cover",
        };
        if (im.clipSvgPath && im.clipViewBox) {
          imgCfg.svgPath = im.clipSvgPath;
          imgCfg.viewBox = im.clipViewBox;
        }
        s.images.add(imgCfg);
        continue;
      }

      if (item.kind === "text") {
        const t = item.data;
        const rawTxt = String(t.text || "").trim();
        if (!rawTxt) continue;
        const content = keepText ? rawTxt : toNeutralPlaceholderText(rawTxt);
        const fontPt = Math.max(9, Math.min(560, Number(t.fontPt) || 16));
        const { fontFamily, bold, italic } = inferFontStyle(t.font);
        const dx = Number(t.dir?.[0] ?? 1);
        const dy = Number(t.dir?.[1] ?? 0);
        const rotDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
        const isRotated = Math.abs(rotDeg) >= 30;
        const isBackgroundWatermark = isRotated || fontPt >= 140;
        const textColor =
          t.alpha !== undefined && Number(t.alpha) < 0.99
            ? { color: t.color || "#111827", opacity: Math.max(0.05, Number(t.alpha)) }
            : t.color || "#111827";

        let left = Number(t.x) || 0;
        let top = Number(t.y) || 0;
        let width = Math.max(24, Number(t.w) || fontPt * 2);
        let height = Math.max(20, Number(t.h) || fontPt * 1.45);

        if (isRotated && Math.abs(Math.abs(rotDeg) - 90) <= 15) {
          const cx = left + width / 2;
          const cy = top + height / 2;
          const unrotW = Math.max(40, height + 16);
          const unrotH = Math.max(30, width);
          left = cx - unrotW / 2;
          top = cy - unrotH / 2;
          width = unrotW;
          height = unrotH;
        } else {
          // Guard against inflated PDF ascent/descent bboxes on single-line horizontal spans
          if (!rawTxt.includes("\n") && height > fontPt * 1.85) {
            height = Math.round(fontPt * 1.48);
          }
          const padW = Math.min(28, Math.max(8, Math.round(fontPt * 0.4)));
          width = Math.min(1280, Math.min(1280 - Math.max(0, left), width + padW));
          height = Math.min(720, Math.max(height, Math.round(fontPt * 1.38)));
          left = clamp(left, 0, Math.max(0, 1280 - width));
          top = clamp(top, 0, Math.max(0, 720 - height));
        }

        textCount++;
        const name = isBackgroundWatermark ? `decor:text_${textCount}` : `slot:text_${textCount}`;
        s.shapes.add({
          name,
          geometry: "textbox",
          left,
          top,
          width,
          height,
          rotation: isRotated ? rotDeg : 0,
          text: content,
          textStyle: {
            fontFamily,
            fontSize: fontPt,
            bold,
            italic,
            color: textColor,
            verticalAlignment: "middle",
            lineSpacing: 1.15,
          },
        });
      }
    }

    totalImageSlots += imgCount;
    totalTextSlots += textCount;
    pageSummary.push({
      masterSlide: pIdx + 1,
      pdfPage: pg.page,
      pdfKind: pg.pdfKind || "vector",
      needsVisualRebuild: false,
      expectedImageCount: pg.expectedImageCount ?? imgCount,
      emittedImageSlots: imgCount,
      emittedTextSlots: textCount,
      emittedVectors: vecCount,
    });
  }

  const absOut = path.resolve(outPptxPath);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await deck.save(absOut);
  return {
    outPptxPath: absOut,
    placeholdersDir: phDir,
    slideCount: pages.length,
    totalImageSlots,
    totalTextSlots,
    pageSummary,
  };
}
