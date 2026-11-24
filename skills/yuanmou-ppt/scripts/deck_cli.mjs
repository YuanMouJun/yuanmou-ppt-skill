#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).
// Deck Engineering CLI: Inspect, Validate Plan, Prepare Starter, Audit Fidelity, Finalize, Render, Inspect-Ref & Diff

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  inspectTemplateDeck,
  validateTemplatePlan,
  prepareStarterDeck,
  auditTemplateFidelity,
  finalizeDeck,
  renderDeckToPngs,
  buildShowcaseGalleryHtml,
} from "../../../packages/pptx-kit/index.mjs";

function runPythonVision(pyCode, argsJson) {
  const res = spawnSync("python3", ["-c", pyCode, JSON.stringify(argsJson)], {
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
    # Top / Mid / Bottom strips
    top_px = list(sub.crop((0, 0, sw, max(1, int(sh * 0.18)))).getdata())
    mid_px = list(sub.crop((0, int(sh * 0.4), sw, max(int(sh * 0.4) + 1, int(sh * 0.6)))).getdata())
    bot_px = list(sub.crop((0, int(sh * 0.82), sw, sh)).getdata())

    # Darkest ink pixels (5th percentile by luminance, excluding pure white)
    non_white = [p for p in px if (p[0] + p[1] + p[2]) < 700]
    non_white.sort(key=lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2])
    darkest = non_white[min(len(non_white) - 1, max(0, int(len(non_white) * 0.05)))] if non_white else (30, 30, 30)

    # Quantized dominant colors
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
os.makedirs(out_dir, exist_ok=True)

ref = Image.open(ref_path).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS)
gen = Image.open(gen_path).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS)

def calc_similarity(a, b):
    diff = ImageChops.difference(a, b)
    hist = diff.histogram()
    # 3 channels x 256 bins
    total_px = a.size[0] * a.size[1] * 3
    err_sum = 0
    for ch in range(3):
        base = ch * 256
        for v in range(256):
            err_sum += v * hist[base + v]
    mae = err_sum / float(total_px)
    return round(mae, 2), round(max(0.0, 100.0 - mae / 2.55), 2)

full_mae, full_sim = calc_similarity(ref, gen)

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

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pptx: { type: "string" },
      source: { type: "string" },
      map: { type: "string" },
      out: { type: "string" },
      dpi: { type: "string" },
      "anti-slop": { type: "string" },
      "font-policy": { type: "string" },
      ref: { type: "string" },
      gen: { type: "string" },
      crops: { type: "string" },
      gallery: { type: "string" },
      title: { type: "string" },
    },
  });

  const cmd = positionals[0];
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
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "render") {
    const res = await renderDeckToPngs(values.pptx || positionals[1], {
      outDir: values.out,
      dpi: values.dpi ? Number(values.dpi) : 220,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "inspect-ref") {
    const refPath = path.resolve(values.ref || positionals[1] || "");
    const outDir = path.resolve(values.out || "./ref_inspect");
    const crops = parseCropSpecs(values.crops);
    const res = runPythonVision(PY_INSPECT_REF, { refPath, outDir, crops });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "diff") {
    const refPath = path.resolve(values.ref || "");
    const genPath = path.resolve(values.gen || "");
    const outDir = path.resolve(values.out || "./visual_diff");
    const crops = parseCropSpecs(values.crops);
    const res = runPythonVision(PY_DIFF, { refPath, genPath, outDir, crops });

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

  throw new Error(
    `Unknown command "${cmd}". Expected: inspect | validate-plan | prepare-starter | audit-fidelity | finalize | render | inspect-ref | diff`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
