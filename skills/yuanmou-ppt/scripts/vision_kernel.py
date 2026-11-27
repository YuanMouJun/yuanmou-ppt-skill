#!/usr/bin/env python3
# Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
# Unified Python Vision & PDF Vector Kernel for `deck_cli.mjs` (zero inline code duplication).

import json
import math
import os
import sys


def load_cfg():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: vision_kernel.py <subcommand> <json_or_->")
    raw = sys.stdin.read() if sys.argv[2] == "-" else sys.argv[2]
    return sys.argv[1], json.loads(raw)


def to_hex(c):
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        return "#{:02X}{:02X}{:02X}".format(
            max(0, min(255, int(round(c[0] * 255)))),
            max(0, min(255, int(round(c[1] * 255)))),
            max(0, min(255, int(round(c[2] * 255)))),
        )
    return None


def rgb_to_hex(rgb):
    return "#{:02X}{:02X}{:02X}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))


def median_rgb(pixels):
    if not pixels:
        return (255, 255, 255)
    rs = sorted(p[0] for p in pixels)
    gs = sorted(p[1] for p in pixels)
    bs = sorted(p[2] for p in pixels)
    m = len(pixels) // 2
    return (rs[m], gs[m], bs[m])


def open_fitz():
    try:
        import pymupdf as fitz
        return fitz
    except Exception:
        try:
            import fitz
            return fitz
        except Exception:
            return None


def items_to_svg(items, sx, sy, close_path=True):
    parts = []
    cur = None
    for it in items:
        k = it[0]
        if k == "l":
            p1 = (round(it[1].x * sx, 1), round(it[1].y * sy, 1))
            p2 = (round(it[2].x * sx, 1), round(it[2].y * sy, 1))
            if cur != p1:
                parts.append(f"M {p1[0]} {p1[1]}")
            parts.append(f"L {p2[0]} {p2[1]}")
            cur = p2
        elif k == "c":
            p1 = (round(it[1].x * sx, 1), round(it[1].y * sy, 1))
            p2 = (round(it[2].x * sx, 1), round(it[2].y * sy, 1))
            p3 = (round(it[3].x * sx, 1), round(it[3].y * sy, 1))
            p4 = (round(it[4].x * sx, 1), round(it[4].y * sy, 1))
            if cur != p1:
                parts.append(f"M {p1[0]} {p1[1]}")
            parts.append(f"C {p2[0]} {p2[1]} {p3[0]} {p3[1]} {p4[0]} {p4[1]}")
            cur = p4
    if parts and close_path:
        parts.append("Z")
    return " ".join(parts)


def compute_items_bbox(items, sx, sy):
    xs = []
    ys = []
    for it in items:
        k = it[0]
        if k == "l":
            xs.extend((it[1].x * sx, it[2].x * sx))
            ys.extend((it[1].y * sy, it[2].y * sy))
        elif k == "c":
            xs.extend((it[1].x * sx, it[2].x * sx, it[3].x * sx, it[4].x * sx))
            ys.extend((it[1].y * sy, it[2].y * sy, it[3].y * sy, it[4].y * sy))
        elif k == "re" and len(it) >= 2:
            r = it[1]
            xs.extend((r.x0 * sx, r.x1 * sx))
            ys.extend((r.y0 * sy, r.y1 * sy))
    if not xs or not ys:
        return None
    x0, x1 = round(min(xs), 1), round(max(xs), 1)
    y0, y1 = round(min(ys), 1), round(max(ys), 1)
    return [x0, y0, round(max(1.0, x1 - x0), 1), round(max(1.0, y1 - y0), 1)]


