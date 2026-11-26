// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { createHash } from "node:crypto";
import { parseFontSizeToHundredthsPt, pxToEmu } from "./units.mjs";
import { renderFillXml, renderLineXml } from "./tokens.mjs";
import { buildZipBuffer, escapeXmlAttr, escapeXmlText } from "./xml.mjs";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

const DEFAULT_SERIES_PALETTE = [
  "#0F3A7D",
  "#29BA74",
  "#7F1D1D",
  "#D97706",
  "#0284C7",
  "#6366F1",
  "#64748B",
];

function makeChartAnchorId(slideId, ooxmlId) {
  return `ch/${createHash("sha1").update(`${slideId}:${ooxmlId}`).digest("hex").slice(0, 8)}`;
}

function excelColName(col1Based) {
  let n = col1Based;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function renderChartTxPr({ typeface, fontSize = 12, bold = false, color = "#475569", rotationDeg }) {
  const sz = parseFontSizeToHundredthsPt(fontSize, 12);
  const bAttr = bold ? ' b="1"' : "";
  const fAttr = escapeXmlAttr(typeface);
  const bodyPrXml =
    typeof rotationDeg === "number" && rotationDeg !== 0
      ? `<a:bodyPr rot="${Math.round(rotationDeg * 60000)}" vert="horz"/>`
      : `<a:bodyPr/>`;
  return (
    `<c:txPr>` +
    bodyPrXml +
    `<a:lstStyle/>` +
    `<a:p><a:pPr>` +
    `<a:defRPr lang="zh-CN" altLang="en-US" sz="${sz}"${bAttr}>` +
    renderFillXml(color) +
    `<a:latin typeface="${fAttr}"/><a:ea typeface="${fAttr}"/><a:cs typeface="${fAttr}"/>` +
    `</a:defRPr>` +
    `</a:pPr><a:endParaRPr lang="zh-CN"/></a:p>` +
    `</c:txPr>`
  );
}

/**
 * Generates a genuine, self-contained OpenXML `.xlsx` workbook buffer (`ppt/embeddings/Microsoft_Excel_WorksheetN.xlsx`)
 * so charts are double-click editable in PowerPoint & WPS (武器 13).
 */
export function buildChartWorkbookBuffer(categories, seriesList) {
  const rowsXml = [];

  // Row 1: Header ("类别", Series1, Series2, ...)
  const headerCells = [
    `<c r="A1" t="inlineStr"><is><t>类别</t></is></c>`,
    ...seriesList.map((s, sIdx) => {
      const col = excelColName(sIdx + 2);
      return `<c r="${col}1" t="inlineStr"><is><t>${escapeXmlText(s.name || `系列${sIdx + 1}`)}</t></is></c>`;
    }),
  ];
  rowsXml.push(`<row r="1">${headerCells.join("")}</row>`);

  // Rows 2..N+1: Data
  categories.forEach((cat, rIdx) => {
    const rowNum = rIdx + 2;
    const cells = [`<c r="A${rowNum}" t="inlineStr"><is><t>${escapeXmlText(cat)}</t></is></c>`];
    seriesList.forEach((s, sIdx) => {
      const col = excelColName(sIdx + 2);
      const rawVal = s.values?.[rIdx];
      const numVal = typeof rawVal === "number" && Number.isFinite(rawVal) ? rawVal : 0;
      cells.push(`<c r="${col}${rowNum}"><v>${numVal}</v></c>`);
    });
    rowsXml.push(`<row r="${rowNum}">${cells.join("")}</row>`);
  });

  const lastCol = excelColName(Math.max(1, seriesList.length + 1));
  const lastRow = Math.max(1, categories.length + 1);

  const sheet1Xml =
    XML_HEADER +
    `<worksheet xmlns="${NS_X}">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    `</worksheet>`;

  const workbookXml =
    XML_HEADER +
    `<workbook xmlns="${NS_X}" xmlns:r="${NS_R}">` +
    `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const stylesXml =
    XML_HEADER +
    `<styleSheet xmlns="${NS_X}">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `</styleSheet>`;

  const wbRelsXml =
    XML_HEADER +
    `<Relationships xmlns="${NS_PR}">` +
    `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const rootRelsXml =
    XML_HEADER +
    `<Relationships xmlns="${NS_PR}">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypesXml =
    XML_HEADER +
    `<Types xmlns="${NS_CT}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: rootRelsXml },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: wbRelsXml },
    { name: "xl/styles.xml", data: stylesXml },
    { name: "xl/worksheets/sheet1.xml", data: sheet1Xml },
  ]);
}

