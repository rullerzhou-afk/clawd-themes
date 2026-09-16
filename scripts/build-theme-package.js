#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const UINT32_MAX = 0xffffffff;
const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const UNPACKED_MAX_BYTES = 256 * 1024 * 1024;
const ENTRY_MAX_BYTES = 48 * 1024 * 1024;
const ENTRY_MAX_COUNT = 256;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00:00
const FILE_MODE = 0o100644;
const DIRECTORY_MODE = 0o040755;
const COPY_BUFFER_BYTES = 1024 * 1024;

function usage() {
  console.error("Usage: node scripts/build-theme-package.js --source <theme-dir> --manifest <manifest.json> --output <dir>");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--") || i + 1 >= argv.length) {
      throw new Error(`invalid argument ${JSON.stringify(key)}`);
    }
    args[key.slice(2)] = argv[++i];
  }
  if (!args.source || !args.manifest || !args.output) {
    usage();
    throw new Error("--source, --manifest, and --output are required");
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  return stat;
}

function validateManifest(manifest, manifestPath, sourceDir) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest must be an object");
  }
  if (manifest.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  if (!ID_PATTERN.test(manifest.id || "")) throw new Error("manifest id is invalid");
  if (!VERSION_PATTERN.test(manifest.version || "")) throw new Error("manifest version is invalid");
  if (!Number.isInteger(manifest.assetCount) || manifest.assetCount < 1) {
    throw new Error("manifest assetCount must be a positive integer");
  }
  if (path.basename(sourceDir) !== manifest.id) {
    throw new Error(`source directory name must be ${manifest.id}`);
  }
  const metadataDir = path.dirname(manifestPath);
  assertRegularFile(path.join(metadataDir, "LICENSE"), "theme LICENSE");
  assertRegularFile(path.join(metadataDir, "README.md"), "theme README");
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32Update(crc, buffer, length = buffer.length) {
  let value = crc >>> 0;
  for (let i = 0; i < length; i += 1) {
    value = CRC_TABLE[(value ^ buffer[i]) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function checksumFile(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let crc = 0xffffffff;
  let bytes = 0;
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      crc = crc32Update(crc, buffer, count);
      bytes += count;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { bytes, crc32: (crc ^ 0xffffffff) >>> 0 };
}

function collectAssets(assetsDir, archiveRoot) {
  const entries = [];
  let fileCount = 0;
  function walk(dirPath, relativeDir) {
    const names = fs.readdirSync(dirPath).sort();
    for (const name of names) {
      if (!name || name === "." || name === ".." || name.includes("\\") || name.includes("\0")) {
        throw new Error(`invalid asset name ${JSON.stringify(name)}`);
      }
      const absolutePath = path.join(dirPath, name);
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`symlink assets are not allowed: ${absolutePath}`);
      if (stat.isDirectory()) {
        entries.push({ archivePath: `${archiveRoot}/assets/${relativePath}/`, isDirectory: true });
        walk(absolutePath, relativePath);
      } else if (stat.isFile()) {
        if (stat.size > ENTRY_MAX_BYTES) {
          throw new Error(`asset exceeds ${ENTRY_MAX_BYTES} bytes: ${absolutePath}`);
        }
        entries.push({ archivePath: `${archiveRoot}/assets/${relativePath}`, sourcePath: absolutePath, isDirectory: false });
        fileCount += 1;
      } else {
        throw new Error(`special files are not allowed: ${absolutePath}`);
      }
    }
  }
  walk(assetsDir, "");
  return { entries, fileCount };
}

function buildEntries({ sourceDir, manifestPath, manifest }) {
  const metadataDir = path.dirname(manifestPath);
  const themeJsonPath = path.join(sourceDir, "theme.json");
  const assetsDir = path.join(sourceDir, "assets");
  assertRegularFile(themeJsonPath, "theme.json");
  const assetsStat = fs.lstatSync(assetsDir);
  if (!assetsStat.isDirectory() || assetsStat.isSymbolicLink()) {
    throw new Error(`assets must be a real directory: ${assetsDir}`);
  }
  const theme = readJson(themeJsonPath);
  if (theme.schemaVersion !== 1) throw new Error("theme.json schemaVersion must be 1");
  if (theme.version !== manifest.version) {
    throw new Error(`theme.json version ${theme.version} does not match manifest ${manifest.version}`);
  }
  if (theme.license !== "All Rights Reserved") {
    throw new Error("theme.json license must be All Rights Reserved");
  }

  const root = manifest.id;
  const collected = collectAssets(assetsDir, root);
  if (collected.fileCount !== manifest.assetCount) {
    throw new Error(`manifest declares ${manifest.assetCount} assets but source has ${collected.fileCount}`);
  }
  const entries = [
    { archivePath: `${root}/`, isDirectory: true },
    { archivePath: `${root}/LICENSE`, sourcePath: path.join(metadataDir, "LICENSE"), isDirectory: false },
    { archivePath: `${root}/README.md`, sourcePath: path.join(metadataDir, "README.md"), isDirectory: false },
    { archivePath: `${root}/assets/`, isDirectory: true },
    ...collected.entries,
    { archivePath: `${root}/theme.json`, sourcePath: themeJsonPath, isDirectory: false },
  ].sort((a, b) => (a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0));

  if (entries.length > ENTRY_MAX_COUNT) throw new Error(`archive would contain more than ${ENTRY_MAX_COUNT} entries`);
  const folded = new Set();
  let unpackedBytes = 0;
  for (const entry of entries) {
    const key = entry.archivePath.toLowerCase();
    if (folded.has(key)) throw new Error(`case-insensitive duplicate path: ${entry.archivePath}`);
    folded.add(key);
    if (entry.isDirectory) {
      entry.size = 0;
      entry.crc32 = 0;
      continue;
    }
    const stat = assertRegularFile(entry.sourcePath, entry.archivePath);
    if (stat.size > ENTRY_MAX_BYTES) throw new Error(`file exceeds per-entry limit: ${entry.archivePath}`);
    const checksum = checksumFile(entry.sourcePath);
    if (checksum.bytes !== stat.size) throw new Error(`file changed while checksumming: ${entry.sourcePath}`);
    entry.size = checksum.bytes;
    entry.crc32 = checksum.crc32;
    unpackedBytes += checksum.bytes;
  }
  if (unpackedBytes > UNPACKED_MAX_BYTES) {
    throw new Error(`unpacked bytes ${unpackedBytes} exceed ${UNPACKED_MAX_BYTES}`);
  }
  return { entries, unpackedBytes, assetCount: collected.fileCount };
}

function localHeader(entry) {
  const name = Buffer.from(entry.archivePath, "utf8");
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(ZIP_LOCAL_FILE, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc32 >>> 0, 14);
  header.writeUInt32LE(entry.size >>> 0, 18);
  header.writeUInt32LE(entry.size >>> 0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function centralHeader(entry) {
  const name = Buffer.from(entry.archivePath, "utf8");
  const header = Buffer.alloc(46 + name.length);
  const mode = entry.isDirectory ? DIRECTORY_MODE : FILE_MODE;
  const externalAttributes = (((mode & 0xffff) << 16) | (entry.isDirectory ? 0x10 : 0)) >>> 0;
  header.writeUInt32LE(ZIP_CENTRAL_FILE, 0);
  header.writeUInt16LE(ZIP_MADE_BY_UNIX, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc32 >>> 0, 16);
  header.writeUInt32LE(entry.size >>> 0, 20);
  header.writeUInt32LE(entry.size >>> 0, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(externalAttributes, 38);
  header.writeUInt32LE(entry.localOffset >>> 0, 42);
  name.copy(header, 46);
  return header;
}

function copyFileToFd(sourcePath, outputFd, expected) {
  const inputFd = fs.openSync(sourcePath, "r");
  const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
  let crc = 0xffffffff;
  let bytes = 0;
  try {
    for (;;) {
      const count = fs.readSync(inputFd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      fs.writeSync(outputFd, buffer, 0, count);
      crc = crc32Update(crc, buffer, count);
      bytes += count;
    }
  } finally {
    fs.closeSync(inputFd);
  }
  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  if (bytes !== expected.size || finalCrc !== expected.crc32) {
    throw new Error(`file changed while building: ${sourcePath}`);
  }
}

function writeArchive(entries, outputPath) {
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.rmSync(temporaryPath, { force: true });
  const fd = fs.openSync(temporaryPath, "wx", 0o600);
  let offset = 0;
  try {
    for (const entry of entries) {
      if (offset > UINT32_MAX) throw new Error("ZIP64 would be required");
      entry.localOffset = offset;
      const header = localHeader(entry);
      fs.writeSync(fd, header);
      offset += header.length;
      if (!entry.isDirectory) {
        copyFileToFd(entry.sourcePath, fd, entry);
        offset += entry.size;
      }
    }
    const centralOffset = offset;
    for (const entry of entries) {
      const header = centralHeader(entry);
      fs.writeSync(fd, header);
      offset += header.length;
    }
    const centralSize = offset - centralOffset;
    if (centralOffset > UINT32_MAX || centralSize > UINT32_MAX || entries.length > 0xffff) {
      throw new Error("ZIP64 would be required");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    fs.writeSync(fd, end);
  } catch (error) {
    try { fs.closeSync(fd); } catch {}
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  fs.chmodSync(temporaryPath, 0o644);
  fs.renameSync(temporaryPath, outputPath);
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const manifestPath = path.resolve(args.manifest);
  const outputDir = path.resolve(args.output);
  const manifest = readJson(manifestPath);
  validateManifest(manifest, manifestPath, sourceDir);
  const built = buildEntries({ sourceDir, manifestPath, manifest });
  fs.mkdirSync(outputDir, { recursive: true });
  const assetName = `${manifest.id}-${manifest.version}.clawd-theme.zip`;
  const outputPath = path.join(outputDir, assetName);
  fs.rmSync(outputPath, { force: true });
  writeArchive(built.entries, outputPath);
  const archiveBytes = fs.statSync(outputPath).size;
  if (archiveBytes > ARCHIVE_MAX_BYTES) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(`archive bytes ${archiveBytes} exceed ${ARCHIVE_MAX_BYTES}`);
  }
  const sha256 = sha256File(outputPath);
  const checksumPath = path.join(outputDir, `${manifest.id}-${manifest.version}.sha256`);
  fs.writeFileSync(checksumPath, `${sha256}  ${assetName}\n`, { mode: 0o644 });
  const metadataPath = path.join(outputDir, `${manifest.id}-${manifest.version}.metadata.json`);
  const metadata = {
    id: manifest.id,
    version: manifest.version,
    source: manifest.source,
    assetName,
    sha256,
    bytes: archiveBytes,
    unpackedBytes: built.unpackedBytes,
    entryCount: built.entries.length,
    assetCount: built.assetCount,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify(metadata, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`build-theme-package: ${error && error.message}`);
  process.exitCode = 1;
}

