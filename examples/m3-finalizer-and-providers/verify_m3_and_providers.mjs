// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// End-to-End Verification: Pluggable Provider SPI (`local` / V1 `zsxq` / V2 `yuanmou-cloud` API+R2) + M3 5-Gate `finalizeDeck`

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
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
  KIT_VERSION,
  compareSemver,
  checkSkillUpdate,
  selfUpdateSkill,
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
    });
    assert.equal(userAppUpd.ok, true);
    assert.equal(userAppUpd.method, "cdn-incremental");
    assert.equal(userAppUpd.toVersion, "9.9.9");

    console.log("  [PASS] Passive 24h cached update check, dry-run, SHA-256 tamper rejection, user-repo isolation & incremental update verified!");
  } finally {
    server.close();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function main() {
  await testPluggableProviders();
  await testM3Finalizer();
  await testSkillUpdater();
  console.log("\nALL PROVIDER SPI + M3 FINALIZER + SKILL UPDATER TESTS PASSED!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
