// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SLIDE_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slides (
  slide_uid TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  deck_title TEXT NOT NULL,
  slide_no INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  image_count INTEGER NOT NULL DEFAULT 0,
  text_slots INTEGER NOT NULL DEFAULT 3,
  result_count INTEGER NOT NULL DEFAULT 0,
  has_table INTEGER NOT NULL DEFAULT 0,
  has_chart INTEGER NOT NULL DEFAULT 0,
  layout_summary TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  style_tags TEXT NOT NULL DEFAULT '',
  topic_id TEXT DEFAULT '',
  file_id TEXT DEFAULT '',
  group_id TEXT DEFAULT '15554411848482',
  tier TEXT NOT NULL DEFAULT 'vip',
  r2_object_key TEXT DEFAULT '',
  preview_key TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_slides_purpose ON slides(purpose);
CREATE INDEX IF NOT EXISTS idx_slides_slots ON slides(image_count, text_slots, result_count);
CREATE INDEX IF NOT EXISTS idx_slides_sku ON slides(sku);
`;

/**
 * 16 industry-agnostic structural archetypes (`ortho_v3`).
 * Keep strictly orthogonal to business industry so skeletons transfer cleanly across marketing,
 * events, academic research, hardware launches, career reviews, B2B proposals, and public sector.
 */
export const ORTHO_ARCHETYPES = [
  "message_house",
  "layered_architecture",
  "swimlane_gantt",
  "event_rundown",
  "milestone_roadmap",
  "process_pipeline",
  "funnel_flow",
  "pyramid_layers",
  "matrix_grid",
  "comparison_table",
  "dual_chart_insight",
  "kpi_scorecard",
  "ecosystem_flow",
  "evidence_showcase",
  "hero_statement",
  "editorial_freeform",
];

const VALID_ARCHETYPE_SET = new Set(ORTHO_ARCHETYPES);

/** Soft structural affinity neighbors (receive ~60% partial credit so queries never hard-zero). */
export const ARCHETYPE_AFFINITY = {
  message_house: ["layered_architecture", "pyramid_layers", "editorial_freeform"],
  layered_architecture: ["message_house", "pyramid_layers", "ecosystem_flow"],
  swimlane_gantt: ["milestone_roadmap", "event_rundown", "comparison_table"],
  event_rundown: ["swimlane_gantt", "comparison_table", "process_pipeline"],
  milestone_roadmap: ["swimlane_gantt", "process_pipeline", "event_rundown"],
  process_pipeline: ["funnel_flow", "milestone_roadmap", "ecosystem_flow"],
  funnel_flow: ["process_pipeline", "pyramid_layers"],
  pyramid_layers: ["message_house", "layered_architecture", "funnel_flow"],
  matrix_grid: ["comparison_table", "editorial_freeform", "kpi_scorecard"],
  comparison_table: ["matrix_grid", "dual_chart_insight", "editorial_freeform"],
  dual_chart_insight: ["kpi_scorecard", "comparison_table", "editorial_freeform"],
  kpi_scorecard: ["dual_chart_insight", "hero_statement", "matrix_grid"],
  ecosystem_flow: ["process_pipeline", "layered_architecture", "message_house"],
  evidence_showcase: ["editorial_freeform", "matrix_grid"],
  hero_statement: ["kpi_scorecard", "editorial_freeform"],
  editorial_freeform: ["evidence_showcase", "matrix_grid", "comparison_table"],
};

const DIAGRAM_FAMILY_AFFINITY = {
  funnel: ["flow", "hierarchy", "nested"],
  flow: ["timeline", "cycle", "branch", "funnel"],
  timeline: ["flow", "branch"],
  hierarchy: ["nested", "branch", "funnel"],
  nested: ["hierarchy", "venn"],
  cycle: ["flow", "radial", "relationship"],
  branch: ["hierarchy", "flow"],
  radial: ["relationship", "cycle", "nested"],
  relationship: ["radial", "venn", "matrix"],
  venn: ["relationship", "nested"],
  matrix: ["comparison", "quadrant", "relationship"],
  quadrant: ["matrix", "comparison"],
  comparison: ["matrix", "quadrant"],
};

/** Offline design-grammar pattern section mapping (used when offline or library recall is weak). */
export const OFFLINE_PATTERN_HINTS = {
  message_house: "references/offline-layout-patterns.md#pattern-message-house",
  layered_architecture: "references/offline-layout-patterns.md#pattern-layered-architecture",
  swimlane_gantt: "references/offline-layout-patterns.md#pattern-swimlane-gantt",
  event_rundown: "references/offline-layout-patterns.md#pattern-event-rundown",
  milestone_roadmap: "references/offline-layout-patterns.md#pattern-swimlane-gantt",
  process_pipeline: "references/offline-layout-patterns.md#pattern-process-pipeline",
  funnel_flow: "references/offline-layout-patterns.md#pattern-process-pipeline",
  pyramid_layers: "references/offline-layout-patterns.md#pattern-message-house",
  matrix_grid: "references/offline-layout-patterns.md#pattern-executive-bento",
  comparison_table: "references/offline-layout-patterns.md#pattern-comparison-ablation",
  dual_chart_insight: "references/offline-layout-patterns.md#pattern-dual-chart-insight",
  kpi_scorecard: "references/offline-layout-patterns.md#pattern-kpi-scorecard",
  ecosystem_flow: "references/offline-layout-patterns.md#pattern-layered-architecture",
  evidence_showcase: "references/offline-layout-patterns.md#pattern-editorial-split",
  hero_statement: "references/offline-layout-patterns.md#pattern-keynote-hero",
  editorial_freeform: "references/offline-layout-patterns.md#pattern-editorial-split",
};

const ARCHETYPE_ALIASES = [
  ["message_house", ["message_house", "messagehouse", "message house", "信息屋", "价值屋", "战略屋", "屋顶架构", "屋顶支柱", "品牌屋", "价值主张屋"]],
  ["layered_architecture", ["layered_architecture", "architecture", "arch", "多层架构", "技术架构", "系统架构", "分层架构", "端边云", "治理体系", "中台架构", "平台架构"]],
  ["swimlane_gantt", ["swimlane_gantt", "gantt", "marketing_timeline", "campaign_timeline", "甘特图", "营销timeline", "传播排期", "波段排期", "传播节奏", "泳道排期", "媒介排期", "筹备甘特"]],
  ["event_rundown", ["event_rundown", "rundown", "agenda", "schedule", "活动流程", "活动议程", "时刻表", "流程表", "日程表", "议程表", "单日排期", "执行流程表"]],
  ["milestone_roadmap", ["milestone_roadmap", "roadmap", "timeline", "milestone", "时间规划", "时间轴", "里程碑", "发展历程", "演进路线", "年度规划", "阶段规划"]],
  ["process_pipeline", ["process_pipeline", "pipeline", "workflow", "flywheel", "game_mechanic", "method_pipeline", "流程图", "步骤流", "方法论", "闭环飞轮", "增长飞轮", "玩法机制", "游戏玩法", "实验流程", "技术路线"]],
  ["funnel_flow", ["funnel_flow", "funnel", "conversion_funnel", "漏斗", "转化漏斗", "反漏斗", "人群漏斗", "分层过滤"]],
  ["pyramid_layers", ["pyramid_layers", "pyramid", "concentric", "sizing_breakdown", "tam_sam_som", "金字塔", "同心圆", "嵌套圈层", "市场规模", "阶梯层级", "人群分层"]],
  ["matrix_grid", ["matrix_grid", "matrix", "quadrant", "bento", "executive_one_pager", "one_pager", "四象限", "矩阵", "定位矩阵", "一页纸", "全景看板", "bento看板", "2x2"]],
  ["comparison_table", ["comparison_table", "comparison", "ablation", "do_dont", "do_dont_contrast", "ops_matrix_table", "对比表", "竞品对比", "参数对比", "消融实验", "消融表", "正反对照", "优缺点对比", "分工表", "预算表", "物料表"]],
  ["dual_chart_insight", ["dual_chart_insight", "dual_chart", "chart_insight", "data_insight", "双图洞察", "图表洞察", "数据洞察", "图文数据", "趋势洞察", "实验结果图"]],
  ["kpi_scorecard", ["kpi_scorecard", "scorecard", "kpi", "dashboard", "指标卡", "计分卡", "核心数据", "成果指标", "经营复盘", "达成率", "okr复盘"]],
  ["ecosystem_flow", ["ecosystem_flow", "ecosystem", "business_model", "radial", "venn", "生态图", "生态闭环", "商业模式", "资金流", "中心辐射", "韦恩图", "关系映射"]],
  ["evidence_showcase", ["evidence_showcase", "case_wall", "screenshot_wall", "org_team_grid", "logo_credentials_wall", "geo_map_layout", "venue_zoning", "案例展示", "截图墙", "笔记墙", "实证墙", "作品墙", "团队墙", "logo墙", "资质墙", "场地分区", "区位地图"]],
  ["hero_statement", ["hero_statement", "keynote_hero", "product_callout", "big_number", "金句页", "宣言页", "大字宣言", "发布会主视觉", "巨幕页", "产品剖面", "剖面标注", "单数字炸点"]],
  ["editorial_freeform", ["editorial_freeform", "freeform", "editorial", "before_after_split", "自由图文", "左右图文", "多栏卡片", "杂志排版", "前后对比"]],
];

/**
 * Lightweight deterministic alias normalizer (NO fragile regex guessing on arbitrary titles).
 * Returns canonical archetype enum when explicit/known, or "" when omitted/unrecognized.
 */
export function normalizeArchetype(input) {
  if (!input) return "";
  const raw = String(input).trim().toLowerCase();
  if (!raw || raw === "any") return "";
  if (VALID_ARCHETYPE_SET.has(raw)) return raw;
  const compact = raw.replace(/[\s\-_/]+/g, "");
  for (const [canon, aliases] of ARCHETYPE_ALIASES) {
    for (const a of aliases) {
      const al = a.toLowerCase();
      if (raw === al || compact === al.replace(/[\s\-_/]+/g, "")) {
        return canon;
      }
    }
  }
  return "";
}

const PURPOSE_ALIAS_MAP = new Map([
  ["活动策划", ["执行策略", "资源介绍"]],
  ["线下活动", ["执行策略", "资源介绍"]],
  ["活动方案", ["执行策略", "资源介绍"]],
  ["活动流程", ["执行策略", "结构图示"]],
  ["日程", ["执行策略", "结构图示"]],
  ["互动玩法", ["执行策略", "内容示例"]],
  ["科研汇报", ["方法论", "洞察分析"]],
  ["学术答辩", ["方法论", "洞察分析"]],
  ["技术评审", ["方法论", "结构图示"]],
  ["发布会", ["作品展示", "公司介绍"]],
  ["产品发布", ["作品展示", "公司介绍"]],
  ["述职", ["结案复盘", "洞察分析"]],
  ["晋升", ["结案复盘", "方法论"]],
  ["年终总结", ["结案复盘", "洞察分析"]],
  ["融资", ["公司介绍", "洞察分析"]],
  ["bp", ["公司介绍", "洞察分析"]],
  ["售前", ["执行策略", "公司介绍"]],
  ["投标", ["执行策略", "公司介绍"]],
  ["培训", ["方法论", "内容示例"]],
  ["课件", ["方法论", "内容示例"]],
]);

export function normalizePurposeTerms(input) {
  const rawTerms = splitTerms(input === "any" ? "" : input);
  const out = [];
  for (const term of rawTerms) {
    const low = term.toLowerCase();
    const mapped = PURPOSE_ALIAS_MAP.get(low);
    if (mapped) {
      for (const m of mapped) {
        if (!out.includes(m)) out.push(m);
      }
    } else if (!out.includes(term)) {
      out.push(term);
    }
  }
  return out;
}

export function normalizeCapacityTier(input) {
  if (!input) return "";
  const raw = String(input).trim().toLowerCase();
  if (!raw || raw === "any") return "";
  if (["headline", "ultra_sparse", "sparse", "大字", "金句", "极简"].includes(raw)) return "headline";
  if (["compact", "medium", "normal", "观点", "常规", "中等"].includes(raw)) return "compact";
  if (["rich", "dense", "detailed", "细则", "论证", "高密", "详版"].includes(raw)) return "rich";
  if (["tabular", "ultra_dense", "table", "matrix", "表格", "明细", "排期"].includes(raw)) return "tabular";
  return "";
}

const CAPACITY_ORDER = { headline: 0, compact: 1, rich: 2, tabular: 3 };

const NON_CONTENT_PAGE_TYPES = new Set([
  "封面",
  "封底",
  "目录",
  "致谢",
  "空白页",
  "占位页",
  "广告附页",
  "目录；章节页",
  "章节页",
  "版权说明",
]);

const NON_CONTENT_SUBSTRINGS = [
  "空白页",
  "占位页",
  "广告附页",
  "版权说明",
  "封底",
  "致谢",
  "目录",
  "章节页",
  "封面",
];

const RE_REAL_WATERMARK = /(?<![无没有未非不])水印/;
const RE_REAL_DEFECT =
  /(?<![无没有未非不])(?:水印|乱码|严重重叠|文字重叠|画面截断|底部截断|低清|纯文字堆砌|Word式|空白异常|黑白文档排版|正文型PDF|文档型PDF|不宜当.{0,6}PPT|竖版文档|道客巴巴|百度文库|豆丁网)/i;
const RE_REAL_TABLE = /表格|明细表|排期表|预算表|对比表|参数表|统计表|矩阵表|数据表|信息表|议程表|时刻表|分工表|清单表|报价表/;

function hasRealTable(text) {
  if (!text) return false;
  const cleaned = String(text).replace(/(?:无|没有|未见|不含|非)[^，。；;、\n]{0,8}表(?:格)?/g, "");
  return RE_REAL_TABLE.test(cleaned);
}

function hasRealWatermark(text) {
  if (!text) return false;
  const cleaned = String(text).replace(/(?:无|没有|未见|不含|去除|去掉)[^，。；;、\n]{0,6}水印/g, "");
  return RE_REAL_WATERMARK.test(cleaned);
}

function hasRealDefect(text) {
  if (!text) return false;
  const cleaned = String(text).replace(
    /(?:无|没有|未见|不含|未出现|避免|防止)[^，。；;、\n]{0,12}(?:水印|乱码|黑框|重叠|截断|模糊|低清|异常)/g,
    ""
  );
  return RE_REAL_DEFECT.test(cleaned);
}

function isNonContentPageType(pageType) {
  if (!pageType) return false;
  const s = String(pageType).trim();
  if (!s || s === "正文页" || s === "摘要") return false;
  if (NON_CONTENT_PAGE_TYPES.has(s)) return true;
  if (s.includes("正文")) return false;
  return NON_CONTENT_SUBSTRINGS.some((sub) => s.includes(sub));
}

function splitTerms(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    for (const tok of String(item).split(/[,，|｜/;；]+/)) {
      const clean = tok.trim();
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }
  return out;
}

function parseExcludeIds(exclude) {
  const out = new Set();
  if (!exclude) return out;
  const arr = Array.isArray(exclude) ? exclude : [exclude];
  for (const item of arr) {
    for (const tok of String(item).split(/[\s,，;；]+/)) {
      const clean = tok.trim();
      if (clean) out.add(clean);
    }
  }
  return out;
}

export function loadBlacklistIds(blacklistPath) {
  const out = new Set();
  const candidates = [];
  if (blacklistPath) {
    candidates.push(path.resolve(blacklistPath));
  } else {
    const cacheRoot = process.env.YUANMOU_CACHE_DIR || path.join(os.homedir(), ".cache", "yuanmou-ppt");
    candidates.push(path.join(cacheRoot, "blacklist.txt"));
  }
  for (const p of candidates) {
    if (!p || !existsSync(p)) continue;
    try {
      const lines = readFileSync(p, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const clean = line.replace(/#.*$/, "").trim();
        if (clean) out.add(clean);
      }
    } catch {
      // ignore unreadable blacklist
    }
  }
  return out;
}

/**
 * Deterministic runtime fallback derivation of the 5 `ortho_v3` fields when querying legacy DBs
 * that do not yet carry precomputed `archetype / transferability / capacity_tier / aesthetic_tier / tone_chrome`.
 */
export function deriveRuntimeOrtho(r) {
  const layout = String(r.layout || "");
  const rawLayout = String(r.raw_layout || "");
  const rawVis = String(r.raw_visual || r.visual_traits || "");
  const purpose = String(r.business_purpose || "");
  const topic = String(r.business_topic || "");
  const logic = String(r.logic || "");
  const lg = String(r.local_graphics || "");
  const bg = String(r.background || "");
  const diagFam = String(r.diagram_family || "").toLowerCase();
  const diagLabels = String(r.diagram_labels || "");
  const rawTitle = String(r.raw_title || "");
  const restoreNote = String(r.restore_note || "");
  const blob = `${layout} ${rawLayout} ${lg} ${diagLabels} ${rawTitle} ${topic} ${purpose}`;

  // 1. Archetype
  let archetype = r.archetype && VALID_ARCHETYPE_SET.has(r.archetype) ? r.archetype : "";
  if (!archetype) {
    if (/message\s*house|信息屋|战略屋|价值屋|品牌屋|支柱屋|共同屋顶|屋顶形|屋顶.{0,12}(?:支柱|三列|四列|底座|统领)|顶层.{0,12}支柱|三支柱|四支柱/i.test(blob)) {
      archetype = "message_house";
    } else if (/甘特|泳道|波段排期|传播节奏|营销.*排期|投放排期|传播排期|timeline.*泳道/i.test(blob)) {
      archetype = "swimlane_gantt";
    } else if (/rundown|时刻表|议程表|流程表|签到.*环节|时间节点.*环节|活动流程/i.test(blob)) {
      archetype = "event_rundown";
    } else if (diagFam === "funnel" || /漏斗|反漏斗/.test(blob)) {
      archetype = "funnel_flow";
    } else if (diagFam === "timeline" || /时间轴|里程碑|发展历程|演进路线|roadmap/i.test(blob)) {
      archetype = "milestone_roadmap";
    } else if (
      /多层架构|技术架构|系统架构|端边云|分层架构|平台架构|治理体系|中台架构|技术栈|多级架构矩阵|应用层|数据层|底层.{0,12}中层|横向.{0,6}分层|三层.{0,6}架构|四层.{0,6}架构|五层.{0,6}架构|三层横带/.test(blob) &&
      !/组织架构|树状|MCN.*架构|账号架构|股权架构|人员架构/i.test(blob)
    ) {
      archetype = "layered_architecture";
    } else if (diagFam === "nested" || /金字塔|同心圆|tam.*sam|嵌套圈|阶梯层级/i.test(blob)) {
      archetype = "pyramid_layers";
    } else if (diagFam === "hierarchy" && /金字塔|层级|底座|支柱|屋顶/.test(blob)) {
      archetype = "pyramid_layers";
    } else if (diagFam === "matrix" || diagFam === "quadrant" || /四象限|象限|2x2|bento|全景看板|一页纸/i.test(blob)) {
      archetype = "matrix_grid";
    } else if (diagFam === "comparison" || /对比表|竞品对比|参数对比|消融|正反对照|vs|表格|预算表|分工表/i.test(blob) || lg.includes("表")) {
      archetype = "comparison_table";
    } else if (diagFam === "cycle" || diagFam === "flow" || diagFam === "branch" || /流程图|飞轮|闭环|步骤|阶段流程|方法论链路|玩法/.test(blob)) {
      archetype = "process_pipeline";
    } else if (diagFam === "radial" || diagFam === "venn" || diagFam === "relationship" || /生态|辐射|韦恩|商业模式|交集/.test(blob)) {
      archetype = "ecosystem_flow";
    } else if (/柱状图|折线图|饼图|环形图|条形图|面积图|散点图|雷达图|数据图/.test(lg + rawLayout)) {
      archetype = "dual_chart_insight";
    } else if ((r.result_slots ?? 0) >= 2 || r.independent_results_area === 1 || /核心指标|kpi|达成率|同比|环比|计分卡/i.test(blob)) {
      archetype = "kpi_scorecard";
    } else if (
      (r.image_slots ?? 0) >= 3 ||
      (r.full_screenshot_count ?? 0) >= 2 ||
      /案例展示|作品展示/.test(purpose) ||
      /截图墙|笔记墙|头像墙|logo墙|作品墙|团队墙|案例墙/i.test(blob)
    ) {
      archetype = "evidence_showcase";
    } else if ((r.text_slots ?? 4) <= 2 && /极简|留白充足|留白高|大字|宣言|金句|居中主视觉|封面感/.test(rawVis + rawLayout)) {
      archetype = "hero_statement";
    } else {
      archetype = "editorial_freeform";
    }
  }

  // 2. Transferability
  let transferability = r.transferability || "";
  if (!transferability) {
    const imgSlots = r.image_slots ?? 0;
    const fullScr = r.full_screenshot_count ?? 0;
    const compScr = r.composite_screenshot_count ?? 0;
    const isSocialLocked =
      fullScr >= 2 ||
      compScr >= 1 ||
      r.single_note_analysis === 1 ||
      r.per_note_analysis === 1 ||
      /笔记截图|手机框|小红书主页|小红书笔记|达人主页|达人头像墙|微博热搜|抖音界面|电商详情截屏|评论区截图|信息流截图/.test(
        `${rawLayout} ${rawVis} ${lg}`
      );
    if (isSocialLocked) {
      transferability = "scene_specific";
    } else if (imgSlots === 0 && fullScr === 0) {
      transferability = "universal";
    } else if (imgSlots <= 3 && fullScr <= 1) {
      transferability = "adaptable";
    } else {
      transferability = "scene_specific";
    }
  }

  // 3. Capacity tier
  let capacityTier = r.capacity_tier || "";
  if (!capacityTier) {
    const ts = r.text_slots;
    if (lg.includes("表") || /表格|排期表|甘特|rundown|预算表|参数表|矩阵表/i.test(`${lg} ${layout} ${rawLayout}`)) {
      capacityTier = "tabular";
    } else if (
      archetype === "hero_statement" ||
      (ts !== null && ts !== undefined && ts <= 2 && !/高密度|密排|复杂/.test(rawVis))
    ) {
      capacityTier = "headline";
    } else if (
      (ts !== null && ts !== undefined && ts >= 7) ||
      r.complex_structure === 1 ||
      /高密度|密度高|多条要点|细则|详细说明/.test(rawVis + rawLayout)
    ) {
      capacityTier = "rich";
    } else {
      capacityTier = "compact";
    }
  }

  // 4. Aesthetic tier (1..5 bucket-relative heuristic when DB lacks precomputed tier)
  let aestheticTier = Number.isInteger(r.aesthetic_tier) ? r.aesthetic_tier : 0;
  if (!aestheticTier) {
    const visBlob = `${rawVis} ${restoreNote}`;
    const status = String(r.page_status || "");
    if (status.includes("受阻") || hasRealDefect(visBlob)) {
      aestheticTier = 1;
    } else {
      let pts = 3.0;
      if (/高级|精致|现代|杂志|极简|质感|克制|留白充足|层次清晰|视觉冲击|整洁|专业/.test(visBlob)) pts += 1.0;
      if (/留白充足|留白高|极简|质感|杂志|层次清晰/.test(visBlob) && r.gradient_structure === 1) pts += 0.5;
      if (diagFam) pts += 0.4;
      if (r.complex_structure === 1 && capacityTier !== "headline") pts += 0.3;
      if (/简陋|老旧|杂乱|拥挤|花哨|粗暴|粗糙|传统/.test(visBlob)) pts -= 1.0;
      if (capacityTier === "compact" && /极高密度|略挤|偏密/.test(visBlob)) pts -= 0.5;
      aestheticTier = Math.max(2, Math.min(5, Math.round(pts)));
    }
  }

  // 5. Tone & Chrome
  let toneChrome = r.tone_chrome || "";
  if (!toneChrome) {
    let tone = "light";
    if (/黑底|深底|深蓝底|深灰底|暗底|深色|暗黑/.test(bg + rawVis) && r.white_background !== 1) {
      tone = "dark";
    } else if (/图片背景|满版图|全出血图|摄影底/.test(bg)) {
      tone = "photo";
    } else if (r.white_background === 1 || /白|浅灰|浅底|米白/.test(bg)) {
      tone = "light";
    }
    const chromeParts = [];
    if (/四周.*框|外框线|红框|蓝框|全页边框|粗边框/.test(rawLayout + rawVis + restoreNote)) {
      chromeParts.push("bordered");
    }
    if (/页眉|顶栏|底栏|页脚|导航条/.test(rawLayout + restoreNote)) {
      chromeParts.push("header_footer");
    }
    if (/logo|商标|品牌角标|右上角标|左上角标/i.test(rawLayout + rawVis + restoreNote)) {
      chromeParts.push("logo_corner");
    }
    const chrome = chromeParts.length > 0 ? chromeParts.join("+") : "frameless";
    toneChrome = `${tone}:${chrome}`;
  }

  const [tone, chrome = "frameless"] = String(toneChrome).split(":");
  return { archetype, transferability, capacityTier, aestheticTier, toneChrome, tone, chrome };
}

async function openNodeSqlite(dbPath, readOnly = false) {
  try {
    const sqlite = await import("node:sqlite");
    if (sqlite?.DatabaseSync) {
      return new sqlite.DatabaseSync(dbPath, { open: true, readOnly });
    }
  } catch {
    // Fallback to sqlite3 CLI on older Node <22.5
  }
  return null;
}

async function runSqliteQuery(dbPath, sql, params = []) {
  const db = await openNodeSqlite(dbPath, true);
  if (db) {
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }
  const pCopy = [...params];
  const inlinedSql = sql.replace(/\?/g, () => {
    const v = pCopy.shift();
    if (typeof v === "number") return String(v);
    return `'${String(v ?? "").replace(/'/g, "''")}'`;
  });
  const res = spawnSync("sqlite3", ["-json", dbPath, inlinedSql], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (res.status === 0 && res.stdout.trim()) {
    return JSON.parse(res.stdout);
  }
  return [];
}

