#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const crypto = require("node:crypto");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_THEMES = 200;
const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const UNPACKED_MAX_BYTES = 256 * 1024 * 1024;
const ENTRY_MAX_BYTES = 48 * 1024 * 1024;
const ENTRY_MAX_COUNT = 256;
const COPY_BUFFER_BYTES = 1024 * 1024;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP_VERSION = 20;
const ZIP_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const FILE_MODE = 0o100644;
const DIRECTORY_MODE = 0o040755;
const DOWNLOAD_REDIRECTS = 5;
const REDIRECT_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

function usage() {
  console.error("Usage:");
  console.error("  node scripts/verify-theme-release.js --archive <zip> --manifest <manifest.json>");
  console.error("  node scripts/verify-theme-release.js --catalog <catalog-v1.json> [--download]");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--download") {
      args.download = true;
      continue;
    }
    if (!key.startsWith("--") || i + 1 >= argv.length) {
      throw new Error(`invalid argument ${JSON.stringify(key)}`);
    }
    args[key.slice(2)] = argv[++i];
  }
  if (!args.archive && !args.catalog) {
    usage();
    throw new Error("--archive or --catalog is required");
  }
  if (args.archive && !args.manifest) {
    usage();
    throw new Error("--manifest is required with --archive");
  }
  if (args.archive && args.catalog) throw new Error("choose --archive or --catalog, not both");
  return args;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath, maxBytes = Number.POSITIVE_INFINITY) {
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) throw new Error(`${filePath} exceeds ${maxBytes} bytes`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unsupported property ${key}`);
  }
}

function validateLocalizedText(value, label) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new Error(`${label} must be a non-empty localized text object`);
  }
  for (const [locale, text] of Object.entries(value)) {
    if (!locale || typeof text !== "string" || !text) throw new Error(`${label}.${locale} must be a non-empty string`);
  }
}

function expectedArchiveUrl(id, version) {
  return `https://github.com/rullerzhou-afk/clawd-themes/releases/download/${id}-v${version}/${id}-${version}.clawd-theme.zip`;
}

