// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Zero-dependency procedural organic ink-brush RGBA PNG generator, composable multi-stroke brush engine,
// and pure-Node hole-free Alpha-mask image compositor (with zero mandatory Python/Pillow dependency).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { discoverRenderToolchain } from "./render.mjs";

// ============================================================================
// Pure Node.js RGBA PNG Encoder & Decoder (zlib + CRC32, zero third-party deps)
// ============================================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodeRgbaPng(width, height, rgba) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);

  // Use Sub filter (filter type 1) on scanlines for smaller compressed PNG size
  for (let y = 0; y < h; y++) {
    const rowOff = y * stride;
    const srcOff = y * w * 4;
    raw[rowOff] = 1; // Sub filter
    for (let i = 0; i < w * 4; i++) {
      const prev = i >= 4 ? rgba[srcOff + i - 4] : 0;
      raw[rowOff + 1 + i] = (rgba[srcOff + i] - prev) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Pure Node.js standard 8-bit PNG decoder (supports Grayscale, RGB, Indexed PLTE+tRNS, Gray+Alpha, RGBA).
 */
export function decodePngToRgba(pngBuf) {
  const buf = Buffer.isBuffer(pngBuf) ? pngBuf : Buffer.from(pngBuf);
  if (buf.length < 33 || buf[0] !== 137 || buf[1] !== 80 || buf[2] !== 78 || buf[3] !== 71) {
    throw new Error("Invalid PNG signature");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let plte = null;
  let trns = null;
  const idatChunks = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      plte = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG bitDepth=${bitDepth} interlace=${interlace}`);
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bpp = channels;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = new Uint8Array(width * height * channels);

  for (let y = 0; y < height; y++) {
    const srcRow = y * (rowBytes + 1);
    const filter = inflated[srcRow];
    const dstRow = y * rowBytes;
    const prevRow = (y - 1) * rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const rawByte = inflated[srcRow + 1 + x];
      const left = x >= bpp ? recon[dstRow + x - bpp] : 0;
      const up = y > 0 ? recon[prevRow + x] : 0;
      const upLeft = y > 0 && x >= bpp ? recon[prevRow + x - bpp] : 0;
      let val = rawByte;
      if (filter === 1) val = (rawByte + left) & 0xff;
      else if (filter === 2) val = (rawByte + up) & 0xff;
      else if (filter === 3) val = (rawByte + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) val = (rawByte + paethPredictor(left, up, upLeft)) & 0xff;
      recon[dstRow + x] = val;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const d = i * 4;
    if (colorType === 6) {
      const s = i * 4;
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s + 1];
      rgba[d + 2] = recon[s + 2];
      rgba[d + 3] = recon[s + 3];
    } else if (colorType === 2) {
      const s = i * 3;
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s + 1];
      rgba[d + 2] = recon[s + 2];
      rgba[d + 3] = 255;
    } else if (colorType === 4) {
      const s = i * 2;
      rgba[d] = recon[s];
      rgba[d + 1] = recon[s];
      rgba[d + 2] = recon[s];
      rgba[d + 3] = recon[s + 1];
    } else if (colorType === 3 && plte) {
      const idx = recon[i];
      rgba[d] = plte[idx * 3] || 0;
      rgba[d + 1] = plte[idx * 3 + 1] || 0;
      rgba[d + 2] = plte[idx * 3 + 2] || 0;
      rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else {
      const g = recon[i];
      rgba[d] = g;
      rgba[d + 1] = g;
      rgba[d + 2] = g;
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function parseHexRgb(hex) {
  const clean = String(hex || "#000000").trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.slice(0, 6);
  const num = Number.parseInt(full || "000000", 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// ============================================================================
// Procedural Noise & Crisp Sumi-e Dry-Brush Bristle Math
// ============================================================================
function hash2d(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2d(ix, iy, seed);
  const b = hash2d(ix + 1, iy, seed);
  const c = hash2d(ix, iy + 1, seed);
  const d = hash2d(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, seed, octaves = 3) {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise(x * freq, y * freq, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return val / norm;
}

/**
 * Evaluates a single directed flat-bristle calligraphy stroke from `(x1, y1)` to `(x2, y2)` in pixel space.
 * Core ink belly is 100% solid (`alpha = 1.0`); outer bristles & dry exit tail split into crisp individual
 * hair filaments with tight ~1.5px anti-aliasing (ZERO muddy Gaussian airbrush fog!).
 */
function evalDirectedStrokeAlpha(px, py, stroke, seed) {
  const { x1, y1, x2, y2, halfWidthPx, fray = 0.28, taper = 0.14 } = stroke;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const vx = -uy;
  const vy = ux;

  const relX = px - x1;
  const relY = py - y1;
  const alongPx = relX * ux + relY * uy;
  const perpPx = relX * vx + relY * vy;

  const u = alongPx / len; // 0 = start press, 1 = end lift
  if (u < -0.14 || u > 1.24) return 0;

  // Subtle hand-pressure curve & organic edge undulation
  const waveShift = (fbm(u * 3.4, 1.7, seed, 2) - 0.5) * halfWidthPx * 0.16;
  const widthScale =
    1.0 - taper * smoothstep(0.35, 1.05, u) + (fbm(u * 4.8, 5.3, seed + 11, 2) - 0.5) * 0.14;
  const effHalfW = Math.max(2, halfWidthPx * widthScale);
  const absPerp = Math.abs(perpPx - waveShift);
  if (absPerp > effHalfW * 1.18) return 0;

  // Coherent bristle channels running longitudinally along `u` and packed densely across `perpPx`
  const bristleCoord = (perpPx - waveShift) / Math.max(3.5, effHalfW * 0.055);
  const coarseBristle = fbm(bristleCoord * 0.55, u * 2.2, seed + 23, 2);
  const fineBristle = valueNoise(bristleCoord * 1.35, u * 3.8, seed + 59);
  const hairVal = coarseBristle * 0.62 + fineBristle * 0.38;

  // Entry press (compact brush tip with slight hair texture) & exit dry-brush flying-white tail
  const entryTip = -0.02 - (hairVal - 0.5) * 0.10;
  const exitTip = 0.86 + hairVal * (0.28 + fray * 0.22);
  const aaU = Math.max(0.004, 1.5 / len);
  const inStart = smoothstep(entryTip - aaU, entryTip + aaU * 1.5, u);
  const inEnd = 1 - smoothstep(exitTip - aaU * 2, exitTip + aaU * 2, u);
  const lenMask = inStart * inEnd;
  if (lenMask <= 0.005) return 0;

  // Crisp side edge + dry-brush tail splitting into sharp individual filaments (tight ~1.4px AA!)
  const sideNorm = absPerp / effHalfW; // 0 = center, 1 = nominal edge
  const tailDryness = smoothstep(0.62, 1.04, u) * fray;
  const sideDryness = smoothstep(0.76, 1.04, sideNorm);
  const dryDemand = Math.min(0.92, sideDryness * 0.78 + tailDryness * 0.68);

  if (dryDemand <= 0.04) {
    return lenMask; // 100% solid ink belly!
  }

  // Sharp threshold per bristle filament (only ~0.05 AA band instead of 0.40 foggy gradient)
  const threshold = 0.14 + dryDemand * 0.74;
  const aaBand = Math.max(0.035, 1.2 / effHalfW);
  const filamentKeep = smoothstep(threshold - aaBand, threshold + aaBand, hairVal);
  return Math.max(0, Math.min(1, lenMask * filamentKeep));
}

function normalizeStrokesToPixels(strokes, w, h) {
  const minDim = Math.min(w, h);
  return strokes.map((s) => {
    const f = s.from || [s.x1 ?? 0.1, s.y1 ?? 0.5];
    const t = s.to || [s.x2 ?? 0.9, s.y2 ?? 0.5];
    const isNormCoord =
      Math.abs(f[0]) <= 1.6 &&
      Math.abs(f[1]) <= 1.6 &&
      Math.abs(t[0]) <= 1.6 &&
      Math.abs(t[1]) <= 1.6;
    const x1 = isNormCoord ? f[0] * w : f[0];
    const y1 = isNormCoord ? f[1] * h : f[1];
    const x2 = isNormCoord ? t[0] * w : t[0];
    const y2 = isNormCoord ? t[1] * h : t[1];
    const rawW = s.width ?? 0.42;
    const widthPx = rawW <= 2.0 ? rawW * minDim : rawW;
    return {
      x1,
      y1,
      x2,
      y2,
      halfWidthPx: Math.max(2, widthPx * 0.5),
      fray: s.fray ?? 0.32,
      taper: s.taper ?? 0.12,
    };
  });
}

/** Solid organic calligraphy seal/stamp (`ink-circle-solid`) with circumferential brush hairs */
function evalInkCircleSolidAlpha(nx, ny, seed) {
  const r = Math.hypot(nx, ny);
  if (r > 1.0) return 0;
  let theta = Math.atan2(ny, nx) + Math.PI * 0.25;
  if (theta < 0) theta += Math.PI * 2;
  const t = theta / (Math.PI * 2);

  // Smooth hand-drawn circular contour + circumferential bristle streaks (no gear-tooth blobs)
  const contourWobble =
    0.035 * Math.sin(theta * 2 + seed) +
    0.022 * Math.cos(theta * 3 - seed * 0.7) +
    (fbm(t * 5.0, 1.9, seed, 2) - 0.5) * 0.05;
  const baseRadius = 0.80 + contourWobble;
  if (r <= baseRadius - 0.07) return 1;

  // Circumferential brush fibers along `t`, tightly spaced radially across `r`
  const hair = fbm(r * 52.0, t * 7.0, seed + 19, 2) * 0.65 + valueNoise(r * 105.0, t * 13.0, seed + 47) * 0.35;
  const tailDry = smoothstep(0.65, 0.98, t) * 0.28;
  const rimDry = smoothstep(baseRadius - 0.07, baseRadius + 0.05, r);
  const dry = Math.min(0.96, rimDry * 0.85 + tailDry);
  const keep = smoothstep(0.10 + dry * 0.80 - 0.035, 0.10 + dry * 0.80 + 0.035, hair);
  return Math.max(0, Math.min(1, keep * (1 - smoothstep(baseRadius + 0.04, baseRadius + 0.075, r))));
}

/** Hollow hand-swept ink brush ring (`ink-circle-ring`) */
function evalInkCircleRingAlpha(nx, ny, seed) {
  const r = Math.hypot(nx, ny);
  if (r < 0.30 || r > 1.0) return 0;

  let theta = Math.atan2(ny, nx) + Math.PI * 0.35;
  if (theta < 0) theta += Math.PI * 2;
  const t = theta / (Math.PI * 2);

  const wobble = (fbm(t * 7.5, 1.3, seed, 3) - 0.5) * 0.065;
  const baseRadius = 0.72 + wobble;
  const thickness = 0.145 * (1.15 - 0.50 * t) + (fbm(t * 12, 4.7, seed + 11, 2) - 0.5) * 0.035;
  const dist = Math.abs(r - baseRadius);
  if (dist > thickness * 1.15) return 0;

  const bristle = fbm(dist * 56, t * 7.5, seed + 31, 2) * 0.65 + valueNoise(dist * 110, t * 14, seed + 71) * 0.35;
  const tailDry = smoothstep(0.58, 0.97, t) * 0.62;
  const edgeDry = smoothstep(thickness * 0.58, thickness * 1.02, dist) * 0.72;
  const dry = Math.min(0.92, tailDry + edgeDry);

  const endFade = (1 - smoothstep(0.93, 0.995, t)) * smoothstep(0.0, 0.035, t);
  if (dry <= 0.05) return endFade;
  const keep = smoothstep(0.12 + dry * 0.74 - 0.04, 0.12 + dry * 0.74 + 0.04, bristle);
  return Math.max(0, Math.min(1, endFade * keep));
}

/** General sweeping wave/banner brush mask with crisp dry-brush bristle ends (`ink-wave`) */
function evalInkWaveAlpha(nx, ny, seed, { leftDepth = 0.62, rightDepth = 0.86, flipY = false } = {}) {
  const x = (nx + 1) * 0.5;
  const rawY = (ny + 1) * 0.5;
  const y = flipY ? 1 - rawY : rawY;

  const bottomCurve =
    leftDepth + (rightDepth - leftDepth) * smoothstep(0.18, 0.82, x) - 0.03 * Math.sin(x * Math.PI * 2.4);
  const topCurve = 0.03 + 0.06 * (1 - smoothstep(0.0, 0.30, x)) + 0.06 * smoothstep(0.72, 0.98, x);

  const bristle = fbm(x * 3.6, y * 68.0, seed + 17, 2) * 0.64 + valueNoise(x * 8.0, y * 145.0, seed + 61) * 0.36;
  const fray = (bristle - 0.5) * 0.09;

  if (y < topCurve - 0.06 || y > bottomCurve + 0.06) return 0;

  const inTop = smoothstep(topCurve + fray - 0.008, topCurve + fray + 0.008, y);
  const inBot = 1 - smoothstep(bottomCurve + fray * 0.5 - 0.008, bottomCurve + fray * 0.5 + 0.008, y);
  const rightTipPos = 0.85 + bristle * 0.14;
  const leftTipPos = 0.09 - bristle * 0.08;
  const rightTip = 1 - smoothstep(rightTipPos - 0.012, rightTipPos + 0.012, x);
  const leftTip = smoothstep(leftTipPos - 0.012, leftTipPos + 0.012, x);

  return Math.max(0, Math.min(1, inTop * inBot * rightTip * leftTip));
}

function buildPresetPixelStrokes(preset, w, h, angleDeg) {
  if (preset === "ink-band") {
    // True pixel-space angle! Keep vertical clearance inside `0..h` so top/bottom edges never hard-clip
    const deg = angleDeg !== undefined ? Number(angleDeg) : -12;
    const rad = (deg * Math.PI) / 180;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxSpanByHeight = Math.abs(Math.sin(rad)) > 0.05 ? (h * 0.25) / Math.abs(Math.sin(rad)) : w * 0.44;
    const span = Math.min(w * 0.43, maxSpanByHeight);
    const dx = Math.cos(rad) * span;
    const dy = Math.sin(rad) * span;
    const availHalfH = Math.max(h * 0.16, (h * 0.45 - Math.abs(dy)) / Math.max(0.5, Math.abs(Math.cos(rad))));
    const halfWidthPx = Math.min(h * 0.28, availHalfH);
    return [
      {
        x1: cx - dx,
        y1: cy - dy,
        x2: cx + dx,
        y2: cy + dy,
        halfWidthPx,
        fray: 0.36,
        taper: 0.08,
      },
    ];
  }
  if (preset === "ink-slash") {
    // True pixel-space angle from vertical!
    const deg = angleDeg !== undefined ? Number(angleDeg) : -14;
    const rad = (deg * Math.PI) / 180;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const span = h * 0.42;
    const dx = -Math.sin(rad) * span;
    const dy = Math.cos(rad) * span;
    return [
      {
        x1: cx - dx,
        y1: cy - dy,
        x2: cx + dx,
        y2: cy + dy,
        halfWidthPx: w * 0.34,
        fray: 0.30,
        taper: 0.10,
      },
    ];
  }
  return null;
}

export function buildBrushAlphaArray({
  preset = "ink-band",
  strokes,
  width = 800,
  height = 360,
  angle,
  seed = 42,
  leftDepth = 0.62,
  rightDepth = 0.86,
  flipY = false,
} = {}) {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const normPreset = preset === "ink-circle" ? "ink-circle-solid" : preset;
  const alphaArr = new Uint8Array(w * h);

  const pixelStrokes =
    Array.isArray(strokes) && strokes.length > 0
      ? normalizeStrokesToPixels(strokes, w, h)
      : buildPresetPixelStrokes(normPreset, w, h, angle);

  for (let y = 0; y < h; y++) {
    const ny = (y / Math.max(1, h - 1)) * 2 - 1;
    for (let x = 0; x < w; x++) {
      let a = 0;
      if (pixelStrokes) {
        for (let sIdx = 0; sIdx < pixelStrokes.length; sIdx++) {
          const sa = evalDirectedStrokeAlpha(x, y, pixelStrokes[sIdx], seed + sIdx * 131);
          if (sa > a) a = sa;
          if (a >= 0.999) break;
        }
      } else {
        const nx = (x / Math.max(1, w - 1)) * 2 - 1;
        if (normPreset === "ink-circle-solid") {
          a = evalInkCircleSolidAlpha(nx, ny, seed);
        } else if (normPreset === "ink-circle-ring") {
          a = evalInkCircleRingAlpha(nx, ny, seed);
        } else if (normPreset === "ink-wave") {
          a = evalInkWaveAlpha(nx, ny, seed, { leftDepth, rightDepth, flipY });
        } else {
          throw new Error(
            `Unknown brush preset "${preset}". Supported: ink-circle-solid | ink-circle-ring | ink-band | ink-slash | ink-wave (or custom strokes: [...])`
          );
        }
      }
      alphaArr[y * w + x] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return { width: w, height: h, alpha: alphaArr };
}

/**
 * Generates an organic transparent RGBA ink-brush PNG (`outPath` or in-memory `{ buffer }`).
 * Supports both named presets and composable multi-stroke `strokes: [{ from: [x1,y1], to: [x2,y2], width }]`.
 */
export async function createBrushPng({
  preset = "ink-band",
  strokes,
  color = "#C82829",
  opacity = 1,
  width = 800,
  height = 360,
  angle,
  seed = 42,
  leftDepth = 0.62,
  rightDepth = 0.86,
  flipY = false,
  outPath,
} = {}) {
  const { width: w, height: h, alpha } = buildBrushAlphaArray({
    preset,
    strokes,
    width,
    height,
    angle,
    seed,
    leftDepth,
    rightDepth,
    flipY,
  });
  const { r, g, b } = parseHexRgb(color);
  const clampedOpacity = Math.max(0, Math.min(1, Number(opacity ?? 1)));

  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = Math.round(alpha[i] * clampedOpacity);
    const off = i * 4;
    rgba[off] = a > 0 ? r : 0;
    rgba[off + 1] = a > 0 ? g : 0;
    rgba[off + 2] = a > 0 ? b : 0;
    rgba[off + 3] = a;
  }

  const pngBuf = encodeRgbaPng(w, h, rgba);
  const effectivePreset = Array.isArray(strokes) && strokes.length > 0 ? `multi-stroke(${strokes.length})` : preset;
  if (outPath) {
    const resolved = path.resolve(outPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, pngBuf);
    return { path: resolved, width: w, height: h, bytes: pngBuf.length, preset: effectivePreset };
  }
  return { buffer: pngBuf, width: w, height: h, bytes: pngBuf.length, preset: effectivePreset };
}

// ============================================================================
// Pure Node.js Image Resize, Multi-Bucket Border Flood-Fill & Alpha Compositor
// ============================================================================
async function loadAnyImageAsRgba(filePath) {
  const abs = path.resolve(filePath);
  const raw = await fs.readFile(abs);
  if (raw.length >= 8 && raw[0] === 137 && raw[1] === 80 && raw[2] === 78 && raw[3] === 71) {
    return decodePngToRgba(raw);
  }

  // Non-PNG (.jpg / .jpeg / .webp): convert to temporary PNG via Pillow, macOS `sips`, Windows PowerShell, or `ffmpeg`
  const tmpPng = path.join(os.tmpdir(), `ym-imgconv-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    const tc = discoverRenderToolchain();
    if (tc.python3 && tc.hasPillow) {
      const r = spawnSync(
        tc.python3,
        ["-c", "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2], 'PNG')", abs, tmpPng],
        { encoding: "utf8" }
      );
      if (r.status === 0 && existsSync(tmpPng)) {
        return decodePngToRgba(await fs.readFile(tmpPng));
      }
    }
    if (process.platform === "darwin" && existsSync("/usr/bin/sips")) {
      const r = spawnSync("/usr/bin/sips", ["-s", "format", "png", abs, "--out", tmpPng], { encoding: "utf8" });
      if (r.status === 0 && existsSync(tmpPng)) {
        return decodePngToRgba(await fs.readFile(tmpPng));
      }
    }
    if (process.platform === "win32") {
      const psCmd = `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${abs.replace(/'/g, "''")}'); $img.Save('${tmpPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose()`;
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCmd], { encoding: "utf8" });
      if (r.status === 0 && existsSync(tmpPng)) {
        return decodePngToRgba(await fs.readFile(tmpPng));
      }
    }
    const ff = spawnSync("ffmpeg", ["-y", "-i", abs, tmpPng], { encoding: "utf8" });
    if (ff.status === 0 && existsSync(tmpPng)) {
      return decodePngToRgba(await fs.readFile(tmpPng));
    }
    throw new Error(
      `Unable to decode non-PNG image "${abs}" without Pillow/sips/PowerShell/ffmpeg. Convert source to .png or install Pillow.`
    );
  } finally {
    await fs.unlink(tmpPng).catch(() => {});
  }
}