// ============================================================================
// In-process memory snapshot cache: eliminates 40x child-process/full-table-scan
// overhead in batch-search (20 pages drop from ~30s -> <0.3s automatically!).
// Auto-invalidates whenever DB file mtimeMs or size changes on disk.
// ============================================================================
const SNAPSHOT_CACHE = new Map();
const DECK_CATALOG_CACHE = new Map();
const MAX_SNAPSHOT_CACHE_ENTRIES = 3;

export function clearSlideIndexCache() {
  SNAPSHOT_CACHE.clear();
  DECK_CATALOG_CACHE.clear();
}

export async function loadPagesSnapshot(dbPath) {
  const absPath = path.resolve(dbPath);
  const st = statSync(absPath);
  const cacheKey = `${absPath}|${st.mtimeMs}|${st.size}`;
  const cached = SNAPSHOT_CACHE.get(cacheKey);
  if (cached) return cached;

  // Evict stale snapshots for the same path or oldest entries
  for (const k of [...SNAPSHOT_CACHE.keys()]) {
    if (k.startsWith(`${absPath}|`) || SNAPSHOT_CACHE.size >= MAX_SNAPSHOT_CACHE_ENTRIES) {
      SNAPSHOT_CACHE.delete(k);
    }
  }

  const colRows = await runSqliteQuery(absPath, "PRAGMA table_info(pages)");
  const colSet = new Set(colRows.map((c) => c.name));

  const wantedCols = [
    "content_page_id",
    "preview_file",
    "preview_path",
    "file_name",
    "full_sha256",
    "physical_page",
    "page_status",
    "business_purpose",
    "business_topic",
    "page_type",
    "layout",
    "logic",
    "local_graphics",
    "visual_traits",
    "background",
    "stage_count",
    "full_screenshot_count",
    "composite_screenshot_count",
    "result_slots",
    "independent_results_area",
    "mature_case",
    "white_background",
    "complex_structure",
    "gradient_structure",
    "text_slots",
    "image_slots",
    "raw_title",
    "raw_layout",
    "raw_visual",
    "result_form",
    "restore_note",
    "diagram_family",
    "diagram_labels",
    "feishu_file_token",
    "search_text",
    // ortho_v3 5 columns (loaded seamlessly when present!)
    "archetype",
    "transferability",
    "capacity_tier",
    "aesthetic_tier",
    "tone_chrome",
  ].filter((c) => colSet.has(c));

  const rawRows = await runSqliteQuery(absPath, `SELECT ${wantedCols.join(", ")} FROM pages`);
  const hasOrthoCols =
    colSet.has("archetype") &&
    colSet.has("transferability") &&
    colSet.has("capacity_tier") &&
    colSet.has("aesthetic_tier") &&
    colSet.has("tone_chrome");

  const entries = new Array(rawRows.length);
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const ortho = deriveRuntimeOrtho(r);
    const lg = String(r.local_graphics || "");
    const rawLayout = String(r.raw_layout || "");
    const layout = String(r.layout || "");
    const rawVis = String(r.raw_visual || r.visual_traits || "");
    const purpose = String(r.business_purpose || "");
    const topic = String(r.business_topic || "");
    const logic = String(r.logic || "");
    const diagFam = String(r.diagram_family || "").toLowerCase();
    const diagLabels = String(r.diagram_labels || "");
    const rawTitle = String(r.raw_title || "");
    const bg = String(r.background || "");
    const status = String(r.page_status || "");
    const hasTable = hasRealTable(`${lg} ${rawLayout} ${layout}`);
    const hasChart = /柱|折线|饼|环|图表|条形|面积图|雷达图|散点图/.test(lg + rawLayout);
    const nonBody = isNonContentPageType(r.page_type);
    // Pre-build lowercase searchable blob once per snapshot
    const searchBlob = `${layout}\n${rawLayout}\n${rawVis}\n${purpose}\n${topic}\n${logic}\n${lg}\n${diagLabels}\n${rawTitle}\n${ortho.archetype}\n${r.search_text || ""}`.toLowerCase();
    const deckKey = r.full_sha256
      ? String(r.full_sha256)
      : r.file_name
        ? String(r.file_name)
        : `${topic}|${layout}|${diagFam}`;

    entries[i] = {
      r,
      cid: String(r.content_page_id || ""),
      ortho,
      layout,
      rawLayout,
      rawVis,
      purpose,
      pageType: String(r.page_type || ""),
      topic,
      logic,
      lg,
      diagFam,
      diagLabels,
      rawTitle,
      bg,
      status,
      hasTable,
      hasChart,
      nonBody,
      searchBlob,
      deckKey,
      layoutSig: `${layout || "generic"}|${ortho.archetype}`,
    };
  }

  const snapshot = { absPath, colSet, hasOrthoCols, entries, loadedAt: Date.now() };
  SNAPSHOT_CACHE.set(cacheKey, snapshot);
  return snapshot;
}

