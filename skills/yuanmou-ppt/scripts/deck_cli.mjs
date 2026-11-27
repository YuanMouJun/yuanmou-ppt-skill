#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Deck Engineering CLI: Verify (One-Shot QA), Inspect-Ref (PNG/JPG/PDF), Diff (Auto-Crops), Render, Finalize & Surgery

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  KIT_VERSION,
  inspectTemplateDeck,
  validateTemplatePlan,
  prepareStarterDeck,
  auditTemplateFidelity,
  assembleDeck,
  auditMasterSlotIntegrity,
  validateDeckBuffer,
  finalizeDeck,
  archivePreviousDeliveredFile,
  renderDeckToPngs,
  buildShowcaseGalleryHtml,
  discoverRenderToolchain,
  createBrushPng,
  applyAlphaMaskToImage,
  checkSkillUpdate,
  selfUpdateSkill,
} from "../packages/pptx-kit/index.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INSTALL_RENDER_HINT = [
  "macOS:   brew install --cask libreoffice && brew install poppler",
  "Ubuntu:  sudo apt update && sudo apt install -y libreoffice poppler-utils",
  "Windows: winget install TheDocumentFoundation.LibreOffice (并安装 poppler 加入 PATH 或 pip install pypdfium2 pillow)",
].join("\n  • ");

function inspectRenderDeps() {
  const toolchain = discoverRenderToolchain();
  const missing = [];
  if (!toolchain.soffice) missing.push("LibreOffice (soffice)");
  if (!toolchain.pdftoppm && !toolchain.hasPypdfium2) missing.push("Poppler (pdftoppm) 或 pypdfium2");
  const canRender = Boolean(toolchain.soffice && (toolchain.pdftoppm || toolchain.hasPypdfium2));
  return { toolchain, missing, canRender, installHint: INSTALL_RENDER_HINT };
}

function assertRenderDeps(depInfo = inspectRenderDeps()) {
  if (!depInfo.canRender) {
    throw new Error(
      `[ENV GATE BLOCKED] 缺少视觉渲染依赖：${depInfo.missing.join("、")}。\n` +
        `请先安装以下环境后再执行真机渲染：\n  • ${depInfo.installHint}`
    );
  }
  return depInfo.toolchain;
}

async function sha256File(filePath) {
  const buf = await fs.readFile(path.resolve(filePath));
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * If `inputPath` is a `.pdf`, renders `pageNo` (1-based) to PNG via `pdftoppm` (with `pypdfium2` / `fitz` fallback).
 */
async function ensureReferenceImagePath(inputPath, outDir, pageNo = 1, toolchain = discoverRenderToolchain()) {
  const abs = path.resolve(inputPath);
  if (!existsSync(abs)) {
    throw new Error(`Reference file not found: ${abs}`);
  }
  if (path.extname(abs).toLowerCase() !== ".pdf") {
    return abs;
  }
  await fs.mkdir(outDir, { recursive: true });
  const prefix = path.join(outDir, `pdf_p${pageNo}`);
  const outPng = `${prefix}.png`;
  if (toolchain.pdftoppm) {
    const res = spawnSync(
      toolchain.pdftoppm,
      ["-png", "-r", "220", "-f", String(pageNo), "-l", String(pageNo), "-singlefile", abs, prefix],
      { encoding: "utf8" }
    );
    if (res.status === 0 && existsSync(outPng)) return outPng;
  }
  if (toolchain.python3) {
    const pyPdf = `
import sys
pdf_path, out_png, page_no = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf_path)
    doc[page_no - 1].render(scale=220.0 / 72.0).to_pil().save(out_png)
except Exception:
    import fitz
    doc = fitz.open(pdf_path)
    doc[page_no - 1].get_pixmap(dpi=220).save(out_png)
`;
    const pyRes = spawnSync(toolchain.python3, ["-c", pyPdf, abs, outPng, String(pageNo)], { encoding: "utf8" });
    if (pyRes.status === 0 && existsSync(outPng)) return outPng;
  }
  throw new Error(
    `Failed to render PDF page ${pageNo}: neither Poppler (pdftoppm) nor Python (pypdfium2 / pymupdf) is available. Convert PDF page to PNG or install Poppler.`
  );
}

function runPythonVision(pyCode, argsJson, pythonBin) {
  const py = pythonBin || discoverRenderToolchain().python3 || (process.platform === "win32" ? "python" : "python3");
  const res = spawnSync(py, ["-c", pyCode, JSON.stringify(argsJson)], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `Python/Pillow vision helper failed (install Pillow via \`pip install pillow\` if missing):\n${res.stderr || res.stdout}`
    );
  }
  return JSON.parse(res.stdout.trim());
}

function parseStrokeSpecs(raw) {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  // Semicolon-separated `x1,y1,x2,y2[,width[,fray]]`
  return trimmed
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const nums = entry.split(",").map((v) => Number(v.trim()));
      if (nums.length < 4 || nums.some((v) => !Number.isFinite(v))) {
        throw new Error(`Invalid --strokes entry "${entry}". Expected "x1,y1,x2,y2[,width]" or JSON array.`);
      }
      return {
        from: [nums[0], nums[1]],
        to: [nums[2], nums[3]],
        ...(nums[4] !== undefined ? { width: nums[4] } : {}),
        ...(nums[5] !== undefined ? { fray: nums[5] } : {}),
      };
    });
}

function parseCropSpecs(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      let name = `zone${idx + 1}`;
      let coordsStr = entry;
      if (entry.includes(":")) {
        const [n, c] = entry.split(":");
        name = n.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || name;
        coordsStr = c.trim();
      }
      const nums = coordsStr.split(",").map((v) => Number(v.trim()));
      if (nums.length !== 4 || nums.some((v) => !Number.isFinite(v))) {
        throw new Error(`Invalid crop spec "${entry}". Expected "name:x,y,w,h" on 1280x720 canvas.`);
      }
      return { name, x: Math.round(nums[0]), y: Math.round(nums[1]), w: Math.round(nums[2]), h: Math.round(nums[3]) };
    });
}

