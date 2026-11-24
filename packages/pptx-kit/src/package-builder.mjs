// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Non-commercial use only (PolyForm Noncommercial 1.0.0).

import { createHash } from "node:crypto";
import { pxToEmu } from "./units.mjs";
import { renderFillXml, resolveColorSpec } from "./tokens.mjs";
import { buildZipBuffer, escapeXmlAttr, escapeXmlText } from "./xml.mjs";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";

export const DEFAULT_THEME_PALETTE = Object.freeze({
  dk1: "0F172A",
  lt1: "FFFFFF",
  dk2: "1E293B",
  lt2: "F8FAFC",
  accent1: "0F3A7D", // 渊眸智库深海蓝
  accent2: "7F1D1D", // 渊眸勃艮第红棕
  accent3: "0284C7",
  accent4: "D97706",
  accent5: "059669",
  accent6: "4F46E5",
  hlink: "2563EB",
  folHlink: "7C3AED",
});

function toHex6(colorInput, fallback) {
  const spec = resolveColorSpec(colorInput, fallback);
  return spec && spec.kind === "srgb" ? spec.val : fallback;
}

function buildThemeXml(themePalette = {}, defaultFont = "Microsoft YaHei") {
  const p = {
    dk1: toHex6(themePalette.dk1, DEFAULT_THEME_PALETTE.dk1),
    lt1: toHex6(themePalette.lt1, DEFAULT_THEME_PALETTE.lt1),
    dk2: toHex6(themePalette.dk2, DEFAULT_THEME_PALETTE.dk2),
    lt2: toHex6(themePalette.lt2, DEFAULT_THEME_PALETTE.lt2),
    accent1: toHex6(themePalette.accent1, DEFAULT_THEME_PALETTE.accent1),
    accent2: toHex6(themePalette.accent2, DEFAULT_THEME_PALETTE.accent2),
    accent3: toHex6(themePalette.accent3, DEFAULT_THEME_PALETTE.accent3),
    accent4: toHex6(themePalette.accent4, DEFAULT_THEME_PALETTE.accent4),
    accent5: toHex6(themePalette.accent5, DEFAULT_THEME_PALETTE.accent5),
    accent6: toHex6(themePalette.accent6, DEFAULT_THEME_PALETTE.accent6),
    hlink: toHex6(themePalette.hlink, DEFAULT_THEME_PALETTE.hlink),
    folHlink: toHex6(themePalette.folHlink, DEFAULT_THEME_PALETTE.folHlink),
  };

  const fontAttr = escapeXmlAttr(defaultFont);

  return (
    XML_HEADER +
    `<a:theme xmlns:a="${NS_A}" name="Yuanmou Clean Theme">` +
    `<a:themeElements>` +
    `<a:clrScheme name="Yuanmou Colors">` +
    `<a:dk1><a:srgbClr val="${p.dk1}"/></a:dk1>` +
    `<a:lt1><a:srgbClr val="${p.lt1}"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="${p.dk2}"/></a:dk2>` +
    `<a:lt2><a:srgbClr val="${p.lt2}"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="${p.accent1}"/></a:accent1>` +
    `<a:accent2><a:srgbClr val="${p.accent2}"/></a:accent2>` +
    `<a:accent3><a:srgbClr val="${p.accent3}"/></a:accent3>` +
    `<a:accent4><a:srgbClr val="${p.accent4}"/></a:accent4>` +
    `<a:accent5><a:srgbClr val="${p.accent5}"/></a:accent5>` +
    `<a:accent6><a:srgbClr val="${p.accent6}"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="${p.hlink}"/></a:hlink>` +
    `<a:folHlink><a:srgbClr val="${p.folHlink}"/></a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="Yuanmou Typography">` +
    `<a:majorFont><a:latin typeface="${fontAttr}"/><a:ea typeface="${fontAttr}"/><a:cs typeface="${fontAttr}"/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${fontAttr}"/><a:ea typeface="${fontAttr}"/><a:cs typeface="${fontAttr}"/></a:minorFont>` +
    `</a:fontScheme>` +
    // Clean zero-dirty-shadow format scheme!
    `<a:fmtScheme name="Yuanmou Clean Format">` +
    `<a:fillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"><a:shade val="85000"/></a:schemeClr></a:solidFill>` +
    `</a:fillStyleLst>` +
    `<a:lnStyleLst>` +
    `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>` +
    `<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>` +
    `<a:ln w="28575" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>` +
    `</a:lnStyleLst>` +
    `<a:effectStyleLst>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `</a:effectStyleLst>` +
    `<a:bgFillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `</a:bgFillStyleLst>` +
    `</a:fmtScheme>` +
    `</a:themeElements>` +
    `<a:objectDefaults/>` +
    `<a:extraClrSchemeLst/>` +
    `</a:theme>`
  );
}

