#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Atomic Release & Dual-ZIP Verification Pipeline:
// Prevents stale `.zip` bundles, version drift, privacy leaks, or missing GitHub Release assets.
//
// Usage:
//   1) Full release (bump + manifest + test + dual zip + audit + local stage + commit/tag/push + GH release + CDN purge):
//      npm run release -- --version 0.1.4 --highlights "本次更新亮点..."
//   2) Rebuild, cryptographically verify both ZIPs & sync local staging + current GitHub Release asset:
//      npm run release:sync
//   3) Pre-push / CI verification gate (no git commit or remote push):
//      npm run release:verify

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { generateSkillManifest } from "./sync_skill_manifest.mjs";
import { readZipBuffer } from "../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_FRONTMATTER_BRANDS_RE =
  /\b(Microsoft|PowerPoint|Keynote|WPS|LibreOffice|Poppler|Claude|OpenAI|ChatGPT|Cursor|Google|Feishu|Lark)\b/i;

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function runChecked(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: opts.capture ? "pipe" : "inherit",
    ...opts,
  });
  if (res.status !== 0) {
    const detail = opts.capture ? `\n${res.stderr || res.stdout}` : "";
    throw new Error(`Command failed (${cmd} ${args.join(" ")}): exit ${res.status}${detail}`);
  }
  return res;
}

async function runPrivacyGate() {
  const res = spawnSync(
    "git",
    [
      "grep",
      "--untracked",
      "-n",
      "-iE",
      "gdrive|google.?drive|Nelson-zhou|/Users/",
      "--",
      ".",
      ":(exclude)scripts/release.mjs",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  if (res.status === 0 && res.stdout.trim()) {
    throw new Error(`[PRIVACY GATE BLOCKED] Sensitive or hardcoded local path detected:\n${res.stdout}`);
  }
}

async function verifyUniversalSkillZip(zipPath, expectedVersion) {
  if (!existsSync(zipPath)) {
    throw new Error(`Missing universal skill ZIP: ${zipPath}`);
  }
  const rawZip = await fs.readFile(zipPath);
  if (rawZip.length < 50 * 1024) {
    throw new Error(`Universal skill ZIP suspiciously small (${rawZip.length} bytes)`);
  }
  const entries = readZipBuffer(rawZip);

  const manifestBuf = entries.get("yuanmou-ppt/skill-manifest.json");
  if (!manifestBuf) {
    throw new Error("yuanmou-ppt-skill.zip missing yuanmou-ppt/skill-manifest.json");
  }
  const manifest = JSON.parse(manifestBuf.toString("utf8"));
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `yuanmou-ppt-skill.zip manifest version mismatch: expected ${expectedVersion}, got ${manifest.version}`
    );
  }

  const skillMd = entries.get("yuanmou-ppt/SKILL.md")?.toString("utf8") || "";
  const fmVer = skillMd.match(/^version:\s*([^\r\n]+)/m)?.[1]?.trim();
  if (fmVer !== expectedVersion) {
    throw new Error(`yuanmou-ppt-skill.zip SKILL.md version mismatch: expected ${expectedVersion}, got ${fmVer}`);
  }

  const updaterSrc = entries.get("yuanmou-ppt/packages/pptx-kit/src/updater.mjs")?.toString("utf8") || "";
  if (!updaterSrc.includes(`export const KIT_VERSION = "${expectedVersion}";`)) {
    throw new Error(`yuanmou-ppt-skill.zip KIT_VERSION does not match ${expectedVersion}`);
  }

  for (const [relPath, expectedSha] of Object.entries(manifest.files || {})) {
    const fileBuf = entries.get(`yuanmou-ppt/${relPath}`);
    if (!fileBuf) {
      throw new Error(`yuanmou-ppt-skill.zip missing file listed in skill-manifest: ${relPath}`);
    }
    const actualSha = sha256Buffer(fileBuf);
    if (actualSha !== expectedSha) {
      throw new Error(`yuanmou-ppt-skill.zip SHA-256 mismatch on ${relPath}`);
    }
  }

  return {
    zipPath,
    bytes: rawZip.length,
    sha256: sha256Buffer(rawZip),
    entryCount: entries.size,
  };
}

