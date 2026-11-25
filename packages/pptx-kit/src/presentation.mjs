// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_FONT_FAMILY } from "./richtext.mjs";
import { Slide } from "./slide.mjs";
import { DEFAULT_THEME_PALETTE, buildPptxBuffer } from "./package-builder.mjs";
import { ImportedPresentation } from "./deck-surgery.mjs";

export class FileBlob {
  constructor(bytes, filePath = "") {
    this.bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    this.path = filePath;
  }

  static async load(filePath) {
    const abs = path.resolve(filePath);
    const buf = await fs.readFile(abs);
    return new FileBlob(buf, abs);
  }

  async arrayBuffer() {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength
    );
  }
}

export class ExportedPptxArtifact {
  constructor(buffer) {
    this.bytes = buffer;
  }

  async save(outputPath) {
    const abs = path.resolve(outputPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, this.bytes);
    return abs;
  }

  async arrayBuffer() {
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength
    );
  }
}

export class Presentation {
  constructor(options = {}) {
    this.id = `pr/${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    this.title = options.title || "Yuanmou Presentation";
    this.slideSize = {
      width: options.slideSize?.width ?? 1280,
      height: options.slideSize?.height ?? 720,
    };
    this.defaultFont = options.defaultFont || DEFAULT_FONT_FAMILY;
    this.theme = { ...DEFAULT_THEME_PALETTE, ...(options.theme || {}) };
    this._slides = [];
    this._ooxmlSeq = 10;

    const self = this;
    this.slides = {
      get items() {
        return [...self._slides];
      },
      get count() {
        return self._slides.length;
      },
      getItem(index) {
        return self._slides[index];
      },
      add(slideConfig = {}) {
        const sl = new Slide(self, self._slides.length + 1);
        if (slideConfig.background) {
          sl.background.fill = slideConfig.background;
        }
        self._slides.push(sl);
        return sl;
      },
      delete(target) {
        if (Array.isArray(target)) {
          const idxSet = new Set(target);
          self._slides = self._slides.filter((_, idx) => !idxSet.has(idx));
          return;
        }
        if (typeof target === "number") {
          self._slides.splice(target, 1);
          return;
        }
        if (typeof target === "string") {
          self._slides = self._slides.filter((s) => s.id !== target);
        }
      },
    };
  }

  static create(options = {}) {
    return new Presentation(options);
  }

  static async load(pptxPathOrBlob) {
    return ImportedPresentation.load(pptxPathOrBlob);
  }

  _nextOoxmlId() {
    return ++this._ooxmlSeq;
  }

  resolve(anchorId) {
    for (const sl of this._slides) {
      if (sl.id === anchorId) return sl;
      for (const el of sl._elements) {
        if (el.id === anchorId || el.name === anchorId) return el;
      }
    }
    return null;
  }

  async inspect(options = {}) {
    const search = options.search ? String(options.search).toLowerCase() : null;
    const records = [];
    this._slides.forEach((sl, idx) => {
      const elements = sl._elements
        .map((el) => ({
          id: el.id,
          kind: el.kind,
          name: el.name,
          position: el.position,
          text: el.text ? el.text.toPlainString() : undefined,
          alt: el.alt,
        }))
        .filter((item) => {
          if (!search) return true;
          return (
            (item.text && item.text.toLowerCase().includes(search)) ||
            (item.name && item.name.toLowerCase().includes(search)) ||
            (item.alt && item.alt.toLowerCase().includes(search))
          );
        });
      records.push({
        id: sl.id,
        kind: "slide",
        index: idx,
        slide: idx + 1,
        elements,
        notes: sl.notes.text ? { text: sl.notes.text } : undefined,
      });
    });
    const ndjson = records.map((r) => JSON.stringify(r)).join("\n");
    return {
      schema: "yuanmou.presentation.inspection/v1",
      unit: "px",
      records,
      recordCount: records.length,
      ndjson,
    };
  }
}

export const PresentationFile = {
  async importPptx(pptxPathOrBlob) {
    return ImportedPresentation.load(pptxPathOrBlob);
  },
  async exportPptx(presentation) {
    const buf =
      typeof presentation?.toPptxBuffer === "function"
        ? presentation.toPptxBuffer()
        : buildPptxBuffer(presentation);
    return new ExportedPptxArtifact(buf);
  },
};