/**
 * 3-Stage Clean Scoring (`Selection Engine 2.0`):
 *  - Stage 1: Sanity guards (blocked/watermark/preserve-vs-headline/cross-domain transferability/tone)
 *  - Stage 2: Core structural + slot isomorphism (archetype + affinity, soft diagramFamily, capacity, slots, choreography)
 *  - Stage 3: Clamped bucket-relative aesthetic multiplier (applied strictly on positive core matches)
 */
function scoreSnapshotEntry(e, opts) {
  const { r, ortho } = e;
  let coreScore = 0;
  const reasons = [];

  // ---------------- Stage 1: Sanity & Policy Guards ----------------
  if (e.status.includes("受阻")) coreScore -= 45;
  else coreScore += 4;
  if (hasRealWatermark(e.rawVis)) coreScore -= 25;

  // Preserve copy policy guard: NEVER cram dense operational facts into a 3-word headline poster
  if (opts.copyPolicy === "preserve") {
    if (ortho.capacityTier === "headline") {
      coreScore -= 42;
    } else if (ortho.capacityTier === "rich" || ortho.capacityTier === "tabular") {
      coreScore += 8;
      reasons.push(`保真承载(${ortho.capacityTier})`);
    }
  } else if (opts.copyPolicy === "distill") {
    if (ortho.capacityTier === "compact" || ortho.capacityTier === "headline") {
      coreScore += 4;
    }
  }

  // Cross-domain transferability isolation (protects universal 4A skeletons even from marketing decks!)
  if (opts.crossDomain || opts.allowSceneSpecific === false) {
    if (ortho.transferability === "universal") {
      coreScore += 16;
      reasons.push("跨行万能骨架");
    } else if (ortho.transferability === "adaptable") {
      coreScore += 6;
    } else if (ortho.transferability === "scene_specific") {
      coreScore -= 36;
    }
  } else if (!opts.wantsSocialOrEvidence) {
    // Mild default damping so platform-locked note-screenshot walls don't drown out clean structures
    if (ortho.transferability === "scene_specific") {
      coreScore -= 12;
    } else if (ortho.transferability === "universal") {
      coreScore += 5;
    }
  }

  // Tone alignment (replaces legacy hardcoded white_background +1.5 bias!)
  if (opts.tone === "dark") {
    if (ortho.tone === "dark") {
      coreScore += 20;
      reasons.push("暗黑质感");
    } else if (ortho.tone === "photo") {
      coreScore += 6;
    } else {
      coreScore -= 14;
    }
  } else if (opts.tone === "light") {
    if (ortho.tone === "light") {
      coreScore += 12;
      reasons.push("浅底清爽");
    } else if (ortho.tone === "dark") {
      coreScore -= 12;
    }
  } else if (opts.tone === "photo") {
    if (ortho.tone === "photo") {
      coreScore += 16;
      reasons.push("全出血主图");
    }
  }

  // ---------------- Stage 2: Core Structural & Slot Match ----------------
  // 2.1 Archetype (highest structural authority, soft affinity fallback)
  if (opts.archetype) {
    if (ortho.archetype === opts.archetype) {
      coreScore += 36;
      reasons.push(`原型(${opts.archetype})`);
    } else if (ARCHETYPE_AFFINITY[opts.archetype]?.includes(ortho.archetype)) {
      coreScore += 21;
      reasons.push(`亲缘(${ortho.archetype})`);
    } else {
      coreScore -= 12;
    }
  }

  // 2.2 Capacity tier alignment
  if (opts.capacityTier) {
    if (ortho.capacityTier === opts.capacityTier) {
      coreScore += 18;
      reasons.push(`承载(${ortho.capacityTier})`);
    } else {
      const dist = Math.abs(
        (CAPACITY_ORDER[ortho.capacityTier] ?? 1) - (CAPACITY_ORDER[opts.capacityTier] ?? 1)
      );
      if (dist === 1) coreScore += 6;
      else if (dist >= 2) coreScore -= 26;
    }
  }

  // 2.3 Soft diagram_family affinity (NEVER hard SQL zeroing!)
  if (opts.diagramFamily) {
    const targetFam = opts.diagramFamily.toLowerCase();
    if (e.diagFam === targetFam) {
      coreScore += 24;
      reasons.push(`图示(${e.diagFam})`);
    } else if (DIAGRAM_FAMILY_AFFINITY[targetFam]?.includes(e.diagFam)) {
      coreScore += 11;
      reasons.push(`近亲图示(${e.diagFam})`);
    } else {
      coreScore -= 10;
    }
  } else if (e.diagFam) {
    coreScore += 3;
  }

  // 2.4 Purpose affinity (normalized so colloquial purposes don't trigger false -16)
  if (opts.purposeTerms.length > 0) {
    const matchedP = opts.purposeTerms.filter((t) => e.purpose.includes(t) || e.pageType.includes(t));
    const wantsCase = opts.purposeTerms.some((t) => t.includes("案例") || t.includes("复盘"));
    const wantsStrategy = opts.purposeTerms.some((t) =>
      ["策略", "方法", "洞察", "结构", "流程"].some((k) => t.includes(k))
    );
    if (matchedP.length > 0) {
      const primaryHit = matchedP.some((t) => e.purpose.startsWith(t) || e.purpose === t);
      coreScore += primaryHit ? 22 : 15;
      reasons.push(`用途(${e.purpose || e.pageType})`);
    } else {
      coreScore -= opts.crossDomain ? 4 : 12;
    }
    if (wantsCase) {
      if (r.mature_case === 1) {
        coreScore += 10;
        reasons.push("成熟案例");
      } else if (["执行策略", "方法论", "资源介绍", "公司介绍"].includes(e.purpose)) {
        coreScore -= 14;
      }
    } else if (wantsStrategy && !opts.crossDomain) {
      if (
        ["执行策略", "方法论", "洞察分析", "结构图示", "执行策略；结构图示", "方法论；结构图示"].includes(
          e.purpose
        )
      ) {
        coreScore += 8;
      } else if (e.purpose === "作品展示") {
        coreScore -= 14;
      }
    }
  }

  // 2.5 Layout & Logic matching
  if (opts.layoutTerms.length > 0) {
    const hitShort = opts.layoutTerms.filter((t) => e.layout.includes(t));
    const hitRaw = opts.layoutTerms.filter((t) => e.rawLayout.includes(t) || e.lg.includes(t));
    if (hitShort.length > 0) {
      coreScore += 22 + Math.min(6, 2 * (hitShort.length - 1));
      reasons.push(`布局(${hitShort.slice(0, 2).join(",")})`);
    } else if (hitRaw.length > 0) {
      coreScore += 14 + Math.min(4, 2 * (hitRaw.length - 1));
      reasons.push(`详述布局(${hitRaw.slice(0, 2).join(",")})`);
    } else {
      coreScore -= 18;
    }
  }

  if (opts.logicTerms.length > 0) {
    const hitL = opts.logicTerms.filter(
      (t) => e.logic.includes(t) || e.rawLayout.includes(t) || e.diagLabels.includes(t)
    );
    if (hitL.length > 0) {
      coreScore += 14;
      reasons.push(`逻辑(${hitL.slice(0, 2).join(",")})`);
    } else {
      coreScore -= 8;
    }
  }

  // 2.6 Table & Chart strong boost (real tables only, never fooled by 2-column bullet slides!)
  if (opts.hasTable === true) {
    if (e.hasTable) {
      coreScore += 36;
      reasons.push("含真表格");
    } else {
      coreScore -= 36;
    }
  }
  if (opts.hasChart === true) {
    if (e.hasChart) {
      coreScore += 24;
      reasons.push("含图表");
    } else {
      coreScore -= 22;
    }
  }

  // 2.7 Topic, Keywords & Negative Keywords
  if (opts.topicTerms.length > 0 && !opts.crossDomain) {
    const hitT = opts.topicTerms.filter((t) => e.topic.includes(t) || e.rawTitle.includes(t));
    if (hitT.length > 0) {
      coreScore += 12;
      reasons.push(`主题(${hitT.slice(0, 2).join(",")})`);
    }
  }
  if (opts.kwTokensLower.length > 0) {
    const hits = opts.kwTokensLower.filter((tok) => e.searchBlob.includes(tok)).length;
    if (hits === opts.kwTokensLower.length) {
      coreScore += 16;
      reasons.push(`关键词全命中(${hits}/${opts.kwTokensLower.length})`);
    } else if (hits > 0) {
      coreScore += 8 * (hits / opts.kwTokensLower.length);
    } else {
      coreScore -= 14;
    }
  }
  if (opts.excludeKwLower.length > 0) {
    const negHits = opts.excludeKwLower.filter((tok) => e.searchBlob.includes(tok)).length;
    if (negHits > 0) {
      coreScore -= Math.min(60, 30 * negHits);
    }
  }

  // 2.8 Bidirectional slot isomorphism (image / text / results)
  if (typeof opts.targetImages === "number" && Number.isFinite(opts.targetImages)) {
    const targetI = opts.targetImages;
    const img = r.image_slots;
    if (img === null || img === undefined) {
      coreScore -= 5;
    } else if (targetI === 0) {
      if (img === 0) {
        coreScore += 24;
        reasons.push("无图纯结构(图=0)");
      } else if (img === 1) {
        coreScore += 2;
      } else {
        coreScore -= Math.min(40, 8 * img);
      }
    } else if (img === 0) {
      coreScore -= 30;
    } else {
      const diff = Math.abs(img - targetI);
      coreScore += Math.max(-20, 24 - 5 * diff);
      if (diff <= 2) reasons.push(`图槽同构(${img}≈${targetI})`);
    }
  }

  if (typeof opts.targetTextSlots === "number" && Number.isFinite(opts.targetTextSlots)) {
    const targetT = opts.targetTextSlots;
    const txt = r.text_slots;
    if (txt === null || txt === undefined) {
      coreScore -= 4;
    } else if (targetT <= 3) {
      const diff = Math.abs(txt - targetT);
      if (txt <= 4) {
        coreScore += Math.max(4, 22 - 4.5 * diff);
        reasons.push(`少元素留白(文=${txt})`);
      } else {
        coreScore -= Math.min(34, 5.5 * (txt - 3));
      }
    } else if (txt <= 1) {
      coreScore -= 28;
    } else if (txt === 2 && targetT >= 5) {
      coreScore -= 16;
    } else {
      const diff = Math.abs(txt - targetT);
      coreScore += Math.max(-18, 22 - 3 * diff);
      if (diff <= 2) reasons.push(`文槽同构(${txt}≈${targetT})`);
    }
  }

  if (typeof opts.targetResults === "number" && Number.isFinite(opts.targetResults)) {
    const targetR = opts.targetResults;
    const res = r.result_slots || 0;
    const hasIndRes = r.independent_results_area === 1;
    const nonEmp = /非|无|未见/.test(String(r.result_form || ""));
    if (targetR === 0) {
      if (res === 0 && !hasIndRes) {
        coreScore += 14;
        reasons.push("无冗余成果栏");
      } else {
        coreScore -= Math.min(18, 5 + 3 * res);
      }
    } else if (res === 0 && !hasIndRes) {
      coreScore -= 22;
    } else {
      const diff = res > 0 ? Math.abs(res - targetR) : 2;
      let pts = Math.max(-10, 20 - 3 * diff);
      if (hasIndRes) pts += 6;
      if (nonEmp) pts -= 10;
      coreScore += pts;
      if (res > 0 && !nonEmp) reasons.push(`实证成果槽(${res})`);
    }
  }

  // 2.9 Deck-level choreography: adjacent anti-collision, deck coherence, clean chrome bias
  if (opts.avoidLayoutSigs.size > 0 && opts.avoidLayoutSigs.has(e.layoutSig)) {
    coreScore -= 16;
  }
  if (opts.preferDecks.size > 0 && opts.preferDecks.has(e.deckKey)) {
    coreScore += 10;
    reasons.push("同套画风加权");
  }
  if (opts.cleanChromeBias) {
    if (ortho.chrome === "frameless") coreScore += 3;
    else if (ortho.chrome.includes("bordered")) coreScore -= 4;
  }

  // ---------------- Stage 3: Clamped Bucket-Relative Aesthetic Multiplier ----------------
  let finalScore = coreScore;
  const tier = ortho.aestheticTier;
  if (tier <= 1) {
    finalScore = Math.min(coreScore, 10) - 35;
  } else if (coreScore > 20) {
    const mult = tier >= 5 ? 1.12 : tier === 4 ? 1.04 : tier === 3 ? 0.96 : 0.80;
    finalScore = coreScore * mult;
    if (tier >= 5) reasons.push("S级审美");
    else if (tier === 4) reasons.push("A级审美");
  } else if (tier === 2) {
    finalScore -= 6;
  }

  return {
    score: Number(finalScore.toFixed(1)),
    coreScore: Number(coreScore.toFixed(1)),
    reasons,
  };
}