async function verifyWorkBuddyMarketplaceZip(zipPath, expectedVersion) {
  if (!existsSync(zipPath)) {
    throw new Error(`Missing WorkBuddy marketplace ZIP: ${zipPath}`);
  }
  const rawZip = await fs.readFile(zipPath);
  if (rawZip.length < 50 * 1024 || rawZip.length > 3 * 1024 * 1024) {
    throw new Error(`WorkBuddy ZIP size (${rawZip.length} bytes) out of valid range (50KB..3MB)`);
  }
  const entries = readZipBuffer(rawZip);

  for (const entryName of entries.keys()) {
    const segments = entryName.split("/").filter(Boolean);
    if (segments[0] !== "yuanmou-ppt") {
      throw new Error(`WorkBuddy ZIP entry outside root folder yuanmou-ppt/: ${entryName}`);
    }
    // `yuanmou-ppt/SKILL.md` (2 segments) or `yuanmou-ppt/scripts/<file>` (3 segments = 2 directory levels)
    if (segments.length > 3) {
      throw new Error(`WorkBuddy ZIP exceeds 2-level directory depth limit: ${entryName}`);
    }
  }

  const skillMd = entries.get("yuanmou-ppt/SKILL.md")?.toString("utf8") || "";
  const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    throw new Error("WorkBuddy ZIP SKILL.md missing YAML frontmatter");
  }
  const frontmatter = fmMatch[1];
  const fmVer = frontmatter.match(/^version:\s*([^\r\n]+)/m)?.[1]?.trim();
  if (fmVer !== expectedVersion) {
    throw new Error(`WorkBuddy ZIP SKILL.md version mismatch: expected ${expectedVersion}, got ${fmVer}`);
  }
  const brandHit = frontmatter.match(FORBIDDEN_FRONTMATTER_BRANDS_RE);
  if (brandHit) {
    throw new Error(`WorkBuddy ZIP frontmatter contains third-party brand term "${brandHit[0]}"`);
  }

  const wbUpdater = entries.get("yuanmou-ppt/scripts/kit-updater.mjs")?.toString("utf8") || "";
  if (/https?:\/\//i.test(wbUpdater)) {
    throw new Error("WorkBuddy ZIP kit-updater.mjs must not contain external HTTP(S) update URLs");
  }
  const wbLocalProv = entries.get("yuanmou-ppt/scripts/kit-provider-local-provider.mjs")?.toString("utf8") || "";
  if (!wbLocalProv.includes('DEFAULT_PUBLIC_TRIAL_BASE_URL = ""')) {
    throw new Error("WorkBuddy ZIP kit-provider-local-provider.mjs must default to pure offline mode");
  }

  return {
    zipPath,
    bytes: rawZip.length,
    sha256: sha256Buffer(rawZip),
    entryCount: entries.size,
  };
}

async function syncLocalStageDir(stageDir, expectedVersion, universalInfo, workbuddyInfo) {
  if (!stageDir || !existsSync(stageDir)) return null;

  const destWbZip = path.join(stageDir, "yuanmou-ppt-workbuddy-marketplace.zip");
  const destUniZip = path.join(stageDir, "yuanmou-ppt-skill.zip");
  const destUnpacked = path.join(stageDir, "yuanmou-ppt");

  await fs.copyFile(workbuddyInfo.zipPath, destWbZip);
  await fs.copyFile(universalInfo.zipPath, destUniZip);

  // Refresh unpacked `workbuddy/yuanmou-ppt/` from the verified WorkBuddy ZIP
  const wbEntries = readZipBuffer(await fs.readFile(destWbZip));
  await fs.rm(destUnpacked, { recursive: true, force: true });
  for (const [entryPath, buf] of wbEntries.entries()) {
    const outFile = path.join(stageDir, ...entryPath.split("/"));
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, buf);
  }

  const versionMeta = {
    version: expectedVersion,
    syncedAt: new Date().toISOString(),
    files: {
      "yuanmou-ppt-workbuddy-marketplace.zip": {
        useFor: "腾讯 WorkBuddy 开放平台后台上架提审（2层扁平纯离线包）",
        bytes: workbuddyInfo.bytes,
        sha256: workbuddyInfo.sha256,
      },
      "yuanmou-ppt-skill.zip": {
        useFor: "GitHub Release / OpenClaw / Trae / Qoder / Claude / 本地客户端直接拖入安装（含国内直连增量更新）",
        bytes: universalInfo.bytes,
        sha256: universalInfo.sha256,
      },
    },
  };
  await fs.writeFile(path.join(stageDir, "VERSION.json"), `${JSON.stringify(versionMeta, null, 2)}\n`, "utf8");
  return { stageDir, version: expectedVersion };
}

