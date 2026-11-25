#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Multi-Agent Skill Installer for Claude Code, Codex, Cursor, and Antigravity

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const AGENT_TARGETS = {
  claude: () => path.join(os.homedir(), ".claude", "skills", "yuanmou-ppt"),
  codex: () => path.join(os.homedir(), ".codex", "skills", "yuanmou-ppt"),
  cursor: () => path.join(os.homedir(), ".cursor", "skills", "yuanmou-ppt"),
  antigravity: () => path.join(os.homedir(), ".gemini", "antigravity", "skills", "yuanmou-ppt"),
};

async function installToTarget(name, destDir, mode = "symlink") {
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  await fs.rm(destDir, { recursive: true, force: true });

  if (mode === "copy") {
    // Copy self-contained bundle (`SKILL.md` + `scripts/` + `packages/pptx-kit/`)
    await fs.mkdir(destDir, { recursive: true });
    await fs.cp(path.join(REPO_ROOT, "skills", "yuanmou-ppt"), destDir, { recursive: true });
    await fs.cp(
      path.join(REPO_ROOT, "packages", "pptx-kit"),
      path.join(destDir, "packages", "pptx-kit"),
      { recursive: true }
    );
    // Rewrite relative import in copied CLI scripts from `../../../packages/pptx-kit` -> `../packages/pptx-kit`
    for (const cliFile of ["provider_cli.mjs", "deck_cli.mjs"]) {
      const p = path.join(destDir, "scripts", cliFile);
      const src = await fs.readFile(p, "utf8");
      await fs.writeFile(
        p,
        src.replace("../../../packages/pptx-kit/index.mjs", "../packages/pptx-kit/index.mjs"),
        "utf8"
      );
    }
  } else {
    // Symlink repo's `skills/yuanmou-ppt` so `../../../packages/pptx-kit` resolves directly!
    await fs.symlink(path.join(REPO_ROOT, "skills", "yuanmou-ppt"), destDir, "dir");
  }

  return { agent: name, path: destDir, mode };
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "all" },
      copy: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const requested =
    values.target === "all"
      ? Object.keys(AGENT_TARGETS)
      : values.target.split(",").map((s) => s.trim().toLowerCase());

  const mode = values.copy ? "copy" : "symlink";
  const results = [];

  for (const t of requested) {
    if (!AGENT_TARGETS[t]) {
      throw new Error(`Unsupported target "${t}". Supported: ${Object.keys(AGENT_TARGETS).join(", ")}, all`);
    }
    const dest = AGENT_TARGETS[t]();
    if (values["dry-run"]) {
      results.push({ agent: t, path: dest, mode, dryRun: true });
    } else {
      results.push(await installToTarget(t, dest, mode));
    }
  }

  console.log(JSON.stringify({ installed: results }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