/**
 * Queries either:
 * 1) Unified `pages` schema (`ppt-index-dist.db` / `ppt-index-trial.db` / `ppt-index-lite.db` / `ppt-index.db`)
 *    backed by an in-process mtime+size memory snapshot cache + 3-stage `Selection Engine 2.0` scoring; OR
 * 2) Legacy `slides` schema (`yuanmou-slide-index.db`).
 */
export async function querySlideIndexDb(dbPath, filter = {}, providerId = "feishu") {
  if (!dbPath || !existsSync(dbPath)) return [];

  const tableRows = await runSqliteQuery(dbPath, "SELECT name FROM sqlite_master WHERE type='table'");
  const tableSet = new Set(tableRows.map((r) => r.name));

  if (tableSet.has("pages")) {
    return queryPagesSchema(dbPath, filter, providerId);
  }
  if (tableSet.has("slides")) {
    return queryLegacySlidesSchema(dbPath, filter, providerId);
  }
  return [];
}

async function queryPagesSchema(dbPath, filter = {}, providerId = "feishu") {
  const snapshot = await loadPagesSnapshot(dbPath);
  const {
    purpose,
    topic,
    pageType,
    includeNonBody = false,
    diagramFamily,
    archetype,
    capacityTier,
    copyPolicy = "distill",
    tone,
    crossDomain = false,
    allowSceneSpecific,
    excludeKeywords,
    excludeTopics,
    blacklistPath,
    disableDefaultBlacklist = false,
    avoidLayouts,
    preferDecks,
    cleanChromeBias = false,
    targetImages,
    targetTextSlots,
    targetResults,
    minImages,
    maxImages,
    minTextSlots,
    maxTextSlots,
    minResults,
    maxResults,
    stages,
    whiteBackground,
    matureCase,
    layout,
    logic,
    exclude,
    hasTable,
    hasChart,
    keywords,
    contentPageId,
    maxPerDeck = 3,
    maxPerLayoutSig = 2,
    minMatchThreshold = 24,
    limit = 12,
  } = filter;

  const excludeSet = parseExcludeIds(exclude);
  if (!disableDefaultBlacklist || blacklistPath) {
    for (const id of loadBlacklistIds(blacklistPath)) excludeSet.add(id);
  }

  const pageTypeTerms = splitTerms(pageType === "any" ? "" : pageType);
  const normArchetype = normalizeArchetype(archetype);
  const normCapacity = normalizeCapacityTier(capacityTier);
  const normPurposeTerms = normalizePurposeTerms(purpose);
  const layoutTerms = splitTerms(layout);
  const logicTerms = splitTerms(logic);
  const topicTerms = splitTerms(topic);
  const kwTokens = Array.isArray(keywords)
    ? keywords.map((k) => String(k).trim()).filter(Boolean)
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/).filter(Boolean)
      : [];
  const kwTokensLower = kwTokens.map((k) => k.toLowerCase());
  const excludeKwLower = [
    ...splitTerms(excludeKeywords),
    ...splitTerms(excludeTopics),
  ].map((k) => k.toLowerCase());

  const resolvedTone =
    tone && tone !== "any"
      ? String(tone).toLowerCase()
      : whiteBackground === true
        ? "light"
        : "any";

  const wantsSocialOrEvidence =
    normArchetype === "evidence_showcase" ||
    normPurposeTerms.some((t) => t.includes("案例") || t.includes("作品") || t.includes("内容示例")) ||
    [...topicTerms, ...kwTokens].some((t) => /小红书|笔记|达人|kol|抖音|微博|截图|实证|案例/i.test(t));

  const avoidLayoutSigs = new Set(
    Array.isArray(avoidLayouts) ? avoidLayouts : avoidLayouts ? [String(avoidLayouts)] : []
  );
  const preferDeckSet = new Set(
    Array.isArray(preferDecks) ? preferDecks : preferDecks ? [String(preferDecks)] : []
  );

  const scoringOpts = {
    archetype: normArchetype,
    capacityTier: normCapacity,
    copyPolicy: copyPolicy === "preserve" ? "preserve" : "distill",
    tone: resolvedTone,
    crossDomain: Boolean(crossDomain),
    allowSceneSpecific,
    wantsSocialOrEvidence,
    purposeTerms: normPurposeTerms,
    layoutTerms,
    logicTerms,
    topicTerms,
    kwTokensLower,
    excludeKwLower,
    diagramFamily: diagramFamily && diagramFamily !== "any" ? String(diagramFamily) : "",
    hasTable: hasTable === true,
    hasChart: hasChart === true,
    targetImages,
    targetTextSlots,
    targetResults,
    avoidLayoutSigs,
    preferDecks: preferDeckSet,
    cleanChromeBias: Boolean(cleanChromeBias),
  };

  const hasScoring =
    Boolean(normArchetype) ||
    Boolean(normCapacity) ||
    Boolean(scoringOpts.diagramFamily) ||
    normPurposeTerms.length > 0 ||
    layoutTerms.length > 0 ||
    logicTerms.length > 0 ||
    topicTerms.length > 0 ||
    kwTokensLower.length > 0 ||
    excludeKwLower.length > 0 ||
    scoringOpts.hasTable ||
    scoringOpts.hasChart ||
    resolvedTone !== "any" ||
    Boolean(crossDomain) ||
    copyPolicy === "preserve" ||
    typeof targetImages === "number" ||
    typeof targetTextSlots === "number" ||
    typeof targetResults === "number";

  const scored = [];
  const seenCid = new Set();

  for (let i = 0; i < snapshot.entries.length; i++) {
    const e = snapshot.entries[i];
    const cid = e.cid;
    if (!cid || excludeSet.has(cid) || seenCid.has(cid)) continue;

    if (contentPageId && cid !== String(contentPageId)) continue;

    // Page-type gate
    if (pageTypeTerms.length > 0) {
      if (!pageTypeTerms.some((pt) => e.pageType.includes(pt))) continue;
    } else if (!includeNonBody && !contentPageId && e.nonBody) {
      continue;
    }

    // Explicit hard numeric/boolean constraints
    const r = e.r;
    if (typeof stages === "number" && Number.isFinite(stages) && r.stage_count !== stages) continue;
    if (whiteBackground === true && !(r.white_background === 1 || e.bg.includes("白"))) continue;
    if (matureCase === true && r.mature_case !== 1) continue;
    if (typeof minImages === "number" && (r.image_slots ?? -1) < minImages) continue;
    if (typeof maxImages === "number" && (r.image_slots ?? 9999) > maxImages) continue;
    if (typeof minTextSlots === "number" && (r.text_slots ?? -1) < minTextSlots) continue;
    if (typeof maxTextSlots === "number" && (r.text_slots ?? 9999) > maxTextSlots) continue;
    if (typeof minResults === "number" && (r.result_slots ?? -1) < minResults) continue;
    if (typeof maxResults === "number" && (r.result_slots ?? 9999) > maxResults) continue;

    seenCid.add(cid);
    const { score, coreScore, reasons } = hasScoring
      ? scoreSnapshotEntry(e, scoringOpts)
      : {
          score: e.status.includes("受阻") ? -45 : e.ortho.aestheticTier * 4 + (e.diagFam ? 4 : 0),
          coreScore: e.status.includes("受阻") ? -45 : e.ortho.aestheticTier * 4,
          reasons: [],
        };
    scored.push({ e, score, coreScore, reasons });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.e.cid.localeCompare(b.e.cid);
  });

  // Diversity & anti-repetition pass:
  // 1) Cap same-deck repeats (`maxPerDeck`)
  // 2) Cap identical (layout, archetype) visual signatures (`maxPerLayoutSig`, default 2) to prevent clone walls
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const capPerDeck = maxPerDeck > 0 ? maxPerDeck : 999999;
  const capPerSig = maxPerLayoutSig > 0 ? maxPerLayoutSig : 999999;
  const deckCounts = new Map();
  const sigCounts = new Map();
  const picked = [];
  const deferred = [];

  for (const entry of scored) {
    const { e } = entry;
    const dUsed = deckCounts.get(e.deckKey) || 0;
    if (e.deckKey !== "||" && dUsed >= capPerDeck) continue;
    const sUsed = sigCounts.get(e.layoutSig) || 0;
    if (sUsed >= capPerSig) {
      deferred.push(entry);
      continue;
    }
    deckCounts.set(e.deckKey, dUsed + 1);
    sigCounts.set(e.layoutSig, sUsed + 1);
    picked.push(entry);
    if (picked.length >= safeLimit) break;
  }

  // Graceful backfill if diversity cap left fewer than requested
  if (picked.length < safeLimit && deferred.length > 0) {
    for (const entry of deferred) {
      const { e } = entry;
      const dUsed = deckCounts.get(e.deckKey) || 0;
      if (e.deckKey !== "||" && dUsed >= capPerDeck) continue;
      deckCounts.set(e.deckKey, dUsed + 1);
      picked.push(entry);
      if (picked.length >= safeLimit) break;
    }
  }

  const topCoreScore = picked[0]?.coreScore ?? -999;
  const fallbackRecommended = hasScoring && (picked.length === 0 || topCoreScore < minMatchThreshold);
  const offlinePatternHint =
    OFFLINE_PATTERN_HINTS[normArchetype || picked[0]?.e.ortho.archetype || "editorial_freeform"] ||
    OFFLINE_PATTERN_HINTS.editorial_freeform;

  return picked.map(({ e, score, coreScore, reasons }) => {
    const r = e.r;
    const rawPrev = r.preview_file || r.preview_path || `${r.content_page_id}.png`;
    const previewFile = path.basename(String(rawPrev).replace(/\\/g, "/"));
    return {
      provider: providerId,
      slideUid: r.content_page_id,
      contentPageId: r.content_page_id,
      sku: r.content_page_id,
      deckTitle: r.business_topic || r.layout || r.content_page_id,
      deckKey: e.deckKey,
      slideNo: r.physical_page || 1,
      purpose: r.business_purpose || r.page_type || "general",
      pageType: r.page_type || undefined,
      diagramFamily: r.diagram_family || undefined,
      diagramLabels: r.diagram_labels || undefined,
      // Selection Engine 2.0 `ortho_v3` metadata
      archetype: e.ortho.archetype,
      transferability: e.ortho.transferability,
      capacityTier: e.ortho.capacityTier,
      aestheticTier: e.ortho.aestheticTier,
      toneChrome: e.ortho.toneChrome,
      layoutSignature: e.layoutSig,
      imageCount: r.image_slots ?? 0,
      textSlots: r.text_slots ?? 0,
      resultCount: r.result_slots ?? 0,
      whiteBackground: e.ortho.tone === "light",
      hasTable: e.hasTable,
      hasChart: e.hasChart,
      layoutSummary: r.raw_layout || r.layout || "",
      visualTraits: r.raw_visual || r.visual_traits || "",
      restoreNote: r.restore_note || undefined,
      previewFile,
      feishuFileToken: r.feishu_file_token || undefined,
      matchScore: hasScoring ? score : undefined,
      coreScore: hasScoring ? coreScore : undefined,
      matchReasons: reasons.length > 0 ? reasons : undefined,
      fallbackRecommended: fallbackRecommended || undefined,
      offlinePatternHint: fallbackRecommended ? offlinePatternHint : undefined,
    };
  });
}