const PY_PDF_PROBE = `
import json, sys

cfg = json.loads(sys.argv[1])
pdf_path = cfg["pdfPath"]
page_no = int(cfg.get("pageNo", 1))

try:
    import fitz
except Exception:
    print(json.dumps({"available": False, "pdfKind": "unknown", "reason": "PyMuPDF not installed"}))
    sys.exit(0)

doc = fitz.open(pdf_path)
if page_no < 1 or page_no > len(doc):
    print(json.dumps({"available": True, "pageCount": len(doc), "error": f"Page {page_no} out of range 1..{len(doc)}"}))
    sys.exit(0)

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
    joined = "\\n".join(lines_txt).strip()
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
    fill = dr.get("fill")
    stroke = dr.get("color")
    to_hex = lambda c: "#{:02X}{:02X}{:02X}".format(int(c[0]*255), int(c[1]*255), int(c[2]*255)) if isinstance(c, (list, tuple)) and len(c) >= 3 else None
    drawing_items.append({
        "bbox": [round(r.x0 * sx, 1), round(r.y0 * sy, 1), round(w, 1), round(h, 1)],
        "fill": to_hex(fill),
        "stroke": to_hex(stroke),
    })

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

print(json.dumps({
    "available": True,
    "pageCount": len(doc),
    "pageNo": page_no,
    "pdfSize": [round(pw, 1), round(ph, 1)],
    "pdfKind": kind,
    "textBlockCount": len(text_items),
    "drawingCount": len(drawings),
    "imageCount": len(img_infos),
    "vectorObjects": {
        "texts": text_items[:60],
        "drawings": drawing_items[:60],
        "images": image_items[:30],
    } if kind != "raster" else None,
}, ensure_ascii=False))
`;

const PY_INSPECT_REF = `
import json, math, os, sys
from PIL import Image, ImageDraw

cfg = json.loads(sys.argv[1])
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

def measure_dominant_tilt(sub_rgb):
    # Downscale moderately for fast, noise-resistant Sobel angle histogram
    w, h = sub_rgb.size
    scale = min(1.0, 440.0 / max(1, max(w, h)))
    gw, gh = max(24, int(w * scale)), max(24, int(h * scale))
    gray = sub_rgb.resize((gw, gh), Image.Resampling.BILINEAR).convert("L")
    px = gray.load()
    bins = {}
    total_mag = 0.0
    tilt_mag = 0.0
    for y in range(2, gh - 2):
        for x in range(2, gw - 2):
            gx = (px[x+1, y-1] + 2*px[x+1, y] + px[x+1, y+1]) - (px[x-1, y-1] + 2*px[x-1, y] + px[x-1, y+1])
            gy = (px[x-1, y+1] + 2*px[x, y+1] + px[x+1, y+1]) - (px[x-1, y-1] + 2*px[x, y-1] + px[x+1, y-1])
            mag = math.hypot(gx, gy)
            if mag < 140.0:
                continue
            # OOXML sign convention: +deg = clockwise (top leans right \\), -deg = counter-clockwise (top leans left /)
            rel = ((math.degrees(math.atan2(gy, gx)) + 45.0) % 90.0) - 45.0
            b = int(round(rel))
            bins[b] = bins.get(b, 0.0) + mag
            total_mag += mag
            if abs(b) >= 3 and abs(b) <= 42:
                tilt_mag += mag
    if total_mag < 1e-3:
        return {"dominantTiltDeg": 0, "tiltDirection": "upright", "tiltConfidence": 0.0}
    # Check non-orthogonal peak first (detects tilted cards/phones inside horizontal/vertical frame!)
    non_ortho = [(ang, sum(bins.get(ang + d, 0.0) for d in (-1, 0, 1))) for ang in range(-40, 41) if abs(ang) >= 3]
    best_tilt_ang, best_tilt_val = max(non_ortho, key=lambda kv: kv[1])
    tilt_share = best_tilt_val / max(1.0, total_mag)
    if tilt_share >= 0.09 and best_tilt_val >= 28000.0:
        direction = "clockwise" if best_tilt_ang > 0 else "counterclockwise"
        return {
            "dominantTiltDeg": int(best_tilt_ang),
            "tiltDirection": direction,
            "tiltConfidence": round(min(1.0, tilt_share * 2.5), 2),
        }
    return {"dominantTiltDeg": 0, "tiltDirection": "upright", "tiltConfidence": round(tilt_share, 2)}

def measure_content_bbox(sub_rgb, bg_rgb, x0, y0):
    sw, sh = sub_rgb.size
    px = sub_rgb.load()
    min_x, min_y, max_x, max_y = sw, sh, -1, -1
    step = 2
    for y in range(0, sh, step):
        for x in range(0, sw, step):
            r, g, b = px[x, y]
            if abs(r - bg_rgb[0]) + abs(g - bg_rgb[1]) + abs(b - bg_rgb[2]) > 42:
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y
    if max_x < min_x or max_y < min_y:
        return None
    return [x0 + min_x, y0 + min_y, max_x - min_x + step, max_y - min_y + step]

# 1) Generate 1280x720 coordinate grid ruler image + rotation sign legend
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
draw.text((10, 700), "1280x720 GRID | OOXML rotation: +deg = CW right-lean (\\\\), -deg = CCW left-lean (/)", fill=(250, 204, 21, 255))
grid_out = os.path.join(out_dir, "ref_grid_1280x720.png")
Image.alpha_composite(grid_im, overlay).convert("RGB").save(grid_out, quality=92)

# Estimate overall slide background color from corners
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
    zoom = sub.resize((sw * 2, sh * 2), Image.Resampling.LANCZOS)
    out_png = os.path.join(out_dir, f"ref_{c['name']}_2x.png")
    zoom.save(out_png)

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
    tilt = measure_dominant_tilt(sub)
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
print(json.dumps(spec, ensure_ascii=False))
`;

