// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Milestone M4 Route-1 Standalone Verification: 100% Zero-DB Preset Deck -> 5-Gate `finalizeDeck` -> PNG Render

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSourceProvider,
  createPresetPresentation,
  finalizeDeck,
  renderDeckToPngs,
  buildShowcaseGalleryHtml,
} from "../../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

async function main() {
  // 1. Pure Route 1 (`local` provider — zero database, zero network, zero planet auth)
  const localProvider = createSourceProvider("local");
  const candidates = await localProvider.searchSlides({ limit: 12 });
  console.log(`[M4 Standalone] Loaded ${candidates.length} built-in consulting layout presets`);

  // 2. Build a 5-slide consulting proposal from built-in presets
  const pres = createPresetPresentation([
    { presetId: "ym-cover-editorial", data: {} },
    { presetId: "ym-toc-4part", data: {} },
    { presetId: "ym-3pillar-insight", data: { tag: "CONSUMER INSIGHT", title: "健康透明标签、第三空间出片率与双峰核销构成三大增长飞轮" } },
    { presetId: "ym-dual-chart-evidence", data: {} },
    { presetId: "ym-budget-roi-sheet", data: {} },
  ]);

  // 3. Pass all 5 quality gates (`finalizeDeck` with `antiSlop: "fail"`)
  const outPptx = path.join(OUT_DIR, "yuanmou_m4_standalone_presets.pptx");
  const fin = await finalizeDeck({
    deck: pres,
    outputPath: outPptx,
    antiSlop: "fail",
  });
  console.log(`[M4 Standalone] Finalized ${path.basename(fin.outputPath)} (${fin.bytes} bytes, 5/5 gates green)`);

  // 4. Render crisp PNGs & self-contained Base64 HTML gallery
  const rendered = await renderDeckToPngs(outPptx, {
    outDir: path.join(OUT_DIR, "rendered"),
    prefix: "m4_preset",
    dpi: 180,
  });

  const outHtml = path.join(OUT_DIR, "m4_standalone_gallery.html");
  await buildShowcaseGalleryHtml({
    title: "渊眸策略 · M4 独立免费路线（12 套内置咨询骨架直出）验收画廊",
    subtitle: "无需任何索引数据库或会员鉴权，开箱即用生成含内嵌 .xlsx 真图表与跨行合并原生表格的商业全案（已过 5 道终检门闸）",
    pptxPath: outPptx,
    outHtmlPath: outHtml,
    slides: rendered.pngFiles.map((pngPath, i) => ({
      pngPath,
      title: `Slide ${i + 1}`,
      description: candidates[i]?.layoutSummary || "",
      weapons: ["LocalStandaloneProvider", "presets.mjs", "finalizeDeck"],
    })),
  });
  console.log(`[M4 Standalone] Gallery ready: ${outHtml}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
