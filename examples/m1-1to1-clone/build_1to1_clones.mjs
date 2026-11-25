// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// M1 Engine Real-World 1:1 Template Fidelity Benchmark:
// Rebuilds 3 complex real agency/consulting template pages (BCG p18, BCG p20, Courseware p43)
// as 100% native editable OOXML vector shapes, gradients, shadows, lines, and rich text.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Presentation,
  PresentationFile,
  buildPolylineStrokeCommands,
  renderDeckToPngs,
} from "../../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(__dirname, "references");
const OUT_DIR = path.join(__dirname, "output");

const NO_LINE = { style: "solid", fill: "none", width: 0 };

/**
 * Helper: Generates a single-path SVG `d` string for a card with selective corner radii
 * and optional top/bottom center pointer triangle!
 */
function buildPointerCapPath({
  w,
  h,
  rTL = 0,
  rTR = 0,
  rBR = 0,
  rBL = 0,
  tipTop = 0, // >0 means upward triangle protruding `tipTop` px above y=tipTop..h
  tipBottom = 0, // >0 means downward triangle protruding `tipBottom` px below body
  tipHalfW = 11,
}) {
  const topY = tipTop;
  const botY = h - tipBottom;
  const cx = w / 2;
  const parts = [];

  // Start at top-left after corner
  parts.push(`M ${rTL} ${topY}`);

  // Top edge (with optional upward pointer at center)
  if (tipTop > 0) {
    parts.push(`L ${cx - tipHalfW} ${topY}`);
    parts.push(`L ${cx} 0`);
    parts.push(`L ${cx + tipHalfW} ${topY}`);
  }
  parts.push(`L ${w - rTR} ${topY}`);
  if (rTR > 0) parts.push(`Q ${w} ${topY} ${w} ${topY + rTR}`);

  // Right edge
  parts.push(`L ${w} ${botY - rBR}`);
  if (rBR > 0) parts.push(`Q ${w} ${botY} ${w - rBR} ${botY}`);

  // Bottom edge (with optional downward pointer at center)
  if (tipBottom > 0) {
    parts.push(`L ${cx + tipHalfW} ${botY}`);
    parts.push(`L ${cx} ${h}`);
    parts.push(`L ${cx - tipHalfW} ${botY}`);
  }
  parts.push(`L ${rBL} ${botY}`);
  if (rBL > 0) parts.push(`Q 0 ${botY} 0 ${botY - rBL}`);

  // Left edge
  parts.push(`L 0 ${topY + rTL}`);
  if (rTL > 0) parts.push(`Q 0 ${topY} ${rTL} ${topY}`);
  parts.push("Z");
  return parts.join(" ");
}

/**
 * Helper: Builds a circular speech-bubble path (circle of radius R + bottom V-tip)
 * using 4 exact cubic Bézier quarter-circle arcs (`kappa = 0.55228475`).
 */
function buildCircleCalloutPath(diameter, tipW = 20, tipH = 17) {
  const r = diameter / 2;
  const cx = r;
  const cy = r;
  const k = r * 0.55228475;
  // Build outer circle with bottom pointer seamlessly merged
  // Top (cx, 0) -> Right (2r, cy) -> Bottom-right -> tip -> Bottom-left -> Left (0, cy) -> Top
  const halfTip = tipW / 2;
  // Approximate angle to meet bottom tip cleanly
  return [
    { moveTo: { x: cx, y: 0 } },
    { cubicBezTo: { x1: cx + k, y1: 0, x2: diameter, y2: cy - k, x: diameter, y: cy } },
    { cubicBezTo: { x1: diameter, y1: cy + k * 0.92, x2: cx + k * 0.95, y2: diameter - 2, x: cx + halfTip, y: diameter - 2 } },
    { lineTo: { x: cx, y: diameter + tipH } },
    { lineTo: { x: cx - halfTip, y: diameter - 2 } },
    { cubicBezTo: { x1: cx - k * 0.95, y1: diameter - 2, x2: 0, y2: cy + k * 0.92, x: 0, y: cy } },
    { cubicBezTo: { x1: 0, y1: cy - k, x2: cx - k, y2: 0, x: cx, y: 0 } },
    { close: {} },
  ];
}

/**
 * ============================================================================
 * SLIDE 1 CLONE: BCG × 小红书《1016》Page 18 (6圆环气泡 + 贝塞尔流线飘带 + 渐变消失括弧)
 * ============================================================================
 */
