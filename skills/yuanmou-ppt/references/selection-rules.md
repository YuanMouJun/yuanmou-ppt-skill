# 渊眸 Selection Engine 2.0 · 索引词表与双向选版规则

> 本规则用于驱动 `scripts/provider_cli.mjs` 的精准双向选版（**待排内容体检指纹 ⇄ 索引库正交版式指纹**），确保跨营销、活动方案、科研汇报、品牌发布会、职场述职、BP 路演、B2B 售前、内训课件与政务/高校 9 大场景均能毫秒命中高审美骨架，并经由 `deck_blueprint.json` 无损衔接通道 B 复刻。

---

## 1. 选版前必做：待排内容轻体检（不追原稿字数，只定策略与原型）

在调用 `batch-search` 前，先确定整套与单页 4 项指纹：

1. **交付形态与色调解耦**
   - `deliveryMode`：`presenting`（演讲大屏，字少锚点强）vs `reading`（发微信/PDF 自读，结论前置、信息自包含）。
   - **封面与正文色调必须解耦**：`deck.coverTone` 可为 `dark` / `photo`，`deck.bodyTone` 默认 `light`（除非整套为暗黑发布会 Keynote，才设为 `dark`）。
2. **文案策略（`copyPolicy`）× 承载深度（`capacityTier`）** —— **不要死数原稿字数！**
   - `copyPolicy: "distill"`（**默认常态**：提案、品牌、发布会、BP、述职）：**版式优先 → 文案随所选版式精炼重写**。优先选 `compact` / `headline` 高审美版式，绝不被啰嗦草稿拖进丑文字墙。
   - `copyPolicy: "preserve"`（**保真少删**：活动执行手册、游戏规则+台词+道具、标书参数、科研消融表、旧 PPT 原文焕新）：**硬信息优先 → 选 `rich` / `tabular`**（引擎自动重罚 `headline` 空壳海报）。若单页含 `>=2` 套独立硬结构，主动建议**拆成两页**（如玩法流程页 + 道具分工表），不硬塞。
3. **跨行业借骨架（`crossDomain`）**
   - 科研汇报、学术答辩、硬件发布会、职场述职、B2B 售前、政务/高校、线下活动执行等**非社媒种草场景**，设置 `crossDomain: true`：
   - 引擎会优先拉取全库 `transferability = universal`（纯结构无平台截图的 4A 顶级骨架，即便出自营销通案也能无损复用），并自动隔离 `scene_specific`（手机框/社媒笔记截图墙/达人报价墙），**切忌一刀切用行业词屏蔽整个类别**。
4. **双档变速工作流**
   - **一键直出 / 极速交付（默认 `--auto-pick`）**：后台 `<0.3s` 自动全套选版 + 相邻防撞版 + 输出 `deck_blueprint.json`，AI 静默核验预览图后直接进通道 B 生成高定 `.pptx`，零打扰但全程享顶级骨架加持。
   - **深度定制 / 交互选版**：`<=10` 页一步出 `<20KB` 极速轻量看板（同级硬链接 `*_assets/`，发微信给外人时加 `--portable`）；`>12` 页长全案建议先挑 **3 页定调**（封面 + 1 页核心正文 + 1 页核心图示）再批配剩余页。

---

## 2. 16 大去行业结构原型词表（`archetype`）

> 检索时只传以下标准英文枚举（引擎亦内置常见中文别名归一化，且采用亲缘软加分，**永不硬过滤归零**）：

