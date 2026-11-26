// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { createHash } from "node:crypto";
import { degToOoxmlAngle, pxToEmu } from "./units.mjs";
import {
  parseClassNameTokens,
  renderEffectsXml,
  renderFillXml,
  renderLineXml,
} from "./tokens.mjs";
import {
  SIDE_TO_SITE_IDX,
  getAnchorPointOnBox,
  inferBestConnectorSides,
  mapConnectorKindToPreset,
  renderGeometryXml,
} from "./geometry.mjs";
import { computeImagePlacementAndCrop, resolveImageSource } from "./media.mjs";
import {
  mergeTextStyle,
  normalizeParagraphs,
  renderTxBodyXml,
} from "./richtext.mjs";
import { composeIntoSlide } from "./compose.mjs";
import { TableElement } from "./tables.mjs";
import { ChartElement } from "./charts.mjs";
import { attrs } from "./xml.mjs";

function makeAnchorId(prefix, seed) {
  return `${prefix}/${createHash("sha1").update(String(seed)).digest("hex").slice(0, 8)}`;
}

class TextFacade {
  constructor(ownerShape, initialValue, initialStyle = {}) {
    this._owner = ownerShape;
    this._paragraphs = initialValue !== undefined ? normalizeParagraphs(initialValue) : [];
    this._style = { ...initialStyle };
  }

  get hasContent() {
    if (this._owner.geometry === "textbox") return true;
    return this._paragraphs.length > 0;
  }

  get paragraphs() {
    return this._paragraphs;
  }

  set(value) {
    this._paragraphs = normalizeParagraphs(value);
    return this;
  }

  replace(searchValue, nextValue) {
    for (const p of this._paragraphs) {
      for (const r of p.runs || []) {
        if (typeof r.run === "string") {
          r.run = r.run.split(String(searchValue)).join(String(nextValue));
        }
      }
    }
    return this;
  }

  get style() {
    return this._style;
  }

  set style(nextStyle) {
    this._style = mergeTextStyle(this._style, nextStyle);
  }

  get insets() {
    return this._style.insets;
  }

  set insets(val) {
    this._style = { ...this._style, insets: val };
  }

  get fontSize() {
    return this._style.fontSize;
  }

  set fontSize(val) {
    this._style = { ...this._style, fontSize: val };
  }

  toPlainString() {
    return this._paragraphs
      .map((p) => (p.runs || []).map((r) => r.run || "").join(""))
      .join("\n");
  }

  toString() {
    return this.toPlainString();
  }

  [Symbol.toPrimitive]() {
    return this.toPlainString();
  }
}

class BaseSlideElement {
  constructor(slide, kind, ooxmlId, prefix) {
    this.slide = slide;
    this.kind = kind;
    this.ooxmlId = ooxmlId;
    this.id = makeAnchorId(prefix, `${slide.id}:${ooxmlId}`);
  }

  delete() {
    this.slide._removeElement(this);
  }

  bringToFront() {
    this.slide._moveElement(this, "front");
    return this;
  }

  sendToBack() {
    this.slide._moveElement(this, "back");
    return this;
  }

  bringForward() {
    this.slide._moveElement(this, "forward");
    return this;
  }

  sendBackward() {
    this.slide._moveElement(this, "backward");
    return this;
  }
}

