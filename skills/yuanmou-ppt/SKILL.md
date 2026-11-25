---
name: yuanmou-ppt
description: 图片转 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 商业级原生 PPTX 生成与母本无损改版技能（Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持任意参考图/小红书截图/PDF 1:1 矢量复刻为可编辑 PowerPoint、既有 .pptx 无损换字换图、内嵌 .xlsx 可双击改数真图表、原生比例表格、飞书云盘无水印版式图库及 5 道原子终检门闸。
---

# Yuanmou PPT Skill (`yuanmou-ppt` · `@yuanmou/pptx-kit`)

> **开源协议**：本技能及 `@yuanmou/pptx-kit` 代码引擎采用标准 **[Apache License 2.0](../../LICENSE)**，**允许个人学习、企业内部汇报与商业项目免费使用**（二次分发须按 Apache-2.0 保留「渊眸策略」版权与 `NOTICE` 署名）。飞书云盘内共享的精选/VIP 高清版式参考图库受会员共享条款保护，严禁转售或公开二次分发。

---

## 一、核心工程铁律（严禁违背）

1. **严禁使用 `python-pptx` 或截图糊弄**：
   - 所有 `.pptx` 构建、模板改版、图表生成与终检必须调用本仓库内置零依赖引擎 `@yuanmou/pptx-kit`（Node.js `>=20` ESM）。
   - 严禁把数据表、流程图或文字渲染成 PNG 整张贴进幻灯片冒充可编辑内容；所有形状、富文本、表格 `<a:tbl>` 与图表 `<c:chart>`（含 `ppt/embeddings/*.xlsx`）必须 100% 原生可双击编辑。
2. **单图形承载底色与富文本**：
   - 带背景或描边的标签、卡片标题直接在同一个 `<p:sp>` 上设置 `fill / line / text / textStyle`，禁止“底色矩形 + 悬浮透明文本框”双层硬叠导致错位。
   - 项目符号必须调用 `makeBulletList()` 生成原生悬挂缩进（`<a:buChar>`），禁止在文本开头手敲 `"• "`。
3. **跨平台透明渐变描边**：
   - 当复刻双向消隐或局部透明渐变边框时，使用 `buildPolylineStrokeCommands()` 生成闭合矢量描边条并赋予多色标 `<a:gradFill>`（兼容 PowerPoint、WPS 与 LibreOffice 无头渲染）。

---

## 二、可插拔数据源路由（Step 1：先探活数据源）

执行选版或拉图前，先运行统一数据源 CLI 探测当前激活的 Provider（自动优先级：`feishu` 飞书云盘 -> `yuanmou-cloud` -> `zsxq` -> `local` 本地离线）：

```bash
# 0) 首次连接飞书云盘共享版式库（支持免费体验仓 / VIP 全量仓，扫码授权 1 次即可自动续期）
node skills/yuanmou-ppt/scripts/provider_cli.mjs connect --provider feishu

# 1) 查看当前激活的数据源模式（feishu / local / yuanmou-cloud / zsxq）
node skills/yuanmou-ppt/scripts/provider_cli.mjs status

# 2) 同步脱敏版式索引库 ppt-index-dist.db.gz 至本地缓存（~/.cache/yuanmou-ppt/feishu/，后续查库 0 API 消耗）
node skills/yuanmou-ppt/scripts/provider_cli.mjs sync-index

# 3) 按槽位指纹或图示家族（flow/funnel/timeline/hierarchy/cycle 等）检索引导并按需拉取无损原图生成 Base64 选版看板
node skills/yuanmou-ppt/scripts/provider_cli.mjs search-slides \
  --diagram-family funnel --fetch-previews --limit 6 --out ./selection_board.html

# 4) 按需下载单张选定的无损高清原图 PNG（自动永久缓存本地）
node skills/yuanmou-ppt/scripts/provider_cli.mjs fetch-asset \
  --kind preview --cid CP_5c8f88c67d22cc4de3a5 --file-token <feishu_file_token>
```

- **路线一（`local` 开源免登录模式 · 默认开箱即用）**：无需登录或配置环境变量，自动静默同步 **2,000 页无水印精选商业版式库**（含 1,011 个结构化图示 + 封面/目录/图表/表格）到本地缓存，按需拉取高清无损原图直出选版看板并 1:1 复刻；也支持直接丢入任意参考截图/PDF 复刻或改版自带 `.pptx`（纯离线可设 `YUANMOU_OFFLINE=1`）。
- **路线二（`feishu` 飞书云盘 VIP 全量仓）**：通过飞书 OAuth 用户级授权接入 **29,000+ 页**持续日更的全行业无水印高清原图与 12 类图示家族索引，本地毫秒级搜库，按需拉取原始无损 PNG 走通道 B 1:1 复刻。

