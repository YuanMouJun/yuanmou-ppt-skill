---
name: yuanmou-ppt
description: 一句话从零策划生成整套商业 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 既有 .pptx 母本无损改版全能技能（All-in-One AI PPT Generator & Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持一句话主题咨询级大纲与文案策划、1.6W+ 免登录商业版式库 / 10W+ 飞书云盘版式库同构选版、复杂自由排版与半透明玻璃/菱形斜切/水墨笔刷蒙版 1:1 复刻、内嵌 .xlsx 可双击改数真图表及 5 组 15 项自动代码门禁与多页左右对照验收。
---

# Yuanmou PPT Skill (`@yuanmou/pptx-kit`)

> 下文 `<SKILL_DIR>` 指本 `SKILL.md` 所在目录。无论用户当前在哪个工作目录，一律通过 `<SKILL_DIR>/scripts/{provider_cli,deck_cli,kit}.mjs` 调用，严禁写死相对仓库路径，**严禁修改技能目录本体脚本**。

## 1. 铁律与红线（不翻源码、不绕路）

1. **用户交付形态至上（严禁劫持需求）**：若用户**明确只要 Markdown（`.md`）/纯文本逐页大纲与要点且未要求生成 `.pptx`**，直接走「通道 0」按咨询顾问水准写出完整 `.md`/文本到目标目录（如 `./output/`），**严禁强行启动 `.pptx` 构建流程或折腾渲染依赖**；若用户要求 `.pptx`（哪怕同时要文字大纲），再进入 `.pptx` 通道（若同时要 `.md` 则优先落盘 `.md`）。
2. **纯原生 OOXML（禁止简化或贴图）**：所有 `.pptx` 构建、改版、图表与终检均调用 `<SKILL_DIR>/scripts/kit.mjs`；严禁 `python-pptx`，严禁简化/合并省略结构，严禁用整页背景图或截图碎片冒充表格/流程图/可编辑重绘。图表必须内嵌 `.xlsx` 可双击改数。
3. **单图形承载底色与富文本（严禁框中套框）**：圆角矩形、色带、圆形、菱形、箭头等带底色/描边节点必须在同一个 `<p:sp>` 上直接设 `fill / line / text / textStyle`（多字号/多色用富文本 `runs`，支持 `{ text, bold, fontSize, color }` 平层写法）；**严禁另套内框、覆盖透明文本框或用编组冒充**；表格文字直写单元格；项目符号用 `makeBulletList()`，禁手敲 `"• "`；**严禁用 `☀ / ▶ / 《` 等系统 Emoji 或标点冒充图标，严禁用 `[ 尊姓大名 ] | [ 手机 ]` 纯文本冒充表单 UI**；禁 4+ 连续空格定位；跨系统优先通用字体且窄标签留足 5% 宽度余量（菱形原生文本安全区仅 `0.50×宽 × 0.50×高`，严禁把 `01` 或长词硬塞进窄菱形导致竖排断行或掉孤字）。
4. **只读保护、先落盘再精修与交付边界**：区分「内容源」与「版式参考」；要求原稿不动时严禁改写原件（可用 `verify --readonly-source` 锁哈希），核对物理页码、隐藏页与独立单页交付份数；**首轮过代码门禁后立刻将正式成稿落盘到用户指定目录（如 `./output/final.pptx`），再按余量做 1～2 轮视觉精修并覆盖更新**，严禁全程锁在 `./work/` 里返工直至步骤预算耗尽、目标目录为空。
5. **强制视觉自检与无依赖优雅降级（代码全绿 ≠ 视觉达标）**：所有 `.pptx` 成稿必须跑 `deck_cli.mjs verify`。本机具备 **LibreOffice (`soffice`) + Poppler (`pdftoppm` 或 `pypdfium2`)** 时强制真机渲染并审图返工；**若环境缺失渲染依赖，严禁私自上网下载安装包/字体或自绘近似假图冒充真机渲染**——`verify` 会自动跑完 **5 组 15 项静态代码门禁**并原子落盘 `--final`（返回 `verificationMode: "code-gates-only"`, `visualVerified: false`），桌面端应提示用户安装依赖复验，受限沙箱则直接在交付说明首行如实标注「未执行真机渲染」。

## 2. 从零策划 / 内容解构 → 1 条命令全库同构选版（Step 0 ～ Step 1）

**严禁不读内容乱搜、严禁手搓裸 SQL 绕过同构打分**；已指定参考图/PDF/仅调色/局部修形直接跳过海选，否则按以下流程推进：