async function installGitPrePushHook() {
  const hooksDir = path.join(REPO_ROOT, ".git", "hooks");
  if (!existsSync(hooksDir)) return false;
  const hookPath = path.join(hooksDir, "pre-push");
  const hookScript = `#!/usr/bin/env sh
# Auto-generated by scripts/release.mjs: blocks pushing stale skill-manifest.json and refreshes dist/*.zip + local staging.
set -e
if [ "$YUANMOU_SKIP_PREPUSH" = "1" ]; then
  exit 0
fi
echo "[yuanmou-ppt pre-push] Running manifest, privacy & dual-ZIP verification gate..."
node scripts/release.mjs --verify-only --sync-stage --skip-tests
if ! git diff --quiet -- skills/yuanmou-ppt/skill-manifest.json skills/yuanmou-ppt/SKILL.md skills/yuanmou-ppt/packages/pptx-kit/src/updater.mjs; then
  echo "[PRE-PUSH BLOCKED] skill-manifest.json or version metadata was out of sync and has just been refreshed."
  echo "Please commit the updated manifest (or use \`npm run release -- --version X.Y.Z --highlights \"...\"\`) and push again."
  exit 1
fi
`;
  await fs.writeFile(hookPath, hookScript, { encoding: "utf8", mode: 0o755 });
  await fs.chmod(hookPath, 0o755);
  return hookPath;
}

