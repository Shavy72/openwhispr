// Kürzel A/B/C: globale Tastenkürzel und Zustandsmaschine im Main-Prozess.
//   A (Diktat) und C (Sprechen → Sprachnachricht): Toggle. 1. Druck startet die
//   Aufnahme im Aufnahme-Fenster, 2. Druck stoppt sie; das Fenster gibt die
//   Aufnahme per submitRecording ab.
//   B (Feldtext → Sprachnachricht): einmal auslösen.
// Solange ein Kürzel läuft, werden die anderen ignoriert (mit Status-Meldung).
// Sicherheitsnetz A/C: nach MAX_RECORDING_MS wird die Aufnahme automatisch
// gestoppt; kommt nach dem Stopp binnen SUBMIT_TIMEOUT_MS kein submitRecording,
// endet der Durchgang mit Fehler und der Zustand wird zurückgesetzt.
//
// Alle Seiteneffekte kommen als Abhängigkeiten herein (testbar ohne Electron):
//   registerAccelerator(acc, cb) → boolean   unregisterAccelerator(acc) → void
//   shortcuts: {A,B,C}  persistShortcuts(map) → void
//   runVoiceMessage(notify) → Promise<void>          (Kürzel B, voiceMessageShortcut)
//   handleRecording(kind, audio, mimeType, notify) → Promise<{ok,text?,message?}>
//   pasteText(text) → Promise<void>
//   showPill() / hidePill() / sendToggle({slot,start}) / emitStatus({slot,phase,message})
//   setTimer(fn, ms) / clearTimer(handle) / createGate() → () => boolean

const { createHotkeyRepeatGate } = require("../../helpers/hotkeyRepeatGate");

const SLOTS = ["A", "B", "C"];
const RECORDING_KIND = { A: "text", C: "voice" };
const PILL_HIDE_DELAY_MS = 2000;
const MAX_RECORDING_MS = 5 * 60 * 1000;
const SUBMIT_TIMEOUT_MS = 30 * 1000;

const MESSAGES = {
  recording: "Aufnahme läuft … zum Beenden das Kürzel erneut drücken.",
  working: "Aufnahme wird verarbeitet …",
  busy: "Erst das laufende Kürzel abschließen.",
  textDone: "Text eingefügt.",
  textPasteFailed: "Text konnte nicht eingefügt werden.",
  voiceDone: "Sprachnachricht eingefügt.",
  shortcutTaken: "Kürzel ist schon belegt oder ungültig.",
  unknownSlot: "Unbekanntes Kürzel.",
  noRecording: "Keine laufende Aufnahme für dieses Kürzel.",
  unexpected: "Aufnahme konnte nicht verarbeitet werden.",
  aborted: "Aufnahme abgebrochen.",
};