function buildCloneSlide1_BcgP18(deck) {
  const slide = deck.slides.add({ background: "#FFFFFF" });

  // 1. Background flowing translucent Bezier wave ribbons (`customPaths`)
  // Ribbon A (upper-left to right sweep)
  slide.shapes.add({
    geometry: "custom",
    name: "bg-wave-ribbon-1",
    position: { left: 0, top: 280, width: 1280, height: 125 },
    fill: "linear(90deg, #99E2C4/55 0%, #B8EBD6/42 50%, #A7E5CB/55 100%)",
    line: NO_LINE,
    svgPath:
      "M 0 18 C 310 22 590 78 1280 8 L 1280 34 C 620 102 320 52 0 46 Z",
    viewBox: { width: 1280, height: 125 },
  });

  // Ribbon B (mid crossing sweep)
  slide.shapes.add({
    geometry: "custom",
    name: "bg-wave-ribbon-2",
    position: { left: 0, top: 300, width: 1280, height: 130 },
    fill: "linear(90deg, #6FD3AC/58 0%, #A8E6CF/35 58%, #BCEEE0/48 100%)",
    line: NO_LINE,
    svgPath:
      "M 0 42 C 340 62 720 42 1280 22 L 1280 54 C 740 72 350 98 0 92 Z",
    viewBox: { width: 1280, height: 130 },
  });

  // Soft gray-white horizontal ambient wash behind circles
  slide.shapes.add({
    geometry: "rect",
    name: "bg-soft-wash",
    position: { left: 0, top: 405, width: 1280, height: 42 },
    fill: "linear(180deg, #E2E8F0/32 0%, #FFFFFF/0 100%)",
    line: NO_LINE,
  });

  // 2. Top 2-line BCG Headline
  const title = slide.shapes.add({
    geometry: "textbox",
    name: "bcg-p18-title",
    position: { left: 66, top: 58, width: 1140, height: 82 },
  });
  title.text = "消费品牌的性价比、产品创新速度、消费者互动受到肯定，但产品质量和品牌力\n遇有挑战";
  title.text.style = {
    fontSize: 30.5,
    bold: false,
    color: "#29BA74",
    lineSpacing: 1.22,
    verticalAlignment: "top",
  };

  // 3. Center section title + Left/Right angled gradient-fading brackets with diamond tips
  const secTitle = slide.shapes.add({
    geometry: "textbox",
    name: "bcg-p18-subtitle",
    position: { left: 438, top: 194, width: 420, height: 34 },
  });
  secTitle.text = "消费者对于新消费品牌的看法";
  secTitle.text.style = {
    fontSize: 21,
    bold: true,
    color: "#157954",
    alignment: "center",
    verticalAlignment: "middle",
  };

  // Left angled arm: (128, 238) -> (164, 208) + horizontal fade line (164, 208) -> (432, 208)
  slide.shapes.add({
    geometry: "custom",
    name: "bracket-left-diag",
    position: { left: 128, top: 208, width: 36, height: 30 },
    fill: "none",
    line: { style: "solid", fill: "#157954", width: 2.2 },
    svgPath: "M 0 30 L 36 0",
    viewBox: { width: 36, height: 30 },
  });
  slide.shapes.add({
    geometry: "rect",
    name: "bracket-left-fade",
    position: { left: 163, top: 207, width: 268, height: 2.2 },
    fill: "linear(90deg, #157954 0%, #157954/55 62%, #157954/0 100%)",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "rect",
    name: "bracket-left-diamond",
    position: { left: 124, top: 234, width: 7.5, height: 7.5, rotation: 42 },
    fill: "#157954",
    line: NO_LINE,
  });

  // Right angled arm: horizontal fade (864 -> 1126, 208) + diagonal (1126,208)->(1162,238)
  slide.shapes.add({
    geometry: "rect",
    name: "bracket-right-fade",
    position: { left: 864, top: 207, width: 263, height: 2.2 },
    fill: "linear(90deg, #157954/0 0%, #157954/55 38%, #157954 100%)",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "custom",
    name: "bracket-right-diag",
    position: { left: 1126, top: 208, width: 36, height: 30 },
    fill: "none",
    line: { style: "solid", fill: "#157954", width: 2.2 },
    svgPath: "M 0 0 L 36 30",
    viewBox: { width: 36, height: 30 },
  });
  slide.shapes.add({
    geometry: "rect",
    name: "bracket-right-diamond",
    position: { left: 1158, top: 234, width: 7.5, height: 7.5, rotation: 48 },
    fill: "#157954",
    line: NO_LINE,
  });

  // 4. Six Columns: vertical side lines + bottom thick bar + speech-bubble ring + shadowed white disc + label
  const items = [
    { pct: "72%", label: "性价比更高", positive: true },
    { pct: "78%", label: "推出新产品的\n速度更快", positive: true },
    { pct: "80%", label: "社交平台更\n活跃", positive: true },
    { pct: "77%", label: "跟我互动更多", positive: true },
    { pct: "54%", label: "口碑不稳定", positive: false },
    { pct: "51%", label: "尝鲜，\n未考虑复购", positive: false },
  ];

  const startX = 118;
  const colW = 172;
  const colGap = 14;
  const outerD = 154;
  const innerD = 126;
  const calloutCmds = buildCircleCalloutPath(outerD, 18, 16);

  items.forEach((item, idx) => {
    const colLeft = startX + idx * (colW + colGap);
    const colRight = colLeft + colW;
    const cx = colLeft + colW / 2;

    const accentStroke = item.positive ? "#5BCFA0" : "#B5B5B5";
    const barFill = item.positive ? "#29BA74" : "#8A8A8A";
    const ringGrad = item.positive
      ? "linear(180deg, #16835B 0%, #209D67 55%, #29BA74 100%)"
      : "linear(180deg, #7A7A7A 0%, #9A9A9A 100%)";
    const labelColor = item.positive ? "#29BA74" : "#666666";

    // Left & Right thin column borders
    slide.shapes.add({
      geometry: "line",
      name: `col-${idx + 1}-line-l`,
      position: { left: colLeft, top: 382, width: 0, height: 244 },
      line: { style: "solid", fill: accentStroke, width: 0.85 },
    });
    slide.shapes.add({
      geometry: "line",
      name: `col-${idx + 1}-line-r`,
      position: { left: colRight, top: 382, width: 0, height: 244 },
      line: { style: "solid", fill: accentStroke, width: 0.85 },
    });

    // Bottom thick bar (`y=621..627`)
    slide.shapes.add({
      geometry: "rect",
      name: `col-${idx + 1}-bottom-bar`,
      position: { left: colLeft, top: 621, width: colW, height: 6 },
      fill: barFill,
      line: NO_LINE,
    });

    // Outer circular speech-bubble callout (`customPaths`)
    slide.shapes.add({
      geometry: "custom",
      name: `col-${idx + 1}-outer-callout`,
      position: { left: cx - outerD / 2, top: 263, width: outerD, height: outerD + 16 },
      fill: ringGrad,
      line: NO_LINE,
      customPaths: [{ width: outerD, height: outerD + 16, commands: calloutCmds }],
    });

    // Inner white disc with drop shadow + percentage text
    const disc = slide.shapes.add({
      geometry: "ellipse",
      name: `col-${idx + 1}-inner-disc`,
      position: {
        left: cx - innerD / 2,
        top: 263 + (outerD - innerD) / 2,
        width: innerD,
        height: innerD,
      },
      fill: "#FFFFFF",
      line: NO_LINE,
      shadow: "2px 4px 10px #000000/22",
    });
    disc.text = item.pct;
    disc.text.style = {
      fontSize: 41,
      bold: false,
      color: "#575757",
      alignment: "center",
      verticalAlignment: "middle",
      insets: 0,
    };

    // Metric label inside column
    const lbl = slide.shapes.add({
      geometry: "textbox",
      name: `col-${idx + 1}-label`,
      position: { left: colLeft + 8, top: 492, width: colW - 16, height: 72 },
    });
    lbl.text = item.label;
    lbl.text.style = {
      fontSize: 20,
      bold: true,
      color: labelColor,
      alignment: "center",
      verticalAlignment: "top",
      lineSpacing: 1.28,
    };
  });

  // 5. Bottom-left tilted price-tag icon + "认为新消费品牌……"
  // Outer tag polygon tilted -42deg
  const tagOuter = slide.shapes.add({
    geometry: "homePlate",
    name: "left-tag-icon-outer",
    position: { left: 44, top: 468, width: 46, height: 30, rotation: -48 },
    fill: "#29BA74",
    line: { style: "solid", fill: "#157954", width: 1.2 },
  });
  void tagOuter;
  // Small white hole on tag tip + mini white heart/dot accent
  slide.shapes.add({
    geometry: "ellipse",
    name: "left-tag-hole",
    position: { left: 73, top: 467, width: 6, height: 6 },
    fill: "#FFFFFF",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "custom",
    name: "left-tag-heart",
    position: { left: 57, top: 478, width: 14, height: 13, rotation: -45 },
    fill: "#FFFFFF",
    line: NO_LINE,
    svgPath:
      "M 7 12 C 2 8 0 5 0 3 C 0 1 2 0 4 0 C 5.5 0 6.5 1 7 2 C 7.5 1 8.5 0 10 0 C 12 0 14 1 14 3 C 14 5 12 8 7 12 Z",
    viewBox: { width: 14, height: 13 },
  });

  const leftNote = slide.shapes.add({
    geometry: "textbox",
    name: "left-tag-caption",
    position: { left: 26, top: 522, width: 84, height: 84 },
  });
  leftNote.text = "认为新\n消费品\n牌……";
  leftNote.text.style = {
    fontSize: 18,
    bold: true,
    color: "#575757",
    alignment: "center",
    lineSpacing: 1.25,
  };

  // 6. Bottom source footnote & page number
  const footer = slide.shapes.add({
    geometry: "textbox",
    name: "bcg-p18-footer",
    position: { left: 66, top: 676, width: 760, height: 22 },
  });
  footer.text = "来源：BCG小红书新消费品定性调研、定量调研（N=1,015）；BCG研究与分析";
  footer.text.style = { fontSize: 11, color: "#575757", verticalAlignment: "middle" };

  const pgNo = slide.shapes.add({
    geometry: "textbox",
    name: "bcg-p18-pgno",
    position: { left: 1190, top: 676, width: 42, height: 22 },
  });
  pgNo.text = "17";
  pgNo.text.style = { fontSize: 11, color: "#575757", alignment: "right", verticalAlignment: "middle" };
}

