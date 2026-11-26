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
  validateDeckBuffer,
  finalizeDeck,
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

const PY_INSPECT_REF = `
import json, os, sys
from PIL import Image

cfg = json.loads(sys.argv[1])
ref_path = cfg["refPath"]
out_dir = cfg["outDir"]
crops = cfg["crops"]
os.makedirs(out_dir, exist_ok=True)

im_raw = Image.open(ref_path).convert("RGB")
im = im_raw.resize((1280, 720), Image.Resampling.LANCZOS)

if not crops:
    crops = [
        {"name": "top_header", "x": 0, "y": 0, "w": 1280, "h": 200},
        {"name": "left_zone", "x": 0, "y": 180, "w": 440, "h": 540},
        {"name": "center_zone", "x": 420, "y": 180, "w": 440, "h": 540},
        {"name": "right_zone", "x": 840, "y": 180, "w": 440, "h": 540},
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

    results.append({
        "name": c["name"],
        "box": [x0, y0, x1 - x0, y1 - y0],
        "cropPng2x": out_png,
        "topHex": rgb_to_hex(median_rgb(top_px)),
        "midHex": rgb_to_hex(median_rgb(mid_px)),
        "bottomHex": rgb_to_hex(median_rgb(bot_px)),
        "darkestInkHex": rgb_to_hex(darkest),
        "dominantColors": dom,
    })

print(json.dumps({
    "refPng": ref_path,
    "sourceSize": list(im_raw.size),
    "normalizedCanvas": [1280, 720],
    "crops": results,
}, ensure_ascii=False))
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
from PIL import Image, ImageChops, ImageStat

cfg = json.loads(sys.argv[1])
refs = cfg["refs"]
gens = cfg["gens"]
out_dir = cfg["outDir"]
batch_size = int(cfg.get("batchSize", 4))
pairs_dir = os.path.join(out_dir, "compare_pairs")
os.makedirs(pairs_dir, exist_ok=True)

pair_items = []
n = min(len(refs), len(gens))
pw, ph = 700, 394
gap = 12

for i in range(n):
    ri = Image.open(refs[i]).convert("RGB").resize((pw, ph), Image.Resampling.LANCZOS)
    gi = Image.open(gens[i]).convert("RGB").resize((pw, ph), Image.Resampling.LANCZOS)
    diff = ImageChops.difference(ri, gi)
    mae = sum(ImageStat.Stat(diff).mean) / 3.0
    sim = round(max(0.0, 100.0 * (1.0 - mae / 255.0)), 1)
    pair = Image.new("RGB", (pw * 2 + gap * 3, ph + gap * 2), (15, 23, 42))
    pair.paste(ri, (gap, gap))
    pair.paste(gi, (pw + gap * 2, gap))
    out_jpg = os.path.join(pairs_dir, f"pair_{i+1:02d}.jpg")
    pair.save(out_jpg, format="JPEG", quality=84, optimize=True)
    pair_items.append({
        "slide": i + 1,
        "refName": os.path.basename(refs[i]),
        "genName": os.path.basename(gens[i]),
        "similarityPct": sim,
        "mae": round(mae, 2),
        "pairJpg": out_jpg,
    })

batches = []
bw, bh = 640, 360
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
    sheet.save(bp, format="JPEG", quality=86, optimize=True)
    batches.append({
        "batch": len(batches) + 1,
        "slides": f"P{chunk[0]['slide']}-P{chunk[-1]['slide']}",
        "path": bp,
    })

print(json.dumps({"pairs": pair_items, "compareBatches": batches}, ensure_ascii=False))
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
    const refPath = await ensureReferenceImagePath(rawRef, outDir, pageNo, toolchain);
    const crops = parseCropSpecs(values.crops);
    const res = runPythonVision(PY_INSPECT_REF, { refPath, outDir, crops }, toolchain.python3);
    console.log(JSON.stringify(res, null, 2));
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

    // 2) Atomic 6-group (15-check) validation (publish `--final` if supplied, else validate candidate)
    let validation;
    let targetPptx = candidatePath;
    if (values.final) {
      const finRes = await finalizeDeck({
        candidatePptxPath: candidatePath,
        outputPath: values.final,
        antiSlop: values["anti-slop"] || "fail",
        fontPolicy: values["font-policy"] || "warn",
        allowFullBgPic: Boolean(values["allow-full-bg-pic"]),
      });
      validation = finRes.validation;
      targetPptx = finRes.outputPath;
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
                "All 6 static gate groups (15 checks) passed and PPTX was published, but visual rendering was skipped due to missing render dependencies. Report this truthfully and do NOT fabricate visual previews.",
            },
            renderedSlides: [],
            qaSheetPng: null,
            compareBatches: [],
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

    // 5) Optional reference diff (single --ref OR multi-page --ref-dir) + multi-page QA PDF & compare_batch JPGs (zero HTML)
    let diffRes = null;
    let compareBatches = [];
    let comparePdf = null;
    const pdfOut = values.pdf
      ? path.resolve(values.pdf)
      : values.gallery
        ? path.resolve(values.gallery.replace(/\.html?$/i, ".pdf"))
        : path.join(outDir, "qa_compare.pdf");

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
        },
        toolchain.python3
      );
      diffRes = {
        mode: "multi-page",
        pairCount: multi.pairs.length,
        avgSimilarityPct: Number(
          (multi.pairs.reduce((acc, x) => acc + x.similarityPct, 0) / Math.max(1, multi.pairs.length)).toFixed(1)
        ),
        lowestPages: [...multi.pairs]
          .sort((a, b) => a.similarityPct - b.similarityPct)
          .slice(0, 5)
          .map((x) => ({ slide: x.slide, ref: x.refName, similarityPct: x.similarityPct })),
      };
      compareBatches = multi.compareBatches;
      comparePdf = runPythonVision(
        PY_BUILD_PDF,
        {
          outPdf: pdfOut,
          pages: multi.pairs.map((p) => ({
            label: `Slide ${String(p.slide).padStart(2, "0")}  |  左：原模板 (${p.refName})   vs   右：原生可编辑成稿  |  相似度 ${p.similarityPct}%`,
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
          gates: validation.gates,
          failCount: validation.failCount,
          warnCount: validation.warnCount,
          warnings: validation.issues.filter((i) => i.severity === "warn").slice(0, 12),
          sourceIntegrity,
          renderedSlides: renderedPngs,
          qaSheetPng: qaSheet?.qaSheetPng || null,
          compareBatches,
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
    `Unknown command "${cmd}". Expected: check-env | check-update | update | verify | make-brush | mask-image | inspect | validate-plan | prepare-starter | audit-fidelity | finalize | render | inspect-ref | diff`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