function parseHttpsUrl(raw, label) {
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} is not a URL`); }
  if (url.protocol !== "https:") throw new Error(`${label} must use https`);
  if (url.username || url.password || url.hash) throw new Error(`${label} must not contain credentials or a fragment`);
  if (url.port && url.port !== "443") throw new Error(`${label} must use the default HTTPS port`);
  return url;
}

function validateManifest(manifest, expectedId) {
  if (!isPlainObject(manifest)) throw new Error("manifest must be an object");
  if (manifest.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  if (!ID_PATTERN.test(manifest.id || "")) throw new Error("manifest id is invalid");
  if (expectedId && manifest.id !== expectedId) throw new Error(`manifest id ${manifest.id} does not match ${expectedId}`);
  if (!VERSION_PATTERN.test(manifest.version || "")) throw new Error("manifest version is invalid");
  if (!VERSION_PATTERN.test(manifest.minAppVersion || "")) throw new Error("manifest minAppVersion is invalid");
  if (!Number.isInteger(manifest.assetCount) || manifest.assetCount < 1) throw new Error("manifest assetCount is invalid");
  validateLocalizedText(manifest.name, "manifest.name");
  validateLocalizedText(manifest.description, "manifest.description");
  if (!isPlainObject(manifest.source)
    || manifest.source.repository !== "rullerzhou-afk/clawd-on-desk"
    || !COMMIT_PATTERN.test(manifest.source.commit || "")
    || manifest.source.path !== `themes/${manifest.id}`) {
    throw new Error("manifest source provenance is invalid");
  }
  if (!isPlainObject(manifest.license) || typeof manifest.license.spdx !== "string" || !manifest.license.spdx) {
    throw new Error("manifest license is invalid");
  }
  return manifest;
}

function validateCatalog(catalogPath) {
  const catalog = readJson(catalogPath, MAX_CATALOG_BYTES);
  if (!isPlainObject(catalog)) throw new Error("catalog must be an object");
  assertOnlyKeys(catalog, new Set(["schemaVersion", "catalogVersion", "themes"]), "catalog");
  if (catalog.schemaVersion !== 1) throw new Error("catalog schemaVersion must be 1");
  if (!Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) {
    throw new Error("catalogVersion must be a positive integer");
  }
  if (!Array.isArray(catalog.themes) || catalog.themes.length > MAX_THEMES) {
    throw new Error(`catalog themes must be an array with at most ${MAX_THEMES} entries`);
  }
  const seen = new Set();
  for (const entry of catalog.themes) {
    if (!isPlainObject(entry)) throw new Error("catalog theme entry must be an object");
    assertOnlyKeys(entry, new Set(["id", "version", "name", "description", "minAppVersion", "archive", "license"]), `theme ${entry.id}`);
    if (!ID_PATTERN.test(entry.id || "")) throw new Error(`invalid theme id ${entry.id}`);
    if (seen.has(entry.id)) throw new Error(`duplicate theme id ${entry.id}`);
    seen.add(entry.id);
    if (!VERSION_PATTERN.test(entry.version || "")) throw new Error(`invalid version for ${entry.id}`);
    if (!VERSION_PATTERN.test(entry.minAppVersion || "")) throw new Error(`invalid minAppVersion for ${entry.id}`);
    validateLocalizedText(entry.name, `${entry.id}.name`);
    validateLocalizedText(entry.description, `${entry.id}.description`);
    if (!isPlainObject(entry.archive)) throw new Error(`${entry.id}.archive must be an object`);
    assertOnlyKeys(entry.archive, new Set(["url", "bytes", "unpackedBytes", "sha256"]), `${entry.id}.archive`);
    const archiveUrl = parseHttpsUrl(entry.archive.url, `${entry.id}.archive.url`);
    if (archiveUrl.toString() !== expectedArchiveUrl(entry.id, entry.version)) {
      throw new Error(`${entry.id}.archive.url must pin the exact tag and asset name`);
    }
    if (!Number.isInteger(entry.archive.bytes) || entry.archive.bytes < 1 || entry.archive.bytes > ARCHIVE_MAX_BYTES) {
      throw new Error(`${entry.id}.archive.bytes is invalid`);
    }
    if (!Number.isInteger(entry.archive.unpackedBytes)
      || entry.archive.unpackedBytes < 1
      || entry.archive.unpackedBytes > UNPACKED_MAX_BYTES) {
      throw new Error(`${entry.id}.archive.unpackedBytes is invalid`);
    }
    if (!SHA256_PATTERN.test(entry.archive.sha256 || "")) throw new Error(`${entry.id}.archive.sha256 is invalid`);
    if (!isPlainObject(entry.license) || typeof entry.license.spdx !== "string" || !entry.license.spdx) {
      throw new Error(`${entry.id}.license is invalid`);
    }
    assertOnlyKeys(entry.license, new Set(["spdx", "noticeUrl"]), `${entry.id}.license`);
    const notice = parseHttpsUrl(entry.license.noticeUrl, `${entry.id}.license.noticeUrl`);
    const expectedNotice = new RegExp(`^/rullerzhou-afk/clawd-themes/blob/[0-9a-f]{40}/themes/${entry.id}/LICENSE$`);
    if (notice.hostname !== "github.com" || notice.search || !expectedNotice.test(notice.pathname)) {
      throw new Error(`${entry.id}.license.noticeUrl must pin an exact repository commit`);
    }
  }
  return catalog;
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32Update(crc, buffer, length = buffer.length) {
  let value = crc >>> 0;
  for (let i = 0; i < length; i += 1) value = CRC_TABLE[(value ^ buffer[i]) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function readExactly(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (count === 0) throw new Error("unexpected end of archive");
    offset += count;
  }
  return buffer;
}

function checksumRange(fd, position, length) {
  const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, Math.max(1, length)));
  let remaining = length;
  let offset = position;
  let crc = 0xffffffff;
  while (remaining > 0) {
    const wanted = Math.min(buffer.length, remaining);
    const count = fs.readSync(fd, buffer, 0, wanted, offset);
    if (count === 0) throw new Error("unexpected end of stored entry");
    crc = crc32Update(crc, buffer, count);
    remaining -= count;
    offset += count;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateArchivePath(name, id) {
  if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`unsafe archive path ${JSON.stringify(name)}`);
  }
  const isDirectory = name.endsWith("/");
  const parts = name.split("/");
  if (isDirectory) parts.pop();
  if (parts.length === 0 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe archive path ${JSON.stringify(name)}`);
  }
  if (parts[0] !== id) throw new Error(`archive entry is outside ${id}/: ${name}`);
  return { isDirectory, parts };
}

