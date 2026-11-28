---
name: yuanmou-ppt
version: 0.6.3
description: 一句话从零策划生成整套商业 PPT / 图片转可编辑 PPT / 截图转 PPT / PDF 转可编辑 PPT / 既有 .pptx 母本无损改版全能技能（All-in-One AI PPT Generator & Image/Screenshot/PDF to Editable PPTX Skill，基于零依赖原生 OOXML 引擎 @yuanmou/pptx-kit）。支持一句话主题咨询级大纲与文案策划、1.6W+ 免登录商业版式库同构选版、两阶段硬解耦 1:1 复刻与矢量 PDF 直出母版、内嵌 .xlsx 可双击改数真图表及 6 大门禁组全链路自动代码校验与多页左右对照验收。
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
| **既有 `.pptx` 母本原位改版（或局部保留原页 + 其余页重排）** | 全套原位改版走 **通道 A**（`inspectTemplateDeck → prepareStarterDeck → 原位换字换图`）；**局部保留原页（如保留原封面/封底，重排中间页）必须用 `assembleDeck()` 无损拼装原稿页与 Phase 1 母版页**，严禁新建空白稿凭记忆重画原页 |
| **复用整套成熟模板**（如“找一套成熟发布会/BP 模板直接套用”） | 先跑 **`search-decks`** 按文件名毫秒直查整套目录 → **`deck-outline`** 看单套页序并按需拉图确认；若库内确无匹配整套模板，**先如实告知并征询是否改用单页混搭或停止**，严禁盲扫全库单页或偷换品类硬塞 |
| **已指定参考图 / 截图 / PDF 1:1 复刻**（或仅调色/局部修形） | 跳过选版海选，严格走 **通道 B · 两阶段硬解耦流水线（Phase 1 纯骨架母版 + 左右对照验收 → Phase 2 原位填槽）** |
| **一句话主题 / 纯文稿生成整套 `.pptx`**（若同时要 `.md` 则先落盘 `.md`） | 走 **第 2 节（咨询策划 + Selection Engine 2.0 双档选版 → `deck_blueprint.json`）→ 通道 B**：用户要一键直出时后台跑 **`--auto-pick`** 静默锁高定骨架直出，不打扰用户；纯离线无本地库时按 `references/offline-layout-patterns.md` 高定语法卡直进通道 B |

## 1. 核心铁律（不翻源码、不绕路）

1. **纯原生 OOXML（禁止简化或贴图）**：所有 `.pptx` 构建、改版、表图与终检调用 `<SKILL_DIR>/scripts/kit.mjs`；严禁 `python-pptx`，严禁简化省略结构，严禁用整页贴图冒充表格/流程图/可编辑重绘。图表必须内嵌 `.xlsx` 可双击改数。
2. **小节点单框合一 vs 大装饰外框内独立定位**：按钮、标签、流程图节点或单段卡片必须在同一 `<p:sp>` 上直设 `fill / line / text / textStyle`（富文本 `runs` 支持 `{ text, bold, fontSize, color }` 平层写法），严禁在单个小卡片上另盖透明文本框；**但对于跨区域的 `fill: "none"` 大尺寸装饰外框或多分区复合底板，内部不同方位的元素（如左上角标、居中超大标题、右下注解）应按真实坐标独立放置**，严禁强塞进同一文本框靠空行硬顶导致上半截空洞。表格文字直写单元格；列表用 `makeBulletList()`，禁手敲 `"• "`；**严禁用 `☀ / ▶ / 《` 等 Emoji/标点冒充图标，严禁用 `[ 姓名 ] | [ 手机 ]` 冒充表单 UI**；禁 4+ 连续空格定位；窄标签留足 5% 余量（菱形安全区仅 `0.50×宽 × 0.50×高`）。
3. **只读保护、重做隔离与历史版本自动回溯**：要求原稿不动时严禁改写原件（可用 `verify --readonly-source` 锁哈希）；**用户要求从头重做或换风格时，严禁跨旧工作目录偷拿废弃配图**。构建脚本与候选包（`./work/candidate.pptx`、`./work/masters.pptx`）一律留在 `work/` 或 `scratch/`，不污染用户项目目录；唯一一次终检与落盘交给 `deck_cli.mjs verify --final ./output/final.pptx --pdf ./output/compare.pdf`——**多轮精修重新交付时，`verify` 会自动把上一版已交付 `.pptx` 与对比 `.pdf` 归档至 `<输出目录>/history/`（版本号递进，绝不静默覆盖）**，确保用户随时可回溯。
4. **强制视觉自检 + 无依赖离线降级（代码全绿 ≠ 视觉达标）**：所有 `.pptx` 必跑 `deck_cli.mjs verify`。本机具备 **LibreOffice (`soffice`) + Poppler (`pdftoppm` 或 `pypdfium2`)** 时强制真机渲染并审图返工；**若缺渲染依赖，严禁上网下载安装包/字体或自绘近似假图冒充真机渲染**——`verify` 自动完成 **6 大门禁组 · 全链路自动代码校验**并原子落盘 `--final`（返回 `verificationMode: "code-gates-only"`, `visualVerified: false`），桌面端提示用户安装复验，受限沙箱则在交付说明首行如实标注未做真机渲染。

