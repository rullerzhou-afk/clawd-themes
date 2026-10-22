"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { validateSource, rawGithubUrl, themeAttribution } = require("../scripts/theme-contract");
const { validateCatalog, validateManifest, compareManifestToCatalog, verifyArchive, verifySourceProvenance } = require("../scripts/verify-theme-release");
const ROOT = path.resolve(__dirname, "..");
const SHA = "a".repeat(40);

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-theme-contract-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function source(overrides = {}) {
  return { repository: "rullerzhou-afk/artist-theme", commit: SHA, path: "", ...overrides };
}

function manifest() {
  return {
    schemaVersion: 1, id: "community-cat", version: "1.0.0", minAppVersion: "1.0.0",
    category: "community", author: "Artist / 画师", name: { en: "Community cat" },
    description: { en: "A test theme" }, assetCount: 1, source: source(),
    license: { spdx: "MIT", themeJson: "MIT", notice: { en: "Test fixture" } },
  };
}

test("source URLs retain account and exact commit for root and nested themes", () => {
  for (const relative of ["theme.json", "a theme/素材/idle.svg", "assets/%2e%2e.svg"]) {
    const url = new URL(rawGithubUrl(source().repository, SHA, relative));
    assert.equal(url.origin, "https://raw.githubusercontent.com");
    assert.equal(url.pathname, `/rullerzhou-afk/artist-theme/${SHA}/${relative.split("/").map(encodeURIComponent).join("/")}`);
  }
  for (const themePath of ["", "themes/cat", "my theme/猫"]) {
    assert.doesNotThrow(() => validateSource(source({ path: themePath })));
  }
});

test("rejects non-maintainer sources, floating refs, and paths that could escape a pinned commit", () => {
  for (const repository of ["artist/theme", "rullerzhou-afk/theme\n", "rullerzhou-afk.evil/theme", "rullerzhou-afk/../evil", "rullerzhou-afk/..", "https://github.com/rullerzhou-afk/theme"]) {
    assert.throws(() => validateSource(source({ repository })));
  }
  for (const commit of ["main", "a".repeat(39), "A".repeat(40), `${SHA}/..`, `${SHA}\n`]) {
    assert.throws(() => validateSource(source({ commit })));
  }
  for (const themePath of ["../main", "../../../other/repo/main", "/root", "a//b", "a/./b", "a/../b", "a/", "a\\b", "C:/themes", "a\nb", null]) {
    assert.throws(() => validateSource(source({ path: themePath })));
    assert.throws(() => rawGithubUrl(source().repository, SHA, themePath));
  }
  assert.throws(() => rawGithubUrl(source().repository, SHA, ""));
});

test("legacy themes default to official; community credit is mandatory plain text", () => {
  assert.deepEqual(themeAttribution({}), { category: "official", author: null });
  assert.equal(themeAttribution(manifest()).author, "Artist / 画师");
  for (const fields of [{ category: "other" }, { category: null }, { category: "community" }, { author: "" }, { author: " Artist " }, { author: "a\nb" }, { author: "a".repeat(161) }, { author: null }]) {
    assert.throws(() => themeAttribution(fields));
  }
});

test("published schema and semantic validator accept community credit without a showcase", (t) => {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, "schemas"));
  fs.copyFileSync(path.join(ROOT, "schemas/catalog-v1.schema.json"), path.join(dir, "schemas/catalog-v1.schema.json"));
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog-v1.json")));
  doc.themes = [{ ...doc.themes[0], category: "community", author: "Artist" }];
  delete doc.themes[0].showcase;
  const filename = path.join(dir, "catalog-v1.json");
  const check = (entry) => {
    fs.writeFileSync(filename, JSON.stringify({ ...doc, themes: [entry] }));
    return validateCatalog(filename);
  };
  const good = doc.themes[0];
  assert.equal(check(good).themes[0].category, "community");
  for (const change of [{ author: undefined }, { author: " " }, { author: "x".repeat(161) }, { category: "unknown" }, { showcase: null }, { showcase: { url: "https://artist.example/theme" } }, { archive: { ...good.archive, url: good.archive.url.replace("rullerzhou-afk", "artist") } }]) {
    assert.throws(() => check({ ...good, ...change }));
  }
  const legacy = { ...good };
  delete legacy.category;
  delete legacy.author;
  assert.doesNotThrow(() => check(legacy));
});

test("manifest and catalog cannot disagree on author or community category", () => {
  const m = manifest();
  assert.doesNotThrow(() => validateManifest(m));
  assert.doesNotThrow(() => compareManifestToCatalog(m, m));
  for (const change of [{ category: "official" }, { author: "Someone else" }, { author: undefined }]) {
    assert.throws(() => compareManifestToCatalog(m, { ...m, ...change }));
  }
});

test("builds a theme from an arbitrary checkout folder and verifies every pinned source file", async (t) => {
  const dir = temporary(t);
  const sourceDir = path.join(dir, "checkout-name-differs-from-theme-id");
  const metadataDir = path.join(dir, "metadata");
  const outputDir = path.join(dir, "output");
  fs.mkdirSync(path.join(sourceDir, "assets"), { recursive: true });
  fs.mkdirSync(metadataDir);
  const files = {
    "theme.json": JSON.stringify({ schemaVersion: 1, version: "1.0.0", license: "MIT", states: { idle: "idle.svg" } }),
    "assets/idle.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(sourceDir, name), body);
  fs.writeFileSync(path.join(metadataDir, "LICENSE"), "Test fixture license\n");
  fs.writeFileSync(path.join(metadataDir, "README.md"), "Test fixture credits\n");
  const m = manifest();
  const manifestPath = path.join(metadataDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(m));
  const built = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, "scripts/build-theme-package.js"), "--source", sourceDir, "--manifest", manifestPath, "--output", outputDir], { encoding: "utf8" }));
  let entries;
  verifyArchive(path.join(outputDir, built.assetName), m, built, metadataDir, { onEntries: (value) => { entries = value; } });
  for (const prefix of ["", "themes/cat"]) {
    m.source.path = prefix;
    const requested = [];
    await verifySourceProvenance(m, entries, async (url, options) => {
      const base = `https://raw.githubusercontent.com/${m.source.repository}/${SHA}/${prefix ? `${prefix}/` : ""}`;
      assert.ok(url.startsWith(base));
      const file = url.slice(base.length);
      requested.push(file);
      assert.equal(options.expectedBytes, Buffer.byteLength(files[file]));
      return { sha256: crypto.createHash("sha256").update(files[file]).digest("hex") };
    });
    assert.deepEqual(requested.sort(), Object.keys(files).sort());
  }
  await assert.rejects(verifySourceProvenance(m, entries, async () => ({ sha256: "0".repeat(64) })), /differs from source commit/);
  m.source.path = "../main";
  fs.writeFileSync(manifestPath, JSON.stringify(m));
  assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, "scripts/build-theme-package.js"), "--source", sourceDir, "--manifest", manifestPath, "--output", outputDir], { stdio: "pipe" }));
});
