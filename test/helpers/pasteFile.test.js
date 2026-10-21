const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

test("pasteFile on Linux without X11 rejects with a clear message", async (t) => {
  asPlatform(t, "linux");
  const display = process.env.DISPLAY;
  delete process.env.DISPLAY;
  t.after(() => {
    if (display !== undefined) process.env.DISPLAY = display;
  });
  const ClipboardManager = loadWithMocks({ accessibility: true, written: [] });
  await assert.rejects(new ClipboardManager().pasteFile("/tmp/x.mp3"), /X11-Sitzung/);
});

test("pasteFile auf nicht unterstützter Plattform (freebsd) wirft", async (t) => {
  asPlatform(t, "freebsd");
  const ClipboardManager = loadWithMocks({ accessibility: true, written: [] });
  await assert.rejects(
    new ClipboardManager().pasteFile("/tmp/x.mp3"),
    /pasteFile is only supported on Windows, macOS and Linux/
  );
});

// --- Kürzel B unter Linux (X11 + xdotool) ---

function loadLinux({ events }) {
  delete require.cache[clipboardModulePath];
  Module._load = function loadWithFakes(request, parent, isMain) {
    if (request === "electron") {
      return {
        clipboard: {
          writeText() {},
          readText: () => "",
          writeBuffer: (format, buffer) => events.push({ type: "buffer", format, buffer }),
        },
        systemPreferences: {},
      };
    }
    if (request === "child_process") {
      return {
        ...originalLoad.call(this, request, parent, isMain),
        spawn: (command, args) => {
          events.push({ type: "spawn", command, args });
          const handlers = {};
          setImmediate(() => handlers.close && handlers.close(0));
          return {
            on(name, fn) {
              handlers[name] = fn;
              return this;
            },
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../../src/helpers/clipboard");
  } finally {
    Module._load = originalLoad;
  }
}

function setEnv(t, values) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test("_sendKeyCombo on Linux calls xdotool with the exact key arguments", async (t) => {
  asPlatform(t, "linux");
  const events = [];
  const manager = new (loadLinux({ events }))();
  for (const name of ["selectAll", "copy", "paste", "delete"]) await manager._sendKeyCombo(name);
  assert.deepEqual(
    events.map((e) => [e.command, e.args]),
    [
      ["xdotool", ["key", "--clearmodifiers", "ctrl+a"]],
      ["xdotool", ["key", "--clearmodifiers", "ctrl+c"]],
      ["xdotool", ["key", "--clearmodifiers", "ctrl+v"]],
      ["xdotool", ["key", "--clearmodifiers", "Delete"]],
    ]
  );
});

test("_writeLinuxFileClipboard writes a percent-encoded text/uri-list ending in CRLF", (t) => {
  asPlatform(t, "linux");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paste-file-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "Büro test.mp3");
  fs.writeFileSync(file, "x");
  const events = [];
  new (loadLinux({ events }))()._writeLinuxFileClipboard(file);
  assert.equal(events.length, 1);
  assert.equal(events[0].format, "text/uri-list");
  const text = events[0].buffer.toString("utf8");
  assert.ok(text.endsWith("B%C3%BCro%20test.mp3\r\n"), text);
  assert.ok(text.startsWith("file:///"), text);
});

test("_assertKeySimulationPlatform on Linux checks X11 session and xdotool", (t) => {
  asPlatform(t, "linux");
  const make = (hasXdotool) => {
    const manager = new (loadLinux({ events: [] }))();
    manager.commandExists = (name) => hasXdotool && name === "xdotool";
    return manager;
  };
  setEnv(t, { DISPLAY: undefined, WAYLAND_DISPLAY: undefined, XDG_SESSION_TYPE: undefined });
  assert.throws(() => make(true)._assertKeySimulationPlatform(), /X11-Sitzung/);

  process.env.DISPLAY = ":0";
  process.env.WAYLAND_DISPLAY = "wayland-0";
  assert.throws(() => make(true)._assertKeySimulationPlatform(), /Kürzel B braucht/);

  delete process.env.WAYLAND_DISPLAY;
  process.env.XDG_SESSION_TYPE = "wayland";
  assert.throws(() => make(true)._assertKeySimulationPlatform(), /Kürzel B braucht/);

  process.env.XDG_SESSION_TYPE = "x11";
  assert.doesNotThrow(() => make(true)._assertKeySimulationPlatform());
  assert.throws(() => make(false)._assertKeySimulationPlatform(), /xdotool/);
});

test("pasteFile on Linux writes the uri-list first, then sends the paste combo", async (t) => {
  asPlatform(t, "linux");
  setEnv(t, { DISPLAY: ":0", WAYLAND_DISPLAY: undefined, XDG_SESSION_TYPE: "x11" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paste-file-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "a.mp3");
  fs.writeFileSync(file, "x");
  const events = [];
  const manager = new (loadLinux({ events }))();
  manager.commandExists = () => true;
  await manager.pasteFile(file);
  assert.deepEqual(
    events.map((e) => (e.type === "buffer" ? `buffer:${e.format}` : `${e.command} ${e.args.at(-1)}`)),
    ["buffer:text/uri-list", "xdotool ctrl+v"]
  );
});
