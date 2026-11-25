// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { SlideCacheStore, SlideSourceProvider } from "./base-provider.mjs";
import { LocalStandaloneProvider } from "./local-provider.mjs";
import { ZsxqPlanetProvider } from "./zsxq-provider.mjs";
import { YuanmouCloudR2Provider } from "./yuanmou-cloud-provider.mjs";
import { SLIDE_INDEX_DDL, querySlideIndexDb } from "./sqlite-index.mjs";

const PROVIDER_FACTORIES = new Map([
  ["local", (opts) => new LocalStandaloneProvider(opts)],
  ["zsxq", (opts) => new ZsxqPlanetProvider(opts)],
  ["yuanmou-cloud", (opts) => new YuanmouCloudR2Provider(opts)],
]);

export function registerSourceProvider(id, factoryOrClass) {
  if (!id || typeof id !== "string") {
    throw new Error("Provider id must be a non-empty string");
  }
  const factory =
    typeof factoryOrClass === "function" && factoryOrClass.prototype instanceof SlideSourceProvider
      ? (opts) => new factoryOrClass(opts)
      : factoryOrClass;
  if (typeof factory !== "function") {
    throw new Error(`Provider "${id}" must be a SlideSourceProvider subclass or factory function`);
  }
  PROVIDER_FACTORIES.set(id, factory);
}

export function listSourceProviders() {
  return [...PROVIDER_FACTORIES.keys()];
}

export function createSourceProvider(id, options = {}) {
  const factory = PROVIDER_FACTORIES.get(id);
  if (!factory) {
    throw new Error(
      `Unknown source provider "${id}". Registered providers: ${listSourceProviders().join(", ")}`
    );
  }
  return factory(options);
}

/**
 * Auto-resolves the active `SlideSourceProvider`:
 * 1) Explicit `options.provider` or `YUANMOU_PROVIDER` env override
 * 2) `yuanmou-cloud` if `YUANMOU_API_KEY` / cloud credentials exist and authenticate
 * 3) `zsxq` (V1 Production Default) if `zsxq-cli` is installed and authenticated in VIP planet
 * 4) `local` (Free Open-Source Standalone mode)
 */
export async function resolveActiveSourceProvider(options = {}) {
  const explicit = options.provider || process.env.YUANMOU_PROVIDER;
  if (explicit) {
    const provider = createSourceProvider(explicit, options);
    const auth = await provider.checkAuth();
    return { provider, auth, mode: explicit };
  }

  const cloud = createSourceProvider("yuanmou-cloud", options);
  if (cloud.hasCredentials?.()) {
    const auth = await cloud.checkAuth();
    if (auth.authenticated) {
      return { provider: cloud, auth, mode: "yuanmou-cloud" };
    }
  }

  const zsxq = createSourceProvider("zsxq", options);
  if (zsxq.isCliAvailable?.()) {
    const auth = await zsxq.checkAuth();
    if (auth.authenticated) {
      return { provider: zsxq, auth, mode: "zsxq" };
    }
  }

  const local = createSourceProvider("local", options);
  const auth = await local.checkAuth();
  return { provider: local, auth, mode: "local" };
}

export {
  SlideCacheStore,
  SlideSourceProvider,
  LocalStandaloneProvider,
  ZsxqPlanetProvider,
  YuanmouCloudR2Provider,
  SLIDE_INDEX_DDL,
  querySlideIndexDb,
};
