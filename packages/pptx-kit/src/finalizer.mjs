// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Milestone M3 (Weapons 14–19): 5-Gate Atomic Finalizer (`finalizeDeck`)

import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { emuToPx } from "./units.mjs";
import { readZipBuffer } from "./xml.mjs";

// ============================================================================
// Weapon 19: Chinese & English Anti-AI-Slop Lexicon
// ============================================================================
export const CHINESE_AI_SLOP_PATTERNS = Object.freeze([
  { id: "slop_not_x_but_y_zh", re: /不是[^，。；\n]{1,24}[，,\s]+而是/g, label: "AI对比句式「不是…而是…」" },
  { id: "slop_not_x_but_y_en", re: /\bnot\s+just\b[\s\S]{1,30}\bbut\s+(?:also|rather)\b/gi, label: "AI句式 'not just ... but'" },
  { id: "slop_jargon_funeng", re: /(?:深度赋能|全面赋能|双向赋能|生态闭环|闭环生态|核心抓手|打出组合拳|底层逻辑重构|开启新篇章|重塑新格局)/g, label: "空洞AI黑话套词" },
  { id: "slop_emdash_abuse", re: /——[\s\S]{1,40}——/g, label: "单段重复破折号连接" },
  { id: "slop_bullet_chain", re: /[^\s•·]+\s*[•·]\s*[^\s•·]+\s*[•·]\s*[^\s•·]+/g, label: "行内假圆点串词(A • B • C)" },
]);