function findEndRecord(fd, fileSize) {
  const tailLength = Math.min(fileSize, 65557);
  const tailOffset = fileSize - tailLength;
  const tail = readExactly(fd, tailLength, tailOffset);
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) !== ZIP_END) continue;
    const commentLength = tail.readUInt16LE(index + 20);
    if (index + 22 + commentLength !== tail.length) continue;
    if (commentLength !== 0) throw new Error("archive comments are not allowed");
    const disk = tail.readUInt16LE(index + 4);
    const centralDisk = tail.readUInt16LE(index + 6);
    const diskEntries = tail.readUInt16LE(index + 8);
    const totalEntries = tail.readUInt16LE(index + 10);
    const centralSize = tail.readUInt32LE(index + 12);
    const centralOffset = tail.readUInt32LE(index + 16);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) throw new Error("multi-disk ZIP is not allowed");
    if (totalEntries === 0xffff || centralSize === ZIP64_SENTINEL || centralOffset === ZIP64_SENTINEL) {
      throw new Error("ZIP64 is not allowed");
    }
    if (centralOffset + centralSize !== tailOffset + index) throw new Error("central directory location is inconsistent");
    return { totalEntries, centralSize, centralOffset };
  }
  throw new Error("ZIP end record was not found");
}

function parseCentralDirectory(fd, end, id) {
  if (end.totalEntries > ENTRY_MAX_COUNT) throw new Error(`archive exceeds ${ENTRY_MAX_COUNT} entries`);
  const buffer = readExactly(fd, end.centralSize, end.centralOffset);
  const entries = [];
  const folded = new Set();
  let cursor = 0;
  let unpackedBytes = 0;
  for (let index = 0; index < end.totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE) {
      throw new Error("invalid central directory entry");
    }
    const madeBy = buffer.readUInt16LE(cursor + 4);
    const needed = buffer.readUInt16LE(cursor + 6);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const time = buffer.readUInt16LE(cursor + 12);
    const date = buffer.readUInt16LE(cursor + 14);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const internalAttributes = buffer.readUInt16LE(cursor + 36);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const endOffset = cursor + 46 + nameLength + extraLength + commentLength;
    if (endOffset > buffer.length) throw new Error("truncated central directory entry");
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (madeBy !== ZIP_MADE_BY_UNIX || needed !== ZIP_VERSION) throw new Error(`unexpected ZIP version for ${name}`);
    if (flags !== UTF8_FLAG || method !== 0) throw new Error(`entry must be unencrypted UTF-8 stored data: ${name}`);
    if (time !== DOS_TIME || date !== DOS_DATE) throw new Error(`entry timestamp is not deterministic: ${name}`);
    if (compressedSize !== uncompressedSize || compressedSize === ZIP64_SENTINEL) throw new Error(`entry size/method is invalid: ${name}`);
    if (extraLength !== 0 || commentLength !== 0 || diskStart !== 0 || internalAttributes !== 0) {
      throw new Error(`entry contains unsupported metadata: ${name}`);
    }
    const shape = validateArchivePath(name, id);
    const mode = (externalAttributes >>> 16) & 0xffff;
    const expectedMode = shape.isDirectory ? DIRECTORY_MODE : FILE_MODE;
    const expectedDosBits = shape.isDirectory ? 0x10 : 0;
    if (mode !== expectedMode || (externalAttributes & 0xffff) !== expectedDosBits) {
      throw new Error(`entry mode is invalid: ${name}`);
    }
    if (shape.isDirectory && (compressedSize !== 0 || crc32 !== 0)) throw new Error(`directory entry carries data: ${name}`);
    if (!shape.isDirectory && uncompressedSize > ENTRY_MAX_BYTES) throw new Error(`entry exceeds ${ENTRY_MAX_BYTES} bytes: ${name}`);
    const key = name.toLowerCase();
    if (folded.has(key)) throw new Error(`duplicate or case-colliding entry: ${name}`);
    folded.add(key);
    if (!shape.isDirectory) unpackedBytes += uncompressedSize;
    entries.push({
      name,
      isDirectory: shape.isDirectory,
      parts: shape.parts,
      crc32,
      size: uncompressedSize,
      localOffset,
      dataOffset: null,
    });
    cursor = endOffset;
  }
  if (cursor !== buffer.length) throw new Error("central directory has trailing data");
  if (unpackedBytes > UNPACKED_MAX_BYTES) throw new Error(`archive exceeds ${UNPACKED_MAX_BYTES} unpacked bytes`);
  const names = entries.map((entry) => entry.name);
  const sorted = [...names].sort();
  if (names.some((name, index) => name !== sorted[index])) throw new Error("archive entries are not sorted deterministically");
  return { entries, unpackedBytes };
}

