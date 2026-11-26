// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Milestone M2 Benchmark: Real-Template Surgical Suite (Weapons 07-11) + Native <a:tbl> & Embedded-.xlsx <c:chart> (Weapons 12-15)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Presentation,
  PresentationFile,
  fr,
  fixed,
  makeBulletList,
  inspectTemplateDeck,
  validateTemplatePlan,
  prepareStarterDeck,
  auditTemplateFidelity,
  renderDeckToPngs,
  readZipBuffer,
  buildPolylineStrokeCommands,
} from "../../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");
const ASSETS_DIR = path.join(__dirname, "assets");
const SOURCE_CACHE =
  process.env.YUANMOU_SOURCE_CACHE ||
  path.resolve(__dirname, "../../../../production/source_cache");

const DECK_5012 = path.join(
  SOURCE_CACHE,
  "【5012】绝味鸭脖2026全域社媒年轻化与私域增粉营销方案（32页）.pptx"
);
const DECK_5011 = path.join(
  SOURCE_CACHE,
  "【5011】品牌新媒体矩阵搭建与年度内容运营体系通用框架（29页）.pptx"
);

function addCrimsonTeaSeal(slide) {
  slide.shapes.add({
    name: "ym-tea-seal",
    geometry: "ellipse",
    position: { left: 43, top: 17, width: 88, height: 88 },
    fill: "linear(135deg, #DC2626 0%, #991B1B 100%)",
    line: { style: "solid", fill: "#FECACA", width: 2.5 },
    shadow: "0px 4px 10px #991B1B/22",
    text: "茶",
    textStyle: {
      fontFamily: "PingFang SC",
      fontSize: "40px",
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
      verticalAlignment: "middle",
    },
  });
}

// ============================================================================
// PART 1: Pure `.pptx` Surgical Suite (Pairs 1 & 2 on Real Deck 5012 S10 & S12)
// ============================================================================
async function buildPart1SurgicalDeck() {
  const inspectDir = path.join(OUT_DIR, "inspect_5012");
  const { manifest, inspection } = await inspectTemplateDeck({
    pptxPath: DECK_5012,
    outDir: inspectDir,
  });

  const frameMap = {
    templateName: "5012-juewei-to-oriental-tea",
    outputSlides: [
      {
        outputSlide: 1,
        sourceSlide: 10,
        narrativeRole: "东方茶饮年轻化人群与社媒声量洞察",
        editTargets: [
          { targetId: "im/s10_27_1", action: "delete" },
          { targetId: "im/s10_6_13", action: "delete" },
          { targetId: "sh/s10_28_2", action: "rewrite" },
          { targetId: "sh/s10_29_4", action: "rewrite" },
          { targetId: "sh/s10_36_6", action: "rewrite" },
          { targetId: "sh/s10_22_7", action: "rewrite" },
          { targetId: "sh/s10_21_9", action: "rewrite" },
          { targetId: "sh/s10_33_10", action: "rewrite" },
          { targetId: "sh/s10_41_12", action: "rewrite" },
        ],
      },
      {
        outputSlide: 2,
        sourceSlide: 12,
        narrativeRole: "时令鲜果茶创新与东方庭院第三空间策略",
        editTargets: [
          { targetId: "im/s12_6_1", action: "delete" },
          { targetId: "im/s12_4_5", action: "delete" },
          { targetId: "sh/s12_7_2", action: "rewrite" },
          { targetId: "sh/s12_5_6", action: "rewrite" },
          { targetId: "sh/s12_14_9", action: "rewrite" },
          { targetId: "sh/s12_32_15", action: "rewrite" },
          { targetId: "sh/s12_25_16", action: "rewrite" },
          { targetId: "im/s12_19_12", action: "replace" },
          { targetId: "im/s12_22_14", action: "replace" },
          { targetId: "im/s12_21_13", action: "replace" },
          { targetId: "im/s12_28_17", action: "replace" },
          { targetId: "im/s12_30_18", action: "replace" },
        ],
      },
    ],
  };

  const planCheck = validateTemplatePlan({ map: frameMap, inspection });
  if (planCheck.status !== "pass") {
    throw new Error(`Plan check failed: ${JSON.stringify(planCheck.issues)}`);
  }

  const starterPath = path.join(OUT_DIR, "starter_5012.pptx");
  const deck = await prepareStarterDeck({
    pptxPath: DECK_5012,
    map: frameMap,
    outPptxPath: starterPath,
  });

  // --- Slide 1 (Cloned from 5012 Slide 10: 3-Sector Pastel Fan-Ring) ---
  const s1 = deck.slides.getItem(0);
  deck.resolve("im/s01_27_1").delete();
  deck.resolve("im/s01_6_13").delete();
  addCrimsonTeaSeal(s1);

  deck.resolve("sh/s01_28_2").text.set("茶饮人群洞察");
  deck.resolve("sh/s01_29_4").text.set("社媒种草热度");
  deck
    .resolve("sh/s01_36_6")
    .text.set(
      "据小红书与抖音茶饮赛道声量监测，“原叶鲜奶茶”与“围炉冰茶”搜索指数同比跃升168%，东方新茶饮稳居年轻社交打卡榜首。"
    );

  deck.resolve("sh/s01_22_7").text.set("Z世代画像");
  deck
    .resolve("sh/s01_21_9")
    .text.set(
      "核心客群聚焦95后与00后都市白领及高校人群，江浙沪与川渝新一线门店复购率领跑；“零奶精低负担+国风高颜值杯装”成首要决策因子。"
    );

  deck.resolve("sh/s01_33_10").text.set("三大消费群");
  deck
    .resolve("sh/s01_41_12")
    .text.set(
      "细分为午后办公拼单族、周末庭院打卡党与国潮联名收集控三大客群，差异化客单与情绪诉求打开全时段增长空间。"
    );

  // --- Slide 2 (Cloned from 5012 Slide 12: Dual Card + 5 roundRect Masked Images) ---
  const s2 = deck.slides.getItem(1);
  deck.resolve("im/s02_6_1").delete();
  deck.resolve("im/s02_4_5").delete();
  addCrimsonTeaSeal(s2);

  deck.resolve("sh/s02_7_2").text.set("产品空间策略");
  deck.resolve("sh/s02_5_6").text.set("时令鲜果，紧跟健康风向");
  deck.resolve("sh/s02_14_9").text.set("庭院茶席，沉淀社交资产");

  deck
    .resolve("sh/s02_32_15")
    .text.set([
      "秋冬主推“围炉柿柿红”与热橙乌龙限定款",
      "全线升级高山原叶现萃，公开低负担热量签",
      "按节气滚动上新地域风味，引爆社媒自来水",
    ]);

  deck
    .resolve("sh/s02_25_16")
    .text.set(
      "打破传统档口即买即走模式，以竹木茶席、炭火茶炉与暖光庭院打造“城市第三茶事空间”，在小红书形成高出片率打卡磁场与私域留存闭环。"
    );

  // Replace all 5 OOXML `roundRect`-masked image slots in-place (`fit: "cover"` auto `<a:srcRect>`!)
  deck.resolve("im/s02_19_12").replace({ path: path.join(ASSETS_DIR, "tea_scene_1.jpg"), fit: "cover" });
  deck.resolve("im/s02_22_14").replace({ path: path.join(ASSETS_DIR, "tea_scene_3.jpg"), fit: "cover" });
  deck.resolve("im/s02_21_13").replace({ path: path.join(ASSETS_DIR, "tea_scene_4.jpg"), fit: "cover" });
  deck.resolve("im/s02_28_17").replace({ path: path.join(ASSETS_DIR, "tea_scene_2.jpg"), fit: "cover" });
  deck.resolve("im/s02_30_18").replace({ path: path.join(ASSETS_DIR, "tea_scene_5.jpg"), fit: "cover" });

  const outPptx = path.join(OUT_DIR, "yuanmou_m2_part1_surgical_5012.pptx");
  const exported = await PresentationFile.exportPptx(deck);
  await exported.save(outPptx);

  const fidelity = await auditTemplateFidelity({
    sourcePptxPath: DECK_5012,
    finalPptxPath: outPptx,
    expectedSlideCount: 2,
    authoringScriptPaths: [fileURLToPath(import.meta.url)],
  });
  if (!fidelity.passed) {
    throw new Error(`Fidelity audit failed on Part 1: ${JSON.stringify(fidelity.issues)}`);
  }

  return { outPptx, manifest, fidelity };
}

