---
name: yuanmou-ppt
description: 图片转 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 商业级原生 PPTX 生成与母本无损改版技能（Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持任意参考图/小红书截图/PDF 1:1 矢量复刻为可编辑 PowerPoint、既有 .pptx 无损换字换图、内嵌 .xlsx 可双击改数真图表、原生比例表格、免登录商业版式库/飞书云盘版式库及多道原子终检门闸。
---

# Yuanmou PPT Skill (`@yuanmou/pptx-kit`)

> 下文 `<SKILL_DIR>` 指本 `SKILL.md` 所在目录。无论用户当前在哪个工作目录，一律通过 `<SKILL_DIR>/scripts/{provider_cli,deck_cli,kit}.mjs` 调用，严禁写死相对仓库路径。

## 1. 铁律与红线（不翻源码、不绕路）

1. **纯原生 OOXML（禁止简化或贴图）**：所有构建、改版、图表与终检均调用 `<SKILL_DIR>/scripts/kit.mjs`；严禁 `python-pptx`，严禁简化/合并省略结构，严禁用整页背景图或截图碎片冒充表格/流程图/可编辑重绘。图表必须内嵌 `.xlsx` 可双击改数。
2. **单图形承载底色与富文本（严禁框中套框）**：圆角矩形、色带、圆形、箭头等带底色/描边节点必须在同一个 `<p:sp>` 上直接设 `fill / line / text / textStyle`（多字号/多色用富文本 `runs`）；**严禁另套内框、覆盖透明文本框或用编组冒充**；表格文字直写单元格；项目符号用 `makeBulletList()`，禁手敲 `"• "`；禁 4+ 连续空格定位（改用原生对齐/制表位/表格）；跨系统优先通用字体且窄标签留足 5% 宽度余量防换字掉孤字。
3. **只读保护与交付边界**：区分「内容源」与「版式参考」（仅用户指定或确认的参考页决定版式）；要求原稿不动时严禁改写原件（可用 `verify --readonly-source` 锁哈希），核对物理页码、隐藏页与独立单页交付份数。
4. **强制视觉自检**：所有成稿必须跑通 `deck_cli.mjs verify`（自动依赖 **Node >=22.5 + LibreOffice (`soffice`) + Poppler (`pdftoppm`)**；缺项时会直接报错并给出安装命令，无需每轮空跑 `check-env`）。

## 2. 内容解构 → 1 条命令全库同构选版（Step 1）

**严禁不读内容乱搜、严禁手搓裸 SQL 绕过同构打分**；无现成指定参考图时按两步走（已指定版式/仅调色/局部修形直接跳过海选）：

1. **按逻辑单元提炼「槽位指纹」**：通读原稿，不把 Markdown 章节或 PDF/Word 原页机械当 1 页；逐页拆出 `purpose`（支持逗号多词如 `"执行策略,方法论"`）、`diagramFamily`（`flow/funnel/timeline/hierarchy/cycle/branch/radial/matrix/comparison`）、`targetImages`（单张账号主页/后台界面按 1 计）、`targetTextSlots`、`targetResults`、`whiteBackground` 及是否需表格/图表；区分用户硬要求与初拟分组弹性。
2. **1 条命令出多页单选看板（默认自动探活 `feishu` -> `local` 免登录库，纯离线设 `YUANMOU_OFFLINE=1`）**：多页（4～6 页/批）直接写一份 `pages.json` 跑 **`batch-search`**，1 次完成全库打分、本地缓存优先并发拉无损图并输出**严格单选、默认不勾选、支持左原稿对照与一键复制**的 Base64 HTML 看板（严禁换字加工冒充原图；候选少时放宽自加弹性条件；“再找一轮”时传 `exclude` 并沿用否定原因；**未获用户确认前严禁重绘或填充**）：

```bash
# 多页一条龙：全库双向同构打分 + 拉无损图 + 直出严格单选分节看板
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --fetch-previews --out ./selection_board.html

# 单页速查（可选连接飞书 VIP 全量库：provider_cli.mjs connect --provider feishu）
node <SKILL_DIR>/scripts/provider_cli.mjs search-slides --purpose "执行策略,方法论" --diagram-family funnel \
  --target-images 0 --target-text-slots 4 --white-background --fetch-previews --limit 3 --out ./selection_board.html
```

## 3. 双通道制作流（Step 2 ～ Step 4）

### 通道 A：既有 `.pptx` 母本（L1 · 原位无损改版）
严禁新建空白页重画：`inspectTemplateDeck` → 写 `template-frame-map.json` 并 `validateTemplatePlan` → `prepareStarterDeck` 无损抽页 → `.text.set()` / `.text.replace()` 保样式换字 + `.replace({ path, fit: "cover" })` 换图 + 原生表图注入 → `auditTemplateFidelity`。