0. **一句话主题从零策划（无现成文稿时自动激活）**：用户仅给出一句话主题（如“做一份 10 页的新能源车 Q3 种草增长方案”）时，先按咨询顾问结构（MECE / 金字塔原理 / 结论前置 Action Title）自动策划**完整逐页大纲、核心论点、去 AI 腔正文文案、配图方向及原生图表建议**（严禁编造虚构客户战绩，示意框架明确标注口径），并确定每页槽位指纹后再进选版。
1. **按逻辑单元提炼「槽位指纹」**：通读原稿或 Step 0 大纲，不把 Markdown 章节或 PDF/Word 原页机械当 1 页；逐页拆出 `purpose`（支持逗号多词如 `"执行策略,方法论"`）、`diagramFamily`（`flow/funnel/timeline/hierarchy/cycle/branch/radial/matrix/comparison`）、`targetImages`、`targetTextSlots`、`targetResults`、`whiteBackground` 及是否需表格/图表。
2. **1 条命令出多页单选看板（默认自动探活 `feishu` -> `local` 免登录库，纯离线设 `YUANMOU_OFFLINE=1`）**：多页（4～6 页/批）写 `pages.json` 跑 **`batch-search`**，1 次完成全库打分、按需拉无损原图（临时目录 2 小时自动清理防偷懒）并输出**严格单选、默认不勾选、支持左原稿对照与一键复制**的 Base64 HTML 看板（**未获用户确认前严禁重绘或填充**）：

```bash
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --fetch-previews --out ./selection_board.html
node <SKILL_DIR>/scripts/provider_cli.mjs search-slides --purpose "执行策略,方法论" --diagram-family funnel \
  --target-images 0 --target-text-slots 4 --white-background --fetch-previews --limit 3 --out ./selection_board.html
```

## 3. 多通道制作流（Step 2 ～ Step 4）

### 通道 0：仅文字大纲 / Markdown 交付（用户未要求 `.pptx` 时直接生效）
若用户明确要求把逐页标题、要点、策划案或完整回应写成 `.md` / 文本文件（例如写入 `./output/*.md`）且未要求生成 `.pptx`，按第 2 节 Step 0 咨询顾问标准与第 4 节 Anti-Slop 铁律直接输出结构化 Markdown 到用户指定路径并完成交付，**不启动 `.pptx` 构建与渲染流程**。

### 通道 A：既有 `.pptx` 母本（L1 · 原位无损改版）
严禁新建空白页重画：`inspectTemplateDeck` → 写 `template-frame-map.json` 并 `validateTemplatePlan` → `prepareStarterDeck` 无损抽页 → `.text.set()` / `.text.replace()` 保样式换字 + `.replace({ path, fit: "cover" })` 换图 + 原生表图注入 → `auditTemplateFidelity`。

### 通道 B：从零生成 / 图片 / 截图 / PDF 1:1 复刻（先做视觉页型分流，拒绝一律 `roundRect`！）
`<=10` 页轻量图文/卡片/表格稿可用清晰单脚本直出；`>=12` 页或复杂参考图 1:1 复刻先导出参考页 PNG 到 `./refs/`，用**模块化单页文件**推进（`slides/p1.mjs`…`pN.mjs` 汇总到 `build_deck.mjs` 一次性导出），**开工写代码前必须先按 4 类视觉页型分流与规划独立配图预算（长方案严禁只生 6～8 张通用图在 20+ 页里反复粘贴！）**：

- **页型 1 · 全出血情绪大图 + 半透明暗罩 / 透明细线框页**：底层放满屏 `images.add`，中层用半透明暗罩（`fill: "#0B1120/55%"` 或 `fill: { color: "#0B1120", opacity: 0.55 }`），顶层线框用 `fill: "none"` 透出背景实景；**严禁用 100% 实心矩形盖死底图**（已被门禁 `opaque_overlay_hides_bg_image` 拦死）。
- **页型 2 · 菱形裁图 / 斜切多边形拼图 / 倾斜叠图 / 有机水墨笔刷页**：
  - 几何裁图与倾斜卡：直接用原生 `images.add({ geometry: "diamond" })`、`images.add({ svgPath, viewBox })`、顶层 `rotation: -10` 与 `shapes.add({ svgPath, viewBox })` 还原菱形、斜切边框与 V 形大彩带，**严禁退化成水平 `roundRect` 小方框**。
  - 真实毛笔飞白 / 书法圆印 / 笔触蒙版叠图：当原稿出现真实笔刷飞白边缘、水墨色带或被有机笔触裁剪的配图时，调用内置引擎 `createBrushPng`（预设 `ink-circle-solid` / `ink-circle-ring` / `ink-band` / `ink-slash` / `ink-wave`）生成透明底笔刷层，或 `applyAlphaMaskToImage` 给目标新图叠加预设笔触 / 边界泛洪无孔洞参考轮廓（`refMaskPath`），**严禁把文字画进笔刷 PNG，文字必须保留为上层原生可编辑 `<p:sp>`**。