function decodeXml(str) {
  return String(str || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

function resolvePosixTarget(basePart, relTarget) {
  if (!relTarget) return "";
  const cleanTarget = relTarget.split("#")[0];
  if (!cleanTarget) return basePart;
  if (cleanTarget.startsWith("/")) return cleanTarget.replace(/^\/+/, "");
  const dir = basePart ? path.posix.dirname(basePart) : "";
  return path.posix.normalize(path.posix.join(dir, cleanTarget));
}

/**
 * Extracts direct child tag names of balanced `<parentTag>...</parentTag>` blocks.
 */
function checkSequenceOrder(xml, parentTag, orderRanks, partName, issues) {
  const escapedParent = parentTag.replace(":", "\\:");
  const blockRe = new RegExp(`<${escapedParent}\\b[^>]*>([\\s\\S]*?)<\\/${escapedParent}>`, "g");
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const inner = m[1];
    // Scan only depth-0 child tags inside `inner`
    const tokRe = /<(\/?)([a-zA-Z0-9]+:[a-zA-Z0-9]+)\b[^>]*?(\/?)>/g;
    let depth = 0;
    let maxRankSeen = -1;
    let maxTagSeen = "";
    let tm;
    while ((tm = tokRe.exec(inner)) !== null) {
      const isClose = tm[1] === "/";
      const tagName = tm[2];
      const selfClose = tm[3] === "/";
      if (isClose) {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0) {
        const rank = orderRanks[tagName];
        if (rank !== undefined) {
          if (rank < maxRankSeen) {
            issues.push({
              gate: "package_integrity",
              severity: "fail",
              code: "ooxml_element_order_violation",
              part: partName,
              message: `In <${parentTag}> (${partName}), <${tagName}> appeared after <${maxTagSeen}> (violates ECMA-376 particle sequence)`,
            });
            break;
          }
          maxRankSeen = rank;
          maxTagSeen = tagName;
        }
      }
      if (!selfClose) depth++;
    }
  }
}

const DLBLS_ORDER = Object.freeze({
  "c:dLbl": 1,
  "c:delete": 2,
  "c:numFmt": 3,
  "c:spPr": 4,
  "c:txPr": 5,
  "c:dLblPos": 6,
  "c:showLegendKey": 7,
  "c:showVal": 8,
  "c:showCatName": 9,
  "c:showSerName": 10,
  "c:showPercent": 11,
  "c:showBubbleSize": 12,
  "c:separator": 13,
  "c:showLeaderLines": 14,
  "c:leaderLines": 15,
  "c:extLst": 16,
});

const SPPR_ORDER = Object.freeze({
  "a:xfrm": 1,
  "a:custGeom": 2,
  "a:prstGeom": 2,
  "a:noFill": 3,
  "a:solidFill": 3,
  "a:gradFill": 3,
  "a:blipFill": 3,
  "a:pattFill": 3,
  "a:grpFill": 3,
  "a:ln": 4,
  "a:effectLst": 5,
  "a:effectDag": 5,
  "a:scene3d": 6,
  "a:sp3d": 7,
  "a:extLst": 8,
});

// ============================================================================
// Gate 1: Package Safety, Relationships & ECMA-376 Child Sequence
// ============================================================================
function runGate1PackageIntegrity(zipMap) {
  const issues = [];
  for (const reqPart of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"]) {
    if (!zipMap.has(reqPart)) {
      issues.push({
        gate: "package_integrity",
        severity: "fail",
        code: "missing_required_part",
        part: reqPart,
        message: `Missing mandatory OpenXML part: ${reqPart}`,
      });
    }
  }
  if (issues.length > 0) return issues;

  for (const [partName, buf] of zipMap.entries()) {
    if (!partName.endsWith(".xml") && !partName.endsWith(".rels")) continue;
    const xml = buf.toString("utf8");

    // DTD / XXE security gate
    if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
      issues.push({
        gate: "package_integrity",
        severity: "fail",
        code: "xxe_dtd_forbidden",
        part: partName,
        message: `Forbidden DTD/ENTITY declaration detected in ${partName}`,
      });
    }

    // Relationship target integrity & external scheme whitelist
    if (partName.endsWith(".rels")) {
      const ownerPart =
        partName === "_rels/.rels"
          ? ""
          : path.posix.join(
              path.posix.dirname(path.posix.dirname(partName)),
              path.posix.basename(partName, ".rels")
            );
      for (const rm of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
        const tag = rm[0];
        const target = getAttr(tag, "Target") || "";
        const mode = getAttr(tag, "TargetMode");
        if (mode === "External") {
          if (!/^(?:https?:|mailto:)/i.test(target)) {
            issues.push({
              gate: "package_integrity",
              severity: "fail",
              code: "unsafe_external_uri",
              part: partName,
              message: `Unsafe external relationship URI "${target}" in ${partName}`,
            });
          }
        } else if (target) {
          const resolved = resolvePosixTarget(ownerPart, target);
          if (!zipMap.has(resolved)) {
            issues.push({
              gate: "package_integrity",
              severity: "fail",
              code: "dangling_relationship_target",
              part: partName,
              message: `Relationship in ${partName} points to missing part "${resolved}"`,
            });
          }
        }
      }
    }

    // Strict ECMA-376 child sequence checks
    if (partName.startsWith("ppt/slides/slide") && partName.endsWith(".xml")) {
      checkSequenceOrder(xml, "p:spPr", SPPR_ORDER, partName, issues);
      // Verify `<p:spTree>` does not place shapes after `<p:extLst>`
      const spTreeInner = xml.match(/<p:spTree\b[^>]*>([\s\S]*?)<\/p:spTree>/)?.[1] || "";
      const topTags = [];
      const re = /<(\/?)(p:[a-zA-Z0-9]+|mc:AlternateContent)\b[^>]*?(\/?)>/g;
      let d = 0;
      let tm;
      while ((tm = re.exec(spTreeInner)) !== null) {
        if (tm[1] === "/") {
          d = Math.max(0, d - 1);
          continue;
        }
        if (d === 0) topTags.push(tm[2]);
        if (tm[3] !== "/") d++;
      }
      const extIdx = topTags.indexOf("p:extLst");
      if (extIdx >= 0 && extIdx < topTags.length - 1) {
        issues.push({
          gate: "package_integrity",
          severity: "fail",
          code: "sptree_after_extlst",
          part: partName,
          message: `${partName} has shape/frame elements placed after <p:extLst> inside <p:spTree>`,
        });
      }
    }

    if (partName.startsWith("ppt/charts/") && partName.endsWith(".xml")) {
      checkSequenceOrder(xml, "c:dLbls", DLBLS_ORDER, partName, issues);
    }
  }

  return issues;
}