### 通道 B：图片 / 截图 / PDF 1:1 复刻（分级提速，不搞一刀切）
多页任务用**模块化单页文件**推进（`slides/p1.mjs`…`pN.mjs` 各自 `export function addSlide(deck) { ... }`，再由 10 行 `build_deck.mjs` 汇总 `Presentation.create()` 一次性导出，绝不生成 N 个散装 `.pptx` 再硬合并）：
- **L2（常规卡片 / 表格 / 图表 / 时间轴，占 ~80% 场景）**：**单步直出**完整内容稿 → 跑 1 次 `deck_cli.mjs verify` 看 `qa_sheet.png`（多页合一总览图，1 次读图审完）即可。
- **L3（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形 / 复杂曲线，遇难题再按需查 `references/structure-and-text.md`）**：
  1. `node <SKILL_DIR>/scripts/deck_cli.mjs inspect-ref --ref ./ref.pdf --page 1 --out ./work/inspect`（原生支持 PNG/JPG/PDF，自动采色与 2× 切片）；
  2. 先拼装 `structure` 骨架（单图形底色+富文本、`buildRoundedTrapezoidPath`、`buildPolylineStrokeCommands`），跑 `verify --ref ./ref.png` 核对 `overlay_3panel.png` 与自动定位的 `zoom_hotspot_*_2x.png`（最多 1~2 轮收敛；自检通过即继续，不中途打断问用户）；
  3. 切 `final` 锁死几何/透明/字号/字色，优化文案并原位替换用户图文（有源 PPT 时优先提取内嵌原图，保留关键数字与账号身份）。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标并保可见层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔铁律（Anti-Slop）

- 严禁编造数据、严禁把建议/目标/Demo 数字写成已实现成果，严格保留原稿指标名称、数值与统计周期；缺量化成果时仅写已有执行产出与定性成果，**待补数据放交付说明，严禁把 `[待补充]` / `TBD` 写进页内**（已被 `finalizer` 自动拦截）。
- 封杀 AI 水词（`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`）、单段滥用 `——`、行内假圆点 `A • B • C`。
- 内容页主标题结论前置；正文 `>=12pt`，挤不下先删废话，不强缩字号。

## 5. 一条龙终检与视觉验收（Step 5）

交付前 1 条命令跑完「**全部自动门禁**（ECMA-376 包结构 + 越界/碰撞/框中套框/内切宽溢出/WCAG 对比度/整页贴图冒充/长空格/Anti-Slop/`[待补充]` + 字体 + 表格合计与 `.xlsx` 图表同步）+ **缓存加速渲染** + **`qa_sheet.png` 总览图** + **自动热点 2× 对比 & Base64 HTML 画廊**」：

```bash
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref ./ref.png --gallery ./output/qa_gallery.html --anti-slop fail
```

1. 必须亲自 `read_file` 审阅 `qa_sheet.png`（及有参考图时的 `side_by_side.png` / `zoom_hotspot_*_2x.png`），不达标必须返工；
2. 交付附带 `.pptx` + Base64 HTML 对比画廊，并如实写明渲染器、字体替换与验证范围（仅实际用 PowerPoint/WPS 打开过才标实机通过）。

## 6. `@yuanmou/pptx-kit` 零翻源码 API 速查（1280×720 坐标）

```js
import {
  Presentation, finalizeDeck, makeBulletList, fr, fixed,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
} from "<SKILL_DIR>/scripts/kit.mjs";

const deck = Presentation.create({ title: "方案标题", defaultFont: "PingFang SC" });
const s = deck.slides.add({ background: "#FFFFFF" }); // 或 { type: "linear", angle: 135, stops: [...] }
// 1) 带底色单图形直写文字（严禁再叠透明文本框）
s.shapes.add({
  name: "卡片标题", geometry: "roundRect", borderRadius: 8,
  position: { left: 64, top: 120, width: 320, height: 56 },
  fill: "#0F3A7D", line: { fill: "#0F3A7D", width: 1 },
  text: "结论前置标题", // 富文本可用 [{ runs: [{ run: "主标", bold: true, fontSize: 18 }, ...] }] 或 makeBulletList(["条目1","条目2"])
  textStyle: { fontSize: 18, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle", insets: { left: 10, right: 10, top: 6, bottom: 6 } },
});
// 2) 原生图片 / 比例表格 / 内嵌 .xlsx 真图表
s.images.add({ path: "./shot.png", position: { left: 64, top: 200, width: 420, height: 280 }, fit: "cover", borderRadius: 8 });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await finalizeDeck({ deck, outputPath: "./work/candidate.pptx", antiSlop: "fail" });
```
