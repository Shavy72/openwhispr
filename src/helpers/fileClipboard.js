const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const WRITE_TIMEOUT_MS = 5000;

// JXA (JavaScript for Automation) run via osascript: does what Finder's "Copy"
// does — writes an NSURL file URL to the general pasteboard. The path arrives
// as argv[0], never inside this string.
const MAC_PASTEBOARD_SCRIPT = `ObjC.import("AppKit");
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  const url = $.NSURL.fileURLWithPath(argv[0]);
  if (!pb.writeObjects($.NSArray.arrayWithObject(url))) {
    throw new Error("NSPasteboard writeObjects failed");
  }
}`;

function validateFilePath(absPath) {
  if (typeof absPath !== "string" || !path.isAbsolute(absPath)) {
    throw new Error(`Expected an absolute file path, got: ${absPath}`);
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`File not found: ${absPath}`);
  }
}

/** osascript argv for the macOS writer; the path is its own argv entry. */
function macPasteboardArgs(absPath) {
  return ["-l", "JavaScript", "-e", MAC_PASTEBOARD_SCRIPT, absPath];
}

function runWriter(label, command, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error(`${label} timed out`));
    }, WRITE_TIMEOUT_MS);

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed (code ${code}): ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Puts one file on the Windows clipboard as a file (CF_HDROP / FileDropList),
 * the same format Explorer uses for "Copy". Target apps then receive the file
 * itself on Ctrl+V, not its path as text.
 *
 * Resolves once the clipboard holds the file; rejects if the path is not an
 * existing file, the platform is not Windows, or PowerShell fails.
 *
 * ponytail: spawns PowerShell (~300 ms), native CF_HDROP writer if latency matters.
 */
async function writeFileDropList(absPath) {
  if (process.platform !== "win32") {
    throw new Error("writeFileDropList is only supported on Windows");
  }
  validateFilePath(absPath);
  // The path travels via env, never through the command string, so quotes or
  // $ in a file name cannot alter the PowerShell command.
  return runWriter(
    "Set-Clipboard",
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Set-Clipboard -LiteralPath $env:OPENWHISPR_PASTE_FILE",
    ],
    { windowsHide: true, env: { ...process.env, OPENWHISPR_PASTE_FILE: absPath } }
  );
}

/**
 * Puts one file on the macOS pasteboard as a file URL (NSURL), the same way
 * Finder's "Copy" does. Cmd+V then pastes the file itself.
 *
 * ponytail: spawns osascript (~150 ms), native NSPasteboard helper if latency matters.
 */
async function writeFilePasteboard(absPath) {
  if (process.platform !== "darwin") {
    throw new Error("writeFilePasteboard is only supported on macOS");
  }
  validateFilePath(absPath);
  return runWriter("NSPasteboard write", "osascript", macPasteboardArgs(absPath), {});
}

/**
 * Puts one file on the system clipboard as a file (not text), using the
 * platform's native file-copy format. Windows and macOS; rejects elsewhere.
 */
function writeFileToClipboard(absPath) {
  if (process.platform === "win32") return writeFileDropList(absPath);
  if (process.platform === "darwin") return writeFilePasteboard(absPath);
  return Promise.reject(new Error(`File clipboard is not supported on ${process.platform}`));
}

module.exports = {
  writeFileToClipboard,
  writeFileDropList,
  writeFilePasteboard,
  macPasteboardArgs,
  MAC_PASTEBOARD_SCRIPT,
};
