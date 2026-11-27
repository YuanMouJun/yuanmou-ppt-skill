<div align="center">

# 渊眸 PPT · Yuanmou PPT

**拒绝网页截图套壳，直接交付 100% 可编辑的原生 `.pptx`。**

<sub>一句话从零策划整套商业方案 · 截图 / PDF 1:1 矢量复刻 · 既有 `.pptx` 母本无损改版 · 图表内嵌真实 `.xlsx` 双击弹 Excel</sub>

<p>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.5-161514?style=flat-square" alt="Node.js >= 22.5" /></a>
  <a href="#快速安装"><img src="https://img.shields.io/badge/npm%20dependencies-0-C85A32?style=flat-square" alt="Zero Dependencies" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-161514?style=flat-square" alt="Apache-2.0" /></a>
</p>

<p>
  <strong>中文</strong> ·
  <a href="./README.en.md">English</a> ·
  <a href="https://ppt.resourcehub.dpdns.org">官网预览</a> ·
  <a href="#案例画廊">案例画廊</a> ·
  <a href="#快速安装">快速安装</a> ·
  <a href="./test-prompts.json">开箱 Prompt 集</a> ·
  <a href="./SECURITY.md">安全与数据流</a>
</p>

<br />

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/hero-yuanmou-ppt.gif" width="94%" alt="渊眸 PPT：一句话生成原生可编辑 .pptx，并在 PowerPoint 中双击图表弹出真 Excel 实时改数" />
  <br />
  <sub>真实工作流实录：一句话生成 5 页「渊眸声学 AURA 01」发布会 PPT → PowerPoint 中双击柱状图弹出内嵌 <code>Microsoft_Excel_Worksheet.xlsx</code> 实时改数联动。<br />下载这套案例的真实源文件亲自验真：<a href="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/yuanmou-aura-01-flagship-sample.pptx"><strong>yuanmou-aura-01-flagship-sample.pptx</strong></a>（6 组 15 项门禁 0 报错 0 警告）</sub>
</p>

</div>

---

## 为什么做这个 Skill？

市面上的 AI PPT 工具看着很炫，但一旦进到真实职场交付，通常会卡在三个死结里：

1. **生图 / 网页截图套壳交不了差**：老板只说一句“把第三段数字改成 Q3、柱状图换一下配色”，整张死图只能推倒重做。
2. **HTML 转 `.pptx` 进 PowerPoint / WPS 就散架**：浏览器里精致的排版，导出后字体错位、表格溢出、图表退化成静态图片。
3. **改公司既有 `.pptx` 模板极其脆弱**：手工脚本动不动炸掉母版渐变和异形图片蒙版，删页后还留着几十 MB 冗余媒体垃圾。

`yuanmou-ppt-skill`（底层引擎 `@yuanmou/pptx-kit`）是一套**零第三方 npm 依赖的纯 Node.js 原生 OOXML 引擎**。它直接按 ECMA-376 标准写出真实形状、矢量路径、透明渐变、合并表格与嵌入式 `.xlsx` 工作簿，并内置 **6 大门禁组 · 15 项自动质检**与真机左右对照验收。

兼容主流 AI 客户端：**WorkBuddy / Trae / Qoder / CodeBuddy / OpenClaw（龙虾）/ Claude Code / OpenAI Codex / Cursor / Antigravity**。

---

## 快速安装

### 一行命令安装（推荐）

```bash
npx skills@latest add https://github.com/YuanMouJun/yuanmou-ppt-skill
```

<details>
<summary><strong>其他安装方式（腾讯 WorkBuddy 拖包导入 / 本地克隆多端同步 / 版本升级）</strong></summary>

<br />

**方式 A · 腾讯 WorkBuddy / 桌面端零命令行导入**
1. 前往 [Releases 最新版](https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/latest) 下载 `yuanmou-ppt-skill.zip`。
2. 打开 WorkBuddy → 左侧「专家 · 技能 · 连接器」→「上传技能」→ 拖入 `.zip` 即刻启用。

**方式 B · 克隆仓库本地安装（约 1.2 MB，0 第三方 npm 依赖）**
```bash
git clone https://github.com/YuanMouJun/yuanmou-ppt-skill.git
cd yuanmou-ppt-skill
node scripts/install.mjs --target all
# 或按需指定端：--target workbuddy,trae,qoder,codebuddy,openclaw,claude,codex,cursor,antigravity,agents
```