---

## 三、双通道制作流（Step 2 ～ Step 4）

### 通道 A：有可编辑 `.pptx` 母本 —— 走「五步无损外科手术流」
当选中星球/云端 `5xxx.pptx` 或用户提供的 `.pptx` 模板时，**严禁新建空白页重画破坏原版设计**，必须按五步闭环原位改版：

1. **拆包体检**：`inspectTemplateDeck({ pptxPath, outDir })` 获取元素锚点（`sh/...`、`im/...`、`tb/...`、`ch/...`）、画布尺寸与字体清单。
2. **编写并预检作战图**：编写 `template-frame-map.json`（逐页声明 `sourceSlide`、`narrativeRole` 与 `editTargets`），调用 `validateTemplatePlan({ map, inspection })`，确保零遗漏模板占位符。
3. **无损抽页合页**：调用 `prepareStarterDeck({ pptxPath, map, outPptxPath })` 克隆目标源页（内置 OPC 可达性垃圾回收自动剥离未选页冗余媒体，完整保留母版、渐变、异形扇环与蒙版）。
4. **原位换字、换图与混合注入**：
   - 文本改写：`deck.resolve("sh/...").text.set(...)`（自动逐段继承原版字号、字色与项目符号）或 `.text.replace(oldStr, newStr)`（支持跨 `<a:r>` 拆词精准替换）；
   - 蒙版保裁切换图：`deck.resolve("im/...").replace({ path: imgPath, fit: "cover" })`（自动写入 `<a:srcRect>` 居中裁切并隔离新建 `rId`，100% 保留原版圆角/异形蒙版）；
   - 混合注入原生表图：在 `ImportedSlide` 上直接调用 `slide.charts.add(...)` 或 `slide.tables.add(...)`。
5. **反作弊保真稽查**：调用 `auditTemplateFidelity({ sourcePptxPath, finalPptxPath, expectedSlideCount })`。

### 通道 B：PDF / 截图参考或无模板 —— 按难度分级执行（省 Token 且高保真）
创建或调整原生图形前，先阅读 [结构还原与图形内文字规范](references/structure-and-text.md)。**严禁一刀切对所有页面跑多轮裁图浪费 Token**，按页面复杂度自动分级：
- **L2 · 常规截图 / 标准内容页**（多栏卡片、原生表格、原生图表、常规时间轴）：直接单步出稿 + 1 次全页并排审图，不拆 `structure` 轮次、不切局部放大图。
- **L3 · 高难异形截图 1:1 复刻**（含半透明玻璃叠层、弧边锥体、渐窄箭头、圆角倒梯形、复杂流程图）：才启用以下三段流（且单页严控最多 1~2 轮收敛，优先一次读合并图节省视觉 Token）：

1. **Step B1 · 局部 2× 采色测透（仅 L3 复杂页调用现成 CLI）**：
   - 调用内置硬工具 `deck_cli.mjs inspect-ref` 对高细节区切出 **2× 放大局部图** 并输出顶/中/底色、最深文字墨色与主色占比：
     ```bash
     node skills/yuanmou-ppt/scripts/deck_cli.mjs inspect-ref \
       --ref ./ref_slide.png --out ./work/ref_inspect \
       --crops "sidebar:15,185,110,500;funnel:480,340,390,330"
     ```
   - 结合采样值确认：**填充是否透底**（透底用 `linear-gradient(180deg, rgba(R,G,B,0.96), rgba(R,G,B,0.08))` 输出 `<a:alpha>`）、**描边色**、**文字最深墨色**及**字重/字号**（`pt ≈ h_px × 0.80`，特粗标题优先选本机可用 Heavy/W6 字重）。

