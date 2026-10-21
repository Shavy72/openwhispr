// Kürzel A und C: gesprochene Aufnahme → Flowbase. Die Aufnahme selbst macht
// der Upstream-Diktat-Weg im Renderer; hier landet nur die fertige Datei.
//   A ("text"):  Aufnahme → Flowbase-Tür „mach Text“ → Text zurück an den
//                Renderer, der ihn wie ein normales Diktat ins Feld einfügt.
//   C ("voice"): Aufnahme → Sprachnachricht (MP3 in der Stimme des aktiven
//                Models) → Datei einfügen wie bei Kürzel B.
// Die Kombination „Diktat, dann vertonen“ entsteht nur durch A und danach B.
//
// Alle Seiteneffekte kommen als Abhängigkeiten herein (testbar ohne Electron):
//   transcribeAudio(audio, mimeType)            → Promise<{ok:true,text}|{ok:false,message}>
//   makeVoiceMessageFromAudio(audio, mimeType)  → Promise<{ok:true,filePath}|{ok:false,message}>
//   pasteFile(filePath)                         → Promise<void>
//   notify({state, message, title?})            → void (state: working|done|idle|error)
//   logger                                      → { warn(message, meta, scope) } (debugLogger)

const MESSAGES = {
  textWorking: "Text wird erstellt …",
  textErrorTitle: "Diktat fehlgeschlagen",
  textUnexpected: "Text konnte nicht erstellt werden.",
  voiceWorking: "Sprachnachricht wird erstellt …",
  voiceDone: "Sprachnachricht eingefügt.",
  voiceErrorTitle: "Sprachnachricht fehlgeschlagen",
  voiceUnexpected: "Sprachnachricht konnte nicht erstellt werden.",
  pasteFailed: "Sprachnachricht konnte nicht eingefügt werden.",
  unknownKind: "Unbekanntes Kürzel.",
};

function createFlowbaseRecordingShortcut({
  transcribeAudio,
  makeVoiceMessageFromAudio,
  pasteFile,
  notify,
  logger,
}) {
  async function call(kind, fn, audio, mimeType, fallback) {
    try {
      const result = await fn(audio, mimeType);
      return result && (result.ok || result.message) ? result : { ok: false, message: fallback };
    } catch (error) {
      logger?.warn("Flowbase recording failed", { kind, message: error?.message }, "audio");
      return { ok: false, message: fallback };
    }
  }

  async function asText(audio, mimeType) {
    notify({ state: "working", message: MESSAGES.textWorking });
    const result = await call("text", transcribeAudio, audio, mimeType, MESSAGES.textUnexpected);
    if (!result.ok) {
      notify({ state: "error", title: MESSAGES.textErrorTitle, message: result.message });
      return { ok: false, message: result.message };
    }
    // Das eingefügte Diktat ist die Rückmeldung; nur den Arbeits-Hinweis schließen.
    notify({ state: "idle", message: "" });
    return { ok: true, text: result.text };
  }

  async function asVoice(audio, mimeType) {
    notify({ state: "working", message: MESSAGES.voiceWorking });
    const result = await call(
      "voice",
      makeVoiceMessageFromAudio,
      audio,
      mimeType,
      MESSAGES.voiceUnexpected
    );
    if (!result.ok) {
      notify({ state: "error", title: MESSAGES.voiceErrorTitle, message: result.message });
      return { ok: false, message: result.message };
    }
    try {
      await pasteFile(result.filePath);
    } catch (error) {
      logger?.warn(
        "Flowbase voice message paste failed",
        { kind: "voice", message: error?.message },
        "audio"
      );
      notify({ state: "error", title: MESSAGES.voiceErrorTitle, message: MESSAGES.pasteFailed });
      return { ok: false, message: MESSAGES.pasteFailed };
    }
    notify({ state: "done", message: MESSAGES.voiceDone });
    return { ok: true };
  }

  async function handleRecording(kind, audio, mimeType) {
    if (kind === "text") return asText(audio, mimeType);
    if (kind === "voice") return asVoice(audio, mimeType);
    notify({ state: "error", title: MESSAGES.voiceErrorTitle, message: MESSAGES.unknownKind });
    return { ok: false, message: MESSAGES.unknownKind };
  }

  return { handleRecording };
}

module.exports = { createFlowbaseRecordingShortcut, MESSAGES };
