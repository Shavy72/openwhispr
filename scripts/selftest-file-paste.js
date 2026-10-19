// Self-test for the file-paste building block (Windows): puts the sample MP3 on
// the clipboard as a FileDropList and reads it back. Does not press Ctrl+V.
// Usage: node scripts/selftest-file-paste.js
const { spawnSync } = require("child_process");
const path = require("path");
const { writeFileDropList } = require("../src/helpers/fileClipboard");

const samplePath = path.join(__dirname, "..", "assets", "test", "beispiel.mp3");

writeFileDropList(samplePath)
  .then(() => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "(Get-Clipboard -Format FileDropList).FullName"],
      { encoding: "utf8", windowsHide: true }
    );
    const output = result.stdout.trim();
    console.log("FileDropList:", output);
    if (path.resolve(output) !== path.resolve(samplePath)) {
      console.error("FAIL: clipboard does not hold the sample MP3");
      process.exit(1);
    }
    console.log("OK");
  })
  .catch((error) => {
    console.error("FAIL:", error.message);
    process.exit(1);
  });
