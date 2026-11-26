// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import {
  fontSizeToPx,
  normalizeInsetsPx,
  parseFontSizeToHundredthsPt,
  ptToEmu,
  pxToEmu,
} from "./units.mjs";
import {
  parseClassNameTokens,
  parseCompactTextStyleString,
  renderColorXml,
  renderFillXml,
  renderLineXml,
} from "./tokens.mjs";
import { attrs, escapeXmlText } from "./xml.mjs";

export const DEFAULT_FONT_FAMILY = "Microsoft YaHei";

const ALIGN_MAP = Object.freeze({
  left: "l",
  l: "l",
  center: "ctr",
  ctr: "ctr",
  right: "r",
  r: "r",
  justify: "just",
  just: "just",
});

const VALIGN_MAP = Object.freeze({
  top: "t",
  t: "t",
  middle: "ctr",
  center: "ctr",
  ctr: "ctr",
  bottom: "b",
  b: "b",
});

/**
 * Helper matching Codex's `makeNativeBulletParagraphs` with optional bulletColor.
 * Paragraph indentation uses EMU (12,700 per pt); spacing uses 1/100 pt.
 */
export function makeBulletList(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("makeBulletList requires a non-empty array of items");
  }
  const {
    marginLeftPoints = options.indent ?? 14,
    hangingPoints = options.indent ? Math.min(10, options.indent) : 10,
    spaceAfterPoints = options.spaceAfter ?? 4,
    bulletCharacter = options.bulletChar || "•",
    bulletColor,
    fontFamily,
    fontSize,
    color,
    bold,
    lineSpacing,
  } = options;

  const paraStyle = {};
  if (fontFamily !== undefined) paraStyle.fontFamily = fontFamily;
  if (fontSize !== undefined) paraStyle.fontSize = fontSize;
  if (color !== undefined) paraStyle.color = color;
  if (bold !== undefined) paraStyle.bold = bold;
  if (lineSpacing !== undefined) paraStyle.lineSpacing = lineSpacing;

  return items.map((item) => {
    const runs = Array.isArray(item)
      ? item
      : typeof item === "object" && item !== null && Array.isArray(item.runs)
        ? item.runs
        : typeof item === "object" && item !== null && ("text" in item || "run" in item)
          ? [item]
          : [String(item)];
    return {
      bulletCharacter,
      bulletColor,
      marginLeft: ptToEmu(marginLeftPoints),
      indent: -ptToEmu(hangingPoints),
      spaceAfter: Math.round(spaceAfterPoints * 100),
      style: Object.keys(paraStyle).length > 0 ? { ...paraStyle } : undefined,
      runs,
    };
  });
}

export const makeNativeBulletParagraphs = makeBulletList;

const FLAT_RUN_STYLE_KEYS = [
  "fontSize",
  "fontFamily",
  "typeface",
  "color",
  "bold",
  "italic",
  "underline",
  "letterSpacing",
  "outline",
];

