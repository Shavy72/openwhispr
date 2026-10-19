const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const WRITE_TIMEOUT_MS = 5000;

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
function writeFileDropList(absPath) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("writeFileDropList is only supported on Windows"));
  }
  if (typeof absPath !== "string" || !path.isAbsolute(absPath)) {
    return Promise.reject(new Error(`Expected an absolute file path, got: ${absPath}`));
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return Promise.reject(new Error(`File not found: ${absPath}`));
  }

  return new Promise((resolve, reject) => {
    // The path travels via env, never through the command string, so quotes or
    // $ in a file name cannot alter the PowerShell command.
    const proc = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Set-Clipboard -LiteralPath $env:OPENWHISPR_PASTE_FILE",
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, OPENWHISPR_PASTE_FILE: absPath },
      }
    );

    let stderr = "";
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error("Set-Clipboard timed out"));
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
        reject(new Error(`Set-Clipboard failed (code ${code}): ${stderr.trim()}`));
      }
    });
  });
}

module.exports = { writeFileDropList };
