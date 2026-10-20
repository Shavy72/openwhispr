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

test(
  "writeFileDropList puts the file on the clipboard (umlaut path)",
  { skip: !isWindows },
  async () => {
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
      assert.deepEqual(out.split(/\r?\n/).filter(Boolean), [target]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

const {
  macPasteboardArgs,
  MAC_PASTEBOARD_SCRIPT,
  writeFilePasteboard,
} = require("../../src/helpers/fileClipboard");
const isMac = process.platform === "darwin";

test("macPasteboardArgs passes the path unchanged as its own argv entry", () => {
  const tricky = [
    "/Users/me/Büro test/beispiel.mp3",
    '/tmp/sag "hallo".mp3',
    "/tmp/it's $HOME `x`.mp3",
  ];
  for (const p of tricky) {
    const args = macPasteboardArgs(p);
    assert.deepEqual(args, ["-l", "JavaScript", "-e", MAC_PASTEBOARD_SCRIPT, p]);
    assert.equal(args[3].includes(p), false);
  }
  assert.match(MAC_PASTEBOARD_SCRIPT, /fileURLWithPath\(argv\[0\]\)/);
  assert.match(MAC_PASTEBOARD_SCRIPT, /"public\.file-url"/);
});

test("writeFilePasteboard rejects outside macOS", { skip: isMac }, async () => {
  await assert.rejects(writeFilePasteboard("/tmp/x.mp3"), /only supported on macOS/);
});

test("writeFilePasteboard rejects a missing file", { skip: !isMac }, async () => {
  await assert.rejects(writeFilePasteboard(path.join(__dirname, "nope.mp3")), /File not found/);
});

test(
  "writeFilePasteboard puts the file URL on the pasteboard (tricky path)",
  { skip: !isMac },
  async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const { execFileSync } = require("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-"));
    try {
      const folder = path.join(dir, 'Büro "test" $x');
      fs.mkdirSync(folder);
      const target = path.join(folder, "beispiel.mp3");
      fs.copyFileSync(path.join(__dirname, "../../assets/test/beispiel.mp3"), target);
      await writeFilePasteboard(target);
      // AppleScript read-back: "clipboard info" lists the formats, «class furl» is
      // the file URL type Finder's Copy produces.
      const info = execFileSync("osascript", ["-e", "clipboard info"], { encoding: "utf8" });
      const pasted = execFileSync(
        "osascript",
        ["-e", "POSIX path of (the clipboard as «class furl»)"],
        { encoding: "utf8" }
      ).trim();
      console.log("pasteboard:", info.trim(), "|", pasted);
      assert.match(info, /furl/);
      // File URLs come back in NFD (decomposed ü); compare canonical forms.
      assert.equal(
        fs.realpathSync(pasted).normalize("NFC"),
        fs.realpathSync(target).normalize("NFC")
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
