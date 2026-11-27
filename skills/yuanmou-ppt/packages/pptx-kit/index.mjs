// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

export { Presentation, PresentationFile, FileBlob } from "./src/presentation.mjs";
export { buildPptxBuffer } from "./src/package-builder.mjs";
export {
  row,
  column,
  col,
  grid,
  layers,
  box,
  paragraph,
  run,
  shape,
  image,
  table,
  chart,
  rule,
  h,
} from "./src/compose.mjs";
export { fr, fixed, TableElement } from "./src/tables.mjs";
export { ChartElement, buildChartWorkbookBuffer } from "./src/charts.mjs";
export {
  ImportedPresentation,
  ImportedSlide,
  PLACEHOLDER_TEXT_PATTERNS,
  isPlaceholderText,
  inspectTemplateDeck,
  validateTemplatePlan,
  prepareStarterDeck,
  auditTemplateFidelity,
} from "./src/deck-surgery.mjs";
export {
  makeBulletList,
  makeNativeBulletParagraphs,
  DEFAULT_FONT_FAMILY,
} from "./src/richtext.mjs";
export {
  pxToEmu,
  emuToPx,
  ptToEmu,
  resolveBorderRadius,
} from "./src/units.mjs";
export {
  TAILWIND_COLORS,
  resolveColorSpec,
  parseClassNameTokens,
} from "./src/tokens.mjs";
export {
  parseSvgPathToCommands,
  buildPolylineStrokeCommands,
  buildRoundedPolygonCommands,
  buildRoundedTrapezoidPath,
} from "./src/geometry.mjs";
export {
  renderDeckToPngs,
  buildShowcaseGalleryHtml,
  discoverRenderToolchain,
} from "./src/render.mjs";
export {
  CHINESE_AI_SLOP_PATTERNS,
  validateDeckBuffer,
  finalizeDeck,
} from "./src/finalizer.mjs";
export {
  SlideCacheStore,
  SlideSourceProvider,
  LocalStandaloneProvider,
  FeishuDriveProvider,
  ZsxqPlanetProvider,
  YuanmouCloudR2Provider,
  SLIDE_INDEX_DDL,
  ORTHO_ARCHETYPES,
  ARCHETYPE_AFFINITY,
  OFFLINE_PATTERN_HINTS,
  normalizeArchetype,
  normalizePurposeTerms,
  normalizeCapacityTier,
  deriveRuntimeOrtho,
  loadBlacklistIds,
  clearSlideIndexCache,
  loadPagesSnapshot,
  querySlideIndexDb,
  registerSourceProvider,
  listSourceProviders,
  createSourceProvider,
  resolveActiveSourceProvider,
} from "./src/providers/index.mjs";
export {
  encodeRgbaPng,
  decodePngToRgba,
  createBrushPng,
  applyAlphaMaskToImage,
} from "./src/brush-mask.mjs";
export {
  KIT_VERSION,
  GITHUB_REPO,
  compareSemver,
  checkSkillUpdate,
  selfUpdateSkill,
} from "./src/updater.mjs";
export { readZipBuffer, buildZipBuffer } from "./src/xml.mjs";