async function queryLegacySlidesSchema(dbPath, filter = {}, providerId = "zsxq") {
  const {
    purpose,
    minImages,
    maxImages,
    minTextSlots,
    maxTextSlots,
    hasTable,
    hasChart,
    keywords,
    sku,
    limit = 12,
  } = filter;

  const clauses = ["1=1"];
  const params = [];

  if (sku) {
    clauses.push("sku = ?");
    params.push(String(sku));
  }
  if (purpose && purpose !== "any") {
    clauses.push("(purpose = ? OR keywords LIKE ?)");
    params.push(String(purpose), `%${purpose}%`);
  }
  if (typeof minImages === "number") {
    clauses.push("image_count >= ?");
    params.push(minImages);
  }
  if (typeof maxImages === "number") {
    clauses.push("image_count <= ?");
    params.push(maxImages);
  }
  if (typeof minTextSlots === "number") {
    clauses.push("text_slots >= ?");
    params.push(minTextSlots);
  }
  if (typeof maxTextSlots === "number") {
    clauses.push("text_slots <= ?");
    params.push(maxTextSlots);
  }
  if (hasTable === true) {
    clauses.push("has_table = 1");
  }
  if (hasChart === true) {
    clauses.push("has_chart = 1");
  }
  const kwTokens = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string" && keywords.trim()
      ? keywords.trim().split(/\s+/)
      : [];
  for (const kw of kwTokens) {
    const pat = `%${kw}%`;
    clauses.push("(deck_title LIKE ? OR layout_summary LIKE ? OR keywords LIKE ? OR style_tags LIKE ?)");
    params.push(pat, pat, pat, pat);
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 12));
  const sql = `
    SELECT slide_uid, sku, deck_title, slide_no, purpose, image_count, text_slots, result_count,
           has_table, has_chart, layout_summary, keywords, style_tags, topic_id, file_id, group_id,
           tier, r2_object_key, preview_key
    FROM slides
    WHERE ${clauses.join(" AND ")}
    ORDER BY has_chart DESC, has_table DESC, sku ASC, slide_no ASC
    LIMIT ${safeLimit}
  `;

  const rows = await runSqliteQuery(dbPath, sql, params);
  return rows.map((r) => ({
    provider: providerId,
    slideUid: r.slide_uid,
    sku: r.sku,
    deckTitle: r.deck_title,
    slideNo: r.slide_no,
    purpose: r.purpose,
    imageCount: r.image_count,
    textSlots: r.text_slots,
    resultCount: r.result_count,
    hasTable: Boolean(r.has_table),
    hasChart: Boolean(r.has_chart),
    layoutSummary: r.layout_summary,
    keywords: r.keywords,
    styleTags: r.style_tags,
    topicId: r.topic_id || undefined,
    fileId: r.file_id || undefined,
    groupId: r.group_id || undefined,
    tier: r.tier,
    r2ObjectKey: r.r2_object_key || undefined,
    previewKey: r.preview_key || undefined,
  }));
}

