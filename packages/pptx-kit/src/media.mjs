// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pure Node.js image dimension & MIME sniffer for PNG, JPEG, GIF, and WebP.
 */
export function inspectImageBytes(buf, hintExt = ".png") {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return {
      width: b.readUInt32BE(16),
      height: b.readUInt32BE(20),
      ext: ".png",
      contentType: "image/png",
      bytes: b,
    };
  }

  // GIF: GIF87a / GIF89a
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return {
      width: b.readUInt16LE(6),
      height: b.readUInt16LE(8),
      ext: ".gif",
      contentType: "image/gif",
      bytes: b,
    };
  }

  // JPEG: FF D8 ... scan for SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = b[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const segLen = b.readUInt16BE(offset + 2);
      if (segLen < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 9 <= b.length) {
        const height = b.readUInt16BE(offset + 5);
        const width = b.readUInt16BE(offset + 7);
        return {
          width,
          height,
          ext: ".jpg",
          contentType: "image/jpeg",
          bytes: b,
        };
      }
      offset += 2 + segLen;
    }
    return { width: 1280, height: 720, ext: ".jpg", contentType: "image/jpeg", bytes: b };
  }

  // WebP: RIFF....WEBP
  if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X" && b.length >= 30) {
      const width = 1 + b.readUIntLE(24, 3);
      const height = 1 + b.readUIntLE(27, 3);
      return { width, height, ext: ".webp", contentType: "image/webp", bytes: b };
    }
    if (chunk === "VP8 " && b.length >= 30) {
      const width = b.readUInt16LE(26) & 0x3fff;
      const height = b.readUInt16LE(28) & 0x3fff;
      return { width, height, ext: ".webp", contentType: "image/webp", bytes: b };
    }
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      return { width, height, ext: ".webp", contentType: "image/webp", bytes: b };
    }
  }

  // SVG XML payload
  const headText = b.subarray(0, Math.min(512, b.length)).toString("utf8").trimStart();
  if (headText.startsWith("<svg") || headText.includes("<svg")) {
    const vb = headText.match(/viewBox=["']\s*[-+0-9.]+\s+[-+0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i);
    const wMatch = headText.match(/\bwidth=["']([0-9.]+)/i);
    const hMatch = headText.match(/\bheight=["']([0-9.]+)/i);
    const width = vb ? Number.parseFloat(vb[1]) : wMatch ? Number.parseFloat(wMatch[1]) : 256;
    const height = vb ? Number.parseFloat(vb[2]) : hMatch ? Number.parseFloat(hMatch[1]) : 256;
    return { width, height, ext: ".svg", contentType: "image/svg+xml", bytes: b };
  }

  const ext = hintExt.startsWith(".") ? hintExt.toLowerCase() : `.${hintExt.toLowerCase()}`;
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".gif"
        ? "image/gif"
        : ext === ".svg"
          ? "image/svg+xml"
          : "image/png";
  return { width: 1280, height: 720, ext, contentType: mime, bytes: b };
}

export function resolveImageSource(options) {
  if (options.path) {
    const abs = path.resolve(options.path);
    const buf = readFileSync(abs);
    return { ...inspectImageBytes(buf, path.extname(abs)), alt: options.alt || path.basename(abs) };
  }
  if (options.blob) {
    const buf = Buffer.isBuffer(options.blob) ? options.blob : Buffer.from(options.blob);
    const hint =
      options.contentType === "image/jpeg"
        ? ".jpg"
        : options.contentType === "image/svg+xml"
          ? ".svg"
          : ".png";
    return { ...inspectImageBytes(buf, hint), alt: options.alt || "embedded-image" };
  }
  if (options.dataUrl) {
    const m = String(options.dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error("Invalid dataUrl passed to slide.images.add");
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    return { ...inspectImageBytes(buf, ".png"), alt: options.alt || "data-url-image" };
  }
  if (options.svg) {
    const buf = Buffer.from(String(options.svg), "utf8");
    return { ...inspectImageBytes(buf, ".svg"), alt: options.alt || "inline-svg" };
  }
  throw new Error("slide.images.add requires one of: path, blob, dataUrl, or svg");
}

function parseCropEdgeFraction(edgeVal, sourceDimPx) {
  if (edgeVal === undefined || edgeVal === null) return 0;
  if (typeof edgeVal === "number" && Number.isFinite(edgeVal)) {
    return Math.max(0, Math.min(0.95, edgeVal));
  }
  if (typeof edgeVal === "string") {
    const s = edgeVal.trim().toLowerCase();
    if (s.endsWith("%")) {
      return Math.max(0, Math.min(0.95, Number.parseFloat(s) / 100));
    }
    if (s.endsWith("px") && sourceDimPx > 0) {
      return Math.max(0, Math.min(0.95, Number.parseFloat(s) / sourceDimPx));
    }
    const n = Number.parseFloat(s);
    if (Number.isFinite(n)) return Math.max(0, Math.min(0.95, n));
  }
  return 0;
}

/**
 * Computes final destination frame (in px) and OpenXML `<a:srcRect>` (in 1/1000 %)
 * for `fit: "contain" | "cover"` combined with user `crop`.
 */
export function computeImagePlacementAndCrop({
  sourceWidth,
  sourceHeight,
  frame,
  fit = "contain",
  crop,
}) {
  const boxLeft = frame.left ?? 0;
  const boxTop = frame.top ?? 0;
  const boxW = Math.max(1, frame.width ?? sourceWidth ?? 200);
  const boxH = Math.max(1, frame.height ?? sourceHeight ?? 200);

  let cropL = parseCropEdgeFraction(crop?.left, sourceWidth);
  let cropR = parseCropEdgeFraction(crop?.right, sourceWidth);
  let cropT = parseCropEdgeFraction(crop?.top, sourceHeight);
  let cropB = parseCropEdgeFraction(crop?.bottom, sourceHeight);

  const effSrcW = Math.max(1, sourceWidth * (1 - cropL - cropR));
  const effSrcH = Math.max(1, sourceHeight * (1 - cropT - cropB));
  const srcAspect = effSrcW / effSrcH;
  const boxAspect = boxW / boxH;

  let drawLeft = boxLeft;
  let drawTop = boxTop;
  let drawWidth = boxW;
  let drawHeight = boxH;

  if (fit === "contain") {
    const scale = Math.min(boxW / effSrcW, boxH / effSrcH);
    drawWidth = Math.max(1, effSrcW * scale);
    drawHeight = Math.max(1, effSrcH * scale);
    drawLeft = boxLeft + (boxW - drawWidth) / 2;
    drawTop = boxTop + (boxH - drawHeight) / 2;
  } else if (fit === "cover") {
    if (srcAspect > boxAspect) {
      // Image is wider than frame -> center-crop left & right
      const keepRatio = boxAspect / srcAspect;
      const extraEach = ((1 - cropL - cropR) * (1 - keepRatio)) / 2;
      cropL += extraEach;
      cropR += extraEach;
    } else if (srcAspect < boxAspect) {
      // Image is taller than frame -> center-crop top & bottom
      const keepRatio = srcAspect / boxAspect;
      const extraEach = ((1 - cropT - cropB) * (1 - keepRatio)) / 2;
      cropT += extraEach;
      cropB += extraEach;
    }
  }

  const srcRect = {
    l: Math.round(cropL * 100000),
    t: Math.round(cropT * 100000),
    r: Math.round(cropR * 100000),
    b: Math.round(cropB * 100000),
  };

  const hasCrop = srcRect.l > 0 || srcRect.t > 0 || srcRect.r > 0 || srcRect.b > 0;
  return {
    position: {
      left: Number(drawLeft.toFixed(2)),
      top: Number(drawTop.toFixed(2)),
      width: Number(drawWidth.toFixed(2)),
      height: Number(drawHeight.toFixed(2)),
    },
    srcRect: hasCrop ? srcRect : null,
  };
}
