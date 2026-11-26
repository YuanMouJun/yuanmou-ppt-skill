---
name: yuanmou-ppt
description: 一句话从零策划生成整套商业 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 既有 .pptx 母本无损改版全能技能（All-in-One AI PPT Generator & Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持一句话主题咨询级大纲与文案策划、1.6W+ 免登录商业版式库 / 10W+ 飞书云盘版式库同构选版、复杂自由排版与半透明玻璃/菱形斜切/水墨笔刷蒙版 1:1 复刻、内嵌 .xlsx 可双击改数真图表及 5 组 15 项自动代码门禁与多页左右对照验收。
---

# Yuanmou PPT Skill (`@yuanmou/pptx-kit`)

> `<SKILL_DIR>` 指本 `SKILL.md` 所在目录。一律通过 `<SKILL_DIR>/scripts/{provider_cli,deck_cli,kit}.mjs` 调用，严禁写死相对仓库路径，**严禁修改技能目录本体脚本**。

## 0. 任务分流路由（先定路线再动手）

| 用户需求 | 唯一正确路线 |
| :--- | :--- |
| **只要 Markdown（`.md`）/ 纯文本逐页大纲与要点**（未要求生成 `.pptx`） | 直接按咨询结构（MECE / 结论前置）与第 4 节 Anti-Slop 写出最终 `.md` 到目标目录（如 `./output/`），**不启动 `.pptx` 构建与渲染** |
| **既有 `.pptx` 母本原位改版** | 走 **通道 A**（`inspectTemplateDeck → prepareStarterDeck → 原位换字换图 → auditTemplateFidelity`），严禁新建空白页重画 |
| **已指定参考图 / 截图 / PDF 1:1 复刻**（或仅调色/局部修形） | 跳过选版海选，直接走 **通道 B（4 类视觉页型分流 + 原生复刻）** |
| **一句话主题 / 纯文稿生成整套 `.pptx`**（若同时要 `.md` 则先落盘 `.md`） | 走 **第 2 节（咨询策划 + 可选同构选版）→ 通道 B**；若用户要求一键直出或离线无可用模板库，跳过选版直进通道 B |

## 1. 核心铁律（不翻源码、不绕路）

1. **纯原生 OOXML（禁止简化或贴图）**：所有 `.pptx` 构建、改版、表图与终检调用 `<SKILL_DIR>/scripts/kit.mjs`；严禁 `python-pptx`，严禁简化省略结构，严禁用整页贴图冒充表格/流程图/可编辑重绘。图表必须内嵌 `.xlsx` 可双击改数。
2. **单图形承载底色与富文本（严禁框中套框）**：带底色/描边节点必须在同一 `<p:sp>` 上直设 `fill / line / text / textStyle`（多字号/多色用富文本 `runs`，支持 `{ text, bold, fontSize, color }` 平层写法）；**严禁另套内框、盖透明文本框或编组冒充**；表格文字直写单元格；列表用 `makeBulletList()`，禁手敲 `"• "`；**严禁用 `☀ / ▶ / 《` 等 Emoji/标点冒充图标，严禁用 `[ 姓名 ] | [ 手机 ]` 冒充表单 UI**；禁 4+ 连续空格定位；窄标签留足 5% 余量（菱形安全区仅 `0.50×宽 × 0.50×高`，禁塞入导致竖排断行）。
3. **只读保护与「先落盘、再精修」**：要求原稿不动时严禁改写原件（可用 `verify --readonly-source` 锁哈希），核对物理页码与交付份数；**首轮过代码门禁后立刻把正式成稿落盘到用户目标目录（如 `./output/final.pptx`），再按余量做 1～2 轮视觉精修并覆盖更新**，严禁锁在 `./work/` 返工直至预算耗尽、目标目录为空。
4. **强制视觉自检 + 无依赖离线降级（代码全绿 ≠ 视觉达标）**：所有 `.pptx` 必跑 `deck_cli.mjs verify`。本机具备 **LibreOffice (`soffice`) + Poppler (`pdftoppm` 或 `pypdfium2`)** 时强制真机渲染并审图返工；**若缺渲染依赖，严禁上网下载安装包/字体或自绘近似假图冒充真机渲染**——`verify` 自动完成 **5 组 15 项静态代码门禁**并原子落盘 `--final`（返回 `verificationMode: "code-gates-only"`, `visualVerified: false`），桌面端提示用户安装复验，受限沙箱则在交付说明首行如实标注未做真机渲染。