function resizeRgbaCover(src, dstW, dstH) {
  const { width: sw, height: sh, rgba } = src;
  const scale = Math.max(dstW / sw, dstH / sh);
  const cropW = dstW / scale;
  const cropH = dstH / scale;
  const offX = (sw - cropW) * 0.5;
  const offY = (sh - cropH) * 0.5;

  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.max(0, Math.min(sh - 1, offY + ((y + 0.5) / dstH) * cropH - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;

    for (let x = 0; x < dstW; x++) {
      const sx = Math.max(0, Math.min(sw - 1, offX + ((x + 0.5) / dstW) * cropW - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;

      const p00 = (y0 * sw + x0) * 4;
      const p10 = (y0 * sw + x1) * 4;
      const p01 = (y1 * sw + x0) * 4;
      const p11 = (y1 * sw + x1) * 4;
      const d = (y * dstW + x) * 4;

      for (let c = 0; c < 4; c++) {
        const top = rgba[p00 + c] * (1 - wx) + rgba[p10 + c] * wx;
        const bot = rgba[p01 + c] * (1 - wx) + rgba[p11 + c] * wx;
        out[d + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return out;
}

function resizeAlphaChannelBilinear(srcAlpha, sw, sh, dstW, dstH) {
  if (sw === dstW && sh === dstH) return new Uint8Array(srcAlpha);
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.max(0, Math.min(sh - 1, ((y + 0.5) / dstH) * sh - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.max(0, Math.min(sw - 1, ((x + 0.5) / dstW) * sw - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const top = srcAlpha[y0 * sw + x0] * (1 - wx) + srcAlpha[y0 * sw + x1] * wx;
      const bot = srcAlpha[y1 * sw + x0] * (1 - wx) + srcAlpha[y1 * sw + x1] * wx;
      out[y * dstW + x] = Math.round(top * (1 - wy) + bot * wy);
    }
  }
  return out;
}

function boxBlurAlpha(alpha, w, h, radiusPx = 1) {
  const r = Math.max(0, Math.round(radiusPx));
  if (r <= 0) return alpha;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        sum += alpha[y * w + k];
        cnt++;
      }
      tmp[y * w + x] = Math.round(sum / cnt);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        sum += tmp[k * w + x];
        cnt++;
      }
      out[y * w + x] = Math.round(sum / cnt);
    }
  }
  return out;
}

function extractRefFloodFillAlpha({
  refImg,
  refCrop,
  refCoordSpace = "canvas",
  bgRgb,
  bgTolerance = 28,
  targetW,
  targetH,
  feather = 1,
}) {
  const { width: rw, height: rh, rgba } = refImg;
  let cx0 = 0;
  let cy0 = 0;
  let cx1 = rw;
  let cy1 = rh;

  if (Array.isArray(refCrop) && refCrop.length === 4) {
    const [x, y, cw, ch] = refCrop.map(Number);
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && cw > 0 && cw <= 1 && ch > 0 && ch <= 1) {
      cx0 = Math.round(x * rw);
      cy0 = Math.round(y * rh);
      cx1 = Math.round((x + cw) * rw);
      cy1 = Math.round((y + ch) * rh);
    } else if (refCoordSpace === "raw") {
      cx0 = Math.round(x);
      cy0 = Math.round(y);
      cx1 = Math.round(x + cw);
      cy1 = Math.round(y + ch);
    } else {
      // Default: `1280 x 720` slide canvas coordinates (matching `inspect-ref`, `diff`, and `images.add`)!
      const sx = rw / 1280;
      const sy = rh / 720;
      cx0 = Math.round(x * sx);
      cy0 = Math.round(y * sy);
      cx1 = Math.round((x + cw) * sx);
      cy1 = Math.round((y + ch) * sy);
    }
  }

  cx0 = Math.max(0, Math.min(rw - 2, cx0));
  cy0 = Math.max(0, Math.min(rh - 2, cy0));
  cx1 = Math.max(cx0 + 2, Math.min(rw, cx1));
  cy1 = Math.max(cy0 + 2, Math.min(rh, cy1));
  const subW = cx1 - cx0;
  const subH = cy1 - cy0;

  // Extract cropped sub-image & downsample to <=480px wide for fast BFS
  const subRgba = new Uint8Array(subW * subH * 4);
  for (let y = 0; y < subH; y++) {
    const srcStart = ((cy0 + y) * rw + cx0) * 4;
    subRgba.set(rgba.subarray(srcStart, srcStart + subW * 4), y * subW * 4);
  }
  const mw = Math.min(subW, 480);
  const mh = Math.max(2, Math.round((mw * subH) / subW));
  const small = resizeRgbaCover({ width: subW, height: subH, rgba: subRgba }, mw, mh);

  // Multi-bucket border palette estimation (handles two-tone wash e.g. white + light-gray brush!)
  const bgCenters = [];
  if (bgRgb) {
    bgCenters.push(bgRgb);
  } else {
    const buckets = new Map();
    const pushBorder = (bx, by) => {
      const off = (by * mw + bx) * 4;
      const r = small[off];
      const g = small[off + 1];
      const b = small[off + 2];
      const key = `${r >> 4}_${g >> 4}_${b >> 4}`;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push([r, g, b]);
    };
    for (let x = 0; x < mw; x++) {
      pushBorder(x, 0);
      pushBorder(x, mh - 1);
    }
    for (let y = 1; y < mh - 1; y++) {
      pushBorder(0, y);
      pushBorder(mw - 1, y);
    }
    const totalBorder = 2 * mw + 2 * (mh - 2);
    const sortedBuckets = [...buckets.values()].sort((a, b) => b.length - a.length);
    for (const group of sortedBuckets.slice(0, 4)) {
      if (bgCenters.length === 0 || group.length >= totalBorder * 0.06) {
        const mid = group.length >> 1;
        bgCenters.push([
          group.map((c) => c[0]).sort((a, b) => a - b)[mid],
          group.map((c) => c[1]).sort((a, b) => a - b)[mid],
          group.map((c) => c[2]).sort((a, b) => a - b)[mid],
        ]);
      }
    }
  }

  const tol = Number(bgTolerance ?? 28);
  const isBgPixel = (idx) => {
    const off = idx * 4;
    if (small[off + 3] < 24) return true;
    const r = small[off];
    const g = small[off + 1];
    const b = small[off + 2];
    for (let i = 0; i < bgCenters.length; i++) {
      const c = bgCenters[i];
      if (Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol) {
        return true;
      }
    }
    return false;
  };

  // Exterior 4-neighbor BFS flood-fill (0 interior holes!)
  const visited = new Uint8Array(mw * mh);
  const queue = new Int32Array(mw * mh);
  let head = 0;
  let tail = 0;
  const trySeed = (sx, sy) => {
    const idx = sy * mw + sx;
    if (!visited[idx] && isBgPixel(idx)) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let x = 0; x < mw; x++) {
    trySeed(x, 0);
    trySeed(x, mh - 1);
  }
  for (let y = 1; y < mh - 1; y++) {
    trySeed(0, y);
    trySeed(mw - 1, y);
  }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % mw;
    const cy = (cur - cx) / mw;
    if (cx > 0) trySeed(cx - 1, cy);
    if (cx + 1 < mw) trySeed(cx + 1, cy);
    if (cy > 0) trySeed(cx, cy - 1);
    if (cy + 1 < mh) trySeed(cx, cy + 1);
  }

  const smallAlpha = new Uint8Array(mw * mh);
  let fgTotal = 0;
  for (let i = 0; i < mw * mh; i++) {
    if (!visited[i]) {
      smallAlpha[i] = 255;
      fgTotal++;
    }
  }

  // Prune disconnected small foreground islands (e.g., stray captions like "熬夜加班", page numbers, or watermarks
  // caught inside `refCrop`) by keeping only connected components >= 10% of the largest foreground component!
  let opaqueCount = fgTotal;
  if (fgTotal > 0) {
    const compId = new Int32Array(mw * mh);
    const compSizes = [0];
    const cQueue = new Int32Array(mw * mh);
    let cid = 0;
    let maxCompSize = 0;
    for (let i = 0; i < mw * mh; i++) {
      if (smallAlpha[i] === 255 && compId[i] === 0) {
        cid++;
        let ch = 0;
        let ct = 0;
        compId[i] = cid;
        cQueue[ct++] = i;
        while (ch < ct) {
          const cur = cQueue[ch++];
          const cx = cur % mw;
          const cy = (cur - cx) / mw;
          const neighbors = [
            cx > 0 ? cur - 1 : -1,
            cx + 1 < mw ? cur + 1 : -1,
            cy > 0 ? cur - mw : -1,
            cy + 1 < mh ? cur + mw : -1,
          ];
          for (let k = 0; k < 4; k++) {
            const nb = neighbors[k];
            if (nb >= 0 && smallAlpha[nb] === 255 && compId[nb] === 0) {
              compId[nb] = cid;
              cQueue[ct++] = nb;
            }
          }
        }
        compSizes.push(ct);
        if (ct > maxCompSize) maxCompSize = ct;
      }
    }
    const minKeepSize = Math.max(8, Math.floor(maxCompSize * 0.12));
    opaqueCount = 0;
    for (let i = 0; i < mw * mh; i++) {
      if (smallAlpha[i] === 255) {
        if (compSizes[compId[i]] >= minKeepSize) {
          opaqueCount++;
        } else {
          smallAlpha[i] = 0;
        }
      }
    }
  }
  const opaqueRatio = Number((opaqueCount / Math.max(1, mw * mh)).toFixed(3));
  const resized = resizeAlphaChannelBilinear(smallAlpha, mw, mh, targetW, targetH);
  const feathered = feather > 0 ? boxBlurAlpha(resized, targetW, targetH, Math.round(feather)) : resized;

  const bleedWarning = opaqueRatio < 0.15 || opaqueRatio > 0.90;
  return {
    alpha: feathered,
    opaqueRatio,
    bleedWarning,
    ...(bleedWarning
      ? {
          warning:
            opaqueRatio < 0.15
              ? `Flood-fill retained only ${(opaqueRatio * 100).toFixed(1)}% area (reference subject likely shares background color and bled inward). Consider passing composable strokes: [{ from, to, width }] instead.`
              : `Flood-fill retained ${(opaqueRatio * 100).toFixed(1)}% area (border crop may lie inside subject or background contrast is low). Verify refCrop on 1280x720 canvas or use strokes.`,
        }
      : {}),
  };
}

/**
 * Applies an organic brush Alpha mask to a target photo (`fit: "cover"`), outputting a crisp RGBA PNG.
 * Supports:
 * 1) `strokes`: composable multi-stroke brush `[{ from: [x1,y1], to: [x2,y2], width }]`
 * 2) `maskPreset`: "ink-slash" | "ink-wave" | "ink-band" | "ink-circle-solid" | "ink-circle-ring"
 * 3) `refMaskPath` (+ `refCrop: [x,y,w,h]` on 1280x720 slide canvas): border flood-fill silhouette extraction
 */
export async function applyAlphaMaskToImage({
  imagePath,
  strokes,
  maskPreset,
  maskPngPath,
  refMaskPath,
  refCrop,
  refCoordSpace = "canvas",
  bgColor,
  bgTolerance = 28,
  feather = 1,
  width = 600,
  height = 800,
  angle,
  seed = 42,
  leftDepth = 0.62,
  rightDepth = 0.86,
  flipY = false,
  outPath,
} = {}) {
  const resolvedSrc = path.resolve(imagePath || "");
  if (!existsSync(resolvedSrc)) {
    throw new Error(`applyAlphaMaskToImage: source image not found: ${resolvedSrc}`);
  }
  if (!outPath) {
    throw new Error("applyAlphaMaskToImage requires outPath");
  }
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const resolvedOut = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });

  const srcImg = await loadAnyImageAsRgba(resolvedSrc);
  const fittedRgba = resizeRgbaCover(srcImg, w, h);

  let finalAlpha;
  let extraMeta = {};

  if (maskPngPath) {
    const maskImg = await loadAnyImageAsRgba(maskPngPath);
    const rawMaskAlpha = new Uint8Array(maskImg.width * maskImg.height);
    for (let i = 0; i < rawMaskAlpha.length; i++) rawMaskAlpha[i] = maskImg.rgba[i * 4 + 3];
    finalAlpha = resizeAlphaChannelBilinear(rawMaskAlpha, maskImg.width, maskImg.height, w, h);
  } else if (refMaskPath) {
    const refImg = await loadAnyImageAsRgba(refMaskPath);
    const parsedBg = bgColor ? parseHexRgb(bgColor) : null;
    const flood = extractRefFloodFillAlpha({
      refImg,
      refCrop,
      refCoordSpace,
      bgRgb: parsedBg ? [parsedBg.r, parsedBg.g, parsedBg.b] : null,
      bgTolerance,
      targetW: w,
      targetH: h,
      feather,
    });
    finalAlpha = flood.alpha;
    extraMeta = {
      opaqueRatio: flood.opaqueRatio,
      bleedWarning: flood.bleedWarning,
      ...(flood.warning ? { warning: flood.warning } : {}),
    };
  } else {
    finalAlpha = buildBrushAlphaArray({
      preset: maskPreset || "ink-slash",
      strokes,
      width: w,
      height: h,
      angle,
      seed,
      leftDepth,
      rightDepth,
      flipY,
    }).alpha;
  }

  for (let i = 0; i < w * h; i++) {
    fittedRgba[i * 4 + 3] = Math.round((fittedRgba[i * 4 + 3] * finalAlpha[i]) / 255);
  }

  const outBuf = encodeRgbaPng(w, h, fittedRgba);
  await fs.writeFile(resolvedOut, outBuf);
  return {
    ok: true,
    outPath: resolvedOut,
    width: w,
    height: h,
    bytes: outBuf.length,
    ...extraMeta,
  };
}