function createShortcutController({
  registerAccelerator,
  unregisterAccelerator,
  shortcuts: initialShortcuts,
  persistShortcuts,
  runVoiceMessage,
  handleRecording,
  pasteText,
  showPill,
  hidePill,
  sendToggle,
  emitStatus,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  createGate = createHotkeyRepeatGate,
  logger,
}) {
  const shortcuts = { ...initialShortcuts };
  const gates = { A: createGate(), B: createGate(), C: createGate() };
  // busy: null | { slot, phase: "recording" | "working" }
  let busy = null;
  let hideTimer = null;
  // Sicherheitsnetz-Timer des laufenden A/C-Durchgangs (max. Aufnahme bzw. Abgabe).
  let guardTimer = null;
  // suspended: Hauptfenster hat den Fokus → Kürzel global abgemeldet, damit die
  // Kürzel-Aufnahme im Fenster die Tasten überhaupt bekommt.
  let suspended = false;

  function status(slot, phase, message) {
    emitStatus({ slot, phase, message });
  }

  function scheduleHidePill() {
    if (hideTimer) clearTimer(hideTimer);
    hideTimer = setTimer(() => {
      hideTimer = null;
      hidePill();
    }, PILL_HIDE_DELAY_MS);
  }

  function cancelHidePill() {
    if (!hideTimer) return;
    clearTimer(hideTimer);
    hideTimer = null;
  }

  function clearGuard() {
    if (!guardTimer) return;
    clearTimer(guardTimer);
    guardTimer = null;
  }

  function armGuard(run, ms) {
    clearGuard();
    const owner = busy;
    guardTimer = setTimer(() => {
      guardTimer = null;
      if (busy === owner) run();
    }, ms);
  }

  // Stopp der Aufnahme (2. Druck oder Zeitlimit) → auf Abgabe warten.
  function stopRecording(slot) {
    busy.phase = "working";
    sendToggle({ slot, start: false });
    status(slot, "working", MESSAGES.working);
    armGuard(() => finish(slot, "error", MESSAGES.aborted), SUBMIT_TIMEOUT_MS);
  }

  function press(slot) {
    if (!SLOTS.includes(slot)) return;

    if (busy && busy.slot !== slot) {
      status(slot, "error", MESSAGES.busy);
      return;
    }

    if (slot === "B") {
      if (busy) return; // B läuft schon; voiceMessageShortcut ignoriert Doppelauslösung ohnehin.
      busy = { slot: "B", phase: "working" };
      Promise.resolve()
        .then(() => runVoiceMessage(({ state, message }) => status("B", state, message)))
        .catch((error) => {
          logger?.error?.("Voice message shortcut failed", { error: error?.message });
          status("B", "error", MESSAGES.unexpected);
        })
        .finally(() => {
          busy = null;
        });
      return;
    }

    if (!busy) {
      busy = { slot, phase: "recording" };
      cancelHidePill();
      showPill();
      sendToggle({ slot, start: true });
      status(slot, "recording", MESSAGES.recording);
      armGuard(() => stopRecording(slot), MAX_RECORDING_MS);
      return;
    }

    if (busy.phase === "recording") stopRecording(slot);
    // phase "working": Verarbeitung läuft, weiterer Druck wird ignoriert.
  }

  // Ergebnis eines Durchgangs A/C → Status + Pille ausblenden.
  function finish(slot, phase, message) {
    clearGuard();
    busy = null;
    status(slot, phase, message);
    scheduleHidePill();
  }

  async function submitRecording(slot, audio, mimeType) {
    if (!RECORDING_KIND[slot] || !busy || busy.slot !== slot) {
      return { ok: false, error: MESSAGES.noRecording };
    }
    // Auch eine Abgabe ohne vorherigen 2. Druck (z. B. Mikro-Fehler) beendet den Durchgang.
    busy.phase = "working";
    clearGuard();

    // Zwischenmeldungen des Helfers (working) durchreichen; done/error setzt finish().
    let doneMessage = "";
    const notify = ({ state, message }) => {
      if (state === "working") status(slot, "working", message);
      if (state === "done") doneMessage = message;
    };

    let result;
    try {
      result = await handleRecording(RECORDING_KIND[slot], audio, mimeType, notify);
    } catch (error) {
      logger?.error?.("Flowbase recording failed", { slot, error: error?.message });
      result = { ok: false, message: MESSAGES.unexpected };
    }
    if (!result?.ok) {
      const message = result?.message || MESSAGES.unexpected;
      finish(slot, "error", message);
      return { ok: false, error: message };
    }

    if (slot === "A") {
      try {
        await pasteText(result.text);
      } catch (error) {
        logger?.error?.("Flowbase dictation paste failed", { error: error?.message });
        finish(slot, "error", MESSAGES.textPasteFailed);
        return { ok: false, error: MESSAGES.textPasteFailed };
      }
      finish(slot, "done", MESSAGES.textDone);
      return { ok: true };
    }

    finish(slot, "done", doneMessage || MESSAGES.voiceDone);
    return { ok: true };
  }

  function callbackFor(slot) {
    return () => {
      if (gates[slot]()) press(slot);
    };
  }

  function tryRegister(slot, accelerator) {
    if (!accelerator) return true;
    try {
      return registerAccelerator(accelerator, callbackFor(slot)) === true;
    } catch {
      return false; // ungültiger Accelerator wirft in Electron
    }
  }

  // Beim Start: alle gespeicherten Kürzel registrieren. Fehlschläge bleiben gespeichert
  // (z. B. vorübergehend von anderer App belegt) und werden gemeldet.
  function registerAll() {
    const failed = [];
    for (const slot of SLOTS) {
      if (!tryRegister(slot, shortcuts[slot])) failed.push(slot);
    }
    return failed;
  }

  function unregisterAll() {
    for (const slot of SLOTS) {
      if (shortcuts[slot]) unregisterAccelerator(shortcuts[slot]);
    }
  }

  // Hauptfenster fokussiert → abmelden; nicht während einer laufenden A/C-Aufnahme,
  // sonst ließe sie sich nicht mehr per Kürzel stoppen.
  function suspend() {
    if (suspended || (busy && busy.slot !== "B")) return false;
    unregisterAll();
    suspended = true;
    return true;
  }

  // Fenster verliert Fokus/wird versteckt → wieder registrieren (aus aktuellem Stand).
  function resume() {
    if (!suspended) return [];
    suspended = false;
    return registerAll();
  }

  function getShortcuts() {
    return { ...shortcuts };
  }

  function setShortcut(slot, accelerator) {
    if (!SLOTS.includes(slot)) return { ok: false, error: MESSAGES.unknownSlot };
    const next = typeof accelerator === "string" ? accelerator.trim() : "";
    const previous = shortcuts[slot];
    if (next === previous) return { ok: true };
    if (next && SLOTS.some((other) => other !== slot && shortcuts[other] === next)) {
      return { ok: false, error: MESSAGES.shortcutTaken };
    }

    if (suspended) {
      // Nur prüfen, ob frei — abgemeldet bleibt es, bis das Fenster den Fokus abgibt.
      if (!tryRegister(slot, next)) return { ok: false, error: MESSAGES.shortcutTaken };
      if (next) unregisterAccelerator(next);
    } else {
      if (previous) unregisterAccelerator(previous);
      if (!tryRegister(slot, next)) {
        tryRegister(slot, previous);
        return { ok: false, error: MESSAGES.shortcutTaken };
      }
    }
    shortcuts[slot] = next;
    persistShortcuts({ ...shortcuts });
    return { ok: true };
  }

  return {
    press,
    submitRecording,
    registerAll,
    unregisterAll,
    getShortcuts,
    setShortcut,
    suspend,
    resume,
    isSuspended: () => suspended,
    getBusy: () => (busy ? { ...busy } : null),
  };
}

module.exports = {
  createShortcutController,
  MESSAGES,
  PILL_HIDE_DELAY_MS,
  MAX_RECORDING_MS,
  SUBMIT_TIMEOUT_MS,
};