## 2. 从零策划与全库同构选版（仅无参考图/非一键直出时执行）

**严禁不读内容乱搜、严禁手搓裸 SQL 绕过同构打分**；若用户明确要求一键直出，或纯离线且无可用本地模板库，直接完成策划后跳过选版进入通道 B：

1. **一句话主题策划与槽位拆解**：无现成文稿时，按 MECE / 金字塔原理 / 结论前置策划逐页大纲、核心论点、去 AI 腔文案、配图与图表建议（严禁编造真实客户战绩）；逐页提炼槽位指纹：`purpose`（支持逗号多词如 `"执行策略,方法论"`）、`diagramFamily`（`flow/funnel/timeline/hierarchy/cycle/branch/radial/matrix/comparison`）、`targetImages`、`targetTextSlots`、`targetResults`、`whiteBackground` 及是否需表格/图表。
2. **1 条命令出多页单选看板（默认自动探活 `feishu` -> `local` 免登录库，纯离线设 `YUANMOU_OFFLINE=1`）**：多页（4～6 页/批）写 `pages.json` 跑 **`batch-search`**，输出**严格单选、默认不勾选、支持左原稿对照与一键复制**的交互 HTML 看板（选版需单选交互故用 HTML；交互模式下未获用户确认前不提前重绘）：

```bash
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --fetch-previews --out ./selection_board.html
node <SKILL_DIR>/scripts/provider_cli.mjs search-slides --purpose "执行策略,方法论" --diagram-family funnel \
  --target-images 0 --target-text-slots 4 --white-background --fetch-previews --limit 3 --out ./selection_board.html
```

## 3. 双制作通道

### 通道 A：既有 `.pptx` 母本原位无损改版
`inspectTemplateDeck` 提取锚点 → 写 `template-frame-map.json` 并 `validateTemplatePlan` → `prepareStarterDeck` 无损抽页 → `.text.set()` / `.text.replace()` 保样式换字 + `.replace({ path, fit: "cover" })` 保蒙版换图 + 原生表图注入 → `auditTemplateFidelity`。

### 通道 B：从零生成 / 参考图・截图・PDF 1:1 复刻（按 4 类视觉页型分流，拒绝一律 `roundRect`！）
`<=10` 页常规图文/卡片/表格稿可用清晰单脚本直出；`>=12` 页或复杂参考图 1:1 复刻先导出参考页 PNG 到 `./refs/`，按模块化单页文件推进（`slides/p1.mjs`…`pN.mjs` 汇总到 `build_deck.mjs`），开工前规划独立配图预算（长方案严禁只生 6～8 张图反复粘贴）：

- **页型 1 · 全出血大图 + 半透明暗罩 / 透明细线框**：满屏底图 + 中层半透明暗罩（`fill: "#0B1120/55%"` 或 `{ color, opacity: 0.55 }`）+ 顶层 `fill: "none"` 线框；**严禁用 100% 实心矩形盖死底图**（门禁 `opaque_overlay_hides_bg_image` 会拦截）。
- **页型 2 · 菱形 / 斜切多边形 / 倾斜叠图 / 有机水墨笔刷**：
  - 几何裁图与倾斜卡：用 `images.add({ geometry: "diamond" })`、`images.add({ svgPath, viewBox })`、`rotation: -10` 与 `shapes.add({ svgPath, viewBox })`，**严禁退化成水平 `roundRect`**。
  - 毛笔飞白 / 书法圆印 / 笔触蒙版叠图：用内置 `createBrushPng`（`ink-circle-solid` / `ink-circle-ring` / `ink-band` / `ink-slash` / `ink-wave`）与 `applyAlphaMaskToImage`（预设笔触或 `refMaskPath` 边界泛洪无孔洞轮廓），**文字必须保留为上层原生可编辑 `<p:sp>`**。
