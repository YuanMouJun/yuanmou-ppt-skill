// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// End-to-End Verification: Pluggable Provider SPI (`local` / V1 `zsxq` / V2 `yuanmou-cloud` API+R2) + M3 5-Gate `finalizeDeck`

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  Presentation,
  createPresetPresentation,
  SlideSourceProvider,
  SLIDE_INDEX_DDL,
  listSourceProviders,
  createSourceProvider,
  registerSourceProvider,
  resolveActiveSourceProvider,
  validateDeckBuffer,
  finalizeDeck,
  buildZipBuffer,
  readZipBuffer,
} from "../../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(__dirname, "output");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ============================================================================
// 1. Test Pluggable Provider SPI (`local`, `zsxq` V1, `yuanmou-cloud` V2 + R2)
// ============================================================================
async function buildSampleIndexDbBuffer(tmpDir) {
  const dbPath = path.join(tmpDir, "sample-slide-index.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SLIDE_INDEX_DDL);
  const ins = db.prepare(`
    INSERT INTO slides (
      slide_uid, sku, deck_title, slide_no, purpose, image_count, text_slots, result_count,
      has_table, has_chart, layout_summary, keywords, style_tags, topic_id, file_id, r2_object_key, preview_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  ins.run(
    "5012_s10",
    "5012",
    "绝味鸭脖2026全域社媒年轻化与私域增粉营销方案",
    10,
    "persona",
    3,
    3,
    1,
    0,
    0,
    "巨型粉白渐变三扇环人群画像",
    "消费者分析 人群画像 圈层 种草热度",
    "gradient-fan pastel red",
    "14425148582544152",
    "888001",
    "templates/5012.pptx",
    "previews/5012_s10.png"
  );
  ins.run(
    "5011_s25",
    "5011",
    "品牌新媒体矩阵搭建与年度内容运营体系通用框架",
    25,
    "data",
    0,
    3,
    2,
    0,
    1,
    "左双色时段卡 + 右柱状分布图",
    "发布时间 流量高峰 投放时段 数据分布",
    "amber chart clean",
    "14425148582544153",
    "888002",
    "templates/5011.pptx",
    "previews/5011_s25.png"
  );
  db.close();
  return fs.readFile(dbPath);
}

async function testPluggableProviders() {
  console.log("=== [A] Verifying Pluggable Data Source Provider SPI ===");
  assert.deepEqual(listSourceProviders(), ["local", "zsxq", "yuanmou-cloud"]);

  // A1: `LocalStandaloneProvider` (Open-Source Free Mode)
  const local = createSourceProvider("local");
  const localAuth = await local.checkAuth();
  assert.equal(localAuth.authenticated, true);
  assert.equal(localAuth.tier, "free");
  const localChartPresets = await local.searchSlides({ hasChart: true });
  assert.ok(localChartPresets.length >= 2, "Expected >=2 chart presets in LocalStandaloneProvider");
  console.log(`  [PASS] local provider: ${localChartPresets.length} chart skeleton presets matched`);

  // A2: `ZsxqPlanetProvider` (V1 Live Auth check — gracefully passes in offline/CI environments too)
  const zsxqCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_zsxq_cache_"));
  try {
    const zsxq = createSourceProvider("zsxq", { cacheDir: zsxqCacheDir, minIntervalMs: 500 });
    const zsxqAuth = await zsxq.checkAuth();
    console.log("  [INFO] zsxq V1 checkAuth:", JSON.stringify(zsxqAuth));
    const autoV1 = await resolveActiveSourceProvider({ cacheDir: zsxqCacheDir });
    assert.ok(["zsxq", "local", "yuanmou-cloud"].includes(autoV1.mode));
    console.log(`  [PASS] resolveActiveSourceProvider() auto-selected "${autoV1.mode}"`);
  } finally {
    await fs.rm(zsxqCacheDir, { recursive: true, force: true });
  }

  // A3: `YuanmouCloudR2Provider` (V2 Self-Hosted Cloud API + Cloudflare R2 Mock Server)
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_cloud_r2_"));
  const sampleDbBuf = await buildSampleIndexDbBuffer(tmpDir);
  const sampleDbSha = sha256(sampleDbBuf);

  const sampleDeck = Presentation.create({ title: "R2 Cloud Sample" });
  sampleDeck.slides.add().shapes.add({ text: "Delivered from Cloudflare R2 Presigned URL" });
  const samplePptxBuf = (await (await import("../../packages/pptx-kit/index.mjs")).PresentationFile.exportPptx(sampleDeck)).bytes;
  const samplePptxSha = sha256(samplePptxBuf);

  let serverBaseUrl = "";
  const mockServer = http.createServer((req, res) => {
    const u = new URL(req.url, serverBaseUrl);

    // Simulated Cloudflare R2 Presigned Edge Object endpoints (no Bearer header required, signed query token!)
    if (u.pathname === "/r2-bucket/index/yuanmou-slide-index.db") {
      assert.equal(u.searchParams.get("X-Amz-Signature"), "mock_r2_sig_db");
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(sampleDbBuf);
      return;
    }
    if (u.pathname === "/r2-bucket/templates/5012.pptx") {
      assert.equal(u.searchParams.get("X-Amz-Signature"), "mock_r2_sig_5012");
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      res.end(samplePptxBuf);
      return;
    }

    // Cloud API Gateway endpoints (strictly require Bearer token)
    if (req.headers.authorization !== "Bearer ym_live_test_v2_token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (req.method === "GET" && u.pathname === "/v1/auth/whoami") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ authenticated: true, tier: "vip", identity: "vip_user@yuanmou.cc", expiresAt: "2027-12-31" }));
      return;
    }
    if (req.method === "GET" && u.pathname === "/v1/index/latest") {
      if (req.headers["if-none-match"] === `"${sampleDbSha}"`) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          version: "2026.11.24",
          sha256: sampleDbSha,
          slideCount: 2,
          r2PresignedUrl: `${serverBaseUrl}/r2-bucket/index/yuanmou-slide-index.db?X-Amz-Signature=mock_r2_sig_db`,
        })
      );
      return;
    }
    if (req.method === "POST" && u.pathname === "/v1/assets/presign") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          filename: "5012_cloud_r2.pptx",
          sha256: samplePptxSha,
          bytes: samplePptxBuf.length,
          r2PresignedUrl: `${serverBaseUrl}/r2-bucket/templates/5012.pptx?X-Amz-Signature=mock_r2_sig_5012`,
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const port = mockServer.address().port;
  serverBaseUrl = `http://127.0.0.1:${port}`;

  try {
    const cloudCacheDir = path.join(tmpDir, "cache_cloud_r2_test");

    const autoV2 = await resolveActiveSourceProvider({
      apiBaseUrl: `${serverBaseUrl}/v1`,
      apiKey: "ym_live_test_v2_token",
      r2PublicCdnUrl: `${serverBaseUrl}/cdn`,
      cacheDir: cloudCacheDir,
    });
    assert.equal(autoV2.mode, "yuanmou-cloud", "Expected auto-router to prioritize yuanmou-cloud when apiKey is valid");

    const sync1 = await autoV2.provider.syncSlideIndex();
    assert.equal(sync1.synced, true);
    assert.equal(sync1.cached, false);
    assert.equal(sync1.sha256, sampleDbSha);

    // Second sync hits HTTP 304 ETag cache!
    const sync2 = await autoV2.provider.syncSlideIndex();
    assert.equal(sync2.cached, true);

    // Slot-fingerprint SQLite search over R2-synced `yuanmou-slide-index.db`
    const hits = await autoV2.provider.searchSlides({ purpose: "persona", minImages: 2 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sku, "5012");
    assert.equal(hits[0].previewUrl, `${serverBaseUrl}/cdn/previews/5012_s10.png`);

    // Presigned R2 `.pptx` download + second-call local SHA-256 cache hit
    const dl1 = await autoV2.provider.fetchAsset({ kind: "pptx", sku: "5012" });
    assert.equal(dl1.cached, false);
    assert.equal(dl1.sha256, samplePptxSha);
    const dl2 = await autoV2.provider.fetchAsset({ kind: "pptx", sku: "5012", sha256: samplePptxSha });
    assert.equal(dl2.cached, true);

    console.log("  [PASS] yuanmou-cloud V2 (API + Cloudflare R2 presigned download + 304 ETag + SQLite search) verified!");
  } finally {
    mockServer.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // A4: Custom 3rd-party Provider extension registration
  class CustomEnterpriseProvider extends SlideSourceProvider {
    constructor(opts) {
      super("custom-s3", "Enterprise S3 Vault", opts);
    }
    async checkAuth() {
      return { authenticated: true, tier: "enterprise" };
    }
  }
  registerSourceProvider("custom-s3", CustomEnterpriseProvider);
  const customResolved = await resolveActiveSourceProvider({ provider: "custom-s3" });
  assert.equal(customResolved.auth.tier, "enterprise");
  console.log("  [PASS] Custom provider registration (`registerSourceProvider`) verified!");
}

// ============================================================================
// 2. Test Milestone M3: 5-Gate Atomic Finalizer (`finalizeDeck`)
// ============================================================================
async function testM3Finalizer() {
  console.log("\n=== [B] Verifying Milestone M3 5-Gate Atomic Finalizer (`finalizeDeck`) ===");

  const publishedDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_m3_finalized_"));

  // Build a fresh self-contained 5-slide consulting deck (with native .xlsx charts + merged <a:tbl>) so `npm run test:m3` works on any clean git clone!
  const cleanPresetDeck = createPresetPresentation([
    { presetId: "ym-cover-editorial" },
    { presetId: "ym-3pillar-insight" },
    { presetId: "ym-funnel-conversion" },
    { presetId: "ym-dual-chart-evidence" },
    { presetId: "ym-budget-roi-sheet" },
  ]);
  const cleanOutPath = path.join(publishedDir, "clean_preset_verified.pptx");
  const cleanRes = await finalizeDeck({
    deck: cleanPresetDeck,
    outputPath: cleanOutPath,
    antiSlop: "fail",
  });
  assert.equal(cleanRes.validation.passed, true);
  console.log(
    `  [PASS] All 5 gates green -> published ${path.basename(cleanOutPath)} (${cleanRes.bytes} bytes, sha256=${cleanRes.sha256.slice(0, 12)}...)`
  );

  // Verify `.validation.json` receipts were isolated inside `.yuanmou-finalizer/` and NOT mixed into `publishedDir` top-level `.pptx` deliverables!
  const topFiles = await fs.readdir(publishedDir);
  assert.equal(topFiles.some((f) => f.endsWith(".validation.json")), false);
  const receipts = await fs.readdir(path.join(publishedDir, ".yuanmou-finalizer"));
  assert.equal(receipts.length, 1);
  console.log(`  [PASS] Isolated validation receipts verified (${receipts.length} receipt in .yuanmou-finalizer/)`);

  // --- Negative Defect Interception Tests Across All 5 Gates ---
  // Sabotage Test 1: Gate 2 (OOB + Collision) + Gate 4 (Overflow + AI Slop) + Gate 3 (Missing Font) + Gate 5 (Bad Table Sum)
  const badDeck = Presentation.create({ title: "Sabotaged Deck" });
  const sl = badDeck.slides.add();

  // OOB textbox
  sl.shapes.add({
    name: "oob-box",
    position: { left: 1160, top: 40, width: 260, height: 50 },
    text: "越出画布右边界的违规文本框",
  });

  // Two colliding textboxes
  sl.shapes.add({
    name: "collide-A",
    position: { left: 80, top: 120, width: 260, height: 60 },
    text: "第一段核心业务结论文字内容",
  });
  sl.shapes.add({
    name: "collide-B",
    position: { left: 100, top: 130, width: 260, height: 60 },
    text: "第二段直接撞车重叠的文字框",
  });

  // Overflow + AI-Slop + Missing Font
  sl.shapes.add({
    name: "slop-and-overflow",
    geometry: "rect",
    position: { left: 80, top: 240, width: 180, height: 36 },
    text: "这不是传统卖货，而是通过生态闭环打出组合拳全面赋能品牌开启新篇章的超长溢出文案测试段落！",
    textStyle: { fontFamily: "NonExistentMartianFont2099", fontSize: 20 },
  });

  // Table with wrong arithmetic total (`35% + 50% + 15% = 100%`, declared `88%`!)
  sl.tables.add({
    position: { left: 80, top: 340, width: 520, height: 180 },
    totalRow: true,
    values: [
      ["渠道", "预算占比", "目标ROI"],
      ["小红书种草", "35%", "4.2x"],
      ["抖音直播", "50%", "4.8x"],
      ["私域社群", "15%", "3.1x"],
      ["合计", "88%", "4.3x"],
    ],
  });

  // Chart whose workbook will be desynced + `<c:dLbls>` element order sabotaged for Gate 1 & Gate 5!
  sl.charts.add("column", {
    title: "Chart Title",
    position: { left: 660, top: 240, width: 500, height: 280 },
    categories: ["Q1", "Q2"],
    series: [{ name: "营收", values: [100, 200] }],
  });

  const rawBadBuf = (await (await import("../../packages/pptx-kit/index.mjs")).PresentationFile.exportPptx(badDeck)).bytes;
  // Inject a Gate 1 `<c:dLbls>` order violation (`<c:txPr>` AFTER `<c:showVal>`) & workbook value mismatch (`999` vs `100`)
  const zMap = readZipBuffer(rawBadBuf);
  let chart1Xml = zMap.get("ppt/charts/chart1.xml").toString("utf8");
  chart1Xml = chart1Xml.replace(
    /<c:dLbls>[\s\S]*?<\/c:dLbls>/,
    `<c:dLbls><c:showVal val="1"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></c:txPr></c:dLbls>`
  );
  chart1Xml = chart1Xml.replace("<c:v>100</c:v>", "<c:v>999</c:v>");
  zMap.set("ppt/charts/chart1.xml", Buffer.from(chart1Xml, "utf8"));
  const sabotagedBuf = buildZipBuffer([...zMap.entries()].map(([name, data]) => ({ name, data })));

  const badReport = await validateDeckBuffer(sabotagedBuf, {
    antiSlop: "fail",
    fontPolicy: "strict",
  });
  assert.equal(badReport.passed, false);
  assert.equal(badReport.gates.package_integrity, "fail");
  assert.equal(badReport.gates.layout_geometry, "fail");
  assert.equal(badReport.gates.font_availability, "fail");
  assert.equal(badReport.gates.text_overflow, "fail");
  assert.equal(badReport.gates.data_evidence, "fail");

  const codes = new Set(badReport.issues.map((i) => i.code));
  for (const expectedCode of [
    "ooxml_element_order_violation",
    "element_out_of_bounds",
    "text_box_collision",
    "vertical_text_overflow",
    "slop_not_x_but_y_zh",
    "slop_jargon_funeng",
    "unverified_system_font",
    "placeholder_chart_title",
    "chart_workbook_cache_desync",
    "table_total_arithmetic_mismatch",
  ]) {
    assert.ok(codes.has(expectedCode), `Expected finalizer to catch ${expectedCode}`);
  }

  // Ensure `finalizeDeck` refuses to write `blocked.pptx`!
  const blockedOut = path.join(publishedDir, "blocked_should_not_exist.pptx");
  await assert.rejects(
    () => finalizeDeck({ deck: sabotagedBuf, outputPath: blockedOut, antiSlop: "fail", fontPolicy: "strict" }),
    /finalizeDeck blocked delivery/
  );
  const blockedExists = await fs.stat(blockedOut).then(() => true, () => false);
  assert.equal(blockedExists, false, "Blocked deck must NEVER be written to outputPath");

  console.log(
    `  [PASS] Negative sabotage test caught all ${codes.size} defect types across all 5 gates & blocked atomic publish!`
  );
  await fs.rm(publishedDir, { recursive: true, force: true });
}

async function main() {
  await testPluggableProviders();
  await testM3Finalizer();
  console.log("\nALL PROVIDER SPI + M3 FINALIZER TESTS PASSED!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
