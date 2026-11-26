# yuanmou-ppt-skill Repository Maintainer & Agent Rules

## 1. Self-Contained Architecture Invariant

- The canonical zero-dependency OOXML engine (`@yuanmou/pptx-kit`) lives inside `skills/yuanmou-ppt/packages/pptx-kit/` so that `skills/yuanmou-ppt/` is 100% self-contained when copied standalone by `npx skills add YuanMouJun/yuanmou-ppt-skill` or `pack_zip.mjs`.
- Root `packages/pptx-kit/` is a thin workspace re-export layer for `package.json` `"exports"` and `examples/`. Keep both in sync whenever public exports change.

## 2. Mandatory Release & Dual-ZIP Sync Pipeline (Never Skip ZIP Rebuild)

Whenever updating engine code, `SKILL.md`, or releasing a new version, **NEVER** manually edit version numbers in only one file or push code while leaving `skill-manifest.json` or `dist/*.zip` outdated:

1. **Standard Version Release (Single Atomic Command)**:
   ```bash
   npm run release -- --version X.Y.Z --highlights "Concise release highlights"
   ```
   This atomically updates `package.json`, `KIT_VERSION`, `SKILL.md`, and `skills/yuanmou-ppt/skill-manifest.json`, runs privacy gates and `npm run test:m3`, rebuilds and cryptographically verifies **both** `dist/yuanmou-ppt-skill.zip` and `dist/yuanmou-ppt-workbuddy-marketplace.zip`, syncs any local staging folder (`../../workbuddy` if present), pushes under GitHub account `YuanMouJun`, attaches `yuanmou-ppt-skill.zip` to the GitHub Release, and purges the jsDelivr CDN cache.

2. **Verify / Re-sync Without Bumping Version**:
   - Local pre-flight & dual-ZIP verification: `npm run release:verify`
   - Rebuild dual ZIPs, sync staging & refresh current GitHub Release asset: `npm run release:sync`
   - Ensure local Git `pre-push` hook is installed after fresh clones: `npm run install:hooks`

## 3. Dual-ZIP Package Compliance Rules

- **`dist/yuanmou-ppt-skill.zip` (Universal Skill Bundle)**:
  - Used for GitHub Releases and local drag-and-drop imports across Agents. Includes `skill-manifest.json` and China-direct SHA-256 verified incremental self-update (`deck_cli.mjs check-update` / `update`).
- **`dist/yuanmou-ppt-workbuddy-marketplace.zip` (WorkBuddy Marketplace Bundle)**:
  - Strictly `<= 2` directory levels inside `yuanmou-ppt/` (`SKILL.md`, `scripts/`, `references/`), `< 3 MB`, pure offline (`kit-updater.mjs` stubbed with zero external URLs), and zero third-party brand/trademark terms in `SKILL.md` YAML frontmatter.
- **Zero Hardcoded Paths or Private Credentials**:
  - Never commit hardcoded local user paths, tokens, or non-public provider endpoints.