- **页型 3 · 3D 立体书 / 手绘路线图 / H5 漫画弹窗 / 表单与社媒卡片**：按页生成与底色融合的专属插画嵌入，搭配原生虚线箭头（`geometry: "connector"`）、圆角气泡、独立表单输入框/按钮与圆形头像；**严禁用方图或纯文本方括号敷衍降级**。
- **页型 4 · 常规商务卡片 / 表格 / 图表 / 高难玻璃叠层精雕**：
  - 常规页：直出内容稿 → `deck_cli.mjs verify` 先落盘再看图微调；
  - 高难参考图（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形，按需查 `references/structure-and-text.md`）：有渲染依赖时先 `inspect-ref` 采色与 2× 切片 → 先建骨架并跑 `verify --ref ./ref.png` 核对 `overlay_3panel.png` 与 `zoom_hotspot_*_2x.png` → 再注入正式内容。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标保层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔铁律（Anti-Slop）

- 严禁编造数据、严禁把目标/示意数字写成已实现成果，保留原稿指标名、数值与周期；缺数据仅写已有产出，**待补数据放交付说明，严禁把 `[待补充]` / `TBD` 写进页内**。
- 封杀 AI 水词（`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`）、单段滥用 `——`、行内假圆点 `A • B • C`。
- 内容页主标题结论前置；**正文与表格 `>=12pt`**（`<9pt` 门禁 `fail`，`9–11.9pt` 触发 `warn`），挤不下先精简废话，不强缩字号。

## 5. 一条龙终检与多页左右对照验收

1 条命令跑完 **5 大门禁组 · 15 项自动代码检查**（ECMA-376 包结构、越界、碰撞、框中套框、菱形/窄图形内切宽、WCAG 对比度、整页贴图冒充、实心块遮死底图、长空格与假圆点、脏 Emoji/假表单方括号、正文与表格最小字号、Anti-Slop、页内占位符、字体核查、表图 `.xlsx`/算术同步）并原子落盘 `--final`；有渲染依赖时自动出 `compare_batch_*.jpg` + 多页对照 PDF（`qa_compare.pdf`，不再生成 HTML）：

```bash
# 多页参考图/PDF 复刻（--ref-dir 自动输出逐页左原模板 vs 右成稿对照 PDF 与 4 页一组高清审图批）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref-dir ./refs --pdf ./output/qa_compare.pdf --anti-slop fail

# 单页高难参考图对比（--ref 自动输出 50% X 光叠图 + Top-2 误差热点 2× 放大对照 PDF）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref ./ref.png --pdf ./output/qa_compare.pdf --anti-slop fail
```

1. **先落盘、再视觉精修**：首轮代码门禁通过即把 `--final` 落盘到 `./output/final.pptx`。当 `visualVerified: true` 时，**严禁只看 20 合一邮票图交差**，必须逐张 `read_file` 审阅 `compare_batch_*.jpg`，逐页核对：① 底图是否透出无死色块遮挡 ② 菱形/斜切/倾斜/水墨构图是否还原 ③ 窄标签有无断行孤字 ④ 有无把 3D 物件/路线图/表单降级成简陋方框 ⑤ 配图是否高频重复；有明显失真必须返工并覆盖更新 `./output/final.pptx`。
2. **离线降级如实声明**：若返回 `verificationMode: "code-gates-only"`（`visualVerified: false`），直接交付已过 5 组 15 项代码门禁的 `.pptx`，桌面端附 `installHint` 建议安装复验，受限沙箱在交付说明首行如实标注未执行真机渲染，并核对 `warnings` 不谎称 12pt 全部合规。