function extractFlatRunStyle(obj) {
  const out = {};
  for (const k of FLAT_RUN_STYLE_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Normalizes any supported `TextValue` (string, string[], run[][], structured paragraph[])
 * into a canonical array of paragraph objects.
 */
export function normalizeParagraphs(input) {
  if (input === undefined || input === null) return [];

  if (typeof input === "string" || typeof input === "number") {
    return String(input)
      .split(/\r?\n/)
      .map((line) => ({ runs: [{ run: line }] }));
  }

  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    // Is `input` itself a single ParagraphRunsInput? (e.g. `[{ run: "A" }, { run: "B" }]`)
    const looksLikeSingleParagraphRuns = input.every(
      (el) =>
        typeof el === "string" ||
        typeof el === "number" ||
        (el && typeof el === "object" && !Array.isArray(el) && "run" in el && !("runs" in el))
    );
    // Careful: in Codex/shared_runtime, `["line 1", "line 2"]` is an array of paragraphs!
    // Whereas `[{ run: "A" }, { run: "B" }]` (with at least one `{ run }` object) is a single paragraph's runs,
    // AND `[[{ run: "A" }], [{ run: "B" }]]` is multiple paragraphs!
    const hasRunObjects = input.some((el) => el && typeof el === "object" && "run" in el);
    if (looksLikeSingleParagraphRuns && hasRunObjects) {
      return [{ runs: normalizeRuns(input) }];
    }

    return input.map((para) => {
      if (typeof para === "string" || typeof para === "number") {
        return { runs: [{ run: String(para) }] };
      }
      if (Array.isArray(para)) {
        return { runs: normalizeRuns(para) };
      }
      if (para && typeof para === "object") {
        const flatParaStyle = extractFlatRunStyle(para);
        const existingStyle =
          typeof para.style === "string"
            ? parseCompactTextStyleString(para.style)
            : para.style || {};
        const mergedParaStyle = { ...flatParaStyle, ...existingStyle };
        return {
          ...para,
          style: Object.keys(mergedParaStyle).length > 0 ? mergedParaStyle : para.style,
          runs: normalizeRuns(
            para.runs ?? (para.run !== undefined || para.text !== undefined ? [para] : [""])
          ),
        };
      }
      return { runs: [{ run: "" }] };
    });
  }

  if (typeof input === "object") {
    if (Array.isArray(input.paragraphs)) return normalizeParagraphs(input.paragraphs);
    if (Array.isArray(input.runs)) {
      const flatParaStyle = extractFlatRunStyle(input);
      const existingStyle =
        typeof input.style === "string"
          ? parseCompactTextStyleString(input.style)
          : input.style || {};
      const mergedStyle = { ...flatParaStyle, ...existingStyle };
      return [
        {
          ...input,
          style: Object.keys(mergedStyle).length > 0 ? mergedStyle : input.style,
          runs: normalizeRuns(input.runs),
        },
      ];
    }
    if ("text" in input) {
      const flatStyle = extractFlatRunStyle(input);
      if (Object.keys(flatStyle).length > 0 || input.style || input.textStyle) {
        return [{ ...input, runs: normalizeRuns([input]) }];
      }
      return normalizeParagraphs(input.text);
    }
  }

  return [];
}

function normalizeRuns(runsInput) {
  if (!Array.isArray(runsInput)) return [{ run: String(runsInput ?? "") }];
  return runsInput.map((r) => {
    if (typeof r === "string" || typeof r === "number") {
      return { run: String(r) };
    }
    if (r && typeof r === "object") {
      const classTokens = r.className ? parseClassNameTokens(r.className).text : {};
      const flatStyle = extractFlatRunStyle(r);
      const baseStyle =
        typeof r.style === "string"
          ? parseCompactTextStyleString(r.style)
          : r.style || r.textStyle || {};
      return {
        run: String(r.run ?? r.text ?? ""),
        style: { ...classTokens, ...flatStyle, ...baseStyle },
        link: r.link,
      };
    }
    return { run: "" };
  });
}

export function mergeTextStyle(baseStyle = {}, overrideStyle = {}) {
  const parsedOverride =
    typeof overrideStyle === "string"
      ? parseCompactTextStyleString(overrideStyle)
      : overrideStyle || {};
  const classOverride = parsedOverride.className
    ? parseClassNameTokens(parsedOverride.className).text
    : {};
  return {
    ...baseStyle,
    ...classOverride,
    ...parsedOverride,
  };
}

/**
 * Estimates CJK + Latin wrapped text height in CSS pixels for `height="hug"` and overflow gates.
 */
export function estimateParagraphsHeightPx(paragraphs, shapeStyle = {}, availWidthPx = 400) {
  const normParas = normalizeParagraphs(paragraphs);
  const insets = normalizeInsetsPx(shapeStyle.insets, { top: 4, right: 8, bottom: 4, left: 8 });
  const innerW = Math.max(24, availWidthPx - insets.left - insets.right);
  const defaultSizePx = fontSizeToPx(shapeStyle.fontSize, 14);
  const lineSpacingMult =
    typeof shapeStyle.lineSpacing === "number" && shapeStyle.lineSpacing > 0
      ? shapeStyle.lineSpacing
      : 1.25;

  if (normParas.length === 0) {
    return Math.ceil(defaultSizePx * lineSpacingMult + insets.top + insets.bottom);
  }

  let totalH = insets.top + insets.bottom;

  for (let pIdx = 0; pIdx < normParas.length; pIdx++) {
    const para = normParas[pIdx];
    const marginLeftPx = para.marginLeft ? para.marginLeft / 9525 : 0;
    const paraAvailW = Math.max(20, innerW - marginLeftPx);

    let maxRunFontPx = defaultSizePx;
    let lineAdvancePx = 0;
    let explicitBreaks = 0;

    for (const r of para.runs || []) {
      const rStyle = { ...shapeStyle, ...(r.style || {}) };
      const fPx = fontSizeToPx(rStyle.fontSize, defaultSizePx);
      if (fPx > maxRunFontPx) maxRunFontPx = fPx;
      const boldFactor = rStyle.bold ? 1.06 : 1.0;

      const text = String(r.run || "");
      for (const ch of text) {
        if (ch === "\n") {
          explicitBreaks++;
          continue;
        }
        const code = ch.codePointAt(0) || 0;
        // CJK unified ideographs, fullwidth punctuation & emoji occupy ~1.02 em; ASCII ~0.56 em
        const isWide =
          (code >= 0x2e80 && code <= 0x9fff) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0xff00 && code <= 0xffef) ||
          code >= 0x1f000;
        lineAdvancePx += fPx * (isWide ? 1.03 : 0.57) * boldFactor;
      }
    }

    const wrapDisabled = shapeStyle.wrap === "none";
    const wrappedLines = wrapDisabled
      ? 1 + explicitBreaks
      : Math.max(1, Math.ceil(lineAdvancePx / paraAvailW) + explicitBreaks);

    const paraLineSpacing =
      typeof para.lineSpacing === "number" && para.lineSpacing > 0
        ? para.lineSpacing
        : lineSpacingMult;

    totalH += wrappedLines * maxRunFontPx * paraLineSpacing;

    if (typeof para.spaceBefore === "number") {
      totalH += (para.spaceBefore / 100) / 0.75;
    }
    if (typeof para.spaceAfter === "number" && pIdx < normParas.length - 1) {
      totalH += (para.spaceAfter / 100) / 0.75;
    }
  }

  return Math.ceil(totalH);
}