**方式 C · 环境自检与一键增量升级**
```bash
node skills/yuanmou-ppt/scripts/deck_cli.mjs check-env
npm run test:m3

# 后续升级（内置国内直连镜像 + SHA-256 逐文件校验，或直接对 Agent 说“更新 yuanmou-ppt 技能”）
node <SKILL_DIR>/scripts/deck_cli.mjs update
```

</details>

### 运行环境要求

- **必装：Node.js `>= 22.5`**（使用内置 `node:sqlite` 与 `node:zlib`，无需 `npm install` 即可构建 `.pptx` 并执行全套 15 项静态门禁）。
- **推荐：LibreOffice (`soffice`) + Poppler (`pdftoppm` 或 `pypdfium2`)**（开启本地高清真机渲染与多页左右对照验收 PDF；无渲染依赖的受限沙箱自动降级为 `code-gates-only` 静态门禁模式）：
  ```bash
  # macOS
  brew install --cask libreoffice && brew install poppler
  # Ubuntu / Debian
  sudo apt update && sudo apt install -y libreoffice poppler-utils
  # Windows
  winget install TheDocumentFoundation.LibreOffice
  ```

---

## 案例画廊

以下全部展示图均为**本引擎生成的真实 `.pptx` 经 LibreOffice 260 DPI 真机渲染直出**（无任何整页生图拼贴或网页截图）。

### 01 · 渊眸声学 AURA 01（暗场工业设计发布会 · 5 页全原生）

只给一句硬件发布会命题，输出从全出血暗场封面、机械剖面引线标注、双真 Excel 声学实测图表到材质微距画册与三段式架构页的完整 `.pptx`，通过 6 组 15 项门禁（`fail=0, warn=0`）。

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-aura-cover.jpg" width="100%" alt="渊眸声学 AURA 01 封面：声如建筑" />
  <br />
  <sub>P01 封面 · 全出血暗场主视觉 + 原生矢量声谱标尺与渐变暗角</sub>
</p>

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-aura-pages.jpg" width="100%" alt="渊眸声学 AURA 01 内页 2x2：硬件剖面标注、双真 Excel 图表与合并表、材质微距色卡、三段式架构页" />
  <br />
  <sub>P02 机械剖面与 6 组原生锚点引线 · P03 内嵌双 <code>.xlsx</code> 真图表 + 原生 <code>&lt;a:tbl&gt;</code> 表 · P04 材质微距与阻尼色卡 · P05 瑞士三段式架构页<br />直接下载该套成稿在 PowerPoint / WPS 中双击改数：<a href="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/yuanmou-aura-01-flagship-sample.pptx"><strong>yuanmou-aura-01-flagship-sample.pptx</strong></a></sub>
</p>

---

### 02 · 多行业高光商业版式画廊（1.6W+ 免登录库 / 10W+ 飞书库精选）

不止暗场科技，内置 **1.6W+ 免登录商业版式库**（与可选 **10W+ 飞书云盘日更库**）横跨轻奢美妆、智能出行、企业里程碑、全域增长方法论与高密度投放结构图——以下 6 类不同风格高光页已统一脱敏为「渊眸」品牌演示：

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/demo-industry-reel.gif" width="94%" alt="渊眸 PPT 多行业高光版式动态展映：工业声学、轻奢美妆、智能出行、企业历程、全域增长矩阵、高密度投放模型" />
  <br />
  <sub>6 大商业场景高光版式循环展映：从暗场工业设计、香槟丝绸轻奢画册到红黑汽车战役与高密度咨询结构图</sub>
</p>

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-industry-highlights.jpg" width="100%" alt="渊眸多行业高光版式 2x2 无框展板：轻奢美妆、智能出行、全域增长矩阵、组合投放框架" />
  <br />
  <sub>左上：轻奢美妆画册封面 · 右上：智能出行战役总纲 · 左下：全域增长三阶闭环矩阵 · 右下：高密度组合投放结构模型</sub>
</p>

---

### 03 · 渊眸电视「一家一屏 100 天」（23 页完整商业推广案 · 脱敏实战）

