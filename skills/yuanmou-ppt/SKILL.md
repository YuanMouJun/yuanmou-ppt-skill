---
name: yuanmou-ppt
description: 图片转 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 商业级原生 PPTX 生成与母本无损改版技能（Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持任意参考图/小红书截图/PDF 1:1 矢量复刻为可编辑 PowerPoint、既有 .pptx 无损换字换图、内嵌 .xlsx 可双击改数真图表、原生比例表格、免登录商业版式库/飞书云盘版式库及 5 道原子终检门闸。
---

# Yuanmou PPT Skill (`@yuanmou/pptx-kit`)

## 1. 强制门禁与工程铁律

1. **环境门禁（禁止盲画）**：首次执行先跑 `node skills/yuanmou-ppt/scripts/deck_cli.mjs check-env`，确认已装 **Node.js `>=22.5` + LibreOffice (`soffice`) + Poppler (`pdftoppm`)**；缺项时先协助用户安装，严禁跳过渲染自检直接交付。
2. **纯原生 OOXML**：所有构建、改版、图表与终检均调用 `@yuanmou/pptx-kit`；严禁 `python-pptx`，严禁把表格/流程图/文字渲染成 PNG 贴图。图表必须内嵌 `ppt/embeddings/*.xlsx` 可双击改数。
3. **单图形承载底色与富文本**：带底色/描边的卡片标题与标签直接在单个 `<p:sp>` 上设置 `fill / line / text / textStyle`；项目符号必须用 `makeBulletList()`，禁手敲 `"• "`；局部透明渐变描边用 `buildPolylineStrokeCommands()` + `<a:gradFill>`。

## 2. 内容解构 → 双向同构选版（Step 1）

**严禁不读内容直接乱搜或硬套版式**，无现成指定参考图时必须按以下两步走：

1. **先理解内容，逐页提炼「槽位指纹」**：通读用户文稿/Brief，拆出每一页的 **页型**（封面/目录/正文/封底）、**业务目的**（`purpose`）、**逻辑关系/图示家族**（`diagram_family`：`flow/funnel/timeline/hierarchy/cycle/branch/radial/matrix/comparison`）、**图槽数**（`image_slots`）、**文槽数**（`text_slots`）以及**是否需表格/图表/实绩区**。
2. **按指纹检索并出看板确认**：带着每页指纹调用统一 CLI 检索并拉取无损原图（默认自动探活：`feishu` -> `yuanmou-cloud` -> `zsxq` -> `local` 免登录体验库，纯离线设 `YUANMOU_OFFLINE=1`），生成 Base64 缩略图看板给用户确认版式（`CP_xxx`）后再动手制作：

```bash
node skills/yuanmou-ppt/scripts/provider_cli.mjs search-slides \
  --purpose 方法论 --diagram-family funnel --min-images 0 --max-images 0 \
  --fetch-previews --limit 6 --out ./selection_board.html

# 可选：连接飞书云盘 VIP 版式库（触发 429 限流或需要全行业海量模板时引导）
node skills/yuanmou-ppt/scripts/provider_cli.mjs connect --provider feishu
```

- 禁止在无匹配版式时套用廉价通用蓝白骨架敷衍。

## 3. 双通道制作流（Step 2 ～ Step 4）

### 通道 A：有可编辑 `.pptx` 母本（L1 · 五步无损改版）
严禁新建空白页重画，按五步原位改版：
1. `inspectTemplateDeck({ pptxPath, outDir })` 提取元素锚点（`sh/`、`im/`、`tb/`、`ch/`）；
2. 编写 `template-frame-map.json` 并过 `validateTemplatePlan({ map, inspection })`；
3. `prepareStarterDeck({ pptxPath, map, outPptxPath })` 无损抽页并自动清理未用媒体；
4. 原位改写：`.text.set()` / `.text.replace()` 保样式换字、`.replace({ path, fit: "cover" })` 保蒙版裁切换图、`slide.charts.add()` / `slide.tables.add()` 混合注入原生表图；
5. `auditTemplateFidelity({ sourcePptxPath, finalPptxPath, expectedSlideCount })` 保真稽查。

### 通道 B：图片 / 截图 / PDF 1:1 复刻（先读 [结构还原与图形内文字规范](references/structure-and-text.md)）
按复杂度分级，禁止一刀切浪费 Token：
- **L2（常规卡片 / 表格 / 图表 / 时间轴）**：单步成稿 + 1 次全页并排审图。
- **L3（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形 / 复杂流程图）**：
  1. **采色测透**：`node skills/yuanmou-ppt/scripts/deck_cli.mjs inspect-ref --ref ./ref.png --out ./work/inspect --crops "zone:x,y,w,h"`，确认透底（`<a:alpha>` 渐变）、最深墨色与字号（`pt ≈ h_px × 0.80`）；
  2. **骨架叠图校准**：先拼装 `structure` 骨架（单图形底色+富文本、`buildRoundedTrapezoidPath`），再跑 `deck_cli.mjs diff --ref ./ref.png --gen ./work/s1.png --out ./work/diff --crops "..." --pptx ./work/out.pptx --gallery ./work/gallery.html`，审阅 `overlay_3panel.png` 与 `zoom_*_2x.png`（最多 1~2 轮收敛）；
  3. **锁死样式灌入正文**：壳子通过后切换 `final` 模式，锁死几何/透明/字号/字色，原位替换用户图文。

## 4. 中文商业文案铁律（Anti-Slop）

- 封杀 AI 水词与句式：`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`；禁单段滥用 `——` 或行内假圆点 `A • B • C`。
- 内容页主标题必须结论前置（Action Title）；正文不低于 `12pt`，挤不下先删废话，不强缩字号。

## 5. 终检门禁与视觉验收（Step 5 ～ Step 6）

交付前必须跑通 `finalizeDeck({ deck, outputPath, antiSlop: "fail" })` 与 `renderDeckToPngs(outputPath, { outDir, dpi: 220 })`：
1. **强制并排 Diff 自检**：有参考图/母本时，必须先生成「左原图 vs 右成稿」并排图亲自审图，核对：① 标题/正文视觉字号偏差 ≤15%；② 相邻区块接触拓扑（半压/贴边/留白）；③ 圆角梯形/渐变/描边边缘；④ 图片区尺寸节奏。不达标必须返工；
2. **交付附带对比画廊**：用 `buildShowcaseGalleryHtml()` 输出 Base64 内联 HTML 画廊（禁止外部相对路径防裂图）。
