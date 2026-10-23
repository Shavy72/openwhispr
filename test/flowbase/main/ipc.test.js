const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHandlers, registerIpc, CHANNELS } = require("../../../src/flowbase/main/ipc");

const ROOT = path.join(__dirname, "..", "..", "..");

function deps(overrides = {}) {
  return {
    client: {
      getSession: async () => ({
        loggedIn: true,
        user: { email: "a@b.de", name: "Anna" },
        activeModelId: "m1",
      }),
      login: async (email, pw) =>
        pw === "gut" ? { ok: true } : { ok: false, message: "E-Mail oder Passwort falsch." },
      logout: async () => ({ ok: true }),
      listModels: async () => ({ ok: true, models: [{ id: "m1", name: "Mia" }] }),
      setActiveModel: async () => ({ ok: false, message: "Dieses Model ist dir nicht zugewiesen." }),
    },
    shortcuts: {
      getShortcuts: () => ({ A: "a", B: "b", C: "c" }),
      setShortcut: () => ({ ok: true }),
      submitRecording: async (slot, buf) => ({ ok: true, size: buf.length }),
    },
    autostart: {
      get: () => true,
      set: () => {
        throw new Error("boom");
      },
    },
    getVersion: () => "1.12.0",
    onLoggedIn: () => {},
    isOwnWindow: () => true,
    isPillWindow: (sender) => sender === "pill",
    logger: { error() {}, warn() {} },
    ...overrides,
  };
}

test("Session/Login/Modelle werden auf den Vertrag abgebildet", async () => {
  let loggedIn = 0;
  const h = createHandlers(deps({ onLoggedIn: () => loggedIn++ }));
  assert.deepEqual(await h.getSession(), {
    loggedIn: true,
    email: "a@b.de",
    name: "Anna",
    activeModelId: "m1",
  });
  assert.deepEqual(await h.login("main", "a@b.de", "falsch"), {
    ok: false,
    error: "E-Mail oder Passwort falsch.",
  });
  assert.equal(loggedIn, 0);
  const ok = await h.login("main", " a@b.de ", "gut");
  assert.equal(ok.ok, true);
  assert.equal(ok.session.email, "a@b.de");
  assert.equal(loggedIn, 1);
  assert.deepEqual(await h.listModels(), { ok: true, models: [{ id: "m1", name: "Mia" }] });
  assert.deepEqual(await h.setActiveModel("main", "m2"), {
    ok: false,
    error: "Dieses Model ist dir nicht zugewiesen.",
  });
  assert.equal((await h.login("main", 42, "x")).ok, false);
});

test("Autostart-Fehler wird deutscher Fehlertext, getAppInfo liefert Version", async () => {
  const h = createHandlers(deps());
  assert.deepEqual(await h.getAppInfo(), { version: "1.12.0", autostart: true });
  const r = await h.setAutostart("main", true);
  assert.equal(r.ok, false);
  assert.match(r.error, /Autostart/);
  assert.equal((await h.setAutostart("main", "ja")).ok, false);
});

test("submitRecording nur aus dem Aufnahme-Fenster, ArrayBuffer → Buffer", async () => {
  const h = createHandlers(deps());
  assert.equal((await h.submitRecording("main", "A", new ArrayBuffer(3), "audio/webm")).ok, false);
  assert.deepEqual(await h.submitRecording("pill", "C", new ArrayBuffer(3), "audio/webm"), {
    ok: true,
    size: 3,
  });
  assert.equal((await h.submitRecording("pill", "B", new ArrayBuffer(3), "audio/webm")).ok, false);
});

test("registerIpc: Exceptions und fremde Absender werden zu {ok:false,error}", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  registerIpc(
    ipcMain,
    deps({
      client: { ...deps().client, logout: async () => Promise.reject(new Error("x")) },
      isOwnWindow: (s) => s !== "fremd",
    })
  );
  const r = await handlers.get(CHANNELS.logout)({ sender: "main" });
  assert.equal(r.ok, false);
  assert.equal(typeof r.error, "string");
  const f = await handlers.get(CHANNELS.getSession)({ sender: "fremd" });
  assert.equal(f.ok, false);
});

test("preload exponiert genau die Methoden aus bridge.d.ts mit den Kanälen aus ipc.js", () => {
  const bridge = fs.readFileSync(path.join(ROOT, "src", "flowbase", "bridge.d.ts"), "utf8");
  const iface = bridge.slice(bridge.indexOf("interface FlowbaseBridge"));
  const contract = [...iface.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]).sort();

  const preload = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
  const exposed = [...preload.matchAll(/^\s+(\w+): (?:invoke|subscribe)\("([^"]+)"\)/gm)];
  assert.deepEqual(exposed.map((m) => m[1]).sort(), contract);
  for (const [, name, channel] of exposed) {
    const key = name === "onStatus" ? "status" : name === "onRecordingToggle" ? "recordingToggle" : name;
    assert.equal(CHANNELS[key], channel, name);
  }
});

test("submitRecording über 50 MB → ok:false mit deutschem Text", async () => {
  const { MESSAGES } = require("../../../src/flowbase/main/ipc");
  let called = false;
  const h = createHandlers(
    deps({
      shortcuts: {
        ...deps().shortcuts,
        submitRecording: async () => {
          called = true;
          return { ok: true };
        },
      },
    })
  );
  const tooBig = new ArrayBuffer(50 * 1024 * 1024 + 1);
  assert.deepEqual(await h.submitRecording("pill", "A", tooBig, "audio/webm"), {
    ok: false,
    error: "Aufnahme ist zu groß.",
  });
  assert.equal(MESSAGES.recordingTooLarge, "Aufnahme ist zu groß.");
  assert.equal(called, false);
});

test("setShortcut: Nicht-String und über 500 Zeichen → ok:false", async () => {
  const h = createHandlers(deps());
  assert.deepEqual(await h.setShortcut("main", "A", 42), { ok: false, error: "Ungültige Eingabe." });
  assert.deepEqual(await h.setShortcut("main", null, "Control+X"), {
    ok: false,
    error: "Ungültige Eingabe.",
  });
  assert.deepEqual(await h.setShortcut("main", "A", "x".repeat(501)), {
    ok: false,
    error: "Ungültige Eingabe.",
  });
});

test('setActiveModel("") → ok:false', async () => {
  const h = createHandlers(deps());
  assert.deepEqual(await h.setActiveModel("main", ""), { ok: false, error: "Ungültige Eingabe." });
});
