#!/usr/bin/env python3
# Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).
# Generates Left (Original Source Slide) vs Right (@yuanmou/pptx-kit M2 Output) comparison plates,
# self-contained Base64 HTML gallery, and widescreen horizontal comparison PDF.

import base64
import os
import pathlib
import shutil
from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent
OUT_DIR = ROOT / "output"
RENDERED_DIR = OUT_DIR / "rendered"
ARTIFACT_DIR = pathlib.Path(os.environ.get("YUANMOU_ARTIFACT_DIR", str(OUT_DIR)))
CAND_DIR = pathlib.Path(os.environ.get("YUANMOU_CAND_DIR", str(ARTIFACT_DIR / "scratch" / "m2_candidates" / "rendered_png")))
REF_DIR = pathlib.Path(os.environ.get("YUANMOU_REF_DIR", str(ARTIFACT_DIR / "scratch" / "m2_refs")))

PAIRS = [
    {
        "slug": "compare_m2_1_fan_surgery",
        "badge": "武器 07–11 · 原版 .pptx 外科手术五件套（异形渐变三扇环无损保留 + 跨Run文案改版）",
        "title": "Case 1｜【5012】Slide 10 巨型粉白渐变三扇环模板：从「绝味鸭脖」无损外科改版为「东方新茶饮人群洞察」",
        "left_label": "左：原版 .pptx 源页（【5012】绝味鸭脖 Slide 10）",
        "right_label": "右：@yuanmou/pptx-kit M2 外科手术改版成稿（1.05MB 零冗余包）",
        "left_png": CAND_DIR / "5012_subset-3.png",
        "right_png": RENDERED_DIR / "m2_p1_surgical-1.png",
        "notes": "完整执行 inspectTemplateDeck → validateTemplatePlan → prepareStarterDeck → Presentation.load → auditTemplateFidelity；100% 保留原版三扇环渐变底图、人群剪影与圆角胶囊，删除旧品牌章并原位注入矢量「茶」字印章。",
    },
    {
        "slug": "compare_m2_2_masked_photos",
        "badge": "武器 07–11 · OOXML 异形蒙版原位换图（5 处 roundRect 跨画幅自动居中裁切 <a:srcRect>）",
        "title": "Case 2｜【5012】Slide 12 双栏圆角海报组：5 处圆角矩形蒙版原位换图 + 多段原生项目符号继承重写",
        "left_label": "左：原版 .pptx 源页（【5012】绝味鸭脖 Slide 12）",
        "right_label": "右：@yuanmou/pptx-kit M2 5图原位换血成稿（自动计算 srcRect 零拉伸）",
        "left_png": CAND_DIR / "5012_subset-5.png",
        "right_png": RENDERED_DIR / "m2_p1_surgical-2.png",
        "notes": "横构图（1080×719、635×500）与竖构图（1080×1435）茶席实拍图直接喂入原版 5 处 <a:prstGeom prst=\"roundRect\"> 槽位，引擎自动插入精准 <a:srcRect> 居中裁切且隔离 rId，绝不污染其他页面媒体。",
    },
    {
        "slug": "compare_m2_3_hybrid_data",
        "badge": "武器 07 + 12 + 13–15 · 混合外科手术 Hybrid Mode（原版母版 + 内嵌 .xlsx 双图表 + 跨行合并原生表格）",
        "title": "Case 3｜【5011】Slide 25 混合外科手术：保留原版左栏视觉骨架，删旧图并原位注入可双击编辑双图表与合并表格",
        "left_label": "左：原版 .pptx 源页（【5011】新媒体矩阵 Slide 25）",
        "right_label": "右：@yuanmou/pptx-kit M2 混合注入成稿（簇状柱形图 + 环形图 + 跨行合并表）",
        "left_png": CAND_DIR / "5011_subset-3.png",
        "right_png": RENDERED_DIR / "m2_p2_hybrid-1.png",
        "notes": "删除旧单色柱状图并自动清理孤立 chart/xlsx 包部件；右栏原位注入内嵌真实 Excel 工作簿（ppt/embeddings/*.xlsx）的双系列簇状柱形图、GMV 环形图，以及含 fixed()/fr() 比例列宽与 rowSpan 跨行合并的原生 <a:tbl>。",
    },
    {
        "slug": "compare_m2_4_bcg_table_clone",
        "badge": "武器 12 · 1:1 像素级复刻 BCG 咨询报告原生比例表格 <a:tbl>（虚线内框 + 白分隔线表头 + 矢量时间轴）",
        "title": "Case 4｜【1016】BCG 新消费报告 P12：1:1 纯原生复刻（左栏 <a:tbl> 比例虚线表 + 右栏渐变时间轴与折角托架）",
        "left_label": "左：BCG 原版报告页（【1016】Page 12 Reference）",
        "right_label": "右：@yuanmou/pptx-kit M2 100% 原生 <a:tbl> + 矢量重绘成稿",
        "left_png": REF_DIR / "bcg_p12-12.png",
        "right_png": RENDERED_DIR / "m2_p3_clones-1.png",
        "notes": "左表 100% 为 PowerPoint 原生 <a:tbl>（fixed(98)+fixed(128)+fr(1)，表头实线白分隔 + 表体 #CBD5E1 虚线网格），配合对角折耳色带、双层 V 型分隔线、渐变描边卡片与四角 L 型托架。",
    },
    {
        "slug": "compare_m2_5_multi_chart_clone",
        "badge": "武器 13–15 · 1:1 像素级复刻多系列折线图 <c:lineChart> + 双栏横向条形图 <c:barChart>（均带内嵌 .xlsx）",
        "title": "Case 5｜【1008】卓尔数科美妆洞察 P8：1:1 纯原生图表复刻（6 系列折线图 + 双栏 Top-Down 横向条形图）",
        "left_label": "左：卓尔数科原版报告页（【1008】Page 8 Reference）",
        "right_label": "右：@yuanmou/pptx-kit M2 100% 原生可双击编辑三图表成稿（仅 25.6KB）",
        "left_png": REF_DIR / "ze_p08-08.png",
        "right_png": RENDERED_DIR / "m2_p3_clones-2.png",
        "notes": "单页含 3 个独立内嵌 .xlsx 工作簿的原生 <c:chart>：左侧 6 系列 17 期折线图（X 轴 -90° 旋转、Y 轴 0%-80% 格式化）；右侧两个横向条形图自动启用 maxMin 倒序使榜首词条置顶，并通过 pointFills 高亮 #5500E6 首条数据。",
    },
]