| `archetype` | 几何结构特征 | 典型跨行业应用场景 |
|---|---|---|
| `message_house` | 顶部屋顶总主张 + N 根支柱 + 底部横向支撑基座 | 品牌 Message House / 战略屋 / 顶层设计 / 科研总-分-底座框架 |
| `layered_architecture` | 横向多层堆栈 + 两侧纵贯护栏 | B2B 技术架构 / 端边云中台 / 科研平台架构 / 治理体系 |
| `swimlane_gantt` | 横轴时间波段 × 纵轴多泳道甘特 | 营销传播 Timeline / 波段节奏 / 多部门筹备甘特图 |
| `event_rundown` | 纵向时刻点 + 环节 + 执行动作/负责 | 线下活动 Rundown / 发布会议程脚本 / 单日排期表 |
| `milestone_roadmap` | 节点演进时间轴（无多泳道） | 品牌发展史 / Q1–Q4 规划 / 3–5 年路线图 / 研究脉络 |
| `process_pipeline` | 线性步骤流 / 闭环飞轮 / 玩法机制 | 增长飞轮 / 方法论链路 / 科研 Method Pipeline / 活动游戏流程 |
| `funnel_flow` | 漏斗 / 倒梯形阶段过滤转化 | 转化漏斗 / 人群反漏斗 / 招聘筛选 / 实验样本过滤 |
| `pyramid_layers` | 金字塔 / 同心圆 / 嵌套面积拆解 | 品牌金字塔 / 人群分层 / BP 市场规模（TAM/SAM/SOM） |
| `matrix_grid` | 四象限 / 2×2 矩阵 / Bento 多模块全景 | 竞品定位四象限 / 优先级矩阵 / 老板一页纸（One-Pager） |
| `comparison_table` | 多对象 × 多维对比表 / 正反对照 | 竞品对比 / 硬件参数表 / 科研消融表 / ✅❌ 避坑对照 / 预算分工表 |
| `dual_chart_insight` | 双图表或左图右论断 | 市场趋势洞察 / 经营复盘 / 科研双实验结果对照 |
| `kpi_scorecard` | 大数字计分卡 / 目标 vs 实际达成 | 职场述职 / 季度 OKR 复盘 / 结案战报 / 财务核心指标 |
| `ecosystem_flow` | 多节点箭头协同 / 中心辐射 / 韦恩交集 | BP 商业模式资金流 / 平台生态协同 / 关系映射 |
| `evidence_showcase` | 案例实证 / 截图墙 / 作品集 / 团队墙 / 地图 | 社媒爆文实证 / 作品集 / 创始团队履历 / Logo 资质墙 / 场地分区 |
| `hero_statement` | 极简大字宣言 / 单一超大数字 / 居中剖面主视觉 | 发布会金句 / 核心突破数字 / 硬件产品剖面标注（Cutaway） |
| `editorial_freeform` | 自由创意图文 / 左右分栏 / 规整多栏卡片 | 通用商业观点页 / 前后对比 / 杂志感故事叙述 |

---

## 3. 兼容经典库枚举与槽位计数口径

- **`business_purpose` 合法标准值**（多词逗号拼接，严禁自造词）：`执行策略`、`方法论`、`洞察分析`、`案例展示`、`结案复盘`、`作品展示`、`资源介绍`、`公司介绍`、`结构图示`、`内容示例`。
- **`diagram_family` 合法标准值**（现已改为软加分，不会硬归零）：`flow`、`hierarchy`、`timeline`、`relationship`、`cycle`、`branch`、`radial`、`funnel`、`nested`、`venn`、`matrix`、`comparison`。
- **槽位计数口径**：
  - `targetImages`：仅计**内容区可替换有效图片/完整界面截图**（纯装饰、底图、Logo、二维码、小图标不计；单张主页/笔记/后台截图内部九宫格仍算 `1` 张）。纯逻辑结构页传 `0`。
  - `targetTextSlots`：核心可替换信息卡片/要点模块数（极简 `1~3`，常规 `4~6`，高密 `7+`）。
  - `targetResults`：仅计**真实项目实绩/结案战果指标槽**；行业趋势、预算目标或 Demo 示意数字填 `0`。

---

## 4. `pages.json` 标准调用示例与双档命令

```json
{
  "deck": {
    "title": "年度技术与业务汇报",
    "deliveryMode": "reading",
    "coverTone": "dark",
    "bodyTone": "light",
    "chromePolicy": "auto",
    "copyPolicy": "distill"
  },
  "pages": [
    {
      "pageId": "p1", "pageBadge": "P1", "pageTitle": "核心战略屋（Message House）",
      "archetype": "message_house", "capacityTier": "compact", "crossDomain": true,
      "targetImages": 0, "targetTextSlots": 4, "targetResults": 0
    },
    {
      "pageId": "p2", "pageBadge": "P2", "pageTitle": "执行时刻表与人员分工",
      "archetype": "event_rundown", "capacityTier": "tabular", "copyPolicy": "preserve",
      "crossDomain": true, "hasTable": true, "targetImages": 0, "targetResults": 0
    },
    {
      "pageId": "p3", "pageBadge": "P3", "pageTitle": "核心硬件突破巨幕页",
      "archetype": "hero_statement", "capacityTier": "headline", "tone": "dark", "crossDomain": true
    }
  ]
}
```