## 2. 从零策划与 Selection Engine 2.0 双向选版（按需详查 `references/selection-rules.md`）

**严禁不读内容乱搜、严禁手搓裸 SQL 绕过同构打分**；纯离线且无本地索引库时，直接按 `references/offline-layout-patterns.md` 高定语法卡进通道 B：

1. **内容轻体检与策略定调（不追原稿字数，先定文案策略与原型）**：无现成文稿时按 MECE / 结论前置策划逐页大纲与去 AI 腔文案（严禁编造战绩）。整套先锁定 `deliveryMode`（演讲/阅读）、**解耦 `coverTone` 与 `bodyTone`**（封面可暗黑、正文默认浅底）及 `copyPolicy`（`distill` 版式优先随版精炼 vs `preserve` 执行手册/消融表硬信息保真，超载主动建议拆页）；逐页标注标准 `archetype`（16 大跨行结构原型，见 `references/selection-rules.md`）、`capacityTier`（`headline/compact/rich/tabular`）与非社媒场景 `crossDomain: true`（跨行借用 `universal` 万能骨架并隔离 `scene_specific` 截图墙）。
2. **双档极速选版与 `deck_blueprint.json` 衔接（`<0.3s` 内存快照 + 相邻防撞版 + L1/L2/L3 母版脱壳）**：
   - **一键直出（极速静默档 `--auto-pick`）**：后台毫秒选定全套 Top-1 高审美骨架并产出 `deck_blueprint.json`，AI 静默核图后直进通道 B（零选版打扰、全程享顶级模板库加持）；
   - **深度定制（交互看板档）**：`<=10` 页一步直出 ~15KB 极速轻量看板（同级硬链接 `*_assets/`，发微信给外人加 `--portable`）；`>12` 页长全案建议先挑 3 页定调再批配剩余页；交互模式下未获确认前不提前重绘。选版返回 `fallbackRecommended: true` 时改用 `references/offline-layout-patterns.md` 原生绘制。

```bash
# 整套模板文件名直查（<10ms 查本地完整库，不拉全库单页）：先按文件名锁整套，再查目录按页拉图
node <SKILL_DIR>/scripts/provider_cli.mjs search-decks --keywords "发布会" --exclude-keywords "结案,种草" --limit 15
node <SKILL_DIR>/scripts/provider_cli.mjs deck-outline --deck <deckId或文件名片段> --pages "1,2,5-8" --fetch-previews --out ./work/deck_preview.html

# 极速静默档（一键直出推荐）：<0.3s 全套自动选版 + 防撞版 + 输出 deck_blueprint.json
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --auto-pick --blueprint ./work/deck_blueprint.json

# 交互看板档（深度定制推荐）：默认生成 ~15KB 同级硬链接轻量看板（外发加 --portable）
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --out ./work/selection_board.html --limit 3

# 单页精准检索（支持 --archetype / --capacity / --copy-policy / --tone / --cross-domain）
node <SKILL_DIR>/scripts/provider_cli.mjs search-slides --archetype message_house --capacity compact --cross-domain --limit 4
```

