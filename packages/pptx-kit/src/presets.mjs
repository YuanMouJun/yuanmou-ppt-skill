// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Route 1 Standalone Engine: 12 Consulting-Grade Native Layout Skeletons (`presets.mjs`)

import { Presentation } from "./presentation.mjs";
import { fr, fixed } from "./tables.mjs";
import { makeBulletList } from "./richtext.mjs";
import { BUILTIN_SKELETON_CATALOG } from "./providers/local-provider.mjs";

export const DEFAULT_CONSULTING_PALETTE = Object.freeze({
  primary: "#0F3A7D",
  secondary: "#0D9488",
  accent: "#D97706",
  ink: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  surface: "#F8FAFC",
  tint: "#EFF6FF",
  border: "#E2E8F0",
  bg: "#FFFFFF",
});

function addEditorialHeader(slide, { tag, title, subtitle, pageNo }, pal) {
  // Top-left crisp accent bar (never SaaS pill badge!)
  slide.shapes.add({
    geometry: "rect",
    position: { left: 56, top: 42, width: 6, height: 42 },
    fill: pal.primary,
    line: "none",
  });
  if (tag) {
    slide.shapes.add({
      position: { left: 74, top: 36, width: 360, height: 18 },
      text: String(tag).toUpperCase(),
      textStyle: { fontSize: 10.5, bold: true, color: pal.secondary, letterSpacing: 1.2 },
    });
  }
  slide.shapes.add({
    position: { left: 74, top: tag ? 54 : 42, width: 1120, height: 38 },
    text: title || "核心业务判断直指增长杠杆",
    textStyle: { fontSize: 24, bold: true, color: pal.ink },
  });
  if (subtitle) {
    slide.shapes.add({
      position: { left: 74, top: 94, width: 1120, height: 24 },
      text: subtitle,
      textStyle: { fontSize: 13.5, color: pal.muted },
    });
  }
  slide.shapes.add({
    geometry: "rect",
    position: { left: 56, top: subtitle ? 124 : 102, width: 1168, height: 1 },
    fill: pal.border,
    line: "none",
  });
  if (pageNo !== undefined) {
    slide.shapes.add({
      position: { left: 1180, top: 682, width: 44, height: 18 },
      text: String(pageNo),
      textStyle: { fontSize: 10, color: pal.muted, alignment: "right" },
    });
  }
}

function addTakeawayBar(slide, text, pal, top = 626) {
  if (!text) return;
  slide.shapes.add({
    geometry: "rect",
    position: { left: 56, top, width: 1168, height: 44 },
    fill: pal.tint,
    line: { style: "solid", fill: pal.border, width: 1 },
  });
  slide.shapes.add({
    geometry: "rect",
    position: { left: 56, top, width: 5, height: 44 },
    fill: pal.primary,
    line: "none",
  });
  slide.shapes.add({
    position: { left: 74, top: top + 10, width: 1134, height: 24 },
    text,
    textStyle: { fontSize: 13.5, bold: true, color: pal.primary },
  });
}

/**
 * Populates a `Slide` using one of the 12 built-in consulting layout skeletons (`presetId`).
 */
