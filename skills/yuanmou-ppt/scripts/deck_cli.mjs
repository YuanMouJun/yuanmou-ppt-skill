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
  parsePageSelectionSpec,
  compilePdfVectorSpecToMasterPptx,
  checkSkillUpdate,
  selfUpdateSkill,
} from "../packages/pptx-kit/index.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const VISION_KERNEL_PATH = path.join(SCRIPT_DIR, "vision_kernel.py");

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
    try {
      runVisionKernel("render-pdf-page", { pdfPath: abs, outPng, pageNo, dpi: 220 }, toolchain.python3);
      if (existsSync(outPng)) return outPng;
    } catch {
      // fall through to clear error below
    }
  }
  throw new Error(
    `Failed to render PDF page ${pageNo}: neither Poppler (pdftoppm) nor Python (pypdfium2 / pymupdf) is available. Convert PDF page to PNG or install Poppler.`
  );
}

function runVisionKernel(subcmd, argsJson, pythonBin) {
  const py = pythonBin || discoverRenderToolchain().python3 || (process.platform === "win32" ? "python" : "python3");
  const res = spawnSync(py, [VISION_KERNEL_PATH, subcmd, "-"], {
    input: JSON.stringify(argsJson),
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `Python/Pillow vision kernel (${subcmd}) failed (install Pillow via \`pip install pillow\` if missing):\n${res.stderr || res.stdout}`
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


function numericSortPaths(paths) {
  return [...paths].sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" })
  );
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
      "master-receipt": { type: "string" },
      "require-master-receipt": { type: "boolean" },
      "allow-unverified-master": { type: "boolean" },
      "pdf-spec": { type: "string" },
      pages: { type: "string" },
      "keep-text": { type: "boolean" },
      "allow-unslotted": { type: "boolean" },
      "no-preserve-history": { type: "boolean" },
      out: { type: "string" },
      dpi: { type: "string" },
      page: { type: "string" },
      "anti-slop": { type: "string" },
      "font-policy": { type: "string" },
      "allow-full-bg-pic": { type: "boolean" },
      "require-render": { type: "boolean" },
      xray: { type: "boolean" },
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
        pdfProbe = runVisionKernel("pdf-probe", { pdfPath: path.resolve(rawRef), pageNo }, toolchain.python3);
      } catch {
        pdfProbe = { available: false, pdfKind: "unknown" };
      }
    }
    const refPath = await ensureReferenceImagePath(rawRef, outDir, pageNo, toolchain);
    const crops = parseCropSpecs(values.crops);
    const res = runVisionKernel("inspect-ref", { refPath, outDir, crops, pdfProbe }, toolchain.python3);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  // Phase 1 First-Class Compiler: Vector/Hybrid PDF -> Pure Phase-1 Editable Master PPTX + Master Refs + Spec JSON
  if (cmd === "pdf-to-master") {
    const rawPdf = values.pdf || values.ref || positionals[1] || "";
    const absPdf = path.resolve(rawPdf);
    if (!rawPdf || !existsSync(absPdf)) {
      throw new Error(`pdf-to-master requires an existing --pdf <file.pdf> (got: ${rawPdf})`);
    }
    if (!toolchain.python3) {
      throw new Error("pdf-to-master requires python3 with PyMuPDF (`pip install pymupdf pillow`).");
    }
    const outDir = path.resolve(values.out || path.join(path.dirname(absPdf), "phase1_masters"));
    const refsDir = path.join(outDir, "master_refs");
    const placeholdersDir = path.join(outDir, "placeholders");
    const outPptx = path.resolve(values.pptx || path.join(outDir, "masters.pptx"));
    await fs.mkdir(outDir, { recursive: true });

    const pageList = values.pages ? parsePageSelectionSpec(values.pages) : [];
    const extracted = runVisionKernel(
      "pdf-extract-master",
      { pdfPath: absPdf, pages: pageList, refsDir },
      toolchain.python3
    );
    if (!extracted.available) {
      throw new Error(extracted.error || "PyMuPDF not available for pdf-to-master");
    }

    const pdfSpecPath = path.join(outDir, "pdf_master_spec.json");
    await fs.writeFile(pdfSpecPath, JSON.stringify(extracted, null, 2) + "\n", "utf8");

    const extractedPages = extracted.pages || [];
    const allRaster = extractedPages.length > 0 && extractedPages.every((p) => p.pdfKind === "raster");
    if (allRaster) {
      await fs.rm(outPptx, { force: true });
      console.log(
        JSON.stringify(
          {
            schema: "yuanmou.pdf.master.compiled/v1",
            mode: "fallback_to_bitmap",
            pdfPath: absPdf,
            pdfPageCount: extracted.pageCount,
            outDir,
            mastersPptx: null,
            pdfMasterSpecPath: pdfSpecPath,
            refDir: refsDir,
            slideCount: extractedPages.length,
            rasterPages: extractedPages.map((p) => p.page),
            pageSummary: extractedPages.map((p, idx) => ({
              masterSlide: idx + 1,
              pdfPage: p.page,
              pdfKind: "raster",
              needsVisualRebuild: true,
              refPath: p.refPath,
            })),
            nextStepHint: `纯光栅位图 PDF：已导出高清参考图至 "${refsDir}"，请直接退回位图复刻路线（inspect-ref → Phase 1 精绘纯骨架母版 → verify-master）。`,
          },
          null,
          2
        )
      );
      return;
    }

    const compiled = await compilePdfVectorSpecToMasterPptx({
      pages: extractedPages,
      outPptxPath: outPptx,
      placeholdersDir,
      keepText: Boolean(values["keep-text"]),
      title: values.title || `Phase-1 Pure Masters (${path.basename(absPdf)})`,
    });

    console.log(
      JSON.stringify(
        {
          schema: "yuanmou.pdf.master.compiled/v1",
          mode: "vector_compiled",
          pdfPath: absPdf,
          pdfPageCount: extracted.pageCount,
          outDir,
          mastersPptx: compiled.outPptxPath,
          pdfMasterSpecPath: pdfSpecPath,
          refDir: refsDir,
          placeholdersDir: compiled.placeholdersDir,
          slideCount: compiled.slideCount,
          totalImageSlots: compiled.totalImageSlots,
          totalTextSlots: compiled.totalTextSlots,
          pageSummary: compiled.pageSummary,
          nextStepHint: `Run: node deck_cli.mjs verify-master --pptx "${compiled.outPptxPath}" --ref-dir "${refsDir}" --pdf-spec "${pdfSpecPath}" --out "${path.join(outDir, "qa_master")}"`,
        },
        null,
        2
      )
    );
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

    // Extract per-master slot inventory (with total <p:pic> area %) so Phase-1 photo-slot gate & Phase-2 audit have a signed baseline
    const { inspection } = await inspectTemplateDeck({ pptxPath: masterPath });
    const slideArea = Math.max(1, (inspection.slideSize?.width || 1280) * (inspection.slideSize?.height || 720));
    const masterInventory = inspection.records.map((rec) => {
      const imgEls = rec.elements.filter((e) => e.kind === "image" || e.hasImageFill);
      const imgArea = imgEls.reduce(
        (acc, e) => acc + Math.max(0, e.position?.width || 0) * Math.max(0, e.position?.height || 0),
        0
      );
      return {
        masterSlide: rec.slide,
        imageCount: imgEls.length,
        imageAreaPct: Number(Math.min(100, (imgArea * 100) / slideArea).toFixed(1)),
        textCount: rec.elements.filter((e) => e.kind === "shape" || e.kind === "textbox").length,
        namedSlots: rec.elements.filter((e) => /^slot[:_-]/i.test(e.name || "")).map((e) => ({ name: e.name, kind: e.kind })),
      };
    });

    if (!depInfo.canRender) {
      if (values["require-render"]) assertRenderDeps(depInfo);
      const unslottedSlides = masterInventory.filter((m) => m.namedSlots.length === 0).map((m) => m.masterSlide);
      const enforceSlots = !Boolean(values["allow-unslotted"]);
      const slotContractPassed = unslottedSlides.length === 0;
      const passed = validation.passed && (!enforceSlots || slotContractPassed);
      const manifestPath = path.join(outDir, "master_verified.json");
      const receipt = {
        schema: "yuanmou.master.verified/v1",
        passed,
        verificationMode: "code-gates-only",
        masterPptx: masterPath,
        masterSha256: validation.sha256,
        masterInventory,
        slotContractPassed,
        unslottedSlides,
        angleAuditPassed: true,
        angleMismatches: [],
      };
      await fs.writeFile(manifestPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
      console.log(JSON.stringify({ ...receipt, manifestPath }, null, 2));
      if (!passed) process.exitCode = 1;
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
    const enableXray = Boolean(values.xray);
    const pdfOut = values.pdf ? path.resolve(values.pdf) : path.join(outDir, "master_compare.pdf");
    if (refFiles.length > 0 && renderedPngs.length > 0 && toolchain.hasPillow) {
      multi = runVisionKernel(
        "multi-compare",
        {
          refs: refFiles,
          gens: renderedPngs,
          outDir,
          batchSize: 4,
          xrayMode: enableXray ? "all" : "none",
        },
        toolchain.python3
      );
      comparePdf = runVisionKernel(
        "build-pdf",
        {
          outPdf: pdfOut,
          pages: multi.pairs.map((p) => ({
            label: enableXray
              ? `Master ${String(p.slide).padStart(2, "0")}  |  左：原图 (${p.refName}) ｜ 中：50% 叠图 ｜ 右：纯骨架母版  |  边缘结构 ${p.edgeSimilarityPct}%`
              : `Master ${String(p.slide).padStart(2, "0")}  |  左：原图 (${p.refName})   vs   右：纯骨架母版  |  边缘结构 ${p.edgeSimilarityPct}%`,
            imgPath: enableXray ? p.xrayJpg || p.pairJpg : p.pairJpg,
          })),
        },
        toolchain.python3
      );
    }

    const angleMismatches = multi?.angleMismatches || [];
    const missingPhotoSlotIssues = [];

    // Optional vector PDF spec cross-check (auto-discovered beside masters.pptx or passed via `--pdf-spec`)
    let pdfSpecPages = null;
    const candidateSpecPath = values["pdf-spec"]
      ? path.resolve(values["pdf-spec"])
      : path.join(path.dirname(masterPath), "pdf_master_spec.json");
    if (existsSync(candidateSpecPath)) {
      try {
        const parsedSpec = JSON.parse(await fs.readFile(candidateSpecPath, "utf8"));
        if (Array.isArray(parsedSpec?.pages)) pdfSpecPages = parsedSpec.pages;
      } catch {
        pdfSpecPages = null;
      }
    }

    if (multi?.pairs?.length) {
      for (const p of multi.pairs) {
        const inv = masterInventory.find((m) => m.masterSlide === p.slide);
        if (inv && inv.imageCount === 0 && typeof p.refPhotoTilePct === "number" && p.refPhotoTilePct >= 20.0) {
          missingPhotoSlotIssues.push({
            code: "missing_photo_slot_on_photo_ref",
            slide: p.slide,
            refName: p.refName,
            refPhotoTilePct: p.refPhotoTilePct,
            masterImageCount: inv.imageCount,
            message: `Master slide ${p.slide} has 0 <p:pic> image slots while reference "${p.refName}" has ${p.refPhotoTilePct}% photographic content — keep a real replaceable photo slot (using a clean neutral placeholder if needed) instead of solid color blocks or text cards`,
          });
        } else if (
          inv &&
          inv.imageCount > 0 &&
          inv.imageAreaPct < 4.0 &&
          typeof p.refPhotoTilePct === "number" &&
          p.refPhotoTilePct >= 25.0
        ) {
          missingPhotoSlotIssues.push({
            code: "tiny_dummy_photo_slot",
            slide: p.slide,
            refName: p.refName,
            refPhotoTilePct: p.refPhotoTilePct,
            masterImageCount: inv.imageCount,
            masterImageAreaPct: inv.imageAreaPct,
            message: `Master slide ${p.slide} only has ${inv.imageAreaPct}% total <p:pic> area while reference "${p.refName}" has ${p.refPhotoTilePct}% photographic content — do not bypass photo-slot checks with tiny dummy icons`,
          });
        }
      }
    }

    // Vector PDF expected image-slot count check (catches dropping e.g. 6 photo slots down to 2!)
    if (pdfSpecPages && pdfSpecPages.length > 0) {
      for (let idx = 0; idx < Math.min(pdfSpecPages.length, masterInventory.length); idx++) {
        const pgSpec = pdfSpecPages[idx];
        const inv = masterInventory[idx];
        if (!pgSpec || !inv || pgSpec.pdfKind === "raster") continue;
        const expectedImgs = Number(pgSpec.expectedImageCount ?? pgSpec.images?.length ?? 0);
        const minRequired = expectedImgs >= 2 ? Math.ceil(expectedImgs * 0.5) : expectedImgs;
        if (expectedImgs >= 1 && inv.imageCount < minRequired) {
          if (!missingPhotoSlotIssues.some((x) => x.slide === inv.masterSlide)) {
            missingPhotoSlotIssues.push({
              code: "vector_pdf_image_slots_dropped",
              slide: inv.masterSlide,
              pdfPage: pgSpec.page,
              expectedImageCount: expectedImgs,
              masterImageCount: inv.imageCount,
              message: `Master slide ${inv.masterSlide} (PDF P${pgSpec.page}) only has ${inv.imageCount} <p:pic> slot(s), but the vector PDF contains ${expectedImgs} embedded images — keep replaceable photo placeholders instead of dropping photo slots`,
            });
          }
        }
      }
    }

    const unslottedSlides = masterInventory.filter((m) => m.namedSlots.length === 0).map((m) => m.masterSlide);
    const enforceSlots = !Boolean(values["allow-unslotted"]);
    const slotContractPassed = unslottedSlides.length === 0;
    const avgEdgeSimilarityPct = multi?.pairs?.length
      ? Number((multi.pairs.reduce((acc, x) => acc + x.edgeSimilarityPct, 0) / multi.pairs.length).toFixed(1))
      : null;
    const manifestPath = path.join(outDir, "master_verified.json");
    const passed =
      validation.passed &&
      angleMismatches.length === 0 &&
      missingPhotoSlotIssues.length === 0 &&
      (!enforceSlots || slotContractPassed);
    const receipt = {
      schema: "yuanmou.master.verified/v1",
      passed,
      verificationMode: enableXray ? "full-visual-xray" : "full-visual",
      masterPptx: masterPath,
      masterSha256: validation.sha256,
      masterCount: renderedPngs.length,
      avgEdgeSimilarityPct,
      angleAuditPassed: angleMismatches.length === 0,
      angleMismatches,
      photoSlotAuditPassed: missingPhotoSlotIssues.length === 0,
      missingPhotoSlotIssues,
      slotContractPassed,
      unslottedSlides,
      compareBatches: multi?.compareBatches || [],
      xrayBatches: multi?.xrayBatches || [],
      masterComparePdf: comparePdf,
      masterInventory,
      manifestPath,
    };
    await fs.writeFile(manifestPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(receipt, null, 2));
    if (!passed) {
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === "diff") {
    const outDir = path.resolve(values.out || "./visual_diff");
    const pageNo = values.page ? Number(values.page) : 1;
    const refPath = await ensureReferenceImagePath(values.ref || "", outDir, pageNo, toolchain);
    const genPath = path.resolve(values.gen || "");
    const crops = parseCropSpecs(values.crops);
    const res = runVisionKernel("diff", { refPath, genPath, outDir, crops, autoCrops: true }, toolchain.python3);

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

    // 1b) Phase-1 -> Phase-2 Master Receipt SHA-256 + Slot Integrity audit (receipt enforced BY DEFAULT whenever `--master` is supplied)
    let masterAudit = null;
    let masterReceipt = null;
    let twoStageAudit =
      values["ref-dir"] || values.ref
        ? { enforced: false, reason: "no_master_flag" }
        : null;
    if (values.master) {
      const masterAbs = path.resolve(values.master);
      const actualMasterSha = await sha256File(masterAbs);
      const receiptCandidates = [
        values["master-receipt"] ? path.resolve(values["master-receipt"]) : null,
        path.join(path.dirname(masterAbs), "master_verified.json"),
        path.join(path.dirname(masterAbs), "qa_master", "master_verified.json"),
      ].filter(Boolean);
      const foundReceiptPath = receiptCandidates.find((p) => existsSync(p)) || null;
      if (foundReceiptPath) {
        const parsed = JSON.parse(await fs.readFile(foundReceiptPath, "utf8"));
        if (parsed.passed !== true) {
          throw new Error(
            `[MASTER_RECEIPT_INVALID] Phase-1 receipt "${foundReceiptPath}" has passed=${parsed.passed} — fix Phase-1 masters and re-run \`verify-master\` before Phase 2!`
          );
        }
        if (parsed.masterSha256 && parsed.masterSha256.toLowerCase() !== actualMasterSha.toLowerCase()) {
          throw new Error(
            `[MASTER_RECEIPT_STALE] Master "${masterAbs}" SHA-256 (${actualMasterSha.slice(0, 12)}) does not match verified receipt "${foundReceiptPath}" (${parsed.masterSha256.slice(0, 12)}) — re-run \`verify-master\` after editing masters!`
          );
        }
        masterReceipt = { status: "verified", path: foundReceiptPath, masterSha256: actualMasterSha };
      } else if (!values["allow-unverified-master"]) {
        throw new Error(
          `[MASTER_RECEIPT_MISSING] Phase-2 \`verify --master\` requires a verified \`master_verified.json\` receipt for "${masterAbs}" — run \`deck_cli.mjs verify-master\` in Phase 1 first (or pass --allow-unverified-master for explicit override)!`
        );
      } else {
        masterReceipt = { status: "bypassed_explicitly", masterSha256: actualMasterSha };
      }

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
      twoStageAudit = {
        enforced: true,
        receiptStatus: masterReceipt.status,
        masterAuditPassed: masterAudit.passed,
      };
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
            masterReceipt,
            masterAudit,
            twoStageAudit,
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
      qaSheet = runVisionKernel(
        "contact-sheet",
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
      const multi = runVisionKernel(
        "multi-compare",
        {
          refs: refFiles,
          gens: genFiles,
          outDir,
          batchSize: 4,
          xrayMode: values.xray ? "flagged" : "none",
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
      comparePdf = runVisionKernel(
        "build-pdf",
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
      diffRes = runVisionKernel("diff", { refPath: refPng, genPath: genPng, outDir, crops, autoCrops: true }, toolchain.python3);
      comparePdf = runVisionKernel(
        "build-pdf",
        {
          outPdf: pdfOut,
          pages: [
            {
              label: `全页并排对比（左：参考原图 ｜ 右：最终成稿）· 相似度 ${diffRes.fullSimilarityPct}%`,
              imgPath: diffRes.sideBySidePng,
            },
            ...(values.xray
              ? [
                  {
                    label: "三联 50% 半透明叠图校准",
                    imgPath: diffRes.overlay3PanelPng,
                  },
                ]
              : []),
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
      comparePdf = runVisionKernel(
        "build-pdf",
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
          masterReceipt,
          masterAudit,
          twoStageAudit,
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
    `Unknown command "${cmd}". Expected: check-env | check-update | update | pdf-to-master | verify-master | verify | assemble | make-brush | mask-image | inspect | validate-plan | prepare-starter | audit-fidelity | finalize | render | inspect-ref | diff`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