const CHART_TYPE_ALIASES = Object.freeze({
  donut: "doughnut",
  hbar: "horizontalBar",
  "horizontal-bar": "horizontalBar",
});

export class ChartElement {
  constructor(slide, ooxmlId, chartType, config = {}) {
    const isObjArg = chartType && typeof chartType === "object";
    const cfg = isObjArg ? chartType : config || {};
    const rawType = isObjArg ? cfg.type || cfg.chartType || "bar" : chartType || cfg.type || "bar";
    const resolvedChartType = CHART_TYPE_ALIASES[rawType] || rawType;
    this.slide = slide;
    this.kind = "chart";
    this.ooxmlId = ooxmlId;
    this.id = makeChartAnchorId(slide.id, ooxmlId);
    this.chartType = resolvedChartType;
    this.name = cfg.name || `${this.chartType}-chart-${ooxmlId}`;

    this.position = {
      left: cfg.position?.left ?? cfg.left ?? 80,
      top: cfg.position?.top ?? cfg.top ?? 150,
      width: cfg.position?.width ?? cfg.width ?? 540,
      height: cfg.position?.height ?? cfg.height ?? 340,
    };

    this.title = cfg.title || "";
    this.titleTextStyle = cfg.titleTextStyle || { fontSize: 16, bold: true, color: "#0F172A" };
    this.categories = Array.isArray(cfg.categories) ? [...cfg.categories] : ["Q1", "Q2", "Q3", "Q4"];
    const rawSeries = Array.isArray(cfg.series) ? cfg.series : [];
    this._series = rawSeries.map((s, idx) => ({
      name: s.name || `系列 ${idx + 1}`,
      values: Array.isArray(s.values) ? [...s.values] : [],
      fill: s.fill || s.color || DEFAULT_SERIES_PALETTE[idx % DEFAULT_SERIES_PALETTE.length],
      pointFills: Array.isArray(s.pointFills) ? s.pointFills : null,
      lineWidth: s.lineWidth ?? 2.5,
    }));

    this.hasLegend = cfg.hasLegend !== undefined ? Boolean(cfg.hasLegend) : this._series.length > 1;
    this.legend = { position: "t", textStyle: { fontSize: 12, color: "#475569" }, ...(cfg.legend || {}) };
    this.dataLabels = {
      showValue: cfg.dataLabels?.showValue ?? true,
      showPercent: Boolean(cfg.dataLabels?.showPercent),
      position: cfg.dataLabels?.position,
      numberFormatCode: cfg.dataLabels?.numberFormatCode,
      textStyle: { fontSize: 11.5, bold: true, color: "#334155", ...(cfg.dataLabels?.textStyle || {}) },
    };
    this.barOptions = cfg.barOptions || {};
    this.lineOptions = cfg.lineOptions || {};
    this.pieOptions = cfg.pieOptions || {};
    this.doughnutOptions = cfg.doughnutOptions || { holeSize: 58 };
    this.xAxis = { textStyle: { fontSize: 12, color: "#475569" }, ...(cfg.xAxis || {}) };
    this.yAxis = {
      textStyle: { fontSize: 11.5, color: "#64748B" },
      majorGridlines: { style: "solid", fill: "#E2E8F0", width: 1 },
      ...(cfg.yAxis || {}),
    };
    this.chartFill = cfg.chartFill || "none";
    this.chartLine = cfg.chartLine || { style: "solid", fill: "none", width: 0 };
    this.plotAreaFill = cfg.plotAreaFill || "none";
    this.fontFamily = cfg.fontFamily || null;

    const self = this;
    this.series = {
      get items() {
        return self._series;
      },
      getItemAt(i) {
        return self._series[i];
      },
    };
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

  buildChartSpaceAndWorkbook(defaultFont = "Microsoft YaHei") {
    const typeface = this.fontFamily || defaultFont;
    const cats = this.categories;
    const nCats = cats.length;
    const lastRow = Math.max(2, nCats + 1);
    const catFormula = `Sheet1!$A$2:$A$${lastRow}`;
    const isPieLike = this.chartType === "pie" || this.chartType === "doughnut";
    const isLineLike = this.chartType === "line";
    const isAreaLike = this.chartType === "area";

    // Build `<c:ser>` list
    const serXmlList = this._series.map((s, sIdx) => {
      const col = excelColName(sIdx + 2);
      const nameFormula = `Sheet1!$${col}$1`;
      const valFormula = `Sheet1!$${col}$2:$${col}$${lastRow}`;

      const txXml =
        `<c:tx><c:strRef><c:f>${nameFormula}</c:f>` +
        `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeXmlText(s.name)}</c:v></c:pt></c:strCache>` +
        `</c:strRef></c:tx>`;

      let spPrXml = "";
      if (isLineLike) {
        spPrXml = `<c:spPr><a:noFill/>${renderLineXml({ style: "solid", fill: s.fill, width: s.lineWidth })}</c:spPr>`;
      } else if (isPieLike) {
        spPrXml = `<c:spPr>${renderFillXml(s.fill)}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>`;
      } else {
        spPrXml = `<c:spPr>${renderFillXml(s.fill)}<a:ln w="0"><a:noFill/></a:ln></c:spPr>`;
      }

      // Per-slice colors for pie/doughnut or custom `pointFills`
      let dPtXml = "";
      const sliceColors =
        s.pointFills || (isPieLike ? cats.map((_, i) => DEFAULT_SERIES_PALETTE[i % DEFAULT_SERIES_PALETTE.length]) : null);
      if (sliceColors) {
        dPtXml = sliceColors
          .slice(0, nCats)
          .map(
            (clr, ptIdx) =>
              `<c:dPt><c:idx val="${ptIdx}"/><c:bubble3D val="0"/><c:spPr>${renderFillXml(clr)}<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`
          )
          .join("");
      }

      let markerXml = "";
      if (isLineLike) {
        if (this.lineOptions.markers === false || s.markers === false) {
          markerXml = `<c:marker><c:symbol val="none"/></c:marker>`;
        } else {
          markerXml = `<c:marker><c:symbol val="circle"/><c:size val="${s.markerSize ?? 6}"/><c:spPr>${renderFillXml(s.fill)}<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>`;
        }
      }

      const invertXml = !isLineLike && !isAreaLike && !isPieLike ? `<c:invertIfNegative val="0"/>` : "";

      const catPts = cats
        .map((cVal, i) => `<c:pt idx="${i}"><c:v>${escapeXmlText(cVal)}</c:v></c:pt>`)
        .join("");
      const catXml =
        `<c:cat><c:strRef><c:f>${catFormula}</c:f>` +
        `<c:strCache><c:ptCount val="${nCats}"/>${catPts}</c:strCache></c:strRef></c:cat>`;

      const numFormatCode = this.yAxis?.numberFormatCode || this.dataLabels?.numberFormatCode || "General";
      const valPts = cats
        .map((_, i) => {
          const v = typeof s.values[i] === "number" && Number.isFinite(s.values[i]) ? s.values[i] : 0;
          return `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`;
        })
        .join("");
      const valXml =
        `<c:val><c:numRef><c:f>${valFormula}</c:f>` +
        `<c:numCache><c:formatCode>${escapeXmlText(numFormatCode)}</c:formatCode><c:ptCount val="${nCats}"/>${valPts}</c:numCache></c:numRef></c:val>`;

      const smoothXml = isLineLike ? `<c:smooth val="${this.lineOptions.smooth ? "1" : "0"}"/>` : "";

      return (
        `<c:ser>` +
        `<c:idx val="${sIdx}"/><c:order val="${sIdx}"/>` +
        txXml +
        spPrXml +
        markerXml +
        invertXml +
        dPtXml +
        catXml +
        valXml +
        smoothXml +
        `</c:ser>`
      );
    });

    // Strict ECMA-376 `<c:dLbls>` child sequence:
    // numFmt -> txPr -> dLblPos (omit on doughnut/area!) -> showLegendKey -> showVal -> showCatName -> showSerName -> showPercent -> showBubbleSize
    const dlNumFmt = this.dataLabels.numberFormatCode
      ? `<c:numFmt formatCode="${escapeXmlAttr(this.dataLabels.numberFormatCode)}" sourceLinked="0"/>`
      : "";
    const dlTxPr = renderChartTxPr({
      typeface,
      fontSize: this.dataLabels.textStyle?.fontSize ?? 11.5,
      bold: this.dataLabels.textStyle?.bold ?? true,
      color: this.dataLabels.textStyle?.color ?? "#334155",
    });

    let dlPosXml = "";
    if (this.chartType === "doughnut" || isAreaLike) {
      dlPosXml = "";
    } else if (isLineLike) {
      const lp = this.dataLabels.position || "t";
      dlPosXml = `<c:dLblPos val="${lp}"/>`;
    } else if (this.chartType === "pie") {
      dlPosXml = `<c:dLblPos val="${this.dataLabels.position || "bestFit"}"/>`;
    } else {
      const grouping = this.barOptions.grouping || "clustered";
      const defaultBarPos = grouping === "clustered" ? "outEnd" : "ctr";
      dlPosXml = `<c:dLblPos val="${this.dataLabels.position || defaultBarPos}"/>`;
    }

    const dLblsXml =
      `<c:dLbls>` +
      dlNumFmt +
      dlTxPr +
      dlPosXml +
      `<c:showLegendKey val="0"/>` +
      `<c:showVal val="${this.dataLabels.showValue ? "1" : "0"}"/>` +
      `<c:showCatName val="${isPieLike && this.dataLabels.showCategory ? "1" : "0"}"/>` +
      `<c:showSerName val="0"/>` +
      `<c:showPercent val="${this.dataLabels.showPercent ? "1" : "0"}"/>` +
      `<c:showBubbleSize val="0"/>` +
      `</c:dLbls>`;

    let plotTypeXml = "";
    if (this.chartType === "pie") {
      const angle = this.pieOptions.firstSliceAngle ?? 0;
      plotTypeXml =
        `<c:pieChart><c:varyColors val="1"/>${serXmlList.join("")}${dLblsXml}` +
        `<c:firstSliceAng val="${angle}"/></c:pieChart>`;
    } else if (this.chartType === "doughnut") {
      const angle = this.doughnutOptions.firstSliceAngle ?? 0;
      const hole = Math.max(10, Math.min(90, this.doughnutOptions.holeSize ?? 58));
      plotTypeXml =
        `<c:doughnutChart><c:varyColors val="1"/>${serXmlList.join("")}${dLblsXml}` +
        `<c:firstSliceAng val="${angle}"/><c:holeSize val="${hole}"/></c:doughnutChart>`;
    } else if (isLineLike) {
      const grouping = this.lineOptions.grouping || "standard";
      const showMarkerVal = this.lineOptions.markers === false ? "0" : "1";
      plotTypeXml =
        `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>` +
        `${serXmlList.join("")}${dLblsXml}<c:marker val="${showMarkerVal}"/><c:smooth val="${this.lineOptions.smooth ? "1" : "0"}"/>` +
        `<c:axId val="1001"/><c:axId val="1002"/></c:lineChart>`;
    } else if (isAreaLike) {
      plotTypeXml =
        `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
        `${serXmlList.join("")}${dLblsXml}` +
        `<c:axId val="1001"/><c:axId val="1002"/></c:areaChart>`;
    } else {
      // bar / column / horizontalBar
      const barDir =
        this.chartType === "horizontalBar" || this.barOptions.direction === "bar" ? "bar" : "col";
      const grouping = this.barOptions.grouping || "clustered";
      const gapWidth = this.barOptions.gapWidth ?? 110;
      const overlap =
        this.barOptions.overlap ?? (grouping === "stacked" || grouping === "percentStacked" ? 100 : -15);
      plotTypeXml =
        `<c:barChart>` +
        `<c:barDir val="${barDir}"/>` +
        `<c:grouping val="${grouping}"/>` +
        `<c:varyColors val="0"/>` +
        `${serXmlList.join("")}` +
        dLblsXml +
        `<c:gapWidth val="${gapWidth}"/>` +
        `<c:overlap val="${overlap}"/>` +
        `<c:axId val="1001"/><c:axId val="1002"/>` +
        `</c:barChart>`;
    }

    // Axes (omitted on pie / doughnut)
    let axesXml = "";
    if (!isPieLike) {
      const isHorizontalBar =
        this.chartType === "horizontalBar" || this.barOptions.direction === "bar";
      const catPos = isHorizontalBar ? "l" : "b";
      const valPos = isHorizontalBar ? "b" : "l";
      const reverseCat =
        this.xAxis.reverseOrder !== undefined ? Boolean(this.xAxis.reverseOrder) : isHorizontalBar;

      const catAxTxPr = renderChartTxPr({
        typeface,
        fontSize: this.xAxis.textStyle?.fontSize ?? 12,
        bold: Boolean(this.xAxis.textStyle?.bold),
        color: this.xAxis.textStyle?.color ?? "#475569",
        rotationDeg: this.xAxis.labelRotation,
      });
      const valAxTxPr = renderChartTxPr({
        typeface,
        fontSize: this.yAxis.textStyle?.fontSize ?? 11.5,
        bold: Boolean(this.yAxis.textStyle?.bold),
        color: this.yAxis.textStyle?.color ?? "#64748B",
      });

      const gridlineCfg = this.yAxis.hideAxis ? null : this.yAxis.majorGridlines;
      const majorGridXml =
        gridlineCfg && gridlineCfg !== "none" && gridlineCfg.fill !== "none"
          ? `<c:majorGridlines><c:spPr>${renderLineXml(gridlineCfg)}</c:spPr></c:majorGridlines>`
          : "";

      const valNumFmt = this.yAxis.numberFormatCode
        ? `<c:numFmt formatCode="${escapeXmlAttr(this.yAxis.numberFormatCode)}" sourceLinked="0"/>`
        : `<c:numFmt formatCode="General" sourceLinked="1"/>`;

      const valScalingBounds =
        (typeof this.yAxis.max === "number" ? `<c:max val="${this.yAxis.max}"/>` : "") +
        (typeof this.yAxis.min === "number" ? `<c:min val="${this.yAxis.min}"/>` : "");
      const majorUnitXml =
        typeof this.yAxis.majorUnit === "number"
          ? `<c:majorUnit val="${this.yAxis.majorUnit}"/>`
          : "";
      const catLineColor = this.xAxis.lineColor ?? "#CBD5E1";
      const catSpPrXml =
        catLineColor === "none"
          ? `<c:spPr><a:noFill/><a:ln w="0"><a:noFill/></a:ln></c:spPr>`
          : `<c:spPr>${renderLineXml({ style: "solid", fill: catLineColor, width: 1 })}</c:spPr>`;

      axesXml =
        `<c:catAx>` +
        `<c:axId val="1001"/>` +
        `<c:scaling><c:orientation val="${reverseCat ? "maxMin" : "minMax"}"/></c:scaling>` +
        `<c:delete val="${this.xAxis.hideAxis ? "1" : "0"}"/>` +
        `<c:axPos val="${catPos}"/>` +
        `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
        `<c:tickLblPos val="${this.xAxis.hideLabels ? "none" : "nextTo"}"/>` +
        catSpPrXml +
        catAxTxPr +
        `<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>` +
        `</c:catAx>` +
        `<c:valAx>` +
        `<c:axId val="1002"/>` +
        `<c:scaling><c:orientation val="minMax"/>${valScalingBounds}</c:scaling>` +
        `<c:delete val="${this.yAxis.hideAxis ? "1" : "0"}"/>` +
        `<c:axPos val="${valPos}"/>` +
        majorGridXml +
        valNumFmt +
        `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
        `<c:tickLblPos val="${this.yAxis.hideLabels || this.yAxis.hideAxis ? "none" : "nextTo"}"/>` +
        `<c:spPr><a:noFill/><a:ln w="0"><a:noFill/></a:ln></c:spPr>` +
        valAxTxPr +
        `<c:crossAx val="1001"/><c:crosses val="${reverseCat ? "max" : "autoZero"}"/><c:crossBetween val="between"/>` +
        majorUnitXml +
        `</c:valAx>`;
    }

    // Title (武器 14: explicit `<c:autoTitleDeleted val="1"/>` when absent, never leave "Chart Title"!)
    let titleXml = `<c:autoTitleDeleted val="1"/>`;
    if (typeof this.title === "string" && this.title.trim()) {
      const tSz = parseFontSizeToHundredthsPt(this.titleTextStyle.fontSize ?? 16, 16);
      const tBold = this.titleTextStyle.bold !== false ? ' b="1"' : "";
      const tFill = renderFillXml(this.titleTextStyle.color || "#0F172A");
      const fAttr = escapeXmlAttr(typeface);
      titleXml =
        `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>` +
        `<a:p><a:pPr><a:defRPr sz="${tSz}"${tBold}/></a:pPr>` +
        `<a:r><a:rPr lang="zh-CN" sz="${tSz}"${tBold}>${tFill}<a:latin typeface="${fAttr}"/><a:ea typeface="${fAttr}"/><a:cs typeface="${fAttr}"/></a:rPr>` +
        `<a:t>${escapeXmlText(this.title.trim())}</a:t></a:r></a:p>` +
        `</c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
    }

    // Legend
    let legendXml = "";
    if (this.hasLegend) {
      const legPos = this.legend.position || "t";
      const legTxPr = renderChartTxPr({
        typeface,
        fontSize: this.legend.textStyle?.fontSize ?? 12,
        bold: Boolean(this.legend.textStyle?.bold),
        color: this.legend.textStyle?.color ?? "#475569",
      });
      legendXml = `<c:legend><c:legendPos val="${legPos}"/><c:overlay val="0"/>${legTxPr}</c:legend>`;
    }

    const plotSpPr = `<c:spPr>${renderFillXml(this.plotAreaFill)}<a:ln w="0"><a:noFill/></a:ln></c:spPr>`;
    const chartFrameSpPr = `<c:spPr>${renderFillXml(this.chartFill)}${renderLineXml(this.chartLine)}</c:spPr>`;

    const chartXml =
      XML_HEADER +
      `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
      `<c:date1904 val="0"/>` +
      `<c:lang val="zh-CN"/>` +
      `<c:roundedCorners val="0"/>` +
      `<c:chart>` +
      titleXml +
      `<c:plotArea><c:layout/>${plotTypeXml}${axesXml}${plotSpPr}</c:plotArea>` +
      legendXml +
      `<c:plotVisOnly val="1"/>` +
      `<c:dispBlanksAs val="gap"/>` +
      `</c:chart>` +
      chartFrameSpPr +
      `<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData>` +
      `</c:chartSpace>`;

    const workbookBuf = buildChartWorkbookBuffer(cats, this._series);
    return { chartXml, workbookBuf };
  }

  toXml(ctx) {
    const defaultFont = this.slide.presentation.defaultFont;
    const { chartXml, workbookBuf } = this.buildChartSpaceAndWorkbook(defaultFont);
    const chartRelId = ctx.registerChart({ chartXml, workbookBuf });

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

    return (
      `<p:graphicFrame>` +
      nvGraphicFramePr +
      xfrmXml +
      `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${chartRelId}"/></a:graphicData></a:graphic>` +
      `</p:graphicFrame>`
    );
  }
}
