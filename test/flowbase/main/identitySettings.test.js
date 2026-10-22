const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveIdentity, applyIdentity } = require("../../../src/flowbase/main/identity");
const { createSettingsStore, DEFAULT_SHORTCUTS } = require("../../../src/flowbase/main/settings");

test("Identität: eigener Name und userData-Ordner, dev getrennt", () => {
  const appData = path.join("C:", "Users", "x", "AppData", "Roaming");
  const prod = resolveIdentity({ appDataPath: appData, isDev: false });
  assert.equal(prod.name, "Flowbase Stimme");
  assert.equal(prod.userDataPath, path.join(appData, "Flowbase Stimme"));
  assert.equal(prod.appUserModelId, "com.flowbase.stimme");
  assert.equal(
    resolveIdentity({ appDataPath: appData, isDev: true }).userDataPath,
    path.join(appData, "Flowbase Stimme-dev")
  );
  assert.ok(!/openwhispr/i.test(prod.userDataPath));
});

test("applyIdentity setzt Name, userData und (nur Windows) AppUserModelId", () => {
  const calls = [];
  const app = {
    getPath: () => "/home/u/.config",
    setName: (n) => calls.push(["name", n]),
    setPath: (k, v) => calls.push(["path", k, v]),
    setAppUserModelId: (id) => calls.push(["aumid", id]),
  };
  applyIdentity(app, { platform: "win32" });
  assert.deepEqual(calls, [
    ["name", "Flowbase Stimme"],
    ["path", "userData", path.join("/home/u/.config", "Flowbase Stimme")],
    ["aumid", "com.flowbase.stimme"],
  ]);
  calls.length = 0;
  applyIdentity(app, { platform: "linux" });
  assert.ok(!calls.some((c) => c[0] === "aumid"));
});

test("Settings: Defaults, Speichern, kaputte Datei → Defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-settings-"));
  const file = path.join(dir, "settings.json");
  const store = createSettingsStore({ file, logger: { warn() {} } });
  assert.deepEqual(store.load().shortcuts, DEFAULT_SHORTCUTS);
  store.update({ shortcuts: { ...DEFAULT_SHORTCUTS, B: "" } });
  const reread = createSettingsStore({ file }).load();
  assert.equal(reread.shortcuts.B, "");
  assert.equal(reread.shortcuts.A, "Control+Alt+A");
  fs.writeFileSync(file, "{kaputt");
  assert.deepEqual(createSettingsStore({ file, logger: { warn() {} } }).load().shortcuts, DEFAULT_SHORTCUTS);
  fs.rmSync(dir, { recursive: true, force: true });
});
