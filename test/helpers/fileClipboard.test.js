const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { writeFileDropList } = require("../../src/helpers/fileClipboard");

const isWindows = process.platform === "win32";

test("writeFileDropList rejects a relative path", { skip: !isWindows }, async () => {
  await assert.rejects(writeFileDropList("assets/test/beispiel.mp3"), /absolute file path/);
});

test("writeFileDropList rejects a missing file", { skip: !isWindows }, async () => {
  const missing = path.join(__dirname, "does-not-exist.mp3");
  await assert.rejects(writeFileDropList(missing), /File not found/);
});

test("writeFileDropList rejects outside Windows", { skip: isWindows }, async () => {
  await assert.rejects(writeFileDropList("/tmp/x.mp3"), /only supported on Windows/);
});