/**
 * ============================================================================
 * SLIDE 2 CLONE: BCG × 小红书《1016》Page 20 (折角双绿丝带面板 + 三组柱状图 + 双圆环 + 切角结论框)
 * ============================================================================
 */
function buildCloneSlide2_BcgP20(deck) {
  const slide = deck.slides.add({ background: "#FFFFFF" });

  // 1. Top 2-line BCG Headline
  const title = slide.shapes.add({
    geometry: "textbox",
    name: "bcg-p20-title",
    position: { left: 66, top: 56, width: 1140, height: 82 },
  });
  title.text = "新消费品的进一步发展也面临挑战，新用户的产品研究上更为精明，品牌力也需\n不断提升以吸引老用户复购";
  title.text.style = {
    fontSize: 30.5,
    color: "#29BA74",
    lineSpacing: 1.22,
    verticalAlignment: "top",
  };

  // Panel headers above ribbons
  const leftHead = slide.shapes.add({
    geometry: "textbox",
    name: "p20-left-head",
    position: { left: 76, top: 174, width: 567, height: 32 },
  });
  leftHead.text = "消费者购物自主调研意愿明显";
  leftHead.text.style = {
    fontSize: 20.5,
    bold: true,
    color: "#29BA74",
    alignment: "center",
    verticalAlignment: "middle",
  };

  const rightHead = slide.shapes.add({
    geometry: "textbox",
    name: "p20-right-head",
    position: { left: 659, top: 174, width: 568, height: 32 },
  });
  rightHead.text = "新消费品牌复购率偏低，消费者品牌认同不强";
  rightHead.text.style = {
    fontSize: 20.5,
    bold: true,
    color: "#29BA74",
    alignment: "center",
    verticalAlignment: "middle",
  };

  // 2. Left & Right diagonal-hatched light-gray panels + 3D folded green top ribbons
  slide.shapes.add({
    geometry: "rect",
    name: "p20-left-panel",
    position: { left: 76, top: 224, width: 567, height: 424 },
    fill: { type: "pattern", pattern: "ltUpDiag", fgColor: "#EAEAEA", bgColor: "#F9F9F9" },
    line: { style: "solid", fill: "#EBEBEB", width: 0.75 },
  });
  slide.shapes.add({
    geometry: "rect",
    name: "p20-left-ribbon",
    position: { left: 55, top: 213, width: 588, height: 11 },
    fill: "#29BA74",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "custom",
    name: "p20-left-ribbon-fold",
    position: { left: 55, top: 224, width: 21, height: 21 },
    fill: "#157954",
    line: NO_LINE,
    svgPath: "M 0 0 L 21 0 L 21 21 Z",
    viewBox: { width: 21, height: 21 },
  });

  slide.shapes.add({
    geometry: "rect",
    name: "p20-right-panel",
    position: { left: 659, top: 224, width: 568, height: 424 },
    fill: { type: "pattern", pattern: "ltUpDiag", fgColor: "#EAEAEA", bgColor: "#F9F9F9" },
    line: { style: "solid", fill: "#EBEBEB", width: 0.75 },
  });
  slide.shapes.add({
    geometry: "rect",
    name: "p20-right-ribbon",
    position: { left: 659, top: 213, width: 588, height: 11 },
    fill: "#29BA74",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "custom",
    name: "p20-right-ribbon-fold",
    position: { left: 1227, top: 224, width: 20, height: 21 },
    fill: "#157954",
    line: NO_LINE,
    svgPath: "M 0 0 L 20 0 L 0 21 Z",
    viewBox: { width: 20, height: 21 },
  });

  // 3. Left Panel Contents
  const qPrompt = slide.shapes.add({
    geometry: "textbox",
    name: "p20-question-italic",
    position: { left: 96, top: 244, width: 526, height: 28 },
  });
  qPrompt.text = "新消费品牌产品产生兴趣后，您会如何做？";
  qPrompt.text.style = {
    fontSize: 17.5,
    italic: true,
    color: "#157954",
    alignment: "center",
    verticalAlignment: "middle",
  };

  // Sub-banner pills (`round2SameRect` rounded top corners + mint-to-white vertical gradient + top-to-bottom fading transparent green arch border!)
  const addTopRoundedBanner = (name, left, top, width, text) => {
    const h = 36;
    const r = 12;
    const b = slide.shapes.add({
      geometry: "custom",
      name,
      position: { left, top, width, height: h },
      fill: "linear(180deg, #CCF2DF 0%, #ECFAF2 58%, #FFFFFF 100%)",
      line: NO_LINE,
      shadow: "3px 3px 6px #000000/12",
      svgPath: buildPointerCapPath({ w: width, h, rTL: r, rTR: r }),
      viewBox: { width, height: h },
    });
    b.text = text;
    b.text.style = {
      fontSize: 17.5,
      bold: true,
      color: "#575757",
      alignment: "center",
      verticalAlignment: "middle",
      insets: 0,
    };

    // Sample top-rounded arch polyline (left bottom -> top-left arc -> top edge -> top-right arc -> right bottom)
    const archPts = [{ x: 0, y: h }];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const theta = Math.PI + (Math.PI / 2) * (i / steps);
      archPts.push({ x: r + r * Math.cos(theta), y: r + r * Math.sin(theta) });
    }
    for (let i = 0; i <= steps; i++) {
      const theta = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
      archPts.push({ x: width - r + r * Math.cos(theta), y: r + r * Math.sin(theta) });
    }
    archPts.push({ x: width, y: h });

    slide.shapes.add({
      geometry: "custom",
      name: `${name}-grad-border`,
      position: { left, top, width, height: h },
      fill: "linear(180deg, #22AE6B 0%, #3AC483/75 52%, #7CE0B0/0 100%)",
      line: NO_LINE,
      customPaths: [{ width, height: h, commands: buildPolylineStrokeCommands(archPts, 1.35) }],
    });
  };

  addTopRoundedBanner("p20-pill-l1", 102, 283, 240, "自主调研vs立刻尝鲜");
  addTopRoundedBanner("p20-pill-l2", 379, 283, 240, "一站购买vs多平台组合");

  // Left Bar Chart 1 (54%, 37%, 9%) — baseline y = 480
  const barsL1 = [
    { x: 120, w: 44, top: 353, val: "54%", fill: "#157954", cat: "线上收集\n更多产品\n口碑信息" },
    { x: 191, w: 44, top: 393, val: "37%", fill: "#29BA74", cat: "线下实体\n店探访或\n体验" },
    { x: 261, w: 44, top: 460, val: "9%", fill: "#9A9A9A", cat: "马上下\n单尝鲜" },
  ];
  for (const b of barsL1) {
    slide.shapes.add({
      geometry: "rect",
      position: { left: b.x, top: b.top, width: b.w, height: 480 - b.top },
      fill: b.fill,
      line: NO_LINE,
    });
    const v = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 8, top: b.top - 22, width: b.w + 16, height: 20 },
    });
    v.text = b.val;
    v.text.style = { fontSize: 14.5, color: "#575757", alignment: "center", verticalAlignment: "bottom" };

    const c = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 14, top: 486, width: b.w + 28, height: 58 },
    });
    c.text = b.cat;
    c.text.style = { fontSize: 13.5, color: "#575757", alignment: "center", lineSpacing: 1.2 };
  }
  slide.shapes.add({
    geometry: "line",
    position: { left: 104, top: 480, width: 222, height: 0 },
    line: { style: "solid", fill: "#7F7F7F", width: 1 },
  });

  // Left Bar Chart 2 (45%, 55%) — baseline y = 480
  const barsL2 = [
    { x: 415, w: 65, top: 374, val: "45%", fill: "#9A9A9A", cat: "偏好在一个平\n台内完成一站\n式购买" },
    { x: 520, w: 65, top: 351, val: "55%", fill: "#29BA74", cat: "偏好在每个环\n节自主组合平\n台、渠道完成\n购买" },
  ];
  for (const b of barsL2) {
    slide.shapes.add({
      geometry: "rect",
      position: { left: b.x, top: b.top, width: b.w, height: 480 - b.top },
      fill: b.fill,
      line: NO_LINE,
    });
    const v = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 6, top: b.top - 22, width: b.w + 12, height: 20 },
    });
    v.text = b.val;
    v.text.style = { fontSize: 14.5, color: "#575757", alignment: "center", verticalAlignment: "bottom" };

    const c = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 18, top: 486, width: b.w + 36, height: 74 },
    });
    c.text = b.cat;
    c.text.style = { fontSize: 13.5, color: "#575757", alignment: "center", lineSpacing: 1.2 };
  }
  slide.shapes.add({
    geometry: "line",
    position: { left: 394, top: 480, width: 212, height: 0 },
    line: { style: "solid", fill: "#7F7F7F", width: 1 },
  });

  // Chamfered bottom callout box helper:
  // Uses filled vector border strips (`<a:custGeom>` + `<a:gradFill>` with `<a:alpha>`) so that
  // top-right & bottom-left 45° chamfers peak at dark green (#157954) and smoothly fade to 0% transparent
  // at top-left & bottom-right across PowerPoint, WPS, Keynote, AND LibreOffice!
  const addChamferBox = (name, left, top, w, h, text) => {
    const cut = 11;
    const boxSp = slide.shapes.add({
      geometry: "custom",
      name,
      position: { left, top, width: w, height: h },
      fill: "#FFFFFF",
      line: NO_LINE,
      svgPath: `M 0 0 L ${w - cut} 0 L ${w} ${cut} L ${w} ${h} L ${cut} ${h} L 0 ${h - cut} Z`,
      viewBox: { width: w, height: h },
    });
    boxSp.text = text;
    boxSp.text.style = {
      fontSize: 16.5,
      bold: true,
      color: "#157954",
      alignment: "left",
      verticalAlignment: "middle",
      lineSpacing: 1.28,
      insets: { top: 6, bottom: 6, left: 22, right: 18 },
    };

    // Closed chamfered border ring with exact aspect-compensated normal `atan2(w, -h)` (~96.46°):
    // 0% = top-right chamfer (#157954), 50% = BOTH top-left (0,0) AND bottom-right (w,h) (0% alpha!),
    // 100% = bottom-left chamfer (#157954)!
    const closedRingPts = [
      { x: 0, y: 0 },
      { x: w - cut, y: 0 },
      { x: w, y: cut },
      { x: w, y: h },
      { x: cut, y: h },
      { x: 0, y: h - cut },
      { x: 0, y: 0 },
    ];
    const diagAngleDeg = (Math.atan2(w, -h) * 180) / Math.PI;
    slide.shapes.add({
      geometry: "custom",
      name: `${name}-grad-ring`,
      position: { left, top, width: w, height: h },
      fill: {
        type: "gradient",
        angleDeg: diagAngleDeg,
        stops: [
          { offset: 0, color: "#157954" },
          { offset: 22000, color: "#29BA74/72" },
          { offset: 46000, color: "#9AE5C3/12" },
          { offset: 50000, color: "#FFFFFF/0" },
          { offset: 54000, color: "#9AE5C3/12" },
          { offset: 78000, color: "#29BA74/72" },
          { offset: 100000, color: "#157954" },
        ],
      },
      line: NO_LINE,
      customPaths: [{ width: w, height: h, commands: buildPolylineStrokeCommands(closedRingPts, 1.45) }],
    });
  };

  addChamferBox(
    "p20-left-summary",
    104,
    574,
    512,
    58,
    "91%的消费者会自主调研产品，55%的消费者会组\n合使用多个平台完成购买"
  );

  // 4. Right Panel Contents
  addTopRoundedBanner("p20-pill-r1", 688, 246, 512, "非耐用新消费品牌半年度复购率");

  const barsR = [
    { x: 764, val: "22%", top: 308, cat: "美妆个护" },
    { x: 843, val: "17%", top: 322, cat: "服装配饰" },
    { x: 922, val: "17%", top: 322, cat: "母婴" },
    { x: 1000, val: "16%", top: 325, cat: "食品饮料" },
    { x: 1079, val: "14%", top: 330, cat: "日用百货" },
  ];
  for (const b of barsR) {
    slide.shapes.add({
      geometry: "rect",
      position: { left: b.x, top: b.top, width: 49, height: 368 - b.top },
      fill: "#9A9A9A",
      line: NO_LINE,
    });
    const v = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 6, top: b.top - 19, width: 61, height: 18 },
    });
    v.text = b.val;
    v.text.style = { fontSize: 13.5, color: "#575757", alignment: "center", verticalAlignment: "bottom" };

    const c = slide.shapes.add({
      geometry: "textbox",
      position: { left: b.x - 12, top: 373, width: 73, height: 22 },
    });
    c.text = b.cat;
    c.text.style = { fontSize: 13.5, color: "#575757", alignment: "center" };
  }
  slide.shapes.add({
    geometry: "line",
    position: { left: 748, top: 368, width: 394, height: 0 },
    line: { style: "solid", fill: "#7F7F7F", width: 1 },
  });

  // Center double-chevron divider with fading green horizontal lines
  slide.shapes.add({
    geometry: "rect",
    position: { left: 706, top: 424, width: 214, height: 2 },
    fill: "linear(90deg, #29BA74/0 0%, #29BA74 100%)",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "rect",
    position: { left: 966, top: 424, width: 214, height: 2 },
    fill: "linear(90deg, #29BA74 0%, #29BA74/0 100%)",
    line: NO_LINE,
  });
  // Top gray chevron + bottom green chevron pointing down
  slide.shapes.add({
    geometry: "custom",
    position: { left: 929, top: 407, width: 28, height: 13 },
    fill: "#7F7F7F",
    line: NO_LINE,
    svgPath: "M 0 0 L 14 7 L 28 0 L 28 6 L 14 13 L 0 6 Z",
    viewBox: { width: 28, height: 13 },
  });
  slide.shapes.add({
    geometry: "custom",
    position: { left: 925, top: 417, width: 36, height: 18 },
    fill: "#29BA74",
    line: NO_LINE,
    svgPath: "M 0 0 L 18 9 L 36 0 L 36 9 L 18 18 L 0 9 Z",
    viewBox: { width: 36, height: 18 },
  });

  // Sub-caption + two gradient lime-green rings (`>75%` and `<25%`)
  const repTitle = slide.shapes.add({
    geometry: "textbox",
    position: { left: 688, top: 446, width: 260, height: 24 },
  });
  repTitle.text = "对于新消费品牌复购……";
  repTitle.text.style = { fontSize: 16, color: "#575757" };

  const ringSpecs = [
    {
      cx: 734,
      val: ">75%",
      runs: [
        { run: "的消费者认为", style: { color: "#575757" } },
        { run: "单\n品体验好", style: { color: "#29BA74", bold: true } },
        { run: "是复购\n的主要原因", style: { color: "#575757" } },
      ],
      textLeft: 790,
    },
    {
      cx: 986,
      val: "<25%",
      runs: [
        { run: "的消费者认为\n", style: { color: "#575757" } },
        { run: "品牌力", style: { color: "#29BA74", bold: true } },
        { run: "是复购\n的主要原因", style: { color: "#575757" } },
      ],
      textLeft: 1044,
    },
  ];

  for (const r of ringSpecs) {
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: r.cx - 46, top: 480, width: 92, height: 92 },
      fill: "linear(180deg, #29BA74 0%, #A3D95B 100%)",
      line: NO_LINE,
    });
    const inner = slide.shapes.add({
      geometry: "ellipse",
      position: { left: r.cx - 40, top: 486, width: 80, height: 80 },
      fill: "#FFFFFF",
      line: NO_LINE,
    });
    inner.text = r.val;
    inner.text.style = {
      fontSize: 20,
      color: "#666666",
      alignment: "center",
      verticalAlignment: "middle",
      wrap: "none",
      insets: 0,
    };

    const desc = slide.shapes.add({
      geometry: "textbox",
      position: { left: r.textLeft, top: 492, width: 146, height: 72 },
    });
    desc.text.set([r.runs]);
    desc.text.style = { fontSize: 15, lineSpacing: 1.28, verticalAlignment: "middle" };
  }

  addChamferBox(
    "p20-right-summary",
    688,
    574,
    512,
    58,
    "新消费品牌的半年复购率大多低于20%，大于75%\n的消费者更认可单品而非品牌"
  );

  // Footer
  const footer = slide.shapes.add({
    geometry: "textbox",
    position: { left: 66, top: 676, width: 760, height: 22 },
  });
  footer.text = "来源：BCG小红书新消费品定性调研；BCG研究与分析";
  footer.text.style = { fontSize: 11, color: "#575757", verticalAlignment: "middle" };

  const pgNo = slide.shapes.add({
    geometry: "textbox",
    position: { left: 1190, top: 676, width: 42, height: 22 },
  });
  pgNo.text = "19";
  pgNo.text.style = { fontSize: 11, color: "#575757", alignment: "right", verticalAlignment: "middle" };
}

