// „Flowbase Stimme“ — schlanker Main-Prozess.
// Ablauf: Identität → Single-Instance-Lock → whenReady → Settings → Fenster →
// Kürzel → Tray → Update-Check → Autostart. Einzige Renderer-Schnittstelle ist
// window.flowbase (preload.js, Vertrag src/flowbase/bridge.d.ts).

const path = require("path");
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage } = require("electron");
const { applyIdentity } = require("./src/flowbase/main/identity");

// 1) Identität — vor jedem getPath("userData") und vor dem Lock.
applyIdentity(app, { isDev: process.env.NODE_ENV === "development" });

// 2) Single-Instance (hängt an userData → kein Konflikt mit OpenWhispr).
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  return;
}

// Chromiums Occlusion-Tracker drosselt sonst die transparente Pille unter Windows.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}
// Transparente Fenster unter Linux brauchen ein ARGB-Visual vor dem ersten Fenster.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-transparent-visuals");
}

const debugLogger = require("./src/helpers/debugLogger");
const flowbaseClient = require("./src/helpers/flowbaseClient");
const ClipboardManager = require("./src/helpers/clipboard");
const { createVoiceMessageShortcut } = require("./src/helpers/voiceMessageShortcut");
const { createFlowbaseRecordingShortcut } = require("./src/helpers/flowbaseRecordingShortcut");
const autoStart = require("./src/helpers/autoStart");
const UpdateManager = require("./src/updater");
const { createSettingsStore } = require("./src/flowbase/main/settings");
const { createShortcutController } = require("./src/flowbase/main/shortcuts");
const { registerIpc, CHANNELS } = require("./src/flowbase/main/ipc");
const windows = require("./src/flowbase/main/windows");

let mainWindow = null;
let pillWindow = null;
let tray = null;
let updateManager = null;
let shortcutController = null;
let isQuitting = false;

app.on("second-instance", () => windows.showMainWindow(mainWindow));

