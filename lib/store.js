const { readFileSync, writeFileSync, renameSync, mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

/** Parsed JSON file, or `fallback` when it's missing or broken. */
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Write via a temp file, so a power cut mid-write can't leave a broken file. */
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data));
  renameSync(`${file}.tmp`, file);
}

module.exports = { readJson, writeJson };