// ============================================================================
// PART 2: Hybrid Surgery + Native `.xlsx` Charts + Merged `<a:tbl>` (Pair 3 on 5011 S25)
// ============================================================================
async function buildPart2HybridDataDeck() {
  const { inspection } = await inspectTemplateDeck({ pptxPath: DECK_5011 });
  const frameMap = {
    templateName: "5011-hybrid-data-upgrade",
    outputSlides: [
      {
        outputSlide: 1,
        sourceSlide: 25,
        narrativeRole: "全时段种草曝光与小程序核销双高峰数据策略",
        editTargets: [
          { targetId: "sh/s25_2_4", action: "rewrite" },
          { targetId: "sh/s25_12_7", action: "rewrite" },
          { targetId: "sh/s25_17_9", action: "rewrite-and-reposition" },
          { targetId: "sh/s25_16_8", action: "rewrite-and-reposition" },
          { targetId: "sh/s25_8_3", action: "delete" },
          { targetId: "sh/s25_10_6", action: "delete" },
          { targetId: "ch/s25_7_5", action: "delete" },
        ],
      },
    ],
  };

  const planCheck = validateTemplatePlan({ map: frameMap, inspection });
  if (planCheck.status !== "pass") {
    throw new Error(`5011 plan check failed: ${JSON.stringify(planCheck.issues)}`);
  }

  const deck = await prepareStarterDeck({ pptxPath: DECK_5011, map: frameMap });
  const sl = deck.slides.getItem(0);

  // Delete static black frame & single-series old chart, keep original master & left orange/gold blocks!
  deck.resolve("sh/s01_8_3").delete();
  deck.resolve("sh/s01_10_6").delete();
  deck.resolve("ch/s01_7_5").delete();

  // Rewrite left-column original elements in-place
  deck.resolve("sh/s01_2_4").text.set("双高峰投放与核销测算");
  deck
    .resolve("sh/s01_12_7")
    .text.set(
      "打通小红书种草脉冲与小程序领券核销链路后，全天流量呈现显著的“午间拼单+晚间庭院打卡”双峰结构。\n建议将85%信息流预算集中投向两大黄金窗口，最大化单店核销ROI。"
    );
  deck.resolve("sh/s01_17_9").reposition({ width: 320 }).text.set("19:00-22:00 晚高峰");
  deck.resolve("sh/s01_16_8").reposition({ left: 165, width: 285 }).text.set("12:00-14:00 午拼单");

  // Subtle card container for top-left clustered column chart
  sl.shapes.add({
    geometry: "roundRect",
    borderRadius: 10,
    position: { left: 486, top: 132, width: 468, height: 274 },
    fill: "#FFFBEB",
    line: { style: "solid", fill: "#FDE68A", width: 1 },
  });

  // Subtle card container for top-right doughnut chart
  sl.shapes.add({
    geometry: "roundRect",
    borderRadius: 10,
    position: { left: 968, top: 132, width: 266, height: 274 },
    fill: "#F8FAFC",
    line: { style: "solid", fill: "#E2E8F0", width: 1 },
  });

  // 1) Native Clustered Column Chart (with embedded `.xlsx`)
  sl.charts.add("column", {
    title: "分时段种草曝光 vs 到店核销指数",
    titleTextStyle: { fontSize: "13.5px", bold: true, color: "#1E293B" },
    position: { left: 494, top: 140, width: 452, height: 258 },
    categories: ["09:00", "12:00", "14:00", "16:00", "19:00", "21:00"],
    series: [
      { name: "种草曝光指数", values: [42, 118, 96, 74, 136, 124], fill: "#F59E0B" },
      { name: "小程序核销单量", values: [26, 95, 78, 52, 119, 106], fill: "#0F3A7D" },
    ],
    barOptions: { grouping: "clustered", gapWidth: 115, overlap: -15 },
    legend: { position: "t", textStyle: { fontSize: "10.5px", color: "#475569" } },
    dataLabels: { showValue: true, textStyle: { fontSize: "9.5px", bold: true, color: "#334155" } },
    xAxis: { textStyle: { fontSize: "10.5px", color: "#475569" } },
    yAxis: {
      min: 0,
      max: 160,
      majorUnit: 40,
      textStyle: { fontSize: "10px", color: "#64748B" },
      majorGridlines: { style: "dashed", fill: "#E2E8F0", width: 0.75 },
    },
  });

  // 2) Native Doughnut Chart (with embedded `.xlsx`)
  sl.charts.add("doughnut", {
    title: "全天GMV时段贡献占比",
    titleTextStyle: { fontSize: "13.5px", bold: true, color: "#1E293B" },
    position: { left: 974, top: 140, width: 254, height: 258 },
    categories: ["晚间社交档", "午间拼单档", "常规长尾档"],
    series: [
      {
        name: "GMV占比",
        values: [47, 38, 15],
        pointFills: ["#0F3A7D", "#F59E0B", "#94A3B8"],
      },
    ],
    hasLegend: true,
    legend: { position: "b", textStyle: { fontSize: "10px", color: "#475569" } },
    doughnutOptions: { holeSize: 56, firstSliceAngle: 0 },
    dataLabels: {
      showValue: false,
      showPercent: true,
      textStyle: { fontSize: "10.5px", bold: true, color: "#FFFFFF" },
    },
  });

  // 3) Native Proportional & Row-Merged Strategy Table `<a:tbl>`
  const tbl = sl.tables.add({
    position: { left: 486, top: 422, width: 748, height: 220 },
    columnTracks: [fixed(98), fixed(132), fr(1.3), fixed(96), fixed(92)],
    rowHeights: [42, 44, 44, 44, 46],
    headerFill: "#0F3A7D",
    zebraFill: "#FFFBEB",
    totalRow: true,
    totalRowFill: "#FEF3C7",
    verticalBorders: true,
    border: { style: "solid", fill: "#CBD5E1", width: 0.75 },
    values: [
      ["投放层级", "目标时段", "核心种草与转化动作", "预算占比", "目标ROI"],
      ["黄金双高峰", "12:00 - 14:00", "写字楼双杯拼单券 + 信息流精准追投", "35%", "4.2x"],
      ["黄金双高峰", "19:00 - 22:00", "达人探店直播脉冲 + 庭院围炉双人餐", "50%", "4.8x"],
      ["常规蓄水档", "其余营业时段", "搜索关键词卡位 + 私域社群复购唤醒", "15%", "3.1x"],
      ["全天合计", "09:00 - 23:00", "全域曝光-领券-到店核销一体化闭环", "100%", "4.3x"],
    ],
  });

  // Row-span merge on column 0 ("黄金双高峰") + column-align numeric columns
  tbl.merge({ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 });
  tbl.cells.block({ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }).style = {
    bold: true,
    color: "#B45309",
    alignment: "center",
  };
  tbl.cells.block({ startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 }).style = {
    alignment: "center",
  };
  tbl.cells.block({ startRow: 1, endRow: 4, startColumn: 3, endColumn: 4 }).style = {
    alignment: "center",
    bold: true,
  };
  tbl.getCell(4, 0).text.style = { alignment: "center" };

  const outPptx = path.join(OUT_DIR, "yuanmou_m2_part2_hybrid_5011.pptx");
  const exported = await PresentationFile.exportPptx(deck);
  await exported.save(outPptx);

  const fidelity = await auditTemplateFidelity({
    sourcePptxPath: DECK_5011,
    finalPptxPath: outPptx,
    expectedSlideCount: 1,
    authoringScriptPaths: [fileURLToPath(import.meta.url)],
  });
  if (!fidelity.passed) {
    throw new Error(`Fidelity audit failed on Part 2: ${JSON.stringify(fidelity.issues)}`);
  }

  return { outPptx, fidelity };
}