2. **Step B2 · 复杂局部精雕 → 拼装整页 `structure` 骨架（仅 L3 复杂页）**：
   - 先对弧边锥体、半透明分层椭圆、渐窄箭头、圆角倒梯形（`buildRoundedTrapezoidPath`）等高细节区单独建模，重点核对**弧边曲率、透明透底与跨对象穿插交点**（如箭头肩部在椭圆上沿上方还是齐平），再拼装回整页 `structure` 骨架（遵循“单图形承载底色与富文本”）。
   - 渲染后调用 `deck_cli.mjs diff` 一键生成 **全页并排图 + 三联 50% X 光叠图 + 2× 局部并排图 + Base64 对比画廊**：
     ```bash
     node skills/yuanmou-ppt/scripts/deck_cli.mjs diff \
       --ref ./ref_slide.png --gen ./work/structure-1.png --out ./work/diff \
       --crops "sidebar:15,185,110,500;funnel:480,340,390,330" \
       --pptx ./work/slide_final.pptx --gallery ./work/comparison_gallery.html
     ```
   - 审阅 `overlay_3panel.png` 与关键 `zoom_*_2x.png`，复杂图形若有修正再复核一次确认无误，然后进入 B3。

3. **Step B3 · 优化当页文案 + `final` 模式锁死样式灌入用户图文**：
   - 仅在壳子通过后优化当页业务文案（保留原稿真实数据与逻辑，按原槽位容量精炼，绝不编造或靠极小字硬塞）；
   - 切换 `final` 模式，**锁死全部几何路径、坐标、透明渐变、描边、字号、字重与字色**，原位替换用户文案与案例图，再过 Step 5~6 五门禁与宽屏左右对比画廊交付。

- 若用户既未提供 `.pptx` 母本也未提供参考截图，**不要套用廉价通用蓝白骨架敷衍成稿**；优先请用户贴一张喜欢的参考页面截图（1:1 复刻），或引导连接**渊眸飞书云盘免费体验仓**（`provider_cli.mjs connect --provider feishu`）直接按槽位/图示家族挑选无水印商业参考原图。

---

## 四、中文商业文案去 AI 腔铁律（Anti-Slop）

1. **封杀典型 AI 水词与句式**：
   - 严禁出现 `“不是 X，而是 Y”`、`“深度赋能”`、`“核心抓手”`、`“生态闭环”`、`“打出组合拳”`、`“底层逻辑重构”`、`“开启新篇章”`。
   - 严禁单段滥用多个破折号 `——` 或行内假圆点串词 `A • B • C`。
2. **结论前置（Action Title）**：
   - 内容页主标题必须是有业务判断或定量支撑的短句（如 `“全时段曝光与核销呈双峰集中，午晚两档贡献 85% 业绩”`），不写空泛名词口号。
3. **挤不下先删废话**：
   - 正文字号不低于 `12pt`，卡片留足呼吸感；若文案超长，精炼词句而非强缩成蚊子字。

---

## 五、五道原子终检门闸与真机视觉对比（Step 5 ～ Step 6）

任何 `.pptx` 交付给用户前，**必须依次跑通原子终检与无头渲染肉眼核验**：

```js
import { finalizeDeck, renderDeckToPngs } from "@yuanmou/pptx-kit";

// Step 5: 过 5 道质量门闸（包粒子序 / 越界叠字 / 本机字体 / 字宽溢出与去AI腔 / 表图算术核对）并原子发布
await finalizeDeck({
  deck,
  outputPath: "./deliverables/proposal_final.pptx",
  antiSlop: "fail",
});

// Step 6: 渲染高清 PNG 并逐页检视（若有参考模板，生成左原图 vs 右成稿 Base64 内联对比画廊）
await renderDeckToPngs("./deliverables/proposal_final.pptx", {
  outDir: "./deliverables/rendered",
  dpi: 220,
});
```

所有向用户交付的成品必须满足以下三条视觉验收铁律：
1. **强制并排视觉 Diff 自检 + 返工闭环**：只要存在参考模板（无论 `.pptx` 母本还是参考截图/PDF），**严禁只看单独渲染图就宣布完工**！必须先生成「左：参考模板原图 vs 右：最终成稿渲染图」的逐页并排对比图并亲自审图，逐项核对 4 项硬指标：① 标题/通栏/正文字号视觉占比是否一致（偏差 ≤15%）；② 相邻区块接触拓扑（半压重叠 / 无缝贴边 / 留白）是否忠实；③ 圆角倒梯形/渐变/描边粗细等几何边缘是否一致；④ 图片区尺寸节奏与有无外框是否一致。**任一项不达标必须执行精修返工，直到并排图过关再交付**。
2. **交付必须附带并排对比图**：最终验收报告与画廊必须把「左原图 vs 右成稿」并排对比图直观呈给用户核验。
3. **Base64 内联画廊防裂图**：调用 `buildShowcaseGalleryHtml()` 生成的 HTML 验收画廊自动将对比图以 `data:image/png;base64,...` 内联，严禁使用外部相对路径导致沙盒预览裂图。
