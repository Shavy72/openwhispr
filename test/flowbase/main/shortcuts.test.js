const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createShortcutController,
  MESSAGES,
  MAX_RECORDING_MS,
  SUBMIT_TIMEOUT_MS,
} = require("../../../src/flowbase/main/shortcuts");

function setup({
  recording = { ok: true, text: "Hallo" },
  registerOk = () => true,
  realTimers = false,
} = {}) {
  const log = [];
  const statuses = [];
  const registered = new Map();
  const timers = [];
  let persisted = null;
  const controller = createShortcutController({
    registerAccelerator: (acc, cb) => {
      const ok = registerOk(acc);
      if (ok) registered.set(acc, cb);
      return ok;
    },
    unregisterAccelerator: (acc) => registered.delete(acc),
    shortcuts: { A: "Control+Alt+A", B: "Control+Alt+B", C: "Control+Alt+C" },
    persistShortcuts: (map) => {
      persisted = map;
    },
    runVoiceMessage: async (notify) => {
      log.push("B");
      notify({ state: "done", message: "Sprachnachricht eingefügt." });
    },
    handleRecording: async (kind, audio, mimeType, notify) => {
      log.push(`rec:${kind}:${mimeType}`);
      notify({ state: "working", message: "läuft" });
      if (kind === "voice") notify({ state: "done", message: "Sprachnachricht eingefügt." });
      return recording;
    },
    pasteText: async (text) => log.push(`paste:${text}`),
    showPill: () => log.push("show"),
    hidePill: () => log.push("hide"),
    sendToggle: (e) => log.push(`toggle:${e.slot}:${e.start}`),
    emitStatus: (s) => statuses.push(s),
    // Handle = Index + 1; clearTimer nimmt den Timer aus der Liste aktiver Timer.
    ...(realTimers
      ? {}
      : {
          setTimer: (fn) => timers.push(fn) && timers.length,
          clearTimer: (handle) => {
            timers[handle - 1] = null;
          },
        }),
    createGate: () => () => true,
  });
  return { controller, log, statuses, registered, timers, getPersisted: () => persisted };
}

test("A: 1. Druck startet, 2. Druck stoppt, Abgabe fügt Text ein, Pille geht nach Timer weg", async () => {
  const { controller, log, statuses, timers } = setup();
  controller.press("A");
  assert.deepEqual(log, ["show", "toggle:A:true"]);
  assert.equal(statuses.at(-1).phase, "recording");
  controller.press("A");
  assert.equal(log.at(-1), "toggle:A:false");
  assert.equal(statuses.at(-1).phase, "working");
  controller.press("A"); // während working ignoriert
  assert.equal(log.filter((l) => l.startsWith("toggle")).length, 2);

  const result = await controller.submitRecording("A", Buffer.from("x"), "audio/webm");
  assert.deepEqual(result, { ok: true });
  assert.ok(log.includes("rec:text:audio/webm"));
  assert.ok(log.includes("paste:Hallo"));
  assert.deepEqual(statuses.at(-1), { slot: "A", phase: "done", message: MESSAGES.textDone });
  assert.equal(controller.getBusy(), null);
  const active = timers.filter(Boolean); // Sicherheitsnetz-Timer sind abgeräumt
  assert.equal(active.length, 1);
  active[0]();
  assert.equal(log.at(-1), "hide");
});

test("C: Fehler aus Flowbase wird error-Status mit deutschem Text", async () => {
  const { controller, statuses } = setup({ recording: { ok: false, message: "Kein Model aktiv." } });
  controller.press("C");
  controller.press("C");
  const result = await controller.submitRecording("C", Buffer.from("x"), "audio/webm");
  assert.deepEqual(result, { ok: false, error: "Kein Model aktiv." });
  assert.deepEqual(statuses.at(-1), { slot: "C", phase: "error", message: "Kein Model aktiv." });
});

test("C: Erfolg meldet done mit Text des Helfers", async () => {
  const { controller, statuses } = setup({ recording: { ok: true } });
  controller.press("C");
  await controller.submitRecording("C", Buffer.from("x"), "audio/webm");
  assert.deepEqual(statuses.at(-1), {
    slot: "C",
    phase: "done",
    message: "Sprachnachricht eingefügt.",
  });
});

test("Während A läuft, werden B und C ignoriert (mit Meldung)", () => {
  const { controller, log, statuses } = setup();
  controller.press("A");
  controller.press("C");
  controller.press("B");
  assert.deepEqual(log, ["show", "toggle:A:true"]);
  assert.deepEqual(
    statuses.slice(-2).map((s) => [s.slot, s.phase, s.message]),
    [
      ["C", "error", MESSAGES.busy],
      ["B", "error", MESSAGES.busy],
    ]
  );
  assert.equal(controller.getBusy().slot, "A");
});

test("submitRecording ohne laufende Aufnahme wird abgelehnt", async () => {
  const { controller } = setup();
  const result = await controller.submitRecording("A", Buffer.from("x"), "audio/webm");
  assert.deepEqual(result, { ok: false, error: MESSAGES.noRecording });
});