TARGET_W, TARGET_H = 1600, 900
PAD = 28
GAP = 28


def make_side_by_side_plate(left_path: pathlib.Path, right_path: pathlib.Path, out_path: pathlib.Path):
    im_l = Image.open(left_path).convert("RGB").resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
    im_r = Image.open(right_path).convert("RGB").resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)

    im_l = ImageOps.expand(im_l, border=2, fill=(71, 85, 105))
    im_r = ImageOps.expand(im_r, border=2, fill=(16, 185, 129))

    canvas_w = PAD * 2 + im_l.width + GAP + im_r.width
    canvas_h = PAD * 2 + im_l.height
    canvas = Image.new("RGB", (canvas_w, canvas_h), (15, 23, 42))
    canvas.paste(im_l, (PAD, PAD))
    canvas.paste(im_r, (PAD + im_l.width + GAP, PAD))
    canvas.save(out_path, format="PNG", optimize=True)
    return canvas


def to_data_uri(img_path: pathlib.Path) -> str:
    b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def main():
    plate_images = []
    cards_html = []

    for idx, item in enumerate(PAIRS, 1):
        plate_path = OUT_DIR / f"{item['slug']}.png"
        plate_img = make_side_by_side_plate(item["left_png"], item["right_png"], plate_path)
        plate_images.append(plate_img)

        # Copy to artifact dir for direct markdown embedding
        shutil.copy2(plate_path, ARTIFACT_DIR / f"{item['slug']}.png")

        left_uri = to_data_uri(item["left_png"])
        right_uri = to_data_uri(item["right_png"])

        cards_html.append(f"""
        <section class="card">
          <div class="card-header">
            <span class="badge">{item['badge']}</span>
            <h2>{item['title']}</h2>
            <p class="notes">{item['notes']}</p>
          </div>
          <div class="compare-grid">
            <div class="pane pane-left">
              <div class="pane-label label-orig">{item['left_label']}</div>
              <img src="{left_uri}" alt="Left reference {idx}" />
            </div>
            <div class="pane pane-right">
              <div class="pane-label label-render">{item['right_label']}</div>
              <img src="{right_uri}" alt="Right M2 render {idx}" />
            </div>
          </div>
        </section>
        """)

    # Save 5-page horizontal comparison PDF
    pdf_path = OUT_DIR / "m2_side_by_side_comparison.pdf"
    plate_images[0].save(
        pdf_path,
        "PDF",
        resolution=150.0,
        save_all=True,
        append_images=plate_images[1:],
    )

    # Save self-contained Base64 HTML gallery
    html_path = OUT_DIR / "m2_side_by_side_gallery.html"
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>渊眸策略 · @yuanmou/pptx-kit M2 里程碑真机对比验收看板</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #0B1120; color: #F8FAFC; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 32px 36px 64px; }}
    header {{ max-width: 1840px; margin: 0 auto 28px; padding-bottom: 20px; border-bottom: 1px solid #1E293B; }}
    header h1 {{ font-size: 26px; font-weight: 700; margin-bottom: 8px; color: #F8FAFC; }}
    header p {{ font-size: 14px; color: #94A3B8; line-height: 1.6; }}
    .card {{ max-width: 1840px; margin: 0 auto 32px; background: #111827; border: 1px solid #1F2937; border-radius: 14px; padding: 22px 24px 26px; box-shadow: 0 12px 32px rgba(0,0,0,0.35); }}
    .badge {{ display: inline-block; background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 999px; font-size: 12px; font-weight: 600; padding: 4px 12px; margin-bottom: 10px; }}
    .card-header h2 {{ font-size: 19px; color: #F1F5F9; margin-bottom: 6px; }}
    .notes {{ font-size: 13px; color: #94A3B8; margin-bottom: 16px; line-height: 1.55; }}
    .compare-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
    .pane {{ background: #0F172A; border-radius: 10px; padding: 10px; border: 1px solid #1E293B; }}
    .pane-right {{ border-color: rgba(16, 185, 129, 0.45); }}
    .pane-label {{ font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 6px; margin-bottom: 10px; }}
    .label-orig {{ background: #1E293B; color: #CBD5E1; }}
    .label-render {{ background: #064E3B; color: #6EE7B7; }}
    .pane img {{ width: 100%; height: auto; display: block; border-radius: 4px; background: #FFFFFF; }}
  </style>
</head>
<body>
  <header>
    <h1>渊眸策略 · @yuanmou/pptx-kit 里程碑 M2（武器 07–15）左右同屏真机验收看板</h1>
    <p>包含：原版 .pptx 无损外科手术五件套（5012 S10 异形渐变三扇环改版、5012 S12 五处圆角蒙版原位换图）、混合外科手术（5011 S25 原位注入内嵌 .xlsx 双图表与跨行合并原生表格），以及 1:1 纯原生复刻 BCG 1016 P12 比例虚线表格与卓尔数科 1008 P8 多系列折线图/双横向条形图。所有图片均已 Base64 内联。</p>
  </header>
  {''.join(cards_html)}
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")
    print("Generated:", html_path, pdf_path)


if __name__ == "__main__":
    main()
