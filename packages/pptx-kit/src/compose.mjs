// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { fontSizeToPx, normalizeInsetsPx } from "./units.mjs";
import { parseClassNameTokens, parseCompactTextStyleString } from "./tokens.mjs";
import { estimateParagraphsHeightPx, mergeTextStyle } from "./richtext.mjs";

function makeNode(type, props = {}, children = []) {
  const flat = [];
  const pushChild = (c) => {
    if (c === undefined || c === null || c === false) return;
    if (Array.isArray(c)) c.forEach(pushChild);
    else flat.push(c);
  };
  if (props && typeof props === "object" && "children" in props) {
    pushChild(props.children);
  }
  children.forEach(pushChild);
  const cleanProps = { ...(props || {}) };
  delete cleanProps.children;
  return { __yuanmouNode: true, type, props: cleanProps, children: flat };
}

// Clean JS composition builders (zero JSX transpiler needed in .mjs, while also accepting JSX VNodes!)
export const row = (props, ...children) => makeNode("row", props, children);
export const column = (props, ...children) => makeNode("column", props, children);
export const col = column;
export const grid = (props, ...children) => makeNode("grid", props, children);
export const layers = (props, ...children) => makeNode("layers", props, children);
export const box = (props, ...children) => makeNode("box", props, children);
export const paragraph = (props, ...children) => makeNode("paragraph", props, children);
export const run = (props, ...children) => makeNode("run", props, children);
export const shape = (props) => makeNode("shape", props, []);
export const image = (props) => makeNode("image", props, []);
export const rule = (props) => makeNode("rule", props, []);
export const table = (props) => makeNode("table", props, []);
export const chart = (props) => makeNode("chart", props, []);

export function h(type, props, ...children) {
  return makeNode(type, props, children);
}

function normalizeVNode(node) {
  if (node === undefined || node === null || node === false) return null;
  if (typeof node === "string" || typeof node === "number") {
    return makeNode("text", { value: String(node) }, []);
  }
  if (node.__yuanmouNode) {
    return {
      ...node,
      children: (node.children || []).map(normalizeVNode).filter(Boolean),
    };
  }
  // Standard React/JSX automatic runtime VNode `{ type, props: { ...props, children } }`
  if (typeof node === "object" && typeof node.type === "string") {
    return normalizeVNode(makeNode(node.type, node.props || {}, []));
  }
  return null;
}

function extractParagraphModel(pNode, defaultFont) {
  const { props, children } = pNode;
  const classText = props.className ? parseClassNameTokens(props.className).text : {};
  const inlineStyle =
    typeof props.style === "string"
      ? parseCompactTextStyleString(props.style)
      : props.style || {};
  const style = mergeTextStyle({ typeface: defaultFont, ...classText }, inlineStyle);

  const runs = [];
  for (const ch of children) {
    if (ch.type === "text") {
      runs.push({ run: ch.props.value, style: { ...style } });
    } else if (ch.type === "run") {
      const rClass = ch.props.className ? parseClassNameTokens(ch.props.className).text : {};
      const rStyle =
        typeof ch.props.textStyle === "string"
          ? parseCompactTextStyleString(ch.props.textStyle)
          : ch.props.textStyle || ch.props.style || {};
      const textContent = ch.children.map((x) => (x.type === "text" ? x.props.value : "")).join("");
      runs.push({
        run: textContent,
        style: { ...style, ...rClass, ...rStyle },
        link: ch.props.link,
      });
    }
  }

  const paraObj = {
    runs: runs.length ? runs : [{ run: "", style: { ...style } }],
    alignment: style.alignment,
    bulletCharacter: props.bulletCharacter,
    bulletColor: props.bulletColor,
    autoNumber: props.autoNumber,
    marginLeft: props.marginLeft,
    indent: props.indent,
    spaceBefore: props.spaceBefore,
    spaceAfter: props.spaceAfter,
    lineSpacing: style.lineSpacing,
  };

  return { paragraph: paraObj, style };
}