export class ShapeElement extends BaseSlideElement {
  constructor(slide, ooxmlId, config = {}) {
    const inferredGeom =
      config.geometry ||
      (config.text !== undefined &&
      config.fill === undefined &&
      config.line === undefined &&
      !config.className &&
      !config.customPaths &&
      !config.svgPath
        ? "textbox"
        : "rect");
    super(slide, inferredGeom === "textbox" ? "textbox" : "shape", ooxmlId, "sh");
    const classTokens = config.className
      ? parseClassNameTokens(config.className)
      : { shape: {}, text: {} };

    this.geometry = inferredGeom;
    this.name = config.name || `${this.geometry}-${ooxmlId}`;
    this.position = {
      left: config.position?.left ?? 0,
      top: config.position?.top ?? 0,
      width: config.position?.width ?? 200,
      height: config.position?.height ?? 80,
      rotation: config.rotation ?? config.rotate ?? config.position?.rotation ?? config.position?.rotate ?? 0,
      horizontalFlip: Boolean(config.horizontalFlip ?? config.flipHorizontal ?? config.position?.horizontalFlip),
      verticalFlip: Boolean(config.verticalFlip ?? config.flipVertical ?? config.position?.verticalFlip),
    };
    this.fill =
      config.fill !== undefined
        ? config.fill
        : classTokens.shape.fill !== undefined
          ? classTokens.shape.fill
          : this.geometry === "textbox" || this.geometry === "line"
            ? "none"
            : "#FFFFFF";
    this.line = config.line || { style: "solid", fill: "none", width: 0 };
    this.borderRadius = config.borderRadius ?? classTokens.shape.borderRadius;
    this.shadow = config.shadow ?? classTokens.shape.shadow;
    this.softEdge = config.softEdge;
    this.adjustmentList = config.adjustmentList;
    this.customPaths = config.customPaths;
    this.svgPath = config.svgPath;
    this.viewBox = config.viewBox;
    this.hyperlink = config.hyperlink;

    let initText = undefined;
    let initTextStyle = { ...classTokens.text };
    if (config.textStyle) {
      initTextStyle = mergeTextStyle(initTextStyle, config.textStyle);
    }
    if (config.text !== undefined) {
      if (
        config.text &&
        typeof config.text === "object" &&
        !Array.isArray(config.text) &&
        "text" in config.text
      ) {
        initText = config.text.text;
        initTextStyle = mergeTextStyle(initTextStyle, config.text.style || {});
      } else {
        initText = config.text;
      }
    }
    this._textFacade = new TextFacade(this, initText, initTextStyle);
  }

  get text() {
    return this._textFacade;
  }

  set text(val) {
    this._textFacade.set(val);
  }

  set className(cls) {
    const parsed = parseClassNameTokens(cls);
    if (parsed.shape.fill !== undefined) this.fill = parsed.shape.fill;
    if (parsed.shape.borderRadius !== undefined) this.borderRadius = parsed.shape.borderRadius;
    if (parsed.shape.shadow !== undefined) this.shadow = parsed.shape.shadow;
    this._textFacade.style = parsed.text;
  }

  toXml(ctx) {
    const isTextbox = this.geometry === "textbox";
    const hlinkXml =
      this.hyperlink?.uri
        ? `<a:hlinkClick r:id="${ctx.registerHyperlink(this.hyperlink.uri)}"/>`
        : "";
    const nvSpPr = `<p:nvSpPr><p:cNvPr id="${this.ooxmlId}" name="${this.name}">${hlinkXml}</p:cNvPr><p:cNvSpPr${isTextbox ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>`;

    const xfrmAttrs = {
      rot: this.position.rotation ? degToOoxmlAngle(this.position.rotation) : undefined,
      flipH: this.position.horizontalFlip ? "1" : undefined,
      flipV: this.position.verticalFlip ? "1" : undefined,
    };
    const xfrmXml = `<a:xfrm${attrs(xfrmAttrs)}><a:off x="${pxToEmu(this.position.left)}" y="${pxToEmu(this.position.top)}"/><a:ext cx="${Math.max(0, pxToEmu(this.position.width))}" cy="${Math.max(0, pxToEmu(this.position.height))}"/></a:xfrm>`;

    const geomXml = renderGeometryXml({
      geometry: this.geometry,
      width: this.position.width,
      height: this.position.height,
      borderRadius: this.borderRadius,
      adjustmentList: this.adjustmentList,
      customPaths: this.customPaths,
      svgPath: this.svgPath,
      viewBox: this.viewBox,
    });

    const fillXml = this.geometry === "line" ? "<a:noFill/>" : renderFillXml(this.fill);
    const lineXml = renderLineXml(this.line);
    const effectsXml = renderEffectsXml({ shadow: this.shadow, softEdge: this.softEdge });

    const spPr = `<p:spPr>${xfrmXml}${geomXml}${fillXml}${lineXml}${effectsXml}</p:spPr>`;

    const txBody = this._textFacade.hasContent
      ? renderTxBodyXml({
          paragraphs: this._textFacade.paragraphs,
          baseStyle: this._textFacade.style,
          defaultFont: this.slide.presentation.defaultFont,
          isTextbox,
          registerHyperlink: ctx.registerHyperlink,
        })
      : "";

    return `<p:sp>${nvSpPr}${spPr}${txBody}</p:sp>`;
  }
}