// ============================================================================
// PART 3: 1:1 Exact Clones of Real Consulting Table & Multi-Chart Pages (Pairs 4 & 5)
// ============================================================================
function addBcgCornerBrackets(slide, { left, top, width, height, len = 22, thick = 4, color = "#29BA74" }) {
  // Soft mint fill inside callout
  slide.shapes.add({
    geometry: "rect",
    position: { left: left + 2, top: top + 2, width: width - 4, height: height - 4 },
    fill: "#ECFDF3",
    line: "none",
  });
  const corners = [
    // Top-left L
    [
      { x: 0, y: len },
      { x: 0, y: 0 },
      { x: len, y: 0 },
    ],
    // Bottom-left L
    [
      { x: 0, y: height - len },
      { x: 0, y: height },
      { x: len, y: height },
    ],
    // Top-right L
    [
      { x: width - len, y: 0 },
      { x: width, y: 0 },
      { x: width, y: len },
    ],
    // Bottom-right L
    [
      { x: width - len, y: height },
      { x: width, y: height },
      { x: width, y: height - len },
    ],
  ];
  for (const pts of corners) {
    slide.shapes.add({
      position: { left, top, width, height },
      customPaths: [{ width, height, commands: buildPolylineStrokeCommands(pts, thick, false) }],
      fill: color,
      line: "none",
    });
  }
}