function verifyLocalEntries(fd, entries, centralOffset) {
  let expectedOffset = 0;
  for (const entry of entries) {
    if (entry.localOffset !== expectedOffset) throw new Error(`entry layout is non-deterministic: ${entry.name}`);
    const header = readExactly(fd, 30, entry.localOffset);
    if (header.readUInt32LE(0) !== ZIP_LOCAL_FILE) throw new Error(`invalid local header: ${entry.name}`);
    const needed = header.readUInt16LE(4);
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const time = header.readUInt16LE(10);
    const date = header.readUInt16LE(12);
    const crc32 = header.readUInt32LE(14);
    const compressedSize = header.readUInt32LE(18);
    const uncompressedSize = header.readUInt32LE(22);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (needed !== ZIP_VERSION || flags !== UTF8_FLAG || method !== 0 || time !== DOS_TIME || date !== DOS_DATE) {
      throw new Error(`local header differs from deterministic contract: ${entry.name}`);
    }
    if (crc32 !== entry.crc32 || compressedSize !== entry.size || uncompressedSize !== entry.size || extraLength !== 0) {
      throw new Error(`local header disagrees with central directory: ${entry.name}`);
    }
    const name = readExactly(fd, nameLength, entry.localOffset + 30).toString("utf8");
    if (name !== entry.name) throw new Error(`local filename mismatch: ${entry.name}`);
    entry.dataOffset = entry.localOffset + 30 + nameLength;
    const dataEnd = entry.dataOffset + entry.size;
    if (dataEnd > centralOffset) throw new Error(`entry overlaps central directory: ${entry.name}`);
    const actualCrc = checksumRange(fd, entry.dataOffset, entry.size);
    if (actualCrc !== entry.crc32) throw new Error(`CRC mismatch: ${entry.name}`);
    expectedOffset = dataEnd;
  }
  if (expectedOffset !== centralOffset) throw new Error("local entry area has trailing or missing data");
}

function readStoredText(fd, entry, maxBytes) {
  if (!entry || entry.isDirectory) throw new Error("required text entry is missing");
  if (entry.size > maxBytes) throw new Error(`${entry.name} exceeds ${maxBytes} bytes`);
  return readExactly(fd, entry.size, entry.dataOffset).toString("utf8");
}