- **页型 3 · 3D 精装立体书 / 手绘场景路线图 / 报刊信息拼贴 / H5 漫画弹窗 / 表单与社媒卡片页**：
  - 立体物件、手绘插画、H5 主视觉应借助生图工具按页生成**纯白底或与页底融合的专属视觉插画**嵌入，搭配原生虚线连接箭头（`geometry: "connector"`）、圆角对话气泡与独立表单输入框/提交按钮、社媒头像圆图与多图格；**严禁用两张普通方图或纯文本方括号敷衍降级**。
- **页型 4 · 常规商务卡片 / 表格 / 图表 / 高难玻璃叠层（L2 / L3）**：
  - **L2**：单步直出内容稿 → `deck_cli.mjs verify` 审阅高清对照图；
  - **L3（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形，按需查 `references/structure-and-text.md`）**：先 `inspect-ref` 采色与 2× 切片 → 拼 `structure` 骨架并跑 `verify --ref ./ref.png` 核对 `overlay_3panel.png` 与 `zoom_hotspot_*_2x.png` → 切 `final` 换内容。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标保层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔铁律（Anti-Slop）

- 严禁编造数据、严禁把建议/目标/Demo 数字写成已实现成果，保留原稿指标名称、数值与统计周期；缺量化成果时仅写已有执行产出与定性成果，**待补数据放交付说明，严禁把 `[待补充]` / `TBD` 写进页内**。
- 封杀 AI 水词（`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`）、单段滥用 `——`、行内假圆点 `A • B • C`。
- 内容页主标题结论前置；**正文与表格 `>=12pt`**（`<9pt` 触发门禁 `fail`，`9–11.9pt` 触发 `warn`），挤不下先精简废话，不强缩字号。

## 5. 一条龙终检与强制高清左右对照验收（Step 5）

交付前 1 条命令跑完 **5 大门禁组 · 15 项自动代码检查**（ECMA-376 包结构、越界、碰撞、框中套框、菱形/窄图形内切宽溢出、WCAG 对比度、整页贴图冒充、**实心块遮死底图**、长空格与假圆点、**脏 Emoji/假表单方括号**、**正文与表格最小字号**、Anti-Slop、`[待补充]`、字体核查、表图 `.xlsx`/算术同步）+ **缓存加速真机渲染（有依赖时）** + **4 页一组高清左右对照审图拼图（`compare_batch_*.jpg`）** + **多页高清对照验收 PDF（`qa_compare.pdf`，不再生成 HTML）**：

```bash
# 多页参考图/PDF 复刻（传 --ref-dir 自动生成逐页左原模板 vs 右成稿对照 PDF 与高清审图批）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref-dir ./refs --pdf ./output/qa_compare.pdf --anti-slop fail

# 单页 L3 精雕对比（传 --ref 单图，自动输出 50% X 光叠图 + Top-2 误差热点 2× 放大对照 PDF）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref ./ref.png --pdf ./output/qa_compare.pdf --anti-slop fail
```

1. **先落盘、再视觉精修**：首轮代码门禁通过后立刻把 `--final` 正式写入目标交付目录（如 `./output/final.pptx`）；当 `visualVerified: true` 时，**严禁只看 20 合一邮票总览图就交差**，多页复刻必须逐张 `read_file` 审阅 `compare_batch_1.jpg`、`compare_batch_2.jpg`…，逐页核对：**① 底图是否清晰透出无死色块遮挡 ② 菱形/斜切/倾斜/水墨构图是否完整保留 ③ 菱形与窄标签有无断行孤字 ④ 有无把 3D 物件/路线图/H5 表单降级成简陋方框 ⑤ 配图是否高频重复**；凡有明显失真必须返工并覆盖更新 `./output/final.pptx`。
2. **无渲染依赖离线降级**：若返回 `verificationMode: "code-gates-only"`（`visualVerified: false`），严禁上网下载二进制或手改技能源码，严禁用 Pillow 自绘近似图冒充真机渲染；桌面端请给出 `installHint` 建议安装后复验，受限沙箱则直接交付已过 5 组 15 项门禁的 `.pptx`，并在交付说明首行如实注明未执行真机渲染。
3. 交付附带 `.pptx`（及有真机渲染时的 `qa_compare.pdf`、`compare_batch_*.jpg`），如实写明验证模式、渲染器、字体与未达 12pt 的警告项。