const PY_DIFF = `
import json, os, sys
from PIL import Image, ImageChops

cfg = json.loads(sys.argv[1])
ref_path = cfg["refPath"]
gen_path = cfg["genPath"]
out_dir = cfg["outDir"]
crops = cfg["crops"]
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

# Auto-detect Top 2 highest-error hotspot regions when explicit crops are omitted
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
            crops.append({"name": f"hotspot_{idx+1}", "x": gx, "y": gy, "w": gw, "h": gh})

# 1) Side-by-side (Left: Ref, Right: Gen)
tw, th = 1000, 562
sbs = Image.new("RGB", (tw * 2 + 64, th + 40), (241, 245, 249))
sbs.paste(ref.resize((tw, th), Image.Resampling.LANCZOS), (20, 20))
sbs.paste(gen.resize((tw, th), Image.Resampling.LANCZOS), (tw + 44, 20))
sbs_path = os.path.join(out_dir, "side_by_side.png")
sbs.save(sbs_path, quality=92)

# 2) 3-panel 50% X-Ray Overlay (Left: Ref, Mid: 50% Blend, Right: Gen)
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

# 3) 2x Zoomed Local Comparison Crops
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

print(json.dumps({
    "fullMae": full_mae,
    "fullSimilarityPct": full_sim,
    "sideBySidePng": sbs_path,
    "overlay3PanelPng": ov_path,
    "zoomCrops": zoom_out,
}, ensure_ascii=False))
`;

const PY_CONTACT_SHEET = `
import json, math, os, sys
from PIL import Image

cfg = json.loads(sys.argv[1])
pngs = cfg["pngs"]
out_png = cfg["outPng"]
os.makedirs(os.path.dirname(out_png), exist_ok=True)

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
print(json.dumps({"qaSheetPng": out_png, "slideCount": n, "grid": [rows, cols]}))
`;

const PY_MULTI_COMPARE = `
import json, math, os, sys
from PIL import Image, ImageChops, ImageFilter, ImageStat

cfg = json.loads(sys.argv[1])
refs = cfg["refs"]
gens = cfg["gens"]
out_dir = cfg["outDir"]
batch_size = int(cfg.get("batchSize", 4))
xray_mode = cfg.get("xrayMode", "flagged")  # "all" | "flagged" | "none"
pairs_dir = os.path.join(out_dir, "compare_pairs")
os.makedirs(pairs_dir, exist_ok=True)

def calc_edge_similarity(ri, gi):
    # Resize to 320x180 grayscale and compare edge maps (immune to identical white/cream background inflation!)
    re = ri.resize((320, 180), Image.Resampling.BILINEAR).convert("L").filter(ImageFilter.FIND_EDGES)
    ge = gi.resize((320, 180), Image.Resampling.BILINEAR).convert("L").filter(ImageFilter.FIND_EDGES)
    rp = list(re.getdata())
    gp = list(ge.getdata())
    inter = 0.0
    union = 0.0
    for a, b in zip(rp, gp):
        if a > 28 or b > 28:
            inter += min(a, b)
            union += max(a, b)
    if union < 1e-3:
        return 100.0
    return round(min(100.0, 100.0 * inter / union), 1)

def measure_zone_tilt(im_rgb, box):
    sub = im_rgb.crop(box)
    gw, gh = 260, 260
    gray = sub.resize((gw, gh), Image.Resampling.BILINEAR).convert("L")
    px = gray.load()
    bins = {}
    total_mag = 0.0
    for y in range(2, gh - 2):
        for x in range(2, gw - 2):
            gx = (px[x+1, y-1] + 2*px[x+1, y] + px[x+1, y+1]) - (px[x-1, y-1] + 2*px[x-1, y] + px[x-1, y+1])
            gy = (px[x-1, y+1] + 2*px[x, y+1] + px[x+1, y+1]) - (px[x-1, y-1] + 2*px[x, y-1] + px[x+1, y-1])
            mag = math.hypot(gx, gy)
            if mag < 150.0:
                continue
            rel = ((math.degrees(math.atan2(gy, gx)) + 45.0) % 90.0) - 45.0
            b = int(round(rel))
            bins[b] = bins.get(b, 0.0) + mag
            total_mag += mag
    if total_mag < 1e-3:
        return 0, 0.0
    non_ortho = [(ang, sum(bins.get(ang + d, 0.0) for d in (-1, 0, 1))) for ang in range(-40, 41) if abs(ang) >= 4]
    best_ang, best_val = max(non_ortho, key=lambda kv: kv[1])
    share = best_val / max(1.0, total_mag)
    if share >= 0.10 and best_val >= 22000.0:
        return int(best_ang), round(share, 3)
    return 0, round(share, 3)

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

    # Check left & right half dominant tilt angles (catches reversed phone/card rotation immediately!)
    slide_angle_issues = []
    for zname, zbox in [("left_zone", (0, 70, pw // 2, ph)), ("right_zone", (pw // 2, 70, pw, ph))]:
        ref_deg, ref_sh = measure_zone_tilt(ri, zbox)
        if abs(ref_deg) >= 4:
            gen_deg, gen_sh = measure_zone_tilt(gi, zbox)
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
    out_jpg = os.path.join(pairs_dir, f"pair_{i+1:02d}.jpg")
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
        xray_jpg = os.path.join(pairs_dir, f"xray_{i+1:02d}.jpg")
        xp.save(xray_jpg, format="JPEG", quality=90, optimize=True)

    pair_items.append({
        "slide": i + 1,
        "refName": os.path.basename(refs[i]),
        "genName": os.path.basename(gens[i]),
        "similarityPct": sim,
        "edgeSimilarityPct": edge_sim,
        "mae": round(mae, 2),
        "angleIssues": slide_angle_issues if slide_angle_issues else None,
        "pairJpg": out_jpg,
        "xrayJpg": xray_jpg,
    })

batches = []
bw, bh = 960, 540
for b_idx in range(0, n, batch_size):
    chunk = pair_items[b_idx:b_idx + batch_size]
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

# Build 50% X-Ray Overlay batches ("all" for verify-master, or "flagged" for worst-edge / angle-mismatched pages!)
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
    chunk = xray_targets[xb_idx:xb_idx + batch_size]
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

print(json.dumps({
    "pairs": pair_items,
    "compareBatches": batches,
    "xrayBatches": xray_batches,
    "angleMismatches": angle_mismatches,
}, ensure_ascii=False))
`;

