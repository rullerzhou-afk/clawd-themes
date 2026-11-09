"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { verifyArchive, verifySourceProvenance } = require("../scripts/verify-theme-release");
const ROOT = path.resolve(__dirname, "..");

function fixture(t, darkAssetsDir = "assets-dark") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-theme-dark-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceDir = path.join(dir, "source");
  const metadataDir = path.join(dir, "metadata");
  const manifest = {
    schemaVersion: 1, id: "dark-cat", version: "1.0.0", minAppVersion: "1.0.0",
    name: { en: "Dark cat" }, description: { en: "A test theme" }, assetCount: 2,
    source: { repository: "rullerzhou-afk/artist-theme", commit: "a".repeat(40), path: "themes/cat" },
    license: { spdx: "MIT", themeJson: "MIT", notice: { en: "Test fixture" } },
  };
  const theme = {
    schemaVersion: 1, version: "1.0.0", license: "MIT",
    states: { idle: "idle.svg", roam: "nested/walk.svg" },
  };
  if (darkAssetsDir !== null) theme.appearance = { dark: { assetsDir: darkAssetsDir } };
  const files = {
    "LICENSE": "Test fixture license\n",
    "README.md": "Test fixture credits\n",
    "theme.json": JSON.stringify(theme),
    "assets/idle.svg": "light idle",
    "assets/nested/walk.svg": "light walk",
  };
  if (darkAssetsDir !== null) {
    files[`${darkAssetsDir}/idle.svg`] = "dark idle";
    files[`${darkAssetsDir}/nested/walk.svg`] = "dark walk";
  }
  for (const [name, body] of Object.entries(files)) {
    const base = ["LICENSE", "README.md"].includes(name) ? metadataDir : sourceDir;
    fs.mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
    fs.writeFileSync(path.join(base, name), body);
  }
  const manifestPath = path.join(metadataDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { dir, sourceDir, metadataDir, manifestPath, manifest, theme, files };
}

function build(f) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(ROOT, "scripts/build-theme-package.js"),
    "--source", f.sourceDir, "--manifest", f.manifestPath, "--output", f.dir,
  ], { encoding: "utf8", stdio: "pipe" }));
}

function updateTheme(f) {
  f.files["theme.json"] = JSON.stringify(f.theme);
  fs.writeFileSync(path.join(f.sourceDir, "theme.json"), f.files["theme.json"]);
}