## 6. `@yuanmou/pptx-kit` 零翻源码 API 速查（坐标 `px` 1280×720 · `fontSize` 数值默认 `pt`）

> 单位约定：`position / width / height / borderRadius / insets` 均用 `px`（画布 `1280×720`）；**`fontSize` 数值默认单位为 `pt`**（如 `fontSize: 14` 即 `14pt`，显式传 `"24px"` 时按 `0.75` 折算 `18pt`）。脚本一律从工作区根目录运行或用 `path.resolve`（防 `work/work` 相对路径叠加）；Windows/macOS/Linux 通用跨平台导入请用 `pathToFileURL`：

```js
import path from "node:path";
import { pathToFileURL } from "node:url";
const {
  Presentation, finalizeDeck, makeBulletList, fr, fixed,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
  createBrushPng, applyAlphaMaskToImage,
} = await import(pathToFileURL(path.resolve("<SKILL_DIR>/scripts/kit.mjs")).href);

const deck = Presentation.create({ title: "方案标题", defaultFont: "PingFang SC" });
const s = deck.slides.add({ background: "#FFFFFF" }); // 或 { type: "linear", angle: 135, stops: [{ offset: 0, color: "#0B1120" }, { offset: 1, color: "#1E3A8A" }] }

// 1) 全出血背景图 + 半透明暗罩（支持 "#HEX/55%" 或 { color, opacity: 0.55 }）+ 透明白线框
s.images.add({ path: "./hero.jpg", position: { left: 0, top: 0, width: 1280, height: 720 }, fit: "cover" });
s.shapes.add({ name: "暗角遮罩", geometry: "rect", position: { left: 0, top: 0, width: 1280, height: 720 }, fill: { color: "#0B1120", opacity: 0.52 }, line: { fill: "none" } });
s.shapes.add({ name: "透底白线框", geometry: "rect", position: { left: 180, top: 140, width: 920, height: 420 }, fill: "none", line: { fill: "#FFFFFF", width: 4 }, text: "主标题", textStyle: { fontSize: 40, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" } });

// 2) 菱形裁图 / 斜切多边形 SVG 裁图 / 倾斜白边拍立得 / 有机水墨笔刷与无孔洞蒙版叠图
s.images.add({ path: "./p1.jpg", geometry: "diamond", position: { left: 120, top: 180, width: 220, height: 220 }, fit: "cover", line: { fill: "#E85D04", width: 3 } });
s.images.add({ path: "./p2.jpg", svgPath: "M 0 0 L 560 0 L 420 720 L 0 720 Z", viewBox: { width: 560, height: 720 }, position: { left: 0, top: 0, width: 560, height: 720 }, fit: "cover" });
s.images.add({ path: "./p3.jpg", position: { left: 320, top: 160, width: 260, height: 260 }, fit: "cover", rotation: -12, line: { fill: "#FFFFFF", width: 8 } });
await createBrushPng({ preset: "ink-circle-solid", color: "#C82829", width: 420, height: 420, outPath: "./work/stamp.png" }); // 可选: ink-circle-ring | ink-band | ink-slash | ink-wave
await applyAlphaMaskToImage({ imagePath: "./p4.jpg", maskPreset: "ink-slash", width: 520, height: 720, outPath: "./work/p4_masked.png" }); // 或传 refMaskPath + refCrop 边界泛洪提取无孔洞轮廓

// 3) 单图形直写底色+富文本（支持平层 run 样式） / 虚线箭头路径 / 原生表格 / 内嵌 .xlsx 真图表
s.shapes.add({ name: "卡片", geometry: "roundRect", borderRadius: 8, rotation: 0, position: { left: 64, top: 120, width: 320, height: 56 }, fill: "#0F3A7D", line: { fill: "#0F3A7D", width: 1 }, text: [{ runs: [{ text: "结论前置：", bold: true, fontSize: 16, color: "#FDE68A" }, { text: "主标题", fontSize: 16, color: "#FFFFFF" }] }], textStyle: { alignment: "center", verticalAlignment: "middle", insets: { left: 10, right: 10, top: 6, bottom: 6 } } });
s.shapes.add({ name: "路径虚线", geometry: "connector", kind: "straight", startPoint: { x: 260, y: 300 }, endPoint: { x: 640, y: 300 }, line: { color: "#E85D04", width: 2, style: "dashed" }, tail: { type: "triangle", width: "med", length: "med" } });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await finalizeDeck({ deck, outputPath: "./work/candidate.pptx", antiSlop: "fail" }); // 也可直接 deck.toPptxBuffer() 或 await deck.save("./work/candidate.pptx")
```