给定一句电视推广命题与跨行业参考版式，自动完成从**场景痛点洞察 → 核心战役概念 → 线上 H5 招募交互 → 百日连载动线 → 全媒扩散**的 23 页完整商业叙事重构。全套 23 页 `fail=0, warn=0`，所有异形蒙版、水墨笔刷、H5 表单控件与文案均可在 PowerPoint 中独立编辑。

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-yuanmou-tv-grid.jpg" width="100%" alt="渊眸电视一家一屏 100 天 23 页全套原生 PPTX 精选 12 页展板" />
  <br />
  <sub>23 页商业推广全案精选 12 页实拍：跨暗场电影感、水墨切片、菱形几何、互动 H5 表单与百日连载动线</sub>
</p>

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-yuanmou-tv-craft.jpg" width="92%" alt="渊眸电视原生工艺特写：水墨飞白切图、45度菱形裁图、暗底水墨扫带与九宫格多图画廊" />
  <br />
  <sub>原生复杂排版工艺特写：<code>brush-mask.mjs</code> 干笔飞白切片与实心朱砂印章 · 45° 菱形零拉伸裁图 · 九宫格独立槽位（右键可单张换图）</sub>
</p>

---

### 04 · 既有 `.pptx` 企业母本无损外科手术（35.4 MB → 1.05 MB）

不用推倒重画公司老模板。引擎直接解析原 `.pptx` 元素锚点，原位保留品牌母版、左侧视觉骨架与图片裁切蒙版，在右侧注入**双套内嵌真 Excel 图表 + 跨行合并原生表格**，同时自动执行 OPC 垃圾回收剥离未引用冗余媒体，体积直接瘦身 **97%**。

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/demo-template-surgery.gif" width="92%" alt="既有 .pptx 模板无损手术动态对比：35.4 MB 瘦身至 1.05 MB，保留原版骨架注入双真 Excel 图表" />
  <br />
  <sub>动态对比：左侧品牌色块与坐标 100% 像素锁定不动，右侧原地升级为双真 Excel 图表与合并表格</sub>
</p>

<p align="center">
  <img src="https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/download/v0.1.9/case-surgery-before-after.jpg" width="100%" alt="既有 .pptx 无损手术前后静态高清对照" />
</p>

---

## 与常见 PPT 方案的客观对比

| 维度 | 生图 / 截图流 PPT | HTML 转 PPT | 传统 `python-pptx` | **`yuanmou-ppt-skill`** |
| :--- | :--- | :--- | :--- | :--- |
| **原生可编辑性** | 整页死图，不可修改 | 导出后常错位散架 | 原生可编辑 | **100% 原生 OOXML，文字/形状/表格全可改** |
| **图表双击改 Excel** | 静态图 | 静态图或前端 Canvas | 配置繁琐、易乱码 | **零依赖内嵌 `ppt/embeddings/*.xlsx`，双击弹 Excel** |
| **既有 `.pptx` 无损改版** | 不支持 | 不支持 | 易破坏蒙版与母版 | **五步原位手术 + 保蒙版换图 + 自动瘦身 97%** |
| **复杂视觉 1:1 复刻** | 仅风格近似 | 依赖前端样式 | 缺透明渐变与蒙版 | **`<a:alpha>` 玻璃叠层 + 干笔飞白 + 50% X-Ray 叠图校准** |
| **运行依赖与体积** | 依赖外部生图 API | 常需无头浏览器 | 50–400 MB Python/C 依赖 | **0 npm 依赖（仅需 Node >=22.5），克隆 ~1.2 MB** |
| **自动化质量兜底** | 靠肉眼 | 靠肉眼 | 无内置门禁 | **6 组 15 项自动代码门禁 + 真机多页对照 PDF** |

---

## 开箱免费版 vs 飞书云盘 10W+ 版式库

安装即可 **0 登录、0 配置**使用完整引擎与 1.6W+ 免登录商业版式库；如为咨询、品牌策划或 Agency 高频交付团队，可按需接入飞书云盘 10W+ 持续日更版式库：

