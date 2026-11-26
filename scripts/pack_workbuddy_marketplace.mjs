#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Builds a 100% compliant, pure-offline-engine `dist/yuanmou-ppt-workbuddy-marketplace.zip`
// tailored for Tencent WorkBuddy Open Platform (`open.workbuddy.cn`) public Skill Marketplace review:
// - Strictly conforms to WorkBuddy YAML frontmatter (`display_name`, `display_name_en`, `description_zh`, `description_en`, `version`, `author`, `examples_zh`, `examples_en`)
// - Strictly conforms to WorkBuddy folder layout (`SKILL.md`, `scripts/`, `references/` only)
// - Disables third-party cloud preview library & external promotional copy (pure original OOXML engine + user-provided files / optional `YUANMOU_LOCAL_DIR`)

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const WORKBUDDY_SKILL_MD = `---
name: yuanmou-ppt
display_name: 渊眸可编辑PPT生成与复刻引擎
display_name_en: Yuanmou Editable PPTX Engine
description: 一句话生成原生可编辑PPT、截图与PDF 1:1矢量复刻为PPTX、既有PPTX无损改版及内嵌.xlsx电子表格真图表（基于零依赖原生OOXML引擎，支持11道自动质检门禁与真机渲染验收）
description_zh: 基于纯Node.js零第三方npm依赖的原生OOXML引擎，支持一句话策划生成整套可编辑.pptx演示文稿、将用户提供的参考截图或PDF 1:1矢量复刻为可编辑PPTX、对既有.pptx母本无损换字换图，以及生成双击可改数的内嵌.xlsx数据真图表与原生表格；内置11道代码质检门禁与真机渲染验收。运行需本机安装Node.js>=22.5、LibreOffice与Poppler。
description_en: Zero-dependency native OOXML (.pptx) engine for generating editable slide decks from a topic, 1:1 vector redrawing from user-provided screenshots or PDFs, lossless editing of existing .pptx templates, and creating .xlsx-backed editable charts with 11 automated QA gates. Requires Node.js>=22.5, LibreOffice, and Poppler.
version: 0.1.1
author: "渊眸策略"
examples_zh:
  - "帮我根据这份产品方案文稿，策划并生成一套 6 页可编辑商业汇报 PPT，包含原生柱状图与对比表格"
  - "把我上传的这张参考排版截图 1:1 复刻成 PPTX 原生可编辑形状，并替换成我的季度复盘数据"
  - "保留这份公司既有 .pptx 模板的母版样式与图片蒙版，把第 2 页和第 5 页原位更新成最新业务内容"
examples_en:
  - "Create a 6-slide editable business presentation (.pptx) from this brief with native .xlsx-backed bar charts and tables"
  - "Redraw this reference slide screenshot into native editable PPTX shapes and replace the copy with my quarterly metrics"
  - "Update slides 2 and 5 of this existing .pptx template in place while preserving master styles and image masks"
---

# 渊眸可编辑 PPT 生成与复刻引擎（\`@yuanmou/pptx-kit\`）

> 下文 \`<SKILL_DIR>\` 指本 \`SKILL.md\` 所在目录。无论当前处于哪个工作目录，一律通过 \`<SKILL_DIR>/scripts/{deck_cli,provider_cli,kit}.mjs\` 调用。本技能为纯本地离线原生 OOXML 引擎，不上传用户文件至外部服务器；运行需本机具备 **Node.js \`>=22.5\` + LibreOffice (\`soffice\`) + Poppler (\`pdftoppm\`)**。

## 1. 核心工程铁律

1. **纯原生 OOXML（禁止简化或贴图）**：所有构建、改版、表格与图表均调用 \`<SKILL_DIR>/scripts/kit.mjs\`；严禁 \`python-pptx\`，严禁简化/合并省略结构，严禁用整页背景图或截图碎片冒充表格、流程图或可编辑重绘。图表必须内嵌 \`.xlsx\` 工作簿以支持主流演示软件双击改数。
2. **单图形承载底色与富文本（严禁框中套框）**：圆角矩形、色带、圆形、箭头等带底色/描边节点必须在同一个 \`<p:sp>\` 上直接设置 \`fill / line / text / textStyle\`（多字号/多色使用富文本 \`runs\`）；**严禁在图形内另套内框、覆盖透明文本框或用编组冒充**；表格文字直写单元格；项目符号使用 \`makeBulletList()\`，禁手敲 \`"• "\`；禁 4+ 连续空格定位；跨端优先通用字体且窄标签留足 5% 宽度余量防换字掉孤字。
3. **只读保护与交付边界**：区分「内容源」与「版式参考」；用户要求源文件不动时严格只读并在副本制作（可用 \`verify --readonly-source\` 校验 SHA-256），核对物理页码、隐藏页与交付份数。
4. **强制视觉自检**：成稿必须通过 \`deck_cli.mjs verify\` 渲染核验；如缺少 LibreOffice 或 Poppler，先提示用户安装后再继续，严禁盲画交付。

## 2. 内容策划与版式规划（Step 0 ～ Step 1）

1. **一句话主题从零策划**：用户仅提供主题而无现成文稿时，先按 MECE 与金字塔原理拆出结论前置（Action Title）的逐页大纲、核心论点、正文文案、配图与图表建议（严禁编造真实客户战绩，示意数据明确标注口径）。
2. **按逻辑单元拆页**：不把 Markdown 章节或 PDF/Word 原页机械等同于 1 页 PPT；逐页明确页型（封面/目录/正文/封底）、图示逻辑（流程/漏斗/时间轴/层级/对比/矩阵）、图文槽位与是否需表格/图表。
3. **可选检索用户自有本地模板目录**：若用户本机配置了自有模板索引目录（\`YUANMOU_LOCAL_DIR\`），可通过 \`node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --out ./selection_board.html\` 检索并生成本地单选看板确认；未配置时直接按用户提供的参考图 / 既有 \`.pptx\` 或原生商业版式规划进入制作。

## 3. 双通道制作流（Step 2 ～ Step 4）

### 通道 A：既有 \`.pptx\` 母本无损改版（L1）
严禁新建空白页重画：\`inspectTemplateDeck\` 提取锚点 → 编写模板框位映射 JSON 并过 \`validateTemplatePlan\` → \`prepareStarterDeck\` 无损抽页并清理冗余媒体 → \`.text.set()\` / \`.text.replace()\` 保样式换字、\`.replace({ path, fit: "cover" })\` 保蒙版换图、原生表图注入 → \`auditTemplateFidelity\` 保真稽查。

### 通道 B：从零生成 / 用户截图与 PDF 1:1 复刻
多页任务用**模块化单页脚本**推进（在用户工作目录按页拆写 \`export function addSlide(deck) { ... }\`，再由总装入口脚本汇总 \`Presentation.create()\` 一次性导出）：
- **L2（常规卡片 / 表格 / 图表 / 时间轴）**：单步直出内容稿 → 跑 1 次 \`deck_cli.mjs verify\` 审阅 \`qa_sheet.png\` 多页总览图。
- **L3（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形，可按需查阅 \`@references/structure-and-text.md\`）**：
  1. \`node <SKILL_DIR>/scripts/deck_cli.mjs inspect-ref --ref ./ref.pdf --page 1 --out ./work/inspect\`（原生支持 PNG/JPG/PDF，自动采色与 2× 切片）；
  2. 先拼装 \`structure\` 骨架（\`buildRoundedTrapezoidPath\` / \`buildPolylineStrokeCommands\`），跑 \`verify --ref ./ref.png\` 核对 \`overlay_3panel.png\` 与自动定位的 \`zoom_hotspot_*_2x.png\`（1~2 轮收敛，自检通过即继续）；
  3. 切换 \`final\` 锁死几何/透明/字号/字色，优化文案并原位替换用户图文（有源 PPT 时优先提取内嵌原图）。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标保可见层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔规范

- 严禁编造数据、严禁把策略建议/目标/示意数字写成已实现成果，保留原稿指标名称、数值与统计周期；缺量化成果时仅呈现已有执行产出与定性成果，**待补数据放交付说明，严禁把 \`[待补充]\` / \`TBD\` 写进页内**。
- 禁用空洞套词（\`不是X而是Y\`、\`深度赋能\`、\`核心抓手\`、\`生态闭环\`、\`打出组合拳\`、\`底层逻辑重构\`、\`开启新篇章\`）、单段滥用 \`——\` 与行内假圆点 \`A • B • C\`。
- 内容页主标题结论前置；正文 \`>=12pt\`，挤不下先精简废话，不强缩字号。

## 5. 一条龙终检与视觉验收（Step 5）

交付前执行 1 条命令跑完 **11 道自动代码门禁**（ECMA-376 包结构、越界、碰撞、禁框中套框、内切宽度、WCAG 对比度、禁整页贴图冒充、禁长空格与假圆点、Anti-Slop、禁页内占位符、字体/表图数据同步）+ **缓存加速真机渲染** + **\`qa_sheet.png\` 总览图** + **自动热点 2× 对比 & Base64 HTML 画廊**：

\`\`\`bash
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \\
  --out ./work/qa --ref ./ref.png --gallery ./output/qa_gallery.html --anti-slop fail
\`\`\`

1. 必须实际查看 \`qa_sheet.png\`（及有参考图时的 \`side_by_side.png\` / \`zoom_hotspot_*_2x.png\`），不达标必须返工；
2. 交付 \`.pptx\` 与 Base64 HTML 对比画廊，并如实说明所用渲染器、字体替换与验证范围。

## 6. \`@yuanmou/pptx-kit\` API 速查（1280×720 坐标）

\`\`\`js
import {
  Presentation, finalizeDeck, makeBulletList, fr, fixed,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
} from "<SKILL_DIR>/scripts/kit.mjs";

const deck = Presentation.create({ title: "方案标题", defaultFont: "PingFang SC" });
const s = deck.slides.add({ background: "#FFFFFF" });
s.shapes.add({
  name: "卡片标题", geometry: "roundRect", borderRadius: 8,
  position: { left: 64, top: 120, width: 320, height: 56 },
  fill: "#0F3A7D", line: { fill: "#0F3A7D", width: 1 },
  text: "结论前置标题",
  textStyle: { fontSize: 18, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle", insets: { left: 10, right: 10, top: 6, bottom: 6 } },
});
s.images.add({ path: "./shot.png", position: { left: 64, top: 200, width: 420, height: 280 }, fit: "cover", borderRadius: 8 });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await finalizeDeck({ deck, outputPath: "./work/candidate.pptx", antiSlop: "fail" });
\`\`\`
`;

