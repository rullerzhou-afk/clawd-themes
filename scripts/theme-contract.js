"use strict";

const SOURCE_OWNER = "rullerzhou-afk";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^rullerzhou-afk\/[A-Za-z0-9_.-]{1,100}$/;
const AUTHOR_MAX_LENGTH = 160;

function validateRepository(repository) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)
    || repository !== repository.trim()
    || [".", ".."].includes(repository.split("/")[1])) {
    throw new Error(`source repository must belong to ${SOURCE_OWNER}`);
  }
}

function validateSourcePath(value, { allowRoot = false } = {}) {
  if (typeof value !== "string" || value.length > 1024
    || /[\\\u0000-\u001f\u007f]/.test(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error("source path must be a safe repository-relative path");
  }
  if (allowRoot && value === "") return;
  if (value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("source path must not contain empty or dot segments");
  }
}

function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("manifest source must be an object");
  }
  validateRepository(source.repository);
  if (typeof source.commit !== "string" || source.commit.length !== 40 || !COMMIT_PATTERN.test(source.commit)) {
    throw new Error("source commit must be a 40-character lowercase SHA");
  }
  // An empty path means the repository root; all other paths are canonical.
  validateSourcePath(source.path, { allowRoot: true });
}

function rawGithubUrl(repository, commit, relativePath) {
  validateSource({ repository, commit, path: relativePath });
  validateSourcePath(relativePath);
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const prefix = `/${repository}/${commit}/`;
  const url = new URL(`https://raw.githubusercontent.com${prefix}${encodedPath}`);
  if (url.pathname !== `${prefix}${encodedPath}` || url.search || url.hash) {
    throw new Error("source URL escaped its repository or pinned commit");
  }
  return url.toString();
}

function themeAttribution(theme) {
  const category = theme.category === undefined ? "official" : theme.category;
  if (category !== "official" && category !== "community") {
    throw new Error("theme category must be official or community");
  }
  const author = theme.author;
  if (author !== undefined && (typeof author !== "string" || !author
    || author !== author.trim() || author.length > AUTHOR_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(author))) {
    throw new Error(`theme author must be non-empty plain text of at most ${AUTHOR_MAX_LENGTH} characters`);
  }
  if (category === "community" && author === undefined) {
    throw new Error("community themes must name their author");
  }
  return { category, author: author === undefined ? null : author };
}

module.exports = { validateSource, validateSourcePath, rawGithubUrl, themeAttribution };
