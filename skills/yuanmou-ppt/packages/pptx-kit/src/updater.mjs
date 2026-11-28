// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { atomicReplaceFile, defaultCacheRoot } from "./providers/base-provider.mjs";

export const KIT_VERSION = "0.6.2";
export const GITHUB_REPO = "YuanMouJun/yuanmou-ppt-skill";

// Flipped to `true` automatically by `pack_workbuddy_marketplace.mjs` so platform-hosted packages
// rely strictly on marketplace version management and never fetch external script updates.
const MARKETPLACE_BUILD = false;

const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FAILED_RETRY_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown on offline/timeout
const PASSIVE_BUDGET_MS = 1500;
const EXPLICIT_TIMEOUT_MS = 8000;

const SAFE_REL_PATH_RE = /^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/;
const SAFE_SHA256_RE = /^[0-9a-f]{64}$/;
const ALLOWED_UPDATE_EXTS = new Set([".md", ".mjs", ".json", ".yaml", ".yml", ".txt"]);

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function sha256FileOrEmpty(filePath) {
  if (!existsSync(filePath)) return "";
  try {
    const buf = await fs.readFile(filePath);
    return sha256Buffer(buf);
  } catch {
    return "";
  }
}

export function compareSemver(a, b) {
  const parse = (v) => {
    const clean = String(v || "").trim().replace(/^[vV]/, "").split("+", 1)[0];
    const [core, pre = ""] = clean.split("-", 2);
    const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
    return { major: nums[0] || 0, minor: nums[1] || 0, patch: nums[2] || 0, pre };
  };
  const va = parse(a);
  const vb = parse(b);
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  if (!va.pre && vb.pre) return 1;
  if (va.pre && !vb.pre) return -1;
  return va.pre.localeCompare(vb.pre);
}

function buildManifestUrls(ref = "main", baseUrlOverride = "", bustCache = false) {
  const qs = bustCache ? `?t=${Date.now()}` : "";
  if (baseUrlOverride) {
    const base = baseUrlOverride.replace(/\/+$/, "");
    return [{ source: "custom-mirror", url: `${base}/${ref}/skills/yuanmou-ppt/skill-manifest.json${qs}` }];
  }
  return [
    {
      source: "jsdelivr-cdn",
      url: `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@${ref}/skills/yuanmou-ppt/skill-manifest.json`,
    },
    {
      source: "jsdelivr-fastly",
      url: `https://fastly.jsdelivr.net/gh/${GITHUB_REPO}@${ref}/skills/yuanmou-ppt/skill-manifest.json`,
    },
    {
      source: "github-raw",
      url: `https://raw.githubusercontent.com/${GITHUB_REPO}/${ref}/skills/yuanmou-ppt/skill-manifest.json${qs}`,
    },
  ];
}

function buildRawFileUrls(refs, relPosixPath, baseUrlOverride = "") {
  const urls = [];
  if (baseUrlOverride) {
    const base = baseUrlOverride.replace(/\/+$/, "");
    for (const ref of refs) {
      urls.push(`${base}/${ref}/skills/yuanmou-ppt/${relPosixPath}`);
    }
    return urls;
  }
  for (const ref of refs) {
    urls.push(`https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@${ref}/skills/yuanmou-ppt/${relPosixPath}`);
    urls.push(`https://fastly.jsdelivr.net/gh/${GITHUB_REPO}@${ref}/skills/yuanmou-ppt/${relPosixPath}`);
    urls.push(`https://raw.githubusercontent.com/${GITHUB_REPO}/${ref}/skills/yuanmou-ppt/${relPosixPath}`);
  }
  return urls;
}

async function fetchWithTimeout(url, timeoutMs, parentSignal) {
  const signals = [AbortSignal.timeout(Math.max(100, timeoutMs))];
  if (parentSignal) signals.push(parentSignal);
  const signal = signals.length > 1 && AbortSignal.any ? AbortSignal.any(signals) : signals[0];
  return fetch(url, {
    signal,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": `yuanmou-ppt-skill/${KIT_VERSION}`,
    },
  });
}

