// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// End-to-End Verification: Pluggable Provider SPI (`local` / V1 `zsxq` / V2 `yuanmou-cloud` API+R2) + M3 5-Gate `finalizeDeck`

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  Presentation,
  fixed,
  fr,
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
  encodeRgbaPng,
  decodePngToRgba,
  createBrushPng,
  applyAlphaMaskToImage,
  KIT_VERSION,
  compareSemver,
  checkSkillUpdate,
  selfUpdateSkill,
  ORTHO_ARCHETYPES,
  normalizeArchetype,
  normalizePurposeTerms,
  normalizeCapacityTier,
  clearSlideIndexCache,
  querySlideIndexDb,
  queryDecksByFilename,
  queryDeckOutline,
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
  assert.deepEqual(listSourceProviders(), ["local", "feishu", "zsxq", "yuanmou-cloud"]);

  // A1: `LocalStandaloneProvider` (Offline fallback + co-located SQLite DB + Zero-Login Public R2 Trial auto-sync)
  const local = createSourceProvider("local", { enablePublicTrial: false });
  const localAuth = await local.checkAuth();
  assert.equal(localAuth.authenticated, true);
  assert.equal(localAuth.tier, "free");
  const localEmptySlides = await local.searchSlides({ hasChart: true });
  assert.deepEqual(localEmptySlides, [], "Expected [] when offline LocalStandaloneProvider has no YUANMOU_LOCAL_DIR");

  const localDbDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_local_db_"));
  try {
    const sampleBuf = await buildSampleIndexDbBuffer(localDbDir);
    await fs.writeFile(path.join(localDbDir, "yuanmou-slide-index.db"), sampleBuf);
    const localWithDb = createSourceProvider("local", { localLibraryDir: localDbDir });
    const localDbCharts = await localWithDb.searchSlides({ hasChart: true });
    assert.equal(localDbCharts.length, 1);
    assert.equal(localDbCharts[0].sku, "5011");
    console.log(`  [PASS] local provider: empty fallback + co-located SQLite query verified`);
  } finally {
    await fs.rm(localDbDir, { recursive: true, force: true });
  }

  // A1b: `FeishuDriveProvider` (Sanitized `ppt-index-dist.db.gz` + `diagram_family` + On-Demand Lossless PNG Download & Cache)
  const feishuTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_feishu_test_"));
  const distDbPath = path.join(feishuTmpDir, "ppt-index-dist.db");
  const distDb = new DatabaseSync(distDbPath);
  distDb.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO metadata VALUES ('db_variant', 'dist_vip');
    CREATE TABLE pages (
      content_page_id TEXT PRIMARY KEY,
      preview_file TEXT NOT NULL,
      business_purpose TEXT,
      business_topic TEXT,
      page_type TEXT,
      layout TEXT,
      logic TEXT,
      local_graphics TEXT,
      visual_traits TEXT,
      background TEXT,
      result_slots INTEGER,
      text_slots INTEGER,
      image_slots INTEGER,
      raw_layout TEXT,
      raw_visual TEXT,
      restore_note TEXT,
      diagram_family TEXT,
      diagram_labels TEXT,
      feishu_file_token TEXT,
      search_text TEXT NOT NULL
    );
  `);
  distDb
    .prepare(
      `INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      "CP_5c8f88c67d22cc4de3a5",
      "CP_5c8f88c67d22cc4de3a5.png",
      "方法论",
      "全域转化漏斗",
      "正文页",
      "左右分栏",
      "递进",
      "漏斗",
      "留白充足",
      "白底",
      0,
      4,
      0,
      "左侧四层圆角倒梯形漏斗 + 右侧四段动作拆解",
      "浅蓝渐变白底",
      "注意倒梯形圆角",
      "funnel",
      "漏斗转化",
      "boxcnFunnelPng001",
      "方法论 全域转化漏斗 漏斗转化 四层倒梯形"
    );
  distDb.close();
  const distDbGz = zlib.gzipSync(await fs.readFile(distDbPath));
  const fakePngBuf = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  let feishuDownloadHits = 0;

  const feishuServer = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer test-feishu-user-token") {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    if (req.url === "/drive/v1/files/boxcnDistIndexGz/download") {
      res.writeHead(200, { "Content-Type": "application/gzip" });
      res.end(distDbGz);
      return;
    }
    if (req.url === "/drive/v1/files/boxcnFunnelPng001/download") {
      feishuDownloadHits += 1;
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(fakePngBuf);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  await new Promise((r) => feishuServer.listen(0, "127.0.0.1", r));
  try {
    const port = feishuServer.address().port;
    const feishu = createSourceProvider("feishu", {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      userAccessToken: "test-feishu-user-token",
      indexFileToken: "boxcnDistIndexGz",
      cacheDir: path.join(feishuTmpDir, "cache"),
    });
    const fAuth = await feishu.checkAuth();
    assert.equal(fAuth.authenticated, true);
    const syncRes = await feishu.syncSlideIndex({ force: true });
    assert.equal(syncRes.synced, true);
    const funnelHits = await feishu.searchSlides({ diagramFamily: "funnel" });
    assert.equal(funnelHits.length, 1);
    assert.equal(funnelHits[0].contentPageId, "CP_5c8f88c67d22cc4de3a5");
    assert.equal(funnelHits[0].feishuFileToken, "boxcnFunnelPng001");

    const dl1 = await feishu.fetchAsset({
      kind: "preview",
      contentPageId: funnelHits[0].contentPageId,
      previewFile: funnelHits[0].previewFile,
      feishuFileToken: funnelHits[0].feishuFileToken,
    });
    assert.equal(dl1.cached, false);
    assert.equal(feishuDownloadHits, 1);

    const dl2 = await feishu.fetchAsset({
      kind: "preview",
      contentPageId: funnelHits[0].contentPageId,
      previewFile: funnelHits[0].previewFile,
      feishuFileToken: funnelHits[0].feishuFileToken,
    });
    assert.equal(dl2.cached, true);
    assert.equal(feishuDownloadHits, 1, "Second fetch must hit local preview cache (0 API calls)");
    console.log("  [PASS] feishu provider: dist.db.gz sync + diagram_family search + lossless PNG cache verified!");
  } finally {
    feishuServer.close();
    await fs.rm(feishuTmpDir, { recursive: true, force: true });
  }

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

  // Build a fresh self-contained 2-slide deck (native shapes + embedded .xlsx chart + native <a:tbl> with verified sum) so `npm run test:m3` works on any clean git clone.
  const cleanDeck = Presentation.create({ title: "M3 Clean Verification Deck" });
  const s1 = cleanDeck.slides.add();
  s1.shapes.add({
    name: "slide1-title",
    position: { left: 60, top: 40, width: 1160, height: 54 },
    text: "全时段曝光与转化呈双峰结构，晚间档期贡献主要增量",
    textStyle: { fontSize: 24, bold: true, color: "#1E293B" },
  });
  s1.charts.add({
    position: { left: 60, top: 120, width: 560, height: 480 },
    type: "bar",
    title: "季度渠道新增对比",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "内容种草", values: [120, 165, 210, 260], color: "#2563EB" },
      { name: "搜索承接", values: [85, 110, 140, 175], color: "#0EA5E9" },
    ],
  });
  s1.tables.add({
    position: { left: 650, top: 140, width: 570, height: 260 },
    columnWidths: [fixed(210), fr(1), fr(1)],
    rows: [
      [
        { text: "投放阶段", fill: "#1E293B", textStyle: { color: "#FFFFFF", bold: true, fontSize: 13 } },
        { text: "预算(万)", fill: "#1E293B", textStyle: { color: "#FFFFFF", bold: true, fontSize: 13 } },
        { text: "占比", fill: "#1E293B", textStyle: { color: "#FFFFFF", bold: true, fontSize: 13 } },
      ],
      ["蓄水种草", "120", "40%"],
      ["大促转化", "180", "60%"],
      ["合计", "300", "100%"],
    ],
  });
  const cleanOutPath = path.join(publishedDir, "clean_verified.pptx");
  const cleanRes = await finalizeDeck({
    deck: cleanDeck,
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
  assert.equal(badReport.gates.anti_slop, "fail");
  assert.equal(badReport.gates.data_evidence, "fail");
  assert.equal(
    badReport.passed,
    Object.values(badReport.gates).every((v) => v === "pass"),
    "report.passed must strictly match all report.gates entries"
  );

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

  // Verify `Presentation.toPptxBuffer()`, numeric `fontSize` = pt (explicit `"24px"` = 18pt), and flat run styles
  const unitDeck = Presentation.create({ title: "Unit & Flat Run Test" });
  const us = unitDeck.slides.add({ background: "#FFFFFF" });
  us.shapes.add({
    name: "unit-check",
    position: { left: 64, top: 60, width: 960, height: 80 },
    text: [
      {
        runs: [
          { text: "标题三十二磅 ", bold: true, fontSize: 32, color: "#C82829" },
          { text: "正文十四磅 ", fontSize: 14, color: "#1E293B" },
          { text: "显式二十四像素", fontSize: "24px", color: "#334155" },
        ],
      },
    ],
  });
  const unitBuf = unitDeck.toPptxBuffer();
  const unitXml = readZipBuffer(unitBuf).get("ppt/slides/slide1.xml").toString("utf8");
  assert.ok(unitXml.includes('sz="3200"') && unitXml.includes('b="1"') && unitXml.includes('val="C82829"'));
  assert.ok(unitXml.includes('sz="1400"'));
  assert.ok(unitXml.includes('sz="1800"'));

  // Verify tiny body & table font size gates (<9pt fail, 9-11.9pt warn)
  const tinyWarnDeck = Presentation.create({ title: "Tiny Warn Deck" });
  const tws = tinyWarnDeck.slides.add({ background: "#FFFFFF" });
  tws.shapes.add({
    name: "body-10pt",
    position: { left: 64, top: 120, width: 600, height: 60 },
    text: "这是一段十磅字号的正文内容，应当触发告警而不直接阻断。",
    textStyle: { fontSize: 10, color: "#1E293B" },
  });
  tws.tables.add({
    position: { left: 64, top: 220, width: 600, height: 140 },
    bodyTextStyle: { fontSize: 10.5 },
    values: [["指标", "数值"], ["转化率", "3.8%"]],
  });
  const warnReport = await validateDeckBuffer(tinyWarnDeck.toPptxBuffer(), { antiSlop: "fail" });
  assert.equal(warnReport.passed, true, "10-10.5pt text should warn, not hard fail");
  assert.ok(warnReport.issues.some((i) => i.code === "tiny_body_font_size" && i.severity === "warn"));
  assert.ok(warnReport.issues.some((i) => i.code === "tiny_table_font_size" && i.severity === "warn"));

  const tinyFailDeck = Presentation.create({ title: "Tiny Fail Deck" });
  const tfs = tinyFailDeck.slides.add({ background: "#FFFFFF" });
  tfs.shapes.add({
    name: "body-8pt",
    position: { left: 64, top: 120, width: 600, height: 60 },
    text: "这是一段八磅超小字号的正文内容，投影不可读必须阻断。",
    textStyle: { fontSize: 8, color: "#1E293B" },
  });
  tfs.tables.add({
    position: { left: 64, top: 220, width: 600, height: 140 },
    bodyTextStyle: { fontSize: 8 },
    values: [["指标", "数值"], ["转化率", "3.8%"]],
  });
  const failReport = await validateDeckBuffer(tinyFailDeck.toPptxBuffer(), { antiSlop: "fail" });
  assert.equal(failReport.passed, false, "<9pt text must hard fail");
  assert.ok(failReport.issues.some((i) => i.code === "tiny_body_font_size" && i.severity === "fail"));
  assert.ok(failReport.issues.some((i) => i.code === "tiny_table_font_size" && i.severity === "fail"));
  // Verify single-arg `charts.add({ type, ... })` + `series.color` + flat `left/top/width/height` on shapes & images + flat `text: { text, bold, fontSize, color }`
  const ergDeck = Presentation.create({ title: "API Ergonomics Test" });
  const es = ergDeck.slides.add({ background: "#FFFFFF" });
  es.shapes.add({
    name: "flat-pos-shape",
    left: 80,
    top: 90,
    width: 360,
    height: 60,
    text: { text: "平层坐标与对象样式验证", bold: true, fontSize: 18, color: "#0F3A7D" },
  });
  es.charts.add({
    left: 80,
    top: 200,
    width: 520,
    height: 320,
    type: "bar",
    title: "单参数图表验证",
    categories: ["Q1", "Q2"],
    series: [{ name: "营收", values: [120, 240], color: "#2563EB" }],
  });
  const ergZip = readZipBuffer(ergDeck.toPptxBuffer());
  const ergSlideXml = ergZip.get("ppt/slides/slide1.xml").toString("utf8");
  const ergChartXml = ergZip.get("ppt/charts/chart1.xml").toString("utf8");
  assert.ok(ergSlideXml.includes(`x="${80 * 9525}"`) && ergSlideXml.includes(`y="${90 * 9525}"`), "Shape flat left/top failed");
  assert.ok(ergSlideXml.includes('sz="1800"') && ergSlideXml.includes('b="1"') && ergSlideXml.includes('val="0F3A7D"'), "Shape flat text object style failed");
  assert.ok(ergChartXml.includes("单参数图表验证") && ergChartXml.includes("2563EB") && ergChartXml.includes("<c:v>240</c:v>"), "Single-arg charts.add or series.color failed");

  // Verify `"donut"` chart alias + `ImportedPresentation.save()` + Channel A connector & `text.set(makeBulletList(...))` + overwrite-twice `finalizeDeck`
  es.charts.add("donut", {
    left: 640,
    top: 200,
    width: 480,
    height: 320,
    title: "环形占比",
    categories: ["A", "B"],
    series: [{ name: "份额", values: [60, 40] }],
  });
  const donutZip = readZipBuffer(ergDeck.toPptxBuffer());
  assert.ok(donutZip.get("ppt/charts/chart2.xml").toString("utf8").includes("<c:doughnutChart>"), '"donut" alias did not map to <c:doughnutChart>');

  const impTestPath = path.join(publishedDir, "imp_parity.pptx");
  await ergDeck.save(impTestPath);
  const impLoaded = await Presentation.load(impTestPath);
  const impSlide = impLoaded.slides.getItem(0);
  const targetShape = impSlide.shapes.items.find((x) => x.name === "flat-pos-shape");
  targetShape.text.set([{ runs: [{ text: "第一行" }] }, { runs: [{ text: "第二行" }] }]);
  assert.ok(!targetShape.text.toPlainString().includes("[object Object]"), "Channel A text.set produced [object Object]");
  const boxB = impSlide.shapes.add({ name: "box-b", left: 80, top: 560, width: 200, height: 48, text: "节点B" });
  const conn = impSlide.shapes.add({ geometry: "connector", kind: "straight", from: "flat-pos-shape", to: boxB.id });
  assert.equal(conn.kind, "connector");
  await impLoaded.save(impTestPath); // ImportedPresentation.save() overwrite!
  await finalizeDeck({ candidatePptxPath: impTestPath, outputPath: cleanOutPath, antiSlop: "fail" }); // Overwrite existing cleanOutPath!

  console.log("  [PASS] Unit consistency (pt/px), flat run/text styles, flat coords, single-arg/donut charts, Channel A parity, Presentation/ImportedPresentation.save(), and tiny font gates verified!");

  console.log(
    `  [PASS] Negative sabotage test caught all ${codes.size} defect types across all 5 gates & blocked atomic publish!`
  );
  await fs.rm(publishedDir, { recursive: true, force: true });
}

async function testSkillUpdater() {
  console.log("=== [3/3] Testing China-Direct Version Check & SHA-256 Incremental Self-Update ===");
  assert.equal(compareSemver("0.1.3", "0.1.2"), 1);
  assert.equal(compareSemver("v0.1.3", "0.1.3"), 0);
  assert.equal(compareSemver("0.1.2", "0.2.0"), -1);

  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const repoManifest = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, "skills", "yuanmou-ppt", "skill-manifest.json"), "utf8")
  );
  assert.equal(KIT_VERSION, pkg.version, "KIT_VERSION must match package.json.version");
  assert.equal(repoManifest.version, pkg.version, "skill-manifest.json version must match package.json.version");
  assert.ok(Object.keys(repoManifest.files).length >= 25, "skill-manifest.json must index all skill files");

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ym_updater_test_"));
  const pluginDir = path.join(tmpRoot, "plugin");
  const mockSkillDir = path.join(pluginDir, "skills", "yuanmou-ppt");
  const cacheDir = path.join(tmpRoot, "cache");
  await fs.mkdir(path.join(mockSkillDir, "scripts"), { recursive: true });
  await fs.writeFile(path.join(pluginDir, "plugin.json"), JSON.stringify({ name: "yuanmou-ppt", version: "0.1.0" }));
  await fs.writeFile(path.join(mockSkillDir, "SKILL.md"), "---\nname: yuanmou-ppt\nversion: 0.1.0\n---\nOld skill\n");
  await fs.writeFile(path.join(mockSkillDir, "scripts", "legacy.mjs"), "// obsolete file\n");
  await fs.writeFile(
    path.join(mockSkillDir, "skill-manifest.json"),
    JSON.stringify({
      name: "yuanmou-ppt",
      version: "0.1.0",
      files: {
        "SKILL.md": sha256(Buffer.from("---\nname: yuanmou-ppt\nversion: 0.1.0\n---\nOld skill\n")),
        "scripts/legacy.mjs": sha256(Buffer.from("// obsolete file\n")),
      },
    })
  );

  const newSkillMd = Buffer.from("---\nname: yuanmou-ppt\nversion: 9.9.9\n---\nUpdated skill content!\n");
  const newToolMjs = Buffer.from("export const NEW_FEATURE = true;\n");
  let tamperMode = false;

  const remoteManifest = {
    name: "yuanmou-ppt",
    version: "9.9.9",
    highlights: "单元测试增量热更新验证",
    files: {
      "SKILL.md": sha256(newSkillMd),
      "scripts/new_tool.mjs": sha256(newToolMjs),
    },
  };

  const server = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    if (u.endsWith("/skills/yuanmou-ppt/skill-manifest.json")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(remoteManifest));
      return;
    }
    if (u.endsWith("/skills/yuanmou-ppt/SKILL.md")) {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(tamperMode ? Buffer.from("TAMPERED CORRUPT CONTENT") : newSkillMd);
      return;
    }
    if (u.endsWith("/skills/yuanmou-ppt/scripts/new_tool.mjs")) {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(newToolMjs);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const mirrorUrl = `http://127.0.0.1:${port}`;

  try {
    // 1) Passive check + 24h local cache hit
    const chk1 = await checkSkillUpdate({
      currentVersion: "0.1.0",
      skillDir: mockSkillDir,
      cacheDir,
      baseUrlOverride: mirrorUrl,
    });
    assert.equal(chk1.available, true);
    assert.equal(chk1.latestVersion, "9.9.9");

    const chkCached = await checkSkillUpdate({
      currentVersion: "0.1.0",
      skillDir: mockSkillDir,
      cacheDir,
      baseUrlOverride: "http://127.0.0.1:1", // unreachable port proves 24h cache is used!
    });
    assert.equal(chkCached.available, true);
    assert.equal(chkCached.source, "local-cache");

    // 2) Dry run leaves disk untouched
    const dry = await selfUpdateSkill({
      skillDir: mockSkillDir,
      currentVersion: "0.1.0",
      dryRun: true,
      cacheDir,
      baseUrlOverride: mirrorUrl,
    });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.willUpdateCount, 2);
    assert.deepEqual(dry.willRemoveFiles, ["scripts/legacy.mjs"]);

    // 3) SHA-256 tamper rejection leaves existing installation 100% untouched
    tamperMode = true;
    await assert.rejects(
      () =>
        selfUpdateSkill({
          skillDir: mockSkillDir,
          currentVersion: "0.1.0",
          cacheDir,
          baseUrlOverride: mirrorUrl,
        }),
      /SHA-256 mismatch/
    );
    const untouchedMd = await fs.readFile(path.join(mockSkillDir, "SKILL.md"), "utf8");
    assert.ok(untouchedMd.includes("Old skill"), "Tampered update must never overwrite local files");

    // 4) Clean verified incremental update + obsolete file cleanup + colocated plugin.json sync
    tamperMode = false;
    const upd = await selfUpdateSkill({
      skillDir: mockSkillDir,
      currentVersion: "0.1.0",
      cacheDir,
      baseUrlOverride: mirrorUrl,
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.updated, true);
    assert.equal(upd.toVersion, "9.9.9");
    assert.equal((await fs.readFile(path.join(mockSkillDir, "SKILL.md"), "utf8")).includes("Updated skill content!"), true);
    assert.equal(await fs.stat(path.join(mockSkillDir, "scripts", "new_tool.mjs")).then(() => true, () => false), true);
    assert.equal(await fs.stat(path.join(mockSkillDir, "scripts", "legacy.mjs")).then(() => true, () => false), false);
    const updatedPlugin = JSON.parse(await fs.readFile(path.join(pluginDir, "plugin.json"), "utf8"));
    assert.equal(updatedPlugin.version, "9.9.9");

    // 5) User's own Git project repo (`<user-app>/.git` + `<user-app>/skills/yuanmou-ppt`) must NOT be misidentified as `yuanmou-ppt-skill`!
    const userAppRoot = path.join(tmpRoot, "user-company-app");
    const userAppSkill = path.join(userAppRoot, "skills", "yuanmou-ppt");
    await fs.mkdir(path.join(userAppRoot, ".git"), { recursive: true });
    await fs.writeFile(path.join(userAppRoot, "package.json"), JSON.stringify({ name: "my-company-webapp", version: "1.0.0" }));
    await fs.mkdir(userAppSkill, { recursive: true });
    await fs.writeFile(path.join(userAppSkill, "SKILL.md"), "---\nname: yuanmou-ppt\nversion: 0.1.0\n---\nOld\n");
    const userAppUpd = await selfUpdateSkill({
      skillDir: userAppSkill,
      currentVersion: "0.1.0",
      cacheDir,
      baseUrlOverride: mirrorUrl,
      testGitRepoCheck: true,
    });
    assert.equal(userAppUpd.ok, true);
    assert.equal(userAppUpd.method, "cdn-incremental");
    assert.equal(userAppUpd.toVersion, "9.9.9");

    // 6) Multi-round China Git-clone CDN fallback (`git pull` blocked -> Round 1 CDN sync -> Round 2 CDN sync succeeds -> manual edit protected!)
    const cloneRoot = path.join(tmpRoot, "china-git-clone");
    const cloneSkill = path.join(cloneRoot, "skills", "yuanmou-ppt");
    await fs.mkdir(cloneSkill, { recursive: true });
    await fs.writeFile(path.join(cloneRoot, "package.json"), JSON.stringify({ name: "@yuanmou/pptx-kit", version: "0.1.0" }));
    await fs.writeFile(path.join(cloneSkill, "SKILL.md"), "---\nname: yuanmou-ppt\nversion: 0.1.0\n---\nInit\n");
    spawnSync("git", ["init"], { cwd: cloneRoot });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: cloneRoot });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: cloneRoot });
    spawnSync("git", ["remote", "add", "origin", "http://127.0.0.1:1/unreachable.git"], { cwd: cloneRoot });
    spawnSync("git", ["add", "-A"], { cwd: cloneRoot });
    spawnSync("git", ["commit", "-m", "init"], { cwd: cloneRoot });

    // Round 1: `git pull` fails -> falls back to CDN sync (`9.9.9`)
    const r1 = await selfUpdateSkill({
      skillDir: cloneSkill,
      currentVersion: "0.1.0",
      cacheDir,
      baseUrlOverride: mirrorUrl,
      testGitRepoCheck: true,
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.method, "cdn-incremental");

    // Round 2: Remote advances to `10.0.0` -> even though git worktree has Round 1's CDN files, `isDirtyOnlyFromPriorCdnSync` allows Round 2!
    remoteManifest.version = "10.0.0";
    const r2 = await selfUpdateSkill({
      skillDir: cloneSkill,
      currentVersion: "9.9.9",
      cacheDir,
      baseUrlOverride: mirrorUrl,
      testGitRepoCheck: true,
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.toVersion, "10.0.0");

    // Round 3: Developer manually edits `SKILL.md` -> MUST block with `dirty_git_worktree`!
    await fs.appendFile(path.join(cloneSkill, "SKILL.md"), "\n// developer local uncommitted edit\n");
    const r3 = await selfUpdateSkill({
      skillDir: cloneSkill,
      currentVersion: "10.0.0",
      cacheDir,
      baseUrlOverride: mirrorUrl,
      testGitRepoCheck: true,
    });
    assert.equal(r3.ok, false);
    assert.equal(r3.reason, "dirty_git_worktree");

    console.log("  [PASS] Passive 24h cached update check, dry-run, SHA-256 tamper rejection, user-repo isolation & multi-round China git-clone fallback verified!");
  } finally {
    server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function testBrushMaskAndTypographyUpgrades() {
  console.log("=== [4/4] Testing v0.1.6 Brush Angle/Multi-Stroke/RefCrop, Typography pt Spacing & Hollow Frame Exemption ===");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_v016_test_"));
  try {
    // 1) PNG encode <-> decode lossless round-trip + true pixel-space diagonal angle on wide 1280x460 canvas
    const bandRes = await createBrushPng({ preset: "ink-band", width: 640, height: 230, angle: -15, color: "#1E293B" });
    const decBand = decodePngToRgba(bandRes.buffer);
    assert.equal(decBand.width, 640);
    assert.equal(decBand.height, 230);
    // Left half centroid Y vs Right half centroid Y must reflect negative upward slope (-15 deg)!
    let leftY = 0, leftN = 0, rightY = 0, rightN = 0;
    for (let y = 0; y < 230; y++) {
      for (let x = 0; x < 640; x++) {
        const a = decBand.rgba[(y * 640 + x) * 4 + 3];
        if (a > 128) {
          if (x < 240) { leftY += y; leftN++; }
          else if (x > 400) { rightY += y; rightN++; }
        }
      }
    }
    const slope = (rightY / rightN - leftY / leftN) / (520 - 120);
    assert.ok(slope < -0.15, `Expected clear upward diagonal slope on wide canvas, got ${slope.toFixed(3)}`);

    // 2) Pure-Node applyAlphaMaskToImage: multi-stroke + 1280x720 refCrop + stray island pruning
    const srcRgba = new Uint8Array(200 * 200 * 4);
    for (let i = 0; i < 200 * 200; i++) {
      srcRgba[i * 4] = 30; srcRgba[i * 4 + 1] = 80; srcRgba[i * 4 + 2] = 180; srcRgba[i * 4 + 3] = 255;
    }
    const srcPngPath = path.join(tmpDir, "src.png");
    await fs.writeFile(srcPngPath, encodeRgbaPng(200, 200, srcRgba));

    // Create a 2560x1440 (2x Retina of 1280x720!) white ref slide with a main dark diamond at (200..400, 200..400 in 1280x720)
    // AND a small disconnected stray caption block at (260..320, 440..452 in 1280x720)
    const rw = 2560, rh = 1440;
    const refRgba = new Uint8Array(rw * rh * 4).fill(255);
    for (let y = 420; y < 780; y++) {
      for (let x = 420; x < 780; x++) {
        if (Math.abs(x - 600) + Math.abs(y - 600) <= 150) {
          const off = (y * rw + x) * 4;
          refRgba[off] = 20; refRgba[off + 1] = 20; refRgba[off + 2] = 20;
        }
      }
    }
    // Stray disconnected caption island near bottom of crop
    for (let y = 880; y < 900; y++) {
      for (let x = 560; x < 640; x++) {
        const off = (y * rw + x) * 4;
        refRgba[off] = 20; refRgba[off + 1] = 20; refRgba[off + 2] = 20;
      }
    }
    const refPngPath = path.join(tmpDir, "ref_retina.png");
    await fs.writeFile(refPngPath, encodeRgbaPng(rw, rh, refRgba));

    const maskedOut = path.join(tmpDir, "masked_ref.png");
    const mRes = await applyAlphaMaskToImage({
      imagePath: srcPngPath,
      refMaskPath: refPngPath,
      refCrop: [180, 180, 240, 285], // 1280x720 canvas coords!
      width: 240,
      height: 285,
      outPath: maskedOut,
    });
    assert.equal(mRes.ok, true);
    assert.equal(mRes.bleedWarning, false);
    const decMasked = decodePngToRgba(await fs.readFile(maskedOut));
    // Center of diamond (~120, 120) must be opaque; bottom stray island (~120, 265) must be pruned transparent!
    assert.ok(decMasked.rgba[(120 * 240 + 120) * 4 + 3] > 240, "Main silhouette center should be opaque");
    assert.equal(decMasked.rgba[(265 * 240 + 120) * 4 + 3], 0, "Disconnected stray caption island must be auto-pruned");

    // 3) `spaceBefore / spaceAfter` in `pt`, `lineSpacing > 6` in `pt`, hollow frame exemption & top-level `finalizeDeck` fields
    const d = Presentation.create({ title: "v0.1.6 Verification" });
    const s = d.slides.add({ background: "#0F172A" });
    s.shapes.add({ name: "外白框", geometry: "rect", position: { left: 64, top: 120, width: 1152, height: 460 }, fill: "none", line: { fill: "#FFFFFF", width: 8 } });
    s.shapes.add({ name: "左上引子", geometry: "textbox", position: { left: 120, top: 168, width: 400, height: 36 }, text: "How about your living room?", textStyle: { fontSize: 15, color: "#E2E8F0" } });
    s.shapes.add({
      name: "主标题",
      geometry: "textbox",
      position: { left: 120, top: 230, width: 1040, height: 280 },
      text: [
        { runs: [{ text: "第一行大字", fontSize: 56, bold: true, color: "#FFFFFF" }], spaceAfter: 12, lineSpacing: 64 },
        { runs: [{ text: "第二行大字", fontSize: 56, bold: true, color: "#FFFFFF" }] },
      ],
      textStyle: { alignment: "center", spaceBefore: 6 },
    });
    const slideXml = readZipBuffer(d.toPptxBuffer()).get("ppt/slides/slide1.xml").toString("utf8");
    assert.ok(slideXml.includes('<a:spcAft><a:spcPts val="1200"/></a:spcAft>'), "spaceAfter: 12 must map to 1200 (12pt)");
    assert.ok(slideXml.includes('<a:spcBef><a:spcPts val="600"/></a:spcBef>'), "textStyle.spaceBefore: 6 must map to 600 (6pt)");
    assert.ok(slideXml.includes('<a:lnSpc><a:spcPts val="6400"/></a:lnSpc>'), "lineSpacing: 64 (>6) must map to 64pt spcPts");

    const finOut = path.join(tmpDir, "fin.pptx");
    const fin = await finalizeDeck({ deck: d, outputPath: finOut, antiSlop: "fail" });
    assert.equal(fin.ok, true);
    assert.equal(fin.passed, true);
    assert.ok(Array.isArray(fin.issues) && Array.isArray(fin.warnings));
    assert.ok(!fin.issues.some((i) => i.code === "nested_textbox_in_shape"), "Hollow outer frame must not trigger nested_textbox_in_shape");

    console.log("  [PASS] True pixel-angle brush, multi-stroke/refCrop stray-island pruning, pt paragraph spacing, hollow-frame exemption & finalizeDeck top-level fields verified!");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================================
// 5. Test Selection Engine 2.0 (`ortho_v3` 5-field + Snapshot Speed + CLI)
// ============================================================================
async function testSelectionEngine2() {
  console.log("=== [E] Verifying Selection Engine 2.0 (ortho_v3, Speed, Auto-Pick, Blueprint, 15KB Board) ===");

  // E1: Alias normalization (zero fragile title regex; clean explicit alias mapping)
  assert.equal(ORTHO_ARCHETYPES.length, 16);
  assert.equal(normalizeArchetype("信息屋"), "message_house");
  assert.equal(normalizeArchetype("Message House"), "message_house");
  assert.equal(normalizeArchetype("营销Timeline"), "swimlane_gantt");
  assert.equal(normalizeArchetype("活动流程"), "event_rundown");
  assert.equal(normalizeArchetype("消融实验"), "comparison_table");
  assert.equal(normalizeArchetype("未知乱写词"), "");
  assert.deepEqual(normalizePurposeTerms("活动策划"), ["执行策略", "资源介绍"]);
  assert.equal(normalizeCapacityTier("表格"), "tabular");
  assert.equal(normalizeCapacityTier("极简"), "headline");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_sel2_"));
  try {
    const dbPath = path.join(tmpDir, "ppt-index-trial.db");
    const previewsDir = path.join(tmpDir, "previews");
    await fs.mkdir(previewsDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE pages (
        content_page_id TEXT PRIMARY KEY,
        preview_file TEXT NOT NULL,
        page_status TEXT,
        business_purpose TEXT,
        business_topic TEXT,
        page_type TEXT,
        layout TEXT,
        logic TEXT,
        local_graphics TEXT,
        visual_traits TEXT,
        background TEXT,
        stage_count INTEGER,
        full_screenshot_count INTEGER,
        composite_screenshot_count INTEGER,
        result_slots INTEGER,
        independent_results_area INTEGER,
        mature_case INTEGER,
        white_background INTEGER,
        complex_structure INTEGER,
        gradient_structure INTEGER,
        text_slots INTEGER,
        image_slots INTEGER,
        raw_layout TEXT,
        raw_visual TEXT,
        result_form TEXT,
        restore_note TEXT,
        diagram_family TEXT,
        diagram_labels TEXT,
        search_text TEXT NOT NULL,
        archetype TEXT,
        transferability TEXT,
        capacity_tier TEXT,
        aesthetic_tier INTEGER,
        tone_chrome TEXT
      );
    `);

    const ins = db.prepare(`
      INSERT INTO pages VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `);

    const seedRows = [
      // 1) Universal S-tier Message House (even though from a marketing deck -> MUST pass crossDomain!)
      ["CP_mh_s", "CP_mh_s.png", "可核", "执行策略", "小红书品牌策略", "正文页", "上下分层", "递进", "屋顶支柱", "留白充足 现代高级", "白底", 3, 0, 0, 0, 0, 0, 1, 1, 0, 4, 0, "顶部核心主张屋顶+中部三支柱+底部RTB基座", "留白充足 层次清晰 现代", "无", "保持三支柱等宽", "hierarchy", "信息屋", "执行策略 小红书 信息屋 Message House 屋顶支柱", "message_house", "universal", "compact", 5, "light:frameless"],
      // 2) Scene-specific Xiaohongshu screenshot wall (MUST be isolated when crossDomain=true!)
      ["CP_xhs_wall", "CP_xhs_wall.png", "可核", "案例展示", "小红书种草笔记", "正文页", "六图网格", "并列", "手机截图", "高密度", "白底", null, 6, 1, 3, 1, 1, 1, 0, 0, 6, 6, "六篇小红书笔记手机截屏墙+右侧达人数据", "高密度 商业感", "量化实证指标", "手机框截屏", null, null, "案例展示 小红书 笔记截图 达人种草", "evidence_showcase", "scene_specific", "rich", 4, "light:bordered+logo"],
      // 3) Dark cinematic keynote hero (MUST win when tone=dark without white_background bias!)
      ["CP_dark_hero", "CP_dark_hero.png", "可核", "作品展示", "硬件发布会", "正文页", "居中主视觉", null, "引线标注", "暗黑极简 质感", "黑底", null, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, "纯黑底居中产品剖面主视觉+左右参数引线", "暗黑 极简 高级", "无", "保留深色微渐变", null, null, "发布会 暗黑 巨幕 产品剖面", "hero_statement", "adaptable", "headline", 5, "dark:frameless"],
      // 4) Dense operational Event Rundown table (MUST win under copyPolicy=preserve + tabular!)
      ["CP_rundown", "CP_rundown.png", "可核", "执行策略", "线下大会流程", "正文页", "明细表格", "递进", "表格", "整洁 清晰", "白底", 5, 0, 0, 0, 0, 0, 1, 0, 0, 8, 0, "五列活动精确时刻表：时段+环节+执行动作+负责人+道具", "整洁 专业", "无", "原生表格复刻", null, null, "活动流程 Rundown 时刻表 议程 分工", "event_rundown", "universal", "tabular", 5, "light:header_footer"],
      // 5) Watermarked / D-tier bad page (MUST be crushed even if keyword matches!)
      ["CP_bad_wm", "CP_bad_wm.png", "可核", "执行策略", "线下大会流程", "正文页", "明细表格", "递进", "表格", "水印 杂乱 拥挤", "白底", 5, 0, 0, 0, 0, 0, 1, 0, 0, 8, 0, "带水印杂乱活动时刻表", "水印 杂乱 Word式", "无", "", null, null, "活动流程 Rundown 时刻表 议程", "event_rundown", "universal", "tabular", 1, "light:bordered"],
      // 6) Academic comparison / ablation table
      ["CP_ablation", "CP_ablation.png", "可核", "洞察分析", "竞品参数对比", "正文页", "多维对比表", "对比", "表格", "极简 克制", "白底", null, 0, 0, 0, 0, 0, 1, 0, 0, 6, 0, "三线结构多模型指标对比表格+最优行浅蓝高亮", "极简 克制 层次清晰", "无", "三线表对齐", "comparison", "参数对比表", "对比表 参数 消融 实验 指标", "comparison_table", "universal", "tabular", 5, "light:frameless"],
      // 7) Swimlane Gantt timeline
      ["CP_gantt", "CP_gantt.png", "可核", "执行策略", "整合营销节奏", "正文页", "泳道甘特", "递进", "甘特条", "清晰 现代", "白底", 3, 0, 0, 0, 0, 0, 1, 1, 0, 6, 0, "横轴预热-爆发-延续三波段×纵轴四渠道泳道甘特图", "现代 清晰", "无", "波段条对齐", "timeline", "波段甘特图", "营销节奏 传播排期 甘特图 泳道", "swimlane_gantt", "universal", "tabular", 5, "light:frameless"],
      // 8-10) Identical layout clones to test Top-N layout diversity cap
      ["CP_clone_1", "CP_clone_1.png", "可核", "方法论", "策略框架", "正文页", "三列卡片", "并列", "卡片", "干净", "白底", 3, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, "三列等宽卡片A", "干净 现代", "无", "", null, null, "方法论 策略三列卡片", "editorial_freeform", "universal", "compact", 5, "light:frameless"],
      ["CP_clone_2", "CP_clone_2.png", "可核", "方法论", "策略框架", "正文页", "三列卡片", "并列", "卡片", "干净", "白底", 3, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, "三列等宽卡片B", "干净 现代", "无", "", null, null, "方法论 策略三列卡片", "editorial_freeform", "universal", "compact", 5, "light:frameless"],
      ["CP_clone_3", "CP_clone_3.png", "可核", "方法论", "策略框架", "正文页", "三列卡片", "并列", "卡片", "干净", "白底", 3, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, "三列等宽卡片C", "干净 现代", "无", "", null, null, "方法论 策略三列卡片", "editorial_freeform", "universal", "compact", 5, "light:frameless"],
      ["CP_alt_layout", "CP_alt_layout.png", "可核", "方法论", "策略框架", "正文页", "左总右分", "并列", "分割线", "干净", "白底", 3, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0, "左侧核心论断+右侧三段细线要点", "干净 现代", "无", "", null, null, "方法论 策略左总右分", "editorial_freeform", "universal", "compact", 5, "light:frameless"],
    ];

    const tinyPng = encodeRgbaPng(16, 9, new Uint8Array(16 * 9 * 4).fill(200));
    for (const row of seedRows) {
      ins.run(...row);
      await fs.writeFile(path.join(previewsDir, row[1]), tinyPng);
    }
    // Add 300 filler rows to verify snapshot batch speed across 20 pages (<300ms)
    for (let i = 0; i < 300; i++) {
      ins.run(
        `CP_fill_${i}`, `CP_mh_s.png`, "可核", "洞察分析", "常规主题", "正文页",
        `布局${i % 7}`, "并列", "无", "常规", "白底", null, 0, 0, 0, 0, 0, 1, 0, 0, 4, 0,
        "常规图文页", "常规", "无", "", null, null, "常规 洞察", "editorial_freeform", "universal", "compact", 3, "light:frameless"
      );
    }
    db.close();
    clearSlideIndexCache();

    // E2: Cross-domain Message House borrows universal 4A skeleton even from Xiaohongshu deck, isolates scene_specific!
    const mhHits = await querySlideIndexDb(dbPath, {
      archetype: "信息屋",
      capacityTier: "compact",
      crossDomain: true,
      targetImages: 0,
      limit: 3,
      disableDefaultBlacklist: true,
    });
    assert.equal(mhHits[0].contentPageId, "CP_mh_s", "Universal Message House must rank #1 across industries");
    assert.ok(!mhHits.some((h) => h.contentPageId === "CP_xhs_wall"), "scene_specific screenshot wall must not enter crossDomain Top 3");

    // E3: Dark tone ranks dark keynote hero #1 (no hardcoded white_background bias)
    const darkHits = await querySlideIndexDb(dbPath, {
      archetype: "hero_statement",
      tone: "dark",
      crossDomain: true,
      limit: 3,
      disableDefaultBlacklist: true,
    });
    assert.equal(darkHits[0].contentPageId, "CP_dark_hero");

    // E4: copyPolicy=preserve + event_rundown ranks clean tabular rundown #1, crushes watermarked D-tier & headline
    const rundownHits = await querySlideIndexDb(dbPath, {
      archetype: "event_rundown",
      capacityTier: "tabular",
      copyPolicy: "preserve",
      crossDomain: true,
      hasTable: true,
      limit: 3,
      disableDefaultBlacklist: true,
    });
    assert.equal(rundownHits[0].contentPageId, "CP_rundown");
    assert.notEqual(rundownHits[0].capacityTier, "headline");
    assert.ok(rundownHits.every((h) => h.contentPageId !== "CP_bad_wm"), "D-tier watermark page must be demoted");

    // E5: Soft diagramFamily NEVER hard-zeros even when exact family missing
    const softDiagHits = await querySlideIndexDb(dbPath, {
      diagramFamily: "funnel",
      limit: 3,
      disableDefaultBlacklist: true,
    });
    assert.ok(softDiagHits.length > 0, "Soft diagramFamily must gracefully degrade instead of returning 0 rows");

    // E6: Stateless layout-signature diversity cap (at most 2 clones of `三列卡片|editorial_freeform`, pulling `CP_alt_layout` into Top 3)
    const divHits = await querySlideIndexDb(dbPath, {
      archetype: "editorial_freeform",
      purpose: "方法论",
      keywords: "策略",
      limit: 3,
      disableDefaultBlacklist: true,
    });
    const threeColCount = divHits.filter((h) => h.layoutSignature === "三列卡片|editorial_freeform").length;
    assert.ok(threeColCount <= 2, `Expected <=2 identical layout clones in Top 3, got ${threeColCount}`);
    assert.ok(divHits.some((h) => h.contentPageId === "CP_alt_layout"), "Diverse layout variant should surface into Top 3");

    // E7: Plain-text blacklist.txt excludes blocked IDs cleanly
    const blPath = path.join(tmpDir, "blacklist.txt");
    await fs.writeFile(blPath, "# bad slide\nCP_mh_s\n", "utf8");
    const afterBl = await querySlideIndexDb(dbPath, {
      archetype: "message_house",
      blacklistPath: blPath,
      limit: 3,
    });
    assert.ok(!afterBl.some((h) => h.contentPageId === "CP_mh_s"), "Blacklisted ID must be excluded");

    // E8: 20-page in-memory snapshot speed (<300ms!)
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      await querySlideIndexDb(dbPath, {
        archetype: i % 2 === 0 ? "message_house" : "comparison_table",
        crossDomain: true,
        limit: 3,
        disableDefaultBlacklist: true,
      });
    }
    const batchMs = performance.now() - t0;
    assert.ok(batchMs < 300, `Expected 20-page snapshot batch <300ms, got ${batchMs.toFixed(1)}ms`);

    // E9: End-to-end provider_cli.mjs batch-search (`--auto-pick` + `deck_blueprint.json` + lightweight hardlink 15KB HTML board vs `--portable`)
    const planPath = path.join(tmpDir, "pages.json");
    await fs.writeFile(
      planPath,
      JSON.stringify({
        deck: { title: "Selection 2.0 E2E", deliveryMode: "reading", coverTone: "dark", bodyTone: "light", chromePolicy: "auto" },
        pages: [
          { pageId: "p1", pageBadge: "P1", pageTitle: "核心信息屋", archetype: "message_house", capacityTier: "compact", crossDomain: true },
          { pageId: "p2", pageBadge: "P2", pageTitle: "活动时刻表", archetype: "event_rundown", capacityTier: "tabular", copyPolicy: "preserve", crossDomain: true, hasTable: true },
          { pageId: "p3", pageBadge: "P3", pageTitle: "消融实验对比", archetype: "comparison_table", capacityTier: "tabular", crossDomain: true, hasTable: true },
        ],
      }),
      "utf8"
    );

    const cliPath = path.join(REPO_ROOT, "skills/yuanmou-ppt/scripts/provider_cli.mjs");
    const bpOut = path.join(tmpDir, "deck_blueprint.json");
    const boardLite = path.join(tmpDir, "selection_board.html");
    const boardPort = path.join(tmpDir, "selection_board_portable.html");

    const autoRes = spawnSync(
      process.execPath,
      [cliPath, "batch-search", "--provider", "local", "--plan", planPath, "--auto-pick", "--blueprint", bpOut, "--out", boardLite],
      { env: { ...process.env, YUANMOU_LOCAL_DIR: tmpDir, YUANMOU_OFFLINE: "1" }, encoding: "utf8" }
    );
    assert.equal(autoRes.status, 0, `provider_cli batch-search failed:\n${autoRes.stderr}`);
    const autoJson = JSON.parse(autoRes.stdout);
    assert.equal(autoJson.autoPick, true);
    assert.equal(autoJson.pages, 3);
    assert.equal(autoJson.sections[0].pickedContentPageId, "CP_mh_s");
    assert.equal(autoJson.sections[1].pickedContentPageId, "CP_rundown");
    assert.equal(autoJson.sections[2].pickedContentPageId, "CP_ablation");

    const bp = JSON.parse(await fs.readFile(bpOut, "utf8"));
    assert.equal(bp.schemaVersion, "deck_blueprint_v2");
    assert.equal(bp.pages.length, 3);
    assert.equal(bp.pages[1].copyPolicy, "preserve");
    assert.ok(bp.pages[0].chromeRules.L1_alwaysStrip.length >= 3);
    assert.ok(bp.pages[0].refPreviewPath && bp.pages[0].refPreviewPath.endsWith("CP_mh_s.png"));

    const liteHtml = await fs.readFile(boardLite, "utf8");
    assert.ok(liteHtml.includes("./selection_board_assets/"), "Default HTML board must use sibling hardlinked assets");
    assert.ok(!liteHtml.includes("data:image/png;base64,"), "Default HTML board must not bloat with base64");
    assert.ok(Buffer.byteLength(liteHtml, "utf8") < 40 * 1024, "Lightweight HTML board should stay compact (<40KB)");

    const portRes = spawnSync(
      process.execPath,
      [cliPath, "batch-search", "--provider", "local", "--plan", planPath, "--out", boardPort, "--portable"],
      { env: { ...process.env, YUANMOU_LOCAL_DIR: tmpDir, YUANMOU_OFFLINE: "1" }, encoding: "utf8" }
    );
    assert.equal(portRes.status, 0, `provider_cli --portable failed:\n${portRes.stderr}`);
    const portHtml = await fs.readFile(boardPort, "utf8");
    assert.ok(portHtml.includes("data:image/png;base64,"), "--portable board must inline base64 images");

    // E10: Ultra-fast deck-level filename search (`search-decks`) & single-deck outline (`deck-outline`)
    // 10a) Sanitized DB (no file_name / full_sha256) gracefully returns `{ supported: false }` without throwing
    const unsupDecks = await queryDecksByFilename(dbPath, { keywords: "发布会" });
    assert.equal(unsupDecks.supported, false);
    assert.equal(unsupDecks.count, 0);
    const unsupOutline = await queryDeckOutline(dbPath, { deck: "abc123456789" });
    assert.equal(unsupOutline.supported, false);
    const cliUnsup = spawnSync(
      process.execPath,
      [cliPath, "search-decks", "--provider", "local", "--keywords", "发布会"],
      { env: { ...process.env, YUANMOU_LOCAL_DIR: tmpDir, YUANMOU_OFFLINE: "1" }, encoding: "utf8" }
    );
    assert.equal(cliUnsup.status, 0, `CLI search-decks on sanitized DB should not crash:\n${cliUnsup.stderr}`);
    assert.equal(JSON.parse(cliUnsup.stdout).supported, false);

    // 10b) Full local index DB with `file_name` + `full_sha256` + `physical_page` (<50ms direct SQL)
    const fullDir = path.join(tmpDir, "full_local");
    const fullPrevDir = path.join(fullDir, "previews");
    await fs.mkdir(fullPrevDir, { recursive: true });
    const fullDbPath = path.join(fullDir, "ppt-index.db");
    const fdb = new DatabaseSync(fullDbPath);
    fdb.exec(`
      CREATE TABLE pages (
        content_page_id TEXT PRIMARY KEY,
        full_sha256 TEXT NOT NULL,
        file_name TEXT NOT NULL,
        physical_page INTEGER NOT NULL,
        page_type TEXT,
        business_purpose TEXT,
        business_topic TEXT,
        raw_title TEXT,
        layout TEXT,
        raw_layout TEXT,
        preview_file TEXT,
        preview_path TEXT,
        archetype TEXT,
        transferability TEXT,
        capacity_tier TEXT,
        aesthetic_tier INTEGER,
        tone_chrome TEXT,
        image_slots INTEGER,
        text_slots INTEGER,
        result_slots INTEGER
      );
    `);
    const fins = fdb.prepare(`INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const fullSeed = [
      // Deck A: Dark flagship hardware Keynote (4 pages)
      ["CP_tv_1", "a1b2c3d4e5f600001111222233334444", "2026旗舰智能电视新品发布会Keynote.pptx", 1, "封面页", "作品展示", "硬件发布会", "光影重构视界", "暗黑居中", "全屏暗黑主视觉", "CP_tv_1.png", "previews/CP_tv_1.png", "hero_statement", "universal", "headline", 5, "dark:frameless", 1, 2, 0],
      ["CP_tv_2", "a1b2c3d4e5f600001111222233334444", "2026旗舰智能电视新品发布会Keynote.pptx", 2, "目录页", "作品展示", "硬件发布会", "三大核心突破", "三列目录", "暗黑三栏目录", "CP_tv_2.png", "previews/CP_tv_2.png", "editorial_freeform", "universal", "compact", 5, "dark:frameless", 0, 3, 0],
      ["CP_tv_3", "a1b2c3d4e5f600001111222233334444", "2026旗舰智能电视新品发布会Keynote.pptx", 3, "正文页", "作品展示", "硬件发布会", "万级分区MiniLED", "左图右数", "左侧控光剖面+右侧4000nits大数字", "CP_tv_3.png", "previews/CP_tv_3.png", "hero_statement", "universal", "headline", 5, "dark:frameless", 1, 3, 0],
      ["CP_tv_4", "a1b2c3d4e5f600001111222233334444", "2026旗舰智能电视新品发布会Keynote.pptx", 4, "正文页", "洞察分析", "硬件发布会", "全系售价与参数对比", "对比表", "三型号核心参数与售价对比表", "CP_tv_4.png", "previews/CP_tv_4.png", "comparison_table", "universal", "tabular", 5, "dark:frameless", 0, 6, 0],
      // Deck B: Marketing agency launch event plan (3 pages, should be excluded by excludeKeywords="营销,结案")
      ["CP_mkt_1", "ff00ee11dd223344556677889900aabb", "某品牌新品发布会全案营销传播方案.pptx", 1, "封面页", "执行策略", "营销方案", "整合传播", "白底封面", "白底营销封面", "CP_mkt_1.png", "previews/CP_mkt_1.png", "hero_statement", "universal", "headline", 4, "light:frameless", 1, 2, 0],
      ["CP_mkt_2", "ff00ee11dd223344556677889900aabb", "某品牌新品发布会全案营销传播方案.pptx", 2, "正文页", "执行策略", "营销方案", "KOL种草节奏", "泳道甘特", "三波段种草排期", "CP_mkt_2.png", "previews/CP_mkt_2.png", "swimlane_gantt", "universal", "tabular", 4, "light:frameless", 0, 6, 0],
      ["CP_mkt_3", "ff00ee11dd223344556677889900aabb", "某品牌新品发布会全案营销传播方案.pptx", 3, "正文页", "结案复盘", "营销方案", "预期曝光KPI", "指标卡", "KPI目标汇总", "CP_mkt_3.png", "previews/CP_mkt_3.png", "kpi_scorecard", "universal", "compact", 4, "light:frameless", 0, 4, 2],
      // Deck C: Tiny 2-page teaser (should be filtered by minPages=3)
      ["CP_tiny_1", "11223344556677889900aabbccddeeff", "电视发布会预告.pptx", 1, "封面页", "作品展示", "预告", "敬请期待", "居中", "预告封面", "CP_tiny_1.png", "previews/CP_tiny_1.png", "hero_statement", "universal", "headline", 5, "dark:frameless", 1, 1, 0],
      ["CP_tiny_2", "11223344556677889900aabbccddeeff", "电视发布会预告.pptx", 2, "封底页", "作品展示", "预告", "谢谢", "居中", "预告封底", "CP_tiny_2.png", "previews/CP_tiny_2.png", "hero_statement", "universal", "headline", 5, "dark:frameless", 0, 1, 0],
    ];
    for (const r of fullSeed) {
      fins.run(...r);
      await fs.writeFile(path.join(fullPrevDir, r[10]), tinyPng);
    }
    fdb.close();

    const tDeck0 = performance.now();
    const deckRes = await queryDecksByFilename(fullDbPath, {
      keywords: "电视,手机 发布会",
      excludeKeywords: "营销,结案",
      tone: "dark",
      minPages: 3,
      limit: 10,
    });
    const deckMs = performance.now() - tDeck0;
    assert.equal(deckRes.supported, true);
    assert.equal(deckRes.count, 1, "AND/OR keywords + excludeKeywords + minPages should isolate the flagship TV Keynote");
    assert.equal(deckRes.decks[0].deckId, "a1b2c3d4e5f6");
    assert.equal(deckRes.decks[0].darkPages, 4);
    assert.ok(deckMs < 50, `Direct SQL deck search should take <50ms, got ${deckMs.toFixed(1)}ms`);

    const outlineSlice = await queryDeckOutline(fullDbPath, {
      deck: "a1b2c3d4e5f6",
      pages: "1,3-4",
    });
    assert.equal(outlineSlice.supported, true);
    assert.equal(outlineSlice.deck.totalPages, 4);
    assert.deepEqual(outlineSlice.pages.map((p) => p.slideNo), [1, 3, 4]);

    const outlineBodyOnly = await queryDeckOutline(fullDbPath, {
      deck: "旗舰智能电视",
      includeNonBody: false,
    });
    assert.deepEqual(outlineBodyOnly.pages.map((p) => p.slideNo), [3, 4]);

    const cliDecks = spawnSync(
      process.execPath,
      [cliPath, "search-decks", "--provider", "local", "--keywords", "发布会", "--exclude-keywords", "营销", "--min-pages", "3"],
      { env: { ...process.env, YUANMOU_LOCAL_DIR: fullDir, YUANMOU_OFFLINE: "1" }, encoding: "utf8" }
    );
    assert.equal(cliDecks.status, 0, `CLI search-decks failed:\n${cliDecks.stderr}`);
    const cliDecksJson = JSON.parse(cliDecks.stdout);
    assert.equal(cliDecksJson.supported, true);
    assert.equal(cliDecksJson.count, 1);

    const deckBoardOut = path.join(fullDir, "deck_preview.html");
    const cliOutline = spawnSync(
      process.execPath,
      [cliPath, "deck-outline", "--provider", "local", "--deck", "a1b2c3d4e5f6", "--pages", "1,3", "--fetch-previews", "--out", deckBoardOut],
      { env: { ...process.env, YUANMOU_LOCAL_DIR: fullDir, YUANMOU_OFFLINE: "1" }, encoding: "utf8" }
    );
    assert.equal(cliOutline.status, 0, `CLI deck-outline failed:\n${cliOutline.stderr}`);
    const cliOutlineJson = JSON.parse(cliOutline.stdout);
    assert.equal(cliOutlineJson.supported, true);
    assert.equal(cliOutlineJson.returnedPages, 2);
    assert.ok(cliOutlineJson.selectionBoardHtml && cliOutlineJson.selectionBoardHtml.endsWith("deck_preview.html"));
    assert.ok(cliOutlineJson.pages[0].localPreviewPath && cliOutlineJson.pages[0].localPreviewPath.endsWith("CP_tv_1.png"));

    console.log(`  [PASS] Selection Engine 2.0 verified! (20-page snapshot: ${batchMs.toFixed(1)}ms, deck-search: ${deckMs.toFixed(1)}ms, auto-pick + blueprint + 15KB board + --portable + search-decks + deck-outline)`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await testPluggableProviders();
  await testM3Finalizer();
  await testSkillUpdater();
  await testBrushMaskAndTypographyUpgrades();
  await testSelectionEngine2();
  console.log("\nALL PROVIDER SPI + M3 FINALIZER + SKILL UPDATER + V0.1.6 + SELECTION ENGINE 2.0 TESTS PASSED!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