## 3. 统一双制作通道与两阶段硬解耦流水线

### 通道 A：既有 `.pptx` 原位无损改版 & 跨包无损合页
- **全套原位改版**：`inspectTemplateDeck` 提取锚点 → `validateTemplatePlan` → `prepareStarterDeck` 无损抽页 → `.text.set()` / `.text.replace()` 保样式换字 + `.replace({ path, fit: "cover" })` 保蒙版换图 + `.recolor()` → `auditTemplateFidelity`。
- **局部保留原页 + 其余页重排（混合改版）**：用 **`assembleDeck({ base, sources, slides })`**（或 `deck_cli.mjs assemble`）把原稿中“无需改动”的页面（如封面/封底）原 XML 无损保留，其余页面直接克隆自 Phase 1 已验收的 `masters.pptx` 拼装成同一份可编辑 `.pptx`，再进入 Phase 2 原位填槽。

### 通道 B：参考图 / 截图 / PDF 1:1 复刻（**两阶段硬解耦，严禁合并为一步直出！**）

凡基于参考图、截图或 PDF 复刻版式，**必须物理拆分为两个独立阶段执行，严禁一边猜坐标一边往里硬塞业务正文**：

1. **Phase 1 · 纯版式复刻与母版验收（0 业务内容介入）**
   - **矢量/混合 PDF 一键直出骨架（优先调用 `pdf-to-master`）**：当参考源为 `.pdf` 时，优先跑 **`deck_cli.mjs pdf-to-master --pdf ./template.pdf --pages "1-8,13" --out ./work/phase1`**——若为矢量/混合 PDF，引擎自动直读 PyMuPDF 对象树（含真实 Z 序、小容器单框融合、非矩形贝塞尔裁切 `clips` 与所有图片 `bbox`）直接编译出 `masters.pptx`、`pdf_master_spec.json` 与 `master_refs/`；**若探测为纯光栅位图 PDF（返回 `mode: "fallback_to_bitmap"`），不生成假空壳，仅导出 `master_refs/` 直接退回位图复刻路线**（先跑 `inspect-ref` 采色与实测倾角，再逐页精绘纯骨架母版）。**旋转正负号铁律：`rotation > 0` 为顺时针右倾（`\`），`rotation < 0` 为逆时针左倾（`/`）；旋转框内子组件一律用 `placeInRotatedFrame(parentBox, localChild)` 精算坐标**。
   - **语义层命名契约（`slot:*` vs `decor:*`）**：每个可替换图文槽位必须命名 `slot:*`（如 `slot:hero_img`、`slot:title`；缺真实配图时保留干净中性占位 `<p:pic>`，严禁改画色块或文字卡）；背景暗纹水印、划掉线、光环等装饰层命名 `decor:*`（与 `finalizer.mjs` 统一场景模型对齐，禁止靠猜名字豁免）。页脚/顶栏必须在前景图片**之后**绘制，防 Z-order 遮挡；非零原点 SVG 矢量直接传 `svgPath` + `viewBox: [minX, minY, w, h]`。
   - **母版硬关卡（`verify-master`）**：运行 `deck_cli.mjs verify-master --pptx ./work/masters.pptx --ref-dir ./work/master_refs --out ./work/qa_master`，硬校验 ① 每页具备 `slot:*` 槽位（`slotContractPassed`）、② 摄影区与矢量 PDF 图片槽数未缺失（`photoSlotAuditPassed`）、③ 倾斜角偏差 `<5°`（`angleAuditPassed`），默认仅输出高清**左右二联对比图（`compare_batch_*.jpg` + `master_compare.pdf`）**并签发含 `masterSha256` 的 **`master_verified.json`**；逐批审阅 `compare_batch_*.jpg`，未 1:1 咬合前严禁进入 Phase 2（仅单页精调复杂曲线时才按需加 `--xray`）！

2. **Phase 2 · 严格基于锁死母版的原位内容填充**
   - 用 **`assembleDeck()`** 从已验收的 `./work/masters.pptx`（以及需保留原页的源 `.pptx`）无损克隆拼装出全套页序，仅通过 **`slide.getSlot("slot:...")` → `.text.set()` / `.replace({ path, fit: "cover" })` / `slide.recolor(colorMap)`** 原位填字、换图、换色。
   - **选版即默认精简上屏文案、严禁破坏母版结构**：只要用户已选定参考模板或版式，**默认版式优先，主动精简上屏文案以贴合母版槽位的设计字数与留白节奏**（严禁为硬塞长文而砍掉照片槽改文字框、拉高/拉满文字区、擅改列数或倾斜角；缺对应图片时保留母版占位图即可，严禁乱画）。
   - 终检时传 **`--master ./work/masters.pptx --master-map ...`**，引擎**默认强制校验** `master_verified.json` 的 `passed: true` 与 `masterSha256` 一致性（缺失或过期立即拦截），并通过 `auditMasterSlotIntegrity` 锁死图片槽数、命名槽位几何比例与旋转角度。
   - **无参考图纯从零生成**（如纯离线按 `references/offline-layout-patterns.md` 绘制）或特殊授权改版（仅调色/横竖重排）仍须按模块化单页推进并严格遵守 4 类页型与 Z-order 铁律。

## 4. 文案保真与去 AI 腔铁律（Anti-Slop）

- 严禁编造数据、严禁把目标/示意数字写成已实现成果，保留原稿指标名、数值与周期；缺数据仅写已有产出，**待补数据放交付说明，严禁把 `[待补充]` / `TBD` 写进页内**。
- 封杀 AI 水词（`不是X而是Y`、`深度赋能`、`核心抓手`、`生态闭环`、`打出组合拳`、`底层逻辑重构`、`开启新篇章`）、单段滥用 `——`、行内假圆点 `A • B • C`。
- 内容页主标题结论前置；**正文与表格 `>=12pt`**（`<9pt` 门禁 `fail`，`9–11.9pt` 触发 `warn`），挤不下先精简废话，不强缩字号。

## 5. 环境探活、版本提醒与一条龙终检验收

开工前可先跑 `node "<SKILL_DIR>/scripts/deck_cli.mjs" check-env` 探活渲染环境与版本状态（内置 24h 缓存与 1.5s 超时静默兜底，断网不报错；若返回 `update.available === true`，**不中断当前任务**，仅在最终交付末尾顺带提醒一句发现新版本 `vX.Y.Z` 及更新亮点，用户确认后再跑 `deck_cli.mjs update`）。

`verify` 1 条命令跑完 **6 大门禁组 · 全链路自动代码校验**（ECMA-376 包结构、越界、碰撞、**Z-order 前景图/色块遮挡文字与页脚**、框中套框、菱形/窄图形内切宽、WCAG 对比度、整页贴图冒充、实心块遮死底图、长空格与假圆点、全量 Unicode 脏 Emoji/假表单方括号、正文与表格最小字号、孤字折行预警、Anti-Slop、页内占位符、字体核查、表图 `.xlsx`/算术同步 + `--master` 阶段一 SHA-256 签收与槽位几何不变性审计）并原子落盘 `--final`（自动把上一版归档至 `history/`）；有渲染依赖时默认只出高清**左右二联图（`compare_batch_*.jpg`）+ 多页左右对照 PDF（`qa_compare.pdf`）**，省 Token 不再默认生成三联叠图（仅显式加 `--xray` 时输出）：

```bash
# Phase 1（矢量/混合 PDF 首选）：一键提取矢量对象树 + 真实 Z 序 + 小容器单框融合 + 贝塞尔裁剪蒙版 → 纯骨架母版 & 左右对照验收
node <SKILL_DIR>/scripts/deck_cli.mjs pdf-to-master --pdf ./template.pdf --pages "1-8,13" --out ./work/phase1
node <SKILL_DIR>/scripts/deck_cli.mjs verify-master --pptx ./work/phase1/masters.pptx --ref-dir ./work/phase1/master_refs \
  --out ./work/phase1/qa_master --pdf ./work/phase1/master_compare.pdf