function parsePageRangeSpec(spec) {
  if (!spec || String(spec).trim().toLowerCase() === "all") return null;
  const out = new Set();
  for (const part of String(spec).split(/[,，\s]+/)) {
    const clean = part.trim();
    if (!clean) continue;
    const range = clean.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) out.add(n);
    } else if (/^\d+$/.test(clean)) {
      out.add(Number(clean));
    }
  }
  return out.size > 0 ? out : null;
}

/**
 * Loads (or builds once per DB mtime+size) a tiny ~150KB deck-level summary catalog
 * (`<dbPath>.decks-cache.json`) so repeated CLI invocations of `search-decks` and
 * filename-based `deck-outline` run in <5ms instead of re-scanning a 180MB SQLite table.
 * Never mutates the DB; silently skips disk cache if directory is read-only.
 */
async function loadDeckCatalog(dbPath) {
  if (!dbPath || !existsSync(dbPath)) {
    return { supported: false, reason: "Index DB not found", decks: [] };
  }
  const absPath = path.resolve(dbPath);
  const st = statSync(absPath);
  const memKey = `${absPath}|${st.mtimeMs}|${st.size}`;
  const memHit = DECK_CATALOG_CACHE.get(memKey);
  if (memHit) return memHit;

  const sidecarPath = `${absPath}.decks-cache.json`;
  if (existsSync(sidecarPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sidecarPath, "utf8"));
      if (
        parsed?.schemaVersion === 1 &&
        parsed.mtimeMs === st.mtimeMs &&
        parsed.size === st.size &&
        Array.isArray(parsed.decks)
      ) {
        const res = { supported: true, decks: parsed.decks, fromCache: true };
        DECK_CATALOG_CACHE.set(memKey, res);
        return res;
      }
    } catch {
      // corrupt or stale sidecar -> rebuild cleanly
    }
  }

  const tableRows = await runSqliteQuery(absPath, "SELECT name FROM sqlite_master WHERE type='table'");
  const tableSet = new Set(tableRows.map((r) => r.name));
  if (!tableSet.has("pages")) {
    return { supported: false, reason: "Deck filename search requires unified pages schema", decks: [] };
  }

  const colRows = await runSqliteQuery(absPath, "PRAGMA table_info(pages)");
  const colSet = new Set(colRows.map((c) => c.name));
  if (!colSet.has("file_name") || !colSet.has("full_sha256")) {
    return {
      supported: false,
      reason: "Current index DB is sanitized (no file_name column). Deck-level filename search is available on private/local full indexes.",
      decks: [],
    };
  }

  const hasAes = colSet.has("aesthetic_tier");
  const hasTc = colSet.has("tone_chrome");
  const hasPrevPath = colSet.has("preview_path");
  const aesExpr = hasAes ? "ROUND(AVG(coalesce(aesthetic_tier, 3)), 2)" : "NULL";
  const darkExpr = hasTc
    ? "SUM(CASE WHEN tone_chrome LIKE 'dark:%' THEN 1 ELSE 0 END)"
    : "SUM(CASE WHEN background LIKE '%黑%' OR background LIKE '%深%' THEN 1 ELSE 0 END)";
  const lightExpr = hasTc
    ? "SUM(CASE WHEN tone_chrome LIKE 'light:%' THEN 1 ELSE 0 END)"
    : "SUM(CASE WHEN white_background = 1 OR background LIKE '%白%' THEN 1 ELSE 0 END)";
  const prevExpr = hasPrevPath
    ? "SUM(CASE WHEN coalesce(preview_path, '') != '' THEN 1 ELSE 0 END)"
    : "COUNT(*)";

  const rows = await runSqliteQuery(
    absPath,
    `
      SELECT
        full_sha256,
        file_name,
        COUNT(*) AS total_pages,
        SUM(CASE WHEN page_type = '正文页' THEN 1 ELSE 0 END) AS body_pages,
        ${darkExpr} AS dark_pages,
        ${lightExpr} AS light_pages,
        ${aesExpr} AS avg_aes,
        ${prevExpr} AS has_previews,
        MIN(CASE WHEN physical_page = 1 THEN content_page_id END) AS cover_cid
      FROM pages
      WHERE coalesce(file_name, '') != ''
      GROUP BY full_sha256, file_name
    `
  );

  const decks = rows.map((r) => ({
    deckId: String(r.full_sha256 || "").slice(0, 12),
    fullSha256: r.full_sha256,
    fileName: r.file_name,
    totalPages: Number(r.total_pages) || 0,
    bodyPages: Number(r.body_pages) || 0,
    darkPages: Number(r.dark_pages) || 0,
    lightPages: Number(r.light_pages) || 0,
    avgAestheticTier: r.avg_aes !== null && r.avg_aes !== undefined ? Number(r.avg_aes) : null,
    hasPreviewsCount: Number(r.has_previews) || 0,
    coverContentPageId: r.cover_cid || null,
  }));

  try {
    const tmpSidecar = `${sidecarPath}.${process.pid}.tmp`;
    writeFileSync(
      tmpSidecar,
      JSON.stringify({ schemaVersion: 1, mtimeMs: st.mtimeMs, size: st.size, decks }),
      "utf8"
    );
    renameSync(tmpSidecar, sidecarPath);
  } catch {
    // read-only directory -> fine, in-memory cache still works
  }

  for (const k of [...DECK_CATALOG_CACHE.keys()]) {
    if (k.startsWith(`${absPath}|`) || DECK_CATALOG_CACHE.size >= MAX_SNAPSHOT_CACHE_ENTRIES) {
      DECK_CATALOG_CACHE.delete(k);
    }
  }
  const res = { supported: true, decks, fromCache: false };
  DECK_CATALOG_CACHE.set(memKey, res);
  return res;
}