export class ConnectorElement extends BaseSlideElement {
  constructor(slide, ooxmlId, config = {}) {
    super(slide, "connector", ooxmlId, "sh");
    this.name = config.name || `connector-${ooxmlId}`;
    this.kind = config.kind || "elbow";
    this.fromShape = config.fromShape || null;
    this.toShape = config.toShape || null;
    this.fromSide = config.fromSide;
    this.toSide = config.toSide;
    this.fromIdx = config.fromIdx;
    this.toIdx = config.toIdx;
    this.startPoint = config.startPoint || null;
    this.endPoint = config.endPoint || null;
    this.line = config.line || { style: "solid", fill: "slate-400", width: 2 };
    this.head = config.head;
    this.tail = config.tail;
    this.cap = config.cap;
    this.join = config.join;
  }

  toXml() {
    let p1 = this.startPoint || { x: 0, y: 0 };
    let p2 = this.endPoint || { x: 100, y: 0 };
    let stCxnXml = "";
    let endCxnXml = "";

    if (this.fromShape && this.toShape) {
      const inferred = inferBestConnectorSides(
        this.fromShape.position,
        this.toShape.position,
        this.fromSide,
        this.toSide
      );
      p1 = getAnchorPointOnBox(this.fromShape.position, inferred.fromSide);
      p2 = getAnchorPointOnBox(this.toShape.position, inferred.toSide);
      const sIdx = this.fromIdx ?? SIDE_TO_SITE_IDX[inferred.fromSide] ?? 3;
      const eIdx = this.toIdx ?? SIDE_TO_SITE_IDX[inferred.toSide] ?? 1;
      stCxnXml = `<a:stCxn id="${this.fromShape.ooxmlId}" idx="${sIdx}"/>`;
      endCxnXml = `<a:endCxn id="${this.toShape.ooxmlId}" idx="${eIdx}"/>`;
    }

    const left = Math.min(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);
    const flipH = p2.x < p1.x;
    const flipV = p2.y < p1.y;

    const nvCxnSpPr = `<p:nvCxnSpPr><p:cNvPr id="${this.ooxmlId}" name="${this.name}"/><p:cNvCxnSpPr>${stCxnXml}${endCxnXml}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>`;
    const xfrmXml = `<a:xfrm${attrs({
      flipH: flipH ? "1" : undefined,
      flipV: flipV ? "1" : undefined,
    })}><a:off x="${pxToEmu(left)}" y="${pxToEmu(top)}"/><a:ext cx="${pxToEmu(width)}" cy="${pxToEmu(height)}"/></a:xfrm>`;
    const prst = mapConnectorKindToPreset(this.kind);
    const lineXml = renderLineXml(this.line, {
      head: this.head,
      tail: this.tail,
      cap: this.cap,
      join: this.join,
    });

    return `<p:cxnSp>${nvCxnSpPr}<p:spPr>${xfrmXml}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${lineXml}</p:spPr></p:cxnSp>`;
  }
}

