const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const clipboardModulePath = require.resolve("../../src/helpers/clipboard");
const originalLoad = Module._load;

function loadWithMocks({ accessibility, written }) {
  delete require.cache[clipboardModulePath];
  Module._load = function loadWithFakes(request, parent, isMain) {
    if (request === "electron") {
      return {
        clipboard: { writeText() {}, readText: () => "" },
        systemPreferences: { isTrustedAccessibilityClient: () => accessibility },
      };
    }
    if (request === "./fileClipboard") {
      return { writeFileToClipboard: async (p) => written.push(p) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../../src/helpers/clipboard");
  } finally {
    Module._load = originalLoad;
  }
}

function asPlatform(t, value) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value });
  t.after(() => Object.defineProperty(process, "platform", original));
}

test("pasteFile on macOS writes the file, then pastes via Cmd+V path", async (t) => {
  asPlatform(t, "darwin");
  const written = [];
  const ClipboardManager = loadWithMocks({ accessibility: true, written });
  const manager = new ClipboardManager();
  const calls = [];
  manager.pasteMacOS = async (original, options) => {
    calls.push({ original, options, written: [...written] });
    return { restoreComplete: Promise.resolve() };
  };
  await manager.pasteFile("/Users/me/Büro/beispiel.mp3");
  assert.deepEqual(written, ["/Users/me/Büro/beispiel.mp3"]);
  assert.deepEqual(calls, [{ original: null, options: {}, written }]);
});

test("pasteFile on macOS without Accessibility shows the dialog and rejects clearly", async (t) => {
  asPlatform(t, "darwin");
  const written = [];
  const ClipboardManager = loadWithMocks({ accessibility: false, written });
  const manager = new ClipboardManager();
  let dialogs = 0;
  manager.showAccessibilityDialog = () => dialogs++;
  manager.pasteMacOS = async () => assert.fail("must not press Cmd+V without permission");
  await assert.rejects(manager.pasteFile("/tmp/beispiel.mp3"), (error) => {
    assert.equal(error.code, "ACCESSIBILITY_PERMISSION_REQUIRED");
    assert.equal(error.clipboardCopied, true);
    assert.match(error.message, /paste manually with Cmd\+V/);
    return true;
  });
  assert.equal(dialogs, 1);
  assert.deepEqual(written, ["/tmp/beispiel.mp3"]);
});

test("pasteFile still rejects on Linux", async (t) => {
  asPlatform(t, "linux");
  const ClipboardManager = loadWithMocks({ accessibility: true, written: [] });
  await assert.rejects(new ClipboardManager().pasteFile("/tmp/x.mp3"), /Windows and macOS/);
});