/**
 * Ultra-fast (<5ms warm) deck-level search by `file_name` without loading tens of thousands of slide rows.
 * On sanitized public index DBs (which omit `file_name` for privacy), returns `{ supported: false }`.
 */
export async function queryDecksByFilename(dbPath, filter = {}, providerId = "local") {
  const catalog = await loadDeckCatalog(dbPath);
  if (!catalog.supported) {
    return { supported: false, reason: catalog.reason, count: 0, decks: [] };
  }

  const {
    keywords,
    excludeKeywords,
    tone = "any",
    minPages = 3,
    minAesthetic,
    limit = 20,
  } = filter;

  // Space-separated groups are ANDed; comma-separated terms inside a group are ORed
  const kwRaw = Array.isArray(keywords) ? keywords.join(" ") : String(keywords || "").trim();
  const andGroups = kwRaw
    ? kwRaw
        .split(/\s+/)
        .filter(Boolean)
        .map((grp) =>
          grp
            .split(/[,，|｜/]+/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        )
        .filter((g) => g.length > 0)
    : [];
  const negTerms = splitTerms(excludeKeywords).map((t) => t.toLowerCase());
  const minP = Math.max(1, Number(minPages) || 1);
  const hasMinAes = typeof minAesthetic === "number" && Number.isFinite(minAesthetic);

  const matched = [];
  for (const d of catalog.decks) {
    if (d.totalPages < minP) continue;
    if (hasMinAes && (d.avgAestheticTier ?? 3) < minAesthetic) continue;
    const fnameLower = String(d.fileName || "").toLowerCase();
    if (andGroups.length > 0 && !andGroups.every((orTerms) => orTerms.some((t) => fnameLower.includes(t)))) {
      continue;
    }
    if (negTerms.length > 0 && negTerms.some((nt) => fnameLower.includes(nt))) {
      continue;
    }
    matched.push(d);
  }

  matched.sort((a, b) => {
    const aesA = a.avgAestheticTier ?? 3;
    const aesB = b.avgAestheticTier ?? 3;
    if (tone === "dark") {
      return b.darkPages - a.darkPages || aesB - aesA || b.totalPages - a.totalPages;
    }
    if (tone === "light") {
      return b.lightPages - a.lightPages || aesB - aesA || b.totalPages - a.totalPages;
    }
    return aesB - aesA || b.totalPages - a.totalPages;
  });

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const decks = matched.slice(0, safeLimit).map((d) => ({
    provider: providerId,
    deckId: d.deckId,
    fullSha256: d.fullSha256,
    fileName: d.fileName,
    totalPages: d.totalPages,
    bodyPages: d.bodyPages,
    darkPages: d.darkPages,
    lightPages: d.lightPages,
    avgAestheticTier: d.avgAestheticTier ?? undefined,
    hasPreviewsCount: d.hasPreviewsCount,
    coverContentPageId: d.coverContentPageId || undefined,
  }));

  return { supported: true, count: decks.length, decks };
}

/**
 * Ultra-fast (<10ms) ordered page outline for a single deck (by `full_sha256` prefix or `file_name`),
 * supporting optional page range selection (`--pages "1,2,5-10"`) so only inspected slides fetch previews.
 */
export async function queryDeckOutline(dbPath, filter = {}, providerId = "local") {
  const catalog = await loadDeckCatalog(dbPath);
  if (!catalog.supported) {
    return { supported: false, reason: catalog.reason, deck: null, pages: [] };
  }

  const deckSpec = String(filter.deck || "").trim();
  if (!deckSpec) {
    throw new Error("queryDeckOutline requires `deck` (full_sha256 prefix or file_name substring)");
  }

  const specLower = deckSpec.toLowerCase();
  const isHexPrefix = /^[0-9a-f]{6,64}$/i.test(deckSpec);
  let target = null;
  if (isHexPrefix) {
    const hexHits = catalog.decks
      .filter((d) => String(d.fullSha256 || "").toLowerCase().startsWith(specLower))
      .sort((a, b) => b.totalPages - a.totalPages);
    target = hexHits[0] || null;
  }
  if (!target) {
    const nameHits = catalog.decks
      .filter((d) => String(d.fileName || "").toLowerCase().includes(specLower))
      .sort((a, b) => b.totalPages - a.totalPages);
    target = nameHits[0] || null;
  }
  if (!target) {
    return { supported: true, deck: null, pages: [], reason: `No deck matched "${deckSpec}"` };
  }

  const colRows = await runSqliteQuery(dbPath, "PRAGMA table_info(pages)");
  const colSet = new Set(colRows.map((c) => c.name));
  const wantedCols = [
    "content_page_id",
    "physical_page",
    "page_type",
    "business_purpose",
    "business_topic",
    "raw_title",
    "layout",
    "raw_layout",
    "preview_file",
    "preview_path",
    "archetype",
    "transferability",
    "capacity_tier",
    "aesthetic_tier",
    "tone_chrome",
    "image_slots",
    "text_slots",
    "result_slots",
    "restore_note",
    "feishu_file_token",
  ].filter((c) => colSet.has(c));

  const includeNonBody = filter.includeNonBody !== false;
  const rows = await runSqliteQuery(
    dbPath,
    `SELECT ${wantedCols.join(", ")} FROM pages WHERE full_sha256 = ? ORDER BY physical_page ASC`,
    [target.fullSha256]
  );

  const pageRange = parsePageRangeSpec(filter.pages);
  const safeLimit = Math.max(1, Math.min(300, Number(filter.limit) || 120));
  const pages = [];
  for (const r of rows) {
    if (!includeNonBody && isNonContentPageType(r.page_type)) continue;
    if (pageRange && !pageRange.has(Number(r.physical_page))) continue;
    const rawPrev = r.preview_file || r.preview_path || `${r.content_page_id}.png`;
    pages.push({
      provider: providerId,
      slideNo: r.physical_page,
      contentPageId: r.content_page_id,
      pageType: r.page_type || "正文页",
      title: r.raw_title || r.business_topic || r.layout || `第 ${r.physical_page} 页`,
      purpose: r.business_purpose || undefined,
      archetype: r.archetype || undefined,
      transferability: r.transferability || undefined,
      capacityTier: r.capacity_tier || undefined,
      aestheticTier: r.aesthetic_tier ?? undefined,
      toneChrome: r.tone_chrome || undefined,
      imageCount: r.image_slots ?? 0,
      textSlots: r.text_slots ?? 0,
      resultCount: r.result_slots ?? 0,
      layoutSummary: r.raw_layout || r.layout || "",
      restoreNote: r.restore_note || undefined,
      previewFile: path.basename(String(rawPrev).replace(/\\/g, "/")),
      feishuFileToken: r.feishu_file_token || undefined,
    });
    if (pages.length >= safeLimit) break;
  }

  return {
    supported: true,
    deck: {
      deckId: target.deckId,
      fullSha256: target.fullSha256,
      fileName: target.fileName,
      totalPages: target.totalPages,
    },
    returnedPages: pages.length,
    pages,
  };
}