test("B läuft einmal und meldet Status für Slot B", async () => {
  const { controller, log, statuses } = setup();
  controller.press("B");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ["B"]);
  assert.deepEqual(statuses.at(-1), {
    slot: "B",
    phase: "done",
    message: "Sprachnachricht eingefügt.",
  });
  assert.equal(controller.getBusy(), null);
});

test("setShortcut: neu registrieren + speichern, Leerstring = aus", () => {
  const { controller, registered, getPersisted } = setup();
  assert.deepEqual(controller.registerAll(), []);
  assert.deepEqual(controller.setShortcut("A", "Control+Shift+D"), { ok: true });
  assert.ok(registered.has("Control+Shift+D"));
  assert.ok(!registered.has("Control+Alt+A"));
  assert.equal(getPersisted().A, "Control+Shift+D");
  assert.deepEqual(controller.setShortcut("B", ""), { ok: true });
  assert.ok(!registered.has("Control+Alt+B"));
  assert.equal(controller.getShortcuts().B, "");
});

test("setShortcut: Fehlschlag stellt altes Kürzel wieder her", () => {
  const { controller, registered, getPersisted } = setup({
    registerOk: (acc) => acc !== "Control+X",
  });
  controller.registerAll();
  assert.deepEqual(controller.setShortcut("A", "Control+X"), {
    ok: false,
    error: MESSAGES.shortcutTaken,
  });
  assert.ok(registered.has("Control+Alt+A"));
  assert.equal(controller.getShortcuts().A, "Control+Alt+A");
  assert.equal(getPersisted(), null);
});

test("setShortcut: Kürzel eines anderen Slots ist belegt", () => {
  const { controller } = setup();
  controller.registerAll();
  assert.equal(controller.setShortcut("A", "Control+Alt+C").ok, false);
});

test("Hauptfenster-Fokus: suspend meldet ab, resume meldet aus aktuellem Stand wieder an", () => {
  const { controller, registered } = setup();
  controller.registerAll();
  assert.equal(controller.suspend(), true);
  assert.equal(registered.size, 0);
  // Neu belegen während abgemeldet: wird geprüft und gespeichert, bleibt aber abgemeldet.
  assert.deepEqual(controller.setShortcut("A", "Control+Shift+D"), { ok: true });
  assert.equal(registered.size, 0);
  assert.deepEqual(controller.resume(), []);
  assert.deepEqual([...registered.keys()].sort(), [
    "Control+Alt+B",
    "Control+Alt+C",
    "Control+Shift+D",
  ]);
  assert.deepEqual(controller.resume(), []); // zweites resume ohne suspend ist No-op
  assert.equal(registered.size, 3);
});

test("Hauptfenster-Fokus: während laufender A/C-Aufnahme nicht abmelden", () => {
  const { controller, registered } = setup();
  controller.registerAll();
  controller.press("C");
  assert.equal(controller.suspend(), false);
  assert.equal(registered.size, 3);
  assert.equal(controller.isSuspended(), false);
});

test("Hauptfenster-Fokus: belegtes Kürzel wird auch abgemeldet abgelehnt", () => {
  const { controller } = setup({ registerOk: (acc) => acc !== "Control+X" });
  controller.registerAll();
  controller.suspend();
  assert.equal(controller.setShortcut("A", "Control+X").ok, false);
  assert.equal(controller.getShortcuts().A, "Control+Alt+A");
});

test("A/C: nach 5 min Aufnahme automatisch stoppen, 30 s ohne Abgabe → abgebrochen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, log, statuses } = setup({ realTimers: true });
  controller.press("C");
  t.mock.timers.tick(MAX_RECORDING_MS - 1);
  assert.equal(log.at(-1), "toggle:C:true");
  t.mock.timers.tick(1);
  assert.equal(log.at(-1), "toggle:C:false");
  assert.equal(controller.getBusy().phase, "working");

  t.mock.timers.tick(SUBMIT_TIMEOUT_MS);
  assert.deepEqual(statuses.at(-1), { slot: "C", phase: "error", message: "Aufnahme abgebrochen." });
  assert.equal(controller.getBusy(), null);
  t.mock.timers.tick(2000);
  assert.equal(log.at(-1), "hide");

  // Zustand zurückgesetzt: neues Kürzel startet normal.
  controller.press("A");
  assert.equal(log.at(-1), "toggle:A:true");
});

test("A: rechtzeitige Abgabe nach Auto-Stopp beendet normal, kein späterer Abbruch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, statuses } = setup({ realTimers: true });
  controller.press("A");
  t.mock.timers.tick(MAX_RECORDING_MS);
  const result = await controller.submitRecording("A", Buffer.from("x"), "audio/webm");
  assert.deepEqual(result, { ok: true });
  t.mock.timers.tick(SUBMIT_TIMEOUT_MS * 2);
  assert.ok(!statuses.some((s) => s.message === MESSAGES.aborted));
  assert.equal(statuses.at(-1).phase, "done");
});

test("A: manueller Stopp ohne Abgabe → nach 30 s abgebrochen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, statuses } = setup({ realTimers: true });
  controller.press("A");
  controller.press("A");
  t.mock.timers.tick(SUBMIT_TIMEOUT_MS);
  assert.deepEqual(statuses.at(-1), { slot: "A", phase: "error", message: MESSAGES.aborted });
  assert.equal(controller.getBusy(), null);
});
