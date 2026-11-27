# Security & Data Flow (`SECURITY.md`)

`yuanmou-ppt-skill` (`@yuanmou/pptx-kit`) is designed around a **local-first, zero-telemetry architecture**. Every outbound network endpoint, local file path, and credential boundary is explicitly enumerated below so you—or your AI coding agent—can audit the codebase line by line.

---

## 1. Core Local Execution (Zero Network, Zero API Keys)

All core PPTX generation, editing, and verification pipelines run **100% locally** on your machine using built-in Node.js (`>= 22.5`) modules (`node:fs`, `node:zlib`, `node:crypto`, `node:sqlite`) and optional local renderers (`soffice` / `pdftoppm` / `python3`):

- Native OOXML presentation creation (`Presentation`, `Slide`, shapes, SVG `<a:custGeom>`, `<a:alpha>` translucent gradients, `<a:tbl>` merged tables, embedded `.xlsx` charts)
- Existing `.pptx` lossless surgical editing (`inspectTemplateDeck`, `prepareStarterDeck`, `Presentation.load`, `auditTemplateFidelity`)
- Organic brush & flood-fill alpha masking (`createBrushPng`, `applyAlphaMaskToImage`)
- 6-group / 15-check static validation (`finalizeDeck` / `validateDeckBuffer`)
- Local visual rendering & 50% X-Ray overlay diff (`deck_cli.mjs render / inspect-ref / diff / verify`)

**Your documents, briefs, `.pptx` files, images, and spreadsheets are NEVER uploaded to any remote server by `@yuanmou/pptx-kit`.**

---

## 2. Exhaustive Outbound Network Endpoints

Network access is strictly **read-only** and limited to the optional features listed below:

| Domain | Triggered When | Direction & Data Sent | Can Be Disabled? |
| :--- | :--- | :--- | :--- |
| `ppt-trial.resourcehub.dpdns.org` | Running `provider_cli.mjs sync / search / fetch` in default zero-login public trial library mode | **Read-only GET** for public trial index (`ppt-index-trial.db.gz`) and slide preview PNGs (`previews/CP_*.png`). Sends only standard HTTP headers + `X-Yuanmou-Client` identifier. Zero user prompt or file content is transmitted. | Yes — offline standalone mode works with zero network calls when you bring your own reference image or `.pptx`. |
| `cdn.jsdelivr.net` / `raw.githubusercontent.com` / `api.github.com` | Passive 24h update check in `deck_cli.mjs check-env`, or explicit `deck_cli.mjs check-update` / `update` | **Read-only GET** for `skill-manifest.json` (version metadata + SHA-256 hashes) and verified release files during explicit user-triggered updates. | Yes — pass `--no-update-check` or set `YUANMOU_DISABLE_UPDATE_CHECK=1`. |
| `open.feishu.cn` *(optional VIP only)* | Only if you explicitly authenticate with your own Feishu OAuth app (`provider_cli.mjs login-feishu`) | Official Feishu Open API endpoints for your authorized cloud drive index & preview downloads. | Never contacted unless Feishu credentials exist in `~/.config/yuanmou-ppt/` or `FEISHU_*` env vars. |

### Zero Telemetry Guarantee
- No analytics SDKs, no crash reporters, no hidden beacons, no usage tracking.
- No remote code execution (`eval` of downloaded scripts is never performed); `deck_cli.mjs update` only runs when explicitly invoked, verifies every downloaded file against its SHA-256 digest in `skill-manifest.json`, and refuses to overwrite dirty Git repositories or non-skill directories.

---

## 3. Local Storage & Deletion Boundaries

All local caches and optional configs are isolated in standard user directories:

| Path | Contents | Safe to Delete? |
| :--- | :--- | :--- |
| `~/.cache/yuanmou-ppt/` | Cached public SQLite layout index (`ppt-index-trial.db`) and 24h update check cache (`update-check.json`) | Yes — `rm -rf ~/.cache/yuanmou-ppt` cleanly resets all caches. |
| `${TMPDIR}/yuanmou-ppt-tmp-previews/` | Temporary reference preview PNGs (auto-pruned after 2 hours TTL) | Yes — auto-cleaned on every fetch. |
| `~/.config/yuanmou-ppt/` | Optional Feishu OAuth tokens (only created if you run `login-feishu`) | Yes — `rm -rf ~/.config/yuanmou-ppt` immediately revokes local tokens. |
| `~/.cache/yuanmou-pptx/fontconfig/` | macOS local fontconfig cache for faster headless LibreOffice rendering | Yes. |

---

## 4. Private Local Extensions

If you mount an internal enterprise or personal layout database via the optional gitignored hook (`skills/yuanmou-ppt/packages/pptx-kit/src/providers/custom-providers.local.mjs` or `YUANMOU_CUSTOM_PROVIDER_MODULE`), that file is excluded by `.gitignore`, `skill-manifest.json`, and all release packaging scripts so private credentials or internal paths never leak into public commits.

---

## 5. Reporting a Security Issue

If you spot any unexpected outbound call, path traversal risk, or OOXML packaging bug, please open a GitHub Issue or Security Advisory on `YuanMouJun/yuanmou-ppt-skill`.