// ============================================================================
// Gate 3: System Font & CJK Binding Scanner
// ============================================================================
const BUILTIN_SAFE_FONTS = new Set([
  "arial",
  "calibri",
  "calibri light",
  "helvetica",
  "times new roman",
  "georgia",
  "verdana",
  "tahoma",
  "courier new",
  "microsoft yahei",
  "pingfang sc",
  "hiragino sans gb",
  "heiti sc",
  "songti sc",
  "kaiti sc",
  "stheitisc-light",
  "stsong",
  "simhei",
  "simsun",
  "dengxian",
]);

let _cachedSystemFontTokens = null;

function discoverSystemFontTokens() {
  if (_cachedSystemFontTokens) return _cachedSystemFontTokens;
  const tokens = new Set(BUILTIN_SAFE_FONTS);
  const dirs = [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    path.join(os.homedir(), "Library/Fonts"),
    "C:\\Windows\\Fonts",
    "/usr/share/fonts",
    path.join(os.homedir(), ".local/share/fonts"),
  ];

  const walk = (dir, depth = 0) => {
    if (depth > 2 || !existsSync(dir)) return;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) walk(path.join(dir, ent.name), depth + 1);
        else if (/\.(?:ttf|ttc|otf)$/i.test(ent.name)) {
          const stem = ent.name.replace(/\.(?:ttf|ttc|otf)$/i, "").toLowerCase();
          tokens.add(stem);
          tokens.add(stem.replace(/[-_](?:regular|bold|medium|light|semibold)$/i, ""));
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  };
  dirs.forEach((d) => walk(d));

  const fc = spawnSync("fc-list", [":", "family"], { encoding: "utf8", timeout: 4000 });
  if (fc.status === 0 && fc.stdout) {
    for (const ln of fc.stdout.split(/\r?\n/)) {
      for (const fam of ln.split(",")) {
        const clean = fam.trim().toLowerCase();
        if (clean) tokens.add(clean);
      }
    }
  }

  _cachedSystemFontTokens = tokens;
  return tokens;
}