/**
 * Intrinsic height measurement (`height="hug"` / `"auto"`) given an allocated width.
 */
function measureIntrinsicHeight(node, availW, defaultFont) {
  const { type, props, children } = node;
  if (typeof props.height === "number") return props.height;

  const pad = normalizeInsetsPx(props.padding, { top: 0, right: 0, bottom: 0, left: 0 });
  const innerW = Math.max(16, availW - pad.left - pad.right);

  if (type === "rule") {
    return (props.weight ?? 1) + pad.top + pad.bottom;
  }
  if (type === "paragraph") {
    const { paragraph: paraObj, style } = extractParagraphModel(node, defaultFont);
    return estimateParagraphsHeightPx([paraObj], { ...style, insets: 0 }, innerW) + pad.top + pad.bottom;
  }
  if (type === "box") {
    if (children.length === 0) return pad.top + pad.bottom + 32;
    let maxChildH = 0;
    for (const c of children) {
      maxChildH = Math.max(maxChildH, measureIntrinsicHeight(c, innerW, defaultFont));
    }
    return maxChildH + pad.top + pad.bottom;
  }
  if (type === "column") {
    const gap = props.gap ?? 0;
    let sum = pad.top + pad.bottom;
    children.forEach((c, idx) => {
      sum += measureIntrinsicHeight(c, innerW, defaultFont);
      if (idx < children.length - 1) sum += gap;
    });
    return sum;
  }
  if (type === "row") {
    const gap = props.gap ?? 0;
    const totalGap = Math.max(0, children.length - 1) * gap;
    const fixedSum = children.reduce(
      (acc, c) => acc + (typeof c.props.width === "number" ? c.props.width : 0),
      0
    );
    const flexCount = children.filter((c) => typeof c.props.width !== "number").length;
    const flexW = flexCount > 0 ? Math.max(24, (innerW - fixedSum - totalGap) / flexCount) : innerW;

    let maxH = 0;
    for (const c of children) {
      const cw = typeof c.props.width === "number" ? c.props.width : flexW;
      maxH = Math.max(maxH, measureIntrinsicHeight(c, cw, defaultFont));
    }
    return maxH + pad.top + pad.bottom;
  }
  if (type === "layers") {
    let maxH = 0;
    for (const c of children) {
      maxH = Math.max(maxH, measureIntrinsicHeight(c, innerW, defaultFont));
    }
    return maxH + pad.top + pad.bottom;
  }
  return 120;
}

function measureIntrinsicWidth(node, defaultFont) {
  const { type, props } = node;
  if (typeof props.width === "number") return props.width;
  const pad = normalizeInsetsPx(props.padding, { top: 0, right: 0, bottom: 0, left: 0 });
  if (type === "paragraph") {
    const { paragraph: paraObj, style } = extractParagraphModel(node, defaultFont);
    const textLen = paraObj.runs.reduce((s, r) => s + String(r.run || "").length, 0);
    const fPx = fontSizeToPx(style.fontSize, 14);
    return Math.ceil(textLen * fPx * 0.92) + pad.left + pad.right + 8;
  }
  return 160;
}

/**
 * Recursively resolves layout frames and materializes flat native OOXML shapes/images on `slide`.
 */
