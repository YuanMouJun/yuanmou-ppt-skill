// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).

import { createHash } from "node:crypto";
import { normalizeInsetsPx, pxToEmu } from "./units.mjs";
import { renderFillXml, renderLineXml } from "./tokens.mjs";
import { mergeTextStyle, normalizeParagraphs, renderTxBodyXml } from "./richtext.mjs";
import { attrs } from "./xml.mjs";

const TABLE_URI = "http://schemas.openxmlformats.org/drawingml/2006/table";

export const fr = (value = 1) => ({ mode: "fr", value });
export const fixed = (value = 100) => ({ mode: "fixed", value });

function makeTableAnchorId(slideId, ooxmlId) {
  return `tb/${createHash("sha1").update(`${slideId}:${ooxmlId}`).digest("hex").slice(0, 8)}`;
}

function renderCellBorderTag(tag, borderCfg) {
  if (!borderCfg || borderCfg === "none" || borderCfg.fill === "none" || borderCfg.width === 0) {
    return `<${tag} w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></${tag}>`;
  }
  // Reuse renderLineXml and swap outer `<a:ln ...>...</a:ln>` tag to `<a:lnL ...>...</a:lnL>`
  const lnXml = renderLineXml(borderCfg);
  return lnXml.replace(/^<a:ln\b/, `<${tag}`).replace(/<\/a:ln>$/, `</${tag}>`);
}

class TableCellFacade {
  constructor(table, rowIdx, colIdx, initialVal) {
    this.table = table;
    this.rowIndex = rowIdx;
    this.columnIndex = colIdx;
    this._paragraphs = initialVal !== undefined ? normalizeParagraphs(initialVal) : [{ runs: [{ run: "" }] }];
    this.fill = undefined;
    this._textStyle = {};
    this.borders = {}; // { top, bottom, left, right }
    this.insets = undefined;
    this.gridSpan = 1;
    this.rowSpan = 1;
    this.hMerge = false;
    this.vMerge = false;

    const self = this;
    this.text = {
      get style() {
        return self._textStyle;
      },
      set style(val) {
        self._textStyle = mergeTextStyle(self._textStyle, val);
      },
      set(v) {
        self._paragraphs = normalizeParagraphs(v);
      },
      toPlainString() {
        return self._paragraphs.map((p) => (p.runs || []).map((r) => r.run || "").join("")).join("\n");
      },
    };
  }

  get value() {
    return this.text.toPlainString();
  }

  set value(v) {
    this._paragraphs = normalizeParagraphs(v);
  }
}

export class TableElement {
  constructor(slide, ooxmlId, options = {}) {
    this.slide = slide;
    this.kind = "table";
    this.ooxmlId = ooxmlId;
    this.id = makeTableAnchorId(slide.id, ooxmlId);
    this.name = options.name || `table-${ooxmlId}`;

    const values = Array.isArray(options.values) ? options.values : [];
    this.rowCount = Math.max(1, options.rows ?? (values.length || 2));
    this.columnCount = Math.max(
      1,
      options.columns ?? (values[0]?.length || options.columnWidths?.length || options.columnTracks?.length || 2)
    );

    const pos = options.position || {};
    this.position = {
      left: options.left ?? pos.left ?? 64,
      top: options.top ?? pos.top ?? 140,
      width: options.width ?? pos.width ?? 800,
      height: options.height ?? pos.height ?? this.rowCount * 42,
    };

    this.columnTracks = options.columnTracks || null;
    this.columnWidths = options.columnWidths || null;
    this.rowHeights = options.rowHeights || null;

    // Styling defaults (clean consulting editorial table, zero garish default PowerPoint blue!)
    this.headerRow = options.headerRow !== false;
    this.totalRow = Boolean(options.totalRow);
    this.zebraFill = options.zebraFill !== undefined ? options.zebraFill : "#F8FAFC";
    this.headerFill = options.headerFill !== undefined ? options.headerFill : "#0F3A7D";
    this.headerTextStyle = {
      fontSize: 14,
      bold: true,
      color: "#FFFFFF",
      alignment: "center",
      verticalAlignment: "middle",
      ...(options.headerTextStyle || {}),
    };
    this.bodyTextStyle = {
      fontSize: 13.5,
      bold: false,
      color: "#1E293B",
      alignment: "left",
      verticalAlignment: "middle",
      ...(options.bodyTextStyle || {}),
    };
    this.totalRowFill = options.totalRowFill ?? "#EFF6FF";
    this.totalRowTextStyle = {
      fontSize: 14,
      bold: true,
      color: "#0F172A",
      verticalAlignment: "middle",
      ...(options.totalRowTextStyle || {}),
    };
    this.cellPadding = options.cellPadding || { top: 7, bottom: 7, left: 12, right: 12 };

    const defaultBorder = options.border || { style: "solid", fill: "#E2E8F0", width: 1 };
    this._defaultBorders = {
      top: options.borders?.top ?? defaultBorder,
      bottom: options.borders?.bottom ?? defaultBorder,
      left: options.borders?.left ?? (options.verticalBorders ? defaultBorder : "none"),
      right: options.borders?.right ?? (options.verticalBorders ? defaultBorder : "none"),
    };

    // Build cell matrix
    this._grid = Array.from({ length: this.rowCount }, (_, r) =>
      Array.from({ length: this.columnCount }, (__, c) => {
        const initVal = values[r]?.[c] !== undefined ? values[r][c] : "";
        return new TableCellFacade(this, r, c, initVal);
      })
    );

    const self = this;
    this.cells = {
      set(r, c, val) {
        const cell = self.getCell(r, c);
        cell.value = val;
        return cell;
      },
      block({ startRow = 0, endRow = self.rowCount - 1, startColumn = 0, endColumn = self.columnCount - 1 } = {}) {
        const targets = [];
        for (let r = startRow; r <= endRow; r++) {
          for (let c = startColumn; c <= endColumn; c++) {
            if (self._grid[r]?.[c]) targets.push(self._grid[r][c]);
          }
        }
        return {
          set fill(f) {
            targets.forEach((t) => {
              t.fill = f;
            });
          },
          set style(st) {
            targets.forEach((t) => {
              t.text.style = st;
            });
          },
          textStyle: new Proxy(
            {},
            {
              set(_, prop, value) {
                targets.forEach((t) => {
                  t.text.style = { [prop]: value };
                });
                return true;
              },
            }
          ),
        };
      },
    };

    this.borders = {
      assign(lineCfg) {
        self._defaultBorders = {
          top: lineCfg,
          bottom: lineCfg,
          left: lineCfg,
          right: lineCfg,
        };
      },
    };
  }