async function main() {
  const { values } = parseArgs({
    allowNegative: true,
    options: {
      version: { type: "string" },
      highlights: { type: "string" },
      notes: { type: "string" },
      "verify-only": { type: "boolean", default: false },
      "sync-stage": { type: "boolean", default: true },
      "sync-gh-release": { type: "boolean", default: false },
      "install-hooks": { type: "boolean", default: false },
      "skip-tests": { type: "boolean", default: false },
    },
  });

  if (values["install-hooks"]) {
    const hookPath = await installGitPrePushHook();
    console.log(JSON.stringify({ ok: true, installedPrePushHook: hookPath }, null, 2));
    return;
  }

  const pkgPath = path.join(REPO_ROOT, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));

  const isFullPublish = Boolean(values.version && !values["verify-only"]);
  if (values.version) {
    const cleanVer = values.version.trim().replace(/^[vV]/, "");
    if (!/^\d+\.\d+\.\d+$/.test(cleanVer)) {
      throw new Error(`Invalid --version "${values.version}". Expected semver X.Y.Z`);
    }
    pkg.version = cleanVer;
  }
  if (values.highlights !== undefined) {
    pkg.latestHighlights = values.highlights.trim();
  }
  if (values.version || values.highlights !== undefined) {
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  const targetVersion = pkg.version;

  // 1) Sync `KIT_VERSION`, `SKILL.md`, and `skill-manifest.json`
  await generateSkillManifest({ purgeCdn: false });

  // 2) Privacy & hardcoded-path gate
  await runPrivacyGate();

  // 3) Run test suite (unless `--verify-only --skip-tests`)
  if (!values["skip-tests"]) {
    runChecked(process.execPath, ["examples/m3-finalizer-and-providers/verify_m3_and_providers.mjs"]);
  }

  // 4) Rebuild BOTH ZIP bundles (`yuanmou-ppt-skill.zip` + `yuanmou-ppt-workbuddy-marketplace.zip`)
  runChecked(process.execPath, ["scripts/pack_zip.mjs"], { capture: true });
  runChecked(process.execPath, ["scripts/pack_workbuddy_marketplace.mjs"], { capture: true });

  // 5) Cryptographically & structurally audit BOTH ZIP bundles in memory
  const universalZipPath = path.join(REPO_ROOT, "dist", "yuanmou-ppt-skill.zip");
  const workbuddyZipPath = path.join(REPO_ROOT, "dist", "yuanmou-ppt-workbuddy-marketplace.zip");
  const universalInfo = await verifyUniversalSkillZip(universalZipPath, targetVersion);
  const workbuddyInfo = await verifyWorkBuddyMarketplaceZip(workbuddyZipPath, targetVersion);

  // 6) Sync local staging directory if present (e.g., `../../workbuddy` on maintainer machine)
  const stageDir = process.env.YUANMOU_STAGE_DIR || path.resolve(REPO_ROOT, "..", "..", "workbuddy");
  const stageSynced = values["sync-stage"]
    ? await syncLocalStageDir(stageDir, targetVersion, universalInfo, workbuddyInfo)
    : null;

  // 7) Optional: upload/refresh `yuanmou-ppt-skill.zip` onto existing GitHub Release `vX.Y.Z` + purge CDN
  if (values["sync-gh-release"]) {
    const dirtyCheck = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
    if (dirtyCheck.status !== 0 || dirtyCheck.stdout.trim()) {
      throw new Error(
        `[RELEASE SYNC BLOCKED] Working tree has uncommitted changes:\n${dirtyCheck.stdout}\n` +
          `Commit & push first, or use \`npm run release -- --version X.Y.Z --highlights "..."\`.`
      );
    }
    const authCheck = runChecked("gh", ["api", "user", "--jq", ".login"], { capture: true });
    if (authCheck.stdout.trim() !== "YuanMouJun") {
      throw new Error(`Expected active gh account "YuanMouJun", got "${authCheck.stdout.trim()}"`);
    }
    const tag = `v${targetVersion}`;
    runChecked("gh", [
      "release",
      "upload",
      tag,
      universalZipPath,
      "--clobber",
      "--repo",
      "YuanMouJun/yuanmou-ppt-skill",
    ]);
    await generateSkillManifest({ purgeCdn: true });
  }

  // 8) Full atomic release (`--version X.Y.Z`): commit -> push -> GitHub Release with ZIP -> CDN purge
  let publishedReleaseUrl = null;
  if (isFullPublish) {
    const authCheck = runChecked("gh", ["api", "user", "--jq", ".login"], { capture: true });
    if (authCheck.stdout.trim() !== "YuanMouJun") {
      throw new Error(`Expected active gh account "YuanMouJun", got "${authCheck.stdout.trim()}"`);
    }
    const tag = `v${targetVersion}`;
    runChecked("git", ["add", "-A"]);
    const diffCached = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO_ROOT });
    if (diffCached.status !== 0) {
      runChecked("git", ["commit", "-m", `chore(release): v${targetVersion} — ${pkg.latestHighlights || "release"}`]);
    }
    runChecked("git", ["push", "origin", "main"], { env: { ...process.env, YUANMOU_SKIP_PREPUSH: "1" } });

    const releaseNotes =
      values.notes ||
      `## v${targetVersion} 更新内容\n\n- ${pkg.latestHighlights || "常规功能与稳定性升级"}\n\n### 附件说明\n- \`yuanmou-ppt-skill.zip\`：全端自包含技能包（支持拖入安装与国内直连增量更新）`;

    const existingRel = spawnSync("gh", ["release", "view", tag, "--repo", "YuanMouJun/yuanmou-ppt-skill"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (existingRel.status === 0) {
      runChecked("gh", [
        "release",
        "upload",
        tag,
        universalZipPath,
        "--clobber",
        "--repo",
        "YuanMouJun/yuanmou-ppt-skill",
      ]);
    } else {
      runChecked("gh", [
        "release",
        "create",
        tag,
        universalZipPath,
        "--repo",
        "YuanMouJun/yuanmou-ppt-skill",
        "--target",
        "main",
        "--title",
        `${tag} — ${pkg.latestHighlights || "Release"}`,
        "--notes",
        releaseNotes,
        "--latest",
      ]);
    }
    publishedReleaseUrl = `https://github.com/YuanMouJun/yuanmou-ppt-skill/releases/tag/${tag}`;
    await generateSkillManifest({ purgeCdn: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        version: targetVersion,
        universalZip: {
          kb: Number((universalInfo.bytes / 1024).toFixed(1)),
          sha256: universalInfo.sha256.slice(0, 16),
          entries: universalInfo.entryCount,
        },
        workbuddyMarketplaceZip: {
          kb: Number((workbuddyInfo.bytes / 1024).toFixed(1)),
          sha256: workbuddyInfo.sha256.slice(0, 16),
          entries: workbuddyInfo.entryCount,
        },
        stageSynced: stageSynced ? stageSynced.stageDir : null,
        publishedReleaseUrl,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
