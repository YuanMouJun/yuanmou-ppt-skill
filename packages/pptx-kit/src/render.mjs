// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function findExecutable(name, extraCandidates = []) {
  for (const cand of extraCandidates) {
    if (cand && existsSync(cand)) return cand;
  }
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(whichCmd, [name], { encoding: "utf8" });
  if (res.status === 0 && res.stdout.trim()) {
    return res.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

export function discoverRenderToolchain() {
  const home = os.homedir();
  const codexOverride = path.join(
    home,
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override"
  );

  const soffice = findExecutable("soffice", [
    process.env.SOFFICE_BIN,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/bin/soffice",
    path.join(codexOverride, "soffice"),
  ]);

  const pdftoppm = findExecutable("pdftoppm", [
    process.env.PDFTOPPM_BIN,
    "/opt/homebrew/bin/pdftoppm",
    "/usr/local/bin/pdftoppm",
    "/usr/bin/pdftoppm",
    path.join(codexOverride, "pdftoppm"),
  ]);

  const python3 = findExecutable("python3", [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ]);

  return { soffice, pdftoppm, python3 };
}

async function ensureChineseFontconfig(workDir) {
  if (process.env.FONTCONFIG_FILE && existsSync(process.env.FONTCONFIG_FILE)) {
    return process.env.FONTCONFIG_FILE;
  }
  if (process.platform !== "darwin") return undefined;

  const home = os.homedir();
  // Persist fontconfig cache across renders (~3-8s faster per headless LibreOffice call!)
  const persistRoot = path.join(home, ".cache", "yuanmou-pptx", "fontconfig");
  let fcDir = persistRoot;
  try {
    await fs.mkdir(path.join(persistRoot, "cache"), { recursive: true });
  } catch {
    fcDir = path.join(workDir, "fontconfig");
    await fs.mkdir(path.join(fcDir, "cache"), { recursive: true });
  }
  const cacheDir = path.join(fcDir, "cache");
  const fcFile = path.join(fcDir, "fonts.conf");

  if (!existsSync(fcFile)) {
    const xml = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
      "<fontconfig>",
      "  <dir>/System/Library/Fonts</dir>",
      "  <dir>/System/Library/Fonts/Supplemental</dir>",
      "  <dir>/Library/Fonts</dir>",
      `  <dir>${home}/Library/Fonts</dir>`,
      `  <cachedir>${cacheDir}</cachedir>`,
      "</fontconfig>",
    ].join("\n");
    await fs.writeFile(fcFile, xml, "utf8");
  }
  return fcFile;
}

/**
 * Renders a `.pptx` file into crisp 300DPI PNG slide images via headless LibreOffice
 * + Poppler `pdftoppm` (or `pypdfium2` fallback).
 */
