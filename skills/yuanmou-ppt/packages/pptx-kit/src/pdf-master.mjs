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

/**
 * Generates a clean neutral editorial gradient placeholder PNG (minimal camera-frame reticle, zero baked text).
 */
export async function makeNeutralPlaceholderPng(outPath, width, height, topRgb = [138, 146, 156], botRgb = [74, 82, 92]) {
  const w = Math.max(16, Math.min(1280, Math.round(width)));
  const h = Math.max(16, Math.min(720, Math.round(height)));
  const rgba = new Uint8Array(w * h * 4);
  const showReticle = w >= 56 && h >= 56;
  const rx = Math.min(22, Math.max(8, Math.round(w * 0.08)));
  const ry = Math.min(15, Math.max(6, Math.round(h * 0.08)));
  const lr = Math.min(6.5, Math.max(3, Math.round(Math.min(rx, ry) * 0.45)));

  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h - 1);
    const r = Math.round(topRgb[0] * (1 - t) + botRgb[0] * t);
    const g = Math.round(topRgb[1] * (1 - t) + botRgb[1] * t);
    const b = Math.round(topRgb[2] * (1 - t) + botRgb[2] * t);
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      let rr = r;
      let gg = g;
      let bb = b;
      if (showReticle) {
        const cx = Math.abs(x - w / 2);
        const cy = Math.abs(y - h / 2);
        const inFrame = cx <= rx && cy <= ry && (cx >= rx - 2 || cy >= ry - 2);
        const inLens = Math.abs(Math.hypot(x - w / 2, y - h / 2) - lr) <= 1.2;
        if (inFrame || inLens) {
          rr = Math.min(255, r + 42);
          gg = Math.min(255, g + 42);
          bb = Math.min(255, b + 42);
        }
      }
      rgba[off] = rr;
      rgba[off + 1] = gg;
      rgba[off + 2] = bb;
      rgba[off + 3] = 255;
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
      // Raster-only PDF page: emit a single clean full-canvas photo placeholder slot + notice slot
      const stubPh = path.join(phDir, `m${String(pIdx + 1).padStart(2, "0")}_raster_stub.png`);
      await makeNeutralPlaceholderPng(stubPh, 1280, 720, [215, 220, 228], [185, 192, 202]);
      s.images.add({ name: "slot:raster_rebuild_guide", path: stubPh, left: 0, top: 0, width: 1280, height: 720, fit: "cover" });
      s.shapes.add({
        name: "slot:raster_notice",
        geometry: "roundRect",
        borderRadius: 12,
        left: 300,
        top: 310,
        width: 680,
        height: 100,
        fill: { color: "#0F172A", opacity: 0.85 },
        line: { fill: "none" },
        text: `PDF 第 ${pg.page} 页为纯光栅位图，请按 ref_grid_1280x720.png 手工精绘纯骨架母版`,
        textStyle: { fontFamily: "PingFang SC", fontSize: 18, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
      });
      imgCount = 1;
      textCount = 1;
      totalImageSlots += imgCount;
      totalTextSlots += textCount;
      pageSummary.push({
        masterSlide: pIdx + 1,
        pdfPage: pg.page,
        pdfKind: "raster",
        needsVisualRebuild: true,
        expectedImageCount: pg.expectedImageCount ?? 0,
        emittedImageSlots: imgCount,
        emittedTextSlots: textCount,
        emittedVectors: 0,
      });
      continue;
    }

    // 1) Render non-background vector drawings in z-order (skip full-canvas slide background rect)
    for (const dr of pg.drawings || []) {
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
    }

    // 2) Render all embedded PDF images as replaceable neutral placeholder <p:pic> slots
    for (const im of pg.images || []) {
      const rawX = Number(im.x) || 0;
      const rawY = Number(im.y) || 0;
      const rawW = Number(im.w) || 0;
      const rawH = Number(im.h) || 0;
      if (rawW < 12 || rawH < 12) continue;

      // Clamp visible bbox inside 1280x720 unless clipped by explicit vector clip path
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
        im.botRgb || [74, 80, 90]
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
    }

    // 3) Render all extracted text spans as editable `slot:text_N` (or `decor:text_N` for background/rotated watermarks)
    for (const t of pg.texts || []) {
      const rawTxt = String(t.text || "").trim();
      if (!rawTxt) continue;
      const content = keepText ? rawTxt : toNeutralPlaceholderText(rawTxt);
      const fontPt = Math.max(9, Math.min(260, Number(t.fontPt) || 16));
      const { fontFamily, bold, italic } = inferFontStyle(t.font);
      const dx = Number(t.dir?.[0] ?? 1);
      const dy = Number(t.dir?.[1] ?? 0);
      const rotDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      const isRotated = Math.abs(rotDeg) >= 30;
      const isBackgroundWatermark = isRotated || fontPt >= 140;

      let left = Number(t.x) || 0;
      let top = Number(t.y) || 0;
      let width = Math.max(24, Number(t.w) || fontPt * 2);
      let height = Math.max(20, Number(t.h) || fontPt * 1.45);

      if (isRotated && Math.abs(Math.abs(rotDeg) - 90) <= 15) {
        // Convert vertical visual bbox (w, h) to unrotated box rotated around its exact visual center
        const cx = left + width / 2;
        const cy = top + height / 2;
        const unrotW = Math.max(40, height + 16);
        const unrotH = Math.max(30, width);
        left = cx - unrotW / 2;
        top = cy - unrotH / 2;
        width = unrotW;
        height = unrotH;
      } else {
        // Add comfortable cross-font breathing room while staying within 1280x720 bounds
        const padW = Math.min(28, Math.max(8, Math.round(fontPt * 0.4)));
        width = Math.min(1280 - Math.max(0, left), width + padW);
        height = Math.max(height, Math.round(fontPt * 1.55));
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
          color: t.color || "#111827",
          verticalAlignment: "middle",
          lineSpacing: 1.15,
        },
      });
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
