// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { emuToPx, pxToEmu } from "./units.mjs";
import { computeImagePlacementAndCrop, resolveImageSource } from "./media.mjs";
import { ShapeElement, ConnectorElement, ImageElement } from "./slide.mjs";
import { TableElement } from "./tables.mjs";
import { ChartElement } from "./charts.mjs";
import { normalizeParagraphs } from "./richtext.mjs";
import { composeIntoSlide } from "./compose.mjs";
import {
  buildZipBuffer,
  escapeXmlAttr,
  escapeXmlText,
  readZipBuffer,
} from "./xml.mjs";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";

export const PLACEHOLDER_TEXT_PATTERNS = [
  /^slide number$/i,
  /^date$/i,
  /^footer$/i,
  /^click to add (title|subtitle|text|content)$/i,
  /^(title|subtitle|name|text|body) goes here$/i,
  /^lorem ipsum\b/i,
  /\btemplate instruction\b/i,
  /^单击此处添加(标题|副标题|文本|正文)$/,
  /^点击(此处)?(添加|输入)(标题|副标题|文本|正文|内容)$/,
  /^在此(处)?输入(标题|副标题|文本|正文|文字)$/,
  /^请输入(标题|副标题|文本|正文|内容)$/,
  /fill in the text of the document/i,
  /enter the relevant content you need here/i,
  /✘✘✘/,
];