# Phase 1（位图/截图或单页精查）：坐标标尺网格 + 主倾斜角实测
node <SKILL_DIR>/scripts/deck_cli.mjs inspect-ref --ref ./ref_page.png --out ./work/ref_m1

# Phase 2：基于已签发 master_verified.json 的锁死母版原位填槽后终检落盘（默认强制校验 SHA-256 签收 + 自动归档旧版至 history/）
node <SKILL_DIR>/scripts/deck_cli.mjs verify --pptx ./work/candidate.pptx --final ./output/final.pptx \
  --master ./work/phase1/masters.pptx --master-map "2:1,3:2,4:3" \
  --out ./work/qa --ref-dir ./refs --pdf ./output/qa_compare.pdf --anti-slop fail
```

1. **分批高清精审与角度复核（严禁拿全页像素分当合格借口）**：当 `visualVerified: true` 时，**严禁只看邮票总览图，也严禁同一轮并发 `read_file` 塞入超过 2 张 `compare_batch_*.jpg`（每轮最多精审 8 页）**。结合 `diff.angleMismatches` 与 `compare_batch_*.jpg` 逐页核对：① 旋转倾斜角方向与度数是否 1:1 吻合、子组件无漂移 ② 页脚/顶栏/文字无被前景图或手机壳压死 ③ 背景水印大字、照片槽位、实心印章与空心圆环是否完整保留（严禁砍图改框或固定装饰 PNG 划花人脸） ④ 无镜像反字 AI 坏图、无高频重复贴图与单字孤行；失真项集中修改后重新跑 `verify`（上一版会自动备份到 `history/`）。
2. **离线降级如实声明**：若返回 `verificationMode: "code-gates-only"`（`visualVerified: false`），直接交付已过 6 大门禁组全链路静态校验的 `.pptx`，桌面端附 `installHint` 建议安装复验，受限沙箱在交付说明首行如实标注未执行真机渲染，并核对 `warnings` 不谎称 12pt 全部合规。

## 6. `@yuanmou/pptx-kit` 零翻源码 API 速查（坐标 `px` 1280×720 · `fontSize` 数值默认 `pt`）

> 单位约定：`position / left / top / width / height / borderRadius / insets` 均用 `px`（同时支持 `position: {...}` 与平层 `left/top/width/height`）；**`fontSize / spaceBefore / spaceAfter` 数值默认 `pt`**（`14` 即 `14pt`，显式 `"24px"` 折算 `18pt`）。脚本一律从工作区根目录运行或用 `path.resolve`；跨平台导入请用 `pathToFileURL`：

```js
import path from "node:path";
import { pathToFileURL } from "node:url";
const {
  Presentation, assembleDeck, auditMasterSlotIntegrity, finalizeDeck,
  makeBulletList, fr, fixed, placeInRotatedFrame,
  buildRoundedTrapezoidPath, buildPolylineStrokeCommands,
  createBrushPng, applyAlphaMaskToImage,
} = await import(pathToFileURL(path.resolve("<SKILL_DIR>/scripts/kit.mjs")).href);

