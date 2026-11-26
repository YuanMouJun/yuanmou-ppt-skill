// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { pxToEmu, resolveBorderRadius } from "./units.mjs";

export const PRESET_GEOMETRIES = new Set([
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "rtTriangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "pentagon",
  "hexagon",
  "heptagon",
  "octagon",
  "decagon",
  "dodecagon",
  "chevron",
  "homePlate",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "leftRightArrow",
  "upDownArrow",
  "bentArrow",
  "uturnArrow",
  "notchedRightArrow",
  "stripedRightArrow",
  "snip1Rect",
  "snip2SameRect",
  "snip2DiagRect",
  "round1Rect",
  "round2SameRect",
  "round2DiagRect",
  "snipRoundRect",
  "plaque",
  "can",
  "cube",
  "bevel",
  "donut",
  "blockArc",
  "arc",
  "chord",
  "pie",
  "funnel",
  "plus",
  "frame",
  "halfFrame",
  "corner",
  "RightBracket",
  "LeftBracket",
  "leftBracket",
  "rightBracket",
  "leftBrace",
  "rightBrace",
  "bracketPair",
  "bracePair",
  "line",
  "straightConnector1",
  "bentConnector3",
  "curvedConnector3",
]);

const GEOMETRY_ALIASES = Object.freeze({
  textbox: "rect",
  circle: "ellipse",
  oval: "ellipse",
  pill: "roundRect",
});

/**
 * Parses an SVG `d="..."` path string (M, L, H, V, C, Q, Z; both absolute and relative)
 * into structured `customPaths` commands in the given viewport coordinates.
 */
export function parseSvgPathToCommands(d) {
  if (!d || typeof d !== "string") return [];
  const tokens = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];

  const commands = [];
  let i = 0;
  let cmd = "";
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const nextNum = () => Number.parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && /^[-+.\d]/.test(tokens[i]);

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      cmd = tokens[i++];
    }
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === "M") {
      let first = true;
      while (isNum()) {
        const x = nextNum() + (rel ? curX : 0);
        const y = nextNum() + (rel ? curY : 0);
        curX = x;
        curY = y;
        if (first) {
          startX = x;
          startY = y;
          commands.push({ moveTo: { x, y } });
          first = false;
        } else {
          commands.push({ lineTo: { x, y } });
        }
      }
    } else if (upper === "L") {
      while (isNum()) {
        curX = nextNum() + (rel ? curX : 0);
        curY = nextNum() + (rel ? curY : 0);
        commands.push({ lineTo: { x: curX, y: curY } });
      }
    } else if (upper === "H") {
      while (isNum()) {
        curX = nextNum() + (rel ? curX : 0);
        commands.push({ lineTo: { x: curX, y: curY } });
      }
    } else if (upper === "V") {
      while (isNum()) {
        curY = nextNum() + (rel ? curY : 0);
        commands.push({ lineTo: { x: curX, y: curY } });
      }
    } else if (upper === "C") {
      while (isNum()) {
        const x1 = nextNum() + (rel ? curX : 0);
        const y1 = nextNum() + (rel ? curY : 0);
        const x2 = nextNum() + (rel ? curX : 0);
        const y2 = nextNum() + (rel ? curY : 0);
        const x = nextNum() + (rel ? curX : 0);
        const y = nextNum() + (rel ? curY : 0);
        curX = x;
        curY = y;
        commands.push({ cubicBezTo: { x1, y1, x2, y2, x, y } });
      }
    } else if (upper === "Q") {
      while (isNum()) {
        const x1 = nextNum() + (rel ? curX : 0);
        const y1 = nextNum() + (rel ? curY : 0);
        const x = nextNum() + (rel ? curX : 0);
        const y = nextNum() + (rel ? curY : 0);
        curX = x;
        curY = y;
        commands.push({ quadBezTo: { x1, y1, x, y } });
      }
    } else if (upper === "Z") {
      curX = startX;
      curY = startY;
      commands.push({ close: {} });
    } else {
      // Skip unsupported arc/smooth parameters gracefully if encountered
      while (isNum()) nextNum();
    }
  }
  return commands;
}

/**
 * Renders `<a:prstGeom>` or `<a:custGeom>` XML.
 */