function runGate3FontAvailability(zipMap, fontPolicy = "warn") {
  const issues = [];
  if (fontPolicy === "off") return issues;
  const installed = discoverSystemFontTokens();
  const missingFonts = new Set();

  for (const [partName, buf] of zipMap.entries()) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(partName)) continue;
    const xml = buf.toString("utf8");
    for (const m of xml.matchAll(/<(?:a:latin|a:ea)\b[^>]*\btypeface="([^"+][^"]*)"/g)) {
      const fam = decodeXml(m[1]).trim();
      const low = fam.toLowerCase();
      if (!fam || low.startsWith("+")) continue;
      const found =
        installed.has(low) ||
        installed.has(low.replace(/\s+/g, "")) ||
        [...installed].some((k) => k.includes(low) || low.includes(k));
      if (!found && !missingFonts.has(fam)) {
        missingFonts.add(fam);
        issues.push({
          gate: "font_availability",
          severity: fontPolicy === "strict" ? "fail" : "warn",
          code: "unverified_system_font",
          part: partName,
          font: fam,
          message: `Font "${fam}" referenced in ${partName} was not found in local OS font directories (may substitute during rendering)`,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// Gates 2 & 4: Layout Geometry (OOB / Overlap / Fake Bullets) + Text Overflow & Anti-Slop
// ============================================================================
function measureLinePx(str, fontPx) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f) {
      if (ch === " ") w += fontPx * 0.3;
      else if ("ilI1|.,:;!'".includes(ch)) w += fontPx * 0.32;
      else if ("mwMW@%".includes(ch)) w += fontPx * 0.84;
      else if (ch >= "A" && ch <= "Z") w += fontPx * 0.66;
      else w += fontPx * 0.56;
    } else {
      w += fontPx * 1.02;
    }
  }
  return w;
}

function extractTopLevelShapeBoxes(slideXml) {
  const spTree = slideXml.match(/<p:spTree\b[^>]*>([\s\S]*?)<\/p:spTree>/)?.[1] || "";
  // Strip `<p:grpSp>...</p:grpSp>` for top-level box checks (grouped decorative badges intentionally overlap!)
  const items = [];
  const tagRe = /<(p:sp|p:graphicFrame)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = tagRe.exec(spTree)) !== null) {
    const tag = m[1];
    const blk = m[0];
    const cNv = blk.match(/<p:cNvPr\b[^>]*>/)?.[0] || "";
    const id = getAttr(cNv, "id") || "";
    const name = getAttr(cNv, "name") || tag;
    const xfrm = blk.match(/<(?:a|p):xfrm\b[^>]*>([\s\S]*?)<\/(?:a|p):xfrm>/)?.[1] || "";
    const off = xfrm.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
    const ext = xfrm.match(/<a:ext\b[^>]*\bcx="(-?\d+)"[^>]*\bcy="(-?\d+)"/);
    if (!off || !ext) continue;

    const left = emuToPx(Number.parseInt(off[1], 10));
    const top = emuToPx(Number.parseInt(off[2], 10));
    const width = emuToPx(Number.parseInt(ext[1], 10));
    const height = emuToPx(Number.parseInt(ext[2], 10));

    const isTable = tag === "p:graphicFrame" && blk.includes("<a:tbl");
    const isChart = tag === "p:graphicFrame" && blk.includes(":chart");
    const isTextbox = /<p:cNvSpPr\b[^>]*\btxBox="1"/.test(blk);
    const bodyPrTag = blk.match(/<a:bodyPr\b[^>]*>/)?.[0] || "";
    const noWrap = /\bwrap="none"/.test(bodyPrTag);
    const hasNoAutofit = /<a:noAutofit\b/.test(blk);

    const lIns = emuToPx(Number.parseInt(getAttr(bodyPrTag, "lIns") ?? "91440", 10));
    const rIns = emuToPx(Number.parseInt(getAttr(bodyPrTag, "rIns") ?? "91440", 10));
    const tIns = emuToPx(Number.parseInt(getAttr(bodyPrTag, "tIns") ?? "45720", 10));
    const bIns = emuToPx(Number.parseInt(getAttr(bodyPrTag, "bIns") ?? "45720", 10));

    const paras = [];
    if (tag === "p:sp") {
      for (const pm of blk.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
        const pInner = pm[1];
        const text = [...pInner.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((tm) => decodeXml(tm[1]))
          .join("");
        const szAttr = pInner.match(/\bsz="(\d+)"/)?.[1];
        const fontPt = szAttr ? Number.parseInt(szAttr, 10) / 100 : 18;
        const spcPct = pInner.match(/<a:spcPct\b[^>]*\bval="(\d+)"/)?.[1];
        const lineMult = spcPct ? Number.parseInt(spcPct, 10) / 100000 : 1.22;
        const hasBuNone = /<a:buNone\b/.test(pInner);
        const hasNativeBullet = /<a:buChar\b|<a:buAutoNum\b/.test(pInner);
        paras.push({ text, fontPt, lineMult, hasBuNone, hasNativeBullet });
      }
    }

    const plainText = paras.map((p) => p.text).join("\n").trim();
    items.push({
      tag,
      id,
      name,
      left,
      top,
      width,
      height,
      isTable,
      isChart,
      isTextbox,
      noWrap,
      hasNoAutofit,
      insets: isTextbox ? { l: 0, r: 0, t: 0, b: 0 } : { l: lIns, r: rIns, t: tIns, b: bIns },
      paras,
      plainText,
    });
  }
  return items;
}