function buildRelsXml(rels) {
  const items = rels
    .map((r) => {
      const modeAttr = r.external ? ' TargetMode="External"' : "";
      return `<Relationship Id="${escapeXmlAttr(r.id)}" Type="${escapeXmlAttr(r.type)}" Target="${escapeXmlAttr(r.target)}"${modeAttr}/>`;
    })
    .join("");
  return XML_HEADER + `<Relationships xmlns="${NS_PR}">${items}</Relationships>`;
}

/**
 * Compiles a `Presentation` instance into a valid `.pptx` PKZIP Buffer.
 */
export function buildPptxBuffer(presentation) {
  const entries = [];
  const mediaBySha = new Map();
  const mediaFiles = [];
  const usedExtensions = new Map([
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
  ]);

  const registerGlobalMedia = ({ bytes, ext, contentType }) => {
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (mediaBySha.has(sha)) return mediaBySha.get(sha);
    const cleanExt = (ext || ".png").replace(/^\./, "").toLowerCase();
    const index = mediaFiles.length + 1;
    const filename = `image${index}.${cleanExt}`;
    const partPath = `ppt/media/${filename}`;
    const record = { filename, partPath, bytes, ext: cleanExt, contentType };
    mediaFiles.push(record);
    mediaBySha.set(sha, record);
    usedExtensions.set(cleanExt, contentType || "image/png");
    return record;
  };

  const slides = presentation.slides.items;
  const cx = pxToEmu(presentation.slideSize.width);
  const cy = pxToEmu(presentation.slideSize.height);
  const notesOverrides = [];
  const chartOverrides = [];
  let chartCounter = 0;

  // 1. Serialize each slide + its relationships (+ optional speaker notes)
  slides.forEach((slide, idx) => {
    const slideNum = idx + 1;
    const slideRels = [
      {
        id: "rId1",
        type: `${NS_R}/slideLayout`,
        target: "../slideLayouts/slideLayout1.xml",
      },
    ];
    let nextRelNum = 2;
    const slideMediaRelMap = new Map();

    const ctx = {
      registerMedia(mediaSpec) {
        const record = registerGlobalMedia(mediaSpec);
        if (slideMediaRelMap.has(record.filename)) {
          return slideMediaRelMap.get(record.filename);
        }
        const rId = `rId${nextRelNum++}`;
        slideMediaRelMap.set(record.filename, rId);
        slideRels.push({
          id: rId,
          type: `${NS_R}/image`,
          target: `../media/${record.filename}`,
        });
        return rId;
      },
      registerHyperlink(uri) {
        const rId = `rId${nextRelNum++}`;
        slideRels.push({
          id: rId,
          type: `${NS_R}/hyperlink`,
          target: String(uri),
          external: true,
        });
        return rId;
      },
      registerChart({ chartXml, workbookBuf }) {
        chartCounter += 1;
        const chartIdx = chartCounter;
        const chartFilename = `chart${chartIdx}.xml`;
        const wbFilename = `Microsoft_Excel_Worksheet${chartIdx}.xlsx`;

        entries.push({ name: `ppt/charts/${chartFilename}`, data: chartXml });
        entries.push({ name: `ppt/embeddings/${wbFilename}`, data: workbookBuf });
        entries.push({
          name: `ppt/charts/_rels/${chartFilename}.rels`,
          data: buildRelsXml([
            {
              id: "rId1",
              type: `${NS_R}/package`,
              target: `../embeddings/${wbFilename}`,
            },
          ]),
        });
        usedExtensions.set(
          "xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        chartOverrides.push(`/ppt/charts/${chartFilename}`);

        const rId = `rId${nextRelNum++}`;
        slideRels.push({
          id: rId,
          type: `${NS_R}/chart`,
          target: `../charts/${chartFilename}`,
        });
        return rId;
      },
    };

    const bgFill = slide.background?.fill;
    const bgXml =
      bgFill && bgFill !== "none"
        ? `<p:bg><p:bgPr>${renderFillXml(bgFill)}<a:effectLst/></p:bgPr></p:bg>`
        : "";

    const elementsXml = slide._elements.map((el) => el.toXml(ctx)).join("");

    const slideXml =
      XML_HEADER +
      `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
      `<p:cSld>${bgXml}` +
      `<p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
      elementsXml +
      `</p:spTree>` +
      `</p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
      `</p:sld>`;

    if (slide.notes.text.trim()) {
      const notesRelId = `rId${nextRelNum++}`;
      slideRels.push({
        id: notesRelId,
        type: `${NS_R}/notesSlide`,
        target: `../notesSlides/notesSlide${slideNum}.xml`,
      });
      notesOverrides.push(`/ppt/notesSlides/notesSlide${slideNum}.xml`);

      const notesXml =
        XML_HEADER +
        `<p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
        `<p:cSld><p:spTree>` +
        `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
        `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>${escapeXmlText(slide.notes.text)}</a:t></a:r></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld>` +
        `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
        `</p:notes>`;

      entries.push({ name: `ppt/notesSlides/notesSlide${slideNum}.xml`, data: notesXml });
      entries.push({
        name: `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`,
        data: buildRelsXml([
          { id: "rId1", type: `${NS_R}/slide`, target: `../slides/slide${slideNum}.xml` },
        ]),
      });
    }

    entries.push({ name: `ppt/slides/slide${slideNum}.xml`, data: slideXml });
    entries.push({ name: `ppt/slides/_rels/slide${slideNum}.xml.rels`, data: buildRelsXml(slideRels) });
  });

  // 2. Add deduplicated media binaries
  for (const m of mediaFiles) {
    entries.push({ name: m.partPath, data: m.bytes });
  }

  // 3. Slide Master & Blank Slide Layout
  const slideLayoutXml =
    XML_HEADER +
    `<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1">` +
    `<p:cSld name="Blank"><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sldLayout>`;

  const slideMasterXml =
    XML_HEADER +
    `<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>` +
    `</p:sldMaster>`;

  entries.push({ name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml });
  entries.push({
    name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    data: buildRelsXml([
      { id: "rId1", type: `${NS_R}/slideMaster`, target: "../slideMasters/slideMaster1.xml" },
    ]),
  });

  entries.push({ name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml });
  entries.push({
    name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    data: buildRelsXml([
      { id: "rId1", type: `${NS_R}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: `${NS_R}/theme`, target: "../theme/theme1.xml" },
    ]),
  });

  entries.push({
    name: "ppt/theme/theme1.xml",
    data: buildThemeXml(presentation.theme, presentation.defaultFont),
  });

  // 4. Presentation root & supporting XML parts
  const presRels = [
    { id: "rId1", type: `${NS_R}/slideMaster`, target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: `${NS_R}/theme`, target: "theme/theme1.xml" },
    { id: "rId3", type: `${NS_R}/presProps`, target: "presProps.xml" },
    { id: "rId4", type: `${NS_R}/viewProps`, target: "viewProps.xml" },
    { id: "rId5", type: `${NS_R}/tableStyles`, target: "tableStyles.xml" },
  ];

  const sldIdEntries = slides.map((_, i) => {
    const rId = `rId${6 + i}`;
    presRels.push({
      id: rId,
      type: `${NS_R}/slide`,
      target: `slides/slide${i + 1}.xml`,
    });
    return `<p:sldId id="${256 + i}" r:id="${rId}"/>`;
  });

  // Note exact ECMA-376 CT_Presentation child order:
  // sldMasterIdLst -> sldIdLst -> sldSz -> notesSz -> defaultTextStyle
  const presentationXml =
    XML_HEADER +
    `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    (sldIdEntries.length ? `<p:sldIdLst>${sldIdEntries.join("")}</p:sldIdLst>` : "") +
    `<p:sldSz cx="${cx}" cy="${cy}"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `<p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle>` +
    `</p:presentation>`;

  entries.push({ name: "ppt/presentation.xml", data: presentationXml });
  entries.push({ name: "ppt/_rels/presentation.xml.rels", data: buildRelsXml(presRels) });

  entries.push({
    name: "ppt/presProps.xml",
    data: XML_HEADER + `<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`,
  });
  entries.push({
    name: "ppt/viewProps.xml",
    data:
      XML_HEADER +
      `<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:cSldViewPr></p:slideViewPr></p:viewPr>`,
  });
  entries.push({
    name: "ppt/tableStyles.xml",
    data: XML_HEADER + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
  });

  // 5. docProps & root relationships & [Content_Types].xml
  const coreXml =
    XML_HEADER +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXmlText(presentation.title || "Yuanmou Presentation")}</dc:title>` +
    `<dc:creator>渊眸策略 (@yuanmou/pptx-kit)</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-24T00:00:00Z</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-24T00:00:00Z</dcterms:modified>` +
    `</cp:coreProperties>`;

  const appXml =
    XML_HEADER +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>@yuanmou/pptx-kit</Application>` +
    `<Slides>${slides.length}</Slides>` +
    `<Notes>${notesOverrides.length}</Notes>` +
    `</Properties>`;

  entries.push({ name: "docProps/core.xml", data: coreXml });
  entries.push({ name: "docProps/app.xml", data: appXml });

  entries.push({
    name: "_rels/.rels",
    data: buildRelsXml([
      { id: "rId1", type: `${NS_R}/officeDocument`, target: "ppt/presentation.xml" },
      {
        id: "rId2",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml",
      },
      {
        id: "rId3",
        type: `${NS_R}/extended-properties`,
        target: "docProps/app.xml",
      },
    ]),
  });

  const defaultTags = [...usedExtensions.entries()]
    .map(([ext, mime]) => `<Default Extension="${escapeXmlAttr(ext)}" ContentType="${escapeXmlAttr(mime)}"/>`)
    .join("");

  const overrideParts = [
    ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
    ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/ppt/presProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"],
    ["/ppt/viewProps.xml", "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"],
    ["/ppt/tableStyles.xml", "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ...slides.map((_, i) => [
      `/ppt/slides/slide${i + 1}.xml`,
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    ]),
    ...notesOverrides.map((p) => [
      p,
      "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    ]),
    ...chartOverrides.map((p) => [
      p,
      "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
    ]),
  ];

  const overrideTags = overrideParts
    .map(([part, mime]) => `<Override PartName="${escapeXmlAttr(part)}" ContentType="${escapeXmlAttr(mime)}"/>`)
    .join("");

  const contentTypesXml =
    XML_HEADER + `<Types xmlns="${NS_CT}">${defaultTags}${overrideTags}</Types>`;

  // Put [Content_Types].xml first in ZIP for fast streaming readers
  entries.unshift({ name: "[Content_Types].xml", data: contentTypesXml });

  return buildZipBuffer(entries);
}