def _point_line_dist(pt, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0.0 and dy == 0.0:
        return math.hypot(pt[0] - a[0], pt[1] - a[1])
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    px, py = a[0] + t * dx, a[1] + t * dy
    return math.hypot(pt[0] - px, pt[1] - py)


def rdp_simplify(points, epsilon=1.8):
    if len(points) <= 2:
        return list(points)
    start, end = points[0], points[-1]
    max_d = -1.0
    idx = 0
    for i in range(1, len(points) - 1):
        d = _point_line_dist(points[i], start, end)
        if d > max_d:
            max_d = d
            idx = i
    if max_d > epsilon:
        left = rdp_simplify(points[: idx + 1], epsilon)
        right = rdp_simplify(points[idx:], epsilon)
        return left[:-1] + right
    return [start, end]


def extract_elongated_stroke_path(raw_items, sx, sy, bx, by, bw, bh):
    """Skeletonizes high-segment elongated filled marker/underline/strikethrough paths into clean RDP polylines."""
    if bw < 12 or bh < 4:
        return None
    ratio = max(bw / max(1.0, bh), bh / max(1.0, bw))
    if ratio < 2.2:
        return None
    pts = []
    for it in raw_items:
        k = it[0]
        if k == "l":
            pts.append((it[1].x * sx, it[1].y * sy))
            pts.append((it[2].x * sx, it[2].y * sy))
        elif k == "c":
            pts.append((it[1].x * sx, it[1].y * sy))
            pts.append((it[4].x * sx, it[4].y * sy))
    if len(pts) < 6:
        return None

    bins = 10
    center_pts = []
    thicks = []
    if bw >= bh:
        xmin = min(p[0] for p in pts)
        xmax = max(p[0] for p in pts)
        span = max(1.0, xmax - xmin)
        for k in range(bins):
            lo = xmin + span * k / bins
            hi = xmin + span * (k + 1) / bins + (0.01 if k == bins - 1 else 0.0)
            ys = [p[1] for p in pts if lo <= p[0] <= hi]
            if ys:
                center_pts.append((round((lo + hi) * 0.5, 1), round((min(ys) + max(ys)) * 0.5, 1)))
                thicks.append(max(ys) - min(ys))
    else:
        ymin = min(p[1] for p in pts)
        ymax = max(p[1] for p in pts)
        span = max(1.0, ymax - ymin)
        for k in range(bins):
            lo = ymin + span * k / bins
            hi = ymin + span * (k + 1) / bins + (0.01 if k == bins - 1 else 0.0)
            xs = [p[0] for p in pts if lo <= p[1] <= hi]
            if xs:
                center_pts.append((round((min(xs) + max(xs)) * 0.5, 1), round((lo + hi) * 0.5, 1)))
                thicks.append(max(xs) - min(xs))

    if len(center_pts) < 2 or not thicks:
        return None
    thicks.sort()
    med_thick = thicks[len(thicks) // 2]
    # Reject solid filled bars that occupy nearly the whole thickness without diagonal slant
    if med_thick > max(26.0, min(bw, bh) * 0.88):
        return None

    simplified = rdp_simplify(center_pts, epsilon=1.8)
    if len(simplified) > 16:
        simplified = rdp_simplify(center_pts, epsilon=3.5)
    parts = [f"M {simplified[0][0]} {simplified[0][1]}"] + [f"L {p[0]} {p[1]}" for p in simplified[1:]]
    stroke_w = round(max(2.0, min(16.0, med_thick * 0.68)), 1)
    return {
        "svgPath": " ".join(parts),
        "viewBox": [bx, by, bw, bh],
        "strokeW": stroke_w,
    }


def _bbox_iou_and_overlap(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    area_a = max(1e-3, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1e-3, (b[2] - b[0]) * (b[3] - b[1]))
    iou = inter / max(1e-3, area_a + area_b - inter)
    ov_min = inter / min(area_a, area_b)
    return iou, ov_min


def measure_tilt(sub_rgb, min_angle=3, min_share=0.09, min_val=28000.0, max_side=440.0, mag_thresh=140.0, square_size=None):
    """Unified Sobel angle-histogram tilt detector (OOXML convention: +deg = CW right-lean \\, -deg = CCW left-lean /)."""
    from PIL import Image

    if square_size:
        gw, gh = square_size, square_size
    else:
        w, h = sub_rgb.size
        scale = min(1.0, max_side / max(1, max(w, h)))
        gw, gh = max(24, int(w * scale)), max(24, int(h * scale))

    gray = sub_rgb.resize((gw, gh), Image.Resampling.BILINEAR).convert("L")
    px = gray.load()
    bins = {}
    total_mag = 0.0
    for y in range(2, gh - 2):
        for x in range(2, gw - 2):
            gx = (px[x + 1, y - 1] + 2 * px[x + 1, y] + px[x + 1, y + 1]) - (
                px[x - 1, y - 1] + 2 * px[x - 1, y] + px[x - 1, y + 1]
            )
            gy = (px[x - 1, y + 1] + 2 * px[x, y + 1] + px[x + 1, y + 1]) - (
                px[x - 1, y - 1] + 2 * px[x, y - 1] + px[x + 1, y - 1]
            )
            mag = math.hypot(gx, gy)
            if mag < mag_thresh:
                continue
            rel = ((math.degrees(math.atan2(gy, gx)) + 45.0) % 90.0) - 45.0
            b = int(round(rel))
            bins[b] = bins.get(b, 0.0) + mag
            total_mag += mag

    if total_mag < 1e-3:
        return {"dominantTiltDeg": 0, "tiltDirection": "upright", "tiltConfidence": 0.0, "share": 0.0}

    non_ortho = [
        (ang, sum(bins.get(ang + d, 0.0) for d in (-1, 0, 1)))
        for ang in range(-40, 41)
        if abs(ang) >= min_angle
    ]
    best_ang, best_val = max(non_ortho, key=lambda kv: kv[1])
    share = best_val / max(1.0, total_mag)
    if share >= min_share and best_val >= min_val:
        return {
            "dominantTiltDeg": int(best_ang),
            "tiltDirection": "clockwise" if best_ang > 0 else "counterclockwise",
            "tiltConfidence": round(min(1.0, share * 2.5), 2),
            "share": round(share, 3),
        }
    return {
        "dominantTiltDeg": 0,
        "tiltDirection": "upright",
        "tiltConfidence": round(share, 2),
        "share": round(share, 3),
    }


def calc_edge_similarity(ri, gi):
    from PIL import Image, ImageFilter

    re = ri.resize((320, 180), Image.Resampling.BILINEAR).convert("L").filter(ImageFilter.FIND_EDGES)
    ge = gi.resize((320, 180), Image.Resampling.BILINEAR).convert("L").filter(ImageFilter.FIND_EDGES)
    inter = 0.0
    union = 0.0
    for a, b in zip(re.getdata(), ge.getdata()):
        if a > 28 or b > 28:
            inter += min(a, b)
            union += max(a, b)
    if union < 1e-3:
        return 100.0
    return round(min(100.0, 100.0 * inter / union), 1)


def measure_photo_tile_pct(im_rgb):
    from PIL import Image, ImageStat

    tw, th = 40, 38
    w, h = im_rgb.size
    q_whole = im_rgb.quantize(colors=8, method=Image.Quantize.MEDIANCUT).convert("RGB")
    bg = sorted(q_whole.getcolors(maxcolors=32) or [], reverse=True)[0][1]
    photo_tiles = 0
    total_tiles = 0
    for y in range(0, h - th + 1, th):
        for x in range(0, w - tw + 1, tw):
            total_tiles += 1
            tile = im_rgb.crop((x, y, x + tw, y + th))
            st = ImageStat.Stat(tile)
            if sum(st.stddev) / 3.0 < 16.0:
                continue
            raw = tile.tobytes()
            n_px = max(1, len(raw) // 3)
            non_bg = 0
            uniq_all = set()
            uniq_chroma = set()
            for j in range(0, len(raw), 3):
                r, g, b = raw[j], raw[j + 1], raw[j + 2]
                if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) >= 45:
                    non_bg += 1
                    q = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
                    uniq_all.add(q)
                    if max(r, g, b) - min(r, g, b) >= 24:
                        uniq_chroma.add(q)
            if non_bg / float(n_px) >= 0.45 and len(uniq_all) >= 24 and len(uniq_chroma) >= 10:
                photo_tiles += 1
    return round(100.0 * photo_tiles / max(1, total_tiles), 1)


def cmd_render_pdf_page(cfg):
    pdf_path = cfg["pdfPath"]
    out_png = cfg["outPng"]
    page_no = int(cfg.get("pageNo", 1))
    dpi = int(cfg.get("dpi", 220))
    os.makedirs(os.path.dirname(os.path.abspath(out_png)), exist_ok=True)
    try:
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(pdf_path)
        doc[page_no - 1].render(scale=float(dpi) / 72.0).to_pil().save(out_png)
        return {"ok": True, "outPng": out_png, "engine": "pypdfium2"}
    except Exception:
        fitz = open_fitz()
        if not fitz:
            raise RuntimeError("Neither pypdfium2 nor PyMuPDF is installed")
        doc = fitz.open(pdf_path)
        doc[page_no - 1].get_pixmap(dpi=dpi).save(out_png)
        return {"ok": True, "outPng": out_png, "engine": "pymupdf"}


def cmd_pdf_probe(cfg):
    fitz = open_fitz()
    if not fitz:
        return {"available": False, "pdfKind": "unknown", "reason": "PyMuPDF not installed"}
    pdf_path = cfg["pdfPath"]
    page_no = int(cfg.get("pageNo", 1))
    doc = fitz.open(pdf_path)
    if page_no < 1 or page_no > len(doc):
        return {"available": True, "pageCount": len(doc), "error": f"Page {page_no} out of range 1..{len(doc)}"}

    page = doc[page_no - 1]
    pw, ph = float(page.rect.width) or 1280.0, float(page.rect.height) or 720.0
    sx, sy = 1280.0 / pw, 720.0 / ph

    text_dict = page.get_text("dict")
    text_items = []
    for blk in text_dict.get("blocks", []):
        if blk.get("type") != 0:
            continue
        lines_txt = []
        max_sz = 0.0
        font_name = ""
        color_hex = None
        for ln in blk.get("lines", []):
            spans = []
            for sp in ln.get("spans", []):
                t = sp.get("text", "").strip()
                if not t:
                    continue
                spans.append(t)
                sz = float(sp.get("size", 0))
                if sz > max_sz:
                    max_sz = sz
                    font_name = sp.get("font", "")
                    c_int = sp.get("color", 0)
                    if isinstance(c_int, int):
                        color_hex = "#{:06X}".format(c_int & 0xFFFFFF)
            if spans:
                lines_txt.append("".join(spans))
        joined = "\n".join(lines_txt).strip()
        if not joined:
            continue
        x0, y0, x1, y1 = blk["bbox"]
        text_items.append({
            "bbox": [round(x0 * sx, 1), round(y0 * sy, 1), round((x1 - x0) * sx, 1), round((y1 - y0) * sy, 1)],
            "fontSizePt": round(max_sz * sy * 0.75, 1),
            "font": font_name,
            "color": color_hex,
            "text": joined[:140],
        })

    drawings = page.get_drawings()
    drawing_items = []
    for dr in drawings[:80]:
        r = dr.get("rect")
        if not r:
            continue
        w, h = (r.x1 - r.x0) * sx, (r.y1 - r.y0) * sy
        if w < 4 and h < 4:
            continue
        item_rec = {
            "bbox": [round(r.x0 * sx, 1), round(r.y0 * sy, 1), round(w, 1), round(h, 1)],
            "fill": to_hex(dr.get("fill")),
            "stroke": to_hex(dr.get("color")),
        }
        raw_items = dr.get("items") or []
        if 2 <= len(raw_items) <= 24 and any(it[0] in ("l", "c") for it in raw_items):
            sp = items_to_svg(raw_items, sx, sy)
            if sp:
                item_rec["svgPath"] = sp
                item_rec["viewBox"] = compute_items_bbox(raw_items, sx, sy) or item_rec["bbox"]
        drawing_items.append(item_rec)

    clip_items = []
    try:
        for ext_d in page.get_drawings(extended=True):
            if ext_d.get("type") != "clip":
                continue
            c_items = ext_d.get("items") or []
            if len(c_items) < 2 or len(c_items) > 40 or not any(it[0] in ("l", "c") for it in c_items):
                continue
            bbox = compute_items_bbox(c_items, sx, sy)
            if not bbox:
                continue
            sp = items_to_svg(c_items, sx, sy)
            if sp:
                clip_items.append({"bbox": bbox, "viewBox": bbox, "svgPath": sp})
    except Exception:
        pass

    img_infos = page.get_image_info(xrefs=True)
    image_items = []
    for im in img_infos[:40]:
        x0, y0, x1, y1 = im["bbox"]
        image_items.append({
            "bbox": [round(x0 * sx, 1), round(y0 * sy, 1), round((x1 - x0) * sx, 1), round((y1 - y0) * sy, 1)],
            "pixelSize": [im.get("width", 0), im.get("height", 0)],
        })

    if len(text_items) > 0 and len(drawing_items) >= 3:
        kind = "vector"
    elif len(text_items) > 0 or len(drawing_items) >= 3:
        kind = "hybrid"
    else:
        kind = "raster"

    return {
        "available": True,
        "pageCount": len(doc),
        "pageNo": page_no,
        "pdfSize": [round(pw, 1), round(ph, 1)],
        "pdfKind": kind,
        "textBlockCount": len(text_items),
        "drawingCount": len(drawings),
        "clipCount": len(clip_items),
        "imageCount": len(img_infos),
        "vectorObjects": {
            "texts": text_items[:60],
            "drawings": drawing_items[:60],
            "clips": clip_items[:16],
            "images": image_items[:30],
        }
        if kind != "raster"
        else None,
    }


def cmd_pdf_extract_master(cfg):
    fitz = open_fitz()
    if not fitz:
        return {"available": False, "error": "PyMuPDF (pymupdf) is required for pdf-to-master"}

    try:
        from PIL import Image
        has_pil = True
    except Exception:
        has_pil = False

    pdf_path = cfg["pdfPath"]
    page_list = cfg.get("pages") or []
    refs_dir = cfg["refsDir"]
    os.makedirs(refs_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    if not page_list:
        page_list = list(range(1, min(total_pages, 20) + 1))

    out_pages = []
    for idx, pno in enumerate(page_list, start=1):
        if pno < 1 or pno > total_pages:
            continue
        page = doc[pno - 1]
        pw, ph = float(page.rect.width) or 1280.0, float(page.rect.height) or 720.0
        sx, sy = 1280.0 / pw, 720.0 / ph

        ref_name = f"m{idx:02d}_p{pno:02d}.png"
        ref_path = os.path.join(refs_dir, ref_name)
        page.get_pixmap(dpi=200).save(ref_path)
        ref_pil = Image.open(ref_path).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS) if has_pil else None

        # True PDF painter's content-stream z-order log
        bboxlog = page.get_bboxlog() or []
        img_log = [(z, bb) for z, (kind, bb) in enumerate(bboxlog) if kind == "fill-image"]
        txt_log = [(z, bb) for z, (kind, bb) in enumerate(bboxlog) if kind in ("fill-text", "stroke-text")]
        used_img_z = set()

        # 1) Text lines (with true zOrder + typographic baseline normalization for abnormal font descenders!)
        texts = []
        td = page.get_text("dict")
        t_seq = 0
        for blk in td.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                dv = ln.get("dir", (1, 0))
                spans = [sp for sp in ln.get("spans", []) if sp.get("text", "").strip()]
                if not spans:
                    continue
                x0 = min(sp["bbox"][0] for sp in spans)
                y0 = min(sp["bbox"][1] for sp in spans)
                x1 = max(sp["bbox"][2] for sp in spans)
                y1 = max(sp["bbox"][3] for sp in spans)
                dom_sp = max(spans, key=lambda sp: len(sp.get("text", "")))
                raw_text = "".join(sp.get("text", "") for sp in spans).strip()
                c_int = dom_sp.get("color", 0)
                hexc = "#{:06X}".format(c_int & 0xFFFFFF) if isinstance(c_int, int) else "#111827"
                font_px = float(dom_sp.get("size", 14)) * sy
                font_pt = round(font_px * 0.75, 1)

                # Match content-stream zOrder from bboxlog
                raw_bb = (x0, y0, x1, y1)
                best_z = len(bboxlog) + t_seq
                best_score = -1.0
                for z_idx, lbb in txt_log:
                    iou, ov_min = _bbox_iou_and_overlap(raw_bb, lbb)
                    score = iou * 0.7 + ov_min * 0.3
                    if ov_min >= 0.40 and score > best_score:
                        best_score = score
                        best_z = z_idx
                if best_score < 0 and txt_log:
                    cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
                    best_z = min(
                        txt_log,
                        key=lambda kv: abs((kv[1][0] + kv[1][2]) * 0.5 - cx) + abs((kv[1][1] + kv[1][3]) * 0.5 - cy),
                    )[0]

                # Normalize oversized PDF font-descriptor ascent/descent bboxes on horizontal lines using exact baseline `origin`
                cx0, cy0, cx1, cy1 = x0 * sx, y0 * sy, x1 * sx, y1 * sy
                is_horiz = abs(float(dv[0])) >= 0.85 and abs(float(dv[1])) <= 0.25
                if is_horiz and font_px > 8.0 and (cy1 - cy0) > font_px * 1.42 and dom_sp.get("origin"):
                    origin_y = float(dom_sp["origin"][1]) * sy
                    asc = float(dom_sp.get("ascender", 0.90) or 0.90)
                    desc = abs(float(dom_sp.get("descender", -0.22) or -0.22))
                    is_caps_or_digits = all((("A" <= ch <= "Z") or ("0" <= ch <= "9") or ch in " .,-:/+!?&%") for ch in raw_text)
                    eff_asc = min(max(asc, 0.80), 1.02)
                    eff_desc = 0.14 if is_caps_or_digits else min(desc, 0.24)
                    tight_y0 = max(cy0, origin_y - font_px * eff_asc)
                    tight_y1 = min(cy1, origin_y + font_px * eff_desc)
                    if tight_y1 - tight_y0 >= font_px * 0.80:
                        cy0, cy1 = tight_y0, tight_y1

                texts.append({
                    "text": raw_text,
                    "x": round(cx0, 1),
                    "y": round(cy0, 1),
                    "w": round(max(4.0, cx1 - cx0), 1),
                    "h": round(max(4.0, cy1 - cy0), 1),
                    "fontPt": font_pt,
                    "font": dom_sp.get("font", ""),
                    "color": hexc,
                    "alpha": round(max(0.0, min(1.0, float(dom_sp.get("alpha", 255)) / 255.0)), 2),
                    "dir": [round(float(dv[0]), 2), round(float(dv[1]), 2)],
                    "zOrder": int(best_z),
                })
                t_seq += 1

        # 2) Vector drawings (preserving exact `seqno` zOrder + RDP skeletonization for elongated high-segment strokes)
        slide_bg = "#FFFFFF"
        drawings = []
        raw_drawings = page.get_drawings()
        for d_idx, d in enumerate(raw_drawings[:150]):
            r = d.get("rect")
            if not r:
                continue
            x, y = round(r.x0 * sx, 1), round(r.y0 * sy, 1)
            w, h = round((r.x1 - r.x0) * sx, 1), round((r.y1 - r.y0) * sy, 1)
            if w < 1 and h < 1:
                continue
            fill = to_hex(d.get("fill"))
            stroke = to_hex(d.get("color"))
            op = round(float(d.get("fill_opacity", 1.0) if d.get("fill_opacity") is not None else 1.0), 2)
            seqno = d.get("seqno")
            z_ord = int(seqno) if isinstance(seqno, int) else d_idx
            if d_idx == 0 and x <= 2 and y <= 2 and w >= 1270 and h >= 712 and fill and op >= 0.98:
                slide_bg = fill
                continue
            raw_items = d.get("items") or []
            is_capsule = (
                len(raw_items) == 6
                and sum(1 for it in raw_items if it[0] == "c") == 4
                and sum(1 for it in raw_items if it[0] == "l") == 2
            )
            rec = {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "fill": fill,
                "fillOpacity": op,
                "stroke": stroke,
                "strokeW": round(float(d.get("width") or 0) * sx, 2),
                "opCount": len(raw_items),
                "isCapsule": is_capsule,
                "zOrder": z_ord,
            }
            if not is_capsule and 2 <= len(raw_items) <= 48 and any(it[0] in ("l", "c") for it in raw_items):
                sp = items_to_svg(raw_items, sx, sy)
                if sp:
                    vb = compute_items_bbox(raw_items, sx, sy) or [x, y, w, h]
                    rec["svgPath"] = sp
                    rec["viewBox"] = vb
                    rec["x"], rec["y"], rec["w"], rec["h"] = vb[0], vb[1], vb[2], vb[3]
            elif len(raw_items) > 48:
                stroke_skel = extract_elongated_stroke_path(raw_items, sx, sy, x, y, w, h)
                if stroke_skel:
                    rec["isStrokePath"] = True
                    rec["svgPath"] = stroke_skel["svgPath"]
                    rec["viewBox"] = stroke_skel["viewBox"]
                    rec["strokeW"] = stroke_skel["strokeW"]
            drawings.append(rec)

        # 3) Non-rectangular vector clipping paths (TRUE unclamped bbox matching svgPath coordinates!)
        clips = []
        try:
            for ext_d in page.get_drawings(extended=True):
                if ext_d.get("type") != "clip":
                    continue
                c_items = ext_d.get("items") or []
                if len(c_items) < 2 or len(c_items) > 40 or not any(it[0] in ("l", "c") for it in c_items):
                    continue
                true_vb = compute_items_bbox(c_items, sx, sy)
                if not true_vb or true_vb[2] < 40 or true_vb[3] < 40:
                    continue
                sp = items_to_svg(c_items, sx, sy)
                if sp:
                    clips.append({"bbox": true_vb, "svgPath": sp})
        except Exception:
            pass

        # 4) Embedded images (exact content-stream zOrder + placeholder tone sampling + exact unclamped vector clip)
        img_infos = page.get_image_info(xrefs=True)
        images = []
        for i_seq, im in enumerate(img_infos[:40]):
            x0, y0, x1, y1 = im["bbox"]
            ix, iy = round(x0 * sx, 1), round(y0 * sy, 1)
            iw, ih = round((x1 - x0) * sx, 1), round((y1 - y0) * sy, 1)
            if iw < 12 or ih < 12:
                continue
            # Match exact `fill-image` zOrder in bboxlog
            im_z = i_seq + 1
            best_dist = float("inf")
            best_iz = None
            for z_idx, lbb in img_log:
                if z_idx in used_img_z:
                    continue
                dist = abs(x0 - lbb[0]) + abs(y0 - lbb[1]) + abs(x1 - lbb[2]) + abs(y1 - lbb[3])
                if dist < best_dist:
                    best_dist = dist
                    best_iz = z_idx
            if best_iz is not None:
                used_img_z.add(best_iz)
                im_z = best_iz

            top_rgb, bot_rgb = [138, 146, 156], [74, 82, 92]
            if ref_pil is not None:
                bx0, by0 = max(0, int(ix)), max(0, int(iy))
                bx1, by1 = min(1280, int(ix + iw)), min(720, int(iy + ih))
                if bx1 - bx0 >= 8 and by1 - by0 >= 8:
                    crop = ref_pil.crop((bx0, by0, bx1, by1))
                    cw, ch = crop.size
                    t_im = crop.crop((0, 0, cw, max(1, ch // 3))).resize((1, 1)).getpixel((0, 0))
                    b_im = crop.crop((0, max(0, (2 * ch) // 3), cw, ch)).resize((1, 1)).getpixel((0, 0))
                    top_rgb = [int(t_im[0]), int(t_im[1]), int(t_im[2])]
                    bot_rgb = [int(b_im[0]), int(b_im[1]), int(b_im[2])]

            matched_clip = None
            im_area = max(1.0, iw * ih)
            for cl in clips:
                cb = cl["bbox"]
                ov_x = max(0.0, min(ix + iw, cb[0] + cb[2]) - max(ix, cb[0]))
                ov_y = max(0.0, min(iy + ih, cb[1] + cb[3]) - max(iy, cb[1]))
                if (ov_x * ov_y) / min(im_area, max(1.0, cb[2] * cb[3])) >= 0.55:
                    matched_clip = cl
                    break
            im_rec = {
                "x": ix,
                "y": iy,
                "w": iw,
                "h": ih,
                "srcW": im.get("width", 0),
                "srcH": im.get("height", 0),
                "topRgb": top_rgb,
                "botRgb": bot_rgb,
                "zOrder": int(im_z),
            }
            if matched_clip:
                im_rec["clipSvgPath"] = matched_clip["svgPath"]
                im_rec["clipViewBox"] = matched_clip["bbox"]
            images.append(im_rec)

        if len(texts) > 0 and len(drawings) >= 2:
            pdf_kind = "vector"
        elif len(texts) > 0 or len(drawings) >= 2:
            pdf_kind = "hybrid"
        else:
            pdf_kind = "raster"

        out_pages.append({
            "page": pno,
            "refName": ref_name,
            "refPath": ref_path,
            "pdfKind": pdf_kind,
            "slideBgHex": slide_bg,
            "expectedImageCount": len(images),
            "texts": texts,
            "drawings": drawings,
            "images": images,
        })

    return {"available": True, "pageCount": total_pages, "pages": out_pages}


def cmd_inspect_ref(cfg):
    from PIL import Image, ImageDraw

    ref_path = cfg["refPath"]
    out_dir = cfg["outDir"]
    crops = cfg["crops"]
    pdf_probe = cfg.get("pdfProbe")
    os.makedirs(out_dir, exist_ok=True)

    im_raw = Image.open(ref_path).convert("RGB")
    im = im_raw.resize((1280, 720), Image.Resampling.LANCZOS)

    if not crops:
        crops = [
            {"name": "top_header", "x": 0, "y": 0, "w": 1280, "h": 180},
            {"name": "left_zone", "x": 0, "y": 140, "w": 520, "h": 580},
            {"name": "center_zone", "x": 420, "y": 140, "w": 440, "h": 580},
            {"name": "right_zone", "x": 760, "y": 140, "w": 520, "h": 580},
        ]

    def measure_content_bbox(sub_rgb, bg_rgb, x0, y0):
        sw, sh = sub_rgb.size
        px = sub_rgb.load()
        min_x, min_y, max_x, max_y = sw, sh, -1, -1
        step = 2
        for y in range(0, sh, step):
            for x in range(0, sw, step):
                r, g, b = px[x, y]
                if abs(r - bg_rgb[0]) + abs(g - bg_rgb[1]) + abs(b - bg_rgb[2]) > 42:
                    if x < min_x:
                        min_x = x
                    if y < min_y:
                        min_y = y
                    if x > max_x:
                        max_x = x
                    if y > max_y:
                        max_y = y
        if max_x < min_x or max_y < min_y:
            return None
        return [x0 + min_x, y0 + min_y, max_x - min_x + step, max_y - min_y + step]

    grid_im = im.convert("RGBA")
    overlay = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for gx in range(100, 1280, 100):
        draw.line([(gx, 0), (gx, 720)], fill=(37, 99, 235, 110), width=1)
        draw.rectangle([gx + 2, 2, gx + 36, 16], fill=(15, 23, 42, 185))
        draw.text((gx + 4, 3), str(gx), fill=(255, 255, 255, 240))
    for gy in range(100, 720, 100):
        draw.line([(0, gy), (1280, gy)], fill=(37, 99, 235, 110), width=1)
        draw.rectangle([2, gy + 2, 34, gy + 16], fill=(15, 23, 42, 185))
        draw.text((4, gy + 3), str(gy), fill=(255, 255, 255, 240))
    draw.rectangle([0, 694, 540, 720], fill=(15, 23, 42, 200))
    draw.text(
        (10, 700),
        "1280x720 GRID | OOXML rotation: +deg = CW right-lean (\\), -deg = CCW left-lean (/)",
        fill=(250, 204, 21, 255),
    )
    grid_out = os.path.join(out_dir, "ref_grid_1280x720.png")
    Image.alpha_composite(grid_im, overlay).convert("RGB").save(grid_out, quality=92)

    corner_px = [im.getpixel((8, 8)), im.getpixel((1271, 8)), im.getpixel((8, 711)), im.getpixel((1271, 711))]
    slide_bg = median_rgb(corner_px)

    results = []
    for c in crops:
        x0 = max(0, min(1279, c["x"]))
        y0 = max(0, min(719, c["y"]))
        x1 = max(x0 + 1, min(1280, c["x"] + c["w"]))
        y1 = max(y0 + 1, min(720, c["y"] + c["h"]))
        sub = im.crop((x0, y0, x1, y1))
        sw, sh = sub.size
        out_png = os.path.join(out_dir, f"ref_{c['name']}_2x.png")
        sub.resize((sw * 2, sh * 2), Image.Resampling.LANCZOS).save(out_png)

        px = list(sub.getdata())
        top_px = list(sub.crop((0, 0, sw, max(1, int(sh * 0.18)))).getdata())
        mid_px = list(sub.crop((0, int(sh * 0.4), sw, max(int(sh * 0.4) + 1, int(sh * 0.6)))).getdata())
        bot_px = list(sub.crop((0, int(sh * 0.82), sw, sh)).getdata())

        non_white = [p for p in px if (p[0] + p[1] + p[2]) < 700]
        non_white.sort(key=lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
        darkest = non_white[min(len(non_white) - 1, max(0, int(len(non_white) * 0.05)))] if non_white else (30, 30, 30)

        q = sub.quantize(colors=6, method=Image.Quantize.MEDIANCUT).convert("RGB")
        counts = sorted(q.getcolors(maxcolors=32) or [], reverse=True)[:5]
        total = float(sw * sh)
        dom = [{"hex": rgb_to_hex(col), "pct": round(cnt * 100.0 / total, 1)} for cnt, col in counts]
        tilt = measure_tilt(sub, min_angle=3, min_share=0.09, min_val=28000.0, max_side=440.0, mag_thresh=140.0)
        cbbox = measure_content_bbox(sub, slide_bg, x0, y0)

        results.append({
            "name": c["name"],
            "box": [x0, y0, x1 - x0, y1 - y0],
            "contentBbox": cbbox,
            "dominantTiltDeg": tilt["dominantTiltDeg"],
            "tiltDirection": tilt["tiltDirection"],
            "tiltConfidence": tilt["tiltConfidence"],
            "cropPng2x": out_png,
            "topHex": rgb_to_hex(median_rgb(top_px)),
            "midHex": rgb_to_hex(median_rgb(mid_px)),
            "bottomHex": rgb_to_hex(median_rgb(bot_px)),
            "darkestInkHex": rgb_to_hex(darkest),
            "dominantColors": dom,
        })

    spec = {
        "refPng": ref_path,
        "gridOverlayPng": grid_out,
        "sourceSize": list(im_raw.size),
        "normalizedCanvas": [1280, 720],
        "estimatedBackgroundHex": rgb_to_hex(slide_bg),
        "rotationConvention": "+deg = clockwise (top leans right), -deg = counter-clockwise (top leans left)",
        "pdfProbe": pdf_probe,
        "crops": results,
    }
    spec_path = os.path.join(out_dir, "ref_layout_spec.json")
    with open(spec_path, "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
    spec["layoutSpecJson"] = spec_path
    return spec


def cmd_diff(cfg):
    from PIL import Image, ImageChops

    ref_path = cfg["refPath"]
    gen_path = cfg["genPath"]
    out_dir = cfg["outDir"]
    crops = list(cfg["crops"] or [])
    auto_crops = cfg.get("autoCrops", True)
    os.makedirs(out_dir, exist_ok=True)

    ref = Image.open(ref_path).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS)
    gen = Image.open(gen_path).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS)

    def calc_similarity(a, b):
        diff = ImageChops.difference(a, b)
        hist = diff.histogram()
        total_px = a.size[0] * a.size[1] * 3
        err_sum = 0
        for ch in range(3):
            base = ch * 256
            for v in range(256):
                err_sum += v * hist[base + v]
        mae = err_sum / float(total_px)
        return round(mae, 2), round(max(0.0, 100.0 - mae / 2.55), 2)

    full_mae, full_sim = calc_similarity(ref, gen)

    if not crops and auto_crops:
        diff_gray = ImageChops.difference(ref, gen).convert("L")
        grid_w, grid_h = 320, 240
        cells = []
        for gy in range(0, 720, grid_h):
            for gx in range(0, 1280, grid_w):
                sub = diff_gray.crop((gx, gy, min(1280, gx + grid_w), min(720, gy + grid_h)))
                h = sub.histogram()
                tot = max(1, sub.size[0] * sub.size[1])
                mean_err = sum(i * h[i] for i in range(256)) / float(tot)
                cells.append((mean_err, gx, gy, sub.size[0], sub.size[1]))
        cells.sort(reverse=True)
        for idx, (err, gx, gy, gw, gh) in enumerate(cells[:2]):
            if err >= 2.0:
                crops.append({"name": f"hotspot_{idx + 1}", "x": gx, "y": gy, "w": gw, "h": gh})

    tw, th = 1000, 562
    sbs = Image.new("RGB", (tw * 2 + 64, th + 40), (241, 245, 249))
    sbs.paste(ref.resize((tw, th), Image.Resampling.LANCZOS), (20, 20))
    sbs.paste(gen.resize((tw, th), Image.Resampling.LANCZOS), (tw + 44, 20))
    sbs_path = os.path.join(out_dir, "side_by_side.png")
    sbs.save(sbs_path, quality=92)

    w3, h3 = 800, 450
    r3 = ref.resize((w3, h3), Image.Resampling.LANCZOS)
    g3 = gen.resize((w3, h3), Image.Resampling.LANCZOS)
    ov3 = Image.blend(r3, g3, alpha=0.5)
    p3 = Image.new("RGB", (w3 * 3 + 48, h3 + 32), (241, 245, 249))
    p3.paste(r3, (12, 16))
    p3.paste(ov3, (w3 + 24, 16))
    p3.paste(g3, (w3 * 2 + 36, 16))
    ov_path = os.path.join(out_dir, "overlay_3panel.png")
    p3.save(ov_path, quality=92)

    zoom_out = []
    for c in crops:
        x0 = max(0, min(1279, c["x"]))
        y0 = max(0, min(719, c["y"]))
        x1 = max(x0 + 1, min(1280, c["x"] + c["w"]))
        y1 = max(y0 + 1, min(720, c["y"] + c["h"]))
        rc = ref.crop((x0, y0, x1, y1))
        gc = gen.crop((x0, y0, x1, y1))
        c_mae, c_sim = calc_similarity(rc, gc)
        zw, zh = rc.size[0] * 2, rc.size[1] * 2
        pair = Image.new("RGB", (zw * 2 + 36, zh + 24), (241, 245, 249))
        pair.paste(rc.resize((zw, zh), Image.Resampling.LANCZOS), (12, 12))
        pair.paste(gc.resize((zw, zh), Image.Resampling.LANCZOS), (zw + 24, 12))
        zp = os.path.join(out_dir, f"zoom_{c['name']}_2x.png")
        pair.save(zp, quality=92)
        zoom_out.append({
            "name": c["name"],
            "box": [x0, y0, x1 - x0, y1 - y0],
            "mae": c_mae,
            "similarityPct": c_sim,
            "zoomPng2x": zp,
        })

    return {
        "fullMae": full_mae,
        "fullSimilarityPct": full_sim,
        "sideBySidePng": sbs_path,
        "overlay3PanelPng": ov_path,
        "zoomCrops": zoom_out,
    }


def cmd_contact_sheet(cfg):
    from PIL import Image

    pngs = cfg["pngs"]
    out_png = cfg["outPng"]
    os.makedirs(os.path.dirname(os.path.abspath(out_png)), exist_ok=True)
    n = len(pngs)
    cols = 1 if n == 1 else (2 if n <= 4 else 3)
    rows = max(1, math.ceil(n / cols))
    tw, th = (1280, 720) if n == 1 else (800, 450)
    gap = 20
    canvas = Image.new("RGB", (cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap), (15, 23, 42))
    for idx, p in enumerate(pngs):
        r, c = divmod(idx, cols)
        im = Image.open(p).convert("RGB").resize((tw, th), Image.Resampling.LANCZOS)
        canvas.paste(im, (gap + c * (tw + gap), gap + r * (th + gap)))
    canvas.save(out_png, quality=92)
    return {"qaSheetPng": out_png, "slideCount": n, "grid": [rows, cols]}


def cmd_multi_compare(cfg):
    from PIL import Image, ImageChops, ImageStat

    refs = cfg["refs"]
    gens = cfg["gens"]
    out_dir = cfg["outDir"]
    batch_size = int(cfg.get("batchSize", 4))
    xray_mode = cfg.get("xrayMode", "flagged")
    pairs_dir = os.path.join(out_dir, "compare_pairs")
    os.makedirs(pairs_dir, exist_ok=True)

    pair_items = []
    angle_mismatches = []
    n = min(len(refs), len(gens))
    pw, ph = 960, 540
    gap = 14

    for i in range(n):
        ri = Image.open(refs[i]).convert("RGB").resize((pw, ph), Image.Resampling.LANCZOS)
        gi = Image.open(gens[i]).convert("RGB").resize((pw, ph), Image.Resampling.LANCZOS)
        diff = ImageChops.difference(ri, gi)
        mae = sum(ImageStat.Stat(diff).mean) / 3.0
        sim = round(max(0.0, 100.0 * (1.0 - mae / 255.0)), 1)
        edge_sim = calc_edge_similarity(ri, gi)
        ref_photo_pct = measure_photo_tile_pct(ri)

        slide_angle_issues = []
        for zname, zbox in [("left_zone", (0, 70, pw // 2, ph)), ("right_zone", (pw // 2, 70, pw, ph))]:
            ref_t = measure_tilt(ri.crop(zbox), min_angle=4, min_share=0.10, min_val=22000.0, mag_thresh=150.0, square_size=260)
            ref_deg = ref_t["dominantTiltDeg"]
            if abs(ref_deg) >= 4:
                # Schmitt hysteresis threshold (0.06) prevents knife-edge cliff snap-to-zero when gen matches ref angle
                gen_t = measure_tilt(gi.crop(zbox), min_angle=4, min_share=0.06, min_val=18000.0, mag_thresh=150.0, square_size=260)
                gen_deg = gen_t["dominantTiltDeg"]
                delta = abs(ref_deg - gen_deg)
                if delta >= 5:
                    rec = {
                        "slide": i + 1,
                        "refName": os.path.basename(refs[i]),
                        "zone": zname,
                        "refDeg": ref_deg,
                        "genDeg": gen_deg,
                        "deltaDeg": delta,
                        "signFlipped": (ref_deg * gen_deg) < 0,
                    }
                    slide_angle_issues.append(rec)
                    angle_mismatches.append(rec)

        pair = Image.new("RGB", (pw * 2 + gap * 3, ph + gap * 2), (15, 23, 42))
        pair.paste(ri, (gap, gap))
        pair.paste(gi, (pw + gap * 2, gap))
        out_jpg = os.path.join(pairs_dir, f"pair_{i + 1:02d}.jpg")
        pair.save(out_jpg, format="JPEG", quality=88, optimize=True)

        xray_jpg = None
        if xray_mode == "all":
            xw, xh = 640, 360
            rx = ri.resize((xw, xh), Image.Resampling.LANCZOS)
            gx = gi.resize((xw, xh), Image.Resampling.LANCZOS)
            ov = Image.blend(rx, gx, alpha=0.5)
            xp = Image.new("RGB", (xw * 3 + 32, xh + 20), (15, 23, 42))
            xp.paste(rx, (8, 10))
            xp.paste(ov, (xw + 16, 10))
            xp.paste(gx, (xw * 2 + 24, 10))
            xray_jpg = os.path.join(pairs_dir, f"xray_{i + 1:02d}.jpg")
            xp.save(xray_jpg, format="JPEG", quality=90, optimize=True)

        pair_items.append({
            "slide": i + 1,
            "refName": os.path.basename(refs[i]),
            "genName": os.path.basename(gens[i]),
            "similarityPct": sim,
            "edgeSimilarityPct": edge_sim,
            "refPhotoTilePct": ref_photo_pct,
            "mae": round(mae, 2),
            "angleIssues": slide_angle_issues if slide_angle_issues else None,
            "pairJpg": out_jpg,
            "xrayJpg": xray_jpg,
        })

    batches = []
    bw, bh = 960, 540
    for b_idx in range(0, n, batch_size):
        chunk = pair_items[b_idx : b_idx + batch_size]
        sheet = Image.new("RGB", (bw * 2 + 24, len(chunk) * (bh + 12) + 12), (15, 23, 42))
        for r, item in enumerate(chunk):
            ri = Image.open(refs[item["slide"] - 1]).convert("RGB").resize((bw, bh), Image.Resampling.LANCZOS)
            gi = Image.open(gens[item["slide"] - 1]).convert("RGB").resize((bw, bh), Image.Resampling.LANCZOS)
            y = 12 + r * (bh + 12)
            sheet.paste(ri, (8, y))
            sheet.paste(gi, (bw + 16, y))
        bp = os.path.join(out_dir, f"compare_batch_{len(batches) + 1}.jpg")
        sheet.save(bp, format="JPEG", quality=90, optimize=True)
        batches.append({
            "batch": len(batches) + 1,
            "slides": f"P{chunk[0]['slide']}-P{chunk[-1]['slide']}",
            "path": bp,
        })

    xray_batches = []
    if xray_mode == "all":
        xray_targets = pair_items
    elif xray_mode == "flagged":
        flagged_slides = {m["slide"] for m in angle_mismatches}
        for it in sorted(pair_items, key=lambda x: x["edgeSimilarityPct"])[:4]:
            flagged_slides.add(it["slide"])
        xray_targets = [it for it in pair_items if it["slide"] in flagged_slides]
    else:
        xray_targets = []

    xw, xh = 640, 360
    for xb_idx in range(0, len(xray_targets), batch_size):
        chunk = xray_targets[xb_idx : xb_idx + batch_size]
        xsheet = Image.new("RGB", (xw * 3 + 32, len(chunk) * (xh + 12) + 12), (15, 23, 42))
        for r, item in enumerate(chunk):
            ri = Image.open(refs[item["slide"] - 1]).convert("RGB").resize((xw, xh), Image.Resampling.LANCZOS)
            gi = Image.open(gens[item["slide"] - 1]).convert("RGB").resize((xw, xh), Image.Resampling.LANCZOS)
            ov = Image.blend(ri, gi, alpha=0.5)
            y = 12 + r * (xh + 12)
            xsheet.paste(ri, (8, y))
            xsheet.paste(ov, (xw + 16, y))
            xsheet.paste(gi, (xw * 2 + 24, y))
        xbp = os.path.join(out_dir, f"xray_batch_{len(xray_batches) + 1}.jpg")
        xsheet.save(xbp, format="JPEG", quality=90, optimize=True)
        xray_batches.append({
            "batch": len(xray_batches) + 1,
            "slides": [c["slide"] for c in chunk],
            "path": xbp,
        })

    return {
        "pairs": pair_items,
        "compareBatches": batches,
        "xrayBatches": xray_batches,
        "angleMismatches": angle_mismatches,
    }


def cmd_build_pdf(cfg):
    from PIL import Image, ImageDraw, ImageFont

    pages = cfg["pages"]
    out_pdf = cfg["outPdf"]
    os.makedirs(os.path.dirname(os.path.abspath(out_pdf)), exist_ok=True)

    def load_font(size):
        for fp in [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            r"C:\Windows\Fonts\msyh.ttc",
            r"C:\Windows\Fonts\msyh.ttf",
            r"C:\Windows\Fonts\simhei.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]:
            if os.path.exists(fp):
                try:
                    return ImageFont.truetype(fp, size)
                except Exception:
                    pass
        return ImageFont.load_default()

    font = load_font(22)
    pdf_imgs = []
    for item in pages:
        im = Image.open(item["imgPath"]).convert("RGB")
        target_w = 1600
        if im.width != target_w:
            im = im.resize((target_w, max(1, int(im.height * target_w / im.width))), Image.Resampling.LANCZOS)
        header_h = 54
        pad = 16
        page = Image.new("RGB", (target_w + pad * 2, im.height + header_h + pad), (15, 23, 42))
        draw = ImageDraw.Draw(page)
        draw.text((pad + 6, 14), item.get("label", ""), fill=(248, 250, 252), font=font)
        page.paste(im, (pad, header_h))
        pdf_imgs.append(page)

    if pdf_imgs:
        pdf_imgs[0].save(
            out_pdf,
            format="PDF",
            resolution=144.0,
            save_all=True,
            append_images=pdf_imgs[1:],
        )
    return {
        "comparePdf": out_pdf,
        "pages": len(pdf_imgs),
        "kb": round(os.path.getsize(out_pdf) / 1024, 1) if os.path.exists(out_pdf) else 0,
    }


COMMANDS = {
    "render-pdf-page": cmd_render_pdf_page,
    "pdf-probe": cmd_pdf_probe,
    "pdf-extract-master": cmd_pdf_extract_master,
    "inspect-ref": cmd_inspect_ref,
    "diff": cmd_diff,
    "contact-sheet": cmd_contact_sheet,
    "multi-compare": cmd_multi_compare,
    "build-pdf": cmd_build_pdf,
}


def main():
    cmd, cfg = load_cfg()
    fn = COMMANDS.get(cmd)
    if not fn:
        raise SystemExit(f"Unknown vision_kernel subcommand: {cmd}")
    res = fn(cfg)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