const deck = Presentation.create({ title: "方案标题", defaultFont: "Microsoft YaHei" }); // macOS 也可设 "PingFang SC"
const s = deck.slides.add({ background: "#FFFFFF" }); // 或 { type: "linear", angle: 135, stops: [{ offset: 0, color: "#0B1120" }, { offset: 1, color: "#1E3A8A" }] }

// 1) 全出血底图 + 半透明暗罩 + 透明大装饰外框（框内引子与巨幅主标题按真实坐标独立放置！）
s.images.add({ path: "./hero.jpg", position: { left: 0, top: 0, width: 1280, height: 720 }, fit: "cover" });
s.shapes.add({ name: "暗角遮罩", geometry: "rect", position: { left: 0, top: 0, width: 1280, height: 720 }, fill: { color: "#0B1120", opacity: 0.48 }, line: { fill: "none" } });
s.shapes.add({ name: "透底白线框", geometry: "rect", position: { left: 64, top: 140, width: 1152, height: 440 }, fill: "none", line: { fill: "#FFFFFF", width: 10 } });
s.shapes.add({ name: "左上引子", geometry: "textbox", position: { left: 120, top: 190, width: 420, height: 36 }, text: "2026 STRATEGIC KEYNOTE", textStyle: { fontSize: 16, color: "#E2E8F0" } });
s.shapes.add({ name: "居中主标题", geometry: "textbox", position: { left: 120, top: 250, width: 1040, height: 260 }, text: "你是否\n时常有这种感觉？", textStyle: { fontSize: 72, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" } });

// 2) 参考图 1:1 泛洪轮廓蒙版（首选） / 多笔触组合飞白（防同色漫灌或局部斜刷） / 实心书法圆印 / 菱形斜切
await applyAlphaMaskToImage({ imagePath: "./p1.jpg", refMaskPath: "./refs/p1_ref.png", refCrop: [120, 160, 280, 320], width: 400, height: 460, outPath: "./work/p1_refmask.png" }); // refCrop 用 1280x720 坐标
await applyAlphaMaskToImage({ imagePath: "./p2.jpg", strokes: [{ from: [0.22, 0.08], to: [0.46, 0.72], width: 0.44 }, { from: [0.54, 0.26], to: [0.78, 0.92], width: 0.44 }], width: 400, height: 600, outPath: "./work/p2_twin_brush.png" });
await createBrushPng({ preset: "ink-circle-solid", color: "#C82829", width: 360, height: 360, outPath: "./work/stamp_solid.png" }); // 实心衬底印用 ink-circle-solid；空心环才用 ink-circle-ring；斜扫带用 ink-band
s.images.add({ path: "./p3.jpg", geometry: "diamond", position: { left: 120, top: 180, width: 240, height: 240 }, fit: "cover", line: { fill: "#E85D04", width: 3 } });

// 3) 旋转父框内子组件精算（+deg=顺时针右倾 \，-deg=逆时针左倾 /） & 跨 PPTX 无损合页 + Phase-2 原位填槽
const phoneBox = { left: 112, top: 214, width: 332, height: 516, rotation: 12 }; // +12° 顺时针右倾
s.images.add({ name: "slot:phone_img", path: "./p1.jpg", geometry: "roundRect", borderRadius: 34, ...phoneBox, fit: "cover", line: { fill: "#FFFFFF", width: 10 } });
s.shapes.add({ name: "手机听筒", geometry: "roundRect", borderRadius: 8, ...placeInRotatedFrame(phoneBox, { left: 110, top: 14, width: 112, height: 14 }), fill: "#FFFFFF", line: { fill: "none" } });

// Phase 2：原稿 P01/P20 无损留原 XML + 中间页克隆已验收 masters.pptx -> 仅原位换字/换图/换色
const deck2 = await assembleDeck({ base: "./orig.pptx", sources: { orig: "./orig.pptx", masters: "./work/masters.pptx" }, slides: [{ from: "orig", slide: 1 }, { from: "masters", slide: 1 }, { from: "orig", slide: 20 }] });
const s2 = deck2.slides.getItem(1);
s2.recolor({ "#E63946": "#0F3A7D" });
s2.getSlot("slot:phone_img").replace({ path: "./new_photo.jpg", fit: "cover" });

// 4) 原生连接线 / 表格 / 内嵌 .xlsx 真图表
s.shapes.add({ name: "路径虚线", geometry: "connector", kind: "straight", startPoint: { x: 260, y: 300 }, endPoint: { x: 640, y: 300 }, line: { color: "#E85D04", width: 2, style: "dashed" }, tail: { type: "triangle", width: "med", length: "med" } });
s.tables.add({ position: { left: 520, top: 200, width: 696, height: 280 }, columnTracks: [fixed(120), fr(1), fr(1)], values: [["维度","现状","目标"], ["转化率","2.1%","3.8%"]], totalRow: false });
s.charts.add("bar", { position: { left: 64, top: 200, width: 560, height: 340 }, title: "季度对比", categories: ["Q1","Q2","Q3"], series: [{ name: "曝光", values: [120, 185, 240], fill: "#0F3A7D" }] });
await deck.save("./work/candidate.pptx"); // 构建脚本先落盘候选包，再调用 deck_cli.mjs verify 完成门禁校验、自动归档旧版与左右对照 PDF 验收
```