| 能力维度 | **免费版 · 开箱即用** | **进阶 VIP · 飞书云盘 10W+ 库** |
| :--- | :--- | :--- |
| **上手门槛** | 0 登录、0 配置，装完第一句话就能跑 | 飞书扫码授权 1 次（30 秒），后续自动续期 |
| **全能原生 OOXML 引擎** | 完整包含（一句话策划 / 截图与 PDF 复刻 / 旧模板手术 / 真 Excel 图表 / 15 项门禁） | 完整包含（同一套底层引擎） |
| **内置商业版式参考库** | **自带 1.6W+ 页免登录精选体验库**（含 1,600+ 结构化图示与高频商业页型） | **10W+ 全行业日更无水印商业母版库**（12 类图示家族 + 槽位指纹毫秒检索） |
| **拉图机制** | `batch-search` 1 条命令出单选看板 + 按需拉无损原图（2h 自动清缓存） | 本地毫秒级检索 + 按需拉取无损高清原图 |

> 如需独立 2026 各赛道行业报告库 / 完整 `.pptx` 策划方案库，或由渊眸团队承接定制策划与代运营，可联系 **渊眸策略**。

---

## 直接复制试跑（更多场景见 [`test-prompts.json`](./test-prompts.json)）

```text
# 1. 一句话从零策划并交付暗场高定发布会 PPT（含真 Excel 图表）
帮我策划并生成一套 5 页的「渊眸声学 AURA 01 空间音箱工业设计发布会」PPT：暗场高定美术馆风格，含高清产品剖面引线标注页、可双击编辑的真 Excel 频响与阻尼对比图表页、材质微距色卡页与三段式架构页，交付原生可编辑 .pptx。

# 2. 截图 / PDF 1:1 复刻为可编辑 PPTX
把这张参考截图 1:1 矢量复刻成可编辑的原生 .pptx（保留视觉层级、蒙版与配色，替换成我的新能源车 Q3 复盘数据），并用 50% X-Ray 叠图校准到无明显偏移。

# 3. 既有公司模板无损原位手术升级
保留 template.pptx 的母版风格、图片蒙版和左栏骨架不动，仅原位替换第 3～5 页文案与配图，右侧注入内嵌真实 Excel 的双系列柱形图与合并表格，并清理未用冗余媒体。
```

---

## 能力边界与透明安全

### 诚实说明：当前边界
- **真机渲染依赖可选但强烈推荐**：无 LibreOffice 环境时，引擎可零依赖完成构建与 6 组 15 项静态门禁（`code-gates-only` 降级模式），但要获得高清真机审图与左右对照 PDF，仍建议在桌面端安装 `LibreOffice + Poppler`。
- **图表覆盖范围**：当前聚焦商业咨询最高频的 95% 图表（柱形 / 条形 / 折线 / 面积 / 饼 / 环图 + 合并原生表）；极冷门的 3D 透视图、双轴组合图仍在持续补齐中。

### 本地优先 · 零遥测安全承诺
完整外联端点清单、本地缓存目录与一键清理方式均明文公开于 **[`SECURITY.md`](./SECURITY.md)**：
- **所有文档、文稿、`.pptx` 与表格 100% 本地处理，绝不上传任何远程服务器**。
- **零埋点、零统计 SDK**；仅在显式拉取免登录体验图库或检查更新时发起只读 `GET`，增量更新强制校验 `skill-manifest.json` 逐文件 SHA-256。

---

## 目录结构与许可协议

```text
yuanmou-ppt-skill/
├── skills/yuanmou-ppt/   # 100% 自包含 Agent Skill（SKILL.md + 原生 OOXML 引擎 + provider_cli / deck_cli）
├── packages/pptx-kit/    # 顶层包导出兼容层
├── scripts/              # 多端安装、原子发版双包校验与清单同步脚本
├── docs/                 # 官网静态页（ppt.resourcehub.dpdns.org）
├── test-prompts.json     # 6 类核心工作流开箱 Prompt（中英双语）
├── SECURITY.md           # 透明安全边界与全部外联端点说明
├── LICENSE               # Apache License 2.0（允许个人与企业商业免费使用）
└── NOTICE                # 渊眸策略版权署名声明
```

本项目代码引擎与 Skill 定义采用 OSI 认证的 **[Apache License 2.0](./LICENSE)**：完全允许个人学习、企业汇报与商业项目免费使用（二次分发须按协议保留 [NOTICE](./NOTICE) 中的「渊眸策略」版权署名）。

> 注：飞书云盘 VIP 无水印参考图库与独立行业报告/方案资料属于会员专享参考资料，不适用代码开源协议，严禁转售或公开二次分发。