async function fetchManifestFromEndpoints(ref, timeoutMs, parentSignal, baseUrlOverride = "", bustCache = false) {
  const candidates = buildManifestUrls(ref, baseUrlOverride, bustCache);
  let lastErr = null;
  for (const item of candidates) {
    if (parentSignal?.aborted) break;
    try {
      const res = await fetchWithTimeout(item.url, timeoutMs, parentSignal);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${item.source}`);
        continue;
      }
      const rawText = await res.text();
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed.version !== "string" || typeof parsed.files !== "object") {
        lastErr = new Error(`Invalid skill-manifest schema from ${item.source}`);
        continue;
      }
      return { manifest: parsed, rawText, source: item.source, ref };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Unable to reach update mirror endpoints");
}

async function probeNewestReleaseTag(timeoutMs, baseUrlOverride = "") {
  if (baseUrlOverride) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      Math.min(timeoutMs, 3500)
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tag = String(data?.tag_name || "").trim();
    return tag ? tag.replace(/^[vV]/, "") : null;
  } catch {
    return null;
  }
}

function assertSafeManifestFiles(realSkillDir, filesObj) {
  const entries = Object.entries(filesObj || {});
  if (entries.length === 0) {
    throw new Error("Remote skill-manifest contains zero files; aborting update.");
  }
  for (const [relPath, sha] of entries) {
    if (
      !SAFE_REL_PATH_RE.test(relPath) ||
      relPath.split("/").some((seg) => seg === "." || seg === ".." || seg.startsWith("."))
    ) {
      throw new Error(`Unsafe relative path in skill-manifest: "${relPath}"`);
    }
    const ext = path.extname(relPath).toLowerCase();
    if (!ALLOWED_UPDATE_EXTS.has(ext)) {
      throw new Error(`Disallowed file extension in skill-manifest: "${relPath}"`);
    }
    if (!SAFE_SHA256_RE.test(String(sha || ""))) {
      throw new Error(`Invalid SHA-256 digest for "${relPath}" in skill-manifest`);
    }
    const resolved = path.resolve(realSkillDir, ...relPath.split("/"));
    const prefix = realSkillDir.endsWith(path.sep) ? realSkillDir : `${realSkillDir}${path.sep}`;
    if (!resolved.startsWith(prefix)) {
      throw new Error(`Path traversal blocked for "${relPath}"`);
    }
  }
  return entries;
}

function getUpdateCachePath(cacheDir) {
  return path.join(defaultCacheRoot(cacheDir), "update-check.json");
}

async function readUpdateCache(cachePath) {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeUpdateCache(cachePath, data) {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await atomicReplaceFile(tmp, cachePath);
  } catch {
    // non-fatal cache write failure
  }
}

function formatUpdateReport({ currentVersion, latestVersion, highlights, source, skillDir }) {
  const available = compareSemver(latestVersion, currentVersion) > 0;
  const updateCommand = skillDir
    ? `node "${path.join(skillDir, "scripts", "deck_cli.mjs")}" update`
    : "npx skills add YuanMouJun/yuanmou-ppt-skill";
  return {
    available,
    currentVersion,
    latestVersion,
    highlights: highlights || "",
    source: source || "cache",
    updateCommand,
    ...(available
      ? {
          notice: `检测到 yuanmou-ppt 新版本 v${latestVersion}（当前 v${currentVersion}）${
            highlights ? `：${highlights}` : ""
          }。如需升级可执行：${updateCommand}`,
        }
      : {}),
  };
}

/**
 * Non-blocking China-direct version check (`cdn.jsdelivr.net` -> `fastly.jsdelivr.net` -> `raw.githubusercontent.com`).
 * Cached locally for 24h; strictly bounded to <= 1.5s in passive mode; returns `null` silently when offline.
 */
export async function checkSkillUpdate(options = {}) {
  if (
    MARKETPLACE_BUILD ||
    process.env.YUANMOU_CHANNEL === "workbuddy-marketplace" ||
    process.env.YUANMOU_OFFLINE === "1" ||
    process.env.YUANMOU_NO_UPDATE_CHECK === "1"
  ) {
    return null;
  }

  const force = Boolean(options.force);
  const currentVersion = options.currentVersion || KIT_VERSION;
  const skillDir = options.skillDir || "";
  const baseUrlOverride = options.baseUrlOverride || process.env.YUANMOU_UPDATE_MIRROR || "";
  const cachePath = getUpdateCachePath(options.cacheDir);
  const now = Date.now();

  if (!force) {
    const cached = await readUpdateCache(cachePath);
    if (cached) {
      if (cached.latestVersion && cached.checkedAt && now - cached.checkedAt < UPDATE_CACHE_TTL_MS) {
        return formatUpdateReport({
          currentVersion,
          latestVersion: cached.latestVersion,
          highlights: cached.highlights,
          source: "local-cache",
          skillDir,
        });
      }
      if (cached.lastFailedAt && now - cached.lastFailedAt < FAILED_RETRY_COOLDOWN_MS) {
        return null;
      }
    }
  }

  try {
    if (!force) {
      const budgetCtrl = new AbortController();
      const timer = setTimeout(() => budgetCtrl.abort(), options.timeoutMs || PASSIVE_BUDGET_MS);
      try {
        const fetched = await fetchManifestFromEndpoints(
          "main",
          options.timeoutMs || 900,
          budgetCtrl.signal,
          baseUrlOverride,
          false
        );
        await writeUpdateCache(cachePath, {
          checkedAt: now,
          latestVersion: fetched.manifest.version,
          highlights: fetched.manifest.highlights || "",
          source: fetched.source,
        });
        return formatUpdateReport({
          currentVersion,
          latestVersion: fetched.manifest.version,
          highlights: fetched.manifest.highlights,
          source: fetched.source,
          skillDir,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    // Explicit check (`force: true`): check both China-direct `@main` and latest GitHub Release tag
    const timeoutMs = options.timeoutMs || EXPLICIT_TIMEOUT_MS;
    const [mainRes, releaseVer] = await Promise.all([
      fetchManifestFromEndpoints("main", timeoutMs, null, baseUrlOverride, true).catch((err) => ({ error: err })),
      probeNewestReleaseTag(timeoutMs, baseUrlOverride),
    ]);

    let chosen = mainRes && !mainRes.error ? mainRes : null;
    if (releaseVer && (!chosen || compareSemver(releaseVer, chosen.manifest.version) > 0)) {
      const tagRes = await fetchManifestFromEndpoints(`v${releaseVer}`, timeoutMs, null, baseUrlOverride, true).catch(
        () => null
      );
      if (tagRes) chosen = tagRes;
    }

    if (!chosen) {
      throw mainRes?.error || new Error("Unable to fetch latest version metadata from mirrors");
    }

    await writeUpdateCache(cachePath, {
      checkedAt: now,
      latestVersion: chosen.manifest.version,
      highlights: chosen.manifest.highlights || "",
      source: chosen.source,
    });

    return formatUpdateReport({
      currentVersion,
      latestVersion: chosen.manifest.version,
      highlights: chosen.manifest.highlights,
      source: chosen.source,
      skillDir,
    });
  } catch (err) {
    if (!force) {
      await writeUpdateCache(cachePath, { lastFailedAt: now });
      return null;
    }
    throw err;
  }
}

async function fetchVerifiedBytes(urls, expectedSha256, timeoutMs) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const actualSha = sha256Buffer(buf);
      if (actualSha !== expectedSha256) {
        lastErr = new Error(`SHA-256 mismatch from ${url} (expected ${expectedSha256.slice(0, 12)}, got ${actualSha.slice(0, 12)})`);
        continue;
      }
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Failed to download and verify update file");
}

async function syncColocatedPluginVersion(realSkillDir, newVersion) {
  const pluginJsonPath = path.resolve(realSkillDir, "..", "..", "plugin.json");
  if (!existsSync(pluginJsonPath)) return;
  try {
    const raw = JSON.parse(await fs.readFile(pluginJsonPath, "utf8"));
    if (raw && raw.name === "yuanmou-ppt" && raw.version !== newVersion) {
      raw.version = newVersion;
      const tmp = `${pluginJsonPath}.tmp.${process.pid}`;
      await fs.writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      await atomicReplaceFile(tmp, pluginJsonPath);
    }
  } catch {
    // ignore non-critical plugin manifest sync
  }
}

async function isYuanmouSkillGitClone(maybeRepoRoot) {
  if (!existsSync(path.join(maybeRepoRoot, ".git"))) return false;
  const pkgPath = path.join(maybeRepoRoot, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    return pkg?.name === "@yuanmou/pptx-kit";
  } catch {
    return false;
  }
}

/**
 * Checks whether a dirty git worktree in `yuanmou-ppt-skill` was caused SOLELY by a prior
 * China-CDN fallback update (all modified/untracked files reside inside `skills/yuanmou-ppt/`
 * and every file matches local `skill-manifest.json` SHA-256), rather than manual user edits.
 */
async function isDirtyOnlyFromPriorCdnSync(maybeRepoRoot, realSkillDir, porcelainOutput) {
  const localManifestPath = path.join(realSkillDir, "skill-manifest.json");
  if (!existsSync(localManifestPath)) return false;
  let localManifest;
  try {
    localManifest = JSON.parse(await fs.readFile(localManifestPath, "utf8"));
  } catch {
    return false;
  }
  const manifestFiles = localManifest?.files;
  if (!manifestFiles || typeof manifestFiles !== "object") return false;

  const lines = String(porcelainOutput || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return false;

  for (const line of lines) {
    // Porcelain v1 format: `XY path` or `XY orig -> renamed`
    const rawPath = line.slice(3).split(" -> ").pop()?.trim().replace(/^"|"$/g, "");
    if (!rawPath || !rawPath.startsWith("skills/yuanmou-ppt/")) {
      return false;
    }
    const relToSkill = rawPath.slice("skills/yuanmou-ppt/".length);
    if (!relToSkill || relToSkill === "skill-manifest.json") continue;
    const fullPath = path.join(realSkillDir, ...relToSkill.split("/"));
    if (!existsSync(fullPath)) {
      // Deleted file is ok ONLY if it is no longer listed in local `skill-manifest.json`
      if (Object.hasOwn(manifestFiles, relToSkill)) return false;
      continue;
    }
    const expectedSha = manifestFiles[relToSkill];
    if (!expectedSha) return false;
    const actualSha = await sha256FileOrEmpty(fullPath);
    if (actualSha !== expectedSha) return false;
  }
  return true;
}

/**
 * Explicit user-triggered one-click skill updater:
 * 1) Uses `git pull --ff-only` if installed via clean Git clone of `yuanmou-ppt-skill` (falling back to China CDN if GitHub is unreachable).
 * 2) Otherwise performs SHA-256 verified incremental file sync from China-accessible jsDelivr/GitHub mirrors,
 *    verifying 100% of changed files in memory BEFORE writing anything to disk.
 */
export async function selfUpdateSkill(options = {}) {
  if (MARKETPLACE_BUILD || process.env.YUANMOU_CHANNEL === "workbuddy-marketplace") {
    return {
      ok: false,
      updated: false,
      reason: "marketplace_managed",
      message: "当前为开放平台市场托管版本，请直接在客户端技能市场中检查并升级版本。",
    };
  }

  const skillDirInput = options.skillDir;
  if (!skillDirInput || !existsSync(skillDirInput)) {
    throw new Error(`Skill directory not found: ${skillDirInput}`);
  }
  const realSkillDir = await fs.realpath(skillDirInput);
  if (!existsSync(path.join(realSkillDir, "SKILL.md"))) {
    throw new Error(`Refusing to update "${realSkillDir}": SKILL.md not found.`);
  }

  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const currentVersion = options.currentVersion || KIT_VERSION;
  const baseUrlOverride = options.baseUrlOverride || process.env.YUANMOU_UPDATE_MIRROR || "";
  const timeoutMs = options.timeoutMs || EXPLICIT_TIMEOUT_MS;
  const cachePath = getUpdateCachePath(options.cacheDir);

  // Path A: Verified Git repository checkout of `yuanmou-ppt-skill` (`<repo>/skills/yuanmou-ppt`)
  // Never misidentify a user's own project repo (`<user-project>/skills/yuanmou-ppt`)!
  const maybeRepoRoot = path.resolve(realSkillDir, "..", "..");
  const isGitRepo =
    (!baseUrlOverride || options.testGitRepoCheck) &&
    !options.cdnOnly &&
    (await isYuanmouSkillGitClone(maybeRepoRoot));
  if (isGitRepo) {
    const statusRes = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: maybeRepoRoot,
      encoding: "utf8",
      timeout: 5000,
    });
    const isDirty = statusRes.status === 0 && Boolean(statusRes.stdout.trim());
    const priorCdnSyncedOnly = isDirty
      ? await isDirtyOnlyFromPriorCdnSync(maybeRepoRoot, realSkillDir, statusRes.stdout)
      : false;
    if (isDirty && !priorCdnSyncedOnly && !force && !dryRun) {
      return {
        ok: false,
        updated: false,
        reason: "dirty_git_worktree",
        fromVersion: currentVersion,
        skillDir: realSkillDir,
        message:
          "检测到本地 Git 仓库有未提交的修改，已保护跳过覆盖。请先 git commit / stash 后重试，或使用 `--force` 仅通过镜像同步技能目录。",
      };
    }
    if (!isDirty && !dryRun) {
      const pullRes = spawnSync("git", ["pull", "--ff-only"], {
        cwd: maybeRepoRoot,
        encoding: "utf8",
        timeout: 12000,
      });
      if (pullRes.status === 0) {
        let newVer = currentVersion;
        let highlights = "";
        const localManifestPath = path.join(realSkillDir, "skill-manifest.json");
        if (existsSync(localManifestPath)) {
          try {
            const m = JSON.parse(await fs.readFile(localManifestPath, "utf8"));
            newVer = m.version || newVer;
            highlights = m.highlights || "";
          } catch {
            // ignore
          }
        }
        await syncColocatedPluginVersion(realSkillDir, newVer);
        await writeUpdateCache(cachePath, {
          checkedAt: Date.now(),
          latestVersion: newVer,
          highlights,
          source: "git-pull",
        });
        const alreadyUpToDate = /already up to date/i.test(pullRes.stdout || "") && newVer === currentVersion;
        return {
          ok: true,
          updated: !alreadyUpToDate,
          method: "git-pull",
          fromVersion: currentVersion,
          toVersion: newVer,
          highlights,
          skillDir: realSkillDir,
        };
      }
      // If `git pull` failed (e.g. GitHub blocked/timeout in Mainland China), fall through seamlessly to CDN sync!
    }
  }

  // Path B: China-direct CDN SHA-256 verified incremental sync
  const [mainRes, releaseVer] = await Promise.all([
    fetchManifestFromEndpoints("main", timeoutMs, null, baseUrlOverride, true).catch((err) => ({ error: err })),
    probeNewestReleaseTag(timeoutMs, baseUrlOverride),
  ]);

  let chosen = mainRes && !mainRes.error ? mainRes : null;
  if (releaseVer && (!chosen || compareSemver(releaseVer, chosen.manifest.version) > 0)) {
    const tagRes = await fetchManifestFromEndpoints(`v${releaseVer}`, timeoutMs, null, baseUrlOverride, true).catch(
      () => null
    );
    if (tagRes) chosen = tagRes;
  }
  if (!chosen) {
    throw mainRes?.error || new Error("无法连接更新镜像节点，请检查网络后重试。");
  }

  const remoteManifest = chosen.manifest;
  const entries = assertSafeManifestFiles(realSkillDir, remoteManifest.files);

  // Read previous local manifest (if any) to identify removed files cleanly
  let prevFiles = {};
  const localManifestPath = path.join(realSkillDir, "skill-manifest.json");
  if (existsSync(localManifestPath)) {
    try {
      const prev = JSON.parse(await fs.readFile(localManifestPath, "utf8"));
      if (prev && typeof prev.files === "object") prevFiles = prev.files;
    } catch {
      // ignore
    }
  }

  const changedEntries = [];
  for (const [relPath, expectedSha] of entries) {
    const fullPath = path.resolve(realSkillDir, ...relPath.split("/"));
    const localSha = await sha256FileOrEmpty(fullPath);
    if (localSha !== expectedSha) {
      changedEntries.push([relPath, expectedSha]);
    }
  }

  const remoteSet = new Set(entries.map(([k]) => k));
  const removedRelPaths = Object.keys(prevFiles).filter(
    (oldRel) => !remoteSet.has(oldRel) && SAFE_REL_PATH_RE.test(oldRel)
  );

  if (
    changedEntries.length === 0 &&
    removedRelPaths.length === 0 &&
    existsSync(localManifestPath) &&
    compareSemver(remoteManifest.version, currentVersion) <= 0
  ) {
    await writeUpdateCache(cachePath, {
      checkedAt: Date.now(),
      latestVersion: remoteManifest.version,
      highlights: remoteManifest.highlights || "",
      source: chosen.source,
    });
    return {
      ok: true,
      updated: false,
      method: "already-latest",
      fromVersion: currentVersion,
      toVersion: remoteManifest.version,
      updatedFilesCount: 0,
      updatedFiles: [],
      highlights: remoteManifest.highlights || "",
      skillDir: realSkillDir,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      updated: false,
      dryRun: true,
      method: "cdn-incremental-dry-run",
      source: chosen.source,
      fromVersion: currentVersion,
      toVersion: remoteManifest.version,
      willUpdateCount: changedEntries.length,
      willUpdateFiles: changedEntries.map(([p]) => p),
      willRemoveFiles: removedRelPaths,
      highlights: remoteManifest.highlights || "",
      skillDir: realSkillDir,
    };
  }

  // Prefer immutable git tag `@vX.Y.Z` first (falling back to `chosen.ref` / `main` via SHA-256 verification)
  const candidateRefs = Array.from(new Set([`v${remoteManifest.version}`, chosen.ref, "main"]));

  // Download & SHA-256 verify ALL changed files in memory BEFORE touching any file on disk!
  const stagedBuffers = new Map();
  const concurrency = 6;
  for (let i = 0; i < changedEntries.length; i += concurrency) {
    const batch = changedEntries.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ([relPath, expectedSha]) => {
        const urls = buildRawFileUrls(candidateRefs, relPath, baseUrlOverride);
        const verifiedBuf = await fetchVerifiedBytes(urls, expectedSha, timeoutMs);
        stagedBuffers.set(relPath, verifiedBuf);
      })
    );
  }

  // Atomically commit verified files to disk
  for (const [relPath, buf] of stagedBuffers.entries()) {
    const destPath = path.resolve(realSkillDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmpPath, buf);
    await atomicReplaceFile(tmpPath, destPath);
  }

  // Remove obsolete files from previous manifest
  for (const oldRel of removedRelPaths) {
    const oldFull = path.resolve(realSkillDir, ...oldRel.split("/"));
    const prefix = realSkillDir.endsWith(path.sep) ? realSkillDir : `${realSkillDir}${path.sep}`;
    if (oldFull.startsWith(prefix) && existsSync(oldFull)) {
      await fs.rm(oldFull, { force: true }).catch(() => {});
    }
  }

  // Write updated `skill-manifest.json` last
  const manifestTmp = `${localManifestPath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(manifestTmp, `${JSON.stringify(remoteManifest, null, 2)}\n`, "utf8");
  await atomicReplaceFile(manifestTmp, localManifestPath);

  await syncColocatedPluginVersion(realSkillDir, remoteManifest.version);
  await writeUpdateCache(cachePath, {
    checkedAt: Date.now(),
    latestVersion: remoteManifest.version,
    highlights: remoteManifest.highlights || "",
    source: chosen.source,
  });

  return {
    ok: true,
    updated: true,
    method: "cdn-incremental",
    source: chosen.source,
    fromVersion: currentVersion,
    toVersion: remoteManifest.version,
    updatedFilesCount: changedEntries.length,
    updatedFiles: changedEntries.map(([p]) => p),
    removedFiles: removedRelPaths,
    highlights: remoteManifest.highlights || "",
    skillDir: realSkillDir,
  };
}