  getCell(r, c) {
    if (!this._grid[r]?.[c]) {
      throw new Error(`Table cell (${r}, ${c}) out of bounds (${this.rowCount}x${this.columnCount})`);
    }
    return this._grid[r][c];
  }

  merge({ startRow, endRow, startColumn, endColumn }) {
    const r0 = Math.max(0, startRow);
    const r1 = Math.min(this.rowCount - 1, endRow);
    const c0 = Math.max(0, startColumn);
    const c1 = Math.min(this.columnCount - 1, endColumn);
    const rSpan = r1 - r0 + 1;
    const cSpan = c1 - c0 + 1;
    if (rSpan <= 1 && cSpan <= 1) return this;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this._grid[r][c];
        if (r === r0 && c === c0) {
          cell.rowSpan = rSpan;
          cell.gridSpan = cSpan;
          cell.hMerge = false;
          cell.vMerge = false;
        } else {
          cell.gridSpan = c === c0 && cSpan > 1 ? cSpan : 1;
          cell.rowSpan = 1;
          cell.hMerge = c > c0;
          cell.vMerge = r > r0;
        }
      }
    }
    return this;
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

  _resolveColumnWidthsPx() {
    const totalW = this.position.width;
    if (Array.isArray(this.columnWidths) && this.columnWidths.length === this.columnCount) {
      return this.columnWidths;
    }
    if (Array.isArray(this.columnTracks) && this.columnTracks.length === this.columnCount) {
      let fixedSum = 0;
      let frSum = 0;
      for (const tr of this.columnTracks) {
        if (typeof tr === "number") fixedSum += tr;
        else if (tr.mode === "fixed") fixedSum += tr.value;
        else frSum += tr.value || 1;
      }
      const rem = Math.max(0, totalW - fixedSum);
      const unit = frSum > 0 ? rem / frSum : 0;
      return this.columnTracks.map((tr) => {
        if (typeof tr === "number") return tr;
        if (tr.mode === "fixed") return tr.value;
        return (tr.value || 1) * unit;
      });
    }
    const eq = totalW / this.columnCount;
    return Array.from({ length: this.columnCount }, () => eq);
  }

  _resolveRowHeightsPx() {
    if (Array.isArray(this.rowHeights) && this.rowHeights.length === this.rowCount) {
      return this.rowHeights;
    }
    const eq = this.position.height / this.rowCount;
    return Array.from({ length: this.rowCount }, () => eq);
  }

  toXml(ctx) {
    const colWidths = this._resolveColumnWidthsPx();
    const rowHeights = this._resolveRowHeightsPx();
    const defaultFont = this.slide.presentation.defaultFont;

    const nvGraphicFramePr =
      `<p:nvGraphicFramePr>` +
      `<p:cNvPr id="${this.ooxmlId}" name="${this.name}"/>` +
      `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>` +
      `<p:nvPr/>` +
      `</p:nvGraphicFramePr>`;

    const xfrmXml =
      `<p:xfrm>` +
      `<a:off x="${pxToEmu(this.position.left)}" y="${pxToEmu(this.position.top)}"/>` +
      `<a:ext cx="${pxToEmu(this.position.width)}" cy="${pxToEmu(this.position.height)}"/>` +
      `</p:xfrm>`;

    const gridColsXml = colWidths.map((w) => `<a:gridCol w="${Math.max(1, pxToEmu(w))}"/>`).join("");

    const rowsXml = this._grid
      .map((rowCells, rIdx) => {
        const isHeader = this.headerRow && rIdx === 0;
        const isTotal = this.totalRow && rIdx === this.rowCount - 1 && !isHeader;
        const rowH = Math.max(1, pxToEmu(rowHeights[rIdx]));

        const cellsXml = rowCells
          .map((cell) => {
            const baseRoleStyle = isHeader
              ? this.headerTextStyle
              : isTotal
                ? this.totalRowTextStyle
                : this.bodyTextStyle;
            const mergedStyle = mergeTextStyle(baseRoleStyle, cell._textStyle);
            const pad = normalizeInsetsPx(cell.insets ?? this.cellPadding, {
              top: 6,
              right: 10,
              bottom: 6,
              left: 10,
            });

            // Auto-pick cell fill: explicit -> header -> total -> zebra -> white
            let fillVal = cell.fill;
            if (fillVal === undefined) {
              if (isHeader) fillVal = this.headerFill;
              else if (isTotal) fillVal = this.totalRowFill;
              else if (this.zebraFill && rIdx % 2 === 0) fillVal = this.zebraFill;
              else fillVal = "#FFFFFF";
            }

            const headerBottomBorder = isHeader
              ? { style: "solid", fill: this.headerFill || "#0F3A7D", width: 1.5 }
              : undefined;
            const totalTopBorder = isTotal
              ? { style: "solid", fill: "#0F3A7D", width: 1.5 }
              : undefined;

            const bLeft = cell.borders.left ?? this._defaultBorders.left;
            const bRight = cell.borders.right ?? this._defaultBorders.right;
            const bTop = cell.borders.top ?? totalTopBorder ?? this._defaultBorders.top;
            const bBottom = cell.borders.bottom ?? headerBottomBorder ?? this._defaultBorders.bottom;

            const rawTxBody = renderTxBodyXml({
              paragraphs: cell._paragraphs,
              baseStyle: { ...mergedStyle, insets: 0 },
              defaultFont,
              isTextbox: false,
              registerHyperlink: ctx.registerHyperlink,
            });
            // Inside DrawingML `<a:tc>`, the element tag is `<a:txBody>`, not `<p:txBody>`!
            const txBody = rawTxBody
              .replace(/^<p:txBody>/, "<a:txBody>")
              .replace(/<\/p:txBody>$/, "</a:txBody>");

            const anchor =
              mergedStyle.verticalAlignment === "top"
                ? "t"
                : mergedStyle.verticalAlignment === "bottom"
                  ? "b"
                  : "ctr";

            // Exact ECMA-376 CT_TableCellProperties sequence: lnL -> lnR -> lnT -> lnB -> fill
            const tcPr =
              `<a:tcPr${attrs({
                marL: pxToEmu(pad.left),
                marR: pxToEmu(pad.right),
                marT: pxToEmu(pad.top),
                marB: pxToEmu(pad.bottom),
                anchor,
              })}>` +
              renderCellBorderTag("a:lnL", bLeft) +
              renderCellBorderTag("a:lnR", bRight) +
              renderCellBorderTag("a:lnT", bTop) +
              renderCellBorderTag("a:lnB", bBottom) +
              renderFillXml(fillVal) +
              `</a:tcPr>`;

            const tcAttrs = {
              gridSpan: cell.gridSpan > 1 ? cell.gridSpan : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              hMerge: cell.hMerge ? "1" : undefined,
              vMerge: cell.vMerge ? "1" : undefined,
            };
            return `<a:tc${attrs(tcAttrs)}>${txBody}${tcPr}</a:tc>`;
          })
          .join("");

        return `<a:tr h="${rowH}">${cellsXml}</a:tr>`;
      })
      .join("");

    const tblXml = `<a:tbl><a:tblPr><a:noFill/></a:tblPr><a:tblGrid>${gridColsXml}</a:tblGrid>${rowsXml}</a:tbl>`;
    return `<p:graphicFrame>${nvGraphicFramePr}${xfrmXml}<a:graphic><a:graphicData uri="${TABLE_URI}">${tblXml}</a:graphicData></a:graphic></p:graphicFrame>`;
  }
}
