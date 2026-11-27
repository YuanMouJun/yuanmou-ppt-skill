---
name: yuanmou-ppt
version: 0.2.0
description: 一句话从零策划生成整套商业 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 既有 .pptx 母本无损改版全能技能（All-in-One AI PPT Generator & Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持一句话主题咨询级大纲与文案策划、1.6W+ 免登录商业版式库 / 10W+ 飞书云盘版式库同构选版、复杂自由排版与半透明玻璃/菱形斜切/水墨笔刷蒙版 1:1 复刻、内嵌 .xlsx 可双击改数真图表及 6 组 15 项自动代码门禁与多页左右对照验收。
---

# Yuanmou PPT Skill (`@yuanmou/pptx-kit`)

> **角色心智**：你是兼具顶流咨询合伙人逻辑与现代美术馆策展人审美的演示文稿总监。每页只保留真正服务信息层级的元素——**绝不为了“炫技”给极简/科技页强加违和笔刷或杂乱边框，也绝不用网页截图或扁平图片冒充可编辑 PPT**。交到用户手里的每一张图表都能双击弹出真 Excel，每一处矢量与文字都能在 PowerPoint / WPS 里直接改。
>
> `<SKILL_DIR>` 指本 `SKILL.md` 所在目录。一律通过 `<SKILL_DIR>/scripts/{provider_cli,deck_cli,kit}.mjs` 调用，严禁写死相对仓库路径；**制作 PPT 时严禁篡改技能目录本体脚本**（仅当用户明确要求“更新/升级技能”时执行 `node "<SKILL_DIR>/scripts/deck_cli.mjs" update`）。

## 0. 任务分流路由（先定路线再动手）

| 用户需求 | 唯一正确路线 |
| :--- | :--- |
| **检查更新 / 升级本技能**（如“更新技能 / 检查新版本”） | 运行 `node "<SKILL_DIR>/scripts/deck_cli.mjs" check-update` 或 `update`（国内直连镜像 + SHA-256 增量校验） |
| **只要 Markdown（`.md`）/ 纯文本逐页大纲与要点**（未要求生成 `.pptx`） | 直接按咨询结构（MECE / 结论前置）与第 4 节 Anti-Slop 写出最终 `.md` 到目标目录（如 `./output/`），**不启动 `.pptx` 构建与渲染** |
| **既有 `.pptx` 母本原位改版** | 走 **通道 A**（`inspectTemplateDeck → prepareStarterDeck → 原位换字换图 → auditTemplateFidelity`），严禁新建空白页重画 |
| **已指定参考图 / 截图 / PDF 1:1 复刻**（或仅调色/局部修形） | 跳过选版海选，直接走 **通道 B（4 类视觉页型分流 + 原生复刻）** |
| **一句话主题 / 纯文稿生成整套 `.pptx`**（若同时要 `.md` 则先落盘 `.md`） | 走 **第 2 节（咨询策划 + 可选同构选版）→ 通道 B**；若用户要求一键直出或离线无可用模板库，跳过选版直进通道 B |

## 1. 核心铁律（不翻源码、不绕路）

