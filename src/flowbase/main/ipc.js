// IPC für window.flowbase (Vertrag: src/flowbase/bridge.d.ts).
// Jeder Handler antwortet; Fehler kommen als { ok:false, error:"<deutscher Text>" },
// nie als geworfene Exception über IPC.

const CHANNELS = {
  getSession: "flowbase:get-session",
  login: "flowbase:login",
  logout: "flowbase:logout",
  listModels: "flowbase:list-models",
  setActiveModel: "flowbase:set-active-model",
  getShortcuts: "flowbase:get-shortcuts",
  setShortcut: "flowbase:set-shortcut",
  getAppInfo: "flowbase:get-app-info",
  setAutostart: "flowbase:set-autostart",
  submitRecording: "flowbase:submit-recording",
  // Events Main → Renderer
  status: "flowbase:status",
  recordingToggle: "flowbase:recording-toggle",
};

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_LENGTH = 500;

const MESSAGES = {
  unexpected: "Unerwarteter Fehler. Bitte erneut versuchen.",
  invalidInput: "Ungültige Eingabe.",
  notAllowed: "Aktion aus diesem Fenster nicht erlaubt.",
  recordingTooLarge: "Aufnahme ist zu groß.",
  autostartFailed: "Autostart konnte nicht geändert werden.",
};

const isShortString = (value) => typeof value === "string" && value.length <= MAX_INPUT_LENGTH;

function toSession(raw) {
  if (!raw?.loggedIn) return { loggedIn: false };
  return {
    loggedIn: true,
    email: raw.user?.email || "",
    name: raw.user?.name || "",
    activeModelId: raw.activeModelId ?? null,
  };
}

// flowbaseClient liefert { ok:false, message } → Vertrag will { ok:false, error }.
function toResult(raw, pick = () => ({})) {
  if (raw?.ok) return { ok: true, ...pick(raw) };
  return { ok: false, error: raw?.message || MESSAGES.unexpected };
}

function toBuffer(audio) {
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (ArrayBuffer.isView(audio)) return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  return null;
}

// Baut die Handler als reine Funktionen (testbar ohne ipcMain).
//   client: flowbaseClient   shortcuts: createShortcutController()
//   autostart: { get() → boolean, set(on) }   onLoggedIn(): nach erfolgreichem Login
//   isPillWindow(sender): nur das Aufnahme-Fenster darf abgeben   logger
//   (isOwnWindow(sender) prüft registerIpc für alle Kanäle)
function createHandlers({
  client,
  shortcuts,
  autostart,
  getVersion,
  onLoggedIn,
  isPillWindow,
  logger,
}) {
  return {
    getSession: async () => toSession(await client.getSession()),

    login: async (_sender, email, password) => {
      if (!isShortString(email) || !isShortString(password)) {
        return { ok: false, error: MESSAGES.invalidInput };
      }
      const raw = await client.login(email.trim(), password);
      if (!raw?.ok) return toResult(raw);
      await onLoggedIn?.();
      return { ok: true, session: toSession(await client.getSession()) };
    },

    logout: async () => toResult(await client.logout()),

    listModels: async () => toResult(await client.listModels(), (r) => ({ models: r.models })),

    setActiveModel: async (_sender, modelId) => {
      if (!isShortString(modelId) || !modelId) return { ok: false, error: MESSAGES.invalidInput };
      return toResult(await client.setActiveModel(modelId));
    },

    getShortcuts: async () => shortcuts.getShortcuts(),

    setShortcut: async (_sender, slot, accelerator) => {
      if (!isShortString(slot) || !isShortString(accelerator)) {
        return { ok: false, error: MESSAGES.invalidInput };
      }
      return shortcuts.setShortcut(slot, accelerator);
    },

    getAppInfo: async () => {
      let on = false;
      try {
        on = autostart.get();
      } catch (error) {
        logger?.warn?.("Autostart state unreadable", { error: error?.message });
      }
      return { version: getVersion(), autostart: on };
    },

    setAutostart: async (_sender, on) => {
      if (typeof on !== "boolean") return { ok: false, error: MESSAGES.invalidInput };
      try {
        autostart.set(on);
        return { ok: true };
      } catch (error) {
        logger?.error?.("Autostart change failed", { error: error?.message });
        return { ok: false, error: MESSAGES.autostartFailed };
      }
    },

    submitRecording: async (sender, slot, audio, mimeType) => {
      if (!isPillWindow(sender)) return { ok: false, error: MESSAGES.notAllowed };
      const buffer = toBuffer(audio);
      if ((slot !== "A" && slot !== "C") || !buffer || !isShortString(mimeType)) {
        return { ok: false, error: MESSAGES.invalidInput };
      }
      if (buffer.length > MAX_RECORDING_BYTES) {
        return { ok: false, error: MESSAGES.recordingTooLarge };
      }
      return shortcuts.submitRecording(slot, buffer, mimeType);
    },
  };
}

function registerIpc(ipcMain, deps) {
  const handlers = createHandlers(deps);
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(CHANNELS[name], async (event, ...args) => {
      if (!deps.isOwnWindow(event.sender)) return { ok: false, error: MESSAGES.notAllowed };
      try {
        return await handler(event.sender, ...args);
      } catch (error) {
        deps.logger?.error?.(`IPC ${name} failed`, { error: error?.message });
        return { ok: false, error: MESSAGES.unexpected };
      }
    });
  }
  return handlers;
}

module.exports = { CHANNELS, MESSAGES, createHandlers, registerIpc, toSession };