function collectThemeAssetReferences(value, out = new Set()) {
  if (typeof value === "string") {
    if (/\.(?:apng|png|gif|webp|svg|wav|mp3|ogg)$/i.test(value)) out.add(value.replaceAll("\\", "/"));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectThemeAssetReferences(item, out);
    return out;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectThemeAssetReferences(item, out);
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function verifyArchive(archivePath, manifest, expectedArchive = null, metadataDir = null) {
  validateManifest(manifest);
  const stat = fs.statSync(archivePath);
  if (!stat.isFile() || stat.size < 22 || stat.size > ARCHIVE_MAX_BYTES) throw new Error("archive file size is invalid");
  const actualSha256 = sha256File(archivePath);
  if (expectedArchive) {
    if (stat.size !== expectedArchive.bytes) throw new Error(`archive byte count mismatch: ${stat.size} != ${expectedArchive.bytes}`);
    if (actualSha256 !== expectedArchive.sha256) throw new Error(`archive SHA-256 mismatch: ${actualSha256}`);
  }
  const fd = fs.openSync(archivePath, "r");
  try {
    const end = findEndRecord(fd, stat.size);
    const parsed = parseCentralDirectory(fd, end, manifest.id);
    verifyLocalEntries(fd, parsed.entries, end.centralOffset);
    if (expectedArchive && parsed.unpackedBytes !== expectedArchive.unpackedBytes) {
      throw new Error(`unpacked byte count mismatch: ${parsed.unpackedBytes} != ${expectedArchive.unpackedBytes}`);
    }
    const byName = new Map(parsed.entries.map((entry) => [entry.name, entry]));
    const requiredNames = [
      `${manifest.id}/`,
      `${manifest.id}/LICENSE`,
      `${manifest.id}/README.md`,
      `${manifest.id}/assets/`,
      `${manifest.id}/theme.json`,
    ];
    for (const name of requiredNames) if (!byName.has(name)) throw new Error(`required archive entry is missing: ${name}`);
    for (const entry of parsed.entries) {
      const relative = entry.name.slice(manifest.id.length + 1);
      if (!relative) continue;
      const allowedRootFile = !entry.isDirectory && ["LICENSE", "README.md", "theme.json"].includes(relative);
      const allowedAsset = relative === "assets/" || relative.startsWith("assets/");
      if (!allowedRootFile && !allowedAsset) throw new Error(`unexpected archive entry: ${entry.name}`);
    }
    const themeText = readStoredText(fd, byName.get(`${manifest.id}/theme.json`), 1024 * 1024);
    const theme = JSON.parse(themeText);
    if (theme.schemaVersion !== 1 || theme.version !== manifest.version || theme.license !== "All Rights Reserved") {
      throw new Error("theme.json identity, version, or license is invalid");
    }
    const assetFiles = parsed.entries
      .filter((entry) => !entry.isDirectory && entry.name.startsWith(`${manifest.id}/assets/`))
      .map((entry) => entry.name.slice(`${manifest.id}/assets/`.length));
    if (assetFiles.length !== manifest.assetCount) {
      throw new Error(`archive contains ${assetFiles.length} assets, expected ${manifest.assetCount}`);
    }
    const assetSet = new Set(assetFiles);
    const referenced = collectThemeAssetReferences(theme);
    for (const name of referenced) if (!assetSet.has(name)) throw new Error(`theme.json references missing asset ${name}`);
    for (const name of assetFiles) if (!referenced.has(name)) throw new Error(`archive contains unreferenced asset ${name}`);
    if (metadataDir) {
      const packagedLicense = readStoredText(fd, byName.get(`${manifest.id}/LICENSE`), 256 * 1024);
      const packagedReadme = readStoredText(fd, byName.get(`${manifest.id}/README.md`), 256 * 1024);
      if (packagedLicense !== fs.readFileSync(path.join(metadataDir, "LICENSE"), "utf8")) throw new Error("packaged LICENSE differs from repository metadata");
      if (packagedReadme !== fs.readFileSync(path.join(metadataDir, "README.md"), "utf8")) throw new Error("packaged README differs from repository metadata");
    }
    return {
      id: manifest.id,
      version: manifest.version,
      bytes: stat.size,
      unpackedBytes: parsed.unpackedBytes,
      sha256: actualSha256,
      entryCount: parsed.entries.length,
      assetCount: assetFiles.length,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function validateRedirectUrl(rawUrl) {
  const url = parseHttpsUrl(rawUrl, "redirect URL");
  if (!REDIRECT_HOSTS.has(url.hostname)) throw new Error(`unsupported release redirect host ${url.hostname}`);
  return url;
}

function downloadArchive(urlString, outputPath, expectedBytes, redirectsRemaining = DOWNLOAD_REDIRECTS, initial = true) {
  const url = parseHttpsUrl(urlString, initial ? "archive URL" : "redirect URL");
  if (initial) {
    if (url.toString() !== urlString || url.hostname !== "github.com" || url.search) {
      return Promise.reject(new Error("initial archive URL is not the exact GitHub release URL"));
    }
  } else {
    validateRedirectUrl(url.toString());
  }
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "clawd-themes-release-verifier/1",
        "Accept": "application/octet-stream",
      },
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error(`release redirect ${status} has no Location`));
        if (redirectsRemaining <= 0) return reject(new Error("too many release redirects"));
        let next;
        try {
          next = new URL(location, url);
          validateRedirectUrl(next.toString());
        } catch (error) {
          return reject(error);
        }
        return resolve(downloadArchive(next.toString(), outputPath, expectedBytes, redirectsRemaining - 1, false));
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`release download returned HTTP ${status}`));
      }
      const contentLength = response.headers["content-length"];
      if (contentLength && Number(contentLength) !== expectedBytes) {
        response.resume();
        return reject(new Error(`release Content-Length ${contentLength} does not match ${expectedBytes}`));
      }
      const output = fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
      let bytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { request.destroy(); } catch {}
        try { response.destroy(); } catch {}
        try { output.destroy(); } catch {}
        try { fs.rmSync(outputPath, { force: true }); } catch {}
        reject(error);
      };
      response.on("error", fail);
      output.on("error", fail);
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > expectedBytes || bytes > ARCHIVE_MAX_BYTES) fail(new Error("release download exceeded declared byte count"));
      });
      output.on("finish", () => {
        if (settled) return;
        if (bytes !== expectedBytes) return fail(new Error(`release download received ${bytes} bytes, expected ${expectedBytes}`));
        settled = true;
        output.close((error) => error ? reject(error) : resolve({ bytes, finalUrl: url.toString() }));
      });
      response.pipe(output);
    });
    request.setTimeout(60000, () => request.destroy(new Error("release download stalled")));
    request.on("error", reject);
  });
}

