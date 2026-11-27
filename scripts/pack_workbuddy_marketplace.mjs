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
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const WORKBUDDY_SKILL_MD = `---
name: yuanmou-ppt
display_name: 渊眸商业PPT
display_name_en: Yuanmou Business PPT
description: 告别熬夜排版！一句话生成可编辑商业PPT，支持截图与PDF 1:1矢量复刻、既有PPTX无损改版与内嵌.xlsx电子表格真图表（零依赖原生OOXML引擎，6大门禁组15项自动质检）
description_zh: 告别熬夜排版！一句话生成可编辑商业PPT，支持咨询级逐页大纲策划、参考截图或PDF 1:1矢量复刻（含半透明遮罩/菱形斜切/水墨笔刷蒙版）、既有.pptx母本无损改版，以及双击可改数的内嵌.xlsx电子表格真图表与原生表格；纯本地零第三方依赖运行，内置6大门禁组15项自动检查，缺渲染依赖时自动走静态门禁离线降级。
description_en: Say goodbye to late-night formatting! Generate editable business PPTX decks from a single sentence, 1:1 vector redraw from screenshots or PDFs, lossless .pptx template editing, and .xlsx-backed editable charts with 6 gate groups (15 static checks).
version: 0.1.2
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

> 下文 \`<SKILL_DIR>\` 指本 \`SKILL.md\` 所在目录。一律通过 \`<SKILL_DIR>/scripts/{deck_cli,provider_cli,kit}.mjs\` 调用，**严禁修改技能目录本体脚本**。本技能为纯本地离线原生 OOXML 引擎，不上传用户文件；基础运行仅需 **Node.js \`>=22.5\`**，真机视觉渲染可选 **LibreOffice (\`soffice\`) + Poppler (\`pdftoppm\` 或 \`pypdfium2\`)**。

## 0. 任务分流路由（先定路线再动手）

| 用户需求 | 唯一正确路线 |
| :--- | :--- |
| **只要 Markdown（\`.md\`）/ 纯文本逐页大纲与要点**（未要求生成 \`.pptx\`） | 直接按咨询结构（MECE / 结论前置）与第 4 节去 AI 腔规范写出最终 \`.md\` 到用户目标目录（如 \`./output/\`），**不启动 \`.pptx\` 构建与渲染** |
| **既有 \`.pptx\` 母本原位改版** | 走 **通道 A**（\`inspectTemplateDeck → prepareStarterDeck → 原位换字换图 → auditTemplateFidelity\`），严禁新建空白页重画 |
| **已给参考图 / 截图 / PDF 1:1 复刻** | 直接走 **通道 B（原生矢量与水墨蒙版复刻）** |
| **一句话主题 / 纯文稿生成整套 \`.pptx\`**（若同时要 \`.md\` 则先落盘 \`.md\`） | 走 **第 2 节策划 → 通道 B**；若未配置本地模板库或要求一键直出，跳过选版直出 |

## 1. 核心工程铁律

1. **纯原生 OOXML（禁止简化或贴图）**：所有 \`.pptx\` 构建、改版、表格与图表均调用 \`<SKILL_DIR>/scripts/kit.mjs\`；严禁 \`python-pptx\`，严禁简化省略结构，严禁用整页贴图冒充表格、流程图或可编辑重绘。图表必须内嵌 \`.xlsx\` 工作簿支持双击改数。
2. **小节点单框合一 vs 大装饰框内独立定位**：按钮、标签或单段卡片必须在同一 \`<p:sp>\` 上直设 \`fill / line / text / textStyle\`（富文本 \`runs\` 支持 \`{ text, bold, fontSize, color }\` 平层写法）；**跨区域的 \`fill: "none"\` 大尺寸装饰外框或多分区底板，内部不同方位的元素（如左上引子与正中巨幅标题）应按真实坐标独立放置**，勿强塞同一文本框导致上半截空洞；表格文字直写单元格；项目符号用 \`makeBulletList()\`；禁 Emoji/方括号冒充图标与表单 UI；禁 4+ 连续空格定位；窄标签留足 5% 宽度余量。
3. **只读保护、重做隔离与「先落盘、再精修」**：要求源文件不动时严格只读（可用 \`verify --readonly-source\` 校验 SHA-256）；重做或换风格时严禁跨旧目录偷拿废弃配图；构建脚本用 \`await deck.save("./work/candidate.pptx")\` 写出候选包并由 \`deck_cli.mjs verify --final ./output/final.pptx\` 单次完成门禁与发布，再做 1～2 轮视觉微调覆盖更新。
4. **真机渲染自检与无依赖优雅降级**：所有 \`.pptx\` 成稿必须跑 \`deck_cli.mjs verify\`。本机具备 LibreOffice + Poppler（或 \`pypdfium2\`）时强制真机渲染并看图精修；**若缺渲染依赖，严禁私自上网下载安装包/字体，严禁修改技能脚本，严禁用自绘近似图冒充真机渲染**——\`verify\` 自动完成 **6 大门禁组 · 15 项静态代码检查**并原子发布 \`--final\`（返回 \`verificationMode: "code-gates-only"\` 与 \`visualVerified: false\`），桌面端提示安装复验，受限沙箱在交付说明首行如实注明未执行真机渲染。

## 2. 内容策划与版式规划

1. **一句话主题从零策划**：无现成文稿时，按 MECE 与金字塔原理拆出结论前置的逐页大纲、核心论点、正文文案、配图与图表建议（严禁编造真实客户战绩，示意数据明确标注口径）。
2. **按逻辑单元拆页**：不把 Markdown 章节或原页机械等同于 1 页 PPT；明确每页页型、图示逻辑与是否需表格/图表。
3. **可选本地模板检索**：仅当本机配置了自有模板索引目录（\`YUANMOU_LOCAL_DIR\`）且用户需要选版时，调用 \`node <SKILL_DIR>/scripts/provider_cli.mjs batch-search\`；否则直接跳过选版进入通道 B。

## 3. 双制作通道

### 通道 A：既有 \`.pptx\` 母本原位无损改版
\`inspectTemplateDeck\` 提取锚点 → 编写模板框位映射并过 \`validateTemplatePlan\` → \`prepareStarterDeck\` 无损抽页并清理冗余媒体 → \`.text.set()\` / \`.text.replace()\` 保样式换字、\`.replace({ path, fit: "cover" })\` 保蒙版换图、原生表图注入 → \`auditTemplateFidelity\` 保真稽查。

### 通道 B：从零生成 / 参考图与 PDF 1:1 复刻
\`<=10\` 页常规图文/卡片/表格稿可用清晰单脚本一次成稿；\`>=12\` 页或复杂参考图 1:1 复刻在用户工作目录按页拆分模块化脚本再总装导出（脚本一律从工作区根目录运行或用 \`path.resolve\`，防相对路径叠加）：
- **全出血大图 / 半透明遮罩**：底层全出血图片 + 中层半透明暗罩（\`fill: { color: "#0B1120", opacity: 0.55 }\`）+ 顶层 \`fill: "none"\` 大线框（框内引子与巨幅主标题独立定位），严禁 100% 实心块盖死底图；
- **菱形 / 斜切多边形 / 倾斜卡 / 有机水墨笔刷**：使用 \`images.add({ geometry: "diamond" | svgPath, rotation })\`、\`applyAlphaMaskToImage\`（有参考图首选 \`refMaskPath + refCrop\` 1280×720 坐标提取轮廓，同色漫灌或拼多笔刷用 \`strokes: [{ from, to, width }]\`）与 \`createBrushPng\`（实心印章用 \`ink-circle-solid\`，空心环用 \`ink-circle-ring\`，斜扫带用 \`ink-band\`）；书封/屏幕等载体只生无字底图，文字与倾斜贴纸气泡（\`shapes.add({ rotation: -15 })\`）保持上层原生 \`<p:sp>\`；
- **常规商务页**：直出内容稿 → 跑 \`deck_cli.mjs verify --final ./output/final.pptx\` 先落盘再按需微调；
- **高难参考图精雕**（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形，可查 \`@references/structure-and-text.md\`）：有渲染环境时先 \`inspect-ref\` 采色与 2× 切片 → 先建骨架跑 \`verify --ref ./ref.png\` 核对叠图与热点放大 → 再注入正式内容；无渲染环境时直接按代码门禁构建并如实标注。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标保层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔规范

- 严禁编造数据、严禁把策略建议/目标/示意数字写成已实现成果，保留原稿指标名称、数值与统计周期；缺量化成果时仅呈现已有执行产出与定性成果，**待补数据放交付说明，严禁把 \`[待补充]\` / \`TBD\` 写进页内**。
- 禁用空洞套词（\`不是X而是Y\`、\`深度赋能\`、\`核心抓手\`、\`生态闭环\`、\`打出组合拳\`、\`底层逻辑重构\`、\`开启新篇章\`）、单段滥用 \`——\` 与行内假圆点 \`A • B • C\`。
- 内容页主标题结论前置；**正文与表格 \`>=12pt\`**（\`<9pt\` 触发门禁 \`fail\`，\`9–11.9pt\` 触发 \`warn\`），挤不下先精简废话，不强缩字号。

## 5. 一条龙终检与双模式验收

交付前执行 1 条命令跑完 **6 大门禁组 · 15 项自动代码检查**（ECMA-376 包结构、越界、碰撞、禁框中套框、菱形/窄图形内切宽、WCAG 对比度、禁整页贴图冒充、禁实心块遮死底图、禁长空格与假圆点、禁脏 Emoji/假表单方括号、正文与表格最小字号、Anti-Slop、禁页内占位符、字体核查、表图 \`.xlsx\`/算术同步）并原子发布 \`--final\`；有渲染依赖时自动执行真机渲染并输出 \`qa_sheet.png\`、\`compare_batch_*.jpg\` 与多页对照 PDF（\`qa_compare.pdf\`），无渲染依赖时自动走 \`code-gates-only\` 离线降级：

\`\`\`bash
# 若构建脚本已直接 finalizeDeck 输出到 ./output/final.pptx，可直接校验该文件；若先写 ./work/candidate.pptx 则加 --final ./output/final.pptx
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./output/final.pptx \\
  --out ./work/qa --pdf ./output/qa_compare.pdf --anti-slop fail
\`\`\`

1. 当 \`visualVerified: true\` 时，分批审阅 \`compare_batch_*.jpg\`（每轮最多读 2 张 = 8 页，重点核对 \`lowestPages\` 的标题占框比、对角构图重心、时间轴垂直刻度线、印章虚实与气泡倾角），结构失真必返工并覆盖更新 \`./output/final.pptx\`；
2. 当 \`visualVerified: false\`（\`verificationMode: "code-gates-only"\`）时，直接交付已过 6 组 15 项代码门禁的 \`.pptx\`，并在交付说明首行如实标注验证范围与缺失依赖，严禁谎称已真机渲染或谎称 12pt 全部合规（须核对 \`warnings\`）。

## 6. \`@yuanmou/pptx-kit\` API 速查（坐标 \`px\` 1280×720 · \`fontSize\` 数值默认 \`pt\`）

> 单位约定：\`position / width / height / borderRadius / insets\` 用 \`px\`；**\`fontSize\` 数值默认 \`pt\`**（\`fontSize: 14\` 即 \`14pt\`，显式 \`"24px"\` 才折算 \`18pt\`）。Windows/macOS/Linux 通用跨平台导入请使用 \`pathToFileURL\`：

\`\`\`js
import path from "node:path";
import { pathToFileURL } from "node:url";
const {
  Presentation, finalizeDeck, makeBulletList, fr, fixed,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
  createBrushPng, applyAlphaMaskToImage,
} = await import(pathToFileURL(path.resolve("<SKILL_DIR>/scripts/kit.mjs")).href);

const deck = Presentation.create({ title: "方案标题", defaultFont: "Microsoft YaHei" });
const s = deck.slides.add({ background: "#FFFFFF" });
s.shapes.add({
  name: "卡片标题", geometry: "roundRect", borderRadius: 8,
  position: { left: 64, top: 120, width: 320, height: 56 },
  fill: "#0F3A7D", line: { fill: "#0F3A7D", width: 1 },
  text: [{ runs: [{ text: "结论前置：", bold: true, fontSize: 16, color: "#FDE68A" }, { text: "主标题", fontSize: 16, color: "#FFFFFF" }] }],
  textStyle: { alignment: "center", verticalAlignment: "middle", insets: { left: 10, right: 10, top: 6, bottom: 6 } },
});
s.images.add({ path: "./shot.png", position: { left: 64, top: 200, width: 420, height: 280 }, fit: "cover", borderRadius: 8 });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await finalizeDeck({ deck, outputPath: "./output/final.pptx", antiSlop: "fail" }); // 也可 deck.toPptxBuffer() 或 await deck.save("./work/candidate.pptx")
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
    const renderedWbSkillMd = WORKBUDDY_SKILL_MD.replace(/^version:\s*.+$/m, `version: ${pkg.version}`);
    await fs.writeFile(path.join(bundleDir, "SKILL.md"), renderedWbSkillMd, "utf8");
    await copyClean(path.join(REPO_ROOT, "skills", "yuanmou-ppt", "references"), path.join(bundleDir, "references"));
    await copyClean(path.join(REPO_ROOT, "skills", "yuanmou-ppt", "scripts"), path.join(bundleDir, "scripts"));

    // 2) Flatten zero-dep `pptx-kit` directly into `scripts/` so the zip strictly satisfies
    // WorkBuddy's 2-level directory depth limit (`yuanmou-ppt/{scripts,references}/<file>`).
    const kitSrcRoot = path.join(REPO_ROOT, "skills", "yuanmou-ppt", "packages", "pptx-kit");
    const scriptsDir = path.join(bundleDir, "scripts");

    const fileMap = new Map(); // posix relPath from kitSrcRoot -> flat filename in scripts/
    fileMap.set("index.mjs", "kit-index.mjs");
    for (const f of await fs.readdir(path.join(kitSrcRoot, "src"))) {
      if (f.endsWith(".mjs") && !f.endsWith(".local.mjs")) fileMap.set(`src/${f}`, `kit-${f}`);
    }
    for (const f of await fs.readdir(path.join(kitSrcRoot, "src", "providers"))) {
      if (f.endsWith(".mjs") && !f.endsWith(".local.mjs")) fileMap.set(`src/providers/${f}`, `kit-provider-${f}`);
    }

    for (const [relPosix, flatName] of fileMap.entries()) {
      const srcPath = path.join(kitSrcRoot, ...relPosix.split("/"));
      let src = await fs.readFile(srcPath, "utf8");
      const origDir = path.posix.dirname(relPosix);
      // Rewrite BOTH static `from "./..."` AND dynamic `import("./...")` relative imports
      src = src.replace(/((?:from\s+|import\s*\(\s*)["'])(\.\.?\/[^"']+)(["'])/g, (full, pre, spec, post) => {
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
        src.replace("../packages/pptx-kit/index.mjs", "./kit-index.mjs"),
        "utf8"
      );
    }

    // 3b) Replace `kit-updater.mjs` with a pure offline stub so marketplace builds contain
    // zero external CDN/GitHub update URLs and delegate version upgrades strictly to WorkBuddy Marketplace.
    await fs.writeFile(
      path.join(scriptsDir, "kit-updater.mjs"),
      `// Pure offline WorkBuddy Marketplace version stub\n` +
        `export const KIT_VERSION = ${JSON.stringify(pkg.version)};\n` +
        `export const GITHUB_REPO = "";\n` +
        `export function compareSemver() { return 0; }\n` +
        `export async function checkSkillUpdate() { return null; }\n` +
        `export async function selfUpdateSkill() { return { ok: false, updated: false, reason: "marketplace_managed", message: "当前为开放平台市场托管版本，请直接在客户端技能市场中检查并升级版本。" }; }\n`,
      "utf8"
    );

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
        '"Local & Zero-Login Public Trial Library (16,000+ Slides)"',
        '"Local Standalone Native OOXML Engine (Offline)"'
      );
    await fs.writeFile(lpPath, lpSrc, "utf8");

    // 5) Automated smoke test on the flattened bundle BEFORE zipping (prevents broken imports / API drift!)
    const smokeOut = path.join(stageRoot, "smoke_out.pptx");
    const kitMod = await import(pathToFileURL(path.join(scriptsDir, "kit.mjs")).href);
    const smokeDeck = kitMod.Presentation.create({ title: "WorkBuddy Smoke Test" });
    const smokeSlide = smokeDeck.slides.add({ background: "#FFFFFF" });
    smokeSlide.shapes.add({
      name: "标题",
      position: { left: 64, top: 60, width: 1000, height: 64 },
      text: [{ runs: [{ text: "核心结论：", bold: true, fontSize: 32, color: "#0F3A7D" }, { text: "季度营收稳定增长", fontSize: 14, color: "#1E293B" }] }],
    });
    const rawBuf = smokeDeck.toPptxBuffer();
    if (!Buffer.isBuffer(rawBuf) || rawBuf.length < 1000) {
      throw new Error("Smoke test failed: deck.toPptxBuffer() returned invalid buffer");
    }
    const zEntries = kitMod.readZipBuffer(rawBuf);
    const s1Xml = zEntries.get("ppt/slides/slide1.xml")?.toString("utf8") || "";
    if (!s1Xml.includes('sz="3200"') || !s1Xml.includes('b="1"') || !s1Xml.includes('sz="1400"')) {
      throw new Error("Smoke test failed: flat run bold or pt fontSize (32pt->3200, 14pt->1400) missing in slide1.xml");
    }
    const finSmoke = await kitMod.finalizeDeck({ deck: smokeDeck, outputPath: smokeOut, antiSlop: "fail" });
    if (!finSmoke.validation.passed) {
      throw new Error("Smoke test failed: finalizeDeck({ deck }) did not pass on flattened bundle");
    }
    const envRes = spawnSync(process.execPath, [path.join(scriptsDir, "deck_cli.mjs"), "check-env"], {
      encoding: "utf8",
    });
    if (envRes.status !== 0) {
      throw new Error(`Smoke test failed: deck_cli.mjs check-env exited ${envRes.status}: ${envRes.stderr}`);
    }

    await fs.rm(outZip, { force: true });
    const zipRes = spawnSync("zip", ["-rq", outZip, "yuanmou-ppt"], {
      cwd: stageRoot,
      encoding: "utf8",
    });
    if (zipRes.status !== 0) {
      const entries = [];
      const walk = async (curDir) => {
        for (const ent of await fs.readdir(curDir, { withFileTypes: true })) {
          const full = path.join(curDir, ent.name);
          if (ent.isDirectory()) await walk(full);
          else if (ent.isFile()) {
            entries.push({
              name: path.relative(stageRoot, full).split(path.sep).join("/"),
              data: await fs.readFile(full),
            });
          }
        }
      };
      await walk(bundleDir);
      await fs.writeFile(outZip, kitMod.buildZipBuffer(entries));
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