export class ImageElement extends BaseSlideElement {
  constructor(slide, ooxmlId, options = {}) {
    super(slide, "image", ooxmlId, "im");
    const src = resolveImageSource(options);
    this.sourceBytes = src.bytes;
    this.sourceWidth = src.width;
    this.sourceHeight = src.height;
    this.ext = src.ext;
    this.contentType = src.contentType;
    this.alt = src.alt;
    this.name = options.name || `image-${ooxmlId}`;
    this.fit = options.fit || "contain";
    this.crop = options.crop || null;
    this.geometry = options.geometry || "rect";
    this.borderRadius = options.borderRadius;
    this.adjustmentList = options.adjustmentList;
    this.customPaths = options.customPaths;
    this.svgPath = options.svgPath;
    this.viewBox = options.viewBox;
    this.shadow = options.shadow;
    this.line = options.line;
    this.hyperlink = options.hyperlink;
    this.rotation = options.rotation ?? options.rotate ?? options.position?.rotation ?? options.position?.rotate ?? 0;
    this.flipHorizontal = Boolean(options.flipHorizontal ?? options.horizontalFlip ?? options.position?.horizontalFlip);
    this.flipVertical = Boolean(options.flipVertical ?? options.verticalFlip ?? options.position?.verticalFlip);
    this.lockAspectRatio = options.lockAspectRatio !== false;

    const inputFrame = options.position || options.frame || {
      left: 0,
      top: 0,
      width: src.width,
      height: src.height,
    };
    this._frame = { ...inputFrame };
  }

  get frame() {
    return { ...this._frame };
  }

  set frame(next) {
    this._frame = { ...this._frame, ...next };
  }

  get position() {
    return this.frame;
  }

  set position(next) {
    this.frame = next;
  }

  replace(options = {}) {
    const src = resolveImageSource(options);
    this.sourceBytes = src.bytes;
    this.sourceWidth = src.width;
    this.sourceHeight = src.height;
    this.ext = src.ext;
    this.contentType = src.contentType;
    if (options.alt !== undefined) this.alt = options.alt;
    if (options.fit !== undefined) this.fit = options.fit;
    return this;
  }

  toXml(ctx) {
    const mediaRelId = ctx.registerMedia({
      bytes: this.sourceBytes,
      ext: this.ext,
      contentType: this.contentType,
    });
    const { position: drawPos, srcRect } = computeImagePlacementAndCrop({
      sourceWidth: this.sourceWidth,
      sourceHeight: this.sourceHeight,
      frame: this._frame,
      fit: this.fit,
      crop: this.crop,
    });

    const hlinkXml =
      this.hyperlink?.uri
        ? `<a:hlinkClick r:id="${ctx.registerHyperlink(this.hyperlink.uri)}"/>`
        : "";
    const nvPicPr = `<p:nvPicPr><p:cNvPr id="${this.ooxmlId}" name="${this.name}" descr="${this.alt || ""}">${hlinkXml}</p:cNvPr><p:cNvPicPr><a:picLocks noChangeAspect="${this.lockAspectRatio ? "1" : "0"}"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`;

    const srcRectXml = srcRect
      ? `<a:srcRect l="${srcRect.l}" t="${srcRect.t}" r="${srcRect.r}" b="${srcRect.b}"/>`
      : "<a:srcRect/>";
    const blipFill = `<p:blipFill rotWithShape="1"><a:blip r:embed="${mediaRelId}"/>${srcRectXml}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`;

    const xfrmXml = `<a:xfrm${attrs({
      rot: this.rotation ? degToOoxmlAngle(this.rotation) : undefined,
      flipH: this.flipHorizontal ? "1" : undefined,
      flipV: this.flipVertical ? "1" : undefined,
    })}><a:off x="${pxToEmu(drawPos.left)}" y="${pxToEmu(drawPos.top)}"/><a:ext cx="${pxToEmu(drawPos.width)}" cy="${pxToEmu(drawPos.height)}"/></a:xfrm>`;

    const geomXml = renderGeometryXml({
      geometry: this.geometry,
      width: drawPos.width,
      height: drawPos.height,
      borderRadius: this.borderRadius,
      adjustmentList: this.adjustmentList,
      customPaths: this.customPaths,
      svgPath: this.svgPath,
      viewBox: this.viewBox,
    });
    const lineXml = this.line ? renderLineXml(this.line) : "";
    const effectsXml = renderEffectsXml({ shadow: this.shadow });

    return `<p:pic>${nvPicPr}${blipFill}<p:spPr>${xfrmXml}${geomXml}${lineXml}${effectsXml}</p:spPr></p:pic>`;
  }
}

