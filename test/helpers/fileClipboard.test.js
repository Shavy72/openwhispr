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

test("writeFileDropList puts the file on the clipboard (umlaut path)", { skip: !isWindows }, async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-"));
  try {
    const folder = path.join(dir, "Büro test");
    fs.mkdirSync(folder);
    const target = path.join(folder, "beispiel.mp3");
    fs.copyFileSync(path.join(__dirname, "../../assets/test/beispiel.mp3"), target);
    await writeFileDropList(target);
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList).FullName",
      ],
      { encoding: "utf8" }
    );
    assert.deepEqual(
      out.split(/\r?\n/).filter(Boolean),
      [target]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