export function renderGeometryXml({
  geometry = "rect",
  width = 100,
  height = 100,
  borderRadius,
  adjustmentList,
  customPaths,
  svgPath,
  viewBox,
}) {
  // Custom path mode (structured `customPaths` or SVG `svgPath`)
  const paths =
    Array.isArray(customPaths) && customPaths.length > 0
      ? customPaths
      : svgPath
        ? [
            {
              width: viewBox?.width ?? width,
              height: viewBox?.height ?? height,
              commands: parseSvgPathToCommands(svgPath),
            },
          ]
        : null;

  if (geometry === "custom" || paths) {
    if (!paths || paths.length === 0) {
      throw new Error('geometry="custom" requires `customPaths` or `svgPath`');
    }
    const pathXmlList = paths
      .map((p) => {
        const wEmu = Math.max(1, pxToEmu(p.width ?? width));
        const hEmu = Math.max(1, pxToEmu(p.height ?? height));
        const cmdsXml = (p.commands || [])
          .map((cmd) => {
            if (cmd.moveTo || cmd.cmd === "moveTo") {
              const pt = cmd.moveTo || cmd;
              return `<a:moveTo><a:pt x="${pxToEmu(pt.x)}" y="${pxToEmu(pt.y)}"/></a:moveTo>`;
            }
            if (cmd.lineTo || cmd.cmd === "lineTo") {
              const pt = cmd.lineTo || cmd;
              return `<a:lnTo><a:pt x="${pxToEmu(pt.x)}" y="${pxToEmu(pt.y)}"/></a:lnTo>`;
            }
            if (cmd.quadBezTo || cmd.cmd === "quadBezTo") {
              const q = cmd.quadBezTo || cmd;
              return `<a:quadBezTo><a:pt x="${pxToEmu(q.x1)}" y="${pxToEmu(q.y1)}"/><a:pt x="${pxToEmu(q.x)}" y="${pxToEmu(q.y)}"/></a:quadBezTo>`;
            }
            if (cmd.cubicBezTo || cmd.cmd === "cubicBezTo") {
              const c = cmd.cubicBezTo || cmd;
              return `<a:cubicBezTo><a:pt x="${pxToEmu(c.x1)}" y="${pxToEmu(c.y1)}"/><a:pt x="${pxToEmu(c.x2)}" y="${pxToEmu(c.y2)}"/><a:pt x="${pxToEmu(c.x)}" y="${pxToEmu(c.y)}"/></a:cubicBezTo>`;
            }
            if (cmd.close !== undefined || cmd.cmd === "close") {
              return `<a:close/>`;
            }
            return "";
          })
          .join("");
        return `<a:path w="${wEmu}" h="${hEmu}">${cmdsXml}</a:path>`;
      })
      .join("");

    return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>${pathXmlList}</a:pathLst></a:custGeom>`;
  }

  let prst = GEOMETRY_ALIASES[geometry] || geometry;
  if (!PRESET_GEOMETRIES.has(prst)) prst = "rect";

  const avItems = [];
  if (Array.isArray(adjustmentList) && adjustmentList.length > 0) {
    for (const item of adjustmentList) {
      if (item?.name && item?.formula) {
        avItems.push(`<a:gd name="${item.name}" fmla="${item.formula}"/>`);
      }
    }
  } else if (borderRadius !== undefined && borderRadius !== null) {
    const { radiusPx, adj } = resolveBorderRadius(borderRadius, width, height);
    if (radiusPx > 0 && (prst === "rect" || prst === "roundRect")) {
      prst = "roundRect";
      avItems.push(`<a:gd name="adj" fmla="val ${adj}"/>`);
    }
  }

  if (avItems.length === 0) {
    return `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`;
  }
  return `<a:prstGeom prst="${prst}"><a:avLst>${avItems.join("")}</a:avLst></a:prstGeom>`;
}

// Standard OpenXML preset connection site indices for 4-cardinal shapes:
// 0 = top, 1 = left, 2 = bottom, 3 = right
export const SIDE_TO_SITE_IDX = Object.freeze({
  top: 0,
  left: 1,
  bottom: 2,
  right: 3,
});

export function getAnchorPointOnBox(pos, side) {
  const { left = 0, top = 0, width = 0, height = 0 } = pos;
  switch (side) {
    case "top":
      return { x: left + width / 2, y: top };
    case "bottom":
      return { x: left + width / 2, y: top + height };
    case "left":
      return { x: left, y: top + height / 2 };
    case "right":
    default:
      return { x: left + width, y: top + height / 2 };
  }
}

export function inferBestConnectorSides(fromPos, toPos, explicitFrom, explicitTo) {
  if (explicitFrom && explicitTo) return { fromSide: explicitFrom, toSide: explicitTo };
  const fcX = fromPos.left + fromPos.width / 2;
  const fcY = fromPos.top + fromPos.height / 2;
  const tcX = toPos.left + toPos.width / 2;
  const tcY = toPos.top + toPos.height / 2;
  const dx = tcX - fcX;
  const dy = tcY - fcY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      fromSide: explicitFrom || (dx >= 0 ? "right" : "left"),
      toSide: explicitTo || (dx >= 0 ? "left" : "right"),
    };
  }
  return {
    fromSide: explicitFrom || (dy >= 0 ? "bottom" : "top"),
    toSide: explicitTo || (dy >= 0 ? "top" : "bottom"),
  };
}

export function mapConnectorKindToPreset(kind = "elbow") {
  if (kind === "straight") return "straightConnector1";
  if (kind === "curved") return "curvedConnector3";
  return "bentConnector3";
}

/**
 * Converts an open 2D polyline `[{x, y}, ...]` + stroke `thickness` (in px)
 * into a closed mitered polygon `commands` array for `<a:custGeom>`.
 * Essential for cross-platform transparent gradient borders (`<a:gradFill>` with `<a:alpha>`),
 * which LibreOffice / WPS / Google Slides drop if placed inside `<a:ln>`.
 */
export function buildPolylineStrokeCommands(points, thickness = 1.5) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const half = thickness / 2;
  const n = points.length;

  const segNormals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy) || 1;
    segNormals.push({ nx: -dy / len, ny: dx / len });
  }

  const leftSide = [];
  const rightSide = [];

  for (let i = 0; i < n; i++) {
    let nx, ny, scale = 1;
    if (i === 0) {
      ({ nx, ny } = segNormals[0]);
    } else if (i === n - 1) {
      ({ nx, ny } = segNormals[n - 2]);
    } else {
      const n1 = segNormals[i - 1];
      const n2 = segNormals[i];
      const mx = n1.nx + n2.nx;
      const my = n1.ny + n2.ny;
      const mLen = Math.hypot(mx, my);
      if (mLen < 1e-4) {
        nx = n1.nx;
        ny = n1.ny;
      } else {
        nx = mx / mLen;
        ny = my / mLen;
        const dot = nx * n1.nx + ny * n1.ny;
        scale = Math.min(2.5, 1 / Math.max(0.25, dot));
      }
    }
    const offX = nx * half * scale;
    const offY = ny * half * scale;
    leftSide.push({ x: points[i].x + offX, y: points[i].y + offY });
    rightSide.push({ x: points[i].x - offX, y: points[i].y - offY });
  }

  const cmds = [{ moveTo: leftSide[0] }];
  for (let i = 1; i < n; i++) cmds.push({ lineTo: leftSide[i] });
  for (let i = n - 1; i >= 0; i--) cmds.push({ lineTo: rightSide[i] });
  cmds.push({ close: {} });
  return cmds;
}

/**
 * Rounds every vertex of a closed polygon with smooth quadratic Bezier curves (`quadBezTo`),
 * clamping the corner radius automatically to 45% of the shorter adjacent edge.
 * Eliminates sharp/jagged polygon corners when cloning rounded trapezoids, funnels, chevrons, etc.
 */
export function buildRoundedPolygonCommands(points, radius = 12) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("buildRoundedPolygonCommands requires at least 3 points");
  }
  const rReq = Math.max(0, Number(radius) || 0);
  const n = points.length;
  if (rReq === 0) {
    const cmds = [{ moveTo: { x: points[0].x, y: points[0].y } }];
    for (let i = 1; i < n; i++) cmds.push({ lineTo: { x: points[i].x, y: points[i].y } });
    cmds.push({ close: {} });
    return cmds;
  }

  const cmds = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const len1 = Math.hypot(v1x, v1y) || 1;

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y) || 1;

    const r = Math.min(rReq, len1 * 0.45, len2 * 0.45);
    const pStart = { x: curr.x + (v1x / len1) * r, y: curr.y + (v1y / len1) * r };
    const pEnd = { x: curr.x + (v2x / len2) * r, y: curr.y + (v2y / len2) * r };

    if (i === 0) {
      cmds.push({ moveTo: pStart });
    } else {
      cmds.push({ lineTo: pStart });
    }
    cmds.push({ quadBezTo: { x1: curr.x, y1: curr.y, x: pEnd.x, y: pEnd.y } });
  }
  cmds.push({ close: {} });
  return cmds;
}

/**
 * Convenience helper returning a `customPaths` array entry for a smooth rounded trapezoid/funnel tier.
 */
export function buildRoundedTrapezoidPath({
  width,
  height,
  topInset = 0,
  bottomInset = 0,
  radius = 14,
}) {
  const pts = [
    { x: topInset, y: 0 },
    { x: width - topInset, y: 0 },
    { x: width - bottomInset, y: height },
    { x: bottomInset, y: height },
  ];
  return {
    width,
    height,
    closed: true,
    commands: buildRoundedPolygonCommands(pts, radius),
  };
}