1. **纯原生 OOXML（禁止简化或贴图）**：所有 `.pptx` 构建、改版、表图与终检调用 `<SKILL_DIR>/scripts/kit.mjs`；严禁 `python-pptx`，严禁简化省略结构，严禁用整页贴图冒充表格/流程图/可编辑重绘。图表必须内嵌 `.xlsx` 可双击改数。
2. **小节点单框合一 vs 大装饰外框内独立定位**：按钮、标签、流程图节点或单段卡片必须在同一 `<p:sp>` 上直设 `fill / line / text / textStyle`（富文本 `runs` 支持 `{ text, bold, fontSize, color }` 平层写法），严禁在单个小卡片上另盖透明文本框；**但对于跨区域的 `fill: "none"` 大尺寸装饰外框或多分区复合底板，内部不同方位的元素（如左上角标、居中超大标题、右下注解）应按真实坐标独立放置**，严禁强塞进同一文本框靠空行硬顶导致上半截空洞。表格文字直写单元格；列表用 `makeBulletList()`，禁手敲 `"• "`；**严禁用 `☀ / ▶ / 《` 等 Emoji/标点冒充图标，严禁用 `[ 姓名 ] | [ 手机 ]` 冒充表单 UI**；禁 4+ 连续空格定位；窄标签留足 5% 余量（菱形安全区仅 `0.50×宽 × 0.50×高`）。
3. **只读保护、重做隔离与「先落盘、再精修」**：要求原稿不动时严禁改写原件（可用 `verify --readonly-source` 锁哈希）；**用户要求从头重做或换风格时，严禁跨旧工作目录偷拿废弃配图**。构建脚本用 `await deck.save("./work/candidate.pptx")` 写出候选包，把唯一一次门禁校验与落盘 `--final` 交给 `deck_cli.mjs verify`（避免重复校验）；**首轮过代码门禁后立刻把正式成稿落盘到用户目标目录（如 `./output/final.pptx`），再做 1～2 轮视觉精修覆盖更新**。
4. **强制视觉自检 + 无依赖离线降级（代码全绿 ≠ 视觉达标）**：所有 `.pptx` 必跑 `deck_cli.mjs verify`。本机具备 **LibreOffice (`soffice`) + Poppler (`pdftoppm` 或 `pypdfium2`)** 时强制真机渲染并审图返工；**若缺渲染依赖，严禁上网下载安装包/字体或自绘近似假图冒充真机渲染**——`verify` 自动完成 **6 组 15 项静态代码门禁**并原子落盘 `--final`（返回 `verificationMode: "code-gates-only"`, `visualVerified: false`），桌面端提示用户安装复验，受限沙箱则在交付说明首行如实标注未做真机渲染。

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

- **页型 1 · 全出血大图 + 半透明暗罩 / 透明细线框**：满屏底图 + 中层半透明暗罩（`fill: "#0B1120/55%"` 或 `{ color, opacity: 0.55 }`）+ 顶层 `fill: "none"` 大线框，框内左上角引子与中心巨幅主标题独立定位并撑足原版字号量级；**严禁用 100% 实心矩形盖死底图**。
- **页型 2 · 菱形 / 斜切多边形 / 倾斜叠图 / 有机水墨笔刷**：
  - 几何裁图与多层叠卡：用 `images.add({ geometry: "diamond" })`、`images.add({ svgPath, viewBox })`、微倾白边叠卡（`rotation: -8`）与 `shapes.add({ svgPath, viewBox })`，**严禁退化成水平 `roundRect`**。
  - 毛笔飞白 / 书法印章 / 异形蒙版：**有参考图复刻时，首选 `applyAlphaMaskToImage({ refMaskPath, refCrop })`（`refCrop` 直接传 `1280×720` 画布坐标提取 1:1 轮廓）**；若返回 `bleedWarning: true`（参考照片边缘与背景同色漫灌）或需拼多道斜刷/角落局部飞白，使用通用多笔触 **`strokes: [{ from: [x1,y1], to: [x2,y2], width }]`**（无参考图才用 `maskPreset`）。区分 **`ink-circle-solid`（实心印章衬底托白字）** 与 **`ink-circle-ring`（中空圆环描边）**；暗底叠加笔刷须保证明度差清晰可见，**文字必须保留为上层原生可编辑 `<p:sp>`**。
- **页型 3 · 实物载体物件 / 散点路线图 / H5 弹窗 / 表单与社媒卡片**：承载主题文案的实物载体（书封、屏幕、路牌、展板等）**生图只生无字干净载体，主题文字一律用上层原生 `<p:sp>`（支持 `rotation` 倾斜贴合）叠加**；动线故事页保持多节点散点与倾斜贴纸气泡（`shapes.add({ rotation: -16 })`）排布，搭配原生虚线连接线（`geometry: "connector"`）、独立表单输入框/按钮与圆形头像，**严禁退化为单张居中孤岛插画或纯文本方括号**。
- **页型 4 · 常规商务卡片 / 表格 / 图表 / 高难玻璃叠层精雕**：
  - 常规页：直出内容稿 → `deck_cli.mjs verify` 先落盘再看图微调；
  - 高难参考图（半透明玻璃叠层 / 弧边锥体 / 渐窄箭头 / 圆角倒梯形，按需查 `references/structure-and-text.md`）：有渲染依赖时先 `inspect-ref` 采色与 2× 切片 → 先建骨架并跑 `verify --ref ./ref.png` 核对 `overlay_3panel.png` 与 `zoom_hotspot_*_2x.png` → 再注入正式内容。
