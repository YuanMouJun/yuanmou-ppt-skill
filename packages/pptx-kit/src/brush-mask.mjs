// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Zero-dependency procedural organic ink-brush RGBA PNG generator & hole-free Alpha-mask image compositor.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

// ============================================================================
// Pure Node.js RGBA PNG Encoder (zlib + CRC32, zero third-party deps)
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

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodeRgbaPng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter None
    rgba.copy(raw, rowOff + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ============================================================================
// Deterministic Value Noise & Smooth Math Helpers
// ============================================================================
function parseHexRgb(hex = "#C82829") {
  const clean = String(hex).trim().replace(/^#/, "");
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

// ============================================================================
// General-Purpose Organic Ink-Brush Alpha Field Evaluators (0..1)
// ============================================================================

/** Solid organic ink stamp circle (ideal behind white bold display text) */
function evalInkCircleSolidAlpha(nx, ny, seed) {
  const r = Math.hypot(nx, ny);
  if (r > 0.99) return 0;

  const theta = Math.atan2(ny, nx);
  const angU = (theta + Math.PI) / (Math.PI * 2);

  // Subtle hand-painted radial organic wobble + outer dry-brush bristles
  const wobble =
    (fbm(Math.cos(theta) * 2.4 + 3.1, Math.sin(theta) * 2.4 + 1.7, seed, 3) - 0.5) * 0.14 +
    (fbm(Math.cos(theta) * 6.5, Math.sin(theta) * 6.5, seed + 17, 2) - 0.5) * 0.055;
  const outerR = 0.80 + wobble;

  // Solid center keeps text crisp & legible (r < 0.64 is ~98% opaque)
  const core = 1 - smoothstep(outerR - 0.10, outerR + 0.06, r);
  if (core <= 0.01) return 0;

  // Concentric & radial dry-brush flying-white notches strictly near outer rim
  const rimZone = smoothstep(outerR - 0.20, outerR + 0.04, r);
  const bristle = fbm(r * 38.0, angU * 26.0, seed + 43, 3);
  const micro = valueNoise(nx * 28.0, ny * 28.0, seed + 71);
  const rimKeep = smoothstep(0.20 + rimZone * 0.44, 0.44 + rimZone * 0.36, bristle * 0.72 + micro * 0.28);

  return Math.max(0, Math.min(1, core * (1 - rimZone * 0.78 + rimZone * 0.78 * rimKeep)));
}

/** Hollow hand-swept ink brush ring (with dry-brush tail & subtle gap) */
function evalInkCircleRingAlpha(nx, ny, seed) {
  const r = Math.hypot(nx, ny);
  if (r < 0.28 || r > 0.99) return 0;

  let theta = Math.atan2(ny, nx) + Math.PI * 0.35;
  if (theta < 0) theta += Math.PI * 2;
  const t = theta / (Math.PI * 2);

  const wobble = (fbm(t * 7.5, 1.3, seed, 3) - 0.5) * 0.075;
  const baseRadius = 0.72 + wobble;
  const thickness = 0.145 * (1.15 - 0.55 * t) + (fbm(t * 14, 4.7, seed + 11, 2) - 0.5) * 0.04;

  const dist = Math.abs(r - baseRadius);
  const bristle = fbm(r * 48, t * 9.0, seed + 31, 3);
  const edgeNoise = (fbm(nx * 14, ny * 14, seed + 53, 3) - 0.5) * 0.055;

  const core = 1 - smoothstep(thickness * 0.55, thickness + edgeNoise, dist);
  if (core <= 0.01) return 0;

  const tailDryness = smoothstep(0.55, 0.98, t);
  const edgeDryness = smoothstep(thickness * 0.35, thickness, dist);
  const dryThreshold = 0.18 + 0.38 * tailDryness + 0.24 * edgeDryness;
  const inkMask = smoothstep(dryThreshold - 0.12, dryThreshold + 0.12, bristle);

  const endFade = 1 - smoothstep(0.92, 0.995, t);
  const startFade = smoothstep(0.0, 0.04, t);

  return Math.max(0, Math.min(1, core * (0.35 + 0.65 * inkMask) * endFade * startFade));
}

/** Wide horizontal/slanted organic ink brush band */
function evalInkBandAlpha(nx, ny, seed, angleDeg = -8) {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = nx * cos - ny * sin;
  const ry = nx * sin + ny * cos;

  const edgeWobble = (fbm(rx * 5.2, ry * 2.1, seed, 3) - 0.5) * 0.20;
  const halfH = 0.52 + edgeWobble;
  const distY = Math.abs(ry);

  const bristle = fbm(rx * 3.8, ry * 42.0, seed + 19, 3);
  const fineStreak = valueNoise(rx * 9.0, ry * 90.0, seed + 41);

  const verticalCore = 1 - smoothstep(halfH * 0.62, halfH + 0.15, distY);
  if (verticalCore <= 0.01) return 0;

  const endJitter = (bristle - 0.5) * 0.26 + (fineStreak - 0.5) * 0.14;
  const horizCore = 1 - smoothstep(0.74, 0.96 + endJitter, Math.abs(rx));

  const edgeFactor = Math.max(
    smoothstep(halfH * 0.45, halfH + 0.12, distY),
    smoothstep(0.68, 0.95, Math.abs(rx))
  );
  const streakKeep = smoothstep(
    0.18 + edgeFactor * 0.48,
    0.38 + edgeFactor * 0.45,
    bristle * 0.7 + fineStreak * 0.3
  );

  return Math.max(0, Math.min(1, verticalCore * horizCore * (1 - edgeFactor * 0.75 + edgeFactor * 0.75 * streakKeep)));
}

/** Continuous slanted vertical/diagonal ink brush stroke (ZERO horizontal seam discontinuities!) */
function evalInkSlashAlpha(nx, ny, seed, angleDeg = -16) {
  // Rotate smoothly by angleDeg so the entire brush runs along one continuous diagonal axis
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = nx * cos - ny * sin;
  const ry = nx * sin + ny * cos;

  // Smooth continuous S-curve centerline & subtle width taper along stroke length (ry in [-1, 1])
  const centerX = 0.10 * Math.sin(ry * Math.PI * 0.85) + (fbm(ry * 2.5, 1.1, seed, 2) - 0.5) * 0.08;
  const halfW = 0.46 + 0.10 * Math.cos(ry * Math.PI * 0.75) + (fbm(ry * 4.5, 2.7, seed + 13, 3) - 0.5) * 0.10;
  const distX = Math.abs(rx - centerX);

  // Longitudinal bristle streaks running smoothly along ry (stroke direction)
  const bristle = fbm(rx * 44.0, ry * 3.6, seed + 7, 3);
  const fine = valueNoise(rx * 88.0, ry * 8.0, seed + 29);
  const sideWobble = (bristle - 0.5) * 0.10 + (fine - 0.5) * 0.04;

  const inWidth = 1 - smoothstep(halfW * 0.68, halfW + 0.10 + sideWobble, distX);
  if (inWidth <= 0.01) return 0;

  // Tapered organic frayed bristles at top & bottom stroke tips
  const tipJitter = (bristle - 0.5) * 0.24 + (fine - 0.5) * 0.12;
  const inLen = 1 - smoothstep(0.68, 0.94 + tipJitter, Math.abs(ry));

  const edgeFactor = Math.max(
    smoothstep(halfW * 0.56, halfW + 0.08, distX),
    smoothstep(0.60, 0.92, Math.abs(ry))
  );
  const whisker = smoothstep(
    0.20 + edgeFactor * 0.44,
    0.42 + edgeFactor * 0.40,
    bristle * 0.72 + fine * 0.28
  );

  return Math.max(0, Math.min(1, inWidth * inLen * (1 - edgeFactor * 0.76 + edgeFactor * 0.76 * whisker)));
}

/** General sweeping organic wave brush mask (configurable left/right profile & flip) */
function evalInkWaveAlpha(nx, ny, seed, { leftDepth = 0.62, rightDepth = 0.86, flipY = false } = {}) {
  const x = (nx + 1) * 0.5; // 0..1
  const rawY = (ny + 1) * 0.5;
  const y = flipY ? 1 - rawY : rawY;

  const bottomCurve =
    leftDepth + (rightDepth - leftDepth) * smoothstep(0.22, 0.78, x) - 0.035 * Math.sin(x * Math.PI * 2.5);
  const topCurve = 0.04 + 0.08 * (1 - smoothstep(0.0, 0.35, x)) + 0.08 * smoothstep(0.68, 0.98, x);

  const bristle = fbm(x * 4.2, y * 52.0, seed + 17, 3);
  const fine = valueNoise(x * 10.0, y * 104.0, seed + 61);
  const fray = (bristle - 0.5) * 0.11 + (fine - 0.5) * 0.045;

  const inTop = smoothstep(topCurve - 0.04 + fray, topCurve + 0.04 + fray, y);
  const inBot = 1 - smoothstep(bottomCurve - 0.035 + fray * 0.4, bottomCurve + 0.035 + fray * 0.4, y);
  const rightTip = 1 - smoothstep(0.84, 0.99 + fray * 1.3, x);
  const leftTip = smoothstep(0.01 + fray * 0.8, 0.10, x);

  const base = inTop * inBot * rightTip * leftTip;
  if (base <= 0.01) return 0;

  const edgeZone = Math.max(
    smoothstep(0.78, 0.97, x),
    1 - smoothstep(topCurve, topCurve + 0.12, y),
    smoothstep(bottomCurve - 0.09, bottomCurve + 0.02, y)
  );
  const streak = smoothstep(
    0.18 + edgeZone * 0.44,
    0.40 + edgeZone * 0.40,
    bristle * 0.72 + fine * 0.28
  );
  return Math.max(0, Math.min(1, base * (1 - edgeZone * 0.65 + edgeZone * 0.65 * streak)));
}

function buildBrushAlphaBuffer({
  preset = "ink-band",
  width = 800,
  height = 360,
  angle,
  seed = 42,
  leftDepth = 0.62,
  rightDepth = 0.86,
  flipY = false,
}) {
  const alpha = new Uint8Array(width * height);
  const normPreset = preset === "ink-circle" ? "ink-circle-solid" : preset;
  const bandAngle = Number.isFinite(Number(angle)) ? Number(angle) : -8;
  const slashAngle = Number.isFinite(Number(angle)) ? Number(angle) : -16;
  for (let py = 0; py < height; py++) {
    const ny = (py / Math.max(1, height - 1)) * 2 - 1;
    for (let px = 0; px < width; px++) {
      const nx = (px / Math.max(1, width - 1)) * 2 - 1;
      let a = 0;
      if (normPreset === "ink-circle-solid") a = evalInkCircleSolidAlpha(nx, ny, seed);
      else if (normPreset === "ink-circle-ring") a = evalInkCircleRingAlpha(nx, ny, seed);
      else if (normPreset === "ink-slash") a = evalInkSlashAlpha(nx, ny, seed, slashAngle);
      else if (normPreset === "ink-wave") a = evalInkWaveAlpha(nx, ny, seed, { leftDepth, rightDepth, flipY });
      else a = evalInkBandAlpha(nx, ny, seed, bandAngle);
      alpha[py * width + px] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }
  return alpha;
}

/**
 * Generates a transparent-background organic ink-brush RGBA PNG (zero third-party deps).
 * Presets: "ink-circle-solid" (alias "ink-circle") | "ink-circle-ring" | "ink-band" | "ink-slash" | "ink-wave"
 */
export async function createBrushPng({
  preset = "ink-band",
  width = 800,
  height = 360,
  color = "#E5E7EB",
  opacity = 1,
  angle,
  seed = 42,
  leftDepth = 0.62,
  rightDepth = 0.86,
  flipY = false,
  outPath,
} = {}) {
  const w = Math.max(32, Math.min(2400, Math.round(width)));
  const h = Math.max(32, Math.min(2400, Math.round(height)));
  const { r, g, b } = parseHexRgb(color);
  const alphaScale = Math.max(0, Math.min(1, Number(opacity ?? 1)));

  const alphaField = buildBrushAlphaBuffer({ preset, width: w, height: h, angle, seed, leftDepth, rightDepth, flipY });
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = Math.round(alphaField[i] * alphaScale);
    const off = i * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = a;
  }

  const pngBuf = encodeRgbaPng(w, h, rgba);
  if (outPath) {
    const resolved = path.resolve(outPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, pngBuf);
    return { path: resolved, width: w, height: h, bytes: pngBuf.length, preset };
  }
  return { buffer: pngBuf, width: w, height: h, bytes: pngBuf.length, preset };
}

// ============================================================================
// Hole-Free Alpha-Mask Image Compositor (Preset Mask OR Corner Flood-Fill Silhouette)
// ============================================================================
const PY_APPLY_MASK = `
import json, sys
from collections import deque
from PIL import Image, ImageOps, ImageFilter

cfg = json.loads(sys.argv[1])
src = Image.open(cfg["imagePath"]).convert("RGBA")
w, h = int(cfg["width"]), int(cfg["height"])
fitted = ImageOps.fit(src, (w, h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

if cfg.get("maskPngPath"):
    mask_img = Image.open(cfg["maskPngPath"]).convert("RGBA").resize((w, h), Image.Resampling.LANCZOS)
    alpha = mask_img.split()[3]
elif cfg.get("refMaskPath"):
    ref = Image.open(cfg["refMaskPath"]).convert("RGB")
    rw, rh = ref.size
    crop = cfg.get("refCrop")
    if crop and len(crop) == 4:
        x, y, cw, ch = crop
        if 0 <= x <= 1 and 0 <= y <= 1 and 0 < cw <= 1 and 0 < ch <= 1:
            box = (int(x * rw), int(y * rh), int((x + cw) * rw), int((y + ch) * rh))
        else:
            box = (int(x), int(y), int(x + cw), int(y + ch))
        ref = ref.crop(box)
    # Downsample slightly for fast BFS border flood-fill, then upsample smoothly to (w, h)
    mw = min(w, 480)
    mh = max(1, int(mw * h / max(1, w)))
    small = ref.resize((mw, mh), Image.Resampling.LANCZOS)
    px = small.load()

    # Estimate background RGB from the modal color bucket along the outer 1px border (or explicit bgColor)
    if cfg.get("bgRgb"):
        bg_r, bg_g, bg_b = [int(v) for v in cfg["bgRgb"]]
    else:
        buckets = {}
        border_pts = []
        for x in range(mw):
            border_pts.append(px[x, 0])
            border_pts.append(px[x, mh - 1])
        for y in range(1, mh - 1):
            border_pts.append(px[0, y])
            border_pts.append(px[mw - 1, y])
        for p in border_pts:
            key = (p[0] // 16, p[1] // 16, p[2] // 16)
            buckets.setdefault(key, []).append(p)
        dominant = max(buckets.values(), key=len)
        m = len(dominant) // 2
        bg_r = sorted(c[0] for c in dominant)[m]
        bg_g = sorted(c[1] for c in dominant)[m]
        bg_b = sorted(c[2] for c in dominant)[m]
    tol = int(cfg.get("bgTolerance", 28))

    def is_bg(r, g, b):
        return abs(r - bg_r) <= tol and abs(g - bg_g) <= tol and abs(b - bg_b) <= tol

    # Exterior border BFS flood-fill: ONLY connected exterior background becomes transparent.
    # Bright highlights / white clothes / white plates INSIDE the subject remain 100% opaque (0 Swiss-cheese holes)!
    visited = bytearray(mw * mh)
    q = deque()
    for x in range(mw):
        for y in (0, mh - 1):
            if is_bg(*px[x, y]):
                idx = y * mw + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))
    for y in range(mh):
        for x in (0, mw - 1):
            if is_bg(*px[x, y]):
                idx = y * mw + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))

    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < mw and 0 <= ny < mh:
                idx = ny * mw + nx
                if not visited[idx] and is_bg(*px[nx, ny]):
                    visited[idx] = 1
                    q.append((nx, ny))

    mask_bytes = bytes(0 if visited[i] else 255 for i in range(mw * mh))
    alpha_small = Image.frombytes("L", (mw, mh), mask_bytes)
    alpha = alpha_small.resize((w, h), Image.Resampling.LANCZOS)
    feather = float(cfg.get("feather", 0.8))
    if feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=feather))
else:
    raise RuntimeError("Either maskPngPath or refMaskPath must be provided")

fitted.putalpha(alpha)
fitted.save(cfg["outPath"], "PNG", optimize=True)
print(json.dumps({"ok": True, "outPath": cfg["outPath"], "width": w, "height": h}))
`;

/**
 * Applies an organic brush Alpha mask to a target photo (`fit: "cover"`), outputting a crisp RGBA PNG.
 * Supports:
 * 1) `maskPreset`: "ink-slash" | "ink-wave" | "ink-band" | "ink-circle-solid" | "ink-circle-ring"
 * 2) `refMaskPath` (+ optional `refCrop: [x,y,w,h]`): border flood-fill silhouette extraction (0 ref RGB retained, 0 interior holes).
 */
export async function applyAlphaMaskToImage({
  imagePath,
  maskPreset,
  maskPngPath,
  refMaskPath,
  refCrop,
  bgColor,
  bgTolerance = 28,
  feather = 0.8,
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
  const resolvedOut = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });

  let tempMask = null;
  let effectiveMaskPng = maskPngPath ? path.resolve(maskPngPath) : null;

  if (!effectiveMaskPng && !refMaskPath) {
    tempMask = path.join(os.tmpdir(), `yuanmou-mask-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await createBrushPng({
      preset: maskPreset || "ink-slash",
      width,
      height,
      color: "#000000",
      opacity: 1,
      angle,
      seed,
      leftDepth,
      rightDepth,
      flipY,
      outPath: tempMask,
    });
    effectiveMaskPng = tempMask;
  }

  try {
    const parsedBg = bgColor ? parseHexRgb(bgColor) : null;
    const payload = {
      imagePath: resolvedSrc,
      maskPngPath: effectiveMaskPng,
      refMaskPath: refMaskPath ? path.resolve(refMaskPath) : null,
      refCrop: refCrop || null,
      bgRgb: parsedBg ? [parsedBg.r, parsedBg.g, parsedBg.b] : null,
      bgTolerance,
      feather,
      width,
      height,
      outPath: resolvedOut,
    };
    const res = spawnSync("python3", ["-c", PY_APPLY_MASK, JSON.stringify(payload)], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`applyAlphaMaskToImage failed: ${res.stderr || res.stdout}`);
    }
    const parsed = JSON.parse(res.stdout.trim());
    const st = await fs.stat(resolvedOut);
    return { ...parsed, bytes: st.size };
  } finally {
    if (tempMask) {
      await fs.unlink(tempMask).catch(() => {});
    }
  }
}