function addBcgChevronDivider(slide, { left, top, width }) {
  const mid = width / 2;
  const gap = 46;
  // Left & right green rules
  slide.shapes.add({
    geometry: "rect",
    position: { left, top: top + 1, width: mid - gap, height: 1.5 },
    fill: "#29BA74",
    line: "none",
  });
  slide.shapes.add({
    geometry: "rect",
    position: { left: left + mid + gap, top: top + 1, width: mid - gap, height: 1.5 },
    fill: "#29BA74",
    line: "none",
  });
  // Solid green downward triangle + outer V chevron
  slide.shapes.add({
    position: { left: left + mid - 42, top, width: 84, height: 16 },
    customPaths: [
      {
        width: 84,
        height: 16,
        commands: [
          { cmd: "moveTo", x: 8, y: 0 },
          { cmd: "lineTo", x: 76, y: 0 },
          { cmd: "lineTo", x: 42, y: 12 },
          { cmd: "close" },
        ],
      },
    ],
    fill: "#29BA74",
    line: "none",
  });
  slide.shapes.add({
    position: { left: left + mid - 48, top: top + 3, width: 96, height: 18 },
    customPaths: [
      {
        width: 96,
        height: 18,
        commands: buildPolylineStrokeCommands(
          [
            { x: 0, y: 0 },
            { x: 48, y: 15 },
            { x: 96, y: 0 },
          ],
          1.8,
          false
        ),
      },
    ],
    fill: "#1B8A5A",
    line: "none",
  });
}

