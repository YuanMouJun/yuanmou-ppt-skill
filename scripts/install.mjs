#!/usr/bin/env node
// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).
// Multi-Agent Skill Installer for Claude Code, Codex, Cursor, and Antigravity

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { discoverRenderToolchain } from "../packages/pptx-kit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function checkEnvironment() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw new Error(`Node.js >= 22.5 is required (current: v${process.versions.node}).`);
  }
  const tc = discoverRenderToolchain();
  const missing = [];
  if (!tc.soffice) missing.push("LibreOffice (soffice)");
  if (!tc.pdftoppm && !tc.hasPypdfium2) missing.push("Poppler (pdftoppm) 或 pypdfium2");
  if (missing.length > 0) {
    console.warn(
      `[INFO] 未检测到可选真机渲染依赖：${missing.join("、")}。\n` +
        `Skill 仍可正常安装并在离线代码门禁模式（6 组 15 项检查）及纯 Markdown 策划模式下运行；\n` +
        `如需开启真机渲染与高清视觉对照验收，建议补充安装：\n` +
        `  • macOS:   brew install --cask libreoffice && brew install poppler\n` +
        `  • Ubuntu:  sudo apt update && sudo apt install -y libreoffice poppler-utils\n` +
        `  • Windows: winget install TheDocumentFoundation.LibreOffice (并将 poppler 加入 PATH 或 pip install pypdfium2 pillow)`
    );
  }
  return { toolchain: tc, missingRenderDeps: missing, mode: tc.canRenderSlides ? "full-visual" : "code-gates-only" };
}

const AGENT_TARGETS = {
  claude: () => path.join(os.homedir(), ".claude", "skills", "yuanmou-ppt"),
  codex: () => path.join(os.homedir(), ".codex", "skills", "yuanmou-ppt"),
  cursor: () => path.join(os.homedir(), ".cursor", "skills", "yuanmou-ppt"),
  antigravity: () => path.join(os.homedir(), ".gemini", "config", "plugins", "yuanmou-ppt", "skills", "yuanmou-ppt"),
  trae: () => path.join(os.homedir(), ".trae", "skills", "yuanmou-ppt"),
  qoder: () => path.join(os.homedir(), ".qoder", "skills", "yuanmou-ppt"),
  codebuddy: () => path.join(os.homedir(), ".codebuddy", "skills", "yuanmou-ppt"),
  workbuddy: () => path.join(os.homedir(), ".workbuddy", "skills", "yuanmou-ppt"),
  openclaw: () => path.join(os.homedir(), ".openclaw", "skills", "yuanmou-ppt"),
  agents: () => path.join(os.homedir(), ".agents", "skills", "yuanmou-ppt"),
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
    // Rewrite relative import in copied scripts (`kit.mjs`, `provider_cli.mjs`, `deck_cli.mjs`) -> `../packages/pptx-kit`
    for (const cliFile of ["kit.mjs", "provider_cli.mjs", "deck_cli.mjs"]) {
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

  if (name === "antigravity") {
    const pluginRoot = path.resolve(destDir, "..", "..");
    const pluginJsonPath = path.join(pluginRoot, "plugin.json");
    const pluginManifest = {
      name: "yuanmou-ppt",
      displayName: "渊眸 PPT 全能生成与复刻",
      description:
        "一句话从零策划生成整套商业 PPT / 16,200+ 免登录商业版式库同构选版 / 图片、截图与 PDF 1:1 复刻（含水墨笔刷与无孔洞蒙版） / 既有 PPTX 母本无损改版（6 组 15 项门禁）。",
      version: "0.1.0",
      author: "渊眸策略 (Yuanmou Strategy)",
      suggestedPrompts: [
        "帮我策划并生成一份 10 页的品牌 Q3 营销增长方案 PPT，先出大纲和选版看板",
        "把这张参考图/PDF 1:1 复刻成可编辑的原生 PPTX，并替换成我的项目文案",
        "保留这份 PPTX 母本样式不动，原位无损替换第 3～5 页的数据与图表",
      ],
    };
    await fs.writeFile(pluginJsonPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
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

  const envReport = checkEnvironment();

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

  console.log(
    JSON.stringify(
      {
        environment: "ok",
        verificationMode: envReport.mode,
        missingRenderDeps: envReport.missingRenderDeps,
        toolchain: envReport.toolchain,
        installed: results,
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