export async function renderDeckToPngs(pptxPath, options = {}) {
  const absPptx = path.resolve(pptxPath);
  const dpi = options.dpi || 220;
  const outDir = path.resolve(options.outDir || path.join(path.dirname(absPptx), "rendered_png"));
  const prefixName = options.prefix || path.basename(absPptx, path.extname(absPptx));

  const { soffice, pdftoppm, python3 } = discoverRenderToolchain();
  if (!soffice) {
    throw new Error(
      "LibreOffice (`soffice`) not found. Install LibreOffice (`brew install --cask libreoffice`) to enable local visual verification."
    );
  }

  await fs.mkdir(outDir, { recursive: true });
  const runId = randomUUID().slice(0, 8);
  const tmpWork = path.join(os.tmpdir(), `yuanmou_render_${runId}`);
  const loProfile = path.join(tmpWork, "lo_profile");
  const pdfDir = path.join(tmpWork, "pdf");
  await fs.mkdir(pdfDir, { recursive: true });

  try {
    const fontconfigFile = await ensureChineseFontconfig(tmpWork);
    const env = {
      ...process.env,
      ...(fontconfigFile ? { FONTCONFIG_FILE: fontconfigFile } : {}),
    };

    const loRes = spawnSync(
      soffice,
      [
        "--headless",
        `-env:UserInstallation=file://${loProfile}`,
        "--convert-to",
        "pdf",
        "--outdir",
        pdfDir,
        absPptx,
      ],
      { encoding: "utf8", env, timeout: 120_000 }
    );
    if (loRes.status !== 0) {
      throw new Error(`soffice PDF conversion failed: ${loRes.stderr || loRes.stdout}`);
    }

    const pdfPath = path.join(pdfDir, `${path.basename(absPptx, path.extname(absPptx))}.pdf`);
    const existing = await fs.readdir(outDir).catch(() => []);
    for (const f of existing) {
      if (f.startsWith(`${prefixName}-`) && f.endsWith(".png")) {
        await fs.rm(path.join(outDir, f), { force: true });
      }
    }

    if (pdftoppm) {
      const outPrefix = path.join(outDir, prefixName);
      const ppmRes = spawnSync("pdftoppm", ["-png", "-r", String(dpi), pdfPath, outPrefix], {
        encoding: "utf8",
        env: { ...env, PATH: `${path.dirname(pdftoppm)}:${process.env.PATH || ""}` },
        timeout: 120_000,
      });
      if (ppmRes.status !== 0) {
        throw new Error(`pdftoppm failed: ${ppmRes.stderr || ppmRes.stdout}`);
      }
    } else if (python3) {
      const pyScript = `
import pypdfium2 as pdfium, sys, pathlib
pdf_path, out_dir, prefix, dpi = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3], float(sys.argv[4])
doc = pdfium.PdfDocument(pdf_path)
scale = dpi / 72.0
for idx in range(len(doc)):
    bmp = doc[idx].render(scale=scale)
    bmp.to_pil().save(out_dir / f"{prefix}-{idx+1:02d}.png")
`;
      const pyRes = spawnSync(python3, ["-c", pyScript, pdfPath, outDir, prefixName, String(dpi)], {
        encoding: "utf8",
        timeout: 120_000,
      });
      if (pyRes.status !== 0) {
        throw new Error(`Neither pdftoppm nor pypdfium2 available: ${pyRes.stderr || pyRes.stdout}`);
      }
    } else {
      throw new Error("Neither `pdftoppm` nor `python3 (pypdfium2)` found for PDF -> PNG rasterization.");
    }

    const pngFiles = (await fs.readdir(outDir))
      .filter((f) => f.startsWith(`${prefixName}-`) && f.endsWith(".png"))
      .sort()
      .map((f) => path.join(outDir, f));

    return { pdfPath: null, pngFiles, outDir };
  } finally {
    await fs.rm(tmpWork, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Generates an interactive wide-screen HTML inspection gallery (weapons #06 & #20).
 */
export async function buildShowcaseGalleryHtml({
  title = "渊眸策略 · @yuanmou/pptx-kit 渲染验收画廊",
  subtitle = "",
  pptxPath = "",
  slides = [],
  outHtmlPath,
}) {
  const cardsHtml = await Promise.all(
    slides.map(async (item, idx) => {
      const imgBuf = await fs.readFile(item.pngPath);
      const ext = path.extname(item.pngPath || "").toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
      const dataUri = `data:${mime};base64,${imgBuf.toString("base64")}`;
      const tags = (item.weapons || [])
        .map((w) => `<span class="badge">${w}</span>`)
        .join("");
      return `
      <section class="card">
        <div class="card-head">
          <div>
            <span class="slide-no">SLIDE ${String(idx + 1).padStart(2, "0")}</span>
            <h2>${item.title || `第 ${idx + 1} 页`}</h2>
          </div>
          <div class="badges">${tags}</div>
        </div>
        <p class="desc">${item.description || item.caption || ""}</p>
        <div class="img-wrap" onclick="openLightbox(this.querySelector('img').src)">
          <img src="${dataUri}" alt="Slide ${idx + 1}" />
        </div>
      </section>`;
    })
  );

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0B1120; color: #F8FAFC; padding: 36px 48px 72px; }
  header { max-width: 1440px; margin: 0 auto 36px; border-bottom: 1px solid #1E293B; padding-bottom: 24px; }
  .brand { display: inline-block; background: #7F1D1D; color: #FDE68A; font-weight: 700; font-size: 13px; padding: 4px 12px; letter-spacing: 1px; margin-bottom: 12px; }
  h1 { font-size: 28px; font-weight: 800; color: #FFFFFF; margin-bottom: 8px; }
  .sub { color: #94A3B8; font-size: 15px; line-height: 1.6; }
  .meta { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #38BDF8; }
  main { max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px; }
  .card { background: #111827; border: 1px solid #1F2937; padding: 24px 28px 28px; }
  .card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
  .slide-no { font-size: 12px; font-weight: 700; color: #FACC15; letter-spacing: 1.2px; display: block; margin-bottom: 2px; }
  h2 { font-size: 20px; color: #F1F5F9; }
  .badges { display: flex; gap: 8px; flex-wrap: wrap; }
  .badge { background: #1E3A8A; color: #DBEAFE; font-size: 12px; font-weight: 600; padding: 4px 10px; }
  .desc { color: #94A3B8; font-size: 14px; margin-bottom: 18px; line-height: 1.5; }
  .img-wrap { background: #020617; border: 1px solid #334155; cursor: zoom-in; overflow: hidden; }
  .img-wrap img { display: block; width: 100%; height: auto; }
  #lightbox { display: none; position: fixed; inset: 0; background: rgba(2, 6, 23, 0.94); z-index: 999; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out; }
  #lightbox.open { display: flex; }
  #lightbox img { max-width: 96vw; max-height: 94vh; box-shadow: 0 25px 60px rgba(0,0,0,0.7); }
</style>
</head>
<body>
  <header>
    <span class="brand">渊眸策略 · CLEAN-ROOM PPTX ENGINE</span>
    <h1>${title}</h1>
    <p class="sub">${subtitle}</p>
    ${pptxPath ? `<p class="meta">可编辑源文件：${path.basename(pptxPath)}</p>` : ""}
  </header>
  <main>${cardsHtml.join("\n")}</main>
  <div id="lightbox" onclick="this.classList.remove('open')"><img id="lb-img" src="" alt="preview"/></div>
  <script>
    function openLightbox(src) {
      document.getElementById('lb-img').src = src;
      document.getElementById('lightbox').classList.add('open');
    }
  </script>
</body>
</html>`;

  await fs.mkdir(path.dirname(outHtmlPath), { recursive: true });
  await fs.writeFile(outHtmlPath, html, "utf8");
  return outHtmlPath;
}