function buildSlide4BcgP12Clone(pres) {
  const sl = pres.slides.add({ background: "#FFFFFF" });

  // Header Title (exact BCG P12 two-tone olive + emerald title)
  sl.shapes.add({
    position: { left: 66, top: 58, width: 1140, height: 76 },
    text: [
      {
        runs: [
          { run: "供给端：", style: { color: "#94B418", fontSize: "24px", bold: false } },
          {
            run: "代工厂的大量存在帮助新消费品牌快速创新，电商销售渗透率的快速提",
            style: { color: "#29BA74", fontSize: "24px", bold: false },
          },
        ],
        style: { lineSpacing: 1.25 },
      },
      {
        runs: [
          {
            run: "升，降低了中小规模企业的线下渠道能力要求",
            style: { color: "#29BA74", fontSize: "24px", bold: false },
          },
        ],
        style: { lineSpacing: 1.25 },
      },
    ],
    textStyle: { fontFamily: "PingFang SC", insets: 0 },
  });

  // Left & Right Column Subheaders
  sl.shapes.add({
    position: { left: 76, top: 164, width: 568, height: 32 },
    text: "成熟国内供应链缩短品牌生产实现周期",
    textStyle: { fontFamily: "PingFang SC", fontSize: "19px", bold: true, color: "#29BA74", alignment: "center" },
  });
  sl.shapes.add({
    position: { left: 660, top: 164, width: 568, height: 32 },
    text: "电商和直播帮助品牌速达消费者",
    textStyle: { fontFamily: "PingFang SC", fontSize: "19px", bold: true, color: "#29BA74", alignment: "center" },
  });

  // Left & Right Subtle Hatched/Light Gray-Mint Panels (`y=205..655`)
  sl.shapes.add({
    geometry: "rect",
    position: { left: 76, top: 205, width: 568, height: 450 },
    fill: { type: "pattern", pattern: "ltUpDiag", fgColor: "#F1F5F3", bgColor: "#FAFCFB" },
    line: { style: "solid", fill: "#EEF2F0", width: 1 },
  });
  sl.shapes.add({
    geometry: "rect",
    position: { left: 660, top: 205, width: 568, height: 450 },
    fill: { type: "pattern", pattern: "ltUpDiag", fgColor: "#F1F5F3", bgColor: "#FAFCFB" },
    line: { style: "solid", fill: "#EEF2F0", width: 1 },
  });

  // Top Green Bars + Folded Dark-Green Corner Ears (Left ear at x=56..76, Right ear at x=1228..1248)
  sl.shapes.add({
    geometry: "rect",
    position: { left: 56, top: 204, width: 588, height: 9 },
    fill: "#29BA74",
    line: "none",
  });
  sl.shapes.add({
    position: { left: 56, top: 213, width: 20, height: 20 },
    customPaths: [
      {
        width: 20,
        height: 20,
        commands: [
          { cmd: "moveTo", x: 0, y: 0 },
          { cmd: "lineTo", x: 20, y: 0 },
          { cmd: "lineTo", x: 20, y: 20 },
          { cmd: "close" },
        ],
      },
    ],
    fill: "#0B6B3A",
    line: "none",
  });

  sl.shapes.add({
    geometry: "rect",
    position: { left: 660, top: 204, width: 588, height: 9 },
    fill: "#29BA74",
    line: "none",
  });
  sl.shapes.add({
    position: { left: 1228, top: 213, width: 20, height: 20 },
    customPaths: [
      {
        width: 20,
        height: 20,
        commands: [
          { cmd: "moveTo", x: 0, y: 0 },
          { cmd: "lineTo", x: 20, y: 0 },
          { cmd: "lineTo", x: 0, y: 20 },
          { cmd: "close" },
        ],
      },
    ],
    fill: "#0B6B3A",
    line: "none",
  });

  // --- LEFT PANEL CONTENT: Title + Genuine Native `<a:tbl>` Table ---
  sl.shapes.add({
    position: { left: 93, top: 230, width: 440, height: 28 },
    text: "完美日记国内代工厂举例（非穷尽）",
    textStyle: { fontFamily: "PingFang SC", fontSize: "17px", bold: true, color: "#404040", insets: 0 },
  });

  const bcgTbl = sl.tables.add({
    position: { left: 94, top: 273, width: 530, height: 184 },
    columnTracks: [fixed(98), fixed(128), fr(1)],
    rowHeights: [40, 48, 48, 48],
    headerFill: "#29BA74",
    zebraFill: "#FFFFFF",
    headerTextStyle: {
      fontFamily: "PingFang SC",
      fontSize: "14.5px",
      bold: false,
      color: "#FFFFFF",
      alignment: "left",
      verticalAlignment: "middle",
    },
    bodyTextStyle: {
      fontFamily: "PingFang SC",
      fontSize: "14.5px",
      bold: false,
      color: "#404040",
      alignment: "left",
      verticalAlignment: "middle",
    },
    cellPadding: { top: 6, bottom: 6, left: 6, right: 8 },
    borders: {
      top: "none",
      bottom: { style: "dashed", fill: "#CBD5E1", width: 1 },
      left: { style: "dashed", fill: "#CBD5E1", width: 1 },
      right: "none",
    },
    values: [
      ["代工厂", "所在地", "代工国际大牌"],
      ["莹特丽", "江苏", "迪奥、雅诗兰黛、倩碧等"],
      ["科丝美诗", "广东、上海", "欧莱雅、美宝莲兰蔻、MAC等"],
      ["诺斯贝尔", "广东", "妮维雅、韩后、悦诗风吟"],
    ],
  });

  // Exact BCG table border treatment: no left border on col 0, solid white vertical dividers in header row, no bottom border on last row
  for (let r = 0; r < 4; r++) {
    bcgTbl.getCell(r, 0).borders.left = "none";
    if (r === 0) {
      for (let c = 0; c < 3; c++) {
        bcgTbl.getCell(0, c).borders.bottom = "none";
        if (c > 0) bcgTbl.getCell(0, c).borders.left = { style: "solid", fill: "#FFFFFF", width: 1.5 };
      }
    }
    if (r === 3) {
      for (let c = 0; c < 3; c++) bcgTbl.getCell(3, c).borders.bottom = "none";
    }
  }

  addBcgChevronDivider(sl, { left: 94, top: 511, width: 530 });
  addBcgCornerBrackets(sl, { left: 97, top: 545, width: 524, height: 86 });
  sl.shapes.add({
    position: { left: 105, top: 552, width: 508, height: 72 },
    text: [
      {
        runs: [
          { run: "完美日记披露，可在", style: { color: "#404040", bold: true } },
          { run: "6个月", style: { color: "#29BA74", bold: true } },
          { run: "内完成新品的概念提出、开", style: { color: "#404040", bold: true } },
        ],
        style: { alignment: "center", lineSpacing: 1.35 },
      },
      {
        runs: [
          { run: "发到上线，远低于国际品牌通常需要的", style: { color: "#404040", bold: true } },
          { run: "7-18个月", style: { color: "#29BA74", bold: true } },
        ],
        style: { alignment: "center", lineSpacing: 1.35 },
      },
    ],
    textStyle: { fontFamily: "PingFang SC", fontSize: "15px", verticalAlignment: "middle", insets: 0 },
  });

  // --- RIGHT PANEL CONTENT: Timeline Arrow + 3 Milestone Cards ---
  sl.shapes.add({
    position: { left: 686, top: 230, width: 440, height: 28 },
    text: "电商和平台直播业务发展时间线",
    textStyle: { fontFamily: "PingFang SC", fontSize: "17px", bold: true, color: "#064E2B", insets: 0 },
  });

  const milestones = [
    {
      label: "2016-2017年: 初探期",
      cx: 776,
      cardLeft: 694,
      bullets: ["2016年5月，淘宝上线直播功能", "2016年9月，京东上线直播功能"],
    },
    {
      label: "2018年: 加速期",
      cx: 948,
      cardLeft: 866,
      bullets: ["2018年6月，快手上线快手小店", "12月，抖音开放购物车功能"],
    },
    {
      label: "2019年至今: 爆发期",
      cx: 1120,
      cardLeft: 1038,
      bullets: ["2019年1月，淘宝推出直播APP", "2020年1月，拼多多开启多多直播", "2020年4月，小红书上线直播入口"],
    },
  ];

  // Horizontal gradient arrow bar (`x=688..1225, y=296..326`)
  sl.shapes.add({
    position: { left: 688, top: 296, width: 538, height: 28 },
    customPaths: [
      {
        width: 538,
        height: 28,
        commands: [
          { cmd: "moveTo", x: 0, y: 7 },
          { cmd: "lineTo", x: 520, y: 7 },
          { cmd: "lineTo", x: 520, y: 0 },
          { cmd: "lineTo", x: 538, y: 14 },
          { cmd: "lineTo", x: 520, y: 28 },
          { cmd: "lineTo", x: 520, y: 21 },
          { cmd: "lineTo", x: 0, y: 21 },
          { cmd: "close" },
        ],
      },
    ],
    fill: "linear(90deg, #E5E7EB 0%, #9CA3AF 62%, #52525B 100%)",
    line: "none",
  });

  for (const ms of milestones) {
    sl.shapes.add({
      position: { left: ms.cardLeft - 14, top: 270, width: 184, height: 22 },
      text: ms.label,
      textStyle: { fontFamily: "PingFang SC", fontSize: "12.5px", bold: true, color: "#404040", alignment: "center", insets: 0 },
    });

    // Concentric node circle on arrow + vertical stem
    sl.shapes.add({
      geometry: "ellipse",
      position: { left: ms.cx - 10, top: 300, width: 20, height: 20 },
      fill: "#FFFFFF",
      line: { style: "solid", fill: "#D4D4D8", width: 1.5 },
    });
    sl.shapes.add({
      geometry: "ellipse",
      position: { left: ms.cx - 6, top: 304, width: 12, height: 12 },
      fill: "#52525B",
      line: "none",
    });
    sl.shapes.add({
      geometry: "rect",
      position: { left: ms.cx - 0.5, top: 320, width: 1, height: 23 },
      fill: "#71717A",
      line: "none",
    });

    // Card background + top-to-bottom fading green border strip (hardware-reliable polyline stroke!)
    const cw = 160;
    const ch = 148;
    const cy = 343;
    sl.shapes.add({
      geometry: "rect",
      position: { left: ms.cardLeft, top: cy, width: cw, height: ch },
      fill: "#FFFFFF",
      line: "none",
    });
    sl.shapes.add({
      position: { left: ms.cardLeft, top: cy, width: cw, height: ch },
      customPaths: [
        {
          width: cw,
          height: ch,
          commands: buildPolylineStrokeCommands(
            [
              { x: 0, y: 0 },
              { x: cw, y: 0 },
              { x: cw, y: ch },
              { x: 0, y: ch },
            ],
            2,
            true
          ),
        },
      ],
      fill: {
        type: "gradient",
        gradientKind: "linear",
        angleDeg: 90,
        stops: [
          { offset: 0, color: "#15803D" },
          { offset: 55000, color: "#29BA74" },
          { offset: 100000, color: "#D1FAE5" },
        ],
      },
      line: "none",
    });

    sl.shapes.add({
      position: { left: ms.cardLeft + 7, top: cy + 8, width: cw - 14, height: ch - 14 },
      text: makeBulletList(ms.bullets, {
        bulletChar: "•",
        bulletColor: "#29BA74",
        indent: 11,
        fontFamily: "PingFang SC",
        fontSize: "12px",
        color: "#404040",
        lineSpacing: 1.25,
        spaceAfter: 3,
      }),
      textStyle: { insets: 0, verticalAlignment: "top" },
    });
  }

  addBcgChevronDivider(sl, { left: 678, top: 511, width: 530 });
  addBcgCornerBrackets(sl, { left: 681, top: 545, width: 524, height: 86 });
  sl.shapes.add({
    position: { left: 690, top: 552, width: 506, height: 72 },
    text: [
      {
        runs: [{ run: "电商渠道发展，代运营和独立软件开发服务商", style: { color: "#404040", bold: true } }],
        style: { alignment: "center", lineSpacing: 1.35 },
      },
      {
        runs: [
          { run: "助力新消费品牌快速布局", style: { color: "#29BA74", bold: true } },
          { run: "，触达消费者", style: { color: "#404040", bold: true } },
        ],
        style: { alignment: "center", lineSpacing: 1.35 },
      },
    ],
    textStyle: { fontFamily: "PingFang SC", fontSize: "15px", verticalAlignment: "middle", insets: 0 },
  });

  // Footer source & page number
  sl.shapes.add({
    position: { left: 66, top: 674, width: 620, height: 18 },
    text: "来源：逸林电商招股书；浙江省电子商务促进会数字贸易研究院；BCG研究与分析。",
    textStyle: { fontFamily: "PingFang SC", fontSize: "9.5px", color: "#7F7F7F", insets: 0 },
  });
  sl.shapes.add({
    position: { left: 1185, top: 674, width: 30, height: 18 },
    text: "11",
    textStyle: { fontFamily: "Arial", fontSize: "9.5px", color: "#7F7F7F", alignment: "right", insets: 0 },
  });
}

