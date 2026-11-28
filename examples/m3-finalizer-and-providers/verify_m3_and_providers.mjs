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
  assembleDeck,
  auditMasterSlotIntegrity,
  parsePageSelectionSpec,
  toNeutralPlaceholderText,
  makeNeutralPlaceholderPng,
  compilePdfVectorSpecToMasterPptx,
  placeInRotatedFrame,
  rotatedBoundingBox,
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

async function testTwoStageArchitectureV040() {
  console.log("=== [F] Verifying v0.4.0 Two-Stage Architecture (assembleDeck, Master Slot Audit, Rotated Frame, Z-Order Gate, History Archive, inspect-ref) ===");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_v040_arch_"));
  try {
    // F1: Exact rotated child math (`+deg` = clockwise / top leans right)
    const box90 = { left: 100, top: 100, width: 200, height: 400, rotation: 90 };
    const topNotch90 = placeInRotatedFrame(box90, { left: 50, top: 0, width: 100, height: 20 });
    // Center of unrotated notch is (100, 10) vs parent center (100, 200) -> dy = -190.
    // Rotated +90° clockwise: (0, -190) -> (+190, 0), so world center = (200+190, 300) = (390, 300)!
    assert.ok(Math.abs(topNotch90.left + topNotch90.width / 2 - 390) < 0.2, `Expected rotated center X=390, got ${topNotch90.left + topNotch90.width / 2}`);
    assert.ok(Math.abs(topNotch90.top + topNotch90.height / 2 - 300) < 0.2, `Expected rotated center Y=300, got ${topNotch90.top + topNotch90.height / 2}`);
    assert.equal(topNotch90.rotation, 90);

    const aabb12 = rotatedBoundingBox({ left: 100, top: 200, width: 300, height: 500, rotation: 12 });
    assert.ok(aabb12.width > 300 && aabb12.bottom > 700, "Rotated AABB should expand beyond unrotated bounds");

    // Prepare tiny valid PNGs for images
    const makeSolidPng = (r, g, b) => {
      const rgba = new Uint8Array(32 * 32 * 4);
      for (let i = 0; i < 32 * 32; i++) {
        rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
      }
      return encodeRgbaPng(32, 32, rgba);
    };
    const imgA = path.join(tmpDir, "a.png");
    const imgB = path.join(tmpDir, "b.png");
    const imgC = path.join(tmpDir, "c.png");
    await fs.writeFile(imgA, makeSolidPng(30, 64, 175));
    await fs.writeFile(imgB, makeSolidPng(16, 185, 129));
    await fs.writeFile(imgC, makeSolidPng(220, 38, 38));

    // F2: Build Original Deck (untouched P1 cover & P2 back cover) + Phase-1 Masters Deck (semantic `slot:*` + chart + `+12°` phone!)
    const origDeck = Presentation.create({ title: "Original Untouched Deck" });
    const oc = origDeck.slides.add({ background: "#0F172A" });
    oc.shapes.add({ name: "untouched-cover-title", left: 80, top: 260, width: 900, height: 120, text: "原版封面一像素不动", textStyle: { fontSize: 48, bold: true, color: "#FFFFFF" } });
    const ob = origDeck.slides.add({ background: "#1E293B" });
    ob.shapes.add({ name: "untouched-back-title", left: 80, top: 280, width: 900, height: 100, text: "原版封底一像素不动", textStyle: { fontSize: 44, bold: true, color: "#F8FAFC" } });
    const origPath = path.join(tmpDir, "orig.pptx");
    await origDeck.save(origPath);

    const mastersDeck = Presentation.create({ title: "Phase-1 Masters" });
    const m1 = mastersDeck.slides.add({ background: "#FAF8F3" });
    const phoneBox = { left: 96, top: 140, width: 280, height: 420, rotation: 12 };
    m1.images.add({ name: "slot:hero_img", path: imgA, geometry: "roundRect", borderRadius: 28, ...phoneBox, fit: "cover", line: { fill: "#FFFFFF", width: 8 } });
    m1.shapes.add({ name: "phone-notch", geometry: "roundRect", borderRadius: 6, ...placeInRotatedFrame(phoneBox, { left: 90, top: 14, width: 100, height: 12 }), fill: "#FFFFFF", line: { fill: "none" } });
    m1.shapes.add({ name: "slot:title", left: 460, top: 120, width: 720, height: 70, text: "母版主标题占位", textStyle: { fontSize: 32, bold: true, color: "#E63946" } });
    m1.shapes.add({ name: "slot:body", left: 460, top: 210, width: 720, height: 140, text: "母版正文说明占位文案，保持等长呼吸感。", textStyle: { fontSize: 15, color: "#1E293B" } });
    m1.charts.add("bar", { left: 460, top: 380, width: 700, height: 240, title: "母版图表占位", categories: ["Q1", "Q2"], series: [{ name: "指标", values: [40, 85], fill: "#E63946" }] });
    m1.shapes.add({ name: "footer", left: 48, top: 676, width: 420, height: 26, text: "2026 | 页脚安全置顶", textStyle: { fontSize: 11, color: "#64748B" } });
    const mastersPath = path.join(tmpDir, "masters.pptx");
    await mastersDeck.save(mastersPath);

    // Cross-PPTX lossless assembly: [orig:1, masters:1, masters:1 (cloned twice!), orig:2]
    const assembledPath = path.join(tmpDir, "assembled.pptx");
    const assembled = await assembleDeck({
      base: "orig",
      sources: { orig: origPath, masters: mastersPath },
      slides: [
        { from: "orig", slide: 1 },
        { from: "masters", slide: 1 },
        { from: "masters", slide: 1 },
        { from: "orig", slide: 2 },
      ],
      outPptxPath: assembledPath,
    });
    assert.equal(assembled.slides.count, 4);
    assert.equal(assembled.slides.getItem(0).getSlot("untouched-cover-title").text.toPlainString(), "原版封面一像素不动");
    assert.equal(assembled.slides.getItem(3).getSlot("untouched-back-title").text.toPlainString(), "原版封底一像素不动");

    // Phase-2 pure in-place slot filling (`recolor` + `getSlot` + `replace`)
    const s2 = assembled.slides.getItem(1);
    s2.recolor({ "#E63946": "#0F3A7D" });
    s2.getSlot("slot:title").text.set("正式业务标题：架构升级");
    s2.getSlot("slot:body").text.set("严格在锁死母版槽位内原位填字换图，不破坏任何几何比例。");
    s2.getSlot("slot:hero_img").replace({ path: imgB, fit: "cover" });

    const s3 = assembled.slides.getItem(2);
    s3.getSlot("slot:title").text.set("第二页复用同款母版");
    s3.getSlot("slot:hero_img").replace({ path: imgC, fit: "cover" });

    const phase2Path = path.join(tmpDir, "phase2_filled.pptx");
    await assembled.save(phase2Path);

    // Validate assembled + filled deck passes ALL 6 gates (zero dangling rels, chart workbooks intact, recolor applied!)
    const p2Buf = await fs.readFile(phase2Path);
    const p2Report = await validateDeckBuffer(p2Buf, { antiSlop: "fail" });
    assert.equal(p2Report.passed, true, `Assembled Phase-2 deck failed gates:\n${JSON.stringify(p2Report.issues, null, 2)}`);
    const s2Xml = readZipBuffer(p2Buf).get("ppt/slides/slide2.xml").toString("utf8");
    assert.ok(s2Xml.includes('val="0F3A7D"'), "slide.recolor must swap #E63946 -> #0F3A7D");

    // F3: Master Slot Integrity Audit (positive + negative sabotage!)
    const auditOk = await auditMasterSlotIntegrity({
      masterPptxPath: mastersPath,
      finalPptxPath: phase2Path,
      slideMap: [
        { slide: 2, masterSlide: 1 },
        { slide: 3, masterSlide: 1 },
      ],
    });
    assert.equal(auditOk.passed, true, `Expected master slot audit to pass: ${JSON.stringify(auditOk.issues)}`);

    // Sabotage: drop the image slot on slide 2 & flip rotation on slide 3!
    const sabMap = readZipBuffer(p2Buf);
    const sabS2 = sabMap.get("ppt/slides/slide2.xml").toString("utf8").replace(/<p:pic\b[\s\S]*?<\/p:pic>/, "");
    sabMap.set("ppt/slides/slide2.xml", Buffer.from(sabS2, "utf8"));
    const sabS3 = sabMap.get("ppt/slides/slide3.xml").toString("utf8").replace(`rot="${12 * 60000}"`, `rot="${348 * 60000}"`);
    sabMap.set("ppt/slides/slide3.xml", Buffer.from(sabS3, "utf8"));
    const sabPath = path.join(tmpDir, "sabotaged_phase2.pptx");
    await fs.writeFile(sabPath, buildZipBuffer([...sabMap.entries()].map(([name, data]) => ({ name, data }))));

    const auditBad = await auditMasterSlotIntegrity({
      masterPptxPath: mastersPath,
      finalPptxPath: sabPath,
      slideMap: [
        { slide: 2, masterSlide: 1 },
        { slide: 3, masterSlide: 1 },
      ],
    });
    assert.equal(auditBad.passed, false);
    const auditCodes = new Set(auditBad.issues.map((i) => i.code));
    assert.ok(auditCodes.has("master_image_slot_dropped"), "Must catch dropped image slot");
    assert.ok(auditCodes.has("master_named_slot_missing"), "Must catch missing named slot");
    assert.ok(auditCodes.has("master_rotation_drifted"), "Must catch flipped rotation angle");

    // F4: Z-order rotated-AABB text occlusion gate (`z_order_text_occluded`)
    const occDeck = Presentation.create({ title: "Z-Order Occlusion Test" });
    const os1 = occDeck.slides.add({ background: "#FFFFFF" });
    // Footer drawn FIRST -> then tilted framed phone card drawn ON TOP covering footer!
    os1.shapes.add({ name: "footer-buried", left: 60, top: 676, width: 320, height: 28, text: "2026 | 页脚被手机压死测试", textStyle: { fontSize: 12, color: "#475569" } });
    os1.images.add({ name: "tilted-phone", path: imgA, left: 100, top: 220, width: 300, height: 490, rotation: 12, fit: "cover", line: { fill: "#FFFFFF", width: 8 } });
    const occReport = await validateDeckBuffer(occDeck.toPptxBuffer(), { antiSlop: "fail" });
    assert.equal(occReport.passed, false, "Foreground framed image burying earlier footer must FAIL validation");
    assert.ok(occReport.issues.some((i) => i.code === "z_order_text_occluded" && i.severity === "fail"));

    // F5: Non-destructive versioned history archival in `finalizeDeck` (`preserveHistory: true`)
    const delivDir = path.join(tmpDir, "deliverables");
    const delivPath = path.join(delivDir, "project_final.pptx");
    const f1 = await finalizeDeck({ candidatePptxPath: origPath, outputPath: delivPath, antiSlop: "fail" });
    assert.equal(f1.archivedPreviousPath, null, "First publish has no previous version to archive");

    // Publish differing v2 -> archives v1 into `deliverables/history/project_final_v1_*.pptx`!
    const f2 = await finalizeDeck({ candidatePptxPath: phase2Path, outputPath: delivPath, antiSlop: "fail" });
    assert.ok(f2.archivedPreviousPath && f2.archivedPreviousPath.includes(`${path.sep}history${path.sep}project_final_v1_`), `Expected v1 archive path, got ${f2.archivedPreviousPath}`);
    assert.equal(sha256(await fs.readFile(f2.archivedPreviousPath)), sha256(await fs.readFile(origPath)), "Archived v1 must match original bytes");

    // Identical re-publish -> no duplicate backup spam!
    const f2Dup = await finalizeDeck({ candidatePptxPath: phase2Path, outputPath: delivPath, antiSlop: "fail" });
    assert.equal(f2Dup.archivedPreviousPath, null, "Re-publishing identical SHA-256 must not create duplicate history entry");

    // Publish differing v3 -> archives v2 as `_v2_`!
    const f3 = await finalizeDeck({ candidatePptxPath: origPath, outputPath: delivPath, antiSlop: "fail" });
    assert.ok(f3.archivedPreviousPath && f3.archivedPreviousPath.includes(`${path.sep}history${path.sep}project_final_v2_`), `Expected v2 archive path, got ${f3.archivedPreviousPath}`);

    // F6: CLI `inspect-ref` grid + exact `+12°` clockwise tilt detection (when Pillow is available)
    const deckCliPath = path.join(REPO_ROOT, "skills/yuanmou-ppt/scripts/deck_cli.mjs");
    const pyCheck = spawnSync("python3", ["-c", "import PIL"], { encoding: "utf8" });
    if (pyCheck.status === 0) {
      const tiltRefPng = path.join(tmpDir, "tilted_ref.png");
      const genTiltPy = `
from PIL import Image, ImageDraw
bg = Image.new("RGBA", (1280, 720), (245, 243, 238, 255))
card = Image.new("RGBA", (260, 440), (30, 64, 175, 255))
d = ImageDraw.Draw(card)
d.rectangle([0, 0, 259, 439], outline=(255, 255, 255, 255), width=12)
# PIL rotate uses counter-clockwise positive; -12 in PIL = +12 deg clockwise in OOXML!
rot = card.rotate(-12, expand=True, resample=Image.Resampling.BICUBIC)
bg.alpha_composite(rot, (60, 140))
bg.convert("RGB").save("${tiltRefPng.replace(/\\/g, "\\\\")}")
`;
      const gRes = spawnSync("python3", ["-c", genTiltPy], { encoding: "utf8" });
      assert.equal(gRes.status, 0, gRes.stderr);

      const inspOut = path.join(tmpDir, "ref_insp");
      const iRes = spawnSync(process.execPath, [deckCliPath, "inspect-ref", "--ref", tiltRefPng, "--out", inspOut], { encoding: "utf8" });
      assert.equal(iRes.status, 0, `deck_cli inspect-ref failed:\n${iRes.stderr}`);
      const inspJson = JSON.parse(iRes.stdout);
      assert.ok(inspJson.gridOverlayPng && (await fs.stat(inspJson.gridOverlayPng)).size > 1000);
      assert.ok(inspJson.layoutSpecJson && (await fs.stat(inspJson.layoutSpecJson)).size > 100);
      const leftZone = inspJson.crops.find((c) => c.name === "left_zone");
      assert.ok(
        leftZone && leftZone.dominantTiltDeg >= 10 && leftZone.dominantTiltDeg <= 14 && leftZone.tiltDirection === "clockwise",
        `Expected left_zone clockwise +12° (±2°), got ${JSON.stringify(leftZone)}`
      );
    }

    // F7: Z-order background contrast lookup, intentional watermark exemption, ECMA-376 roundRect pill math & top-level insets
    {
      const cDeck = Presentation.create({ title: "Contrast & Pill Geometry Test" });
      const cs1 = cDeck.slides.add({ background: "#F3F4F4" });
      // Underlying banner photo + white text on top -> MUST PASS!
      cs1.images.add({ name: "slot:banner_bg", path: imgA, left: 0, top: 0, width: 1280, height: 280, fit: "cover" });
      cs1.shapes.add({
        name: "slot:banner_title",
        geometry: "textbox",
        left: 140,
        top: 120,
        width: 1000,
        height: 60,
        text: "白字压底图应当通过对比度校验",
        textStyle: { fontSize: 36, color: "#FFFFFF", alignment: "center" },
      });
      // Earlier opaque dark card + transparent white textbox -> MUST PASS!
      cs1.shapes.add({ name: "dark-card", geometry: "rect", left: 60, top: 340, width: 400, height: 140, fill: "#0F172A", line: { fill: "none" } });
      cs1.shapes.add({
        name: "white-on-dark-card",
        geometry: "textbox",
        left: 80,
        top: 380,
        width: 360,
        height: 48,
        text: "白字压深色卡片通过校验",
        textStyle: { fontSize: 18, color: "#FFFFFF" },
      });
      // Intentional giant embossed watermark -> MUST PASS!
      cs1.shapes.add({
        name: "slot:bg_watermark",
        geometry: "textbox",
        left: 860,
        top: 300,
        width: 360,
        height: 360,
        text: "韵",
        textStyle: { fontSize: 240, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle", lineSpacing: 1.0 },
      });
      // Wide capsule pill (ECMA-376 corner inset = 0.29289 * r) + small badge with top-level insets -> MUST PASS!
      cs1.shapes.add({
        name: "slot:left_pill",
        geometry: "roundRect",
        borderRadius: 29,
        left: 60,
        top: 540,
        width: 202,
        height: 58,
        fill: "#FF2442",
        line: { fill: "none" },
        text: "左侧类别",
        textStyle: { fontSize: 26, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
      });
      cs1.shapes.add({
        name: "slot:brand_badge",
        geometry: "roundRect",
        borderRadius: 15,
        left: 30,
        top: 34,
        width: 72,
        height: 30,
        fill: "#FF2442",
        line: { fill: "none" },
        insets: { left: 2, right: 2, top: 1, bottom: 1 },
        text: "品牌标",
        textStyle: { fontSize: 11.5, bold: true, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
      });
      const cGood = await validateDeckBuffer(cDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(cGood.passed, true, `Expected clean pass on photo/card contrast & pills, got: ${JSON.stringify(cGood.issues)}`);

      // Negative check: white body text directly over empty #FFFFFF slide -> MUST STILL FAIL `low_contrast_text`!
      const badContrast = Presentation.create({ title: "White on White Fail" });
      const bs1 = badContrast.slides.add({ background: "#FFFFFF" });
      bs1.shapes.add({
        name: "invisible-text",
        geometry: "textbox",
        left: 100,
        top: 200,
        width: 500,
        height: 60,
        text: "纯白底色上的隐形白字必须拦截",
        textStyle: { fontSize: 20, color: "#FAFAFA" },
      });
      const cBad = await validateDeckBuffer(badContrast.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(cBad.passed, false);
      assert.ok(cBad.issues.some((i) => i.code === "low_contrast_text" && i.severity === "fail"), "White text on white slide must still fail low_contrast_text");

      // F8: SVG `viewBox: [minX, minY, w, h]` origin normalization + stroke-only `svgPath` strikethrough + rotated-AABB collision
      const svgDeck = Presentation.create({ title: "SVG ViewBox & Strikethrough Test" });
      const ss1 = svgDeck.slides.add({ background: "#FFFFFF" });
      ss1.shapes.add({
        name: "offset-tri",
        svgPath: "M 500 200 L 700 500 L 300 500 Z",
        viewBox: [300, 200, 400, 300],
        left: 300,
        top: 200,
        width: 400,
        height: 300,
        fill: "#B5C7E7",
        line: { fill: "none" },
      });
      ss1.shapes.add({
        name: "slot:strike_txt",
        geometry: "textbox",
        left: 100,
        top: 100,
        width: 220,
        height: 44,
        text: "「旧标签」",
        textStyle: { fontSize: 22, color: "#000000" },
      });
      ss1.shapes.add({
        name: "decor:strike_stroke",
        svgPath: "M 0 24 L 180 4",
        viewBox: [0, 0, 180, 32],
        left: 110,
        top: 104,
        width: 180,
        height: 32,
        fill: "none",
        line: { fill: "#FF0036", width: 4 },
      });
      const svgBuf = svgDeck.toPptxBuffer();
      const svgSlideXml = readZipBuffer(svgBuf).get("ppt/slides/slide1.xml").toString("utf8");
      // Apex (500 - 300 = 200px = 1905000 EMU, 200 - 200 = 0 EMU) MUST be normalized relative to viewBox minX/minY!
      assert.ok(svgSlideXml.includes('<a:moveTo><a:pt x="1905000" y="0"/></a:moveTo>'), "SVG viewBox [minX,minY,w,h] must subtract minX/minY from path points");
      const svgVal = await validateDeckBuffer(svgBuf, { antiSlop: "fail" });
      assert.equal(svgVal.passed, true, `Stroke-only svgPath over text must not trigger nested_textbox_in_shape: ${JSON.stringify(svgVal.issues)}`);
    }

    // F9: v0.5.0 Vector PDF -> Pure Phase-1 Master Compiler (`parsePageSelectionSpec`, `toNeutralPlaceholderText`, `compilePdfVectorSpecToMasterPptx`)
    {
      assert.deepEqual(parsePageSelectionSpec("1-3,8,2,13-14", 50), [1, 2, 3, 8, 13, 14]);
      const neutral = toNeutralPlaceholderText("如果妈妈是一份职业 — 2023 IP!");
      assert.equal(neutral.length, "如果妈妈是一份职业 — 2023 IP!".length);
      assert.ok(!neutral.includes("妈妈") && !neutral.includes("2023"), `Neutral placeholder must strip business copy: ${neutral}`);

      const pdfCompiledPath = path.join(tmpDir, "compiled_masters.pptx");
      const compiledRes = await compilePdfVectorSpecToMasterPptx({
        outPptxPath: pdfCompiledPath,
        placeholdersDir: path.join(tmpDir, "compiled_ph"),
        pages: [
          {
            page: 2,
            pdfKind: "vector",
            slideBgHex: "#FFFFFF",
            expectedImageCount: 1,
            drawings: [
              { x: 650, y: 220, w: 260, h: 60, fill: "#FF0036", fillOpacity: 1, stroke: null, strokeW: 0, opCount: 6, isCapsule: true },
              {
                x: 822,
                y: 22,
                w: 458,
                h: 642,
                fill: "#FF0036",
                fillOpacity: 0.22,
                stroke: null,
                strokeW: 0,
                opCount: 3,
                svgPath: "M 1280 22 L 1280 390 L 878 424 Z",
                viewBox: [822, 22, 458, 642],
              },
            ],
            images: [
              {
                x: 0,
                y: 105,
                w: 620,
                h: 615,
                topRgb: [130, 100, 80],
                botRgb: [60, 44, 34],
                clipSvgPath: "M 329 105 L 620 400 L 323 720 L 0 720 L 0 291 Z",
                clipViewBox: [0, 105, 620, 615],
              },
            ],
            texts: [
              { text: "商业核心标题", x: 640, y: 90, w: 380, h: 64, fontPt: 40, font: "PingFangSC-Semibold", color: "#000000", dir: [1, 0] },
              { text: "CAREER", x: 460, y: 120, w: 80, h: 320, fontPt: 60, font: "STSongti-SC-Regular", color: "#E0E0E0", dir: [0, 1] },
            ],
          },
        ],
      });
      assert.equal(compiledRes.slideCount, 1);
      assert.equal(compiledRes.totalImageSlots, 1);
      assert.equal(compiledRes.totalTextSlots, 2);
      const compBuf = await fs.readFile(pdfCompiledPath);
      const compVal = await validateDeckBuffer(compBuf, { antiSlop: "off", masterMode: true });
      assert.equal(compVal.passed, true, `Compiled vector master must pass masterMode validation: ${JSON.stringify(compVal.issues)}`);
      const compXml = readZipBuffer(compBuf).get("ppt/slides/slide1.xml").toString("utf8");
      assert.ok(compXml.includes('name="slot:img_1"') && compXml.includes("<a:custGeom>"), "Compiled image must keep native custGeom clip");
      assert.ok(compXml.includes('name="decor:text_2"'), "Rotated background text must be tagged decor:* in unified scene model");
      assert.ok(!compXml.includes("商业核心标题"), "Pure Phase-1 compiler must strip original business copy by default");

      // F9b: Upgraded `makeNeutralPlaceholderPng` (regular dashed+icon vs masked no-border vs full-bleed background corner-badge)
      const phStdPath = path.join(tmpDir, "ph_std.png");
      const phMaskPath = path.join(tmpDir, "ph_mask.png");
      const phBgPath = path.join(tmpDir, "ph_bg.png");
      await makeNeutralPlaceholderPng(phStdPath, 400, 260);
      await makeNeutralPlaceholderPng(phMaskPath, 300, 300, { masked: true });
      await makeNeutralPlaceholderPng(phBgPath, 1280, 288, [48, 58, 72], [28, 35, 46]);

      const pxDiffFromGrad = (decoded, x, y, topRgb, botRgb) => {
        const t = y / Math.max(1, decoded.height - 1);
        const er = Math.round(topRgb[0] * (1 - t) + botRgb[0] * t);
        const eg = Math.round(topRgb[1] * (1 - t) + botRgb[1] * t);
        const eb = Math.round(topRgb[2] * (1 - t) + botRgb[2] * t);
        const off = (y * decoded.width + x) * 4;
        return Math.max(
          Math.abs(decoded.rgba[off] - er),
          Math.abs(decoded.rgba[off + 1] - eg),
          Math.abs(decoded.rgba[off + 2] - eb)
        );
      };
      const maxDiffInBox = (decoded, x0, y0, x1, y1, topRgb, botRgb) => {
        let best = 0;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const d = pxDiffFromGrad(decoded, x, y, topRgb, botRgb);
            if (d > best) best = d;
          }
        }
        return best;
      };

      const dStd = decodePngToRgba(await fs.readFile(phStdPath));
      assert.ok(maxDiffInBox(dStd, 150, 85, 250, 175, [226, 232, 240], [203, 213, 225]) >= 50, "Standard placeholder must draw high-contrast centered picture icon");
      assert.ok(maxDiffInBox(dStd, 8, 8, 40, 20, [226, 232, 240], [203, 213, 225]) >= 35, "Standard placeholder must draw visible dashed inset border");

      const dMask = decodePngToRgba(await fs.readFile(phMaskPath));
      assert.ok(maxDiffInBox(dMask, 100, 100, 200, 200, [226, 232, 240], [203, 213, 225]) >= 50, "Masked placeholder must draw centered picture icon");
      assert.equal(maxDiffInBox(dMask, 6, 6, 40, 25, [226, 232, 240], [203, 213, 225]), 0, "Masked placeholder must omit rectangular dashed border");

      const dBg = decodePngToRgba(await fs.readFile(phBgPath));
      assert.equal(maxDiffInBox(dBg, 580, 100, 700, 190, [48, 58, 72], [28, 35, 46]), 0, "Wide banner/background placeholder must keep center clear for foreground headlines");
      assert.ok(maxDiffInBox(dBg, 1180, 215, 1265, 275, [48, 58, 72], [28, 35, 46]) >= 40, "Wide banner/background placeholder must place corner media badge");
    }

    // F10: Unified Scene Model (`decor:*` role without magic watermark name) + Hard Phase-1/Phase-2 Cryptographic Receipt (`master_verified.json`)
    {
      const decorDeck = Presentation.create({ title: "Unified Decor Role Test" });
      const ds1 = decorDeck.slides.add({ background: "#FFFFFF" });
      // Named `decor:en_accent` (NO "watermark" substring!) sitting behind a foreground card -> MUST PASS via unified `role === "decor"`!
      ds1.shapes.add({
        name: "decor:en_accent",
        geometry: "textbox",
        left: 120,
        top: 120,
        width: 420,
        height: 84,
        text: "EDITORIAL",
        textStyle: { fontSize: 48, color: "#ECECEC" },
      });
      ds1.shapes.add({
        name: "slot:fg_card",
        geometry: "rect",
        left: 140,
        top: 140,
        width: 280,
        height: 120,
        fill: "#0F172A",
        line: { fill: "none" },
        text: "前景主卡片正文内容",
        textStyle: { fontSize: 18, color: "#FFFFFF", alignment: "center", verticalAlignment: "middle" },
      });
      const decorVal = await validateDeckBuffer(decorDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(decorVal.passed, true, `Unified decor:* role must exempt decorative bg text cleanly: ${JSON.stringify(decorVal.issues)}`);

      // Cryptographic receipt enforcement in `deck_cli.mjs verify --master ... --require-master-receipt`
      const rDir = path.join(tmpDir, "receipt_gate");
      await fs.mkdir(rDir, { recursive: true });
      const rMaster = path.join(rDir, "masters.pptx");
      const rCand = path.join(rDir, "candidate.pptx");
      await fs.copyFile(mastersPath, rMaster);
      await fs.copyFile(phase2Path, rCand);
      const rMasterSha = sha256(await fs.readFile(rMaster));

      // 1) Missing receipt + `--require-master-receipt` -> MUST FAIL!
      const missRes = spawnSync(
        process.execPath,
        [deckCliPath, "verify", "--pptx", rCand, "--master", rMaster, "--master-map", "2:1", "--require-master-receipt", "--out", path.join(rDir, "qa1")],
        { encoding: "utf8" }
      );
      assert.notEqual(missRes.status, 0, "Missing master_verified.json with --require-master-receipt must fail");
      assert.ok((missRes.stderr || "").includes("MASTER_RECEIPT_MISSING"), `Expected MASTER_RECEIPT_MISSING, got: ${missRes.stderr}`);

      // 2) Receipt with `passed: false` -> MUST FAIL even without `--require-master-receipt`!
      const receiptPath = path.join(rDir, "master_verified.json");
      await fs.writeFile(receiptPath, JSON.stringify({ schema: "yuanmou.master.verified/v1", passed: false, masterSha256: rMasterSha }));
      const failRecRes = spawnSync(
        process.execPath,
        [deckCliPath, "verify", "--pptx", rCand, "--master", rMaster, "--master-map", "2:1", "--out", path.join(rDir, "qa2")],
        { encoding: "utf8" }
      );
      assert.notEqual(failRecRes.status, 0, "Failed Phase-1 receipt must block Phase-2 verify");
      assert.ok((failRecRes.stderr || "").includes("MASTER_RECEIPT_INVALID"), `Expected MASTER_RECEIPT_INVALID, got: ${failRecRes.stderr}`);

      // 3) Stale SHA-256 receipt -> MUST FAIL!
      await fs.writeFile(receiptPath, JSON.stringify({ schema: "yuanmou.master.verified/v1", passed: true, masterSha256: "0".repeat(64) }));
      const staleRes = spawnSync(
        process.execPath,
        [deckCliPath, "verify", "--pptx", rCand, "--master", rMaster, "--master-map", "2:1", "--out", path.join(rDir, "qa3")],
        { encoding: "utf8" }
      );
      assert.notEqual(staleRes.status, 0, "Stale masterSha256 receipt must block Phase-2 verify");
      assert.ok((staleRes.stderr || "").includes("MASTER_RECEIPT_STALE"), `Expected MASTER_RECEIPT_STALE, got: ${staleRes.stderr}`);

      // 4) Unslotted master in `verify-master` -> MUST FAIL `slotContractPassed: false`!
      const unslottedDeck = Presentation.create({ title: "Unslotted Master" });
      const us1 = unslottedDeck.slides.add({ background: "#FFFFFF" });
      us1.shapes.add({ name: "random_box", left: 100, top: 100, width: 400, height: 80, text: "没有命名槽位的假母版", textStyle: { fontSize: 20, color: "#111827" } });
      const unslottedPath = path.join(rDir, "unslotted.pptx");
      await unslottedDeck.save(unslottedPath);
      const vmFail = spawnSync(
        process.execPath,
        [deckCliPath, "verify-master", "--pptx", unslottedPath, "--out", path.join(rDir, "qa_unslotted")],
        { encoding: "utf8" }
      );
      assert.notEqual(vmFail.status, 0, "verify-master must fail when a master slide has 0 slot:* elements");
      const vmJson = JSON.parse(vmFail.stdout);
      assert.equal(vmJson.slotContractPassed, false);
      assert.deepEqual(vmJson.unslottedSlides, [1]);
    }

    console.log("  [PASS] v0.5.0 Two-Stage & Unified Scene Architecture verified! (pdf-to-master compiler, unified scene decor/effectiveBg/aabb model, SVG viewBox minX/minY, cryptographic master_verified.json SHA-256 contract, slotContractPassed hard gate)");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testRedBlueHardeningV060() {
  console.log("=== [G] Verifying v0.6.0 Red-Blue Defensive Hardening (pdf-to-master Fusion/Z-Order/Alpha, decor:* Anti-Abuse, Unicode Emoji, Geometry Invariance, Cross-Canvas/Theme assembleDeck, Default Receipt Gate & Tiny Dummy Photo Block) ===");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym_v060_redblue_"));
  const deckCliPath = path.join(REPO_ROOT, "skills/yuanmou-ppt/scripts/deck_cli.mjs");
  try {
    const makeSolidPng = (r, g, b, w = 32, h = 32) => {
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
      }
      return encodeRgbaPng(w, h, rgba);
    };
    const imgA = path.join(tmpDir, "a.png");
    await fs.writeFile(imgA, makeSolidPng(30, 64, 175));

    // G1: `decor:body_1` long-text & filled-card gate-bypass attack MUST be blocked!
    {
      const abuseDeck = Presentation.create({ title: "Decor Abuse Test" });
      const s1 = abuseDeck.slides.add({ background: "#FFFFFF" });
      // Attack A: 24-char white-on-white body paragraph disguised as `decor:body_1` -> MUST FAIL low_contrast_text!
      s1.shapes.add({
        name: "decor:body_1",
        geometry: "textbox",
        left: 80,
        top: 100,
        width: 600,
        height: 60,
        text: "这是一段恶意改名试图绕过低对比度质检的长正文内容测试",
        textStyle: { fontSize: 18, color: "#FAFAFA" },
      });
      // Attack B: Filled card disguised as `decor:card_1` with low-contrast white text -> MUST FAIL!
      s1.shapes.add({
        name: "decor:card_1",
        geometry: "rect",
        left: 80,
        top: 220,
        width: 240,
        height: 60,
        fill: "#FFFFFF",
        line: { fill: "none" },
        text: "隐形卡片",
        textStyle: { fontSize: 18, color: "#FCFCFC" },
      });
      const abuseVal = await validateDeckBuffer(abuseDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(abuseVal.passed, false, "decor:body_1 long-text & filled-card abuse must fail validation");
      const lcElements = abuseVal.issues.filter((i) => i.code === "low_contrast_text").map((i) => i.element);
      assert.ok(lcElements.includes("decor:body_1"), "Long text disguised as decor:body_1 must be caught");
      assert.ok(lcElements.includes("decor:card_1"), "Filled card disguised as decor:card_1 must be caught");
    }

    // G2: Standard Unicode `\p{Extended_Pictographic}` catches arbitrary emojis (🚀) while exempting corporate ©®™ & trend arrows ↗↘
    {
      const emojiDeck = Presentation.create({ title: "Unicode Emoji Test" });
      const es = emojiDeck.slides.add({ background: "#FFFFFF" });
      es.shapes.add({
        name: "slot:emoji_lead",
        left: 80,
        top: 100,
        width: 500,
        height: 48,
        text: "🚀 火箭启动全链路增长方案",
        textStyle: { fontSize: 18, color: "#111827" },
      });
      const eBad = await validateDeckBuffer(emojiDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(eBad.passed, false);
      assert.ok(eBad.issues.some((i) => i.code === "dirty_emoji_symbol" && i.severity === "fail"), "Unicode emoji 🚀 must trigger fail");

      const corpDeck = Presentation.create({ title: "Corporate Symbols Clean" });
      const cs = corpDeck.slides.add({ background: "#FFFFFF" });
      cs.shapes.add({
        name: "slot:corp_kpi",
        left: 80,
        top: 100,
        width: 600,
        height: 48,
        text: "© 2026 Brand™ 季度转化率 ↗ +12.5% ↔ 稳定增长",
        textStyle: { fontSize: 16, color: "#111827" },
      });
      const eGood = await validateDeckBuffer(corpDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(eGood.passed, true, `Corporate symbols ©®™↗↔ must NOT trigger dirty_emoji_symbol: ${JSON.stringify(eGood.issues)}`);
    }

    // G3: Editorial highlighter bar behind oversized display title passes, while true nested textbox inside container still fails
    {
      const hlDeck = Presentation.create({ title: "Editorial Highlighter Test" });
      const hs = hlDeck.slides.add({ background: "#0F172A" });
      hs.shapes.add({ name: "decor:hl_bar", geometry: "rect", left: 378, top: 402, width: 580, height: 78, fill: "#FF0036", line: { fill: "none" } });
      hs.shapes.add({ name: "slot:hero_txt", geometry: "textbox", left: 340, top: 358, width: 680, height: 135, text: "「核心主张」", textStyle: { fontSize: 80, bold: true, color: "#FFFFFF" } });
      const hlVal = await validateDeckBuffer(hlDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(hlVal.passed, true, `Shorter editorial highlighter strip behind 80pt title must pass: ${JSON.stringify(hlVal.issues)}`);

      const nestDeck = Presentation.create({ title: "True Nested Textbox Fail" });
      const ns = nestDeck.slides.add({ background: "#FFFFFF" });
      ns.shapes.add({ name: "btn_bg", geometry: "roundRect", borderRadius: 20, left: 100, top: 100, width: 260, height: 64, fill: "#FF0036", line: { fill: "none" } });
      ns.shapes.add({ name: "btn_txt", geometry: "textbox", left: 120, top: 112, width: 220, height: 40, text: "分开套框必须拦", textStyle: { fontSize: 18, color: "#FFFFFF" } });
      const nVal = await validateDeckBuffer(nestDeck.toPptxBuffer(), { antiSlop: "fail" });
      assert.equal(nVal.passed, false);
      assert.ok(nVal.issues.some((i) => i.code === "nested_textbox_in_shape"), "True textbox nested inside painted container must still fail");
    }

    // G4: `pdf-to-master` container+text fusion + true painter's zOrder + elongated marker stroke + text alpha
    {
      const fusedPath = path.join(tmpDir, "fused_zorder_masters.pptx");
      const res = await compilePdfVectorSpecToMasterPptx({
        outPptxPath: fusedPath,
        placeholdersDir: path.join(tmpDir, "fused_ph"),
        pages: [
          {
            page: 6,
            pdfKind: "vector",
            slideBgHex: "#FFFFFF",
            expectedImageCount: 1,
            images: [{ x: 0, y: 0, w: 1280, h: 720, zOrder: 1, topRgb: [120, 120, 130], botRgb: [60, 60, 70] }],
            drawings: [
              { x: 0, y: 0, w: 1280, h: 720, fill: "#000000", fillOpacity: 0.25, stroke: null, strokeW: 0, opCount: 1, zOrder: 2 },
              { x: 640, y: 200, w: 260, h: 60, fill: "#FF0036", fillOpacity: 1, stroke: null, strokeW: 0, opCount: 6, isCapsule: true, zOrder: 3 },
              { x: 640, y: 340, w: 190, h: 36, fill: "#FF0036", fillOpacity: 1, stroke: null, strokeW: 8, opCount: 333, isStrokePath: true, svgPath: "M 642 368 L 826 346", viewBox: [640, 340, 190, 36], zOrder: 7 },
            ],
            texts: [
              { text: "胶囊标签", x: 690, y: 214, w: 150, h: 32, fontPt: 20, font: "PingFangSC-Semibold", color: "#FFFFFF", dir: [1, 0], zOrder: 4 },
              { text: "「被划掉词」", x: 630, y: 330, w: 210, h: 52, fontPt: 24, font: "PingFangSC-Regular", color: "#FFFFFF", dir: [1, 0], zOrder: 5 },
              { text: "？", x: 320, y: 20, w: 460, h: 660, fontPt: 496, font: "PingFangSC-Regular", color: "#FF0036", alpha: 0.14, dir: [1, 0], zOrder: 6 },
            ],
          },
        ],
      });
      assert.equal(res.slideCount, 1);
      const fBuf = await fs.readFile(fusedPath);
      const fVal = await validateDeckBuffer(fBuf, { antiSlop: "off", masterMode: true });
      assert.equal(fVal.passed, true, `Fused/Z-ordered vector master must pass masterMode with 0 FAILs: ${JSON.stringify(fVal.issues)}`);
      const fXml = readZipBuffer(fBuf).get("ppt/slides/slide1.xml").toString("utf8");
      const posImg = fXml.indexOf('name="slot:img_1"');
      const posScrim = fXml.indexOf('name="decor:vec_1"');
      const posChip = fXml.indexOf('name="slot:chip_1"');
      const posStrikeTxt = fXml.indexOf('name="slot:text_2"');
      const posStroke = fXml.indexOf('name="decor:stroke_2"');
      assert.ok(posImg > 0 && posScrim > posImg, "Scrim (zOrder 2) must be drawn AFTER photo (zOrder 1)");
      assert.ok(posChip > posScrim, "Fused capsule chip (zOrder 3/4) must be emitted as single slot:chip_1 AFTER scrim");
      assert.ok(posStroke > posStrikeTxt, "Elongated marker strikethrough (zOrder 7) must be drawn AFTER text (zOrder 5)");
      assert.ok(fXml.includes('<a:alpha val="14000"/>'), "Translucent text alpha=0.14 must emit <a:alpha val=\"14000\"/>");
    }

    // G5: `auditMasterSlotIntegrity` blocks missing slideMap on mismatched counts & blocks shrinking/dragging slots
    {
      const mDeck = Presentation.create({ title: "Master Geo Lock" });
      const ms = mDeck.slides.add({ background: "#FFFFFF" });
      ms.images.add({ name: "slot:hero_img", path: imgA, left: 80, top: 120, width: 420, height: 480, fit: "cover" });
      ms.shapes.add({ name: "slot:title", left: 560, top: 120, width: 640, height: 80, text: "母版主标题", textStyle: { fontSize: 32, color: "#111827" } });
      const mPath = path.join(tmpDir, "geo_master.pptx");
      await mDeck.save(mPath);

      // 2-slide final deck audited without slideMap against 1-slide master -> MUST FAIL missing_master_slide_map!
      const twoDeck = Presentation.create({ title: "Two Slide Final" });
      twoDeck.slides.add({ background: "#FFFFFF" }).images.add({ name: "slot:hero_img", path: imgA, left: 80, top: 120, width: 420, height: 480 });
      twoDeck.slides.add({ background: "#FFFFFF" }).shapes.add({ name: "unmapped", left: 100, top: 100, width: 400, height: 60, text: "第二页逃逸" });
      const twoPath = path.join(tmpDir, "two_final.pptx");
      await twoDeck.save(twoPath);
      const missMapAudit = await auditMasterSlotIntegrity({ masterPptxPath: mPath, finalPptxPath: twoPath });
      assert.equal(missMapAudit.passed, false);
      assert.ok(missMapAudit.issues.some((i) => i.code === "missing_master_slide_map"), "Must fail missing_master_slide_map when counts differ & slideMap omitted");

      // Shrunk 20x20 dummy hero_img + dragged/collapsed title -> MUST FAIL geometry invariance!
      const shrunkDeck = Presentation.create({ title: "Shrunk Slot Bypass" });
      const ss = shrunkDeck.slides.add({ background: "#FFFFFF" });
      ss.images.add({ name: "slot:hero_img", path: imgA, left: 80, top: 120, width: 20, height: 20, fit: "cover" });
      ss.shapes.add({ name: "slot:title", left: 100, top: 600, width: 200, height: 30, text: "漂移标题", textStyle: { fontSize: 16, color: "#111827" } });
      const shrunkPath = path.join(tmpDir, "shrunk_final.pptx");
      await shrunkDeck.save(shrunkPath);
      const geoAudit = await auditMasterSlotIntegrity({ masterPptxPath: mPath, finalPptxPath: shrunkPath });
      assert.equal(geoAudit.passed, false);
      const gCodes = new Set(geoAudit.issues.map((i) => i.code));
      assert.ok(gCodes.has("master_image_slot_geometry_drifted"), "Must catch shrunk/drifted image slot");
      assert.ok(gCodes.has("master_text_slot_geometry_drifted"), "Must catch collapsed/drifted text slot");
    }

    // G6: `assembleDeck` rejects 4:3 into 16:9, auto-scales 10in->13.333in same-aspect slides, and materializes foreign `<a:schemeClr>`
    {
      const baseDeck = Presentation.create({ title: "Base 16x9 13.333in" });
      baseDeck.slides.add({ background: "#FFFFFF" }).shapes.add({ name: "base_t", left: 80, top: 80, width: 400, height: 60, text: "基准页" });
      const basePath = path.join(tmpDir, "base_16x9.pptx");
      await baseDeck.save(basePath);

      // Build a legacy 10in x 5.625in (9144000 x 5143500 EMU) foreign deck with custom theme accent1=#FF2442 & `<a:schemeClr val="accent1">`
      const legacySrc = Presentation.create({ title: "Legacy 10in Deck" });
      legacySrc.slides.add({ background: "#FFFFFF" }).shapes.add({
        name: "legacy_box",
        left: 96,
        top: 72,
        width: 300,
        height: 90,
        fill: "#112233",
        text: "缩放与主题色验证",
        textStyle: { fontSize: 18, color: "#FFFFFF" },
      });
      const legMap = readZipBuffer(legacySrc.toPptxBuffer());
      legMap.set(
        "ppt/presentation.xml",
        Buffer.from(
          legMap.get("ppt/presentation.xml").toString("utf8").replace(/<p:sldSz\b[^>]+\/>/, '<p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>'),
          "utf8"
        )
      );
      legMap.set(
        "ppt/theme/theme1.xml",
        Buffer.from(
          legMap.get("ppt/theme/theme1.xml").toString("utf8").replace(/<a:accent1>[\s\S]*?<\/a:accent1>/, '<a:accent1><a:srgbClr val="FF2442"/></a:accent1>'),
          "utf8"
        )
      );
      legMap.set(
        "ppt/slides/slide1.xml",
        Buffer.from(
          legMap.get("ppt/slides/slide1.xml").toString("utf8").replace(
            '<a:srgbClr val="112233"/>',
            '<a:schemeClr val="accent1"><a:alpha val="80000"/></a:schemeClr>'
          ),
          "utf8"
        )
      );
      const legacyPath = path.join(tmpDir, "legacy_10in.pptx");
      await fs.writeFile(legacyPath, buildZipBuffer([...legMap.entries()].map(([name, data]) => ({ name, data }))));

      const merged = await assembleDeck({
        base: "base",
        sources: { base: basePath, leg: legacyPath },
        slides: [{ from: "base", slide: 1 }, { from: "leg", slide: 1 }],
      });
      const mergedXml = readZipBuffer(merged.toPptxBuffer()).get("ppt/slides/slide2.xml").toString("utf8");
      // 96px * 9525 * (4/3) = 1219200 EMU; 18pt (1800) * (4/3) = 2400!
      assert.ok(mergedXml.includes(`x="${Math.round(96 * 9525 * (12192000 / 9144000))}"`), "Legacy 10in slide coordinates must auto-scale 1.333x to base 13.333in");
      assert.ok(mergedXml.includes('sz="2400"'), "Legacy 10in font size 18pt must auto-scale to 24pt (2400)");
      assert.ok(mergedXml.includes('<a:srgbClr val="FF2442"><a:alpha val="80000"/></a:srgbClr>'), "Foreign schemeClr must materialize to concrete srgbClr preserving child <a:alpha>");

      // Build a 4:3 incompatible deck (9144000 x 6858000) -> MUST THROW!
      const map43 = readZipBuffer(legacySrc.toPptxBuffer());
      map43.set(
        "ppt/presentation.xml",
        Buffer.from(
          map43.get("ppt/presentation.xml").toString("utf8").replace(/<p:sldSz\b[^>]+\/>/, '<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>'),
          "utf8"
        )
      );
      const path43 = path.join(tmpDir, "deck_4x3.pptx");
      await fs.writeFile(path43, buildZipBuffer([...map43.entries()].map(([name, data]) => ({ name, data }))));
      await assert.rejects(
        () => assembleDeck({ base: "base", sources: { base: basePath, s43: path43 }, slides: [{ from: "base", slide: 1 }, { from: "s43", slide: 1 }] }),
        /incompatible slide aspect ratio/
      );
    }

    // G7: `verify --master` enforces `master_verified.json` BY DEFAULT (without needing `--require-master-receipt`), and allows explicit `--allow-unverified-master`
    {
      const rDir = path.join(tmpDir, "default_receipt_gate");
      await fs.mkdir(rDir, { recursive: true });
      const mDeck = Presentation.create({ title: "Receipt Master" });
      mDeck.slides.add({ background: "#FFFFFF" }).shapes.add({ name: "slot:t1", left: 80, top: 80, width: 600, height: 60, text: "默认签收校验母版", textStyle: { fontSize: 24, color: "#111827" } });
      const rMaster = path.join(rDir, "masters.pptx");
      await mDeck.save(rMaster);

      // Without receipt AND without `--require-master-receipt` -> MUST FAIL by default!
      const defFail = spawnSync(
        process.execPath,
        [deckCliPath, "verify", "--pptx", rMaster, "--master", rMaster, "--out", path.join(rDir, "qa_fail")],
        { encoding: "utf8" }
      );
      assert.notEqual(defFail.status, 0, "verify --master must reject missing master_verified.json BY DEFAULT");
      assert.ok((defFail.stderr || "").includes("MASTER_RECEIPT_MISSING"), `Expected MASTER_RECEIPT_MISSING, got: ${defFail.stderr}`);

      // With explicit `--allow-unverified-master` -> MUST SUCCEED and record `bypassed_explicitly`!
      const allowOk = spawnSync(
        process.execPath,
        [deckCliPath, "verify", "--pptx", rMaster, "--master", rMaster, "--allow-unverified-master", "--out", path.join(rDir, "qa_allow")],
        { encoding: "utf8" }
      );
      assert.equal(allowOk.status, 0, `verify --master --allow-unverified-master should succeed: ${allowOk.stderr}`);
      const allowJson = JSON.parse(allowOk.stdout);
      assert.equal(allowJson.masterReceipt.status, "bypassed_explicitly");
      assert.equal(allowJson.twoStageAudit.enforced, true);
    }

    // G8: `verify-master` blocks `tiny_dummy_photo_slot` bypass (1 tiny 20x20 image vs photo-rich ref) when full visual toolchain is available
    {
      const envCheck = spawnSync(process.execPath, [deckCliPath, "check-env", "--no-update-check"], { encoding: "utf8" });
      const envJson = envCheck.status === 0 ? JSON.parse(envCheck.stdout) : null;
      if (envJson?.mode === "full-visual" && envJson?.toolchain?.hasPillow) {
        const dDir = path.join(tmpDir, "dummy_photo_gate");
        const dRefs = path.join(dDir, "refs");
        await fs.mkdir(dRefs, { recursive: true });
        // Synthesize a photo-rich colorful high-variance reference image (`refPhotoTilePct >> 25%`)
        const photoW = 640, photoH = 360;
        const pRgba = new Uint8Array(photoW * photoH * 4);
        for (let y = 0; y < photoH; y++) {
          for (let x = 0; x < photoW; x++) {
            const off = (y * photoW + x) * 4;
            pRgba[off] = (x * 7 + y * 3 + ((x ^ y) * 11)) & 255;
            pRgba[off + 1] = (x * 5 + y * 13 + ((x * y) >> 3)) & 255;
            pRgba[off + 2] = (x * 11 + y * 7 + ((x + y) * 9)) & 255;
            pRgba[off + 3] = 255;
          }
        }
        await fs.writeFile(path.join(dRefs, "ref_01.png"), encodeRgbaPng(photoW, photoH, pRgba));

        const dummyMaster = Presentation.create({ title: "Tiny Dummy Photo Master" });
        const dm = dummyMaster.slides.add({ background: "#FFFFFF" });
        dm.images.add({ name: "slot:tiny_cheat", path: imgA, left: 20, top: 20, width: 20, height: 20 });
        dm.shapes.add({ name: "slot:title", left: 80, top: 80, width: 600, height: 60, text: "假图占位绕过测试", textStyle: { fontSize: 24, color: "#111827" } });
        const dmPath = path.join(dDir, "dummy_master.pptx");
        await dummyMaster.save(dmPath);

        const dmRes = spawnSync(
          process.execPath,
          [deckCliPath, "verify-master", "--pptx", dmPath, "--ref-dir", dRefs, "--out", path.join(dDir, "qa")],
          { encoding: "utf8" }
        );
        assert.notEqual(dmRes.status, 0, "Tiny 20x20 dummy image on photo-rich ref must fail verify-master");
        const dmJson = JSON.parse(dmRes.stdout);
        assert.equal(dmJson.photoSlotAuditPassed, false);
        assert.equal(dmJson.xrayBatches.length, 0, "verify-master must default to 2-panel side-by-side without generating 3-panel xray batches");
        assert.ok(dmJson.missingPhotoSlotIssues.some((x) => x.code === "tiny_dummy_photo_slot"), `Expected tiny_dummy_photo_slot, got: ${JSON.stringify(dmJson.missingPhotoSlotIssues)}`);
      }
    }

    // G9: Pure raster PDF in `pdf-to-master` cleanly falls back to bitmap route (no fake stub masters.pptx!)
    {
      const pyCheck = spawnSync("python3", ["-c", "import pymupdf, PIL"], { encoding: "utf8" });
      if (pyCheck.status === 0) {
        const rasDir = path.join(tmpDir, "raster_fallback");
        await fs.mkdir(rasDir, { recursive: true });
        const rasPdf = path.join(rasDir, "pure_raster.pdf");
        const mkRasPy = `
from PIL import Image
im = Image.new("RGB", (640, 360), (240, 236, 228))
im.save(${JSON.stringify(rasPdf)}, "PDF")
`;
        assert.equal(spawnSync("python3", ["-c", mkRasPy], { encoding: "utf8" }).status, 0);
        const outDir = path.join(rasDir, "out");
        const p2m = spawnSync(
          process.execPath,
          [deckCliPath, "pdf-to-master", "--pdf", rasPdf, "--pages", "1", "--out", outDir],
          { encoding: "utf8" }
        );
        assert.equal(p2m.status, 0, `pdf-to-master pure raster fallback failed:\n${p2m.stderr}`);
        const p2mJson = JSON.parse(p2m.stdout);
        assert.equal(p2mJson.mode, "fallback_to_bitmap");
        assert.equal(p2mJson.mastersPptx, null);
        assert.equal(await fs.stat(path.join(outDir, "masters.pptx")).then(() => true, () => false), false, "Pure raster PDF must NOT write a fake stub masters.pptx");
        assert.equal(await fs.stat(path.join(outDir, "master_refs", "m01_p01.png")).then(() => true, () => false), true, "Pure raster fallback must export master_refs PNG");
      }
      // Mixed PDF raster page must NOT emit fake slot:* names
      const mixPath = path.join(tmpDir, "mixed_raster.pptx");
      await compilePdfVectorSpecToMasterPptx({
        outPptxPath: mixPath,
        placeholdersDir: path.join(tmpDir, "mixed_ph"),
        pages: [{ page: 1, pdfKind: "raster", slideBgHex: "#FFFFFF" }],
      });
      const mixXml = readZipBuffer(await fs.readFile(mixPath)).get("ppt/slides/slide1.xml").toString("utf8");
      assert.ok(!mixXml.includes('name="slot:'), "Unrebuilt raster page must not emit fake slot:* elements");
    }

    console.log("  [PASS] v0.6.1 Red-Blue Hardening & Pure-Raster Bitmap Fallback verified!");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testTrialIndexLazyRefreshAnd404Recovery() {
  console.log("[8/8] Testing LocalStandaloneProvider lazy 24h TTL + ETag revalidation + offline fallback + 404 recovery...");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ym-trial-ttl-"));
  const { gzipSync } = await import("node:zlib");
  const { LocalStandaloneProvider } = await import("../../packages/pptx-kit/index.mjs");

  const dbV1 = Buffer.from("SQLITE_MOCK_DB_V1");
  const dbV2 = Buffer.from("SQLITE_MOCK_DB_V2_UPDATED");
  let currentVersion = 1;
  let headCount = 0;
  let getCount = 0;
  let serverDown = false;

  const server = http.createServer((req, res) => {
    if (serverDown) {
      res.writeHead(503);
      res.end("down");
      return;
    }
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/ppt-index-trial.db.gz") {
      const etag = currentVersion === 1 ? '"etag-v1"' : '"etag-v2"';
      if (req.method === "HEAD") {
        headCount++;
        res.writeHead(200, { ETag: etag });
        res.end();
        return;
      }
      if (req.method === "GET") {
        getCount++;
        const payload = gzipSync(currentVersion === 1 ? dbV1 : dbV2);
        res.writeHead(200, { ETag: etag, "Content-Type": "application/gzip" });
        res.end(payload);
        return;
      }
    }
    if (u.pathname === "/previews/CP_deleted_tier1.png") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Initial sync downloads V1
    const p1 = new LocalStandaloneProvider({
      cacheDir: tmpDir,
      trialBaseUrl: baseUrl,
      enablePublicTrial: true,
      indexTtlMs: 60_000,
    });
    const s1 = await p1.syncSlideIndex();
    assert.equal(s1.cached, false);
    assert.equal(s1.etag, '"etag-v1"');
    assert.equal(getCount, 1);
    assert.equal(headCount, 0);

    // 2. Within TTL -> 0 network calls!
    const s2 = await p1.syncSlideIndex();
    assert.equal(s2.cached, true);
    assert.equal(s2.source, "public-trial-cache");
    assert.equal(getCount, 1);
    assert.equal(headCount, 0);

    // 3. After TTL with SAME ETag -> HEAD only, 0 full GET downloads!
    const pExpired = new LocalStandaloneProvider({
      cacheDir: tmpDir,
      trialBaseUrl: baseUrl,
      enablePublicTrial: true,
      indexTtlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 15));
    const s3 = await pExpired.syncSlideIndex();
    assert.equal(s3.cached, true);
    assert.equal(s3.revalidated, true);
    assert.equal(s3.source, "public-trial-cache-etag");
    assert.equal(headCount, 1);
    assert.equal(getCount, 1);

    // 4. After TTL when server is down -> graceful offline fallback!
    serverDown = true;
    await new Promise((r) => setTimeout(r, 15));
    const sOffline = await pExpired.syncSlideIndex();
    assert.equal(sOffline.cached, true);
    assert.equal(sOffline.source, "public-trial-cache-offline-fallback");
    assert.equal(getCount, 1);
    serverDown = false;

    // 5. After TTL with CHANGED ETag -> downloads V2 atomically!
    currentVersion = 2;
    const pFresh = new LocalStandaloneProvider({
      cacheDir: tmpDir,
      trialBaseUrl: baseUrl,
      enablePublicTrial: true,
      indexTtlMs: 1,
    });
    await new Promise((r) => setTimeout(r, 15));
    const s4 = await pFresh.syncSlideIndex();
    assert.equal(s4.cached, false);
    assert.equal(s4.etag, '"etag-v2"');
    assert.equal(getCount, 2);
    assert.equal((await fs.readFile(pFresh.trialIndexDbPath)).toString("utf8"), dbV2.toString("utf8"));

    // 6. On 404 preview PNG -> automatically force-refreshes index once and tags PREVIEW_NOT_FOUND
    let err404 = null;
    try {
      await pFresh.fetchAsset({ kind: "preview", contentPageId: "CP_deleted_tier1" });
    } catch (err) {
      err404 = err;
    }
    assert.ok(err404, "Expected 404 preview to throw structured error");
    assert.equal(err404.code, "PREVIEW_NOT_FOUND");
    assert.equal(err404.indexRefreshed, true);
    assert.equal(getCount, 3, "Expected single-flight force refresh on first 404");

    console.log("  [PASS] Lazy 24h TTL + ETag revalidation + offline fallback + 404 auto-refresh verified!");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  await testPluggableProviders();
  await testM3Finalizer();
  await testSkillUpdater();
  await testBrushMaskAndTypographyUpgrades();
  await testSelectionEngine2();
  await testTwoStageArchitectureV040();
  await testRedBlueHardeningV060();
  await testTrialIndexLazyRefreshAnd404Recovery();
  console.log("\nALL PROVIDER SPI + M3 FINALIZER + SKILL UPDATER + V0.1.6 + SELECTION ENGINE 2.0 + V0.4.0/V0.5.0/V0.6.0/V0.6.3 ARCHITECTURE TESTS PASSED!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
