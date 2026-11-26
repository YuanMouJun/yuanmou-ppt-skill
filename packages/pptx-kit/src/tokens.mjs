// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { degToOoxmlAngle, pxToEmu, resolveBorderRadius } from "./units.mjs";
import { attrs } from "./xml.mjs";

export const TAILWIND_COLORS = Object.freeze({
  black: "#000000",
  white: "#FFFFFF",
  slate: { 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A", 950: "#020617" },
  gray: { 50: "#F9FAFB", 100: "#F3F4F6", 200: "#E5E7EB", 300: "#D1D5DB", 400: "#9CA3AF", 500: "#6B7280", 600: "#4B5563", 700: "#374151", 800: "#1F2937", 900: "#111827", 950: "#030712" },
  zinc: { 50: "#FAFAFA", 100: "#F4F4F5", 200: "#E4E4E7", 300: "#D4D4D8", 400: "#A1A1AA", 500: "#71717A", 600: "#52525B", 700: "#3F3F46", 800: "#27272A", 900: "#18181B", 950: "#09090B" },
  neutral: { 50: "#FAFAFA", 100: "#F5F5F5", 200: "#E5E5E5", 300: "#D4D4D4", 400: "#A3A3A3", 500: "#737373", 600: "#525252", 700: "#404040", 800: "#262626", 900: "#171717", 950: "#0A0A0A" },
  stone: { 50: "#FAFAF9", 100: "#F5F5F4", 200: "#E7E5E4", 300: "#D6D3D1", 400: "#A8A29E", 500: "#78716C", 600: "#57534E", 700: "#44403C", 800: "#292524", 900: "#1C1917", 950: "#0C0A09" },
  red: { 50: "#FEF2F2", 100: "#FEE2E2", 200: "#FECACA", 300: "#FCA5A5", 400: "#F87171", 500: "#EF4444", 600: "#DC2626", 700: "#B91C1C", 800: "#991B1B", 900: "#7F1D1D", 950: "#450A0A" },
  orange: { 50: "#FFF7ED", 100: "#FFEDD5", 200: "#FED7AA", 300: "#FDBA74", 400: "#FB923C", 500: "#F97316", 600: "#EA580C", 700: "#C2410C", 800: "#9A3412", 900: "#7C2D12", 950: "#431407" },
  amber: { 50: "#FFFBEB", 100: "#FEF3C7", 200: "#FDE68A", 300: "#FCD34D", 400: "#FBBF24", 500: "#F59E0B", 600: "#D97706", 700: "#B45309", 800: "#92400E", 900: "#78350F", 950: "#451A03" },
  yellow: { 50: "#FEFCE8", 100: "#FEF9C3", 200: "#FEF08A", 300: "#FDE047", 400: "#FACC15", 500: "#EAB308", 600: "#CA8A04", 700: "#A16207", 800: "#854D0E", 900: "#713F12", 950: "#422006" },
  lime: { 50: "#F7FEE7", 100: "#ECFCCB", 200: "#D9F99D", 300: "#BEF264", 400: "#A3E635", 500: "#84CC16", 600: "#65A30D", 700: "#4D7C0F", 800: "#3F6212", 900: "#365314", 950: "#1A2E05" },
  green: { 50: "#F0FDF4", 100: "#DCFCE7", 200: "#BBF7D0", 300: "#86EFAC", 400: "#4ADE80", 500: "#22C55E", 600: "#16A34A", 700: "#15803D", 800: "#166534", 900: "#14532D", 950: "#052E16" },
  emerald: { 50: "#ECFDF5", 100: "#D1FAE5", 200: "#A7F3D0", 300: "#6EE7B7", 400: "#34D399", 500: "#10B981", 600: "#059669", 700: "#047857", 800: "#065F46", 900: "#064E3B", 950: "#022C22" },
  teal: { 50: "#F0FDFA", 100: "#CCFBF1", 200: "#99F6E4", 300: "#5EEAD4", 400: "#2DD4BF", 500: "#14B8A6", 600: "#0D9488", 700: "#0F766E", 800: "#115E59", 900: "#134E4A", 950: "#042F2E" },
  cyan: { 50: "#ECFEFF", 100: "#CFFAFE", 200: "#A5F3FC", 300: "#67E8F9", 400: "#22D3EE", 500: "#06B6D4", 600: "#0891B2", 700: "#0E7490", 800: "#155E75", 900: "#164E63", 950: "#083344" },
  sky: { 50: "#F0F9FF", 100: "#E0F2FE", 200: "#BAE6FD", 300: "#7DD3FC", 400: "#38BDF8", 500: "#0EA5E9", 600: "#0284C7", 700: "#0369A1", 800: "#075985", 900: "#0C4A6E", 950: "#082F49" },
  blue: { 50: "#EFF6FF", 100: "#DBEAFE", 200: "#BFDBFE", 300: "#93C5FD", 400: "#60A5FA", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8", 800: "#1E40AF", 900: "#1E3A8A", 950: "#172554" },
  indigo: { 50: "#EEF2FF", 100: "#E0E7FF", 200: "#C7D2FE", 300: "#A5B4FC", 400: "#818CF8", 500: "#6366F1", 600: "#4F46E5", 700: "#4338CA", 800: "#3730A3", 900: "#312E81", 950: "#1E1B4B" },
  violet: { 50: "#F5F3FF", 100: "#EDE9FE", 200: "#DDD6FE", 300: "#C4B5FD", 400: "#A78BFA", 500: "#8B5CF6", 600: "#7C3AED", 700: "#6D28D9", 800: "#5B21B6", 900: "#4C1D95", 950: "#2E1065" },
  purple: { 50: "#FAF5FF", 100: "#F3E8FF", 200: "#E9D5FF", 300: "#D8B4FE", 400: "#C084FC", 500: "#A855F7", 600: "#9333EA", 700: "#7E22CE", 800: "#6B21A8", 900: "#581C87", 950: "#3B0764" },
  fuchsia: { 50: "#FDF4FF", 100: "#FAE8FF", 200: "#F5D0FE", 300: "#F0ABFC", 400: "#E879F9", 500: "#D946EF", 600: "#C026D3", 700: "#A21CAF", 800: "#86198F", 900: "#701A75", 950: "#4A044E" },
  pink: { 50: "#FDF2F8", 100: "#FCE7F3", 200: "#FBCFE8", 300: "#F9A8D4", 400: "#F472B6", 500: "#EC4899", 600: "#DB2777", 700: "#BE185D", 800: "#9D174D", 900: "#831843", 950: "#500724" },
  rose: { 50: "#FFF1F2", 100: "#FFE4E6", 200: "#FECDD3", 300: "#FDA4AF", 400: "#FB7185", 500: "#F43F5E", 600: "#E11D48", 700: "#BE123C", 800: "#9F1239", 900: "#881337", 950: "#4C0519" },
});

const THEME_COLOR_ALIASES = Object.freeze({
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  bg1: "bg1",
  background1: "bg1",
  bg2: "bg2",
  background2: "bg2",
  tx1: "tx1",
  text1: "tx1",
  tx2: "tx2",
  text2: "tx2",
  dk1: "dk1",
  dark1: "dk1",
  dk2: "dk2",
  dark2: "dk2",
  lt1: "lt1",
  light1: "lt1",
  lt2: "lt2",
  light2: "lt2",
  hlink: "hlink",
  folhlink: "folHlink",
  folHlink: "folHlink",
});

export const SHADOW_PRESETS = Object.freeze({
  "shadow-none": null,
  "shadow-xs": { offsetX: 0, offsetY: 1, blur: 2, color: "#000000/6" },
  "shadow-sm": { offsetX: 0, offsetY: 2, blur: 6, color: "#000000/8" },
  shadow: { offsetX: 0, offsetY: 4, blur: 10, color: "#000000/10" },
  "shadow-md": { offsetX: 0, offsetY: 6, blur: 16, color: "#000000/12" },
  "shadow-lg": { offsetX: 0, offsetY: 10, blur: 24, color: "#000000/14" },
  "shadow-xl": { offsetX: 0, offsetY: 16, blur: 32, color: "#000000/16" },
  "shadow-2xl": { offsetX: 0, offsetY: 22, blur: 44, color: "#000000/22" },
});

const TEXT_SIZE_TOKENS_PX = Object.freeze({
  "text-xs": "12px",
  "text-sm": "14px",
  "text-base": "16px",
  "text-lg": "18px",
  "text-xl": "20px",
  "text-2xl": "24px",
  "text-3xl": "30px",
  "text-4xl": "36px",
  "text-5xl": "48px",
  "text-6xl": "60px",
});

const LEADING_TOKENS = Object.freeze({
  "leading-none": 1.0,
  "leading-tight": 1.15,
  "leading-snug": 1.25,
  "leading-normal": 1.38,
  "leading-relaxed": 1.5,
  "leading-loose": 1.75,
});

function parseUnitRatio(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim();
  const isPct = s.endsWith("%");
  const num = Number.parseFloat(isPct ? s.slice(0, -1) : s);
  if (!Number.isFinite(num)) return undefined;
  if (isPct) return Math.max(0, Math.min(1, num / 100));
  if (num > 1) return Math.max(0, Math.min(1, num / 100));
  return Math.max(0, Math.min(1, num));
}

function blendHex(hex, targetHex, ratio) {
  const r1 = Number.parseInt(hex.slice(0, 2), 16);
  const g1 = Number.parseInt(hex.slice(2, 4), 16);
  const b1 = Number.parseInt(hex.slice(4, 6), 16);
  const r2 = Number.parseInt(targetHex.slice(0, 2), 16);
  const g2 = Number.parseInt(targetHex.slice(2, 4), 16);
  const b2 = Number.parseInt(targetHex.slice(4, 6), 16);
  const mix = (a, b) => Math.round(a + (b - a) * ratio).toString(16).padStart(2, "0").toUpperCase();
  return `${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

/**
 * Parses any supported ColorConfig into { kind: 'srgb'|'scheme', val: string, alpha?: number, lumMod?: number, lumOff?: number }.
 */
export function resolveColorSpec(input, fallbackHex = "0F172A") {
  if (!input) return { kind: "srgb", val: fallbackHex };

  if (typeof input === "object") {
    const t = input.transform || {};
    const rawOpacity =
      t.opacity !== undefined
        ? t.opacity
        : input.opacity !== undefined
          ? input.opacity
          : input.alpha;
    const opacity = rawOpacity !== undefined ? parseUnitRatio(rawOpacity) : undefined;
    const rawLighten = t.lighten !== undefined ? t.lighten : input.lighten;
    const rawDarken = t.darken !== undefined ? t.darken : input.darken;
    const lighten = rawLighten !== undefined ? parseUnitRatio(rawLighten) : undefined;
    const darken = rawDarken !== undefined ? parseUnitRatio(rawDarken) : undefined;
    const baseVal = input.value ?? input.color;
    if (input.type === "theme" && baseVal) {
      const scheme = THEME_COLOR_ALIASES[baseVal] || baseVal;
      return buildColorNode({ kind: "scheme", val: scheme }, { opacity, lighten, darken });
    }
    const base = resolveColorSpec(baseVal || fallbackHex, fallbackHex);
    return buildColorNode(base, { opacity, lighten, darken });
  }

  let raw = String(input).trim();
  if (!raw || raw === "none") return null;
  if (raw === "transparent") return { kind: "srgb", val: "FFFFFF", alpha: 0 };

  // rgba(r,g,b,a) / rgb(r,g,b)
  const rgbaMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+%?))?\s*\)$/i);
  if (rgbaMatch) {
    const hex = [rgbaMatch[1], rgbaMatch[2], rgbaMatch[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0").toUpperCase())
      .join("");
    const opacity = rgbaMatch[4] !== undefined ? parseUnitRatio(rgbaMatch[4]) : undefined;
    return buildColorNode({ kind: "srgb", val: hex }, { opacity });
  }

  // Extract `/opacity` suffix
  let opacity;
  const slashIdx = raw.indexOf("/");
  if (slashIdx > 0) {
    opacity = parseUnitRatio(raw.slice(slashIdx + 1));
    raw = raw.slice(0, slashIdx).trim();
  }

  // Extract `+lighten` or `-darken` transform (but avoid splitting `sky-500`!)
  let lighten;
  let darken;
  const plusMatch = raw.match(/^(.+?)\+([0-9.]+%?)$/);
  if (plusMatch) {
    raw = plusMatch[1].trim();
    lighten = parseUnitRatio(plusMatch[2]);
  } else {
    const minusTransform = raw.match(/^([a-zA-Z]+\d*|#[0-9a-fA-F]{3,8})-([0-9.]+%?)$/);
    if (minusTransform && !(raw in TAILWIND_COLORS) && !TAILWIND_COLORS[minusTransform[1]]) {
      raw = minusTransform[1].trim();
      darken = parseUnitRatio(minusTransform[2]);
    }
  }

  // Theme color?
  if (raw in THEME_COLOR_ALIASES) {
    return buildColorNode({ kind: "scheme", val: THEME_COLOR_ALIASES[raw] }, { opacity, lighten, darken });
  }

  // Singleton Tailwind colors
  if (raw === "black" || raw === "white") {
    const hex = TAILWIND_COLORS[raw].slice(1);
    return buildColorNode({ kind: "srgb", val: hex }, { opacity, lighten, darken });
  }

  // Tailwind `family-shade` (e.g., `slate-950`, `sky-500`)
  const twMatch = raw.match(/^([a-z]+)-(\d{2,3})$/i);
  if (twMatch) {
    const fam = TAILWIND_COLORS[twMatch[1].toLowerCase()];
    const shadeHex = fam?.[Number(twMatch[2])];
    if (shadeHex) {
      return buildColorNode({ kind: "srgb", val: shadeHex.slice(1) }, { opacity, lighten, darken });
    }
  }

  // Hex (#RGB, #RRGGBB, #RRGGBBAA)
  const cleanHex = raw.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(cleanHex)) {
    const hex6 = cleanHex.split("").map((c) => c + c).join("").toUpperCase();
    return buildColorNode({ kind: "srgb", val: hex6 }, { opacity, lighten, darken });
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    return buildColorNode({ kind: "srgb", val: cleanHex.toUpperCase() }, { opacity, lighten, darken });
  }
  if (/^[0-9a-fA-F]{8}$/.test(cleanHex)) {
    const hex6 = cleanHex.slice(0, 6).toUpperCase();
    const alphaByte = Number.parseInt(cleanHex.slice(6, 8), 16) / 255;
    return buildColorNode({ kind: "srgb", val: hex6 }, { opacity: opacity ?? alphaByte, lighten, darken });
  }

  return { kind: "srgb", val: fallbackHex };
}

function buildColorNode(base, { opacity, lighten, darken } = {}) {
  const out = { ...base };
  if (out.kind === "srgb") {
    if (lighten) out.val = blendHex(out.val, "FFFFFF", lighten);
    if (darken) out.val = blendHex(out.val, "000000", darken);
  } else if (out.kind === "scheme") {
    if (lighten) {
      out.lumMod = Math.round((1 - lighten) * 100000);
      out.lumOff = Math.round(lighten * 100000);
    } else if (darken) {
      out.lumMod = Math.round((1 - darken) * 100000);
    }
  }
  if (opacity !== undefined) {
    out.alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 100000);
  }
  return out;
}

export function renderColorXml(colorInput, fallbackHex = "0F172A") {
  const spec = resolveColorSpec(colorInput, fallbackHex);
  if (!spec) return "";
  const children = [];
  if (spec.lumMod !== undefined) children.push(`<a:lumMod val="${spec.lumMod}"/>`);
  if (spec.lumOff !== undefined) children.push(`<a:lumOff val="${spec.lumOff}"/>`);
  if (spec.alpha !== undefined && spec.alpha < 100000) {
    children.push(`<a:alpha val="${spec.alpha}"/>`);
  }
  const tag = spec.kind === "scheme" ? "a:schemeClr" : "a:srgbClr";
  if (children.length === 0) return `<${tag} val="${spec.val}"/>`;
  return `<${tag} val="${spec.val}">${children.join("")}</${tag}>`;
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth = Math.max(0, depth - 1);
    else if (str[i] === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseGradientString(str) {
  const isLinear = /^linear(?:-gradient)?\(/i.test(str);
  const isRadial = /^radial(?:-gradient)?\(/i.test(str);
  if (!isLinear && !isRadial) return null;

  const inner = str.slice(str.indexOf("(") + 1, str.lastIndexOf(")")).trim();
  const tokens = splitTopLevelCommas(inner);
  if (tokens.length < 2) return null;

  let angleDeg = 90;
  let stopStartIdx = 0;
  if (isLinear && /deg$/i.test(tokens[0])) {
    // CSS linear-gradient: 0deg = bottom-to-top, 90deg = left-to-right, 180deg = top-to-bottom.
    // OpenXML <a:lin ang>: 0 = left-to-right, 90deg (5400000) = top-to-bottom!
    // Conversion: ooxmlDeg = (cssDeg - 90 + 360) % 360
    const cssDeg = Number.parseFloat(tokens[0]);
    angleDeg = ((cssDeg - 90) % 360 + 360) % 360;
    stopStartIdx = 1;
  }

  const rawStops = tokens.slice(stopStartIdx);
  const stops = rawStops.map((part, idx) => {
    const m = part.match(/^(.+?)\s+([0-9.]+)%$/);
    if (m) {
      return {
        offset: Math.round(Math.max(0, Math.min(100, Number.parseFloat(m[2]))) * 1000),
        color: m[1].trim(),
      };
    }
    const defaultPos = rawStops.length === 1 ? 0 : Math.round((idx / (rawStops.length - 1)) * 100000);
    return { offset: defaultPos, color: part.trim() };
  });

  return {
    type: "gradient",
    gradientKind: isRadial ? "path" : "linear",
    angleDeg,
    stops,
  };
}

/**
 * Renders OpenXML fill element (`<a:noFill/>`, `<a:solidFill>`, or `<a:gradFill>`).
 */
export function renderFillXml(fillConfig) {
  if (fillConfig === undefined || fillConfig === null || fillConfig === "none") {
    return "<a:noFill/>";
  }
  if (typeof fillConfig === "object" && fillConfig.type === "none") {
    return "<a:noFill/>";
  }

  if (typeof fillConfig === "string") {
    const trimmed = fillConfig.trim();
    if (!trimmed || trimmed === "none") return "<a:noFill/>";
    const grad = parseGradientString(trimmed);
    if (grad) return renderFillXml(grad);
    const colorXml = renderColorXml(trimmed);
    return colorXml ? `<a:solidFill>${colorXml}</a:solidFill>` : "<a:noFill/>";
  }

  if (typeof fillConfig === "object") {
    if (fillConfig.type === "pattern" && fillConfig.pattern) {
      const fg = renderColorXml(fillConfig.fgColor || "#EAEAEA");
      const bg = renderColorXml(fillConfig.bgColor || "#F7F7F7");
      return `<a:pattFill prst="${fillConfig.pattern}"><a:fgClr>${fg}</a:fgClr><a:bgClr>${bg}</a:bgClr></a:pattFill>`;
    }
    if (fillConfig.type === "solid" || (!fillConfig.type && (fillConfig.color || fillConfig.value))) {
      const hasAlpha = fillConfig.opacity !== undefined || fillConfig.alpha !== undefined || fillConfig.transform;
      const colorInput = hasAlpha
        ? {
            value: fillConfig.color ?? fillConfig.value,
            opacity: fillConfig.opacity ?? fillConfig.alpha,
            transform: fillConfig.transform,
          }
        : (fillConfig.color ?? fillConfig.value);
      const colorXml = renderColorXml(colorInput);
      return colorXml ? `<a:solidFill>${colorXml}</a:solidFill>` : "<a:noFill/>";
    }
    const isGradObj =
      (fillConfig.type === "gradient" ||
        fillConfig.type === "linear" ||
        fillConfig.type === "radial" ||
        fillConfig.kind === "linear" ||
        fillConfig.kind === "radial") &&
      Array.isArray(fillConfig.stops) &&
      fillConfig.stops.length > 0;
    if (isGradObj) {
      const scale = fillConfig.offsetScale === 1 ? 100000 : 1;
      const gsXml = fillConfig.stops
        .map((st, idx) => {
          const rawVal =
            typeof st.offset === "number"
              ? st.offset
              : typeof st.position === "number"
                ? st.position
                : fillConfig.stops.length === 1
                  ? 0
                  : idx / (fillConfig.stops.length - 1);
          let rawOff = rawVal * scale;
          if (rawOff > 0 && rawOff <= 1 && fillConfig.offsetScale !== 100000) rawOff *= 100000;
          const pos = Math.max(0, Math.min(100000, Math.round(rawOff)));
          const stopColorInput =
            st.opacity !== undefined || st.alpha !== undefined
              ? { value: st.color, opacity: st.opacity ?? st.alpha }
              : st.color;
          return `<a:gs pos="${pos}">${renderColorXml(stopColorInput)}</a:gs>`;
        })
        .join("");

      const gKind = fillConfig.gradientKind || fillConfig.kind || fillConfig.type;
      if (gKind === "path" || gKind === "radial") {
        return `<a:gradFill rotWithShape="1"><a:gsLst>${gsXml}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`;
      }
      const ang = degToOoxmlAngle(fillConfig.angleDeg ?? fillConfig.angle ?? 90);
      return `<a:gradFill rotWithShape="1"><a:gsLst>${gsXml}</a:gsLst><a:lin ang="${ang}" scaled="1"/></a:gradFill>`;
    }
  }

  return "<a:noFill/>";
}

const DASH_MAP = Object.freeze({
  solid: "solid",
  dashed: "dash",
  dash: "dash",
  dotted: "dot",
  dot: "dot",
  dashDot: "dashDot",
  lgDash: "lgDash",
});

const LINE_END_TYPES = new Set(["none", "triangle", "stealth", "diamond", "oval", "arrow"]);
const LINE_END_SIZES = new Set(["sm", "med", "lg"]);

function renderLineEndXml(tag, endCfg) {
  if (!endCfg || !endCfg.type || endCfg.type === "none") return "";
  const type = LINE_END_TYPES.has(endCfg.type) ? endCfg.type : "arrow";
  const w = LINE_END_SIZES.has(endCfg.width) ? endCfg.width : "med";
  const len = LINE_END_SIZES.has(endCfg.length) ? endCfg.length : "med";
  return `<${tag} type="${type}" w="${w}" len="${len}"/>`;
}

/**
 * Renders OpenXML `<a:ln>` following exact ECMA-376 CT_LineProperties child order:
 * fill -> prstDash -> join -> headEnd -> tailEnd
 */
export function renderLineXml(lineConfig, { head, tail, cap, join } = {}) {
  const cfg = lineConfig || {};
  const fillVal = cfg.fill ?? cfg.color;
  const widthPx = cfg.width ?? (fillVal && fillVal !== "none" ? 1 : 0);

  if ((!fillVal || fillVal === "none" || widthPx <= 0) && !head && !tail) {
    return `<a:ln w="0"><a:noFill/></a:ln>`;
  }

  const wEmu = Math.max(0, pxToEmu(widthPx));
  const capAttr = cap && ["flat", "rnd", "sq", "round", "square"].includes(cap)
    ? cap === "round" ? "rnd" : cap === "square" ? "sq" : cap
    : undefined;
  const lineFillInput =
    fillVal && fillVal !== "none" && (cfg.opacity !== undefined || cfg.alpha !== undefined) && typeof fillVal === "string"
      ? { color: fillVal, opacity: cfg.opacity ?? cfg.alpha }
      : fillVal;
  const fillXml = !lineFillInput || lineFillInput === "none" ? "<a:noFill/>" : renderFillXml(lineFillInput);
  const dashVal = DASH_MAP[cfg.style] || "solid";
  const dashXml = `<a:prstDash val="${dashVal}"/>`;

  let joinXml = "";
  const j = join || cfg.join;
  if (j === "round") joinXml = "<a:round/>";
  else if (j === "bevel") joinXml = "<a:bevel/>";
  else if (j === "miter") joinXml = `<a:miter lim="800000"/>`;

  const headXml = renderLineEndXml("a:headEnd", head || cfg.head);
  const tailXml = renderLineEndXml("a:tailEnd", tail || cfg.tail);

  return `<a:ln${attrs({ w: wEmu, cap: capAttr, cmpd: "sng", algn: "ctr" })}>${fillXml}${dashXml}${joinXml}${headXml}${tailXml}</a:ln>`;
}

/**
 * Renders OpenXML `<a:effectLst>` in strict schema order (`outerShdw` before `softEdge`).
 */
export function renderEffectsXml({ shadow, softEdge } = {}) {
  const effects = [];

  if (shadow && shadow !== "none" && shadow !== "shadow-none") {
    let spec = null;
    if (typeof shadow === "string") {
      const trimmed = shadow.trim();
      if (trimmed in SHADOW_PRESETS) {
        spec = SHADOW_PRESETS[trimmed];
      } else {
        // Custom shadow string: "2px 7px 19px #000000/17"
        const m = trimmed.match(/^(-?[0-9.]+)(?:px)?\s+(-?[0-9.]+)(?:px)?\s+([0-9.]+)(?:px)?\s+(.+)$/i);
        if (m) {
          spec = {
            offsetX: Number.parseFloat(m[1]),
            offsetY: Number.parseFloat(m[2]),
            blur: Number.parseFloat(m[3]),
            color: m[4].trim(),
          };
        }
      }
    } else if (typeof shadow === "object") {
      spec = shadow;
    }

    if (spec) {
      const dx = spec.offsetX ?? 0;
      const dy = spec.offsetY ?? 4;
      const distEmu = pxToEmu(Math.hypot(dx, dy));
      const dirDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const dir = degToOoxmlAngle(dirDeg);
      const blurRad = pxToEmu(Math.max(0, spec.blur ?? 8));
      const colorXml = renderColorXml(spec.color || "#000000/12");
      effects.push(
        `<a:outerShdw blurRad="${blurRad}" dist="${distEmu}" dir="${dir}" algn="tl" rotWithShape="0">${colorXml}</a:outerShdw>`
      );
    }
  }

  if (typeof softEdge === "number" && softEdge > 0) {
    effects.push(`<a:softEdge rad="${pxToEmu(softEdge)}"/>`);
  }

  return effects.length ? `<a:effectLst>${effects.join("")}</a:effectLst>` : "";
}

/**
 * Parses Tailwind-like `className` tokens into shape + text style properties.
 */
export function parseClassNameTokens(className) {
  if (!className || typeof className !== "string") return { shape: {}, text: {} };
  const shape = {};
  const text = {};

  for (const tok of className.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith("bg-")) {
      const colorToken = tok.slice(3);
      if (colorToken.startsWith("[") && colorToken.endsWith("]")) {
        shape.fill = colorToken.slice(1, -1);
      } else {
        shape.fill = colorToken;
      }
    } else if (tok === "rounded" || tok.startsWith("rounded-")) {
      shape.borderRadius = tok;
    } else if (tok === "shadow" || tok.startsWith("shadow-")) {
      shape.shadow = tok;
    } else if (tok === "font-bold" || tok === "font-semibold" || tok === "font-extrabold") {
      text.bold = true;
    } else if (tok === "font-normal" || tok === "font-medium") {
      text.bold = false;
    } else if (tok === "italic") {
      text.italic = true;
    } else if (tok === "underline") {
      text.underline = "sng";
    } else if (tok in TEXT_SIZE_TOKENS_PX) {
      text.fontSize = TEXT_SIZE_TOKENS_PX[tok];
    } else if (/^text-\[[0-9.]+(?:px|pt)?\]$/i.test(tok)) {
      text.fontSize = tok.slice(6, -1);
    } else if (tok === "text-left" || tok === "text-center" || tok === "text-right" || tok === "text-justify") {
      text.alignment = tok.slice(5);
    } else if (tok.startsWith("text-")) {
      const c = tok.slice(5);
      text.color = c.startsWith("[") && c.endsWith("]") ? c.slice(1, -1) : c;
    } else if (tok in LEADING_TOKENS) {
      text.lineSpacing = LEADING_TOKENS[tok];
    } else if (/^leading-\[[0-9.]+\]$/.test(tok)) {
      text.lineSpacing = Number.parseFloat(tok.slice(9, -1));
    }
  }

  return { shape, text };
}

/**
 * Parses compact text declaration strings such as:
 * "font: 700 22px Microsoft YaHei; color: #334155; leading: 1.25; wrap: none"
 */
export function parseCompactTextStyleString(styleStr) {
  if (!styleStr || typeof styleStr !== "string" || (!styleStr.includes(":") && !styleStr.includes(";"))) {
    return {};
  }
  const out = {};
  for (const decl of styleStr.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!val) continue;

    if (prop === "color") out.color = val;
    else if (prop === "leading" || prop === "line-height") out.lineSpacing = Number.parseFloat(val);
    else if (prop === "wrap") out.wrap = val === "none" ? "none" : "square";
    else if (prop === "align" || prop === "text-align") out.alignment = val;
    else if (prop === "font-size") out.fontSize = val;
    else if (prop === "font-family") out.typeface = val.replace(/^['"]|['"]$/g, "");
    else if (prop === "font-weight") out.bold = val === "bold" || Number.parseInt(val, 10) >= 600;
    else if (prop === "font") {
      const m = val.match(/^(?:(bold|\d{3})\s+)?([0-9.]+(?:px|pt)?)\s+(.+)$/i);
      if (m) {
        if (m[1]) out.bold = m[1].toLowerCase() === "bold" || Number.parseInt(m[1], 10) >= 600;
        out.fontSize = m[2];
        out.typeface = m[3].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return out;
}

export { resolveBorderRadius };