function buildSlide5ZuoerP08Clone(pres) {
  const sl = pres.slides.add({ background: "#FFFFFF" });

  // Subtle geometric background accent lines + top-left black vertical bar + electric purple headline
  sl.shapes.add({
    geometry: "rect",
    position: { left: 16, top: 38, width: 5, height: 60 },
    fill: "#0F172A",
    line: "none",
  });
  sl.shapes.add({
    geometry: "rect",
    position: { left: 18, top: 0, width: 0.75, height: 270 },
    fill: "#CBD5E1",
    line: "none",
  });
  sl.shapes.add({
    geometry: "rect",
    position: { left: 1262, top: 0, width: 0.75, height: 720 },
    fill: "#CBD5E1",
    line: "none",
  });

  sl.shapes.add({
    position: { left: 44, top: 48, width: 920, height: 42 },
    text: "行业关键词趋势：功能——保湿和卸妆被提及频率最高",
    textStyle: { fontFamily: "PingFang SC", fontSize: "25px", bold: false, color: "#5500E6", insets: 0 },
  });

  // Top-right Zuoer brand mark (clean vector badge)
  sl.shapes.add({
    geometry: "diamond",
    position: { left: 1122, top: 42, width: 28, height: 32 },
    fill: "#0E7490",
    line: "none",
  });
  sl.shapes.add({
    position: { left: 1154, top: 42, width: 96, height: 34 },
    text: [
      { runs: [{ run: "卓尔数科", style: { fontSize: "15px", bold: true, color: "#0D9488" } }] },
      { runs: [{ run: "数据驱动商业增长", style: { fontSize: "7.5px", color: "#14B8A6" } }] },
    ],
    textStyle: { fontFamily: "PingFang SC", insets: 0 },
  });

  // --- LEFT SIDE: 6-Series Native `<c:lineChart>` (`2019/2 .. 2020/6`) ---
  sl.shapes.add({
    position: { left: 140, top: 128, width: 395, height: 26 },
    text: "美容护肤相关单品词语出现频率统计",
    textStyle: { fontFamily: "PingFang SC", fontSize: "15px", color: "#334155", alignment: "center", insets: 0 },
  });

  // Purple highlight band behind top "功能" line (`70%` zone, exact match to `ze1008-08.png`!)
  sl.shapes.add({
    geometry: "rect",
    position: { left: 110, top: 195, width: 438, height: 58 },
    fill: "#7C1FFF",
    line: "none",
  });

  const months = [
    "2019/2", "2019/3", "2019/4", "2019/5", "2019/6", "2019/7",
    "2019/8", "2019/9", "2019/10", "2019/11", "2019/12",
    "2020/1", "2020/2", "2020/3", "2020/4", "2020/5", "2020/6",
  ];

  sl.charts.add("line", {
    position: { left: 52, top: 160, width: 492, height: 505 },
    categories: months,
    series: [
      {
        name: "功能",
        values: [71.5, 71.5, 71.4, 71.4, 69.8, 69.2, 68.9, 68.8, 68.7, 68.6, 68.8, 68.9, 68.9, 68.8, 68.7, 68.5, 68.1],
        fill: "#60A5FA",
        lineWidth: 2.2,
      },
      {
        name: "适用人群",
        values: [46.2, 46.2, 46.1, 46.1, 42.5, 42.2, 41.9, 41.7, 41.5, 41.2, 41.1, 40.9, 40.8, 40.5, 40.2, 39.8, 39.4],
        fill: "#64748B",
        lineWidth: 2.2,
      },
      {
        name: "质量",
        values: [39.5, 39.5, 39.4, 39.4, 35.8, 35.9, 35.8, 35.7, 35.6, 35.6, 35.5, 35.5, 35.6, 35.7, 35.7, 35.4, 34.8],
        fill: "#8B7E8E",
        lineWidth: 2.2,
      },
      {
        name: "解决问题",
        values: [23.8, 23.8, 23.7, 23.7, 22.6, 22.6, 22.5, 22.5, 22.5, 22.5, 22.4, 22.4, 22.4, 22.3, 22.3, 22.2, 22.1],
        fill: "#4D9A9A",
        lineWidth: 2.2,
      },
      {
        name: "外观",
        values: [17.4, 17.4, 17.4, 17.4, 17.5, 17.5, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4, 17.4],
        fill: "#0284C7",
        lineWidth: 3.0,
      },
      {
        name: "成分",
        values: [10.6, 10.6, 10.6, 10.6, 10.5, 10.8, 11.0, 11.2, 11.4, 11.6, 11.8, 12.1, 12.3, 12.5, 12.6, 12.7, 12.8],
        fill: "#3B66A8",
        lineWidth: 2.2,
      },
    ],
    hasLegend: false,
    lineOptions: { markers: false, smooth: false },
    dataLabels: { showValue: false },
    xAxis: {
      labelRotation: -90,
      textStyle: { fontSize: "10px", color: "#334155" },
      lineColor: "#CBD5E1",
    },
    yAxis: {
      min: 0,
      max: 80,
      majorUnit: 10,
      numberFormatCode: '0"%"',
      textStyle: { fontSize: "10.5px", color: "#334155" },
      majorGridlines: { style: "solid", fill: "#F1F5F9", width: 0.75 },
    },
  });

  // Floating series label pills matching exact coordinates on `ze1008-08.png`
  const lineTags = [
    { text: "功能", left: 444, top: 216, width: 72, height: 23 },
    { text: "适用人群", left: 416, top: 356, width: 98, height: 23 },
    { text: "质量", left: 310, top: 386, width: 98, height: 23 },
    { text: "解决问题", left: 366, top: 450, width: 98, height: 23 },
    { text: "外观", left: 232, top: 475, width: 98, height: 23 },
    { text: "成分", left: 408, top: 501, width: 98, height: 23 },
  ];
  for (const tg of lineTags) {
    sl.shapes.add({
      geometry: "rect",
      position: tg,
      fill: "#E2E8F0",
      line: "none",
      text: tg.text,
      textStyle: {
        fontFamily: "PingFang SC",
        fontSize: "12.5px",
        color: "#1E293B",
        alignment: "center",
        verticalAlignment: "middle",
        insets: 0,
      },
    });
  }

  // --- RIGHT SIDE: Soft Shadow Card + TWO Native Horizontal Bar Charts (`<c:barChart>`) ---
  sl.shapes.add({
    geometry: "roundRect",
    borderRadius: 20,
    position: { left: 598, top: 112, width: 642, height: 582 },
    fill: "#FFFFFF",
    line: { style: "solid", fill: "#F1F5F9", width: 1 },
    shadow: "0px 6px 20px #0F172A/8",
  });

  // Purple header badges ("基础护肤" & "多样护肤")
  sl.shapes.add({
    geometry: "rect",
    position: { left: 718, top: 157, width: 126, height: 26 },
    fill: "#5500E6",
    line: "none",
    text: "基础护肤",
    textStyle: { fontFamily: "PingFang SC", fontSize: "14.5px", color: "#FFFFFF", alignment: "center", verticalAlignment: "middle", insets: 0 },
  });
  sl.shapes.add({
    geometry: "rect",
    position: { left: 1043, top: 157, width: 126, height: 26 },
    fill: "#5500E6",
    line: "none",
    text: "多样护肤",
    textStyle: { fontFamily: "PingFang SC", fontSize: "14.5px", color: "#FFFFFF", alignment: "center", verticalAlignment: "middle", insets: 0 },
  });

  // Horizontal Bar Chart 1: 基础护肤 (`保湿 237790 .. 修护 35442`)
  const basicCats = ["保湿", "补水", "滋润", "紧致", "控油", "清洁", "深层", "收缩", "修护"];
  const basicVals = [237790, 222624, 74761, 59946, 58059, 51161, 43021, 39346, 35442];
  sl.charts.add("horizontalBar", {
    position: { left: 645, top: 206, width: 265, height: 430 },
    categories: basicCats,
    series: [
      {
        name: "出现频次",
        values: basicVals,
        fill: "#C4C4C4",
        pointFills: basicCats.map((_, idx) => (idx === 0 ? "#5500E6" : "#C4C4C4")),
      },
    ],
    hasLegend: false,
    barOptions: { gapWidth: 95 },
    dataLabels: {
      showValue: true,
      position: "outEnd",
      textStyle: { fontSize: "10px", bold: false, color: "#334155" },
    },
    xAxis: {
      reverseOrder: true,
      textStyle: { fontSize: "11px", color: "#64748B" },
      lineColor: "#E2E8F0",
    },
    yAxis: {
      min: 0,
      max: 330000,
      hideAxis: true,
    },
  });

  // Horizontal Bar Chart 2: 多样护肤 (`卸妆 9909 .. 抗氧化 1008`)
  const diverseCats = [
    "卸妆", "免洗", "锁水", "弹润", "户外", "平衡", "精粹", "去角质",
    "防紫外线", "嫩肤", "三合一", "护理", "遮瑕", "睡眠", "抗氧化",
  ];
  const diverseVals = [
    9909, 7604, 6798, 5597, 5070, 5043, 5015, 4564,
    4391, 4229, 4180, 4167, 3528, 3478, 1008,
  ];
  sl.charts.add("horizontalBar", {
    position: { left: 952, top: 204, width: 268, height: 436 },
    categories: diverseCats,
    series: [
      {
        name: "出现频次",
        values: diverseVals,
        fill: "#C4C4C4",
        pointFills: diverseCats.map((_, idx) => (idx === 0 ? "#5500E6" : "#C4C4C4")),
      },
    ],
    hasLegend: false,
    barOptions: { gapWidth: 95 },
    dataLabels: {
      showValue: true,
      position: "outEnd",
      textStyle: { fontSize: "9.5px", bold: false, color: "#334155" },
    },
    xAxis: {
      reverseOrder: true,
      textStyle: { fontSize: "10.5px", color: "#64748B" },
      lineColor: "#E2E8F0",
    },
    yAxis: {
      min: 0,
      max: 14500,
      hideAxis: true,
    },
  });

  // Bottom-right data source note
  sl.shapes.add({
    position: { left: 938, top: 672, width: 255, height: 18 },
    text: "数据来源：卓尔数科大数据中心-天猫数据整理",
    textStyle: {
      fontFamily: "PingFang SC",
      fontSize: "8.5px",
      color: "#94A3B8",
      underline: true,
      alignment: "right",
      insets: 0,
    },
  });
}

