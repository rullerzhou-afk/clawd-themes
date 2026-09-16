#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function readCatalogVersion(text, label) {
  let catalog;
  try { catalog = JSON.parse(text); } catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  if (!Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1) {
    throw new Error(`${label} catalogVersion must be a positive integer`);
  }
  return catalog.catalogVersion;
}

function main() {
  const baseSha = String(process.env.CATALOG_BASE_SHA || "").trim().toLowerCase();
  if (!SHA_PATTERN.test(baseSha)) throw new Error("CATALOG_BASE_SHA must be a 40-character lowercase commit SHA");
  if (/^0{40}$/.test(baseSha)) {
    console.log("catalog-version: initial push has no comparison base; skipped");
    return;
  }
  git(["cat-file", "-e", `${baseSha}^{commit}`]);
  let changed = true;
  try {
    git(["diff", "--quiet", baseSha, "HEAD", "--", "catalog-v1.json"], { stdio: "ignore" });
    changed = false;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (!changed) {
    console.log("catalog-version: catalog-v1.json unchanged");
    return;
  }
  const currentText = fs.readFileSync(path.resolve(__dirname, "..", "catalog-v1.json"), "utf8");
  const currentVersion = readCatalogVersion(currentText, "current catalog");
  let previousText;
  try {
    previousText = git(["show", `${baseSha}:catalog-v1.json`]);
  } catch (error) {
    const stderr = String(error.stderr || "");
    if (/does not exist|exists on disk, but not in/.test(stderr)) {
      console.log(`catalog-version: catalog introduced at version ${currentVersion}`);
      return;
    }
    throw error;
  }
  const previousVersion = readCatalogVersion(previousText, "base catalog");
  if (currentVersion <= previousVersion) {
    throw new Error(`catalog-v1.json changed but catalogVersion did not increase (${previousVersion} -> ${currentVersion})`);
  }
  console.log(`catalog-version: PASS ${previousVersion} -> ${currentVersion}`);
}

try {
  main();
} catch (error) {
  console.error(`check-catalog-version: ${error && error.message}`);
  process.exitCode = 1;
}