/**
 * ============================================================================
 * SLIDE 3 CLONE: 《5267》Page 43 (交错五步双色圆角指针卡 + 同心圆节点时间轴 + 博士帽与叠透菱形)
 * ============================================================================
 */
function buildCloneSlide3_TimelineP43(deck) {
  const slide = deck.slides.add({ background: "#FFFFFF" });

  // 1. Top-left vector Graduation Cap (`customPaths`) + Bold Title "选题方向"
  // Mortarboard top diamond
  slide.shapes.add({
    geometry: "custom",
    name: "grad-cap-top",
    position: { left: 56, top: 58, width: 66, height: 28 },
    fill: "#093C80",
    line: NO_LINE,
    svgPath: "M 33 0 L 66 14 L 33 28 L 0 14 Z",
    viewBox: { width: 66, height: 28 },
  });
  // Cap skull base
  slide.shapes.add({
    geometry: "custom",
    name: "grad-cap-base",
    position: { left: 70, top: 79, width: 38, height: 22 },
    fill: "#0F56B3",
    line: NO_LINE,
    svgPath: "M 0 0 L 19 8 L 38 0 L 38 14 Q 19 24 0 14 Z",
    viewBox: { width: 38, height: 22 },
  });
  // Tassel line & drop
  slide.shapes.add({
    geometry: "rect",
    name: "grad-cap-tassel",
    position: { left: 117, top: 73, width: 3, height: 19 },
    fill: "#093C80",
    line: NO_LINE,
  });
  slide.shapes.add({
    geometry: "ellipse",
    position: { left: 116, top: 94, width: 5, height: 5 },
    fill: "#093C80",
    line: NO_LINE,
  });

  const title = slide.shapes.add({
    geometry: "textbox",
    name: "p43-title",
    position: { left: 145, top: 58, width: 260, height: 46 },
  });
  title.text = "选题方向";
  title.text.style = {
    fontSize: 32,
    bold: true,
    color: "#000000",
    verticalAlignment: "middle",
  };

  // 2. Top-right three overlapping translucent diamonds (Orange + Navy + Royal Blue)
  const diamonds = [
    { left: 1114, fill: "#FF914D" },
    { left: 1138, fill: "#093C80" },
    { left: 1162, fill: "#3B66F5/85" },
  ];
  for (const d of diamonds) {
    slide.shapes.add({
      geometry: "diamond",
      position: { left: d.left, top: 71, width: 45, height: 45 },
      fill: d.fill,
      line: NO_LINE,
    });
  }

  // 3. Center Horizontal Timeline Axis (`y = 389`, `x = 73..1207`) + 4 Bullseye Ring Nodes
  slide.shapes.add({
    geometry: "line",
    name: "timeline-main-axis",
    position: { left: 73, top: 389, width: 1134, height: 0 },
    line: { style: "solid", fill: "#093C80", width: 3 },
  });

  const nodeCentersX = [291, 519, 752, 977];
  for (const ncx of nodeCentersX) {
    // White outer halo gap
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: ncx - 12, top: 389 - 12, width: 24, height: 24 },
      fill: "#FFFFFF",
      line: NO_LINE,
    });
    // Navy ring
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: ncx - 10, top: 389 - 10, width: 20, height: 20 },
      fill: "#093C80",
      line: NO_LINE,
    });
    // White inner ring
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: ncx - 6, top: 389 - 6, width: 12, height: 12 },
      fill: "#FFFFFF",
      line: NO_LINE,
    });
    // Navy center dot
    slide.shapes.add({
      geometry: "ellipse",
      position: { left: ncx - 3.5, top: 389 - 3.5, width: 7, height: 7 },
      fill: "#093C80",
      line: NO_LINE,
    });
  }

  // 4. Five Alternating Two-Tone Pointer Cards (`01`..`05`)
  const cardW = 128;
  const topCardPathNavy = buildPointerCapPath({ w: cardW, h: 154, rTL: 24, rTR: 24 });
  const topCardPathOrange = buildPointerCapPath({
    w: cardW,
    h: 51,
    rBL: 22,
    rBR: 22,
    tipBottom: 14,
    tipHalfW: 12,
  });

  const botCardPathOrange = buildPointerCapPath({
    w: cardW,
    h: 50,
    rTL: 22,
    rTR: 22,
    tipTop: 14,
    tipHalfW: 12,
  });
  const botCardPathNavy = buildPointerCapPath({ w: cardW, h: 155, rBL: 24, rBR: 24 });

  const addTopCard = (left, numStr) => {
    const body = slide.shapes.add({
      geometry: "custom",
      name: `card-${numStr}-navy`,
      position: { left, top: 174, width: cardW, height: 154 },
      fill: "#093C80",
      line: NO_LINE,
      svgPath: topCardPathNavy,
      viewBox: { width: cardW, height: 154 },
    });
    body.text = numStr;
    body.text.style = {
      fontSize: 60,
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
      verticalAlignment: "middle",
      insets: { top: 10, bottom: 0, left: 0, right: 0 },
    };

    slide.shapes.add({
      geometry: "custom",
      name: `card-${numStr}-orange`,
      position: { left, top: 328, width: cardW, height: 51 },
      fill: "#FF914D",
      line: NO_LINE,
      svgPath: topCardPathOrange,
      viewBox: { width: cardW, height: 51 },
    });
  };

  const addBottomCard = (left, numStr) => {
    slide.shapes.add({
      geometry: "custom",
      name: `card-${numStr}-orange`,
      position: { left, top: 398, width: cardW, height: 50 },
      fill: "#FF914D",
      line: NO_LINE,
      svgPath: botCardPathOrange,
      viewBox: { width: cardW, height: 50 },
    });

    const body = slide.shapes.add({
      geometry: "custom",
      name: `card-${numStr}-navy`,
      position: { left, top: 448, width: cardW, height: 155 },
      fill: "#093C80",
      line: NO_LINE,
      svgPath: botCardPathNavy,
      viewBox: { width: cardW, height: 155 },
    });
    body.text = numStr;
    body.text.style = {
      fontSize: 60,
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
      verticalAlignment: "middle",
      insets: { top: 0, bottom: 10, left: 0, right: 0 },
    };
  };

  addBottomCard(110, "01");
  addTopCard(348, "02");
  addBottomCard(581, "03");
  addTopCard(799, "04");
  addBottomCard(1019, "05");

  // 5. Five Text Blocks (Red bold heading + crisp black body paragraphs)
  const textBlocks = [
    {
      left: 70,
      top: 192,
      width: 234,
      height: 165,
      heading: "根据趋势热点",
      body: "热点都不能生搬硬套，不能标题含有热点但是文章却和热点完全无关，如果热点和账号定位无关，宁可不借热点也不要采用",
    },
    {
      left: 300,
      top: 416,
      width: 236,
      height: 150,
      heading: "跨关联类目模仿选题",
      body: "选择和自己类目有一定关联性的类目，然后看他们类目中爆的笔记的内容和标题，看能否应岗承电商教育",
    },
    {
      left: 530,
      top: 192,
      width: 234,
      height: 150,
      heading: "同类目模仿选题",
      body: "看同行爆文进行拆解，但是不要照抄，根据本类目的用户需求去创作，可以同质化的爆点差异化运用到自己的笔记中",
    },
    {
      left: 750,
      top: 416,
      width: 238,
      height: 236,
      heading: "根据人群选题",
      body: "不同人群的需求是不一样的，同样是做彩妆，新手小白、学生党、职场白领、妈妈 · · · 他们的需求是不同的，可以根据不同的人群定位进行选题。如：有手就会的化妆3步骤，韩国博主日常口罩妆，被领导夸的3分钟职场裸妆",
    },
    {
      left: 972,
      top: 192,
      width: 236,
      height: 165,
      heading: "根据产品差异化特征选题",
      body: "可以根据自己产品的核心差异化卖点来选题，从而达到激发用户购买欲的目的，比如：可以咬着吃的牛奶，可以进洗碗机的锅，不用揉面的面包",
    },
  ];

  for (const tb of textBlocks) {
    const sp = slide.shapes.add({
      geometry: "textbox",
      position: { left: tb.left, top: tb.top, width: tb.width, height: tb.height },
    });
    sp.text.set([
      [{ run: tb.heading, style: { fontSize: 17.5, bold: true, color: "#FF3535" } }],
      {
        spaceBefore: 600,
        runs: [{ run: tb.body, style: { fontSize: 15, bold: false, color: "#1A1A1A" } }],
      },
    ]);
    sp.text.style = {
      alignment: "left",
      verticalAlignment: "top",
      lineSpacing: 1.38,
    };
  }
}