const PY_BUILD_PDF = `
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

cfg = json.loads(sys.argv[1])
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
print(json.dumps({"comparePdf": out_pdf, "pages": len(pdf_imgs), "kb": round(os.path.getsize(out_pdf) / 1024, 1) if os.path.exists(out_pdf) else 0}))
`;

function numericSortPaths(paths) {
  const key = (p) => {
    const m = path.basename(p, path.extname(p)).match(/\d+/g);
    return m ? Number.parseInt(m[m.length - 1], 10) : 0;
  };
  return [...paths].sort((a, b) => key(a) - key(b) || path.basename(a).localeCompare(path.basename(b)));
}

async function main() {
  // Normalize `--flag -12` negative numbers into `--flag=-12` so Node's parseArgs accepts negative angles/values naturally
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const cur = rawArgs[i];
    const next = rawArgs[i + 1];
    if (cur.startsWith("--") && !cur.includes("=") && next !== undefined && /^-\d+(\.\d+)?$/.test(next)) {
      normalizedArgs.push(`${cur}=${next}`);
      i++;
    } else {
      normalizedArgs.push(cur);
    }
  }

  const { values, positionals } = parseArgs({
    args: normalizedArgs,
    allowPositionals: true,
    options: {
      pptx: { type: "string" },
      final: { type: "string" },
      source: { type: "string" },
      "readonly-source": { type: "string" },
      "source-sha256": { type: "string" },
      map: { type: "string" },
      plan: { type: "string" },
      master: { type: "string" },
      "master-map": { type: "string" },
      "no-preserve-history": { type: "boolean" },
      out: { type: "string" },
      dpi: { type: "string" },
      page: { type: "string" },
      "anti-slop": { type: "string" },
      "font-policy": { type: "string" },
      "allow-full-bg-pic": { type: "boolean" },
      "require-render": { type: "boolean" },
      ref: { type: "string" },
      "ref-dir": { type: "string" },
      gen: { type: "string" },
      crops: { type: "string" },
      pdf: { type: "string" },
      gallery: { type: "string" },
      title: { type: "string" },
      preset: { type: "string" },
      strokes: { type: "string" },
      color: { type: "string" },
      opacity: { type: "string" },
      width: { type: "string" },
      height: { type: "string" },
      angle: { type: "string" },
      seed: { type: "string" },
      image: { type: "string" },
      mask: { type: "string" },
      "ref-crop": { type: "string" },
      "bg-color": { type: "string" },
      tolerance: { type: "string" },
      feather: { type: "string" },
      "left-depth": { type: "string" },
      "right-depth": { type: "string" },
      "flip-y": { type: "boolean" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      "no-update-check": { type: "boolean" },
    },
  });

  const cmd = positionals[0];

  if (cmd === "make-brush") {
    if (!values.out) {
      throw new Error("make-brush requires --out <path.png>");
    }
    const res = await createBrushPng({
      preset: values.preset || "ink-band",
      strokes: parseStrokeSpecs(values.strokes),
      color: values.color || "#C82829",
      opacity: values.opacity !== undefined ? Number(values.opacity) : 1,
      width: values.width ? Number(values.width) : 800,
      height: values.height ? Number(values.height) : 360,
      angle: values.angle !== undefined ? Number(values.angle) : undefined,
      seed: values.seed ? Number(values.seed) : 42,
      leftDepth: values["left-depth"] !== undefined ? Number(values["left-depth"]) : 0.62,
      rightDepth: values["right-depth"] !== undefined ? Number(values["right-depth"]) : 0.86,
      flipY: Boolean(values["flip-y"]),
      outPath: values.out,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "mask-image") {
    const imagePath = values.image || positionals[1];
    if (!imagePath || !values.out) {
      throw new Error("mask-image requires --image <src> and --out <out.png>");
    }
    const refCrop = values["ref-crop"]
      ? values["ref-crop"].split(",").map((v) => Number(v.trim()))
      : undefined;
    if (refCrop && (refCrop.length !== 4 || refCrop.some((v) => !Number.isFinite(v)))) {
      throw new Error(`Invalid --ref-crop "${values["ref-crop"]}". Expected 4 comma-separated numbers: x,y,w,h`);
    }
    const res = await applyAlphaMaskToImage({
      imagePath,
      strokes: parseStrokeSpecs(values.strokes),
      maskPreset: values.preset,
      maskPngPath: values.mask,
      refMaskPath: values.ref,
      refCrop,
      bgColor: values["bg-color"],
      bgTolerance: values.tolerance !== undefined ? Number(values.tolerance) : 28,
      feather: values.feather !== undefined ? Number(values.feather) : 0.8,
      width: values.width ? Number(values.width) : 600,
      height: values.height ? Number(values.height) : 800,
      angle: values.angle !== undefined ? Number(values.angle) : undefined,
      seed: values.seed ? Number(values.seed) : 42,
      leftDepth: values["left-depth"] !== undefined ? Number(values["left-depth"]) : 0.62,
      rightDepth: values["right-depth"] !== undefined ? Number(values["right-depth"]) : 0.86,
      flipY: Boolean(values["flip-y"]),
      outPath: values.out,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const depInfo = inspectRenderDeps();
  const toolchain = depInfo.toolchain;
  if (cmd === "check-env") {
    const updateInfo = values["no-update-check"]
      ? null
      : await checkSkillUpdate({ force: false, skillDir: SKILL_DIR }).catch(() => null);
    console.log(
      JSON.stringify(
        {
          ok: true,
          version: KIT_VERSION,
          node: process.versions.node,
          mode: depInfo.canRender ? "full-visual" : "code-gates-only",
          toolchain,
          missingRenderDeps: depInfo.missing,
          installHint: depInfo.missing.length > 0 ? depInfo.installHint : null,
          update: updateInfo?.available ? updateInfo : null,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "check-update") {
    const res = await checkSkillUpdate({ force: true, skillDir: SKILL_DIR });
    console.log(
      JSON.stringify(
        res || { available: false, currentVersion: KIT_VERSION, reason: "disabled_or_offline" },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "update" || cmd === "self-update") {
    const res = await selfUpdateSkill({
      skillDir: SKILL_DIR,
      force: Boolean(values.force),
      dryRun: Boolean(values["dry-run"]),
    });
    console.log(JSON.stringify(res, null, 2));
    if (res && res.ok === false) process.exit(1);
    return;
  }

  if (cmd === "inspect") {
    const { manifest } = await inspectTemplateDeck({
      pptxPath: values.pptx || positionals[1],
      outDir: values.out,
    });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (cmd === "validate-plan") {
    const { inspection } = await inspectTemplateDeck({ pptxPath: values.source || values.pptx });
    const map = JSON.parse(await fs.readFile(path.resolve(values.map), "utf8"));
    const res = validateTemplatePlan({ map, inspection });
    console.log(JSON.stringify(res, null, 2));
    if (res.status !== "pass") process.exit(1);
    return;
  }

  if (cmd === "prepare-starter") {
    const map = JSON.parse(await fs.readFile(path.resolve(values.map), "utf8"));
    await prepareStarterDeck({
      pptxPath: values.source || values.pptx,
      map,
      outPptxPath: values.out,
    });
    console.log(JSON.stringify({ ok: true, starterPptx: path.resolve(values.out) }, null, 2));
    return;
  }

  if (cmd === "assemble") {
    if (!values.plan || !values.out) {
      throw new Error("assemble requires --plan <assemble.json> --out <starter.pptx>");
    }
    const planPath = path.resolve(values.plan);
    const planDir = path.dirname(planPath);
    const rawPlan = JSON.parse(await fs.readFile(planPath, "utf8"));
    const resolvedSources = {};
    for (const [k, v] of Object.entries(rawPlan.sources || {})) {
      resolvedSources[k] = path.isAbsolute(v) ? v : path.resolve(planDir, v);
    }
    const baseSpec =
      rawPlan.base && !resolvedSources[rawPlan.base] && !path.isAbsolute(rawPlan.base)
        ? path.resolve(planDir, rawPlan.base)
        : rawPlan.base;
    const assembled = await assembleDeck({
      base: baseSpec,
      sources: resolvedSources,
      slides: rawPlan.slides || [],
      outPptxPath: values.out,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          assembledPptx: path.resolve(values.out),
          slideCount: assembled.slides.count,
          slideSize: assembled.slideSize,
        },
        null,
        2
      )
    );
    return;
  }

  if (cmd === "audit-fidelity") {
    const res = await auditTemplateFidelity({
      sourcePptxPath: values.source,
      finalPptxPath: values.pptx,
    });
    console.log(JSON.stringify(res, null, 2));
    if (!res.passed) process.exit(1);
    return;
  }

  if (cmd === "finalize") {
    const res = await finalizeDeck({
      candidatePptxPath: values.pptx || positionals[1],
      outputPath: values.out,
      antiSlop: values["anti-slop"] || "warn",
      fontPolicy: values["font-policy"] || "warn",
      allowFullBgPic: Boolean(values["allow-full-bg-pic"]),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "render") {
    assertRenderDeps(depInfo);
    const res = await renderDeckToPngs(values.pptx || positionals[1], {
      outDir: values.out,
      dpi: values.dpi ? Number(values.dpi) : 220,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "inspect-ref") {
    const rawRef = values.ref || positionals[1] || "";
    const outDir = path.resolve(values.out || "./ref_inspect");
    const pageNo = values.page ? Number(values.page) : 1;
    let pdfProbe = null;
    if (path.extname(rawRef).toLowerCase() === ".pdf" && toolchain.python3) {
      try {
        pdfProbe = runPythonVision(PY_PDF_PROBE, { pdfPath: path.resolve(rawRef), pageNo }, toolchain.python3);
      } catch {
        pdfProbe = { available: false, pdfKind: "unknown" };
      }
    }
    const refPath = await ensureReferenceImagePath(rawRef, outDir, pageNo, toolchain);
    const crops = parseCropSpecs(values.crops);
    const res = runPythonVision(PY_INSPECT_REF, { refPath, outDir, crops, pdfProbe }, toolchain.python3);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Phase 1 Hard Gate: Verify Pure Layout Masters (`masters.pptx`) against references with 50% X-Ray Overlays,
  // Edge Structure Similarity, and Dominant Tilt Angle Delta BEFORE Phase-2 content filling begins!
  if (cmd === "verify-master") {
    const masterPath = path.resolve(values.pptx || positionals[1] || "");
    if (!existsSync(masterPath)) {
      throw new Error(`verify-master requires an existing --pptx <masters.pptx> (got: ${masterPath})`);
    }
    const outDir = path.resolve(values.out || path.join(path.dirname(masterPath), "qa_master"));
    await fs.mkdir(outDir, { recursive: true });

    const buf = await fs.readFile(masterPath);
    const validation = await validateDeckBuffer(buf, {
      antiSlop: "off",
      fontPolicy: values["font-policy"] || "warn",
      allowFullBgPic: Boolean(values["allow-full-bg-pic"]),
      masterMode: true,
    });
    if (!validation.passed) {
      const summary = validation.issues
        .filter((i) => i.severity === "fail")
        .map((i) => `  - [${i.gate}/${i.code}] ${i.message}`)
        .join("\n");
      throw new Error(`verify-master blocked by static gates (${validation.failCount} failure(s)):\n${summary}`);
    }

    // Extract per-master slot inventory so Phase-2 `auditMasterSlotIntegrity` has a signed baseline
    const { inspection } = await inspectTemplateDeck({ pptxPath: masterPath });
    const masterInventory = inspection.records.map((rec) => ({
      masterSlide: rec.slide,
      imageCount: rec.elements.filter((e) => e.kind === "image" || e.hasImageFill).length,
      textCount: rec.elements.filter((e) => e.kind === "shape" || e.kind === "textbox").length,
      namedSlots: rec.elements.filter((e) => /^slot[:_-]/i.test(e.name || "")).map((e) => ({ name: e.name, kind: e.kind })),
    }));

    if (!depInfo.canRender) {
      if (values["require-render"]) assertRenderDeps(depInfo);
      const manifestPath = path.join(outDir, "master_verified.json");
      const receipt = {
        schema: "yuanmou.master.verified/v1",
        passed: true,
        verificationMode: "code-gates-only",
        masterPptx: masterPath,
        masterSha256: validation.sha256,
        masterInventory,
        angleAuditPassed: true,
        angleMismatches: [],
      };
      await fs.writeFile(manifestPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
      console.log(JSON.stringify({ ...receipt, manifestPath }, null, 2));
      return;
    }

    const renderRes = await renderDeckToPngs(masterPath, {
      outDir: path.join(outDir, "master_slides_png"),
      dpi: values.dpi ? Number(values.dpi) : 220,
    });
    const renderedPngs = numericSortPaths(renderRes.pngFiles || renderRes.pngPaths || []);

    let refFiles = [];
    if (values["ref-dir"]) {
      const refDirAbs = path.resolve(values["ref-dir"]);
      refFiles = numericSortPaths(
        (await fs.readdir(refDirAbs))
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .map((f) => path.join(refDirAbs, f))
      );
    } else if (values.ref) {
      const pageNo = values.page ? Number(values.page) : 1;
      refFiles = [await ensureReferenceImagePath(values.ref, outDir, pageNo, toolchain)];
    }

    let multi = null;
    let comparePdf = null;
    const pdfOut = values.pdf ? path.resolve(values.pdf) : path.join(outDir, "master_xray_compare.pdf");
    if (refFiles.length > 0 && renderedPngs.length > 0 && toolchain.hasPillow) {
      multi = runPythonVision(
        PY_MULTI_COMPARE,
        {
          refs: refFiles,
          gens: renderedPngs,
          outDir,
          batchSize: 4,
          xrayMode: "all",
        },
        toolchain.python3
      );
      comparePdf = runPythonVision(
        PY_BUILD_PDF,
        {
          outPdf: pdfOut,
          pages: multi.pairs.map((p) => ({
            label: `Master ${String(p.slide).padStart(2, "0")}  |  左：原图 (${p.refName}) ｜ 中：50% X光叠图 ｜ 右：纯骨架母版  |  边缘结构 ${p.edgeSimilarityPct}%`,
            imgPath: p.xrayJpg || p.pairJpg,
          })),
        },
        toolchain.python3
      );
    }

    const angleMismatches = multi?.angleMismatches || [];
    const avgEdgeSimilarityPct = multi?.pairs?.length
      ? Number((multi.pairs.reduce((acc, x) => acc + x.edgeSimilarityPct, 0) / multi.pairs.length).toFixed(1))
      : null;
    const manifestPath = path.join(outDir, "master_verified.json");
    const receipt = {
      schema: "yuanmou.master.verified/v1",
      passed: validation.passed && angleMismatches.length === 0,
      verificationMode: "full-visual-xray",
      masterPptx: masterPath,
      masterSha256: validation.sha256,
      masterCount: renderedPngs.length,
      avgEdgeSimilarityPct,
      angleAuditPassed: angleMismatches.length === 0,
      angleMismatches,
      xrayBatches: multi?.xrayBatches || [],
      compareBatches: multi?.compareBatches || [],
      masterXrayPdf: comparePdf,
      masterInventory,
      manifestPath,
    };
    await fs.writeFile(manifestPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  if (cmd === "diff") {
    const outDir = path.resolve(values.out || "./visual_diff");
    const pageNo = values.page ? Number(values.page) : 1;
    const refPath = await ensureReferenceImagePath(values.ref || "", outDir, pageNo, toolchain);
    const genPath = path.resolve(values.gen || "");
    const crops = parseCropSpecs(values.crops);
    const res = runPythonVision(PY_DIFF, { refPath, genPath, outDir, crops, autoCrops: true }, toolchain.python3);

    if (values.gallery) {
      const slides = [
        {
          title: values.title || "全页并排对比（左：参考模板原图 ｜ 右：最终成稿）",
          caption: `整页像素相似度 ${res.fullSimilarityPct}%（MAE=${res.fullMae}）`,
          pngPath: res.sideBySidePng,
          weapons: ["左原图 vs 右成稿", "Base64 内联防裂图"],
        },
        {
          title: "三联 50% 半透明 X 光叠图校准（左原图 ｜ 中叠图 ｜ 右成稿）",
          caption: "用于核查形状边界、梯形斜率、弧边曲率与文字对齐重合度",
          pngPath: res.overlay3PanelPng,
          weapons: ["50% Alpha 叠图校准"],
        },
        ...res.zoomCrops.map((z) => ({
          title: `局部 2× 放大精检：${z.name}`,
          caption: `区域 [${z.box.join(", ")}] · 局部相似度 ${z.similarityPct}%`,
          pngPath: z.zoomPng2x,
          weapons: ["2× 局部放大精检"],
        })),
      ];
      res.galleryHtml = await buildShowcaseGalleryHtml({
        title: values.title || "渊眸 PPT 引擎 · 参考原图 vs 成稿视觉精检画廊",
        subtitle: "左：参考模板原图 ｜ 右：@yuanmou/pptx-kit 零依赖原生可编辑成稿",
        pptxPath: values.pptx ? path.resolve(values.pptx) : "",
        slides,
        outHtmlPath: path.resolve(values.gallery),
      });
    }

    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // One-Shot Verification Pipeline: Optional Read-Only Source Hash + 6-Group (15-Check) Finalizer + Optional Render + Multi-Page QA PDF & Batch JPGs
  if (cmd === "verify") {
    const candidatePath = path.resolve(values.pptx || positionals[1] || "");
    if (!existsSync(candidatePath)) {
      throw new Error(`verify requires an existing --pptx path (got: ${candidatePath})`);
    }
    const outDir = path.resolve(values.out || path.join(path.dirname(candidatePath), "qa_verify"));
    await fs.mkdir(outDir, { recursive: true });

    // 1) Optional read-only source file integrity check
    let sourceIntegrity = null;
    if (values["readonly-source"]) {
      const actualSha = await sha256File(values["readonly-source"]);
      if (values["source-sha256"] && values["source-sha256"].toLowerCase() !== actualSha.toLowerCase()) {
        throw new Error(
          `[READONLY VIOLATION] Source file "${values["readonly-source"]}" SHA-256 changed (expected ${values["source-sha256"]}, got ${actualSha})`
        );
      }
      sourceIntegrity = { path: path.resolve(values["readonly-source"]), sha256: actualSha, intact: true };
    }

    // 1b) Optional Phase-1 -> Phase-2 Master Slot Integrity audit (blocks dropping image slots or drifting rotation angles!)
    let masterAudit = null;
    if (values.master) {
      let slideMap = [];
      if (values["master-map"]) {
        const rawMap = values["master-map"].trim();
        if (existsSync(path.resolve(rawMap))) {
          slideMap = JSON.parse(await fs.readFile(path.resolve(rawMap), "utf8"));
        } else {
          slideMap = rawMap
            .split(/[,;\s]+/)
            .filter(Boolean)
            .map((tok) => {
              const [s, m] = tok.split(":").map((n) => Number(n.trim()));
              return { slide: s, masterSlide: m };
            })
            .filter((x) => Number.isInteger(x.slide) && Number.isInteger(x.masterSlide));
        }
      }
      masterAudit = await auditMasterSlotIntegrity({
        masterPptxPath: values.master,
        finalPptxPath: candidatePath,
        slideMap,
      });
      if (!masterAudit.passed) {
        const msg = masterAudit.issues
          .filter((i) => i.severity === "fail")
          .map((i) => `  - [${i.code}] ${i.message}`)
          .join("\n");
        throw new Error(`verify blocked by Phase-1/Phase-2 master slot integrity audit:\n${msg}`);
      }
    }

    // 2) Atomic 6-group validation (publish `--final` with automatic history archival if supplied, else validate candidate)
    const preserveHistory = !Boolean(values["no-preserve-history"]);
    let validation;
    let targetPptx = candidatePath;
    let archivedPreviousPptx = null;
    if (values.final) {
      const finRes = await finalizeDeck({
        candidatePptxPath: candidatePath,
        outputPath: values.final,
        antiSlop: values["anti-slop"] || "fail",
        fontPolicy: values["font-policy"] || "warn",
        allowFullBgPic: Boolean(values["allow-full-bg-pic"]),
        preserveHistory,
      });
      validation = finRes.validation;
      targetPptx = finRes.outputPath;
      archivedPreviousPptx = finRes.archivedPreviousPath || null;
    } else {
      const buf = await fs.readFile(candidatePath);
      validation = await validateDeckBuffer(buf, {
        antiSlop: values["anti-slop"] || "fail",
        fontPolicy: values["font-policy"] || "warn",
        allowFullBgPic: Boolean(values["allow-full-bg-pic"]),
      });
      if (!validation.passed) {
        const summary = validation.issues
          .filter((i) => i.severity === "fail")
          .map((i) => `  - [${i.gate}/${i.code}] ${i.message}`)
          .join("\n");
        throw new Error(`verify blocked (${validation.failCount} failure(s)):\n${summary}`);
      }
    }

    // 3) Render all slides via LibreOffice + Poppler/pypdfium2 (graceful code-gates-only fallback if render deps missing)
    if (!depInfo.canRender) {
      if (values["require-render"]) {
        assertRenderDeps(depInfo);
      }
      console.log(
        JSON.stringify(
          {
            passed: validation.passed,
            verificationMode: "code-gates-only",
            visualVerified: false,
            pptx: targetPptx,
            archivedPreviousPptx,
            masterAudit,
            gates: validation.gates,
            failCount: validation.failCount,
            warnCount: validation.warnCount,
            warnings: validation.issues.filter((i) => i.severity === "warn").slice(0, 12),
            sourceIntegrity,
            visualVerification: {
              status: "skipped_missing_deps",
              missingDeps: depInfo.missing,
              installHint: depInfo.installHint,
              notice:
                "All 6 static gate groups passed and PPTX was published, but visual rendering was skipped due to missing render dependencies. Report this truthfully and do NOT fabricate visual previews.",
            },
            renderedSlides: [],
            qaSheetPng: null,
            compareBatches: [],
            xrayBatches: [],
            comparePdf: null,
            diff: null,
          },
          null,
          2
        )
      );
      return;
    }

    const renderDir = path.join(outDir, "slides_png");
    const renderRes = await renderDeckToPngs(targetPptx, {
      outDir: renderDir,
      dpi: values.dpi ? Number(values.dpi) : 220,
    });

    // 4) Stitch 1-image QA contact sheet so the Agent inspects the whole deck in a single `read_file`
    const renderedPngs = renderRes.pngFiles || renderRes.pngPaths || [];
    let qaSheet = null;
    if (renderedPngs.length > 0 && toolchain.hasPillow) {
      qaSheet = runPythonVision(
        PY_CONTACT_SHEET,
        {
          pngs: renderedPngs,
          outPng: path.join(outDir, "qa_sheet.png"),
        },
        toolchain.python3
      );
    }

    // 5) Optional reference diff (single --ref OR multi-page --ref-dir) + multi-page QA PDF & compare_batch/xray_batch JPGs (zero HTML)
    let diffRes = null;
    let compareBatches = [];
    let xrayBatches = [];
    let comparePdf = null;
    let archivedPreviousPdf = null;
    const pdfOut = values.pdf
      ? path.resolve(values.pdf)
      : values.gallery
        ? path.resolve(values.gallery.replace(/\.html?$/i, ".pdf"))
        : path.join(outDir, "qa_compare.pdf");

    if (preserveHistory && values.pdf && existsSync(pdfOut)) {
      archivedPreviousPdf = await archivePreviousDeliveredFile(pdfOut);
    }

    if (values["ref-dir"] && renderedPngs.length > 0 && toolchain.hasPillow) {
      const refDirAbs = path.resolve(values["ref-dir"]);
      const refFiles = numericSortPaths(
        (await fs.readdir(refDirAbs))
          .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
          .map((f) => path.join(refDirAbs, f))
      );
      const genFiles = numericSortPaths(renderedPngs);
      if (refFiles.length === 0) {
        throw new Error(`--ref-dir "${refDirAbs}" contains no image files (.png/.jpg/.webp)`);
      }
      const multi = runPythonVision(
        PY_MULTI_COMPARE,
        {
          refs: refFiles,
          gens: genFiles,
          outDir,
          batchSize: 4,
          xrayMode: "flagged",
        },
        toolchain.python3
      );
      diffRes = {
        mode: "multi-page",
        pairCount: multi.pairs.length,
        avgSimilarityPct: Number(
          (multi.pairs.reduce((acc, x) => acc + x.similarityPct, 0) / Math.max(1, multi.pairs.length)).toFixed(1)
        ),
        avgEdgeSimilarityPct: Number(
          (multi.pairs.reduce((acc, x) => acc + x.edgeSimilarityPct, 0) / Math.max(1, multi.pairs.length)).toFixed(1)
        ),
        angleMismatches: multi.angleMismatches || [],
        lowestPages: [...multi.pairs]
          .sort((a, b) => a.edgeSimilarityPct - b.edgeSimilarityPct)
          .slice(0, 5)
          .map((x) => ({
            slide: x.slide,
            ref: x.refName,
            edgeSimilarityPct: x.edgeSimilarityPct,
            similarityPct: x.similarityPct,
          })),
      };
      compareBatches = multi.compareBatches;
      xrayBatches = multi.xrayBatches || [];
      comparePdf = runPythonVision(
        PY_BUILD_PDF,
        {
          outPdf: pdfOut,
          pages: multi.pairs.map((p) => ({
            label: `Slide ${String(p.slide).padStart(2, "0")}  |  左：原模板 (${p.refName})   vs   右：原生可编辑成稿  |  边缘结构 ${p.edgeSimilarityPct}%`,
            imgPath: p.pairJpg,
          })),
        },
        toolchain.python3
      );
    } else if (values.ref && renderedPngs.length > 0 && toolchain.hasPillow) {
      const pageNo = values.page ? Number(values.page) : 1;
      const refPng = await ensureReferenceImagePath(values.ref, outDir, pageNo, toolchain);
      const genPng = renderedPngs[Math.min(Math.max(0, pageNo - 1), renderedPngs.length - 1)];
      const crops = parseCropSpecs(values.crops);
      diffRes = runPythonVision(PY_DIFF, { refPath: refPng, genPath: genPng, outDir, crops, autoCrops: true }, toolchain.python3);
      comparePdf = runPythonVision(
        PY_BUILD_PDF,
        {
          outPdf: pdfOut,
          pages: [
            {
              label: `全页并排对比（左：参考原图 ｜ 右：最终成稿）· 相似度 ${diffRes.fullSimilarityPct}%`,
              imgPath: diffRes.sideBySidePng,
            },
            {
              label: "三联 50% 半透明 X 光叠图校准",
              imgPath: diffRes.overlay3PanelPng,
            },
            ...diffRes.zoomCrops.map((z) => ({
              label: `局部 2x 放大精检：${z.name} [${z.box.join(", ")}] · 局部相似度 ${z.similarityPct}%`,
              imgPath: z.zoomPng2x,
            })),
          ],
        },
        toolchain.python3
      );
    } else if (renderedPngs.length > 0 && toolchain.hasPillow) {
      const sorted = numericSortPaths(renderedPngs);
      comparePdf = runPythonVision(
        PY_BUILD_PDF,
        {
          outPdf: pdfOut,
          pages: sorted.map((p, idx) => ({
            label: `Slide ${String(idx + 1).padStart(2, "0")}  |  @yuanmou/pptx-kit 原生可编辑成稿（fail=0, warn=${validation.warnCount}）`,
            imgPath: p,
          })),
        },
        toolchain.python3
      );
    }

    console.log(
      JSON.stringify(
        {
          passed: validation.passed,
          verificationMode: "full-visual",
          visualVerified: true,
          pptx: targetPptx,
          archivedPreviousPptx,
          archivedPreviousPdf,
          masterAudit,
          gates: validation.gates,
          failCount: validation.failCount,
          warnCount: validation.warnCount,
          warnings: validation.issues.filter((i) => i.severity === "warn").slice(0, 12),
          sourceIntegrity,
          renderedSlides: renderedPngs,
          qaSheetPng: qaSheet?.qaSheetPng || null,
          compareBatches,
          xrayBatches,
          comparePdf,
          diff: diffRes,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(
    `Unknown command "${cmd}". Expected: check-env | check-update | update | verify-master | verify | assemble | make-brush | mask-image | inspect | validate-plan | prepare-starter | audit-fidelity | finalize | render | inspect-ref | diff`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