export class Slide {
  constructor(presentation, slideNumber) {
    this.presentation = presentation;
    this._slideNumber = slideNumber;
    this.id = makeAnchorId("sl", `${presentation.id}:slide:${slideNumber}`);
    this.background = { fill: "#FFFFFF" };
    this._elements = [];
    this._notesText = "";

    const self = this;
    this.shapes = {
      get items() {
        return self._elements.filter((e) => e instanceof ShapeElement || e instanceof ConnectorElement);
      },
      add(config = {}) {
        if (config.geometry === "connector") {
          const fromShape = self._resolveShapeRef(config.from);
          const toShape = self._resolveShapeRef(config.to);
          const el = new ConnectorElement(self, self.presentation._nextOoxmlId(), {
            ...config,
            fromShape,
            toShape,
          });
          self._elements.push(el);
          return el;
        }
        const el = new ShapeElement(self, self.presentation._nextOoxmlId(), config);
        self._elements.push(el);
        return el;
      },
      connect(fromRef, toRef, options = {}) {
        const fromShape = self._resolveShapeRef(fromRef);
        const toShape = self._resolveShapeRef(toRef);
        if (!fromShape || !toShape) {
          throw new Error("slide.shapes.connect requires valid source and target shapes");
        }
        const el = new ConnectorElement(self, self.presentation._nextOoxmlId(), {
          ...options,
          fromShape,
          toShape,
        });
        self._elements.push(el);
        return el;
      },
      getConnectionSiteIndex(_shape, side = "right") {
        return SIDE_TO_SITE_IDX[side] ?? 3;
      },
    };

    this.images = {
      get items() {
        return self._elements.filter((e) => e instanceof ImageElement);
      },
      add(options = {}) {
        const el = new ImageElement(self, self.presentation._nextOoxmlId(), options);
        self._elements.push(el);
        return el;
      },
    };

    this.tables = {
      get items() {
        return self._elements.filter((e) => e instanceof TableElement);
      },
      add(options = {}) {
        const el = new TableElement(self, self.presentation._nextOoxmlId(), options);
        self._elements.push(el);
        return el;
      },
    };

    this.charts = {
      get items() {
        return self._elements.filter((e) => e instanceof ChartElement);
      },
      add(chartType = "bar", options = {}) {
        const el = new ChartElement(self, self.presentation._nextOoxmlId(), chartType, options);
        self._elements.push(el);
        return el;
      },
    };

    this.notes = {
      get text() {
        return self._notesText;
      },
      set text(val) {
        self._notesText = String(val ?? "");
      },
    };
  }

  compose(nodeTree, options = {}) {
    return composeIntoSlide(this, nodeTree, options);
  }

  _resolveShapeRef(ref) {
    if (!ref) return null;
    if (typeof ref === "object" && ref.ooxmlId) return ref;
    if (typeof ref === "string") {
      return this._elements.find((e) => e.id === ref || e.name === ref) || null;
    }
    return null;
  }

  _removeElement(el) {
    const idx = this._elements.indexOf(el);
    if (idx >= 0) this._elements.splice(idx, 1);
  }

  _moveElement(el, dir) {
    const idx = this._elements.indexOf(el);
    if (idx < 0) return;
    if (dir === "front") {
      this._elements.splice(idx, 1);
      this._elements.push(el);
    } else if (dir === "back") {
      this._elements.splice(idx, 1);
      this._elements.unshift(el);
    } else if (dir === "forward" && idx < this._elements.length - 1) {
      [this._elements[idx], this._elements[idx + 1]] = [this._elements[idx + 1], this._elements[idx]];
    } else if (dir === "backward" && idx > 0) {
      [this._elements[idx - 1], this._elements[idx]] = [this._elements[idx], this._elements[idx - 1]];
    }
  }
}