async function buildPart3FromScratchDataClones() {
  const pres = Presentation.create({
    title: "Yuanmou M2 1:1 Native Table & Multi-Chart Clones",
    slideSize: { width: 1280, height: 720 },
    defaultFont: "PingFang SC",
  });

  buildSlide4BcgP12Clone(pres);
  buildSlide5ZuoerP08Clone(pres);

  const outPptx = path.join(OUT_DIR, "yuanmou_m2_part3_1to1_data_clones.pptx");
  const exported = await PresentationFile.exportPptx(pres);
  await exported.save(outPptx);
  return { outPptx };
}

// ============================================================================
// Verify Embedded `.xlsx` Workbooks & Round-Trip `Presentation.load()`
// ============================================================================
async function verifyRoundTripAndEmbeddedXlsx(pptxPaths) {
  const stats = [];
  for (const p of pptxPaths) {
    const buf = await fs.readFile(p);
    const zipEntries = readZipBuffer(buf);
    const chartParts = [...zipEntries.keys()].filter((k) => /^ppt\/charts\/.*\.xml$/.test(k));
    const xlsxParts = [...zipEntries.keys()].filter((k) => /^ppt\/embeddings\/.*\.xlsx$/.test(k));

    // Verify every embedded `.xlsx` is itself a valid OpenXML ZIP containing `xl/worksheets/sheet1.xml`!
    for (const xp of xlsxParts) {
      const inner = readZipBuffer(zipEntries.get(xp));
      if (!inner.has("xl/worksheets/sheet1.xml") || !inner.has("xl/workbook.xml")) {
        throw new Error(`Invalid embedded workbook ${xp} in ${p}`);
      }
    }

    const reloaded = await Presentation.load(p);
    const insp = await reloaded.inspect();
    stats.push({
      file: path.basename(p),
      bytes: buf.length,
      slides: reloaded.slides.count,
      charts: chartParts.length,
      embeddedXlsx: xlsxParts.length,
      totalElements: insp.records.reduce((acc, r) => acc + r.elements.length, 0),
    });
  }
  return stats;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const pngDir = path.join(OUT_DIR, "rendered");
  await fs.mkdir(pngDir, { recursive: true });

  console.log("[1/4] Running Part 1 (.pptx Surgical Suite on 5012 S10 & S12)...");
  const p1 = await buildPart1SurgicalDeck();

  console.log("[2/4] Running Part 2 (Hybrid Surgery + Native .xlsx Charts & Merged <a:tbl> on 5011 S25)...");
  const p2 = await buildPart2HybridDataDeck();

  console.log("[3/4] Running Part 3 (1:1 Native <a:tbl> & Multi-Chart Clones of BCG 1016 P12 & Zuoer 1008 P8)...");
  const p3 = await buildPart3FromScratchDataClones();

  console.log("[4/4] Verifying embedded .xlsx workbooks, round-trip Presentation.load(), and rendering 240DPI PNGs...");
  const rtStats = await verifyRoundTripAndEmbeddedXlsx([p1.outPptx, p2.outPptx, p3.outPptx]);
  console.log("Round-trip & XLSX stats:", JSON.stringify(rtStats, null, 2));

  const r1 = await renderDeckToPngs(p1.outPptx, { outDir: pngDir, prefix: "m2_p1_surgical", dpi: 216 });
  const r2 = await renderDeckToPngs(p2.outPptx, { outDir: pngDir, prefix: "m2_p2_hybrid", dpi: 216 });
  const r3 = await renderDeckToPngs(p3.outPptx, { outDir: pngDir, prefix: "m2_p3_clones", dpi: 216 });

  console.log("Rendered PNGs:", {
    part1: r1.pngFiles,
    part2: r2.pngFiles,
    part3: r3.pngFiles,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
