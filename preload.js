// Einzige Renderer-Schnittstelle: window.flowbase (Vertrag src/flowbase/bridge.d.ts).
// Kanalnamen gespiegelt aus src/flowbase/main/ipc.js (CHANNELS) — preload läuft
// gesandboxt und kann keine lokalen Module laden.

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel) {
  return (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("flowbase", {
  getSession: invoke("flowbase:get-session"),
  login: invoke("flowbase:login"),
  logout: invoke("flowbase:logout"),
  listModels: invoke("flowbase:list-models"),
  setActiveModel: invoke("flowbase:set-active-model"),

  getShortcuts: invoke("flowbase:get-shortcuts"),
  setShortcut: invoke("flowbase:set-shortcut"),

  getAppInfo: invoke("flowbase:get-app-info"),
  setAutostart: invoke("flowbase:set-autostart"),

  onStatus: subscribe("flowbase:status"),

  onRecordingToggle: subscribe("flowbase:recording-toggle"),
  submitRecording: invoke("flowbase:submit-recording"),
});