- **特殊授权改版**：**仅调色**沿用原有几何/素材/文案，改白底时逐个映射渐变色标保层次；**横竖重排**保持文字正常阅读方向，禁整图旋转。

## 4. 文案保真与去 AI 腔铁律（Anti-Slop）

- 严禁编造数据、严禁把目标/示意数字写成已实现成果，保留原稿指标名、数值与周期；缺数据仅写已有产出，**待补数据放交付说明，严禁把 `[待补充]` / `TBD` 写进页内**。
- 封杀 AI 水词（`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`）、单段滥用 `——`、行内假圆点 `A • B • C`。
- 内容页主标题结论前置；**正文与表格 `>=12pt`**（`<9pt` 门禁 `fail`，`9–11.9pt` 触发 `warn`），挤不下先精简废话，不强缩字号。

## 5. 环境探活、版本提醒与一条龙终检验收

开工前可先跑 `node "<SKILL_DIR>/scripts/deck_cli.mjs" check-env` 探活渲染环境与版本状态（内置 24h 缓存与 1.5s 超时静默兜底，断网不报错；若返回 `update.available === true`，**不中断当前任务**，仅在最终交付末尾顺带提醒一句发现新版本 `vX.Y.Z` 及更新亮点，用户确认后再跑 `deck_cli.mjs update`）。

`verify` 1 条命令跑完 **6 大门禁组 · 15 项自动代码检查**（ECMA-376 包结构、越界、碰撞、框中套框、菱形/窄图形内切宽、WCAG 对比度、整页贴图冒充、实心块遮死底图、长空格与假圆点、脏 Emoji/假表单方括号、正文与表格最小字号、Anti-Slop、页内占位符、字体核查、表图 `.xlsx`/算术同步）并原子落盘 `--final`；有渲染依赖时自动出 `compare_batch_*.jpg` + 多页对照 PDF（`qa_compare.pdf`，不再生成 HTML）：

```bash
# 多页参考图/PDF 复刻（--ref-dir 自动输出逐页左原模板 vs 右成稿对照 PDF 与 4 页一组高清审图批）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref-dir ./refs --pdf ./output/qa_compare.pdf --anti-slop fail

# 单页高难参考图对比（--ref 自动输出 50% X 光叠图 + Top-2 误差热点 2× 放大对照 PDF）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --out ./work/qa --ref ./ref.png --pdf ./output/qa_compare.pdf --anti-slop fail
```

1. **分批高清精审与 `lowestPages` 结构复核**：当 `visualVerified: true` 时，**严禁只看邮票总览图，也严禁同一轮并发 `read_file` 塞入超过 2 张 `compare_batch_*.jpg`（每轮最多精审 8 页，防注意力稀释漏看细节）**。逐页（尤其针对 `diff.lowestPages` 低分页面：若仅因跨行业更换深浅色照片导致像素分低属正常；若属版式结构偏差则必须返工）核对：① 主标题与主视觉占框比/字号量级是否饱满匹配、有无上半截黑洞 ② 对角/局部留白构图重心是否跑偏（勿把角落斜刷铺成满宽横条） ③ 实心印章与空心圆环、气泡倾斜角（`rotation`）、时间轴垂直刻度连接线等锚点有无漏画 ④ 书封/屏幕等载体有无漏叠原生主题字 ⑤ 配图是否高频重复；失真项集中修改后重新跑 `verify` 覆盖 `./output/final.pptx`。
2. **离线降级如实声明**：若返回 `verificationMode: "code-gates-only"`（`visualVerified: false`），直接交付已过 6 组 15 项代码门禁的 `.pptx`，桌面端附 `installHint` 建议安装复验，受限沙箱在交付说明首行如实标注未执行真机渲染，并核对 `warnings` 不谎称 12pt 全部合规。

## 6. `@yuanmou/pptx-kit` 零翻源码 API 速查（坐标 `px` 1280×720 · `fontSize` 数值默认 `pt`）

> 单位约定：`position / left / top / width / height / borderRadius / insets` 均用 `px`（同时支持 `position: {...}` 与平层 `left/top/width/height`）；**`fontSize / spaceBefore / spaceAfter` 数值默认 `pt`**（`14` 即 `14pt`，显式 `"24px"` 折算 `18pt`）。脚本一律从工作区根目录运行或用 `path.resolve`；跨平台导入请用 `pathToFileURL`：

