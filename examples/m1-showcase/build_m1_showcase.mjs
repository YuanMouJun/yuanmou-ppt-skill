// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Presentation,
  PresentationFile,
  row,
  col,
  grid,
  box,
  paragraph,
  run,
  rule,
  makeBulletList,
  renderDeckToPngs,
  buildShowcaseGalleryHtml,
} from "../../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");
const ROOT_WORKSPACE = path.resolve(__dirname, "../../../..");
const SEED_SLICE_1 = path.join(ROOT_WORKSPACE, "assets/seed_slices/v1_p1_s1.png");
const SEED_SLICE_2 = path.join(ROOT_WORKSPACE, "assets/seed_slices/v1_p1_s2.png");

function addConsultingHeader(slide, { category, title, metricTag }) {
  // Top brand accent bar (flush sharp right-angle, zero AI pill)
  const brandPlate = slide.shapes.add({
    geometry: "rect",
    name: "brand-plate",
    position: { left: 56, top: 34, width: 112, height: 28 },
    fill: "#7F1D1D",
    line: { style: "solid", fill: "none", width: 0 },
  });
  brandPlate.text = "渊眸策略";
  brandPlate.text.style = {
    fontSize: 13,
    bold: true,
    color: "#FDE68A",
    alignment: "center",
    verticalAlignment: "middle",
    insets: 0,
  };

  const catLabel = slide.shapes.add({
    geometry: "textbox",
    name: "header-category",
    position: { left: 180, top: 34, width: 620, height: 28 },
    fill: "none",
  });
  catLabel.text = category;
  catLabel.text.style = {
    fontSize: 14,
    bold: true,
    color: "#0F3A7D",
    verticalAlignment: "middle",
  };

  if (metricTag) {
    const tagBox = slide.shapes.add({
      geometry: "rect",
      name: "header-metric",
      position: { left: 940, top: 34, width: 284, height: 28 },
      fill: "#F1F5F9",
      line: { style: "solid", fill: "none", width: 0 },
    });
    tagBox.text = metricTag;
    tagBox.text.style = {
      fontSize: 13,
      bold: true,
      color: "#334155",
      alignment: "center",
      verticalAlignment: "middle",
      insets: { top: 2, bottom: 2, left: 10, right: 10 },
    };
  }

  const h1 = slide.shapes.add({
    geometry: "textbox",
    name: "slide-main-title",
    position: { left: 56, top: 68, width: 1168, height: 46 },
    fill: "none",
  });
  h1.text = title;
  h1.text.style = {
    fontSize: "24pt",
    bold: true,
    color: "#0F172A",
    verticalAlignment: "middle",
  };

  slide.shapes.add({
    geometry: "line",
    name: "header-divider",
    position: { left: 56, top: 122, width: 1168, height: 0 },
    line: { style: "solid", fill: "#CBD5E1", width: 1.5 },
  });
}

function addSlideFooter(slide, pageNo, sourceNote) {
  slide.shapes.add({
    geometry: "line",
    name: "footer-rule",
    position: { left: 56, top: 676, width: 1168, height: 0 },
    line: { style: "solid", fill: "#E2E8F0", width: 1 },
  });

  const src = slide.shapes.add({
    geometry: "textbox",
    name: "footer-source",
    position: { left: 56, top: 684, width: 960, height: 22 },
  });
  src.text = sourceNote;
  src.text.style = { fontSize: 12, color: "#64748B", verticalAlignment: "middle" };

  const pg = slide.shapes.add({
    geometry: "textbox",
    name: "footer-folio",
    position: { left: 1120, top: 684, width: 104, height: 22 },
  });
  pg.text = `${pageNo}`;
  pg.text.style = {
    fontSize: 12,
    bold: true,
    color: "#475569",
    alignment: "right",
    verticalAlignment: "middle",
  };
}