async function copyClean(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== ".DS_Store" && base !== "__pycache__" && !base.endsWith(".pyc");
    },
  });
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const distDir = path.join(REPO_ROOT, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const outZip = path.join(distDir, "yuanmou-ppt-workbuddy-marketplace.zip");

  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ym_wb_mkt_"));
  const bundleDir = path.join(stageRoot, "yuanmou-ppt");
  try {
    await fs.mkdir(bundleDir, { recursive: true });

    // 1) Strictly copy ONLY WorkBuddy-documented directories: SKILL.md, scripts/, references/
    await fs.writeFile(path.join(bundleDir, "SKILL.md"), WORKBUDDY_SKILL_MD, "utf8");
    await copyClean(path.join(REPO_ROOT, "skills", "yuanmou-ppt", "references"), path.join(bundleDir, "references"));
    await copyClean(path.join(REPO_ROOT, "skills", "yuanmou-ppt", "scripts"), path.join(bundleDir, "scripts"));

    // 2) Flatten zero-dep `pptx-kit` directly into `scripts/` so the zip strictly satisfies
    // WorkBuddy's 2-level directory depth limit (`yuanmou-ppt/{scripts,references}/<file>`).
    const kitSrcRoot = path.join(REPO_ROOT, "packages", "pptx-kit");
    const scriptsDir = path.join(bundleDir, "scripts");

    const fileMap = new Map(); // posix relPath from kitSrcRoot -> flat filename in scripts/
    fileMap.set("index.mjs", "kit-index.mjs");
    for (const f of await fs.readdir(path.join(kitSrcRoot, "src"))) {
      if (f.endsWith(".mjs")) fileMap.set(`src/${f}`, `kit-${f}`);
    }
    for (const f of await fs.readdir(path.join(kitSrcRoot, "src", "providers"))) {
      if (f.endsWith(".mjs")) fileMap.set(`src/providers/${f}`, `kit-provider-${f}`);
    }

    for (const [relPosix, flatName] of fileMap.entries()) {
      const srcPath = path.join(kitSrcRoot, ...relPosix.split("/"));
      let src = await fs.readFile(srcPath, "utf8");
      const origDir = path.posix.dirname(relPosix);
      src = src.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (full, pre, spec, post) => {
        const resolved = path.posix.normalize(origDir === "." ? spec : path.posix.join(origDir, spec));
        const mapped = fileMap.get(resolved);
        if (!mapped) {
          throw new Error(`Unmapped relative import ${spec} (resolved: ${resolved}) in ${relPosix}`);
        }
        return `${pre}./${mapped}${post}`;
      });
      await fs.writeFile(path.join(scriptsDir, flatName), src, "utf8");
    }

    // 3) Rewrite imports in `scripts/{kit,provider_cli,deck_cli}.mjs` -> `./kit-index.mjs`
    for (const cliFile of ["kit.mjs", "provider_cli.mjs", "deck_cli.mjs"]) {
      const p = path.join(scriptsDir, cliFile);
      const src = await fs.readFile(p, "utf8");
      await fs.writeFile(
        p,
        src.replace("../../../packages/pptx-kit/index.mjs", "./kit-index.mjs"),
        "utf8"
      );
    }

    // 4) Switch embedded `kit-provider-local-provider.mjs` to pure offline local mode
    const lpPath = path.join(scriptsDir, "kit-provider-local-provider.mjs");
    let lpSrc = await fs.readFile(lpPath, "utf8");
    lpSrc = lpSrc
      .replace(
        'export const DEFAULT_PUBLIC_TRIAL_BASE_URL = "https://ppt-trial.resourcehub.dpdns.org";',
        'export const DEFAULT_PUBLIC_TRIAL_BASE_URL = "";'
      )
      .replace(
        'process.env.YUANMOU_OFFLINE !== "1"',
        "false"
      )
      .replace(
        '"Local & Zero-Login Public Trial Library (10,000+ Slides)"',
        '"Local Standalone Native OOXML Engine (Offline)"'
      );
    await fs.writeFile(lpPath, lpSrc, "utf8");

    await fs.rm(outZip, { force: true });
    const zipRes = spawnSync("zip", ["-rq", outZip, "yuanmou-ppt"], {
      cwd: stageRoot,
      encoding: "utf8",
    });
    if (zipRes.status !== 0) {
      throw new Error(`zip failed: ${zipRes.stderr || zipRes.stdout}`);
    }

    const st = await fs.stat(outZip);
    console.log(
      JSON.stringify(
        {
          ok: true,
          variant: "workbuddy-marketplace-pure-offline",
          version: pkg.version,
          zipPath: outZip,
          bytes: st.size,
          kb: Number((st.size / 1024).toFixed(1)),
        },
        null,
        2
      )
    );
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