## 6. `@yuanmou/pptx-kit` 零翻源码 API 速查（坐标 `px` 1280×720 · `fontSize` 数值默认 `pt`）

> 单位约定：`position / left / top / width / height / borderRadius / insets` 均用 `px`（同时支持 `position: {...}` 与平层 `left/top/width/height`）；**`fontSize` 数值默认 `pt`**（`14` 即 `14pt`，显式 `"24px"` 才折算 `18pt`）。脚本一律从工作区根目录运行或用 `path.resolve`（防 `work/work` 嵌套）；跨平台（Windows/macOS/Linux）导入请用 `pathToFileURL`：

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

// 1) 全出血底图 + 半透明暗罩（"#HEX/55%" 或 { color, opacity: 0.55 }）+ 透明白线框
s.images.add({ path: "./hero.jpg", position: { left: 0, top: 0, width: 1280, height: 720 }, fit: "cover" });
s.shapes.add({ name: "暗角遮罩", geometry: "rect", position: { left: 0, top: 0, width: 1280, height: 720 }, fill: { color: "#0B1120", opacity: 0.52 }, line: { fill: "none" } });
s.shapes.add({ name: "透底白线框", geometry: "rect", position: { left: 180, top: 140, width: 920, height: 420 }, fill: "none", line: { fill: "#FFFFFF", width: 4 }, text: "主标题", textStyle: { fontSize: 40, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" } });

// 2) 菱形裁图 / 斜切 SVG 裁图 / 倾斜白边拍立得 / 水墨笔刷与无孔洞蒙版叠图
s.images.add({ path: "./p1.jpg", geometry: "diamond", position: { left: 120, top: 180, width: 220, height: 220 }, fit: "cover", line: { fill: "#E85D04", width: 3 } });
s.images.add({ path: "./p2.jpg", svgPath: "M 0 0 L 560 0 L 420 720 L 0 720 Z", viewBox: { width: 560, height: 720 }, position: { left: 0, top: 0, width: 560, height: 720 }, fit: "cover" });
s.images.add({ path: "./p3.jpg", position: { left: 320, top: 160, width: 260, height: 260 }, fit: "cover", rotation: -12, line: { fill: "#FFFFFF", width: 8 } });
await createBrushPng({ preset: "ink-circle-solid", color: "#C82829", width: 420, height: 420, outPath: "./work/stamp.png" }); // 可选: ink-circle-ring | ink-band | ink-slash | ink-wave
await applyAlphaMaskToImage({ imagePath: "./p4.jpg", maskPreset: "ink-slash", width: 520, height: 720, outPath: "./work/p4_masked.png" }); // 或 refMaskPath + refCrop 边界泛洪无孔洞轮廓

// 3) 单图形底色+平层富文本 / 虚线箭头 / 原生表格 / 内嵌 .xlsx 真图表（支持 ("bar", cfg) 或 ({ type: "bar", ... })）
s.shapes.add({ name: "卡片", geometry: "roundRect", borderRadius: 8, position: { left: 64, top: 120, width: 320, height: 56 }, fill: "#0F3A7D", line: { fill: "#0F3A7D", width: 1 }, text: [{ runs: [{ text: "结论前置：", bold: true, fontSize: 16, color: "#FDE68A" }, { text: "主标题", fontSize: 16, color: "#FFFFFF" }] }], textStyle: { alignment: "center", verticalAlignment: "middle", insets: { left: 10, right: 10, top: 6, bottom: 6 } } });
s.shapes.add({ name: "路径虚线", geometry: "connector", kind: "straight", startPoint: { x: 260, y: 300 }, endPoint: { x: 640, y: 300 }, line: { color: "#E85D04", width: 2, style: "dashed" }, tail: { type: "triangle", width: "med", length: "med" } });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await finalizeDeck({ deck, outputPath: "./work/candidate.pptx", antiSlop: "fail" }); // 也可 deck.toPptxBuffer() 或 await deck.save("./work/candidate.pptx")
```