function sendToAll(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function isOwnWindow(sender) {
  return [mainWindow, pillWindow].some((win) => win && !win.isDestroyed() && win.webContents === sender);
}

function createTray() {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  let image = nativeImage.createFromPath(path.join(windows.ROOT, "src", "assets", iconFile));
  if (!image.isEmpty() && process.platform !== "win32") image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip("Flowbase Stimme");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Flowbase Stimme öffnen", click: () => windows.showMainWindow(mainWindow) },
      { type: "separator" },
      {
        label: "Beenden",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => windows.showMainWindow(mainWindow));
}

// Autostart: nach dem ersten Login einmalig an (wie #76), danach nur noch per Schalter.
function enableAutostartOnFirstLogin(settings) {
  if (!app.isPackaged || settings.get().autostartInitialized) return;
  try {
    autoStart.setAutoStartEnabled(true);
    settings.update({ autostartInitialized: true });
  } catch (error) {
    debugLogger.warn("Autostart could not be enabled", { error: error?.message });
  }
}

async function boot() {
  const settings = createSettingsStore({
    file: path.join(app.getPath("userData"), "settings.json"),
    logger: debugLogger,
  });
  settings.load();

  // Fenster: Hauptfenster sofort sichtbar (außer beim Autostart → Tray), Pille versteckt.
  const launchedHidden = autoStart.wasLaunchedAtLoginHidden();
  mainWindow = windows.createMainWindow({ show: !launchedHidden });
  mainWindow.on("close", (event) => {
    if (isQuitting || updateManager?.isQuittingForUpdate) return;
    event.preventDefault();
    mainWindow.hide();
  });
  pillWindow = windows.createPillWindow();

  const clipboard = new ClipboardManager();
  flowbaseClient.cleanupTempVoiceFiles();

  const voiceMessage = (notify) =>
    createVoiceMessageShortcut({
      readFieldText: () => clipboard.readFocusedFieldText(),
      clearField: () => clipboard.clearFocusedField(),
      pasteFile: (filePath) => clipboard.pasteFile(filePath),
      makeVoiceMessage: (text) => flowbaseClient.makeVoiceMessage(text),
      notify,
    }).run();

  const handleRecording = (kind, audio, mimeType, notify) =>
    createFlowbaseRecordingShortcut({
      transcribeAudio: (a, m) => flowbaseClient.transcribeAudio(a, m),
      makeVoiceMessageFromAudio: (a, m) => flowbaseClient.makeVoiceMessageFromAudio(a, m),
      pasteFile: (filePath) => clipboard.pasteFile(filePath),
      notify,
      logger: debugLogger,
    }).handleRecording(kind, audio, mimeType);

  shortcutController = createShortcutController({
    registerAccelerator: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    unregisterAccelerator: (accelerator) => globalShortcut.unregister(accelerator),
    shortcuts: settings.get().shortcuts,
    persistShortcuts: (shortcuts) => settings.update({ shortcuts }),
    runVoiceMessage: voiceMessage,
    handleRecording,
    pasteText: (text) => clipboard.pasteText(text),
    showPill: () => windows.showPill(pillWindow),
    hidePill: () => pillWindow && !pillWindow.isDestroyed() && pillWindow.hide(),
    sendToggle: (event) => {
      if (pillWindow && !pillWindow.isDestroyed()) {
        pillWindow.webContents.send(CHANNELS.recordingToggle, event);
      }
    },
    emitStatus: (status) => sendToAll(CHANNELS.status, status),
    logger: debugLogger,
  });

  registerIpc(ipcMain, {
    client: flowbaseClient,
    shortcuts: shortcutController,
    autostart: {
      get: () => autoStart.getAutoStartState().enabled,
      set: (on) => {
        autoStart.setAutoStartEnabled(on);
        settings.update({ autostartInitialized: true });
      },
    },
    getVersion: () => app.getVersion(),
    onLoggedIn: () => enableAutostartOnFirstLogin(settings),
    isOwnWindow,
    isPillWindow: (sender) => pillWindow && !pillWindow.isDestroyed() && pillWindow.webContents === sender,
    logger: debugLogger,
  });

  // Ladefehler (z. B. fehlendes src/dist) dürfen Kürzel und Tray nicht verhindern,
  // sonst ließe sich die App nicht mehr beenden.
  const load = (win, query) =>
    windows.loadApp(win, query).catch((error) => {
      debugLogger.error("Flowbase window load failed", { query, error: error?.message });
    });
  await Promise.all([load(mainWindow, {}), load(pillWindow, { pill: "1" })]);

  const failed = shortcutController.registerAll();
  if (failed.length) debugLogger.warn("Flowbase shortcuts not registered", { slots: failed });

  // Solange das Hauptfenster den Fokus hat, sind die Kürzel global abgemeldet —
  // sonst fängt Electron sie ab und die Kürzel-Belegung im Fenster bekommt sie nie.
  const resumeShortcuts = () => {
    const notRegistered = shortcutController.resume();
    if (notRegistered.length) {
      debugLogger.warn("Flowbase shortcuts not re-registered", { slots: notRegistered });
    }
  };
  mainWindow.on("focus", () => shortcutController.suspend());
  mainWindow.on("blur", resumeShortcuts);
  mainWindow.on("hide", resumeShortcuts);
  if (mainWindow.isFocused()) shortcutController.suspend();

  createTray();

  // Selbst-Update (Quelle Shavy72/openwhispr), für jede Installation automatisch an (#76).
  updateManager = new UpdateManager();
  updateManager.setWindowManager({ mainWindow, controlPanelWindow: null });
  updateManager.setAutoUpdatesEnabled(true);
  updateManager.checkForUpdatesOnStartup();

  try {
    if (app.isPackaged) autoStart.syncAutoStartEntry();
  } catch (error) {
    debugLogger.warn("Autostart entry sync failed", { error: error?.message });
  }

  debugLogger.info("Flowbase Stimme started", {
    version: app.getVersion(),
    userData: app.getPath("userData"),
  });
}

app.whenReady().then(() =>
  boot().catch((error) => {
    debugLogger.error("Flowbase Stimme boot failed", { error: error?.message, stack: error?.stack });
    console.error("Flowbase Stimme boot failed:", error);
  })
);

// Fenster schließen = Tray; die App läuft weiter, Beenden nur über den Tray.
app.on("window-all-closed", () => {});

app.on("activate", () => windows.showMainWindow(mainWindow));

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (updateManager) updateManager.cleanup();
});