export function applyPresetSlide(slide, presetId, data = {}, paletteOverrides = {}) {
  const pal = { ...DEFAULT_CONSULTING_PALETTE, ...paletteOverrides };
  slide.background.fill = pal.bg;

  switch (presetId) {
    case "ym-cover-editorial": {
      slide.shapes.add({
        geometry: "rect",
        position: { left: 0, top: 0, width: 42, height: 720 },
        fill: pal.primary,
        line: "none",
      });
      slide.shapes.add({
        geometry: "rect",
        position: { left: 820, top: 0, width: 460, height: 720 },
        fill: `linear(145deg, ${pal.primary} 0%, #1E293B 100%)`,
        line: "none",
      });
      slide.shapes.add({
        position: { left: 96, top: 170, width: 660, height: 28 },
        text: data.kicker || "STRATEGIC GROWTH PROPOSAL · 2026",
        textStyle: { fontSize: 13, bold: true, color: pal.secondary, letterSpacing: 1.5 },
      });
      slide.shapes.add({
        position: { left: 96, top: 214, width: 670, height: 130 },
        text: data.title || "全域社媒内容种草与\n商业化增长年度策略全案",
        textStyle: { fontSize: 38, bold: true, color: pal.ink, lineSpacing: 1.22 },
      });
      slide.shapes.add({
        position: { left: 96, top: 368, width: 640, height: 64 },
        text: data.subtitle || "以高转化人群资产反推货盘矩阵与投放脉冲，构建可度量单店核销增长模型",
        textStyle: { fontSize: 16.5, color: pal.body, lineSpacing: 1.4 },
      });
      slide.shapes.add({
        geometry: "rect",
        position: { left: 96, top: 556, width: 120, height: 3 },
        fill: pal.accent,
        line: "none",
      });
      slide.shapes.add({
        position: { left: 96, top: 576, width: 520, height: 48 },
        text: data.meta || "汇报团队：品牌策略部  |  2026 Q4",
        textStyle: { fontSize: 13, color: pal.muted },
      });
      // Right visual metric highlight on dark panel
      const highlights = data.highlights || [
        { kpi: "+168%", label: "核心品类社媒搜索同比增速" },
        { kpi: "4.3x", label: "双高峰脉冲投放目标综合 ROI" },
      ];
      highlights.slice(0, 2).forEach((hItem, i) => {
        const y = 220 + i * 165;
        slide.shapes.add({
          geometry: "rect",
          position: { left: 876, top: y, width: 348, height: 128 },
          fill: "#FFFFFF/10",
          line: { style: "solid", fill: "#FFFFFF/22", width: 1 },
        });
        slide.shapes.add({
          position: { left: 900, top: y + 20, width: 300, height: 52 },
          text: hItem.kpi,
          textStyle: { fontSize: 36, bold: true, color: "#FFFFFF" },
        });
        slide.shapes.add({
          position: { left: 900, top: y + 78, width: 300, height: 28 },
          text: hItem.label,
          textStyle: { fontSize: 13.5, color: "#CBD5E1" },
        });
      });
      break;
    }

    case "ym-toc-4part": {
      slide.shapes.add({
        geometry: "rect",
        position: { left: 0, top: 0, width: 380, height: 720 },
        fill: pal.primary,
        line: "none",
      });
      slide.shapes.add({
        position: { left: 56, top: 240, width: 280, height: 36 },
        text: "AGENDA",
        textStyle: { fontSize: 14, bold: true, color: "#93C5FD", letterSpacing: 2 },
      });
      slide.shapes.add({
        position: { left: 56, top: 280, width: 280, height: 80 },
        text: data.title || "核心章节议程",
        textStyle: { fontSize: 34, bold: true, color: "#FFFFFF" },
      });
      const sections = data.sections || [
        { no: "01", title: "赛道格局与核心人群洞察", desc: "拆解头部与新锐品牌声量迁移及三大消费圈层诉求" },
        { no: "02", title: "爆品货盘与差异化卖点锚定", desc: "围绕高频消费场景重构尖刀品、利润品与联名礼盒" },
        { no: "03", title: "双高峰内容种草与达人矩阵", desc: "金字塔达人配比与黄金时段脉冲投流节奏" },
        { no: "04", title: "全年预算配比与 ROI 测算", desc: "分渠道预算分配、核销链路与里程碑考核指标" },
      ];
      sections.slice(0, 4).forEach((sec, idx) => {
        const y = 110 + idx * 132;
        slide.shapes.add({
          position: { left: 446, top: y, width: 76, height: 56 },
          text: sec.no,
          textStyle: { fontSize: 32, bold: true, color: pal.primary },
        });
        slide.shapes.add({
          position: { left: 536, top: y + 4, width: 660, height: 30 },
          text: sec.title,
          textStyle: { fontSize: 20, bold: true, color: pal.ink },
        });
        slide.shapes.add({
          position: { left: 536, top: y + 38, width: 660, height: 26 },
          text: sec.desc,
          textStyle: { fontSize: 13.5, color: pal.muted },
        });
        if (idx < 3) {
          slide.shapes.add({
            geometry: "rect",
            position: { left: 446, top: y + 96, width: 760, height: 1 },
            fill: pal.border,
            line: "none",
          });
        }
      });
      break;
    }

    case "ym-3pillar-insight":
    case "ym-persona-fan":
    case "ym-closing-summary": {
      addEditorialHeader(slide, data, pal);
      const cards = data.pillars || [
        {
          tag: "支柱 01",
          title: "健康透明配方成首要决策门槛",
          kpi: "68%",
          kpiLabel: "Z世代下单前核查成分与热量标签",
          bullets: ["零反式脂肪与原叶现萃搜索量同比翻倍", "直白量化卖点完播率高出情绪口号 42%"],
        },
        {
          tag: "支柱 02",
          title: "高出片率第三空间驱动自来水扩散",
          kpi: "3.4x",
          kpiLabel: "庭院主题店单客自然发帖率倍数",
          bullets: ["竹木茶席与节气限定杯套成打卡硬通货", "同城 LBS 探店笔记带动周末到店峰值"],
        },
        {
          tag: "支柱 03",
          title: "午间拼单与晚间社交构成双核增量",
          kpi: "85%",
          kpiLabel: "全天小程序核销集中于两大黄金窗口",
          bullets: ["12:00 写字楼双杯拼单券拉升复购频次", "19:30 达人直播脉冲承接晚间聚会客流"],
        },
      ];
      const cardW = 368;
      const gap = 32;
      cards.slice(0, 3).forEach((c, i) => {
        const left = 56 + i * (cardW + gap);
        const top = 148;
        const h = 450;
        const accentClr = i === 0 ? pal.primary : i === 1 ? pal.secondary : pal.accent;

        slide.shapes.add({
          geometry: "rect",
          position: { left, top, width: cardW, height: h },
          fill: pal.surface,
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left, top, width: cardW, height: 6 },
          fill: accentClr,
          line: "none",
        });
        slide.shapes.add({
          position: { left: left + 22, top: top + 22, width: 140, height: 20 },
          text: c.tag,
          textStyle: { fontSize: 11, bold: true, color: accentClr },
        });
        slide.shapes.add({
          position: { left: left + 22, top: top + 48, width: cardW - 44, height: 54 },
          text: c.title,
          textStyle: { fontSize: 18, bold: true, color: pal.ink, lineSpacing: 1.25 },
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left: left + 22, top: top + 116, width: cardW - 44, height: 92 },
          fill: "#FFFFFF",
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          position: { left: left + 36, top: top + 126, width: cardW - 72, height: 44 },
          text: c.kpi,
          textStyle: { fontSize: 30, bold: true, color: accentClr },
        });
        slide.shapes.add({
          position: { left: left + 36, top: top + 174, width: cardW - 72, height: 24 },
          text: c.kpiLabel,
          textStyle: { fontSize: 12, color: pal.muted },
        });
        slide.shapes.add({
          position: { left: left + 22, top: top + 232, width: cardW - 44, height: 190 },
          text: makeBulletList(c.bullets, {
            fontSize: 13.5,
            color: pal.body,
            bulletColor: accentClr,
            lineSpacing: 1.38,
            spaceAfter: 8,
          }),
        });
      });
      addTakeawayBar(
        slide,
        data.takeaway || "策略启示：将产品健康标签、门店空间视觉与双高峰发券机制绑定，打通种草到核销最短路径",
        pal
      );
      break;
    }

    case "ym-dual-chart-evidence": {
      addEditorialHeader(
        slide,
        {
          tag: data.tag || "QUANTITATIVE EVIDENCE",
          title: data.title || "全时段种草曝光与核销呈现双峰集中，晚间与午间贡献 85% 业绩",
          subtitle: data.subtitle,
          pageNo: data.pageNo,
        },
        pal
      );

      slide.shapes.add({
        geometry: "rect",
        position: { left: 56, top: 144, width: 716, height: 456 },
        fill: pal.surface,
        line: { style: "solid", fill: pal.border, width: 1 },
      });
      slide.charts.add("column", {
        title: data.leftChartTitle || "分时段社媒曝光指数 vs 到店核销单量",
        titleTextStyle: { fontSize: 15, bold: true, color: pal.ink },
        position: { left: 72, top: 160, width: 684, height: 424 },
        categories: data.categories || ["09:00", "12:00", "14:00", "16:00", "19:00", "21:00"],
        series: data.series || [
          { name: "种草曝光指数", values: [42, 118, 96, 74, 136, 124], fill: pal.primary },
          { name: "到店核销单量", values: [26, 95, 78, 52, 119, 106], fill: pal.secondary },
        ],
        yAxis: { min: 0, max: 160, majorUnit: 40 },
      });

      slide.shapes.add({
        geometry: "rect",
        position: { left: 796, top: 144, width: 428, height: 456 },
        fill: pal.surface,
        line: { style: "solid", fill: pal.border, width: 1 },
      });
      slide.charts.add("doughnut", {
        title: data.rightChartTitle || "全天核销 GMV 时段结构占比",
        titleTextStyle: { fontSize: 15, bold: true, color: pal.ink },
        position: { left: 816, top: 160, width: 388, height: 424 },
        categories: data.pieCategories || ["晚间黄金档", "午间拼单档", "常规长尾档"],
        series: [
          {
            name: "GMV占比",
            values: data.pieValues || [47, 38, 15],
            pointFills: [pal.primary, pal.secondary, "#94A3B8"],
          },
        ],
        hasLegend: true,
        legend: { position: "b" },
        dataLabels: { showValue: false, showPercent: true, textStyle: { color: "#FFFFFF", bold: true } },
      });

      addTakeawayBar(
        slide,
        data.takeaway || "投放建议：85% 竞价信息流预算锁定 11:30-13:30 与 18:30-21:30 两大窗口集中放量",
        pal
      );
      break;
    }

    case "ym-competitor-table":
    case "ym-budget-roi-sheet": {
      addEditorialHeader(
        slide,
        {
          tag: data.tag || "BUDGET & ROI ALLOCATION",
          title: data.title || "全年预算向双高峰脉冲与腰尾部达人倾斜，目标综合 ROI 达 4.3x",
          pageNo: data.pageNo,
        },
        pal
      );

      const kpis = data.kpis || [
        { label: "年度总投放预算", value: "¥600万" },
        { label: "预估总曝光量", value: "1.8亿+" },
        { label: "预计小程序领券核销", value: "86万单" },
        { label: "目标综合核销 ROI", value: "4.3x" },
      ];
      const kw = 274;
      kpis.slice(0, 4).forEach((k, idx) => {
        const lx = 56 + idx * (kw + 24);
        slide.shapes.add({
          geometry: "rect",
          position: { left: lx, top: 136, width: kw, height: 86 },
          fill: pal.surface,
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          position: { left: lx + 20, top: 148, width: kw - 40, height: 20 },
          text: k.label,
          textStyle: { fontSize: 12, color: pal.muted },
        });
        slide.shapes.add({
          position: { left: lx + 20, top: 174, width: kw - 40, height: 36 },
          text: k.value,
          textStyle: { fontSize: 26, bold: true, color: idx === 3 ? pal.secondary : pal.primary },
        });
      });

      const tbl = slide.tables.add({
        position: { left: 56, top: 244, width: 1168, height: 356 },
        columnTracks: [fixed(140), fixed(160), fr(1.4), fixed(130), fixed(130), fixed(120)],
        headerFill: pal.primary,
        zebraFill: pal.surface,
        totalRow: true,
        totalRowFill: pal.tint,
        verticalBorders: true,
        values: data.tableValues || [
          ["投放模块", "达人/渠道层级", "核心内容与转化机制", "预算金额", "预算占比", "目标ROI"],
          ["黄金双高峰", "腰部垂类达人", "午间拼单场景种草 + 搜索关键词卡位", "¥210万", "35%", "4.2x"],
          ["黄金双高峰", "同城探店+店播", "晚间庭院打卡短视频 + 直播间限时双杯券", "¥300万", "50%", "4.8x"],
          ["长尾蓄水", "KOC真实口碑", "节气新品开箱晒单 + 门店社群复购裂变", "¥90万", "15%", "3.1x"],
          ["合计", "全渠道协同", "曝光-搜后承接-领券到店核销全链路", "¥600万", "100%", "4.3x"],
        ],
      });
      if (!data.tableValues) {
        tbl.merge({ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 });
      }
      tbl.cells.block({ startRow: 1, endRow: tbl.rowCount - 1, startColumn: 3, endColumn: 5 }).style = {
        alignment: "center",
        bold: true,
      };
      addTakeawayBar(
        slide,
        data.takeaway || "风控机制：按周追踪单篇笔记 CPS 领券成本，高于均值 20% 立即暂停追投并切换高优素材",
        pal
      );
      break;
    }

    case "ym-funnel-conversion": {
      addEditorialHeader(
        slide,
        {
          tag: data.tag || "CONVERSION FUNNEL",
          title: data.title || "从公域种草触达到私域复购裂变的四阶漏斗拆解",
          pageNo: data.pageNo,
        },
        pal
      );
      const stages = data.stages || [
        { name: "A1 公域曝光触达", metric: "1.8亿+", action: "节气热点话题 + 同城探店达人矩阵高密度铺设", color: pal.primary },
        { name: "A2 搜后心智种草", metric: "2,400万", action: "品类痛点词包占领搜索首屏，强化透明配方记忆点", color: "#1D4ED8" },
        { name: "A3 领券到店核销", metric: "86万单", action: "午晚双高峰定向派发双杯拼单券，缩短决策链路", color: pal.secondary },
        { name: "A4 私域社群复购", metric: "38%复购", action: "门店扫码入群享周三会员日礼遇，沉淀长期资产", color: pal.accent },
      ];
      const maxTopW = 420;
      const minBotW = 180;
      const centerX = 280;
      stages.slice(0, 4).forEach((st, i) => {
        const y = 148 + i * 112;
        const h = 96;
        const wTop = maxTopW - ((maxTopW - minBotW) * i) / 4;
        const wBot = maxTopW - ((maxTopW - minBotW) * (i + 1)) / 4;
        const left = centerX - wTop / 2;
        const inset = (wTop - wBot) / 2;

        slide.shapes.add({
          position: { left, top: y, width: wTop, height: h },
          customPaths: [
            {
              width: wTop,
              height: h,
              commands: [
                { cmd: "moveTo", x: 0, y: 0 },
                { cmd: "lineTo", x: wTop, y: 0 },
                { cmd: "lineTo", x: wTop - inset, y: h },
                { cmd: "lineTo", x: inset, y: h },
                { cmd: "close" },
              ],
            },
          ],
          fill: st.color,
          line: "none",
          text: `${st.name}\n${st.metric}`,
          textStyle: { fontSize: 15, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
        });

        slide.shapes.add({
          geometry: "rect",
          position: { left: 536, top: y + 8, width: 688, height: 80 },
          fill: pal.surface,
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left: 536, top: y + 8, width: 5, height: 80 },
          fill: st.color,
          line: "none",
        });
        slide.shapes.add({
          position: { left: 560, top: y + 20, width: 644, height: 56 },
          text: st.action,
          textStyle: { fontSize: 15, color: pal.ink, verticalAlignment: "middle" },
        });
      });
      addTakeawayBar(slide, data.takeaway || "关键抓手切换为定量漏斗考核：重点监控 A2→A3 搜后领券率与核销率", pal);
      break;
    }

    case "ym-timeline-roadmap": {
      addEditorialHeader(
        slide,
        {
          tag: data.tag || "EXECUTION ROADMAP",
          title: data.title || "五阶段战役推进节奏与关键里程碑交付物",
          pageNo: data.pageNo,
        },
        pal
      );
      // Central horizontal timeline axis
      slide.shapes.add({
        geometry: "rect",
        position: { left: 72, top: 366, width: 1136, height: 4 },
        fill: pal.primary,
        line: "none",
      });
      const phases = data.phases || [
        { tag: "Phase 01 · W1-W2", title: "冷启动测品期", desc: "30位垂类腰部达人赛马测试3组核心卖点脚本" },
        { tag: "Phase 02 · W3-W4", title: "搜索词包卡位", desc: "铺设200篇KOC真实场景笔记占领品类长尾热词" },
        { tag: "Phase 03 · W5-W6", title: "双峰脉冲引爆", desc: "头部达人定调首发 + 午晚黄金档信息流集中追投" },
        { tag: "Phase 04 · W7-W8", title: "同城店播承接", desc: "LBS定向派发门店双杯拼单券拉升核销峰值" },
        { tag: "Phase 05 · W9+", title: "长效私域复购", desc: "沉淀高净值会员社群，转入月度节气上新常态化" },
      ];
      phases.slice(0, 5).forEach((ph, idx) => {
        const cx = 168 + idx * 236;
        const isTop = idx % 2 === 0;
        const cardTop = isTop ? 162 : 408;
        const dotClr = idx % 2 === 0 ? pal.primary : pal.secondary;

        slide.shapes.add({
          geometry: "ellipse",
          position: { left: cx - 12, top: 356, width: 24, height: 24 },
          fill: "#FFFFFF",
          line: { style: "solid", fill: dotClr, width: 3 },
        });
        slide.shapes.add({
          geometry: "ellipse",
          position: { left: cx - 5, top: 363, width: 10, height: 10 },
          fill: dotClr,
          line: "none",
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left: cx - 1, top: isTop ? 326 : 380, width: 2, height: 28 },
          fill: dotClr,
          line: "none",
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left: cx - 106, top: cardTop, width: 212, height: 164 },
          fill: pal.surface,
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left: cx - 106, top: cardTop, width: 212, height: 5 },
          fill: dotClr,
          line: "none",
        });
        slide.shapes.add({
          position: { left: cx - 92, top: cardTop + 16, width: 184, height: 20 },
          text: ph.tag,
          textStyle: { fontSize: 11, bold: true, color: dotClr },
        });
        slide.shapes.add({
          position: { left: cx - 92, top: cardTop + 42, width: 184, height: 28 },
          text: ph.title,
          textStyle: { fontSize: 16.5, bold: true, color: pal.ink },
        });
        slide.shapes.add({
          position: { left: cx - 92, top: cardTop + 76, width: 184, height: 74 },
          text: ph.desc,
          textStyle: { fontSize: 12.5, color: pal.body, lineSpacing: 1.38 },
        });
      });
      addTakeawayBar(slide, data.takeaway || "里程碑管控：每两周复盘 CTR 与到店核销 CPS，动态淘汰末位 30% 低效素材", pal);
      break;
    }

    case "ym-2x2-quadrant":
    default: {
      // Clean 2x2 / Timeline / Funnel / Case structured fallback grid
      addEditorialHeader(slide, data, pal);
      const blocks = data.blocks || [
        { step: "01", title: "人群痛点锚定", desc: "聚焦高复购白领午后提神与低糖社交需求，建立清晰品类心智" },
        { step: "02", title: "爆品视觉锤打造", desc: "以东方器物美学与原叶现萃卖点形成高辨识度同城打卡符号" },
        { step: "03", title: "达人脉冲种草", desc: "头部定调、腰部测评、海量 KOC 铺设城市场景词包拦截搜索流量" },
        { step: "04", title: "私域核销沉淀", desc: "线上领券到店自提并沉淀企微社群，实现周度新品零成本触达" },
      ];
      blocks.slice(0, 4).forEach((b, idx) => {
        const colIdx = idx % 2;
        const rowIdx = Math.floor(idx / 2);
        const left = 56 + colIdx * 596;
        const top = 152 + rowIdx * 224;
        slide.shapes.add({
          geometry: "rect",
          position: { left, top, width: 572, height: 200 },
          fill: pal.surface,
          line: { style: "solid", fill: pal.border, width: 1 },
        });
        slide.shapes.add({
          geometry: "rect",
          position: { left, top, width: 6, height: 200 },
          fill: idx % 2 === 0 ? pal.primary : pal.secondary,
          line: "none",
        });
        slide.shapes.add({
          position: { left: left + 26, top: top + 22, width: 80, height: 34 },
          text: b.step,
          textStyle: { fontSize: 24, bold: true, color: idx % 2 === 0 ? pal.primary : pal.secondary },
        });
        slide.shapes.add({
          position: { left: left + 96, top: top + 24, width: 448, height: 32 },
          text: b.title,
          textStyle: { fontSize: 19, bold: true, color: pal.ink },
        });
        slide.shapes.add({
          position: { left: left + 26, top: top + 76, width: 520, height: 96 },
          text: b.desc,
          textStyle: { fontSize: 14, color: pal.body, lineSpacing: 1.45 },
        });
      });
      addTakeawayBar(slide, data.takeaway, pal);
      break;
    }
  }
  return slide;
}

export function createPresetPresentation(slideSpecs = [], options = {}) {
  const pres = Presentation.create({
    title: options.title || "Yuanmou Consulting Presentation",
    defaultFont: options.defaultFont || "PingFang SC",
  });
  slideSpecs.forEach((spec, idx) => {
    const sl = pres.slides.add();
    applyPresetSlide(
      sl,
      spec.presetId || "ym-3pillar-insight",
      { pageNo: idx > 0 ? idx + 1 : undefined, ...spec.data },
      options.palette
    );
  });
  return pres;
}

export { BUILTIN_SKELETON_CATALOG };
