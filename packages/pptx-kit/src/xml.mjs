// Copyright (c) 2026 渊眸策略 (Yuanmou Strategy). Licensed under the Apache License, Version 2.0 (SPDX-License-Identifier: Apache-2.0).

import { deflateRawSync, inflateRawSync } from "node:zlib";

export function sanitizeXmlString(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

export function escapeXmlText(value) {
  return sanitizeXmlString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttr(value) {
  return escapeXmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function attrs(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false) continue;
    parts.push(`${k}="${escapeXmlAttr(v === true ? "1" : v)}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

// --- Zero-dependency deterministic PKZIP engine (UTF-8 + Store/Deflate) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const STORE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2"]);

/**
 * Builds a compliant PKZIP (.pptx / .xlsx) buffer in memory.
 * @param {Array<{ name: string, data: string | Uint8Array | Buffer }>} entries
 * @returns {Buffer}
 */
export function buildZipBuffer(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  // Fixed DOS timestamp (2026-01-01 00:00:00) for deterministic SHA-256 builds
  const dosTime = 0x0000;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const cleanName = entry.name.replace(/^\/+/, "").replace(/\\/g, "/");
    const nameBuf = Buffer.from(cleanName, "utf8");
    const rawBuf =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : Buffer.isBuffer(entry.data)
          ? entry.data
          : Buffer.from(entry.data);

    const ext = cleanName.slice(cleanName.lastIndexOf(".")).toLowerCase();
    const shouldStore = rawBuf.length < 64 || STORE_EXTENSIONS.has(ext);
    const compressedBuf = shouldStore ? rawBuf : deflateRawSync(rawBuf, { level: 6 });
    const useDeflate = !shouldStore && compressedBuf.length < rawBuf.length;
    const payload = useDeflate ? compressedBuf : rawBuf;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(rawBuf);
    const flags = 0x0800; // Bit 11: UTF-8 filename

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

/**
 * Reads all entries from a PKZIP (.pptx) buffer into a Map<string, Buffer>.
 */
export function readZipBuffer(zipBuf) {
  const buf = Buffer.isBuffer(zipBuf) ? zipBuf : Buffer.from(zipBuf);
  let eocdPos = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error("Invalid ZIP/PPTX buffer: EOCD signature not found");

  const entryCount = buf.readUInt16LE(eocdPos + 10);
  const centralOffset = buf.readUInt32LE(eocdPos + 16);
  const files = new Map();

  let ptr = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("Corrupted central directory header in PPTX");
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);

    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    if (!name.endsWith("/")) {
      if (method === 0) {
        files.set(name, Buffer.from(compData));
      } else if (method === 8) {
        files.set(name, inflateRawSync(compData));
      } else {
        throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
      }
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