function runGates2And4GeometryAndText(zipMap, { antiSlop = "warn", checkTextOverflow = true } = {}) {
  const issues = [];
  const presXml = zipMap.get("ppt/presentation.xml")?.toString("utf8") || "";
  const szM = presXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  const slideW = szM ? emuToPx(Number.parseInt(szM[1], 10)) : 1280;
  const slideH = szM ? emuToPx(Number.parseInt(szM[2], 10)) : 720;

  for (const [partName, buf] of zipMap.entries()) {
    const sm = partName.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (!sm) continue;
    const slideNo = Number.parseInt(sm[1], 10);
    const xml = buf.toString("utf8");
    const items = extractTopLevelShapeBoxes(xml);

    // 1) Out-of-bounds & Fake Bullet & Overflow & Anti-Slop checks
    for (const it of items) {
      const hasMeaningfulContent = Boolean(it.plainText) || it.isTable || it.isChart;
      if (hasMeaningfulContent && it.width > 4 && it.height > 4) {
        const tol = 12; // 12px tolerance for edge-hugging labels/page numbers
        if (
          it.left < -tol ||
          it.top < -tol ||
          it.left + it.width > slideW + tol ||
          it.top + it.height > slideH + tol
        ) {
          issues.push({
            gate: "layout_geometry",
            severity: "fail",
            code: "element_out_of_bounds",
            slide: slideNo,
            element: it.name,
            bounds: { left: Math.round(it.left), top: Math.round(it.top), width: Math.round(it.width), height: Math.round(it.height) },
            message: `Slide ${slideNo} element "${it.name}" (${Math.round(it.left)},${Math.round(it.top)} ${Math.round(it.width)}x${Math.round(it.height)}) overflows slide canvas ${Math.round(slideW)}x${Math.round(slideH)}`,
          });
        }
      }

      // Fake typed bullets check
      for (const p of it.paras) {
        if (!p.hasNativeBullet && p.hasBuNone && /^\s*[•●▪▸]\s+\S/.test(p.text)) {
          issues.push({
            gate: "layout_geometry",
            severity: "warn",
            code: "fake_typed_bullet",
            slide: slideNo,
            element: it.name,
            message: `Slide ${slideNo} "${it.name}" uses literal bullet character in text instead of native <a:buChar> hanging indent`,
          });
        }
      }

      // Vertical text overflow check (when `<a:noAutofit/>` is set on a bounded box)
      if (checkTextOverflow && it.plainText && it.hasNoAutofit && !it.noWrap && it.width >= 40 && it.height >= 24) {
        const innerW = Math.max(16, it.width - it.insets.l - it.insets.r);
        const innerH = Math.max(12, it.height - it.insets.t - it.insets.b);
        let estH = 0;
        for (const p of it.paras) {
          const fontPx = p.fontPt / 0.75;
          const lineW = measureLinePx(p.text || " ", fontPx);
          const lines = Math.max(1, Math.ceil(lineW / (innerW * 1.06)));
          estH += lines * fontPx * p.lineMult;
        }
        if (estH > innerH * 1.32 && estH - innerH > 18) {
          issues.push({
            gate: "text_overflow",
            severity: "fail",
            code: "vertical_text_overflow",
            slide: slideNo,
            element: it.name,
            message: `Slide ${slideNo} "${it.name}" text height (~${Math.round(estH)}px) overflows box height (${Math.round(innerH)}px): "${it.plainText.slice(0, 36)}..."`,
          });
        }
      }

      // Anti-AI-Slop Lexicon check
      if (antiSlop !== "off" && it.plainText) {
        for (const rule of CHINESE_AI_SLOP_PATTERNS) {
          rule.re.lastIndex = 0;
          const hit = rule.re.exec(it.plainText);
          if (hit) {
            issues.push({
              gate: "anti_slop",
              severity: antiSlop === "fail" ? "fail" : "warn",
              code: rule.id,
              slide: slideNo,
              element: it.name,
              message: `Slide ${slideNo} "${it.name}" triggered ${rule.label}: "${hit[0]}"`,
            });
          }
        }
      }
    }

    // 2) Substantive Text-on-Text AABB Collision Check
    const textBoxes = items.filter((x) => x.plainText.length >= 2 && x.width > 12 && x.height > 12);
    for (let i = 0; i < textBoxes.length; i++) {
      for (let j = i + 1; j < textBoxes.length; j++) {
        const a = textBoxes[i];
        const b = textBoxes[j];
        const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
        if (ix <= 4 || iy <= 4) continue;
        const interArea = ix * iy;
        const minArea = Math.min(a.width * a.height, b.width * b.height);
        // Ignore container-card vs inner label if one box is >4x larger than the other
        const maxArea = Math.max(a.width * a.height, b.width * b.height);
        if (maxArea / minArea > 4.5) continue;

        if (interArea / minArea > 0.25) {
          issues.push({
            gate: "layout_geometry",
            severity: "fail",
            code: "text_box_collision",
            slide: slideNo,
            elements: [a.name, b.name],
            message: `Slide ${slideNo} text elements "${a.name}" and "${b.name}" collide (${Math.round((interArea / minArea) * 100)}% overlap)`,
          });
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// Gate 5: Native Chart Integrity (`.xlsx` Sync + Title) & Table Arithmetic Auditor
// ============================================================================
function parseBusinessNumber(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "-" || s === "—" || s === "N/A") return null;
  // Skip time ranges or pure ratios like `12:00 - 14:00`, `4.2x`, `2026年`
  if (/\d+:\d+|[xX×]$|^\d{4}年$/.test(s)) return null;

  const isPercent = s.endsWith("%");
  let mult = 1;
  if (s.includes("亿")) mult = 1e8;
  else if (s.includes("万")) mult = 1e4;

  const cleaned = s.replace(/[¥￥$,，%亿万+\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const val = Number.parseFloat(cleaned) * mult;
  return Number.isFinite(val) ? { value: val, isPercent } : null;
}

function runGate5DataEvidence(zipMap) {
  const issues = [];

  // 5A: Chart Title, CJK Font Binding & Embedded `.xlsx` Sync Check
  for (const [partName, buf] of zipMap.entries()) {
    if (!/^ppt\/charts\/.*\.xml$/.test(partName)) continue;
    const xml = buf.toString("utf8");

    // Default placeholder chart title check
    const titleTexts = [...xml.matchAll(/<c:title\b[\s\S]*?<\/c:title>/g)]
      .map((m) =>
        [...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1])).join("")
      )
      .join(" ")
      .trim();

    if (/^(?:chart title|图表标题)$/i.test(titleTexts)) {
      issues.push({
        gate: "data_evidence",
        severity: "fail",
        code: "placeholder_chart_title",
        part: partName,
        message: `Chart ${partName} still contains default placeholder title "${titleTexts}"`,
      });
    }
    if (!titleTexts && !/<c:autoTitleDeleted\b[^>]*\bval="1"/.test(xml)) {
      issues.push({
        gate: "data_evidence",
        severity: "warn",
        code: "missing_auto_title_deleted",
        part: partName,
        message: `Chart ${partName} has no title text and lacks <c:autoTitleDeleted val="1"/>`,
      });
    }

    // Verify embedded `.xlsx` workbook exists & matches `<c:numCache>` values
    const relsPath = path.posix.join(
      path.posix.dirname(partName),
      "_rels",
      `${path.posix.basename(partName)}.rels`
    );
    const extDataId = xml.match(/<c:externalData\b[^>]*\br:id="([^"]+)"/)?.[1];
    if (extDataId && zipMap.has(relsPath)) {
      const relsXml = zipMap.get(relsPath).toString("utf8");
      const targetMatch = relsXml.match(
        new RegExp(`<Relationship\\b[^>]*\\bId="${extDataId}"[^>]*\\bTarget="([^"]+)"`)
      );
      if (targetMatch) {
        const wbPart = resolvePosixTarget(partName, targetMatch[1]);
        if (wbPart.endsWith(".xlsx") && zipMap.has(wbPart)) {
          const wbZip = readZipBuffer(zipMap.get(wbPart));
          const sheetXml = wbZip.get("xl/worksheets/sheet1.xml")?.toString("utf8") || "";
          const sheetNums = [...sheetXml.matchAll(/<c\b[^>]*><v>(-?\d+(?:\.\d+)?)<\/v><\/c>/g)].map((m) =>
            Number.parseFloat(m[1])
          );
          const cacheNums = [
            ...xml.matchAll(/<c:numCache>[\s\S]*?<\/c:numCache>/g),
          ].flatMap((cm) =>
            [...cm[0].matchAll(/<c:pt\b[^>]*><c:v>(-?\d+(?:\.\d+)?)<\/c:v><\/c:pt>/g)].map((pm) =>
              Number.parseFloat(pm[1])
            )
          );
          if (sheetNums.length > 0 && cacheNums.length > 0) {
            // In workbook rows are by category, in chart cache grouped by series -> compare sorted multisets!
            const sSorted = [...sheetNums].sort((a, b) => a - b);
            const cSorted = [...cacheNums].sort((a, b) => a - b);
            const mismatch =
              sSorted.length !== cSorted.length ||
              sSorted.some((v, idx) => Math.abs(v - cSorted[idx]) > 1e-6);
            if (mismatch) {
              issues.push({
                gate: "data_evidence",
                severity: "fail",
                code: "chart_workbook_cache_desync",
                part: partName,
                workbook: wbPart,
                message: `Chart ${partName} <c:numCache> values do not match embedded workbook ${wbPart}`,
              });
            }
          }
        }
      }
    }
  }

  // 5B: Native `<a:tbl>` Total / Subtotal Arithmetic Check
  const NON_ADDITIVE_HEADER_RE = /(?:roi|利率|利润率|转化率|增长率|增速|单价|均价|客单价|排名|编号|占比变化)/i;
  const TOTAL_LABEL_RE = /^(?:合计|总计|全天合计|年度合计|汇总|小计|total|grand total)$/i;

  for (const [partName, buf] of zipMap.entries()) {
    const sm = partName.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (!sm) continue;
    const slideNo = Number.parseInt(sm[1], 10);
    const xml = buf.toString("utf8");

    for (const tblMatch of xml.matchAll(/<a:tbl>([\s\S]*?)<\/a:tbl>/g)) {
      const rows = [...tblMatch[1].matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((rm) =>
        [...rm[1].matchAll(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>/g)].map((cm) => ({
          vMerge: /\bvMerge="1"/.test(cm[1]),
          hMerge: /\bhMerge="1"/.test(cm[1]),
          text: [...cm[2].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map((tm) => decodeXml(tm[1]))
            .join("")
            .trim(),
        }))
      );
      if (rows.length < 3) continue;

      const headers = rows[0].map((c) => c.text);
      const lastRow = rows[rows.length - 1];
      const firstCellLabel = lastRow[0]?.text || "";
      if (!TOTAL_LABEL_RE.test(firstCellLabel)) continue;

      const colCount = headers.length;
      for (let c = 1; c < colCount; c++) {
        if (NON_ADDITIVE_HEADER_RE.test(headers[c] || "")) continue;
        const totalParsed = parseBusinessNumber(lastRow[c]?.text);
        if (!totalParsed) continue;

        const bodyNums = [];
        let allBodyParseable = true;
        for (let r = 1; r < rows.length - 1; r++) {
          const cell = rows[r]?.[c];
          if (!cell || cell.vMerge || cell.hMerge) continue;
          const pn = parseBusinessNumber(cell.text);
          if (!pn) {
            allBodyParseable = false;
            break;
          }
          bodyNums.push(pn.value);
        }
        if (!allBodyParseable || bodyNums.length < 2) continue;

        const sum = bodyNums.reduce((acc, v) => acc + v, 0);
        const tolerance = Math.max(0.51, Math.abs(totalParsed.value) * 0.01);
        if (Math.abs(sum - totalParsed.value) > tolerance) {
          issues.push({
            gate: "data_evidence",
            severity: "fail",
            code: "table_total_arithmetic_mismatch",
            slide: slideNo,
            column: headers[c] || `Col ${c + 1}`,
            expectedSum: Number(sum.toFixed(4)),
            declaredTotal: totalParsed.value,
            message: `Slide ${slideNo} table column "${headers[c] || c + 1}" sums to ${Number(sum.toFixed(2))}, but total row "${firstCellLabel}" states ${lastRow[c].text}`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Runs all 5 validation gates on a `.pptx` Buffer or file path without publishing.
 */
export async function validateDeckBuffer(pptxBuffer, options = {}) {
  const buf = Buffer.isBuffer(pptxBuffer) ? pptxBuffer : Buffer.from(pptxBuffer);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const zipMap = readZipBuffer(buf);

  const gate1 = runGate1PackageIntegrity(zipMap);
  const gate2And4 = runGates2And4GeometryAndText(zipMap, {
    antiSlop: options.antiSlop ?? "warn",
    checkTextOverflow: options.checkTextOverflow !== false,
  });
  const gate3 = runGate3FontAvailability(zipMap, options.fontPolicy ?? "warn");
  const gate5 = runGate5DataEvidence(zipMap);

  const issues = [...gate1, ...gate2And4, ...gate3, ...gate5];
  const failCount = issues.filter((i) => i.severity === "fail").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;

  return {
    schema: "yuanmou.deck.validation/v1",
    passed: failCount === 0,
    sha256,
    bytes: buf.length,
    failCount,
    warnCount,
    gates: {
      package_integrity: gate1.filter((x) => x.severity === "fail").length === 0 ? "pass" : "fail",
      layout_geometry:
        gate2And4.filter((x) => x.gate === "layout_geometry" && x.severity === "fail").length === 0
          ? "pass"
          : "fail",
      font_availability: gate3.filter((x) => x.severity === "fail").length === 0 ? "pass" : "fail",
      text_overflow:
        gate2And4.filter((x) => x.gate === "text_overflow" && x.severity === "fail").length === 0
          ? "pass"
          : "fail",
      data_evidence: gate5.filter((x) => x.severity === "fail").length === 0 ? "pass" : "fail",
    },
    issues,
  };
}

/**
 * Weapon 18: Atomic Staging-to-Final Publisher (`finalizeDeck`).
 * Accepts a `Presentation`, `ImportedPresentation`, `Buffer`, or candidate `.pptx` path,
 * runs all 5 quality gates, writes an isolated `.validation.json` receipt into `.yuanmou-finalizer/`,
 * and atomically publishes `outputPath` ONLY if all gates pass!
 */
export async function finalizeDeck({
  deck,
  candidatePptxPath,
  outputPath,
  receiptDir,
  antiSlop = "warn",
  fontPolicy = "warn",
  checkTextOverflow = true,
}) {
  if (!outputPath) {
    throw new Error("finalizeDeck requires `outputPath`");
  }
  const absOut = path.resolve(outputPath);
  const stagingRoot = path.resolve(
    receiptDir || path.join(path.dirname(absOut), ".yuanmou-finalizer")
  );
  await fs.mkdir(stagingRoot, { recursive: true });

  let buf;
  if (candidatePptxPath) {
    buf = await fs.readFile(path.resolve(candidatePptxPath));
  } else if (Buffer.isBuffer(deck) || deck instanceof Uint8Array) {
    buf = Buffer.from(deck);
  } else if (typeof deck?.toPptxBuffer === "function") {
    buf = deck.toPptxBuffer();
  } else if (deck) {
    const { buildPptxBuffer } = await import("./package-builder.mjs");
    buf = buildPptxBuffer(deck);
  } else {
    throw new Error("finalizeDeck requires `deck` or `candidatePptxPath`");
  }

  const report = await validateDeckBuffer(buf, { antiSlop, fontPolicy, checkTextOverflow });
  const shortHash = report.sha256.slice(0, 8);
  const stem = path.basename(absOut, path.extname(absOut));
  const receiptPath = path.join(stagingRoot, `${stem}.${shortHash}.validation.json`);
  await fs.writeFile(receiptPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  if (!report.passed) {
    const summary = report.issues
      .filter((i) => i.severity === "fail")
      .map((i) => `  - [${i.gate}/${i.code}] ${i.message}`)
      .join("\n");
    const err = new Error(`finalizeDeck blocked delivery (${report.failCount} failure(s)):\n${summary}`);
    err.validationReport = report;
    err.receiptPath = receiptPath;
    throw err;
  }

  // Verify buffer SHA-256 unchanged & atomically publish to `absOut`
  const verifySha = createHash("sha256").update(buf).digest("hex");
  if (verifySha !== report.sha256) {
    throw new Error("Candidate buffer mutated during validation; aborting publish");
  }

  await fs.mkdir(path.dirname(absOut), { recursive: true });
  const tmpPublish = path.join(path.dirname(absOut), `.${stem}.${randomUUID().slice(0, 8)}.tmp.pptx`);
  await fs.writeFile(tmpPublish, buf);
  await fs.rename(tmpPublish, absOut);

  return {
    outputPath: absOut,
    receiptPath,
    sha256: report.sha256,
    bytes: report.bytes,
    validation: report,
  };
}