export function isPlaceholderText(text) {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return PLACEHOLDER_TEXT_PATTERNS.some((re) => re.test(trimmed));
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttr(tagXml, attrName) {
  const m = tagXml.match(new RegExp(`\\b${attrName}="([^"]*)"`));
  return m ? decodeXmlEntities(m[1]) : undefined;
}

/**
 * Finds balanced top-level blocks matching `<tagName ...>...</tagName>` inside `xml`
 * (handles nested groups `<p:grpSp>` accurately without regex greediness bugs!).
 */
function findTopLevelTagBlocks(xml, tagNames) {
  const results = [];
  const tagPattern = new RegExp(
    `<(?:(${tagNames.map((t) => t.replace(":", "\\:")).join("|")}))\\b[^>]*>`,
    "g"
  );

  let match;
  while ((match = tagPattern.exec(xml)) !== null) {
    const tagName = match[1];
    const startIdx = match.index;
    const openToken = match[0];
    if (openToken.endsWith("/>")) {
      results.push({ tagName, start: startIdx, end: startIdx + openToken.length, xml: openToken });
      continue;
    }

    const stepRe = new RegExp(`<(\\/)?${tagName.replace(":", "\\:")}\\b[^>]*>`, "g");
    stepRe.lastIndex = startIdx + openToken.length;
    let depth = 1;
    let stepMatch;
    while ((stepMatch = stepRe.exec(xml)) !== null) {
      const tok = stepMatch[0];
      if (stepMatch[1] === "/") {
        depth--;
        if (depth === 0) {
          const endIdx = stepMatch.index + tok.length;
          results.push({ tagName, start: startIdx, end: endIdx, xml: xml.slice(startIdx, endIdx) });
          tagPattern.lastIndex = endIdx;
          break;
        }
      } else if (!tok.endsWith("/>")) {
        depth++;
      }
    }
  }
  return results;
}

function extractInnerSpTreeContent(containerXml, openTagPrefix) {
  const openMatch = containerXml.match(new RegExp(`^<${openTagPrefix}\\b[^>]*>`));
  const closeSuffix = `</${openTagPrefix}>`;
  if (!openMatch || !containerXml.endsWith(closeSuffix)) return { header: "", body: containerXml, footer: "" };
  const inner = containerXml.slice(openMatch[0].length, containerXml.length - closeSuffix.length);
  // Skip nvGrpSpPr & grpSpPr at start of spTree / grpSp
  const grpPrEnd = inner.indexOf("</p:grpSpPr>");
  if (grpPrEnd >= 0) {
    const splitPos = grpPrEnd + "</p:grpSpPr>".length;
    return {
      header: openMatch[0] + inner.slice(0, splitPos),
      body: inner.slice(splitPos),
      footer: closeSuffix,
    };
  }
  return { header: openMatch[0], body: inner, footer: closeSuffix };
}

function parseXfrmEmu(blockXml) {
  const xfrmMatch = blockXml.match(/<(?:a|p):xfrm\b[^>]*>([\s\S]*?)<\/(?:a|p):xfrm>/);
  if (!xfrmMatch) return null;
  const inner = xfrmMatch[1];
  const offM = inner.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const extM = inner.match(/<a:ext\b[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
  if (!offM || !extM) return null;
  return {
    x: Number.parseInt(offM[1], 10),
    y: Number.parseInt(offM[2], 10),
    cx: Number.parseInt(extM[1], 10),
    cy: Number.parseInt(extM[2], 10),
  };
}

function parseGroupTransform(grpPrXml) {
  const xfrmMatch = grpPrXml.match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/);
  if (!xfrmMatch) return null;
  const s = xfrmMatch[1];
  const off = s.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const ext = s.match(/<a:ext\b[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
  const chOff = s.match(/<a:chOff\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const chExt = s.match(/<a:chExt\b[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
  if (!off || !ext || !chOff || !chExt) return null;
  return {
    offX: Number.parseInt(off[1], 10),
    offY: Number.parseInt(off[2], 10),
    extCx: Number.parseInt(ext[1], 10),
    extCy: Number.parseInt(ext[2], 10),
    chOffX: Number.parseInt(chOff[1], 10),
    chOffY: Number.parseInt(chOff[2], 10),
    chExtCx: Math.max(1, Number.parseInt(chExt[1], 10)),
    chExtCy: Math.max(1, Number.parseInt(chExt[2], 10)),
  };
}

function applyParentMatrix(emuBox, transformStack) {
  if (!emuBox) return null;
  let { x, y, cx, cy } = emuBox;
  for (let i = transformStack.length - 1; i >= 0; i--) {
    const g = transformStack[i];
    if (!g) continue;
    const scaleX = g.extCx / g.chExtCx;
    const scaleY = g.extCy / g.chExtCy;
    x = g.offX + (x - g.chOffX) * scaleX;
    y = g.offY + (y - g.chOffY) * scaleY;
    cx = cx * scaleX;
    cy = cy * scaleY;
  }
  return {
    left: emuToPx(x),
    top: emuToPx(y),
    width: emuToPx(cx),
    height: emuToPx(cy),
  };
}

function extractPlainTextFromXml(blockXml) {
  const paras = [...blockXml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)];
  if (paras.length === 0) return "";
  return paras
    .map((pm) =>
      [...pm[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((tm) => decodeXmlEntities(tm[1]))
        .join("")
    )
    .join("\n");
}

/**
 * Replaces `searchStr` -> `newStr` inside `<p:txBody>` / `<a:txBody>` even when PowerPoint
 * split a Chinese phrase across multiple `<a:r>` runs inside the same `<a:p>`!
 */
function replaceTextInXmlPreservingStyle(xml, searchStr, newStr) {
  if (!searchStr) return xml;
  return xml.replace(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g, (fullPara, pAttrs, pInner) => {
    const runTexts = [...pInner.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1])
    );
    const joined = runTexts.join("");
    if (!joined.includes(searchStr)) return fullPara;

    // Fast path: `searchStr` exists intact inside individual `<a:t>` run(s)
    const escapedSearch = escapeXmlText(searchStr);
    if (pInner.includes(`<a:t>${escapedSearch}`) || runTexts.some((t) => t.includes(searchStr))) {
      const updatedInner = pInner.replace(/<a:t>([\s\S]*?)<\/a:t>/g, (_m, rawT) => {
        const dec = decodeXmlEntities(rawT);
        if (!dec.includes(searchStr)) return _m;
        return `<a:t>${escapeXmlText(dec.split(searchStr).join(newStr))}</a:t>`;
      });
      return `<a:p${pAttrs}>${updatedInner}</a:p>`;
    }

    // Cross-run split word path: preserve `<a:pPr>` and first `<a:rPr>`!
    const pPrMatch = pInner.match(/<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/);
    const firstRPrMatch = pInner.match(/<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/);
    const endParaMatch = pInner.match(/<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>|<a:endParaRPr\b[^>]*\/>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const rPr = firstRPrMatch ? firstRPrMatch[0] : '<a:rPr lang="zh-CN" dirty="0"/>';
    const endPara = endParaMatch ? endParaMatch[0] : "";
    const replacedText = joined.split(searchStr).join(newStr);
    return `<a:p${pAttrs}>${pPr}<a:r>${rPr}<a:t>${escapeXmlText(replacedText)}</a:t></a:r>${endPara}</a:p>`;
  });
}

/**
 * Full text rewrite on an imported `<p:sp>` while preserving its original `<a:bodyPr>`,
 * `<a:lstStyle>`, `<a:pPr>` (alignment, spacing, bullets), and first `<a:rPr>` (font, size, color, bold)!
 */
function rewriteFullShapeTextPreservingTemplateStyle(shapeXml, newText) {
  const lines = String(newText ?? "").split(/\r?\n/);
  const txMatch = shapeXml.match(/<(p|a):txBody\b[^>]*>([\s\S]*?)<\/\1:txBody>/);
  if (!txMatch) {
    // Shape had no txBody yet -> append a clean `<p:txBody>` before `</p:sp>`
    const paras = lines
      .map(
        (ln) =>
          `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>${escapeXmlText(ln)}</a:t></a:r></a:p>`
      )
      .join("");
    return shapeXml.replace(/<\/p:sp>$/, `<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${paras}</p:txBody></p:sp>`);
  }

  const nsPrefix = txMatch[1];
  const txInner = txMatch[2];
  const bodyPr = txInner.match(/<a:bodyPr\b[\s\S]*?<\/a:bodyPr>|<a:bodyPr\b[^>]*\/>/)?.[0] || "<a:bodyPr/>";
  const lstStyle = txInner.match(/<a:lstStyle\b[\s\S]*?<\/a:lstStyle>|<a:lstStyle\b[^>]*\/>/)?.[0] || "<a:lstStyle/>";

  // Extract per-paragraph style templates so multi-paragraph shapes (e.g. Title + Body) keep each paragraph's own pPr & rPr!
  const paraMatches = [...txInner.matchAll(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g)];
  const paraTemplates =
    paraMatches.length > 0
      ? paraMatches.map((pm) => {
          const pAttrs = pm[1] || "";
          const pInner = pm[2] || "";
          const pPr = pInner.match(/<a:pPr\b[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/)?.[0] || "";
          const rPr =
            pInner.match(/<a:rPr\b[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/)?.[0] ||
            pInner
              .match(/<a:endParaRPr\b[\s\S]*?<\/a:endParaRPr>|<a:endParaRPr\b[^>]*\/>/)?.[0]
              ?.replace(/endParaRPr/g, "rPr") ||
            '<a:rPr lang="zh-CN" dirty="0"/>';
          return { pAttrs, pPr, rPr };
        })
      : [{ pAttrs: "", pPr: "", rPr: '<a:rPr lang="zh-CN" dirty="0"/>' }];

  const newParasXml = lines
    .map((ln, idx) => {
      const tpl = paraTemplates[Math.min(idx, paraTemplates.length - 1)];
      return `<a:p${tpl.pAttrs}>${tpl.pPr}<a:r>${tpl.rPr}<a:t>${escapeXmlText(ln)}</a:t></a:r></a:p>`;
    })
    .join("");

  const rebuiltTx = `<${nsPrefix}:txBody>${bodyPr}${lstStyle}${newParasXml}</${nsPrefix}:txBody>`;
  return shapeXml.replace(/<(p|a):txBody\b[^>]*>[\s\S]*?<\/\1:txBody>/, () => rebuiltTx);
}

function parseRelsMap(relsXml) {
  if (!relsXml) return [];
  const out = [];
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const tag = m[0];
    out.push({
      id: getAttr(tag, "Id"),
      type: getAttr(tag, "Type"),
      target: getAttr(tag, "Target"),
      targetMode: getAttr(tag, "TargetMode"),
    });
  }
  return out;
}

function serializeRelsMap(rels) {
  const items = rels
    .map((r) => {
      const tm = r.targetMode ? ` TargetMode="${escapeXmlAttr(r.targetMode)}"` : "";
      return `<Relationship Id="${escapeXmlAttr(r.id)}" Type="${escapeXmlAttr(r.type)}" Target="${escapeXmlAttr(r.target)}"${tm}/>`;
    })
    .join("");
  return XML_HEADER + `<Relationships xmlns="${NS_PR}">${items}</Relationships>`;
}

function resolvePosixPart(basePart, relTarget) {
  if (!relTarget) return "";
  if (relTarget.startsWith("/")) return relTarget.replace(/^\/+/, "");
  const dir = path.posix.dirname(basePart);
  return path.posix.normalize(path.posix.join(dir, relTarget));
}

function coerceSurgicalPlainText(val) {
  if (val === undefined || val === null) return "";
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (Array.isArray(val) && val.every((x) => typeof x === "string" || typeof x === "number")) {
    return val.map(String).join("\n");
  }
  const paras = normalizeParagraphs(val);
  return paras.map((p) => (p.runs || []).map((r) => r.run || "").join("")).join("\n");
}

class ImportedElementFacade {
  constructor(slide, meta) {
    this.slide = slide;
    this.id = meta.id;
    this.ooxmlId = meta.ooxmlId;
    this.kind = meta.kind;
    this.name = meta.name;
    this.alt = meta.alt;
    this.hasImageFill = Boolean(meta.hasImageFill);
    this._position = meta.position;
    this._inGroup = Boolean(meta.inGroup);
    this.placeholder = meta.placeholder;
    this._pathKey = meta.pathKey; // unique node key inside slide XML tree
    this._rawXml = meta.xml;

    const self = this;
    this._textApi = {
      toPlainString() {
        return extractPlainTextFromXml(self._rawXml);
      },
      toString() {
        return this.toPlainString();
      },
      set(val) {
        const str = coerceSurgicalPlainText(val);
        const nextXml = rewriteFullShapeTextPreservingTemplateStyle(self._rawXml, str);
        self.slide._applyElementXmlMutation(self._pathKey, self._rawXml, nextXml);
        self._rawXml = nextXml;
        return this;
      },
      replace(searchStr, nextStr) {
        const nextXml = replaceTextInXmlPreservingStyle(
          self._rawXml,
          String(searchStr),
          String(nextStr)
        );
        self.slide._applyElementXmlMutation(self._pathKey, self._rawXml, nextXml);
        self._rawXml = nextXml;
        return this;
      },
    };

    if (this.kind === "table") {
      this.cells = {
        set(rowIdx, colIdx, newVal) {
          let curRow = -1;
          const nextXml = self._rawXml.replace(/<a:tr\b([^>]*)>([\s\S]*?)<\/a:tr>/g, (fullTr, trA, trBody) => {
            curRow++;
            if (curRow !== rowIdx) return fullTr;
            let curCol = -1;
            const nextRowBody = trBody.replace(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g, (fullTc) => {
              curCol++;
              if (curCol !== colIdx) return fullTc;
              return rewriteFullShapeTextPreservingTemplateStyle(fullTc, coerceSurgicalPlainText(newVal));
            });
            return `<a:tr${trA}>${nextRowBody}</a:tr>`;
          });
          self.slide._applyElementXmlMutation(self._pathKey, self._rawXml, nextXml);
          self._rawXml = nextXml;
        },
      };
    }
  }

  get text() {
    return this._textApi;
  }

  set text(val) {
    this._textApi.set(val);
  }

  get position() {
    return this._position ? { ...this._position } : undefined;
  }

  set position(nextPos) {
    this.reposition(nextPos);
  }

  reposition(nextPos = {}) {
    if (!this._position) return this;
    if (this._inGroup) {
      throw new Error(`Cannot directly reposition grouped child element ${this.id}; edit top-level shape or ungroup`);
    }
    const merged = {
      left: nextPos.left ?? this._position.left,
      top: nextPos.top ?? this._position.top,
      width: nextPos.width ?? this._position.width,
      height: nextPos.height ?? this._position.height,
    };
    const nextXml = this._rawXml.replace(
      /(<(?:a|p):xfrm\b[^>]*>[\s\S]*?<a:off\b[^>]*?\bx=")-?\d+("[^>]*?\by=")-?\d+("[\s\S]*?<a:ext\b[^>]*?\bcx=")-?\d+("[^>]*?\bcy=")-?\d+(")/,
      `$1${pxToEmu(merged.left)}$2${pxToEmu(merged.top)}$3${pxToEmu(merged.width)}$4${pxToEmu(merged.height)}$5`
    );
    this.slide._applyElementXmlMutation(this._pathKey, this._rawXml, nextXml);
    this._rawXml = nextXml;
    this._position = merged;
    return this;
  }

  get frame() {
    return this.position ? { ...this.position } : undefined;
  }

  /**
   * In-place image replacement preserving 100% of original mask geometry, border, shadow,
   * rotation, and recalculating center-crop `<a:srcRect>` for `fit="cover"`!
   * Supports both `<p:pic>` elements AND `<p:sp>` picture-filled shapes (`<a:blipFill>`).
   */
  replace(options = {}) {
    if (this.kind !== "image" && !this.hasImageFill) {
      throw new Error(`replace() requires an image or blipFill element (got ${this.kind} on ${this.id})`);
    }
    const src = resolveImageSource(options);
    const newRelId = this.slide._addIsolatedSlideMedia(src);

    let nextXml = this._rawXml;
    // Strip any embedded SVG extension (`<a:extLst>...asvg:svgBlip...</a:extLst>`) inside `<a:blip>` so PowerPoint uses the new raster/image!
    nextXml = nextXml.replace(
      /<a:blip\b([^>]*?)\br:embed="[^"]*"([^>]*?)(?:\/>|>[\s\S]*?<\/a:blip>)/,
      `<a:blip$1r:embed="${newRelId}"$2/>`
    );

    const fit = options.fit || "cover";
    if (this.position && this.position.width > 0 && this.position.height > 0 && fit === "cover") {
      const { srcRect } = computeImagePlacementAndCrop({
        sourceWidth: src.width,
        sourceHeight: src.height,
        frame: this.position,
        fit: "cover",
        crop: options.crop,
      });
      const srcRectTag = srcRect
        ? `<a:srcRect l="${srcRect.l}" t="${srcRect.t}" r="${srcRect.r}" b="${srcRect.b}"/>`
        : `<a:srcRect/>`;
      if (/<a:srcRect\b[^>]*\/>/.test(nextXml)) {
        nextXml = nextXml.replace(/<a:srcRect\b[^>]*\/>/, srcRectTag);
      } else {
        // ECMA-376 CT_BlipFillProperties: `<a:srcRect/>` immediately follows `<a:blip .../>`!
        nextXml = nextXml.replace(/(<a:blip\b[^>]*\/>)/, `$1${srcRectTag}`);
      }
      if (!/<a:stretch\b/.test(nextXml)) {
        nextXml = nextXml.replace(
          /<a:tile\b[^>]*\/>|<a:tile\b[\s\S]*?<\/a:tile>/,
          "<a:stretch><a:fillRect/></a:stretch>"
        );
      }
    }

    if (options.alt) {
      nextXml = nextXml.replace(
        /(<p:cNvPr\b[^>]*?\bdescr=")[^"]*(")/,
        `$1${escapeXmlAttr(options.alt)}$2`
      );
    }

    this.slide._applyElementXmlMutation(this._pathKey, this._rawXml, nextXml);
    this._rawXml = nextXml;
    return this;
  }

  delete() {
    this.slide._applyElementXmlMutation(this._pathKey, this._rawXml, "");
    this.slide._elements = this.slide._elements.filter((e) => e !== this);
  }
}

export class ImportedSlide {
  constructor(deck, slideIndex0, slidePartPath) {
    this.presentation = deck;
    this.index = slideIndex0;
    this.slideNumber = slideIndex0 + 1;
    this.partPath = slidePartPath;
    this.relsPath = path.posix.join(
      path.posix.dirname(slidePartPath),
      "_rels",
      `${path.posix.basename(slidePartPath)}.rels`
    );
    this.id = `sl/s${String(this.slideNumber).padStart(2, "0")}`;

    this._xml = deck._readText(slidePartPath);
    this._rels = parseRelsMap(deck._readText(this.relsPath));
    this._elements = [];
    this._injectedElements = [];

    this._parseElements();
    this._setupHybridAuthoringApis();
  }

  _setupHybridAuthoringApis() {
    const self = this;
    this.shapes = {
      get items() {
        return [
          ...self._elements.filter((e) => e.kind === "shape" || e.kind === "textbox"),
          ...self._injectedElements.filter((e) => e instanceof ShapeElement || e instanceof ConnectorElement),
        ];
      },
      getByName(name) {
        return this.items.find((e) => e.name === name || e.id === name) || null;
      },
      add(config = {}) {
        if (config.geometry === "connector") {
          const fromShape = self._resolveShapeRef(config.from);
          const toShape = self._resolveShapeRef(config.to);
          const el = new ConnectorElement(self, self.presentation._nextOoxmlId(), {
            ...config,
            fromShape,
            toShape,
          });
          self._injectedElements.push(el);
          return el;
        }
        const el = new ShapeElement(self, self.presentation._nextOoxmlId(), config);
        self._injectedElements.push(el);
        return el;
      },
      connect(fromRef, toRef, options = {}) {
        const fromShape = self._resolveShapeRef(fromRef);
        const toShape = self._resolveShapeRef(toRef);
        if (!fromShape || !toShape) {
          throw new Error("slide.shapes.connect requires valid source and target shapes");
        }
        const el = new ConnectorElement(self, self.presentation._nextOoxmlId(), {
          ...options,
          fromShape,
          toShape,
        });
        self._injectedElements.push(el);
        return el;
      },
    };

    this.images = {
      get items() {
        return [
          ...self._elements.filter((e) => e.kind === "image"),
          ...self._injectedElements.filter((e) => e instanceof ImageElement),
        ];
      },
      getByName(name) {
        return this.items.find((e) => e.name === name || e.id === name) || null;
      },
      add(options = {}) {
        const el = new ImageElement(self, self.presentation._nextOoxmlId(), options);
        self._injectedElements.push(el);
        return el;
      },
    };

    this.tables = {
      get items() {
        return [
          ...self._elements.filter((e) => e.kind === "table"),
          ...self._injectedElements.filter((e) => e instanceof TableElement),
        ];
      },
      add(options = {}) {
        const el = new TableElement(self, self.presentation._nextOoxmlId(), options);
        self._injectedElements.push(el);
        return el;
      },
    };

    this.charts = {
      get items() {
        return [
          ...self._elements.filter((e) => e.kind === "chart"),
          ...self._injectedElements.filter((e) => e instanceof ChartElement),
        ];
      },
      add(chartTypeOrOptions = "bar", options = {}) {
        const isObjFirst = chartTypeOrOptions && typeof chartTypeOrOptions === "object";
        const resolvedType = isObjFirst
          ? chartTypeOrOptions.type || chartTypeOrOptions.chartType || "bar"
          : chartTypeOrOptions || "bar";
        const resolvedOpts = isObjFirst ? chartTypeOrOptions : options;
        const el = new ChartElement(self, self.presentation._nextOoxmlId(), resolvedType, resolvedOpts);
        self._injectedElements.push(el);
        return el;
      },
    };
  }

  _resolveShapeRef(ref) {
    if (!ref) return null;
    if (typeof ref === "object" && ref.ooxmlId) return ref;
    if (typeof ref === "string") {
      return (
        this._elements.find((e) => e.id === ref || e.name === ref) ||
        this._injectedElements.find((e) => e.id === ref || e.name === ref) ||
        null
      );
    }
    return null;
  }

  getSlot(nameOrId) {
    if (!nameOrId) return null;
    return (
      this._elements.find((e) => e.name === nameOrId || e.id === nameOrId) ||
      this._injectedElements.find((e) => e.name === nameOrId || e.id === nameOrId) ||
      null
    );
  }

  /**
   * In-place theme recoloring for Phase-2 slot filling on a locked master slide.
   * Swaps `<a:srgbClr val="OLD">` -> `<a:srgbClr val="NEW">` while preserving alpha,
   * gradients, geometry, rotations, and keeping all element handles synced.
   */
  recolor(colorMap = {}) {
    const entries = Object.entries(colorMap)
      .map(([fromHex, toHex]) => [
        String(fromHex || "").replace(/^#/, "").trim().toUpperCase(),
        String(toHex || "").replace(/^#/, "").trim().toUpperCase(),
      ])
      .filter(([a, b]) => /^[0-9A-F]{6}$/.test(a) && /^[0-9A-F]{6}$/.test(b) && a !== b);
    if (entries.length === 0) return this;

    // Two-pass replacement via temporary sentinel avoids A->B + B->C collisions
    const applyMap = (xmlStr) => {
      let out = xmlStr;
      entries.forEach(([fromHex], idx) => {
        out = out.replace(
          new RegExp(`(<a:srgbClr\\b[^>]*\\bval=")${fromHex}(")`, "gi"),
          `$1__YM_CLR_${idx}__$2`
        );
      });
      entries.forEach(([, toHex], idx) => {
        out = out.replace(
          new RegExp(`__YM_CLR_${idx}__`, "g"),
          toHex
        );
      });
      return out;
    };

    this._xml = applyMap(this._xml);
    for (const el of this._elements) {
      if (typeof el._rawXml === "string") {
        el._rawXml = applyMap(el._rawXml);
      }
    }
    return this;
  }

  compose(nodeTree, options = {}) {
    return composeIntoSlide(this, nodeTree, options);
  }

  _removeElement(el) {
    this._injectedElements = this._injectedElements.filter((x) => x !== el);
  }

  _moveElement() {}

  _parseElements() {
    this._elements = [];
    const spTreeBlocks = findTopLevelTagBlocks(this._xml, ["p:spTree"]);
    if (spTreeBlocks.length === 0) return;

    let seq = 0;
    const walkContainer = (containerXml, openTag, transformStack) => {
      const { body } = extractInnerSpTreeContent(containerXml, openTag);
      const blocks = findTopLevelTagBlocks(body, [
        "p:sp",
        "p:pic",
        "p:graphicFrame",
        "p:cxnSp",
        "p:grpSp",
      ]);

      for (const blk of blocks) {
        seq++;
        if (blk.tagName === "p:grpSp") {
          const grpPr = blk.xml.match(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/)?.[0] || "";
          const gTransform = parseGroupTransform(grpPr);
          walkContainer(blk.xml, "p:grpSp", [...transformStack, gTransform]);
          continue;
        }

        const cNvPrTag = blk.xml.match(/<p:cNvPr\b[^>]*>/)?.[0] || "";
        const ooxmlId = Number.parseInt(getAttr(cNvPrTag, "id") || String(seq), 10);
        const name = getAttr(cNvPrTag, "name") || `${blk.tagName}-${ooxmlId}`;
        const descr = getAttr(cNvPrTag, "descr") || "";
        const phTag = blk.xml.match(/<p:ph\b[^>]*\/?>/)?.[0];
        const placeholder = phTag
          ? { type: getAttr(phTag, "type") || "body", idx: getAttr(phTag, "idx") || "" }
          : undefined;

        const emuBox = parseXfrmEmu(blk.xml);
        const position = applyParentMatrix(emuBox, transformStack);

        let kind = "shape";
        let prefix = "sh";
        if (blk.tagName === "p:pic") {
          kind = "image";
          prefix = "im";
        } else if (blk.tagName === "p:graphicFrame") {
          if (blk.xml.includes("<a:tbl")) {
            kind = "table";
            prefix = "tb";
          } else if (blk.xml.includes(":chart")) {
            kind = "chart";
            prefix = "ch";
          } else {
            kind = "graphicFrame";
            prefix = "sh";
          }
        } else if (blk.tagName === "p:sp") {
          const isTx = /<p:cNvSpPr\b[^>]*\btxBox="1"/.test(blk.xml);
          kind = isTx ? "textbox" : "shape";
          prefix = "sh";
        }

        const id = `${prefix}/s${String(this.slideNumber).padStart(2, "0")}_${ooxmlId}_${seq}`;
        const hasImageFill = /<a:blip\b[^>]*\br:embed="[^"]+"/.test(blk.xml);
        const facade = new ImportedElementFacade(this, {
          id,
          ooxmlId,
          kind,
          name,
          alt: descr,
          hasImageFill,
          inGroup: transformStack.length > 0,
          position,
          placeholder,
          pathKey: id,
          xml: blk.xml,
        });
        this._elements.push(facade);
      }
    };

    walkContainer(spTreeBlocks[0].xml, "p:spTree", []);
  }

  _nextRelId() {
    let maxN = 0;
    for (const r of this._rels) {
      const m = String(r.id || "").match(/^rId(\d+)$/);
      if (m) maxN = Math.max(maxN, Number.parseInt(m[1], 10));
    }
    return `rId${maxN + 1}`;
  }

  _addIsolatedSlideMedia({ bytes, ext, contentType }) {
    const mediaRelTarget = this.presentation._allocatePackageMedia({ bytes, ext, contentType });
    const rId = this._nextRelId();
    this._rels.push({
      id: rId,
      type: `${NS_R}/image`,
      target: `../media/${mediaRelTarget}`,
    });
    return rId;
  }

  _applyElementXmlMutation(_key, prevXml, nextXml) {
    const idx = this._xml.indexOf(prevXml);
    if (idx < 0) {
      throw new Error(`Could not locate exact XML block in ${this.partPath} during surgical edit`);
    }
    this._xml = this._xml.slice(0, idx) + nextXml + this._xml.slice(idx + prevXml.length);
  }

  _flushToPackage() {
    let finalSlideXml = this._xml;

    if (this._injectedElements.length > 0) {
      const ctx = {
        registerMedia: (spec) => this._addIsolatedSlideMedia(spec),
        registerHyperlink: (uri) => {
          const rId = this._nextRelId();
          this._rels.push({
            id: rId,
            type: `${NS_R}/hyperlink`,
            target: String(uri),
            targetMode: "External",
          });
          return rId;
        },
        registerChart: ({ chartXml, workbookBuf }) => {
          const chartTarget = this.presentation._allocatePackageChart({ chartXml, workbookBuf });
          const rId = this._nextRelId();
          this._rels.push({
            id: rId,
            type: `${NS_R}/chart`,
            target: `../charts/${chartTarget}`,
          });
          return rId;
        },
      };

      const injectedXml = this._injectedElements.map((el) => el.toXml(ctx)).join("");
      // Keep ECMA-376 CT_GroupShape child order: insert before any top-level `<p:extLst>` inside `<p:spTree>`!
      const spTreeBlocks = findTopLevelTagBlocks(finalSlideXml, ["p:spTree"]);
      if (spTreeBlocks.length > 0) {
        const spTreeBlk = spTreeBlocks[0];
        const { header, body, footer } = extractInnerSpTreeContent(spTreeBlk.xml, "p:spTree");
        const topChildren = findTopLevelTagBlocks(body, [
          "p:sp",
          "p:grpSp",
          "p:graphicFrame",
          "p:cxnSp",
          "p:pic",
          "p:contentPart",
          "mc:AlternateContent",
          "p:extLst",
        ]);
        const extBlk = topChildren.find((b) => b.tagName === "p:extLst");
        const nextBody = extBlk
          ? body.slice(0, extBlk.start) + injectedXml + body.slice(extBlk.start)
          : body + injectedXml;
        const rebuiltSpTree = header + nextBody + footer;
        finalSlideXml =
          finalSlideXml.slice(0, spTreeBlk.start) +
          rebuiltSpTree +
          finalSlideXml.slice(spTreeBlk.end);
      } else {
        finalSlideXml = finalSlideXml.replace(/<\/p:spTree>/, () => `${injectedXml}</p:spTree>`);
      }
    }

    // Prune orphaned image/chart relationships whose rId was deleted or replaced in `finalSlideXml`
    const prunedRels = this._rels.filter((r) => {
      const t = String(r.type || "");
      if (t.endsWith("/image") || t.endsWith("/chart")) {
        return finalSlideXml.includes(`"${r.id}"`);
      }
      return true;
    });

    this.presentation._writeText(this.partPath, finalSlideXml);
    this.presentation._writeText(this.relsPath, serializeRelsMap(prunedRels));
  }
}

export class ImportedPresentation {
  constructor(zipFilesMap, sourcePath = "") {
    this.id = `pr/imp_${createHash("sha1").update(sourcePath || String(Date.now())).digest("hex").slice(0, 8)}`;
    this.sourcePath = sourcePath;
    this._files = new Map(zipFilesMap);
    this.defaultFont = "Microsoft YaHei";
    this._ooxmlSeq = 9000;
    this._mediaCounter = 500;
    this._chartCounter = 500;

    // Discover slide size & logical slide order from `ppt/presentation.xml`
    const presXml = this._readText("ppt/presentation.xml");
    const presRels = parseRelsMap(this._readText("ppt/_rels/presentation.xml.rels"));
    const relById = new Map(presRels.map((r) => [r.id, r]));

    const szMatch = presXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    this.slideSize = szMatch
      ? {
          width: Math.round(emuToPx(Number.parseInt(szMatch[1], 10))),
          height: Math.round(emuToPx(Number.parseInt(szMatch[2], 10))),
          cxEmu: Number.parseInt(szMatch[1], 10),
          cyEmu: Number.parseInt(szMatch[2], 10),
        }
      : { width: 1280, height: 720, cxEmu: pxToEmu(1280), cyEmu: pxToEmu(720) };

    const sldIdMatches = [...presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)];
    this._slides = sldIdMatches
      .map((m, idx) => {
        const rel = relById.get(m[1]);
        if (!rel) return null;
        const partPath = resolvePosixPart("ppt/presentation.xml", rel.target);
        return new ImportedSlide(this, idx, partPath);
      })
      .filter(Boolean);

    const self = this;
    this.slides = {
      get items() {
        return [...self._slides];
      },
      get count() {
        return self._slides.length;
      },
      getItem(idx) {
        return self._slides[idx];
      },
    };
  }

  static async load(pptxPathOrBlob) {
    if (typeof pptxPathOrBlob === "string") {
      const abs = path.resolve(pptxPathOrBlob);
      const buf = await fs.readFile(abs);
      return new ImportedPresentation(readZipBuffer(buf), abs);
    }
    if (pptxPathOrBlob?.bytes) {
      return new ImportedPresentation(readZipBuffer(pptxPathOrBlob.bytes), pptxPathOrBlob.path || "");
    }
    if (Buffer.isBuffer(pptxPathOrBlob) || pptxPathOrBlob instanceof Uint8Array) {
      return new ImportedPresentation(readZipBuffer(pptxPathOrBlob), "");
    }
    throw new Error("Presentation.load expects a file path, FileBlob, or Uint8Array");
  }

  _nextOoxmlId() {
    return ++this._ooxmlSeq;
  }

  _readText(partPath) {
    const buf = this._files.get(partPath);
    return buf ? buf.toString("utf8") : "";
  }

  _writeText(partPath, xmlString) {
    this._files.set(partPath, Buffer.from(xmlString, "utf8"));
  }

  _ensureContentTypeDefault(ext, mime) {
    const cleanExt = ext.replace(/^\./, "").toLowerCase();
    let ct = this._readText("[Content_Types].xml");
    if (!new RegExp(`<Default\\b[^>]*\\bExtension="${cleanExt}"`, "i").test(ct)) {
      ct = ct.replace(
        /<Types\b([^>]*)>/,
        `<Types$1><Default Extension="${escapeXmlAttr(cleanExt)}" ContentType="${escapeXmlAttr(mime)}"/>`
      );
      this._writeText("[Content_Types].xml", ct);
    }
  }

  _ensureContentTypeOverride(partNameWithLeadingSlash, mime) {
    let ct = this._readText("[Content_Types].xml");
    if (!ct.includes(`PartName="${partNameWithLeadingSlash}"`)) {
      ct = ct.replace(
        /<\/Types>/,
        `<Override PartName="${escapeXmlAttr(partNameWithLeadingSlash)}" ContentType="${escapeXmlAttr(mime)}"/></Types>`
      );
      this._writeText("[Content_Types].xml", ct);
    }
  }

  _allocatePackageMedia({ bytes, ext, contentType }) {
    const cleanExt = (ext || ".png").replace(/^\./, "").toLowerCase();
    while (this._files.has(`ppt/media/ym_media_${this._mediaCounter}.${cleanExt}`)) {
      this._mediaCounter++;
    }
    const filename = `ym_media_${this._mediaCounter++}.${cleanExt}`;
    this._files.set(`ppt/media/${filename}`, Buffer.from(bytes));
    this._ensureContentTypeDefault(cleanExt, contentType || "image/png");
    return filename;
  }

  _allocatePackageChart({ chartXml, workbookBuf }) {
    while (this._files.has(`ppt/charts/ym_chart_${this._chartCounter}.xml`)) {
      this._chartCounter++;
    }
    const idx = this._chartCounter++;
    const chartFile = `ym_chart_${idx}.xml`;
    const wbFile = `ym_workbook_${idx}.xlsx`;

    this._writeText(`ppt/charts/${chartFile}`, chartXml);
    this._files.set(`ppt/embeddings/${wbFile}`, Buffer.from(workbookBuf));
    this._writeText(
      `ppt/charts/_rels/${chartFile}.rels`,
      serializeRelsMap([
        { id: "rId1", type: `${NS_R}/package`, target: `../embeddings/${wbFile}` },
      ])
    );
    this._ensureContentTypeDefault(
      "xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    this._ensureContentTypeOverride(
      `/ppt/charts/${chartFile}`,
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
    );
    return chartFile;
  }

  resolve(anchorId) {
    for (const sl of this._slides) {
      if (sl.id === anchorId) return sl;
      for (const el of sl._elements) {
        if (el.id === anchorId || el.name === anchorId) return el;
      }
      for (const el of sl._injectedElements) {
        if (el.id === anchorId || el.name === anchorId) return el;
      }
    }
    return null;
  }

  async inspect(options = {}) {
    const search = options.search ? String(options.search).toLowerCase() : null;
    const kindSet = options.kind
      ? new Set(String(options.kind).split(",").map((s) => s.trim()))
      : null;
    const slideFilter = Array.isArray(options.slideNumbers)
      ? new Set(options.slideNumbers)
      : null;

    const records = [];
    for (const sl of this._slides) {
      if (slideFilter && !slideFilter.has(sl.slideNumber)) continue;
      const elements = sl._elements
        .map((el) => {
          const text = el.text.toPlainString();
          return {
            id: el.id,
            kind: el.kind,
            name: el.name,
            hasImageFill: el.hasImageFill || undefined,
            position: el.position,
            placeholder: el.placeholder,
            text: text || undefined,
          };
        })
        .filter((item) => {
          if (kindSet && !kindSet.has(item.kind) && !kindSet.has("slide")) return false;
          if (!search) return true;
          return (
            (item.text && item.text.toLowerCase().includes(search)) ||
            (item.name && item.name.toLowerCase().includes(search))
          );
        });

      records.push({
        id: sl.id,
        kind: "slide",
        index: sl.index,
        slide: sl.slideNumber,
        partPath: sl.partPath,
        elements,
      });
    }

    const ndjson = records.map((r) => JSON.stringify(r)).join("\n");
    return {
      schema: "yuanmou.presentation.inspection/v1",
      unit: "px",
      slideSize: this.slideSize,
      records,
      recordCount: records.length,
      ndjson,
    };
  }

  _gcUnreferencedPackageParts() {
    const reachable = new Set(["[Content_Types].xml", "_rels/.rels"]);
    const queue = [""];
    const relsPathFor = (part) =>
      part === ""
        ? "_rels/.rels"
        : path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);

    while (queue.length > 0) {
      const curPart = queue.shift();
      const rPath = relsPathFor(curPart);
      if (!this._files.has(rPath)) continue;
      reachable.add(rPath);
      const rels = parseRelsMap(this._readText(rPath));
      for (const r of rels) {
        if (r.targetMode === "External" || !r.target) continue;
        const targetPart =
          curPart === ""
            ? r.target.replace(/^\/+/, "")
            : resolvePosixPart(curPart, r.target);
        if (this._files.has(targetPart) && !reachable.has(targetPart)) {
          reachable.add(targetPart);
          queue.push(targetPart);
        }
      }
    }

    const removedParts = new Set();
    for (const partName of [...this._files.keys()]) {
      if (!reachable.has(partName)) {
        this._files.delete(partName);
        removedParts.add(`/${partName}`);
      }
    }

    if (removedParts.size > 0 && this._files.has("[Content_Types].xml")) {
      let ct = this._readText("[Content_Types].xml");
      ct = ct.replace(/<Override\b[^>]*\bPartName="([^"]+)"[^>]*\/>/g, (full, pName) =>
        removedParts.has(pName) ? "" : full
      );
      this._writeText("[Content_Types].xml", ct);
    }
  }

  toPptxBuffer() {
    for (const sl of this._slides) {
      sl._flushToPackage();
    }
    this._gcUnreferencedPackageParts();
    const orderedEntries = [];
    if (this._files.has("[Content_Types].xml")) {
      orderedEntries.push({
        name: "[Content_Types].xml",
        data: this._files.get("[Content_Types].xml"),
      });
    }
    for (const [name, data] of this._files.entries()) {
      if (name === "[Content_Types].xml") continue;
      orderedEntries.push({ name, data });
    }
    return buildZipBuffer(orderedEntries);
  }

  async save(outputPath) {
    const abs = path.resolve(outputPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, this.toPptxBuffer());
    return abs;
  }
}

// ============================================================================
// Template-Following 5-Piece Surgical Pipeline (武器 08 ~ 11)
// ============================================================================

const ALLOWED_PLAN_ACTIONS = new Set([
  "rewrite",
  "rewrite-and-reposition",
  "replace",
  "delete",
  "keep",
  "fill-placeholder",
]);

/**
 * 武器 08: Full template deck inspection (fonts, media, slide dimensions, element anchors).
 */
export async function inspectTemplateDeck({ pptxPath, outDir }) {
  const absPptx = path.resolve(pptxPath);
  const deck = await ImportedPresentation.load(absPptx);
  const inspection = await deck.inspect();

  const fonts = new Set();
  const media = [];
  for (const [partName, buf] of deck._files.entries()) {
    if (partName.startsWith("ppt/media/")) {
      media.push({ partName, bytes: buf.length });
    } else if (/^ppt\/(slides|slideMasters|slideLayouts|theme)\/.*\.xml$/.test(partName)) {
      const xml = buf.toString("utf8");
      for (const m of xml.matchAll(/\btypeface="([^"+][^"]*)"/g)) {
        fonts.add(m[1]);
      }
    }
  }

  const manifest = {
    sourcePptx: path.basename(absPptx),
    slideSize: deck.slideSize,
    slideCount: deck.slides.count,
    fonts: [...fonts].sort(),
    mediaCount: media.length,
    media,
  };

  if (outDir) {
    const absOut = path.resolve(outDir);
    await fs.mkdir(absOut, { recursive: true });
    await fs.writeFile(
      path.join(absOut, "template-inspect.ndjson"),
      inspection.ndjson + "\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(absOut, "template-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8"
    );
  }

  return { deck, manifest, inspection };
}

/**
 * 武器 09: Validates a `template-frame-map.json` BEFORE creating starter deck or editing.
 */
export function validateTemplatePlan({ map, inspection }) {
  const issues = [];
  if (!map || !Array.isArray(map.outputSlides) || map.outputSlides.length === 0) {
    return {
      status: "fail",
      issues: [{ severity: "fail", id: "empty-output-slides", message: "outputSlides must be a non-empty array" }],
    };
  }

  const slideByNo = new Map((inspection?.records || []).map((r) => [r.slide, r]));

  map.outputSlides.forEach((entry, idx) => {
    const expectedNo = idx + 1;
    if (entry.outputSlide !== expectedNo) {
      issues.push({
        severity: "fail",
        id: "non-sequential-output-slide",
        message: `Expected outputSlide ${expectedNo}, got ${entry.outputSlide}`,
      });
    }
    const srcRecord = slideByNo.get(entry.sourceSlide);
    if (!srcRecord) {
      issues.push({
        severity: "fail",
        id: "invalid-source-slide",
        message: `outputSlide ${entry.outputSlide} references nonexistent sourceSlide ${entry.sourceSlide}`,
      });
      return;
    }
    if (!entry.narrativeRole || !String(entry.narrativeRole).trim()) {
      issues.push({
        severity: "fail",
        id: "missing-narrative-role",
        message: `outputSlide ${entry.outputSlide} is missing narrativeRole`,
      });
    }

    const targets = Array.isArray(entry.editTargets) ? entry.editTargets : [];
    const targetedIds = new Set();
    for (const t of targets) {
      if (!ALLOWED_PLAN_ACTIONS.has(t.action)) {
        issues.push({
          severity: "fail",
          id: "invalid-edit-action",
          message: `Invalid action "${t.action}" on outputSlide ${entry.outputSlide}`,
        });
      }
      if (t.targetId) targetedIds.add(t.targetId);
    }

    // Check if source slide has placeholder-like text that wasn't planned in editTargets!
    for (const el of srcRecord.elements || []) {
      if (el.text && isPlaceholderText(el.text) && !targetedIds.has(el.id)) {
        issues.push({
          severity: "fail",
          id: "unhandled-placeholder",
          message: `Source slide ${entry.sourceSlide} element ${el.id} has placeholder "${el.text}" not covered in editTargets`,
        });
      }
    }
  });

  return {
    status: issues.some((i) => i.severity === "fail") ? "fail" : "pass",
    issues,
  };
}

/**
 * 武器 10: Losslessly clones & reorders selected `sourceSlide`s from a source `.pptx`
 * into a clean editable starter `.pptx` (preserving all masters, layouts, themes, media, and gradients!).
 */
export async function prepareStarterDeck({ pptxPath, map, outPptxPath }) {
  const { deck, inspection } = await inspectTemplateDeck({ pptxPath });
  const planCheck = validateTemplatePlan({ map, inspection });
  if (planCheck.status === "fail") {
    throw new Error(
      `Template plan validation failed:\n` +
        planCheck.issues.map((x) => `  - [${x.id}] ${x.message}`).join("\n")
    );
  }

  // Snapshot original slide XML & rels by 1-based sourceSlide number
  const origSlideSnapshots = new Map();
  for (const sl of deck._slides) {
    // Strip notesSlide relationship on cloned slides to avoid two duplicated slides sharing one notesSlide!
    const cleanRels = sl._rels.filter((r) => !String(r.type || "").endsWith("/notesSlide"));
    origSlideSnapshots.set(sl.slideNumber, {
      xml: sl._xml,
      rels: cleanRels,
    });
  }

  // Remove all old `ppt/slides/slide*.xml`, `ppt/slides/_rels/slide*.xml.rels`, and `ppt/notesSlides/*`
  for (const key of [...deck._files.keys()]) {
    if (
      /^ppt\/slides\/slide\d+\.xml$/.test(key) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(key) ||
      key.startsWith("ppt/notesSlides/")
    ) {
      deck._files.delete(key);
    }
  }

  // Write newly cloned sequential slides `slide1.xml .. slideK.xml`
  const sortedPlan = [...map.outputSlides].sort((a, b) => a.outputSlide - b.outputSlide);
  sortedPlan.forEach((entry, idx) => {
    const newNo = idx + 1;
    const snap = origSlideSnapshots.get(entry.sourceSlide);
    deck._writeText(`ppt/slides/slide${newNo}.xml`, snap.xml);
    deck._writeText(
      `ppt/slides/_rels/slide${newNo}.xml.rels`,
      serializeRelsMap(snap.rels)
    );
  });

  // Update `ppt/_rels/presentation.xml.rels`
  const presRels = parseRelsMap(deck._readText("ppt/_rels/presentation.xml.rels")).filter(
    (r) => !String(r.type || "").endsWith("/slide")
  );
  let maxRelNum = 0;
  for (const r of presRels) {
    const m = String(r.id || "").match(/^rId(\d+)$/);
    if (m) maxRelNum = Math.max(maxRelNum, Number.parseInt(m[1], 10));
  }

  const newSldIdsXml = sortedPlan
    .map((_, idx) => {
      const newNo = idx + 1;
      const rId = `rId${++maxRelNum}`;
      presRels.push({
        id: rId,
        type: `${NS_R}/slide`,
        target: `slides/slide${newNo}.xml`,
      });
      return `<p:sldId id="${256 + idx}" r:id="${rId}"/>`;
    })
    .join("");

  deck._writeText("ppt/_rels/presentation.xml.rels", serializeRelsMap(presRels));

  // Update `ppt/presentation.xml` `<p:sldIdLst>`
  let presXml = deck._readText("ppt/presentation.xml");
  presXml = presXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${newSldIdsXml}</p:sldIdLst>`
  );
  deck._writeText("ppt/presentation.xml", presXml);

  // Update `[Content_Types].xml` slide & notes overrides
  let ctXml = deck._readText("[Content_Types].xml");
  ctXml = ctXml.replace(
    /<Override\b[^>]*\bPartName="\/ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml"[^>]*\/>/g,
    ""
  );
  const slideOverrides = sortedPlan
    .map(
      (_, idx) =>
        `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("");
  ctXml = ctXml.replace(/<\/Types>/, `${slideOverrides}</Types>`);
  deck._writeText("[Content_Types].xml", ctXml);

  // Garbage-collect unreferenced media/charts/tags from removed source slides!
  deck._gcUnreferencedPackageParts();

  // Rebuild clean ZIP buffer & reload as an `ImportedPresentation` ready for surgical in-place edits!
  const outEntries = [{ name: "[Content_Types].xml", data: deck._files.get("[Content_Types].xml") }];
  for (const [name, data] of deck._files.entries()) {
    if (name !== "[Content_Types].xml") outEntries.push({ name, data });
  }
  const starterBuf = buildZipBuffer(outEntries);

  if (outPptxPath) {
    const absOut = path.resolve(outPptxPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, starterBuf);
  }

  return ImportedPresentation.load(starterBuf);
}

/**
 * 武器 11: Anti-cheat template fidelity auditor.
 * Verifies slide dimensions match source, zero unresolved placeholders remain,
 * master/layout relationships are intact, and authoring scripts didn't use banned tools (`python-pptx`).
 */
export async function auditTemplateFidelity({
  sourcePptxPath,
  finalPptxPath,
  expectedSlideCount,
  authoringScriptPaths = [],
}) {
  const issues = [];
  const srcDeck = await ImportedPresentation.load(sourcePptxPath);
  const finDeck = await ImportedPresentation.load(finalPptxPath);

  if (
    srcDeck.slideSize.cxEmu !== finDeck.slideSize.cxEmu ||
    srcDeck.slideSize.cyEmu !== finDeck.slideSize.cyEmu
  ) {
    issues.push({
      severity: "fail",
      code: "slide_dimension_mismatch",
      message: `Slide EMU size changed from ${srcDeck.slideSize.cxEmu}x${srcDeck.slideSize.cyEmu} to ${finDeck.slideSize.cxEmu}x${finDeck.slideSize.cyEmu}`,
    });
  }

  if (expectedSlideCount !== undefined && finDeck.slides.count !== expectedSlideCount) {
    issues.push({
      severity: "fail",
      code: "slide_count_mismatch",
      message: `Expected ${expectedSlideCount} slides, found ${finDeck.slides.count}`,
    });
  }

  const finInspect = await finDeck.inspect();
  for (const sl of finInspect.records) {
    for (const el of sl.elements) {
      if (el.text && isPlaceholderText(el.text)) {
        issues.push({
          severity: "fail",
          code: "unresolved_placeholder",
          slide: sl.slide,
          elementId: el.id,
          message: `Slide ${sl.slide} (${el.id}) still contains unresolved placeholder: "${el.text}"`,
        });
      }
    }
  }

  for (const scriptPath of authoringScriptPaths) {
    const code = await fs.readFile(scriptPath, "utf8").catch(() => "");
    if (/\bfrom\s+pptx\s+import\b|\bimport\s+pptx\b/.test(code)) {
      issues.push({
        severity: "fail",
        code: "banned_python_pptx",
        file: scriptPath,
        message: `Banned python-pptx usage detected in ${scriptPath}`,
      });
    }
    if (/\bsoffice\b[\s\S]{0,100}--convert-to\s+pptx/i.test(code)) {
      issues.push({
        severity: "fail",
        code: "banned_libreoffice_pptx_mutation",
        file: scriptPath,
        message: `Banned LibreOffice PPTX mutation detected in ${scriptPath}`,
      });
    }
  }

  return {
    passed: !issues.some((i) => i.severity === "fail"),
    slideCount: finDeck.slides.count,
    slideSize: finDeck.slideSize,
    issues,
  };
}

function guessMimeFromExt(ext) {
  const e = String(ext || "").replace(/^\./, "").toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "gif") return "image/gif";
  if (e === "webp") return "image/webp";
  if (e === "svg") return "image/svg+xml";
  if (e === "emf") return "image/x-emf";
  if (e === "wmf") return "image/x-wmf";
  if (e === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === "mp4") return "video/mp4";
  if (e === "mp3") return "audio/mpeg";
  return "application/octet-stream";
}

async function loadAnyDeckSource(src) {
  if (!src) throw new Error("assembleDeck received an empty source");
  if (src instanceof ImportedPresentation) {
    return ImportedPresentation.load(src.toPptxBuffer());
  }
  if (typeof src.toPptxBuffer === "function") {
    return ImportedPresentation.load(src.toPptxBuffer());
  }
  return ImportedPresentation.load(src);
}

function pickDefaultSlideLayoutTarget(baseDeck) {
  const layoutParts = [...baseDeck._files.keys()]
    .filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k))
    .sort((a, b) => {
      const na = Number.parseInt(a.match(/(\d+)\.xml$/)?.[1] || "999", 10);
      const nb = Number.parseInt(b.match(/(\d+)\.xml$/)?.[1] || "999", 10);
      return na - nb;
    });
  if (layoutParts.length === 0) return "../slideLayouts/slideLayout1.xml";

  // Prefer a blank layout (name contains "Blank"/"空白" or zero `<p:ph`) so imported slides don't inherit unwanted master placeholders
  let bestPart = layoutParts[0];
  let bestScore = -1;
  for (const lp of layoutParts) {
    const xml = baseDeck._readText(lp);
    const cSldName = getAttr(xml.match(/<p:cSld\b[^>]*>/)?.[0] || "", "name") || "";
    const phCount = (xml.match(/<p:ph\b/g) || []).length;
    let score = 0;
    if (/blank|空白/i.test(cSldName)) score += 100;
    if (phCount === 0) score += 50;
    else score += Math.max(0, 20 - phCount * 5);
    if (score > bestScore) {
      bestScore = score;
      bestPart = lp;
    }
  }
  return `../slideLayouts/${path.posix.basename(bestPart)}`;
}

/**
 * Cross-PPTX Lossless Slide Assembler & Master Cloner (`assembleDeck`).
 *
 * Bridges Channel A (preserve untouched original slides XML) and Phase 1 -> Phase 2
 * (clone verified `masters.pptx` slides for strict in-place slot filling):
 * - Keeps slides from `base` 100% XML-lossless (e.g., untouched P01 cover & P20 back cover).
 * - Imports/clones slides from any other `.pptx` source (e.g., Phase-1 verified `masters.pptx`
 *   or newly built `Presentation`), deduplicating media by SHA-256 and remapping charts/workbooks
 *   and `[Content_Types].xml` cleanly with zero dangling relationships.
 * - Returns a live `ImportedPresentation` ready for pure in-place slot filling (`getSlot`, `.text.set`, `.replace`, `.recolor`).
 */
export async function assembleDeck({
  base,
  sources = {},
  slides = [],
  outPptxPath,
}) {
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error("assembleDeck requires a non-empty `slides` array of `{ from, slide }` specs");
  }

  const loadedSources = new Map();
  for (const [key, src] of Object.entries(sources)) {
    loadedSources.set(key, await loadAnyDeckSource(src));
  }

  let baseKey = null;
  let baseDeck = null;
  if (typeof base === "string" && loadedSources.has(base)) {
    baseKey = base;
    baseDeck = await loadAnyDeckSource(sources[base]);
  } else if (base) {
    baseKey = "__base__";
    baseDeck = await loadAnyDeckSource(base);
    loadedSources.set(baseKey, baseDeck);
  } else {
    const firstKey = slides[0]?.from || Object.keys(sources)[0];
    if (!firstKey || !loadedSources.has(firstKey)) {
      throw new Error("assembleDeck could not resolve a base deck from `base` or `sources`");
    }
    baseKey = firstKey;
    baseDeck = await loadAnyDeckSource(sources[firstKey]);
  }

  const defaultLayoutTarget = pickDefaultSlideLayoutTarget(baseDeck);

  // Snapshot base slides BEFORE replacing `ppt/slides/slide*.xml`
  const baseSlideSnapshots = new Map();
  for (const sl of baseDeck._slides) {
    baseSlideSnapshots.set(sl.slideNumber, {
      xml: sl._xml,
      rels: sl._rels.filter((r) => !String(r.type || "").endsWith("/notesSlide") && !String(r.type || "").endsWith("/comments")),
    });
  }

  // Clear old slide parts & notes from base package
  for (const key of [...baseDeck._files.keys()]) {
    if (
      /^ppt\/slides\/slide\d+\.xml$/.test(key) ||
      /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(key) ||
      key.startsWith("ppt/notesSlides/")
    ) {
      baseDeck._files.delete(key);
    }
  }

  // Deduplicate imported media by SHA-256 so cloning a master 6 times does not bloat the ZIP 6x
  const importedMediaBySha = new Map();
  let foreignPartSeq = 1;

  const importForeignChart = (srcDeck, chartPartPath) => {
    const rawChartBuf = srcDeck._files.get(chartPartPath);
    if (!rawChartBuf) return null;
    while (baseDeck._files.has(`ppt/charts/ym_chart_${baseDeck._chartCounter}.xml`)) {
      baseDeck._chartCounter++;
    }
    const idx = baseDeck._chartCounter++;
    const newChartFile = `ym_chart_${idx}.xml`;
    const newChartPath = `ppt/charts/${newChartFile}`;
    baseDeck._files.set(newChartPath, Buffer.from(rawChartBuf));
    baseDeck._ensureContentTypeOverride(
      `/${newChartPath}`,
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"
    );

    const srcChartRelsPath = path.posix.join(
      path.posix.dirname(chartPartPath),
      "_rels",
      `${path.posix.basename(chartPartPath)}.rels`
    );
    if (srcDeck._files.has(srcChartRelsPath)) {
      const srcChartRels = parseRelsMap(srcDeck._readText(srcChartRelsPath));
      const newChartRels = [];
      for (const cr of srcChartRels) {
        if (cr.targetMode === "External") {
          newChartRels.push(cr);
          continue;
        }
        const resolved = resolvePosixPart(chartPartPath, cr.target);
        const subBuf = srcDeck._files.get(resolved);
        if (!subBuf) continue;
        const ext = path.posix.extname(resolved).replace(/^\./, "").toLowerCase() || "bin";
        if (resolved.startsWith("ppt/embeddings/") || ext === "xlsx") {
          const wbFile = `ym_asm_wb_${idx}_${foreignPartSeq++}.${ext}`;
          baseDeck._files.set(`ppt/embeddings/${wbFile}`, Buffer.from(subBuf));
          baseDeck._ensureContentTypeDefault(ext, guessMimeFromExt(ext));
          newChartRels.push({ ...cr, target: `../embeddings/${wbFile}` });
        } else if (resolved.startsWith("ppt/charts/")) {
          const auxFile = `ym_asm_chartaux_${idx}_${foreignPartSeq++}.${ext}`;
          baseDeck._files.set(`ppt/charts/${auxFile}`, Buffer.from(subBuf));
          const ctMatch = srcDeck
            ._readText("[Content_Types].xml")
            .match(new RegExp(`<Override\\b[^>]*\\bPartName="/${resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*\\bContentType="([^"]+)"`));
          if (ctMatch) {
            baseDeck._ensureContentTypeOverride(`/ppt/charts/${auxFile}`, ctMatch[1]);
          }
          newChartRels.push({ ...cr, target: auxFile });
        }
      }
      if (newChartRels.length > 0) {
        baseDeck._writeText(`ppt/charts/_rels/${newChartFile}.rels`, serializeRelsMap(newChartRels));
      }
    }
    return `../charts/${newChartFile}`;
  };

  const extractInheritedBgXml = (srcDeck, srcSlide) => {
    if (/<p:bg\b/.test(srcSlide._xml)) return "";
    const layoutRel = srcSlide._rels.find((r) => String(r.type || "").endsWith("/slideLayout"));
    if (!layoutRel) return "";
    const layoutPath = resolvePosixPart(srcSlide.partPath, layoutRel.target);
    const layoutXml = srcDeck._readText(layoutPath);
    const layoutBg = layoutXml.match(/<p:bg\b[\s\S]*?<\/p:bg>/)?.[0];
    if (layoutBg) return layoutBg;

    const layoutRelsPath = path.posix.join(
      path.posix.dirname(layoutPath),
      "_rels",
      `${path.posix.basename(layoutPath)}.rels`
    );
    const masterRel = parseRelsMap(srcDeck._readText(layoutRelsPath)).find((r) =>
      String(r.type || "").endsWith("/slideMaster")
    );
    if (!masterRel) return "";
    const masterPath = resolvePosixPart(layoutPath, masterRel.target);
    return srcDeck._readText(masterPath).match(/<p:bg\b[\s\S]*?<\/p:bg>/)?.[0] || "";
  };

  // Build sequential slides `slide1.xml .. slideN.xml`
  slides.forEach((spec, idx) => {
    const newNo = idx + 1;
    const fromKey = spec.from || baseKey;
    const srcSlideNo = Number(spec.slide);
    if (!Number.isInteger(srcSlideNo) || srcSlideNo < 1) {
      throw new Error(`assembleDeck slide entry #${newNo} requires a positive integer \`slide\` (got ${spec.slide})`);
    }

    if (fromKey === baseKey) {
      const snap = baseSlideSnapshots.get(srcSlideNo);
      if (!snap) {
        throw new Error(`assembleDeck: base source "${baseKey}" has no slide ${srcSlideNo}`);
      }
      baseDeck._writeText(`ppt/slides/slide${newNo}.xml`, snap.xml);
      baseDeck._writeText(`ppt/slides/_rels/slide${newNo}.xml.rels`, serializeRelsMap(snap.rels));
      return;
    }

    const srcDeck = loadedSources.get(fromKey);
    if (!srcDeck) {
      throw new Error(`assembleDeck: unknown source key "${fromKey}"`);
    }
    const srcSlide = srcDeck._slides[srcSlideNo - 1];
    if (!srcSlide) {
      throw new Error(`assembleDeck: source "${fromKey}" has no slide ${srcSlideNo} (has ${srcDeck._slides.length})`);
    }

    let slideXml = srcSlide._xml;
    const inheritedBg = extractInheritedBgXml(srcDeck, srcSlide);
    if (inheritedBg && !/<p:bg\b/.test(slideXml)) {
      slideXml = slideXml.replace(/<p:cSld\b([^>]*)>/, `<p:cSld$1>${inheritedBg}`);
    }

    const remappedRels = [];
    let hasLayoutRel = false;
    for (const r of srcSlide._rels) {
      const type = String(r.type || "");
      if (type.endsWith("/notesSlide") || type.endsWith("/comments")) continue;
      if (type.endsWith("/slideLayout")) {
        remappedRels.push({ ...r, target: defaultLayoutTarget });
        hasLayoutRel = true;
        continue;
      }
      if (r.targetMode === "External") {
        remappedRels.push({ ...r });
        continue;
      }

      const resolvedPart = resolvePosixPart(srcSlide.partPath, r.target);
      if (type.endsWith("/image") || type.endsWith("/media") || type.endsWith("/audio") || type.endsWith("/video")) {
        const mediaBuf = srcDeck._files.get(resolvedPart);
        if (!mediaBuf) continue;
        const ext = path.posix.extname(resolvedPart).replace(/^\./, "").toLowerCase() || "png";
        const sha = `${ext}:${createHash("sha256").update(mediaBuf).digest("hex")}`;
        let newMediaFile = importedMediaBySha.get(sha);
        if (!newMediaFile) {
          newMediaFile = baseDeck._allocatePackageMedia({
            bytes: mediaBuf,
            ext: `.${ext}`,
            contentType: guessMimeFromExt(ext),
          });
          importedMediaBySha.set(sha, newMediaFile);
        }
        remappedRels.push({ ...r, target: `../media/${newMediaFile}` });
        continue;
      }

      if (type.endsWith("/chart")) {
        const newChartTarget = importForeignChart(srcDeck, resolvedPart);
        if (newChartTarget) {
          remappedRels.push({ ...r, target: newChartTarget });
        }
        continue;
      }

      // Copy any other referenced internal binary/xml part cleanly to prevent dangling rels
      const otherBuf = srcDeck._files.get(resolvedPart);
      if (otherBuf) {
        const ext = path.posix.extname(resolvedPart).replace(/^\./, "").toLowerCase() || "xml";
        const dirName = path.posix.dirname(resolvedPart);
        const auxName = `ym_asm_${newNo}_${foreignPartSeq++}.${ext}`;
        const newPart = path.posix.join(dirName, auxName);
        baseDeck._files.set(newPart, Buffer.from(otherBuf));
        const relTarget = path.posix.relative("ppt/slides", newPart);
        remappedRels.push({ ...r, target: relTarget });
      }
    }

    if (!hasLayoutRel) {
      let maxR = 0;
      for (const rr of remappedRels) {
        const mm = String(rr.id || "").match(/^rId(\d+)$/);
        if (mm) maxR = Math.max(maxR, Number.parseInt(mm[1], 10));
      }
      remappedRels.push({
        id: `rId${maxR + 1}`,
        type: `${NS_R}/slideLayout`,
        target: defaultLayoutTarget,
      });
    }

    baseDeck._writeText(`ppt/slides/slide${newNo}.xml`, slideXml);
    baseDeck._writeText(`ppt/slides/_rels/slide${newNo}.xml.rels`, serializeRelsMap(remappedRels));
  });

  // Update `ppt/_rels/presentation.xml.rels`
  const presRels = parseRelsMap(baseDeck._readText("ppt/_rels/presentation.xml.rels")).filter(
    (r) => !String(r.type || "").endsWith("/slide")
  );
  let maxRelNum = 0;
  for (const r of presRels) {
    const m = String(r.id || "").match(/^rId(\d+)$/);
    if (m) maxRelNum = Math.max(maxRelNum, Number.parseInt(m[1], 10));
  }

  const newSldIdsXml = slides
    .map((_, idx) => {
      const newNo = idx + 1;
      const rId = `rId${++maxRelNum}`;
      presRels.push({
        id: rId,
        type: `${NS_R}/slide`,
        target: `slides/slide${newNo}.xml`,
      });
      return `<p:sldId id="${256 + idx}" r:id="${rId}"/>`;
    })
    .join("");

  baseDeck._writeText("ppt/_rels/presentation.xml.rels", serializeRelsMap(presRels));

  let presXml = baseDeck._readText("ppt/presentation.xml");
  presXml = presXml.replace(
    /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
    `<p:sldIdLst>${newSldIdsXml}</p:sldIdLst>`
  );
  baseDeck._writeText("ppt/presentation.xml", presXml);

  let ctXml = baseDeck._readText("[Content_Types].xml");
  ctXml = ctXml.replace(
    /<Override\b[^>]*\bPartName="\/ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml"[^>]*\/>/g,
    ""
  );
  const slideOverrides = slides
    .map(
      (_, idx) =>
        `<Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("");
  ctXml = ctXml.replace(/<\/Types>/, `${slideOverrides}</Types>`);
  baseDeck._writeText("[Content_Types].xml", ctXml);

  baseDeck._gcUnreferencedPackageParts();

  const outEntries = [{ name: "[Content_Types].xml", data: baseDeck._files.get("[Content_Types].xml") }];
  for (const [name, data] of baseDeck._files.entries()) {
    if (name !== "[Content_Types].xml") outEntries.push({ name, data });
  }
  const assembledBuf = buildZipBuffer(outEntries);

  if (outPptxPath) {
    const absOut = path.resolve(outPptxPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });
    await fs.writeFile(absOut, assembledBuf);
  }

  return ImportedPresentation.load(assembledBuf);
}

function parseRotationDegFromXml(blockXml) {
  const xfrmTag = blockXml.match(/<(?:a|p):xfrm\b[^>]*>/)?.[0] || "";
  const rotRaw = getAttr(xfrmTag, "rot");
  if (!rotRaw) return 0;
  let deg = (Number.parseInt(rotRaw, 10) || 0) / 60000;
  deg = ((deg % 360) + 360) % 360;
  if (deg > 180) deg -= 360;
  return Number(deg.toFixed(2));
}

/**
 * Phase-1 -> Phase-2 Structural Immutability Auditor (`auditMasterSlotIntegrity`).
 * Enforces that Phase-2 content filling did NOT destroy Phase-1 verified master structure:
 * - Image slot count must NOT drop below master's image slot count (blocks silently replacing photos with text boxes!).
 * - All semantic `slot:*` named nodes from the master must remain intact.
 * - Rotated `slot:*` or image frames (`|rot| >= 2 deg`) must NOT flip sign or drift beyond tolerance.
 */
export async function auditMasterSlotIntegrity({
  masterPptxPath,
  finalPptxPath,
  slideMap = [],
  angleToleranceDeg = 3,
}) {
  const masterDeck = await loadAnyDeckSource(masterPptxPath);
  const finalDeck = await loadAnyDeckSource(finalPptxPath);

  const mappings = Array.isArray(slideMap)
    ? slideMap
    : Object.entries(slideMap || {}).map(([s, m]) => ({ slide: Number(s), masterSlide: Number(m) }));

  // Default 1:1 mapping when slideMap omitted and counts match
  const effectiveMap =
    mappings.length > 0
      ? mappings
      : masterDeck._slides.map((_, i) => ({ slide: i + 1, masterSlide: i + 1 }));

  const issues = [];
  for (const { slide, masterSlide } of effectiveMap) {
    const mSlide = masterDeck._slides[masterSlide - 1];
    const fSlide = finalDeck._slides[slide - 1];
    if (!mSlide) {
      issues.push({
        severity: "fail",
        code: "invalid_master_slide_ref",
        slide,
        masterSlide,
        message: `Slide ${slide} references nonexistent masterSlide ${masterSlide}`,
      });
      continue;
    }
    if (!fSlide) {
      issues.push({
        severity: "fail",
        code: "missing_final_slide",
        slide,
        masterSlide,
        message: `Final deck is missing slide ${slide} mapped from masterSlide ${masterSlide}`,
      });
      continue;
    }

    const mPics = mSlide._elements.filter((e) => e.kind === "image" || e.hasImageFill);
    const fPics = fSlide._elements.filter((e) => e.kind === "image" || e.hasImageFill);
    if (fPics.length < mPics.length) {
      issues.push({
        severity: "fail",
        code: "master_image_slot_dropped",
        slide,
        masterSlide,
        masterImageCount: mPics.length,
        finalImageCount: fPics.length,
        message: `Slide ${slide} dropped image slot(s) from verified master #${masterSlide} (${fPics.length} < ${mPics.length}); Phase 2 must NOT replace photo slots with text boxes`,
      });
    }

    const fByName = new Map(fSlide._elements.map((e) => [e.name, e]));
    for (const mEl of mSlide._elements) {
      const mRot = parseRotationDegFromXml(mEl._rawXml || "");
      const isNamedSlot = /^slot[:_-]/i.test(mEl.name || "");
      if (isNamedSlot && !fByName.has(mEl.name)) {
        issues.push({
          severity: "fail",
          code: "master_named_slot_missing",
          slide,
          masterSlide,
          slot: mEl.name,
          message: `Slide ${slide} is missing required master slot "${mEl.name}" from master #${masterSlide}`,
        });
        continue;
      }
      const fMatch = fByName.get(mEl.name);
      if (fMatch && Math.abs(mRot) >= 2) {
        const fRot = parseRotationDegFromXml(fMatch._rawXml || "");
        const diff = Math.abs(mRot - fRot);
        if (diff > angleToleranceDeg) {
          issues.push({
            severity: "fail",
            code: "master_rotation_drifted",
            slide,
            masterSlide,
            slot: mEl.name,
            masterRotationDeg: mRot,
            finalRotationDeg: fRot,
            message: `Slide ${slide} element "${mEl.name}" rotation drifted from master #${masterSlide} (${mRot}° -> ${fRot}°)`,
          });
        }
      }
    }
  }

  return {
    passed: !issues.some((i) => i.severity === "fail"),
    checkedSlides: effectiveMap.length,
    issues,
  };
}
