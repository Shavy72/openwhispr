// Kürzel B: Text aus dem fokussierten Feld wird zur Sprachnachricht (MP3) in
// der Stimme des aktiven Models. Ablauf: Feldtext lesen → Flowbase erzeugt
// die Datei → Feld leeren → Datei einfügen. Bei jedem Fehler bleibt der Text
// unangetastet im Feld.
//
// Alle Seiteneffekte kommen als Abhängigkeiten herein, damit der Ablauf ohne
// Electron testbar ist:
//   readFieldText()          → Promise<string>  (Text des fokussierten Felds)
//   clearField()             → Promise<void>    (Feld leeren)
//   pasteFile(filePath)      → Promise<void>    (Datei ins Feld einfügen)
//   makeVoiceMessage(text)   → Promise<{ok:true,filePath}|{ok:false,message}>
//   notify({state, message}) → void             (state: working|done|error)

const VOICE_MESSAGE_STATUS_EVENT = "flowbase-voice-message-status";

const MESSAGES = {
  working: "Sprachnachricht wird erstellt …",
  done: "Sprachnachricht eingefügt.",
  empty: "Kein Text im Feld.",
  readFailed: "Text im Feld konnte nicht gelesen werden.",
  pasteFailed: "Sprachnachricht konnte nicht eingefügt werden.",
  unexpected: "Sprachnachricht konnte nicht erstellt werden.",
};

function createVoiceMessageShortcut({
  readFieldText,
  clearField,
  pasteFile,
  makeVoiceMessage,
  notify,
}) {
  let running = false;

  async function runOnce() {
    let text;
    try {
      text = await readFieldText();
    } catch {
      notify({ state: "error", message: MESSAGES.readFailed });
      return;
    }
    if (!text || !text.trim()) {
      notify({ state: "error", message: MESSAGES.empty });
      return;
    }

    notify({ state: "working", message: MESSAGES.working });

    let result;
    try {
      result = await makeVoiceMessage(text);
    } catch {
      result = { ok: false, message: MESSAGES.unexpected };
    }
    if (!result || !result.ok) {
      notify({ state: "error", message: result?.message || MESSAGES.unexpected });
      return;
    }

    try {
      await clearField();
      await pasteFile(result.filePath);
    } catch {
      notify({ state: "error", message: MESSAGES.pasteFailed });
      return;
    }
    notify({ state: "done", message: MESSAGES.done });
  }

  // Eine zweite Auslösung während eines laufenden Durchgangs wird ignoriert,
  // sonst würde dasselbe Feld doppelt gelesen und doppelt vertont.
  async function run() {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } finally {
      running = false;
    }
  }

  return { run };
}

module.exports = { createVoiceMessageShortcut, VOICE_MESSAGE_STATUS_EVENT, MESSAGES };