async function main() {
  const deck = Presentation.create({
    title: "渊眸策略 · @yuanmou/pptx-kit M1 核心军火库实机验收",
    slideSize: { width: 1280, height: 720 },
    defaultFont: "Microsoft YaHei",
  });

  // =========================================================================
  // SLIDE 1: 战略屋架构页 — 压测 `slide.compose` 流式布局 + 渐变色带 + 单图形富文本 + 真悬挂列表
  // =========================================================================
  const s1 = deck.slides.add({ background: "#FFFFFF" });
  addConsultingHeader(s1, {
    category: "年度增长战略总纲 · 架构模型",
    title: "新消费品牌小红书全域「种收一体」战略增长屋",
    metricTag: "核心目标：品牌搜索率提升 180%",
  });

  s1.compose(
    col(
      { width: "fill", height: "fill", gap: 16 },
      // 顶层：战略北极星（渐变实色块直接承载双行富文本）
      box(
        {
          name: "north-star-roof",
          width: "fill",
          height: 78,
          fill: "linear(135deg, #0F3A7D 0%, #1E4E9E 65%, #0369A1 100%)",
          padding: { top: 12, bottom: 12, left: 28, right: 28 },
          justify: "center",
        },
        paragraph(
          { style: { fontSize: 21, bold: true, color: "#FFFFFF", alignment: "center" } },
          "年度北极星：从单点爆文采买转向「核心人群资产沉淀 + 搜索首屏高转化截流」"
        ),
        paragraph(
          { style: { fontSize: 14, color: "#BAE6FD", alignment: "center" }, spaceBefore: 400 },
          "预算分配基准：品牌曝光 25%   /   精准达人种草 58%   /   搜索与店铺阵地承接 17%"
        )
      ),

      // 中层：三大核心支柱（`width="fill"` 自动精确三等分，高度自适应撑满）
      row(
        { width: "fill", height: "fill", gap: 18, align: "stretch" },
        ...[
          {
            code: "支柱一 · 人群与货盘匹配",
            accent: "#0F3A7D",
            bg: "#F8FAFC",
            headline: "痛点场景反推三级货品矩阵",
            points: [
              "刚需破圈款：主攻高频除菌与去渍痛点，承接泛年轻白领首单转化",
              "趋势利润款：围绕精致洗护与留香体验，锁定高客单品质生活人群",
              "节点礼盒款：绑定换季与大促脉冲，拉升老客复购与连带客单价",
            ],
          },
          {
            code: "支柱二 · KFS 科学投放模型",
            accent: "#7F1D1D",
            bg: "#FAF8F6",
            headline: "钻石型达人矩阵协同信息流放大",
            points: [
              "KOL 头部造势（20%）：垂直护肤与测评博主建立专业成分背书",
              "KOC 腰尾铺量（50%）：真实居家场景高频实测，覆盖长尾痛点词",
              "Feeds + Search（30%）：赛马筛选高赞笔记追投聚光，抢占品类词前三位",
            ],
          },
          {
            code: "支柱三 · 阵地闭环与复盘",
            accent: "#0F766E",
            bg: "#F4FBF9",
            headline: "搜索结果页卡位与回搜率追踪",
            points: [
              "品牌专区与置顶笔记联动，承接达人种草溢出的主动回搜流量",
              "直播间切片与商详页卖点口径统一，缩短从看笔记到下单路径",
              "按周监控 CPC、CPUV 与进店回搜率，动态淘汰低效垂类词包",
            ],
          },
        ].map((pillar, idx) =>
          col(
            { width: "fill", height: "fill", gap: 0 },
            box(
              {
                name: `pillar-head-${idx + 1}`,
                width: "fill",
                height: 40,
                fill: pillar.accent,
                padding: { left: 16, right: 16, top: 8, bottom: 8 },
                justify: "center",
              },
              paragraph(
                { style: { fontSize: 15, bold: true, color: "#FFFFFF" } },
                pillar.code
              )
            ),
            box(
              {
                name: `pillar-body-${idx + 1}`,
                width: "fill",
                height: "fill",
                fill: pillar.bg,
                line: { style: "solid", fill: "#E2E8F0", width: 1 },
                padding: { top: 16, bottom: 16, left: 18, right: 18 },
              },
              paragraph(
                { style: { fontSize: 18, bold: true, color: "#0F172A" }, spaceAfter: 800 },
                pillar.headline
              ),
              ...makeBulletList(pillar.points, {
                marginLeftPoints: 15,
                hangingPoints: 10,
                spaceAfterPoints: 8,
                bulletCharacter: "▪",
                bulletColor: pillar.accent,
              }).map((bp) =>
                paragraph(
                  {
                    bulletCharacter: bp.bulletCharacter,
                    bulletColor: bp.bulletColor,
                    marginLeft: bp.marginLeft,
                    indent: bp.indent,
                    spaceAfter: bp.spaceAfter,
                    style: { fontSize: 14.5, color: "#334155", lineSpacing: 1.38 },
                  },
                  bp.runs[0]
                )
              )
            )
          )
        )
      ),

      // 底层：双基座支撑
      row(
        { width: "fill", height: 64, gap: 18, align: "stretch" },
        box(
          {
            name: "foundation-content",
            width: "fill",
            height: "fill",
            fill: "#1E293B",
            padding: { left: 22, right: 22, top: 10, bottom: 10 },
            justify: "center",
          },
          paragraph(
            { style: { fontSize: 15, bold: true, color: "#FACC15" } },
            "内容中台基座：标准化高赞视觉母版库 + 卖点合规门禁词典"
          )
        ),
        box(
          {
            name: "foundation-data",
            width: "fill",
            height: "fill",
            fill: "#1E293B",
            padding: { left: 22, right: 22, top: 10, bottom: 10 },
            justify: "center",
          },
          paragraph(
            { style: { fontSize: 15, bold: true, color: "#38BDF8" } },
            "数据度量基座：阅读渗透率 × 品类词SOV × 自然回搜GMV归因"
          )
        )
      )
    ),
    { frame: { left: 56, top: 140, width: 1168, height: 518 } }
  );

  addSlideFooter(
    s1,
    1,
    "数据与模型来源：渊眸策略《2026 快消个护社媒种草方法论》｜ 引擎验证：compose 流式布局 + 单节点富文本 + 原生悬挂缩进"
  );

  // =========================================================================
  // SLIDE 2: 复杂贝塞尔矢量曲线 + SVG 路径直转 `<a:custGeom>` + 智能锚点连接线
  // =========================================================================
  const s2 = deck.slides.add({ background: "#FFFFFF" });
  addConsultingHeader(s2, {
    category: "核心投放模型 · 矢量曲线与连接符验证",
    title: "反漏斗人群破圈：从核心痛点引爆到泛人群跃迁",
    metricTag: "100% 原生可编辑矢量对象",
  });

  // 背景氛围柔光椭圆 (压测 `softEdge` 柔光与半透明渐变，拒绝生硬色块)
  s2.shapes.add({
    geometry: "ellipse",
    name: "ambient-glow",
    position: { left: 132, top: 175, width: 450, height: 420 },
    fill: "radial(#DBEAFE/75 0%, #EFF6FF/35 55%, #FFFFFF/0 100%)",
    line: { style: "solid", fill: "none", width: 0 },
    softEdge: 24,
  });

  // 左侧独立跃迁轨：压测 SVG `d="..."` 路径直转 `<a:custGeom>` 上扬渐窄大箭头（与右侧连线零交叉！）
  s2.shapes.add({
    geometry: "custom",
    name: "tapered-growth-arrow",
    position: { left: 56, top: 186, width: 54, height: 396 },
    fill: "linear(0deg, #F59E0B/20 0%, #D97706 100%)",
    line: { style: "solid", fill: "none", width: 0 },
    viewBox: { width: 60, height: 390 },
    svgPath:
      "M 24 390 C 20 270 18 160 18 52 L 4 52 L 30 0 L 56 52 L 42 52 C 42 160 40 270 36 390 Z",
  });

  const railCaption = s2.shapes.add({
    geometry: "textbox",
    name: "growth-rail-caption",
    position: { left: 44, top: 590, width: 78, height: 36 },
  });
  railCaption.text = "声量破圈";
  railCaption.text.style = {
    fontSize: 12.5,
    bold: true,
    color: "#B45309",
    alignment: "center",
    verticalAlignment: "middle",
  };

  // 自定义三次贝塞尔收腰曲面三层漏斗/金字塔 (`customPaths` -> `<a:custGeom>`)
  const funnelLayers = [
    {
      name: "funnel-tier-1",
      top: 176,
      height: 126,
      fill: "linear(90deg, #7F1D1D 0%, #991B1B 100%)",
      cmds: [
        { moveTo: { x: 64, y: 0 } },
        { lineTo: { x: 356, y: 0 } },
        { cubicBezTo: { x1: 368, y1: 48, x2: 386, y2: 88, x: 400, y: 126 } },
        { lineTo: { x: 20, y: 126 } },
        { cubicBezTo: { x1: 34, y1: 88, x2: 52, y2: 48, x: 64, y: 0 } },
        { close: {} },
      ],
      label: "第一层：高净值种子人群（15%）",
      sub: "重度成分党与精细护肤人群精准击穿",
    },
    {
      name: "funnel-tier-2",
      top: 314,
      height: 132,
      fill: "linear(90deg, #0F3A7D 0%, #1D4ED8 100%)",
      cmds: [
        { moveTo: { x: 28, y: 0 } },
        { lineTo: { x: 412, y: 0 } },
        { cubicBezTo: { x1: 424, y1: 45, x2: 434, y2: 92, x: 440, y: 132 } },
        { lineTo: { x: 0, y: 132 } },
        { cubicBezTo: { x1: 6, y1: 92, x2: 16, y2: 45, x: 28, y: 0 } },
        { close: {} },
      ],
      label: "第二层：场景痛点关联人群（35%）",
      sub: "熬夜急救、换季暗沉、职场通勤跨界渗透",
    },
    {
      name: "funnel-tier-3",
      top: 458,
      height: 136,
      fill: "linear(90deg, #0F766E 0%, #0D9488 100%)",
      cmds: [
        { moveTo: { x: 16, y: 0 } },
        { lineTo: { x: 454, y: 0 } },
        { cubicBezTo: { x1: 464, y1: 52, x2: 470, y2: 98, x: 470, y: 136 } },
        { lineTo: { x: 0, y: 136 } },
        { cubicBezTo: { x1: 0, y1: 98, x2: 6, y2: 52, x: 16, y: 0 } },
        { close: {} },
      ],
      label: "第三层：大众囤货泛人群（50%）",
      sub: "大促直播间心智收割与正装礼盒复购",
    },
  ];

  const leftFunnelShapes = funnelLayers.map((tier, idx) => {
    const w = idx === 0 ? 420 : idx === 1 ? 440 : 470;
    const x = idx === 0 ? 148 : idx === 1 ? 138 : 123;
    const sp = s2.shapes.add({
      geometry: "custom",
      name: tier.name,
      position: { left: x, top: tier.top, width: w, height: tier.height },
      fill: tier.fill,
      line: { style: "solid", fill: "#FFFFFF", width: 2 },
      shadow: "shadow-sm",
      customPaths: [{ width: w, height: tier.height, commands: tier.cmds }],
    });
    sp.text.set([
      [{ run: tier.label, style: { fontSize: 16.5, bold: true, color: "#FFFFFF" } }],
      {
        spaceBefore: 300,
        runs: [{ run: tier.sub, style: { fontSize: 13.5, color: "#E2E8F0" } }],
      },
    ]);
    sp.text.style = {
      alignment: "center",
      verticalAlignment: "middle",
      insets: { top: 10, bottom: 10, left: 48, right: 48 },
    };
    return sp;
  });

  // 右侧三张策略执行动作节点 + 原生智能连接符 (`slide.shapes.connect`)
  const actionSpecs = [
    {
      top: 182,
      border: "#7F1D1D",
      badgeBg: "#FEF2F2",
      title: "阶段 01 ｜ 高浓度口碑打样（冷启动 1-4 周）",
      body: "严选 30 位垂类成分实测达人产出硬核对比笔记，沉淀首批高互动评论区问答，跑通单篇自然阅读成本 ≤ 0.45 元。",
    },
    {
      top: 324,
      border: "#0F3A7D",
      badgeBg: "#EFF6FF",
      title: "阶段 02 ｜ 多场景跨界放量（爬坡期 5-8 周）",
      body: "切入养宠、母婴、健身三大高增长细分场景，用聚光信息流对前 15% 高点击率笔记阶梯追投，抢占品类长尾搜索词。",
    },
    {
      top: 468,
      border: "#0F766E",
      badgeBg: "#ECFDF5",
      title: "阶段 03 ｜ 搜索卡位与大促脉冲（爆发期 9-12 周）",
      body: "联动品牌专区首屏卡片与店播专场福利，将前期积累的 A3 种草人群高效转化为进店搜索与成交资产。",
    },
  ];

  const rightActionShapes = actionSpecs.map((act, idx) => {
    const card = s2.shapes.add({
      geometry: "roundRect",
      name: `action-node-${idx + 1}`,
      position: { left: 646, top: act.top, width: 578, height: 114 },
      fill: act.badgeBg,
      line: { style: "solid", fill: act.border, width: 1.5 },
      borderRadius: 10,
    });
    card.text.set([
      [{ run: act.title, style: { fontSize: 16.5, bold: true, color: act.border } }],
      {
        spaceBefore: 500,
        runs: [{ run: act.body, style: { fontSize: 14, color: "#1E293B" } }],
      },
    ]);
    card.text.style = {
      alignment: "left",
      verticalAlignment: "middle",
      lineSpacing: 1.35,
      insets: { top: 12, bottom: 12, left: 20, right: 20 },
    };
    return card;
  });

  // 连接左漏斗与右执行节点，以及右侧节点间的递进箭头
  for (let i = 0; i < 3; i++) {
    s2.shapes.connect(leftFunnelShapes[i], rightActionShapes[i], {
      kind: "straight",
      fromSide: "right",
      toSide: "left",
      line: { style: "dashed", fill: "#64748B", width: 1.5 },
      tail: { type: "triangle", width: "med", length: "med" },
    });
  }
  s2.shapes.connect(rightActionShapes[0], rightActionShapes[1], {
    kind: "straight",
    fromSide: "bottom",
    toSide: "top",
    line: { style: "solid", fill: "#94A3B8", width: 2 },
    tail: { type: "arrow", width: "med", length: "med" },
  });
  s2.shapes.connect(rightActionShapes[1], rightActionShapes[2], {
    kind: "straight",
    fromSide: "bottom",
    toSide: "top",
    line: { style: "solid", fill: "#94A3B8", width: 2 },
    tail: { type: "arrow", width: "med", length: "med" },
  });

  addSlideFooter(
    s2,
    2,
    "模型验证：三次贝塞尔 customPaths 曲面漏斗 + SVG Path 直转 <a:custGeom> 渐窄箭头 + 原生 <p:cxnSp> 连接符"
  );

  // =========================================================================
  // SLIDE 3: 12列 Grid 栅格跨列排版 + 真实高清原案切片 (`contain` & `cover` + 蒙版)
  // =========================================================================
  const s3 = deck.slides.add({ background: "#FFFFFF" });
  addConsultingHeader(s3, {
    category: "标杆专案实证 · 12栅格与高清图像管线验证",
    title: "护肤大单品 VC 精华破圈案：人群心智重塑与四阶 KFS 投放落位",
    metricTag: "大牌美妆实战专案实证页",
  });

  s3.compose(
    grid(
      {
        columns: 12,
        rows: [{ mode: "fr", value: 1 }, { mode: "fr", value: 1 }],
        columnGap: 20,
        rowGap: 16,
      },
      // 左上 (7列宽): 真实原案切片 1
      box(
        {
          columnSpan: 7,
          rowSpan: 1,
          fill: "#F8FAFC",
          line: { style: "solid", fill: "#CBD5E1", width: 1 },
          padding: 8,
        },
        {
          __yuanmouNode: true,
          type: "image",
          props: {
            path: SEED_SLICE_1,
            fit: "contain",
            alt: "人群心智纠偏与破圈策略切片",
          },
          children: [],
        }
      ),

      // 右上 + 右下合并 (5列宽 × 2行高!): 战果指标与策略提炼面板
      col(
        { columnSpan: 5, rowSpan: 2, gap: 14 },
        // 关键指标 2列数字卡
        row(
          { width: "fill", height: 108, gap: 14, align: "stretch" },
          box(
            {
              width: "fill",
              height: "fill",
              fill: "#0F3A7D",
              padding: { top: 14, bottom: 12, left: 18, right: 18 },
              justify: "center",
            },
            paragraph(
              { style: { fontSize: 13, color: "#BAE6FD", bold: true } },
              "高端美白精华单品心智"
            ),
            paragraph(
              { style: { fontSize: 30, color: "#FACC15", bold: true }, spaceBefore: 300 },
              "TOP 2"
            )
          ),
          box(
            {
              width: "fill",
              height: "fill",
              fill: "#7F1D1D",
              padding: { top: 14, bottom: 12, left: 18, right: 18 },
              justify: "center",
            },
            paragraph(
              { style: { fontSize: 13, color: "#FECACA", bold: true } },
              "H2 品牌预算环比增长"
            ),
            paragraph(
              { style: { fontSize: 30, color: "#FDE68A", bold: true }, spaceBefore: 300 },
              "+181%"
            )
          )
        ),

        // 深度复盘结论框
        box(
          {
            width: "fill",
            height: "fill",
            fill: "#F8FAFC",
            line: { style: "solid", fill: "#CBD5E1", width: 1 },
            padding: { top: 18, bottom: 18, left: 20, right: 20 },
          },
          paragraph(
            { style: { fontSize: 18, bold: true, color: "#0F172A" }, spaceAfter: 800 },
            "专案破局三大关键动作拆解"
          ),
          ...makeBulletList(
            [
              "扭转泛曝光剪刀差：针对前期泛化种草导致品牌心智稀释问题，锚定医美级成分党、美研尖子生与产后焕新妈妈重构高净值人群底盘。",
              "明星立人设 + 专业背书攻守兼备：借势代言人坚韧女性形象撬动大众关注，同步由成分权威背书与场景实测完成深层种草。",
              "Level 1-4 精细化进阶：从 UGC/KOC 自然内容赛马测品，到高赞笔记信息流放大与搜索词攻守拦截，打通新品 0-1 到爆品拓新全链路。",
            ],
            {
              marginLeftPoints: 16,
              hangingPoints: 10,
              spaceAfterPoints: 10,
              bulletCharacter: "●",
              bulletColor: "#7F1D1D",
            }
          ).map((bp) =>
            paragraph(
              {
                bulletCharacter: bp.bulletCharacter,
                bulletColor: bp.bulletColor,
                marginLeft: bp.marginLeft,
                indent: bp.indent,
                spaceAfter: bp.spaceAfter,
                style: { fontSize: 14, color: "#334155", lineSpacing: 1.42 },
              },
              bp.runs[0]
            )
          )
        )
      ),

      // 左下 (7列宽): 真实原案切片 2
      box(
        {
          columnSpan: 7,
          rowSpan: 1,
          fill: "#F8FAFC",
          line: { style: "solid", fill: "#CBD5E1", width: 1 },
          padding: 8,
        },
        {
          __yuanmouNode: true,
          type: "image",
          props: {
            path: SEED_SLICE_2,
            fit: "contain",
            alt: "KFS投放漏斗与排期切片",
          },
          children: [],
        }
      )
    ),
    { frame: { left: 56, top: 140, width: 1168, height: 518 } }
  );

  addSlideFooter(
    s3,
    3,
    "资产锚点：渊眸·品牌策划方案库【5001】｜ 引擎验证：12列 Grid 跨行跨列解算 + 真实高清原案切片无损嵌入"
  );

  // 导出 PPTX + 无头渲染 250DPI PNG + 生成交互式验收画廊 HTML
  const outPptx = path.join(OUT_DIR, "yuanmou_m1_showcase.pptx");
  const exported = await PresentationFile.exportPptx(deck);
  await exported.save(outPptx);

  const inspectResult = await deck.inspect();
  console.log(`✅ Exported PPTX: ${outPptx} (${exported.bytes.length} bytes, ${inspectResult.recordCount} slides)`);

  const renderRes = await renderDeckToPngs(outPptx, {
    outDir: path.join(OUT_DIR, "png"),
    prefix: "m1_slide",
    dpi: 240,
  });
  console.log(`✅ Rendered ${renderRes.pngFiles.length} PNG slides:`, renderRes.pngFiles);

  const galleryPath = await buildShowcaseGalleryHtml({
    title: "渊眸策略 · @yuanmou/pptx-kit M1 核心引擎真机渲染验收",
    subtitle:
      "零 OpenAI 私有依赖 ｜ 零第三方 npm 依赖 ｜ 100% 原生可编辑 OOXML 对象（战略屋流式布局 + 贝塞尔曲面漏斗 + SVG 矢量箭头 + 12栅格图文实证）",
    pptxPath: outPptx,
    outHtmlPath: path.join(OUT_DIR, "m1_acceptance_gallery.html"),
    slides: [
      {
        title: "战略增长屋（compose 流式布局 + 单图形富文本 + 原生悬挂列表）",
        description:
          "测试武器 01/02/03/04：顶部多色标线性渐变色带直接承载双字号富文本，中层三支柱 width='fill' 自动均分且同一矩形承载标题与项目符号，无任何底色框叠字框反模式。",
        weapons: ["武器01 像素/EMU双轨", "武器02 compose流式布局", "武器03 线性渐变Token", "武器04 单图形富文本+真列表"],
        pngPath: renderRes.pngFiles[0],
      },
      {
        title: "反漏斗跃迁模型（三次贝塞尔曲线 + SVG 路径直转 custGeom + 智能连接线）",
        description:
          "测试武器 03/05：左侧三层收腰曲面漏斗由 cubicBezTo 原生构建并叠加径向柔光椭圆（softEdge），中部上扬渐窄箭头由标准 SVG Path 直接编译为可编辑矢量，左右通过原生连接符吸附串联。",
        weapons: ["武器05 三次贝塞尔customPaths", "武器05 SVG转custGeom", "武器05 智能连接符cxnSp", "武器03 径向渐变+柔光"],
        pngPath: renderRes.pngFiles[1],
      },
      {
        title: "标杆专案实证页（12栅格跨行跨列 + 高清切片无损等比排布）",
        description:
          "测试武器 02/06：采用 12 列 Grid（左 7 列上下双切片 + 右 5 列跨 2 行指标与复盘卡），纯 JS 解析 PNG IHDR 宽高并精确计算等比缩放坐标，画面锐利零拉伸。",
        weapons: ["武器02 12列Grid跨行跨列", "武器06 纯JS图像解析+等比缩放", "武器20 咨询级反UI面板风"],
        pngPath: renderRes.pngFiles[2],
      },
    ],
  });
  console.log(`✅ Built HTML Acceptance Gallery: ${galleryPath}`);
}

main().catch((err) => {
  console.error("❌ M1 Showcase failed:", err);
  process.exit(1);
});
