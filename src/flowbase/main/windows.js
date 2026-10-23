// Die zwei Fenster von „Flowbase Stimme“. Beide laden src/index.html:
//   Hauptfenster (ohne Query) = Flowbase-Bildschirm.
//   Aufnahme-Fenster (?pill=1) = kleine Pille, rahmenlos, immer oben, nimmt nie den Fokus
//   (sonst landet der eingefügte Text im falschen Feld).

const path = require("path");
const { app, BrowserWindow, screen } = require("electron");
const { DEV_SERVER_URL } = require("../../helpers/devServerManager");

const ROOT = path.join(__dirname, "..", "..", "..");
const PRELOAD = path.join(ROOT, "preload.js");
const PILL_SIZE = { width: 280, height: 72 };
const PILL_BOTTOM_GAP = 24;

// Im Paket liegen die Icons per extraResources unter resourcesPath/src/assets (nicht im asar).
function iconPath({ isPackaged, resourcesPath, platform }) {
  const base = isPackaged ? resourcesPath : ROOT;
  return path.join(base, "src", "assets", platform === "win32" ? "icon.ico" : "icon.png");
}

function windowIcon() {
  return iconPath({
    isPackaged: Boolean(app && app.isPackaged),
    resourcesPath: process.resourcesPath,
    platform: process.platform,
  });
}

const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function lockDown(win) {
  // Keine Popups, keine Navigation weg von der App.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
}

async function loadApp(win, query) {
  if (process.env.NODE_ENV === "development") {
    const search = new URLSearchParams(query).toString();
    await win.loadURL(search ? `${DEV_SERVER_URL}?${search}` : DEV_SERVER_URL);
    return;
  }
  await win.loadFile(path.join(ROOT, "src", "dist", "index.html"), { query });
}

function createMainWindow({ show }) {
  const win = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Flowbase Stimme",
    icon: windowIcon(),
    autoHideMenuBar: true,
    webPreferences,
  });
  lockDown(win);
  if (show) win.once("ready-to-show", () => win.show());
  return win;
}

function createPillWindow() {
  const win = new BrowserWindow({
    ...PILL_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: { ...webPreferences, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockDown(win);
  return win;
}

// Unten mittig auf dem Bildschirm, auf dem gerade die Maus ist.
function showPill(win) {
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  win.setPosition(
    Math.round(area.x + (area.width - PILL_SIZE.width) / 2),
    Math.round(area.y + area.height - PILL_SIZE.height - PILL_BOTTOM_GAP)
  );
  win.showInactive();
}

function showMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

module.exports = { createMainWindow, createPillWindow, loadApp, showPill, showMainWindow, iconPath, windowIcon, ROOT };