function compareManifestToCatalog(manifest, entry) {
  if (manifest.version !== entry.version) throw new Error(`${entry.id} manifest version differs from catalog`);
  if (manifest.minAppVersion !== entry.minAppVersion) throw new Error(`${entry.id} minAppVersion differs from catalog`);
  if (JSON.stringify(manifest.name) !== JSON.stringify(entry.name)) throw new Error(`${entry.id} name differs from catalog`);
  if (JSON.stringify(manifest.description) !== JSON.stringify(entry.description)) throw new Error(`${entry.id} description differs from catalog`);
  if (manifest.license.spdx !== entry.license.spdx) throw new Error(`${entry.id} license differs from catalog`);
}

async function verifyCatalogMode(catalogPath, download) {
  const absoluteCatalog = path.resolve(catalogPath);
  const root = path.dirname(absoluteCatalog);
  const catalog = validateCatalog(absoluteCatalog);
  const results = [];
  for (const entry of catalog.themes) {
    const manifestPath = path.join(root, "themes", entry.id, "manifest.json");
    const manifest = validateManifest(readJson(manifestPath), entry.id);
    compareManifestToCatalog(manifest, entry);
    if (!download) {
      results.push({ id: entry.id, version: entry.version, status: "catalog-valid" });
      continue;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `clawd-theme-${entry.id}-`));
    const archivePath = path.join(tempDir, `${entry.id}-${entry.version}.clawd-theme.zip`);
    try {
      await downloadArchive(entry.archive.url, archivePath, entry.archive.bytes);
      results.push(verifyArchive(archivePath, manifest, entry.archive, path.dirname(manifestPath)));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
  return { schemaVersion: catalog.schemaVersion, catalogVersion: catalog.catalogVersion, themes: results };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.archive) {
    const manifestPath = path.resolve(args.manifest);
    const manifest = validateManifest(readJson(manifestPath));
    console.log(JSON.stringify(verifyArchive(path.resolve(args.archive), manifest, null, path.dirname(manifestPath)), null, 2));
    return;
  }
  console.log(JSON.stringify(await verifyCatalogMode(args.catalog, !!args.download), null, 2));
}

main().catch((error) => {
  console.error(`verify-theme-release: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