```js
import path from "node:path";
import { pathToFileURL } from "node:url";
const {
  Presentation, finalizeDeck, makeBulletList, fr, fixed,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
  createBrushPng, applyAlphaMaskToImage,
} = await import(pathToFileURL(path.resolve("<SKILL_DIR>/scripts/kit.mjs")).href);

const deck = Presentation.create({ title: "方案标题", defaultFont: "Microsoft YaHei" }); // macOS 也可设 "PingFang SC"
const s = deck.slides.add({ background: "#FFFFFF" }); // 或 { type: "linear", angle: 135, stops: [{ offset: 0, color: "#0B1120" }, { offset: 1, color: "#1E3A8A" }] }

// 1) 全出血底图 + 半透明暗罩 + 透明大装饰外框（框内引子与巨幅主标题按真实坐标独立放置！）
s.images.add({ path: "./hero.jpg", position: { left: 0, top: 0, width: 1280, height: 720 }, fit: "cover" });
s.shapes.add({ name: "暗角遮罩", geometry: "rect", position: { left: 0, top: 0, width: 1280, height: 720 }, fill: { color: "#0B1120", opacity: 0.48 }, line: { fill: "none" } });
s.shapes.add({ name: "透底白线框", geometry: "rect", position: { left: 64, top: 140, width: 1152, height: 440 }, fill: "none", line: { fill: "#FFFFFF", width: 10 } });
s.shapes.add({ name: "左上引子", geometry: "textbox", position: { left: 120, top: 190, width: 420, height: 36 }, text: "How about your living room?", textStyle: { fontSize: 16, color: "#E2E8F0" } });
s.shapes.add({ name: "居中主标题", geometry: "textbox", position: { left: 120, top: 250, width: 1040, height: 260 }, text: "你是否\n时常有这种感觉？", textStyle: { fontSize: 72, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" } });

// 2) 参考图 1:1 泛洪轮廓蒙版（首选） / 多笔触组合飞白（防同色漫灌或局部斜刷） / 实心书法圆印 / 菱形斜切
await applyAlphaMaskToImage({ imagePath: "./p1.jpg", refMaskPath: "./refs/p1_ref.png", refCrop: [120, 160, 280, 320], width: 400, height: 460, outPath: "./work/p1_refmask.png" }); // refCrop 用 1280x720 坐标
await applyAlphaMaskToImage({ imagePath: "./p2.jpg", strokes: [{ from: [0.22, 0.08], to: [0.46, 0.72], width: 0.44 }, { from: [0.54, 0.26], to: [0.78, 0.92], width: 0.44 }], width: 400, height: 600, outPath: "./work/p2_twin_brush.png" });
await createBrushPng({ preset: "ink-circle-solid", color: "#C82829", width: 360, height: 360, outPath: "./work/stamp_solid.png" }); // 实心衬底印用 ink-circle-solid；空心环才用 ink-circle-ring；斜扫带用 ink-band
s.images.add({ path: "./p3.jpg", geometry: "diamond", position: { left: 120, top: 180, width: 240, height: 240 }, fit: "cover", line: { fill: "#E85D04", width: 3 } });

// 3) 小节点单框合一 / 倾斜贴纸气泡（rotation） / 虚线连接锚点 / 原生表图
s.shapes.add({ name: "倾斜气泡", geometry: "roundRect", borderRadius: 8, rotation: -15, position: { left: 260, top: 420, width: 240, height: 72 }, fill: "#FFFBEB", line: { fill: "#F59E0B", width: 2 }, text: "100天计划过半啦！", textStyle: { fontSize: 14, bold: true, color: "#B45309", alignment: "center", verticalAlignment: "middle" } });
s.shapes.add({ name: "路径虚线", geometry: "connector", kind: "straight", startPoint: { x: 260, y: 300 }, endPoint: { x: 640, y: 300 }, line: { color: "#E85D04", width: 2, style: "dashed" }, tail: { type: "triangle", width: "med", length: "med" } });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await deck.save("./work/candidate.pptx"); // 构建脚本先落盘候选包，再调用 deck_cli.mjs verify 单次完成门禁校验与渲染验收（若无需渲染可直接 finalizeDeck）
```
