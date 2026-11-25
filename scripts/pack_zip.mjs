#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Builds a self-contained `dist/yuanmou-ppt-skill.zip` for one-click drag-and-drop import into
// Tencent WorkBuddy, OpenClaw, ClawHub, Trae, Qoder, CodeBuddy, Claude Code, Codex, and Cursor.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

async function copyClean(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p);
      return base !== ".DS_Store" && base !== "__pycache__" && !base.endsWith(".pyc");
    },
  });
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const distDir = path.join(REPO_ROOT, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const outZip = path.join(distDir, "yuanmou-ppt-skill.zip");

  const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ym_pack_zip_"));
  const bundleDir = path.join(stageRoot, "yuanmou-ppt");
  try {
    await fs.mkdir(bundleDir, { recursive: true });
    await copyClean(path.join(REPO_ROOT, "skills", "yuanmou-ppt"), bundleDir);
    await copyClean(path.join(REPO_ROOT, "packages", "pptx-kit"), path.join(bundleDir, "packages", "pptx-kit"));

    // Rewrite relative imports inside copied scripts so the unzipped folder runs standalone anywhere
    for (const cliFile of ["kit.mjs", "provider_cli.mjs", "deck_cli.mjs"]) {
      const p = path.join(bundleDir, "scripts", cliFile);
      const src = await fs.readFile(p, "utf8");
      await fs.writeFile(
        p,
        src.replace("../../../packages/pptx-kit/index.mjs", "../packages/pptx-kit/index.mjs"),
        "utf8"
      );
    }

    await fs.rm(outZip, { force: true });
    const zipRes = spawnSync("zip", ["-rq", outZip, "yuanmou-ppt"], {
      cwd: stageRoot,
      encoding: "utf8",
    });
    if (zipRes.status !== 0) {
      throw new Error(`zip failed: ${zipRes.stderr || zipRes.stdout}`);
    }

    const st = await fs.stat(outZip);
    console.log(
      JSON.stringify(
        {
          ok: true,
          version: pkg.version,
          zipPath: outZip,
          bytes: st.size,
          kb: Number((st.size / 1024).toFixed(1)),
        },
        null,
        2
      )
    );
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