/**
 * Renders `<p:txBody>` in exact ECMA-376 element order:
 * bodyPr -> lstStyle -> p+
 * Inside `p`: pPr (lnSpc -> spcBef -> spcAft -> buClr -> buFont -> buChar/buAutoNum/buNone) -> r+ -> endParaRPr
 * Inside `rPr`: ln -> solidFill/gradFill -> latin -> ea -> cs -> hlinkClick
 */
export function renderTxBodyXml({
  paragraphs,
  baseStyle = {},
  defaultFont = DEFAULT_FONT_FAMILY,
  isTextbox = false,
  registerHyperlink,
}) {
  const normParas = normalizeParagraphs(paragraphs);
  const defaultInsets = isTextbox
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : { top: 6, right: 10, bottom: 6, left: 10 };
  const insets = normalizeInsetsPx(baseStyle.insets, defaultInsets);
  const wrap = baseStyle.wrap === "none" ? "none" : "square";
  const anchor =
    VALIGN_MAP[baseStyle.verticalAlignment ?? baseStyle.verticalAlign] || (isTextbox ? "t" : "ctr");

  let autoFitXml = "<a:noAutofit/>";
  if (baseStyle.autoFit === "shrink" || baseStyle.autoFit === "norm") {
    autoFitXml = "<a:normAutofit/>";
  } else if (baseStyle.autoFit === "resize" || baseStyle.autoFit === "shape") {
    autoFitXml = "<a:spAutoFit/>";
  }

  const bodyPrXml = `<a:bodyPr${attrs({
    wrap,
    lIns: pxToEmu(insets.left),
    tIns: pxToEmu(insets.top),
    rIns: pxToEmu(insets.right),
    bIns: pxToEmu(insets.bottom),
    anchor,
    anchorCtr: "0",
  })}>${autoFitXml}</a:bodyPr>`;

  const effectiveParas = normParas.length > 0 ? normParas : [{ runs: [{ run: "" }] }];

  const parasXml = effectiveParas
    .map((para) => {
      const pStyle = { ...baseStyle, ...(para.style || {}), ...(para.paragraphStyle || {}) };
      const algn = ALIGN_MAP[para.alignment ?? pStyle.alignment] || "l";
      const pPrAttrs = {
        marL: para.marginLeft !== undefined ? Math.round(para.marginLeft) : undefined,
        indent: para.indent !== undefined ? Math.round(para.indent) : undefined,
        algn,
      };

      const pPrChildren = [];
      const lineSpacing = para.lineSpacing ?? pStyle.lineSpacing;
      if (typeof lineSpacing === "number" && lineSpacing > 0) {
        pPrChildren.push(`<a:lnSpc><a:spcPct val="${Math.round(lineSpacing * 100000)}"/></a:lnSpc>`);
      }
      if (typeof para.spaceBefore === "number" && para.spaceBefore > 0) {
        pPrChildren.push(`<a:spcBef><a:spcPts val="${Math.round(para.spaceBefore)}"/></a:spcBef>`);
      }
      if (typeof para.spaceAfter === "number" && para.spaceAfter > 0) {
        pPrChildren.push(`<a:spcAft><a:spcPts val="${Math.round(para.spaceAfter)}"/></a:spcAft>`);
      }

      if (para.bulletCharacter) {
        if (para.bulletColor) {
          pPrChildren.push(`<a:buClr>${renderColorXml(para.bulletColor)}</a:buClr>`);
        }
        const buFont = pStyle.typeface || pStyle.fontFamily || defaultFont;
        pPrChildren.push(`<a:buFont typeface="${buFont}"/>`);
        pPrChildren.push(`<a:buChar char="${para.bulletCharacter}"/>`);
      } else if (para.autoNumber) {
        const numType = typeof para.autoNumber === "string" ? para.autoNumber : "arabicPeriod";
        pPrChildren.push(`<a:buAutoNum type="${numType}"/>`);
      } else {
        pPrChildren.push(`<a:buNone/>`);
      }

      const pPrXml = `<a:pPr${attrs(pPrAttrs)}>${pPrChildren.join("")}</a:pPr>`;

      const runs = para.runs && para.runs.length > 0 ? para.runs : [{ run: "" }];
      const runsXml = runs
        .map((r) => {
          const rStyle = mergeTextStyle(pStyle, r.style);
          const typeface = rStyle.typeface || rStyle.fontFamily || defaultFont;
          const sz = parseFontSizeToHundredthsPt(rStyle.fontSize, 14);
          const letterSpc =
            typeof rStyle.letterSpacing === "number" ? Math.round(rStyle.letterSpacing * 100) : undefined;

          const rPrAttrs = {
            lang: "zh-CN",
            altLang: "en-US",
            sz,
            b: rStyle.bold ? "1" : undefined,
            i: rStyle.italic ? "1" : undefined,
            u: rStyle.underline ? (rStyle.underline === true ? "sng" : rStyle.underline) : undefined,
            spc: letterSpc,
            dirty: "0",
          };

          const rPrChildren = [];
          if (rStyle.outline) {
            rPrChildren.push(renderLineXml(rStyle.outline));
          }
          const textFill = rStyle.color ?? (r.link ? "hlink" : "#0F172A");
          rPrChildren.push(renderFillXml(textFill));
          rPrChildren.push(`<a:latin typeface="${typeface}"/>`);
          rPrChildren.push(`<a:ea typeface="${typeface}"/>`);
          rPrChildren.push(`<a:cs typeface="${typeface}"/>`);

          if (r.link?.uri && typeof registerHyperlink === "function") {
            const rId = registerHyperlink(r.link.uri);
            rPrChildren.push(`<a:hlinkClick r:id="${rId}"/>`);
          }

          if (r.run === "") {
            return `<a:endParaRPr${attrs(rPrAttrs)}>${rPrChildren.join("")}</a:endParaRPr>`;
          }
          return `<a:r><a:rPr${attrs(rPrAttrs)}>${rPrChildren.join("")}</a:rPr><a:t>${escapeXmlText(r.run)}</a:t></a:r>`;
        })
        .join("");

      const hasEndPara = runs.length === 1 && runs[0].run === "";
      const tailEndPara = hasEndPara ? "" : `<a:endParaRPr lang="zh-CN" altLang="en-US" dirty="0"/>`;
      return `<a:p>${pPrXml}${runsXml}${tailEndPara}</a:p>`;
    })
    .join("");

  return `<p:txBody>${bodyPrXml}<a:lstStyle/>${parasXml}</p:txBody>`;
}
