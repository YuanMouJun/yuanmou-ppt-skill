// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

export const EMU_PER_INCH = 914400;
export const EMU_PER_PX = 9525; // 96 DPI CSS pixel
export const EMU_PER_PT = 12700; // 72 DPI typographic point
export const PX_TO_PT = 0.75; // 72 / 96

export const ROUNDED_TOKENS_PX = Object.freeze({
  "rounded-none": 0,
  "rounded-xs": 2,
  "rounded-sm": 4,
  rounded: 6,
  "rounded-md": 8,
  "rounded-lg": 12,
  "rounded-xl": 16,
  "rounded-2xl": 20,
  "rounded-3xl": 28,
  "rounded-full": 9999,
});

export function pxToEmu(px) {
  if (typeof px !== "number" || !Number.isFinite(px)) return 0;
  return Math.round(px * EMU_PER_PX);
}

export function emuToPx(emu) {
  if (typeof emu !== "number" || !Number.isFinite(emu)) return 0;
  return Number((emu / EMU_PER_PX).toFixed(3));
}

export function ptToEmu(pt) {
  if (typeof pt !== "number" || !Number.isFinite(pt)) return 0;
  return Math.round(pt * EMU_PER_PT);
}

export function degToOoxmlAngle(deg) {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return 0;
  const normalized = ((deg % 360) + 360) % 360;
  return Math.round(normalized * 60000);
}

/**
 * Converts numeric typographic points (pt, PowerPoint/WPS standard) or explicit unit strings
 * ("20pt", "28px") into OpenXML hundredths of a point (e.g. 20 / "20pt" -> 2000, "28px" -> 2100).
 */
export function parseFontSizeToHundredthsPt(input, fallbackPt = 14) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return Math.max(100, Math.round(input * 100));
  }
  if (typeof input === "string") {
    const trimmed = input.trim().toLowerCase();
    const m = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(pt|px)?$/);
    if (m) {
      const num = Number.parseFloat(m[1]);
      const unit = m[2] || "pt";
      if (unit === "px") return Math.max(100, Math.round(num * PX_TO_PT * 100));
      return Math.max(100, Math.round(num * 100));
    }
  }
  return Math.max(100, Math.round(fallbackPt * 100));
}

export function fontSizeToPx(input, fallbackPt = 14) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input / PX_TO_PT;
  if (typeof input === "string") {
    const trimmed = input.trim().toLowerCase();
    const m = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(pt|px)?$/);
    if (m) {
      const num = Number.parseFloat(m[1]);
      const unit = m[2] || "pt";
      return unit === "px" ? num : num / PX_TO_PT;
    }
  }
  return fallbackPt / PX_TO_PT;
}

/**
 * Resolves pixel or token borderRadius into exact OpenXML roundRect `adj` (0..50000).
 * In DrawingML `roundRect`, cornerRadius = (adj / 100000) * min(width, height).
 */
export function resolveBorderRadius(borderRadius, widthPx = 100, heightPx = 100) {
  if (borderRadius === undefined || borderRadius === null || borderRadius === false) {
    return { radiusPx: 0, adj: 0 };
  }
  let radiusPx = 0;
  if (typeof borderRadius === "number" && Number.isFinite(borderRadius)) {
    radiusPx = Math.max(0, borderRadius);
  } else if (typeof borderRadius === "string") {
    const token = borderRadius.trim();
    if (token in ROUNDED_TOKENS_PX) {
      radiusPx = ROUNDED_TOKENS_PX[token];
    } else {
      const m = token.match(/^rounded-\[([0-9]+(?:\.[0-9]+)?)(?:px)?\]$/i) || token.match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
      if (m) radiusPx = Math.max(0, Number.parseFloat(m[1]));
    }
  }
  const shortSide = Math.max(1, Math.min(Math.abs(widthPx || 100), Math.abs(heightPx || 100)));
  const clampedPx = Math.min(radiusPx, shortSide / 2);
  const adj = Math.min(50000, Math.max(0, Math.round((clampedPx / shortSide) * 100000)));
  return { radiusPx: clampedPx, adj };
}

/**
 * Normalizes padding / insets from number or { top, right, bottom, left, x, y } in px to EMUs.
 */
export function normalizeInsetsPx(insets, defaultPx = { top: 6, right: 10, bottom: 6, left: 10 }) {
  if (insets === 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof insets === "number" && Number.isFinite(insets)) {
    const v = Math.max(0, insets);
    return { top: v, right: v, bottom: v, left: v };
  }
  if (insets && typeof insets === "object") {
    const x = typeof insets.x === "number" ? insets.x : undefined;
    const y = typeof insets.y === "number" ? insets.y : undefined;
    return {
      top: Math.max(0, insets.top ?? y ?? defaultPx.top),
      right: Math.max(0, insets.right ?? x ?? defaultPx.right),
      bottom: Math.max(0, insets.bottom ?? y ?? defaultPx.bottom),
      left: Math.max(0, insets.left ?? x ?? defaultPx.left),
    };
  }
  return { ...defaultPx };
}