export function composeIntoSlide(slide, rawRoot, options = {}) {
  const root = normalizeVNode(rawRoot);
  if (!root) return [];

  const frame = options.frame || {
    left: 0,
    top: 0,
    width: slide.presentation.slideSize.width,
    height: slide.presentation.slideSize.height,
  };
  const defaultFont = slide.presentation.defaultFont;
  const materialized = [];

  function layoutNode(node, rect) {
    const { type, props, children } = node;
    const pad = normalizeInsetsPx(props.padding, { top: 0, right: 0, bottom: 0, left: 0 });
    const inner = {
      left: rect.left + pad.left,
      top: rect.top + pad.top,
      width: Math.max(0, rect.width - pad.left - pad.right),
      height: Math.max(0, rect.height - pad.top - pad.bottom),
    };

    if (type === "slide") {
      if (props.background) slide.background.fill = props.background;
      const asCol = { ...node, type: "column" };
      layoutNode(asCol, rect);
      return;
    }

    if (type === "box") {
      const classTokens = props.className ? parseClassNameTokens(props.className) : { shape: {}, text: {} };
      const fill = props.fill ?? classTokens.shape.fill ?? "none";
      const borderRadius = props.borderRadius ?? classTokens.shape.borderRadius;
      const shadow = props.shadow ?? classTokens.shape.shadow;
      const line = props.line ?? { style: "solid", fill: "none", width: 0 };

      // Anti-Text-Overlay optimization (武器04 + 武器17):
      // When a `box` has a single `<paragraph>` child (or multiple paragraphs in one stack with no nested shapes),
      // emit ONE native `<p:sp>` carrying BOTH the box fill/border/radius AND the rich text!
      const allChildrenAreParagraphs =
        children.length > 0 && children.every((c) => c.type === "paragraph");

      if (allChildrenAreParagraphs) {
        const paraModels = children.map((c) => extractParagraphModel(c, defaultFont));
        const firstStyle = paraModels[0].style;
        const vAlign =
          props.align === "center" || props.justify === "center"
            ? "middle"
            : props.align === "end" || props.justify === "end"
              ? "bottom"
              : "top";

        const sp = slide.shapes.add({
          geometry: props.geometry || "rect",
          name: props.name || "composed-box",
          position: rect,
          fill,
          line,
          borderRadius,
          shadow,
          softEdge: props.softEdge,
        });
        sp.text.set(paraModels.map((m) => m.paragraph));
        sp.text.style = {
          typeface: firstStyle.typeface || defaultFont,
          wrap: firstStyle.wrap || "square",
          lineSpacing: firstStyle.lineSpacing,
          verticalAlignment: firstStyle.verticalAlignment || vAlign,
          insets: pad,
        };
        materialized.push(sp);
        return;
      }

      const bgShape = slide.shapes.add({
        geometry: props.geometry || "rect",
        name: props.name || "composed-surface",
        position: rect,
        fill,
        line,
        borderRadius,
        shadow,
        softEdge: props.softEdge,
      });
      materialized.push(bgShape);

      for (const child of children) {
        let cw = inner.width;
        let ch = inner.height;
        if (typeof child.props.width === "number") cw = child.props.width;
        else if (child.props.width === "hug") cw = Math.min(inner.width, measureIntrinsicWidth(child, defaultFont));

        if (typeof child.props.height === "number") ch = child.props.height;
        else if (child.props.height === "hug") ch = measureIntrinsicHeight(child, cw, defaultFont);

        let cx = inner.left;
        let cy = inner.top;
        if (props.justify === "center" || props.align === "center") {
          if (props.align === "center") cx = inner.left + (inner.width - cw) / 2;
          if (props.justify === "center") cy = inner.top + (inner.height - ch) / 2;
        }
        layoutNode(child, { left: cx, top: cy, width: cw, height: ch });
      }
      return;
    }

    if (type === "paragraph") {
      const { paragraph: paraObj, style } = extractParagraphModel(node, defaultFont);
      const tb = slide.shapes.add({
        geometry: "textbox",
        name: props.name || "composed-paragraph",
        position: rect,
        fill: "none",
        line: { style: "solid", fill: "none", width: 0 },
      });
      tb.text.set([paraObj]);
      tb.text.style = {
        ...style,
        insets: pad,
        verticalAlignment: style.verticalAlignment || "top",
      };
      materialized.push(tb);
      return;
    }

    if (type === "shape") {
      const classTokens = props.className ? parseClassNameTokens(props.className).shape : {};
      const sp = slide.shapes.add({
        ...classTokens,
        ...props,
        position: rect,
      });
      materialized.push(sp);
      return;
    }

    if (type === "image") {
      const classTokens = props.className ? parseClassNameTokens(props.className).shape : {};
      const im = slide.images.add({
        ...classTokens,
        ...props,
        position: rect,
      });
      materialized.push(im);
      return;
    }

    if (type === "table") {
      const tb = slide.tables.add({
        ...props,
        position: rect,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      materialized.push(tb);
      return;
    }

    if (type === "chart") {
      const ch = slide.charts.add(props.chartType || "bar", {
        ...props,
        position: rect,
      });
      materialized.push(ch);
      return;
    }

    if (type === "rule") {
      const weight = props.weight ?? 1;
      const stroke = props.stroke ?? "slate-200";
      const opacitySuffix =
        typeof props.opacity === "number" && props.opacity < 1
          ? `/${Math.round(props.opacity * 100)}`
          : "";
      const isVertical = rect.height > rect.width * 2 && props.width !== "fill";
      const ln = slide.shapes.add({
        geometry: "line",
        name: props.name || "composed-rule",
        position: isVertical
          ? { left: rect.left, top: rect.top, width: 0, height: rect.height }
          : { left: rect.left, top: rect.top, width: rect.width, height: 0 },
        fill: "none",
        line: { style: props.style || "solid", fill: `${stroke}${opacitySuffix}`, width: weight },
      });
      materialized.push(ln);
      return;
    }

    if (type === "layers") {
      for (const child of children) {
        const cw =
          typeof child.props.width === "number"
            ? child.props.width
            : child.props.width === "hug"
              ? measureIntrinsicWidth(child, defaultFont)
              : inner.width;
        const ch =
          typeof child.props.height === "number"
            ? child.props.height
            : child.props.height === "hug"
              ? measureIntrinsicHeight(child, cw, defaultFont)
              : inner.height;

        let cx = inner.left;
        let cy = inner.top;
        if (props.justifyItems === "center") cx = inner.left + (inner.width - cw) / 2;
        else if (props.justifyItems === "end") cx = inner.left + inner.width - cw;

        if (props.alignItems === "center") cy = inner.top + (inner.height - ch) / 2;
        else if (props.alignItems === "end") cy = inner.top + inner.height - ch;

        layoutNode(child, { left: cx, top: cy, width: cw, height: ch });
      }
      return;
    }

    if (type === "row") {
      if (children.length === 0) return;
      const gap = props.gap ?? 0;
      const justify = props.justify || "start";
      const align = props.align || "start";
      const totalGap = Math.max(0, children.length - 1) * gap;

      let fixedSum = 0;
      let fillCount = 0;
      const widths = children.map((c) => {
        if (typeof c.props.width === "number") {
          fixedSum += c.props.width;
          return c.props.width;
        }
        if (c.props.width === "fill") {
          fillCount++;
          return null;
        }
        const w = measureIntrinsicWidth(c, defaultFont);
        fixedSum += w;
        return w;
      });

      const remW = Math.max(0, inner.width - fixedSum - totalGap);
      const fillEach = fillCount > 0 ? remW / fillCount : 0;
      const resolvedW = widths.map((w) => (w === null ? fillEach : w));
      const usedW = resolvedW.reduce((a, b) => a + b, 0) + totalGap;

      let curX = inner.left;
      let stepGap = gap;
      if (fillCount === 0) {
        if (justify === "center") curX = inner.left + (inner.width - usedW) / 2;
        else if (justify === "end") curX = inner.left + inner.width - usedW;
        else if (justify === "between" && children.length > 1) {
          const onlyItems = resolvedW.reduce((a, b) => a + b, 0);
          stepGap = Math.max(0, (inner.width - onlyItems) / (children.length - 1));
        }
      }

      children.forEach((child, idx) => {
        const cw = resolvedW[idx];
        let ch;
        if (typeof child.props.height === "number") ch = child.props.height;
        else if (child.props.height === "fill" || align === "stretch") ch = inner.height;
        else ch = measureIntrinsicHeight(child, cw, defaultFont);

        let cy = inner.top;
        if (align === "center") cy = inner.top + (inner.height - ch) / 2;
        else if (align === "end") cy = inner.top + inner.height - ch;

        layoutNode(child, { left: curX, top: cy, width: cw, height: ch });
        curX += cw + stepGap;
      });
      return;
    }

    if (type === "column") {
      if (children.length === 0) return;
      const gap = props.gap ?? 0;
      const justify = props.justify || "start";
      const align = props.align || "stretch";
      const totalGap = Math.max(0, children.length - 1) * gap;

      const resolvedW = children.map((c) => {
        if (typeof c.props.width === "number") return c.props.width;
        if (c.props.width === "hug") return Math.min(inner.width, measureIntrinsicWidth(c, defaultFont));
        return inner.width;
      });

      let fixedSum = 0;
      let fillCount = 0;
      const heights = children.map((c, idx) => {
        if (typeof c.props.height === "number") {
          fixedSum += c.props.height;
          return c.props.height;
        }
        if (c.props.height === "fill") {
          fillCount++;
          return null;
        }
        const hVal = measureIntrinsicHeight(c, resolvedW[idx], defaultFont);
        fixedSum += hVal;
        return hVal;
      });

      const remH = Math.max(0, inner.height - fixedSum - totalGap);
      const fillEach = fillCount > 0 ? remH / fillCount : 0;
      const resolvedH = heights.map((hVal) => (hVal === null ? fillEach : hVal));
      const usedH = resolvedH.reduce((a, b) => a + b, 0) + totalGap;

      let curY = inner.top;
      let stepGap = gap;
      if (fillCount === 0) {
        if (justify === "center") curY = inner.top + (inner.height - usedH) / 2;
        else if (justify === "end") curY = inner.top + inner.height - usedH;
        else if (justify === "between" && children.length > 1) {
          const onlyItems = resolvedH.reduce((a, b) => a + b, 0);
          stepGap = Math.max(0, (inner.height - onlyItems) / (children.length - 1));
        }
      }

      children.forEach((child, idx) => {
        const cw = resolvedW[idx];
        const ch = resolvedH[idx];
        let cx = inner.left;
        if (align === "center") cx = inner.left + (inner.width - cw) / 2;
        else if (align === "end") cx = inner.left + inner.width - cw;

        layoutNode(child, { left: cx, top: curY, width: cw, height: ch });
        curY += ch + stepGap;
      });
      return;
    }

    if (type === "grid") {
      if (children.length === 0) return;
      const colGap = props.columnGap ?? props.gap ?? 16;
      const rowGap = props.rowGap ?? props.gap ?? 16;

      // Normalize column tracks: number (e.g. `columns: 12`) or array of `{ mode: 'fr'|'fixed', value }`
      const colTracks =
        typeof props.columns === "number"
          ? Array.from({ length: props.columns }, () => ({ mode: "fr", value: 1 }))
          : Array.isArray(props.columns) && props.columns.length > 0
            ? props.columns.map((t) =>
                typeof t === "number" ? { mode: "fixed", value: t } : t
              )
            : [{ mode: "fr", value: 1 }, { mode: "fr", value: 1 }];

      const numCols = colTracks.length;
      const totalColGap = Math.max(0, numCols - 1) * colGap;
      let fixedColW = 0;
      let totalFr = 0;
      for (const tr of colTracks) {
        if (tr.mode === "fixed") fixedColW += tr.value;
        else totalFr += tr.value || 1;
      }
      const frUnitW = totalFr > 0 ? Math.max(0, (inner.width - fixedColW - totalColGap) / totalFr) : 0;
      const colWidths = colTracks.map((tr) => (tr.mode === "fixed" ? tr.value : (tr.value || 1) * frUnitW));
      const colStarts = [];
      let accX = inner.left;
      for (const w of colWidths) {
        colStarts.push(accX);
        accX += w + colGap;
      }

      // Auto-place grid items supporting `columnSpan` and `rowSpan`
      const occupied = [];
      const placements = [];
      let cursorRow = 0;
      let cursorCol = 0;

      const isFree = (r, c, rSpan, cSpan) => {
        if (c + cSpan > numCols) return false;
        for (let rr = r; rr < r + rSpan; rr++) {
          const rowArr = occupied[rr] || [];
          for (let cc = c; cc < c + cSpan; cc++) {
            if (rowArr[cc]) return false;
          }
        }
        return true;
      };

      const markOccupied = (r, c, rSpan, cSpan) => {
        for (let rr = r; rr < r + rSpan; rr++) {
          if (!occupied[rr]) occupied[rr] = [];
          for (let cc = c; cc < c + cSpan; cc++) {
            occupied[rr][cc] = true;
          }
        }
      };

      let maxRowReached = 0;
      for (const child of children) {
        const cSpan = Math.min(numCols, Math.max(1, child.props.columnSpan || 1));
        const rSpan = Math.max(1, child.props.rowSpan || 1);
        while (!isFree(cursorRow, cursorCol, rSpan, cSpan)) {
          cursorCol++;
          if (cursorCol >= numCols) {
            cursorCol = 0;
            cursorRow++;
          }
        }
        markOccupied(cursorRow, cursorCol, rSpan, cSpan);
        placements.push({ child, row: cursorRow, col: cursorCol, rSpan, cSpan });
        maxRowReached = Math.max(maxRowReached, cursorRow + rSpan);
        cursorCol += cSpan;
        if (cursorCol >= numCols) {
          cursorCol = 0;
          cursorRow++;
        }
      }

      const numRows = Math.max(1, maxRowReached);
      const totalRowGap = Math.max(0, numRows - 1) * rowGap;
      let rowHeights;

      if (Array.isArray(props.rows) && props.rows.length > 0) {
        const rTracks = Array.from({ length: numRows }, (_, i) => props.rows[i] || { mode: "fr", value: 1 });
        let fixedH = 0;
        let frR = 0;
        rTracks.forEach((tr, rIdx) => {
          if (typeof tr === "number") fixedH += tr;
          else if (tr === "auto" || tr.mode === "auto") {
            let maxInRow = 32;
            for (const p of placements) {
              if (p.row === rIdx && p.rSpan === 1) {
                const spanW =
                  colWidths.slice(p.col, p.col + p.cSpan).reduce((a, b) => a + b, 0) +
                  (p.cSpan - 1) * colGap;
                maxInRow = Math.max(maxInRow, measureIntrinsicHeight(p.child, spanW, defaultFont));
              }
            }
            tr._resolvedAuto = maxInRow;
            fixedH += maxInRow;
          } else if (tr.mode === "fixed") fixedH += tr.value;
          else frR += tr.value || 1;
        });
        const rUnit = frR > 0 ? Math.max(0, (inner.height - fixedH - totalRowGap) / frR) : 0;
        rowHeights = rTracks.map((tr) => {
          if (typeof tr === "number") return tr;
          if (tr === "auto" || tr.mode === "auto") return tr._resolvedAuto;
          if (tr.mode === "fixed") return tr.value;
          return (tr.value || 1) * rUnit;
        });
      } else {
        const eachH = Math.max(16, (inner.height - totalRowGap) / numRows);
        rowHeights = Array.from({ length: numRows }, () => eachH);
      }

      const rowStarts = [];
      let accY = inner.top;
      for (const hVal of rowHeights) {
        rowStarts.push(accY);
        accY += hVal + rowGap;
      }

      for (const p of placements) {
        const cellX = colStarts[p.col];
        const cellY = rowStarts[p.row];
        const cellW =
          colWidths.slice(p.col, p.col + p.cSpan).reduce((a, b) => a + b, 0) +
          (p.cSpan - 1) * colGap;
        const cellH =
          rowHeights.slice(p.row, p.row + p.rSpan).reduce((a, b) => a + b, 0) +
          (p.rSpan - 1) * rowGap;

        layoutNode(p.child, { left: cellX, top: cellY, width: cellW, height: cellH });
      }
    }
  }

  layoutNode(root, frame);
  return materialized;
}