async function buildSideBySideHtml(pairs, outHtmlPath, pptxPath) {
  const rowsArr = await Promise.all(
    pairs.map(async (p, i) => {
      const refB64 = `data:image/png;base64,${(await fs.readFile(p.refPng)).toString("base64")}`;
      const outB64 = `data:image/png;base64,${(await fs.readFile(p.outPng)).toString("base64")}`;
      return `
      <section class="pair-card">
        <div class="pair-header">
          <div>
            <span class="tag">BENCHMARK 0${i + 1}</span>
            <h2>${p.title}</h2>
          </div>
          <p class="notes">${p.notes}</p>
        </div>
        <div class="compare-grid">
          <div class="pane">
            <div class="pane-label ref">左：真实原版模板原图 (Reference Original)</div>
            <img src="${refB64}" onclick="zoom(this.src)" />
          </div>
          <div class="pane">
            <div class="pane-label out">右：@yuanmou/pptx-kit M1 100% 原生可编辑重绘 (Editable PPTX Render)</div>
            <img src="${outB64}" onclick="zoom(this.src)" />
          </div>
        </div>
      </section>`;
    })
  );
  const rowsHtml = rowsArr.join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<title>M1 引擎 1:1 模板复刻左右对比验收看板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0B1120; color: #F8FAFC; padding: 32px 40px 64px; }
  header { max-width: 1680px; margin: 0 auto 32px; border-bottom: 1px solid #1E293B; padding-bottom: 20px; }
  h1 { font-size: 26px; margin-bottom: 8px; }
  .meta { color: #38BDF8; font-family: monospace; font-size: 13px; margin-top: 8px; }
  main { max-width: 1680px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px; }
  .pair-card { background: #111827; border: 1px solid #1F2937; padding: 22px 24px 26px; }
  .tag { display: inline-block; background: #7F1D1D; color: #FDE68A; font-size: 11px; font-weight: 700; padding: 3px 8px; margin-bottom: 6px; }
  h2 { font-size: 19px; margin-bottom: 6px; }
  .notes { color: #94A3B8; font-size: 13.5px; margin-bottom: 16px; }
  .compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .pane { background: #020617; border: 1px solid #334155; padding: 10px; }
  .pane-label { font-size: 12.5px; font-weight: 700; padding: 6px 10px; margin-bottom: 8px; }
  .pane-label.ref { background: #1E293B; color: #E2E8F0; }
  .pane-label.out { background: #064E3B; color: #A7F3D0; }
  .pane img { width: 100%; height: auto; display: block; cursor: zoom-in; background: #fff; }
  #lb { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 999; align-items: center; justify-content: center; cursor: zoom-out; }
  #lb.open { display: flex; }
  #lb img { max-width: 96vw; max-height: 94vh; background: #fff; }
</style>
</head>
<body>
  <header>
    <h1>渊眸策略 · @yuanmou/pptx-kit M1 引擎「真实模板 1:1 复刻」左右对比看板</h1>
    <p style="color:#94A3B8;font-size:14px;">零贴图冒充结构：右侧每一根曲线飘带、尖角圆环、折角丝带、柱状图、切角框、指针卡与文字均为 100% 原生可编辑 PowerPoint 对象（点击任意图片可全屏放大核验细节）。</p>
    <p class="meta">可编辑 PPTX 源文件：${pptxPath}</p>
  </header>
  <main>${rowsHtml}</main>
  <div id="lb" onclick="this.classList.remove('open')"><img id="lb-img" src=""/></div>
  <script>function zoom(s){document.getElementById('lb-img').src=s;document.getElementById('lb').classList.add('open');}</script>
</body>
</html>`;
  await fs.mkdir(path.dirname(outHtmlPath), { recursive: true });
  await fs.writeFile(outHtmlPath, html, "utf8");
  return outHtmlPath;
}

async function main() {
  const deck = Presentation.create({
    title: "渊眸策略 · M1 引擎真实商业模板 1:1 原生复刻对照集",
    slideSize: { width: 1280, height: 720 },
    defaultFont: "Microsoft YaHei",
  });

  buildCloneSlide1_BcgP18(deck);
  buildCloneSlide2_BcgP20(deck);
  buildCloneSlide3_TimelineP43(deck);

  const outPptx = path.join(OUT_DIR, "yuanmou_m1_1to1_template_clones.pptx");
  const exported = await PresentationFile.exportPptx(deck);
  await exported.save(outPptx);
  console.log(`✅ Exported 1:1 Clone PPTX: ${outPptx} (${exported.bytes.length} bytes)`);

  const renderRes = await renderDeckToPngs(outPptx, {
    outDir: path.join(OUT_DIR, "png"),
    prefix: "clone_slide",
    dpi: 200,
  });
  console.log(`✅ Rendered 1:1 Clone PNGs:`, renderRes.pngFiles);

  const gallery = await buildSideBySideHtml(
    [
      {
        title: "样板 1：BCG 波士顿咨询 × 小红书报告 P18（流线贝塞尔飘带 + 渐变消失括弧 + 6 组阴影尖角双层圆环气泡）",
        notes: "实测还原项：2条半透明贝塞尔背景飘带、菱形端点+透明度消隐折线括弧、带底部尖角的渐变外环+带投影纯白内圆盘、左侧旋转吊牌镂空爱心矢量图标、6组细边线与底边粗条。",
        refPng: path.join(REF_DIR, "ref_bcg_p18.png"),
        outPng: renderRes.pngFiles[0],
      },
      {
        title: "样板 2：BCG 波士顿咨询 × 小红书报告 P20（3D折角双绿丝带看板 + 阴影渐变胶囊头 + 3组数据柱图 + 双色圆环 + 切角八边形框）",
        notes: "实测还原项：左右双灰底面板+顶部外伸折角三角形立体绿丝带、上圆下直浅绿渐变带投影小标题条、3组精确比例柱图、中部双层山形分隔线、绿黄渐变双圆环、对角45度切角结论框。",
        refPng: path.join(REF_DIR, "ref_bcg_p20.png"),
        outPng: renderRes.pngFiles[1],
      },
      {
        title: "样板 3：小红书运营培训教科书 P43（上下交错五步双色圆角指针卡 + 四组同心圆时间轴 + 矢量博士帽 + 三色叠透菱形）",
        notes: "实测还原项：01-05 上下交错深蓝单侧圆角卡体 + 橙色带三角形指针圆角帽（SVG Q/L 路径直转原生 custGeom）、四层同心靶心节点时间轴、左上博士帽+流苏矢量图形、右上三色叠透菱形。",
        refPng: path.join(REF_DIR, "ref_timeline_p43.png"),
        outPng: renderRes.pngFiles[2],
      },
    ],
    path.join(OUT_DIR, "m1_1to1_side_by_side.html"),
    outPptx
  );
  console.log(`✅ Built Side-by-Side Comparison Board: ${gallery}`);
}

main().catch((err) => {
  console.error("❌ 1:1 Clone Build Failed:", err);
  process.exit(1);
});