```bash
# 极速静默档（一键直出推荐）：<0.3s 选版 + 防撞版 + 产出 deck_blueprint.json
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --auto-pick --blueprint ./work/deck_blueprint.json

# 交互看板档（深度定制推荐）：生成 ~15KB 极速看板（同级硬链接 *_assets/；发外人加 --portable）
node <SKILL_DIR>/scripts/provider_cli.mjs batch-search --plan ./pages.json --out ./work/selection_board.html --limit 3
```

---

## 5. 整套模板文件名直查（`search-decks` → `deck-outline`）

当用户明确要求**“直接找一套成熟整套模板复用排版与逻辑”**（而不是跨套单页拼装）时，**必须先按文件名整套直查**，绝不把全库数万页拉进内存盲扫：

1. **第一步：`search-decks`（SQLite 原生分组聚合，`<10ms`）**
   - `--keywords`：空格分隔为 **AND** 逻辑，逗号 `/` `|` 分隔为 **OR** 逻辑（如 `"电视,手机,硬件 发布会"`）；
   - `--exclude-keywords`：排除干扰文件名（如 `"结案,种草,代理,招商"`）；
   - `--tone dark|light|any`、`--min-pages 8`、`--min-aesthetic 3.5`：按深浅色页数、整套平均审美与页数排序。
2. **第二步：`deck-outline`（查单套逐页目录，按需只拉选定页预览图）**
   - `--deck <deckId|文件名片段>`：按 `deckId`（`full_sha256` 前缀）或文件名子串锁定唯一整套，按 `physical_page` 升序返回每页标题、页型、原型与布局摘要；
   - `--pages "1,2,10-15"`：仅拉取关键样页，配合 `--fetch-previews` / `--out ./work/deck_preview.html` 看图确认；加 `--body-only` 可仅看正文页。
3. **诚实兜底与脱敏兼容**
   - 若返回 `count: 0`（或确认命中文件均为活动营销方案而非目标品类的整套模板），**立即如实告知用户库内暂无该品类完整模板**，询问改用单页混搭还是暂停，严禁硬塞错类模板；
   - 公开脱敏体验库不含原文件名字段，调用 `search-decks` / `deck-outline` 会优雅返回 `supported: false`，此时改走第 4 节单页同构 `batch-search`。

```bash
# 1) <10ms 按文件名检索候选整套（不拉全库单页）
node <SKILL_DIR>/scripts/provider_cli.mjs search-decks --keywords "发布会" --exclude-keywords "结案,种草" --min-pages 8 --limit 15

# 2) 查看指定整套目录，仅对关键页按需拉图生成预览看板
node <SKILL_DIR>/scripts/provider_cli.mjs deck-outline --deck <deckId或文件名片段> --pages "1,2,10-14" --fetch-previews --out ./work/deck_preview.html
```

---

## 6. 母版外框三层拆解铁律与 `deck_blueprint.json` 衔接

复刻前必须读取 `deck_blueprint.json` 中的 `chromeAction` 与 `copyPolicy`，严格区分 3 层元素防误抹：

| 层级 | 元素范围 | 处理铁律 |
|---|---|---|
| **L1 · 必删污染层** | 原公司 Logo、品牌水印、原项目名页眉、原页码、保密角标 | **任何模式 100% 彻底清除** |
| **L2 · 可替换母版壳层** | 四周固定红/蓝粗外框、跨套打架的异质角饰或顶底色带 | **单页/同套 (`keep_l2_strip_l1`)** 1:1 保留；**多页跨套 (`strip_l2_unify_master`)** 脱除异质粗框，套用全套统一标题坐标与底栏；精致轻细线优先保留 |
| **L3 · 结构承重层** | 标题引导线、栏间竖分割线、屋顶支柱、时间轴主干、卡片强调色条、图表轴线 | **严禁删除！** 100% 保留几何骨架，仅按全套色板统一换色 |

> 当任意页面返回 `fallbackRecommended: true`（或纯离线无索引库）时，直接查阅 `references/offline-layout-patterns.md` 对应语法卡用 `@yuanmou/pptx-kit` 原生弹性绘制，绝不强套低分商业广告图。
