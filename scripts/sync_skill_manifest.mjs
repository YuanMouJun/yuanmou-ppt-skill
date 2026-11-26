#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Generates `skills/yuanmou-ppt/skill-manifest.json` with deterministic SHA-256 digests
// and verifies version consistency across `package.json`, `updater.mjs`, and `SKILL.md`.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SKILL_DIR = path.join(REPO_ROOT, "skills", "yuanmou-ppt");

const IGNORED_NAMES = new Set([".DS_Store", "__pycache__", "skill-manifest.json"]);

async function walkRelFiles(rootDir, curDir = rootDir, acc = []) {
  const entries = await fs.readdir(curDir, { withFileTypes: true });
  for (const ent of entries) {
    if (
      IGNORED_NAMES.has(ent.name) ||
      ent.name.endsWith(".pyc") ||
      ent.name.endsWith(".local.mjs") ||
      ent.name.startsWith(".")
    ) {
      continue;
    }
    const full = path.join(curDir, ent.name);
    if (ent.isDirectory()) {
      await walkRelFiles(rootDir, full, acc);
    } else if (ent.isFile()) {
      const relPosix = path.relative(rootDir, full).split(path.sep).join("/");
      acc.push(relPosix);
    }
  }
  return acc;
}

export async function generateSkillManifest({ purgeCdn = false } = {}) {
  const pkgPath = path.join(REPO_ROOT, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  const version = pkg.version;
  const highlights = pkg.latestHighlights || "";

  // Sync KIT_VERSION in updater.mjs
  const updaterPath = path.join(SKILL_DIR, "packages", "pptx-kit", "src", "updater.mjs");
  const updaterSrc = await fs.readFile(updaterPath, "utf8");
  const updatedUpdaterSrc = updaterSrc.replace(
    /export const KIT_VERSION = "[^"]+";/,
    `export const KIT_VERSION = "${version}";`
  );
  if (updatedUpdaterSrc !== updaterSrc) {
    await fs.writeFile(updaterPath, updatedUpdaterSrc, "utf8");
  }

  // Sync frontmatter version in SKILL.md if present
  const skillMdPath = path.join(SKILL_DIR, "SKILL.md");
  const skillMdSrc = await fs.readFile(skillMdPath, "utf8");
  const updatedSkillMd = skillMdSrc.replace(/^version:\s*[^\r\n]+/m, `version: ${version}`);
  if (updatedSkillMd !== skillMdSrc) {
    await fs.writeFile(skillMdPath, updatedSkillMd, "utf8");
  }

  const relFiles = (await walkRelFiles(SKILL_DIR)).sort();
  const files = {};
  for (const rel of relFiles) {
    const buf = await fs.readFile(path.join(SKILL_DIR, ...rel.split("/")));
    files[rel] = createHash("sha256").update(buf).digest("hex");
  }

  const manifest = {
    name: "yuanmou-ppt",
    version,
    highlights,
    fileCount: relFiles.length,
    files,
  };

  const manifestPath = path.join(SKILL_DIR, "skill-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  let purged = false;
  if (purgeCdn) {
    const purgePaths = new Set(["skills/yuanmou-ppt/skill-manifest.json"]);
    const diffRes = spawnSync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD", "--", "skills/yuanmou-ppt/"],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    if (diffRes.status === 0 && diffRes.stdout.trim()) {
      for (const line of diffRes.stdout.trim().split(/\r?\n/)) {
        if (line.trim()) purgePaths.add(line.trim());
      }
    }
    try {
      const results = await Promise.all(
        Array.from(purgePaths).map((rel) =>
          fetch(`https://purge.jsdelivr.net/gh/YuanMouJun/yuanmou-ppt-skill@main/${rel}`, {
            signal: AbortSignal.timeout(6000),
          })
            .then((r) => r.ok)
            .catch(() => false)
        )
      );
      purged = results.every(Boolean);
    } catch {
      purged = false;
    }
  }

  return { version, fileCount: relFiles.length, manifestPath, purged };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const { values } = parseArgs({
    options: {
      "purge-cdn": { type: "boolean", default: false },
    },
  });
  generateSkillManifest({ purgeCdn: values["purge-cdn"] })
    .then((res) => console.log(JSON.stringify({ ok: true, ...res }, null, 2)))
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}