function crc32(body) {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Independent ZIP fixtures let verifier failures reach the contract under test
// even when the package builder would reject the same input first.
function archive(f, { omit = [], extraDirectories = [] } = {}) {
  const root = `${f.manifest.id}/`;
  const entries = new Map([[root, Buffer.alloc(0)]]);
  for (const [relative, text] of Object.entries(f.files)) {
    const name = `${root}${relative}`;
    entries.set(name, Buffer.from(text));
    for (let slash = name.indexOf("/"); slash !== -1; slash = name.indexOf("/", slash + 1)) {
      entries.set(name.slice(0, slash + 1), Buffer.alloc(0));
    }
  }
  for (const name of extraDirectories) entries.set(`${root}${name}`, Buffer.alloc(0));
  for (const name of omit) entries.delete(`${root}${name}`);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of [...entries.keys()].sort()) {
    const body = entries.get(name);
    const encoded = Buffer.from(name);
    const isDirectory = name.endsWith("/");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(encoded.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE((((isDirectory ? 0o040755 : 0o100644) << 16) | (isDirectory ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, encoded, body);
    centrals.push(central, encoded);
    offset += local.length + encoded.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  const filename = path.join(f.dir, "fixture.zip");
  fs.writeFileSync(filename, Buffer.concat([...locals, central, end]));
  return filename;
}

function verifiedEntries(f) {
  let entries;
  verifyArchive(archive(f), f.manifest, null, f.metadataDir, {
    onEntries: (value) => { entries = value; },
  });
  return entries;
}

for (const assetsDir of ["assets-dark", "Night_2", "x", "d".repeat(64)]) {
  test(`dark assets directory ${assetsDir}: builds and verifies mirrored nested files`, (t) => {
    const f = fixture(t, assetsDir);
    const built = build(f);
    let entries;
    const verified = verifyArchive(path.join(f.dir, built.assetName), f.manifest, built, f.metadataDir, {
      onEntries: (value, theme) => { entries = value; assert.deepEqual(theme, f.theme); },
    });
    assert.equal(built.assetCount, 2);
    assert.equal(verified.assetCount, 2);
    assert.equal(verified.entryCount, 12);
    assert.ok(entries.some((entry) => entry.name === `${f.manifest.id}/${assetsDir}/` && entry.isDirectory));
    for (const name of ["idle.svg", "nested/walk.svg"]) {
      const entry = entries.find((item) => item.name === `${f.manifest.id}/${assetsDir}/${name}`);
      assert.equal(entry.sha256, crypto.createHash("sha256").update(f.files[`${assetsDir}/${name}`]).digest("hex"));
    }
  });
}

for (const [label, change, error] of [
  ["missing file", (f) => fs.rmSync(path.join(f.sourceDir, "assets-dark/nested/walk.svg")), /assets-dark.*missing.*nested\/walk\.svg/],
  ["extra file", (f) => fs.writeFileSync(path.join(f.sourceDir, "assets-dark/extra.svg"), "extra"), /assets-dark.*extra.*extra\.svg/],
  ["missing directory", (f) => fs.rmSync(path.join(f.sourceDir, "assets-dark"), { recursive: true }), /assets-dark/],
  ["symlink directory", (f) => {
    fs.rmSync(path.join(f.sourceDir, "assets-dark"), { recursive: true });
    fs.symlinkSync("assets", path.join(f.sourceDir, "assets-dark"));
  }, /assets-dark.*real directory/],
  ["nested symlink", (f) => {
    fs.rmSync(path.join(f.sourceDir, "assets-dark/nested/walk.svg"));
    fs.symlinkSync("../../assets/nested/walk.svg", path.join(f.sourceDir, "assets-dark/nested/walk.svg"));
  }, /symlink assets are not allowed/],
]) {
  test(`dark assets directory build rejects ${label}`, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => build(f), error);
  });
}

for (const assetsDir of ["../x", "Assets", "assets", "ASSETS", "", "_dark", "dark/path", "dark\\path", "dark\n", "d".repeat(65), null, 42]) {
  test(`dark assets directory name ${JSON.stringify(assetsDir)} is rejected by build and archive verification`, (t) => {
    const f = fixture(t, null);
    f.theme.appearance = { dark: { assetsDir } };
    updateTheme(f);
    assert.throws(() => build(f), /appearance\.dark\.assetsDir/);
    assert.throws(() => verifyArchive(archive(f), f.manifest), /appearance\.dark\.assetsDir/);
  });
}

test("dark assets archive rejects undeclared extra directories and files", (t) => {
  const f = fixture(t, null);
  assert.throws(() => verifyArchive(archive(f, { extraDirectories: ["assets-dark/"] }), f.manifest), /unexpected archive entry: dark-cat\/assets-dark\//);
  f.files["assets-dark/idle.svg"] = "undeclared dark idle";
  assert.throws(() => verifyArchive(archive(f), f.manifest), /unexpected archive entry: dark-cat\/assets-dark\//);
});

test("dark assets archive still rejects directories outside the declared pair", (t) => {
  const f = fixture(t);
  assert.throws(() => verifyArchive(archive(f, { extraDirectories: ["other/"] }), f.manifest), /unexpected archive entry: dark-cat\/other\//);
});

test("dark assets archive requires the declared directory entry", (t) => {
  const f = fixture(t);
  assert.throws(() => verifyArchive(archive(f, { omit: ["assets-dark/"] }), f.manifest), /required archive entry is missing: dark-cat\/assets-dark\//);
});

for (const [label, change, error] of [
  ["missing file", (f) => { delete f.files["assets-dark/nested/walk.svg"]; }, /assets-dark.*missing.*nested\/walk\.svg/],
  ["extra file", (f) => { f.files["assets-dark/extra.svg"] = "extra"; }, /assets-dark.*extra.*extra\.svg/],
  ["different relative path at equal count", (f) => {
    delete f.files["assets-dark/nested/walk.svg"];
    f.files["assets-dark/walk.svg"] = "wrong path";
  }, /assets-dark.*missing.*nested\/walk\.svg/],
]) {
  test(`dark assets archive rejects ${label}`, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => verifyArchive(archive(f), f.manifest), error);
  });
}

test("dark assets mirror does not relax light asset reference coverage", (t) => {
  const f = fixture(t);
  f.theme.states.roam = "missing.svg";
  updateTheme(f);
  assert.throws(() => verifyArchive(archive(f), f.manifest), /references missing asset missing\.svg/);
  delete f.theme.states.roam;
  updateTheme(f);
  assert.throws(() => verifyArchive(archive(f), f.manifest), /unreferenced asset nested\/walk\.svg/);
});

test("dark assets provenance requests both mirrors at the pinned root and nested source paths", async (t) => {
  for (const assetsDir of ["assets-dark", "Night_2"]) {
    const f = fixture(t, assetsDir);
    const entries = verifiedEntries(f);
    for (const sourcePath of ["", "themes/cat"]) {
      f.manifest.source.path = sourcePath;
      const requested = [];
      const result = await verifySourceProvenance(f.manifest, entries, f.theme, async (url, options) => {
        const prefix = `https://raw.githubusercontent.com/${f.manifest.source.repository}/${f.manifest.source.commit}/${sourcePath ? `${sourcePath}/` : ""}`;
        assert.ok(url.startsWith(prefix));
        const relative = url.slice(prefix.length);
        requested.push(relative);
        assert.equal(options.expectedBytes, Buffer.byteLength(f.files[relative]));
        return { sha256: crypto.createHash("sha256").update(f.files[relative]).digest("hex") };
      });
      assert.equal(result.fileCount, f.manifest.assetCount * 2 + 1);
      assert.deepEqual(requested.sort(), Object.keys(f.files).filter((name) => !["LICENSE", "README.md"].includes(name)).sort());
    }
  }
});

test("dark assets provenance rejects a mismatched dark file SHA-256", async (t) => {
  const f = fixture(t);
  const entries = verifiedEntries(f);
  await assert.rejects(verifySourceProvenance(f.manifest, entries, f.theme, async (url) => {
    const entry = entries.find((item) => url.endsWith(`/${item.name.slice(f.manifest.id.length + 1)}`));
    return { sha256: url.endsWith("/assets-dark/nested/walk.svg") ? "0".repeat(64) : entry.sha256 };
  }), /differs from source commit: themes\/cat\/assets-dark\/nested\/walk\.svg/);
});

test("dark assets provenance checks the mirrored file count before fetching", async (t) => {
  const f = fixture(t);
  const entries = verifiedEntries(f).filter((entry) => entry.name !== "dark-cat/assets-dark/idle.svg");
  await assert.rejects(verifySourceProvenance(f.manifest, entries, f.theme, async () => {
    assert.fail("invalid entry count must fail before fetching");
  }), /source provenance expected 5 files, got 4/);
});

test("dark assets provenance rejects a third directory outside the theme declaration", async (t) => {
  const f = fixture(t);
  const entries = verifiedEntries(f);
  const extraFiles = entries
    .filter((entry) => !entry.isDirectory && entry.name.startsWith("dark-cat/assets/"))
    .map((entry) => ({ ...entry, name: entry.name.replace("dark-cat/assets/", "dark-cat/other/") }));
  entries.push({ name: "dark-cat/other/", isDirectory: true, size: 0 }, ...extraFiles);
  let requests = 0;
  await assert.rejects(verifySourceProvenance(f.manifest, entries, f.theme, async (url) => {
    requests += 1;
    const entry = entries.find((item) => url.endsWith(`/${item.name.slice(f.manifest.id.length + 1)}`));
    return { sha256: entry.sha256 };
  }), /unexpected source provenance entry: dark-cat\/other\//);
  assert.equal(requests, 0);
});
