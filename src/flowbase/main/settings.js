// Einstellungen von „Flowbase Stimme“ als JSON in userData/settings.json.
// Nur Kürzel und ob der Autostart schon einmal eingerichtet wurde.

const fs = require("fs");
const path = require("path");

const SLOTS = ["A", "B", "C"];
const DEFAULT_SHORTCUTS = { A: "Control+Alt+A", B: "Control+Alt+B", C: "Control+Alt+C" };

function defaults() {
  return { shortcuts: { ...DEFAULT_SHORTCUTS }, autostartInitialized: false };
}

// Unbekanntes/kaputtes wird verworfen, fehlende Werte kommen aus den Defaults.
function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== "object") return base;
  const shortcuts = raw.shortcuts && typeof raw.shortcuts === "object" ? raw.shortcuts : {};
  for (const slot of SLOTS) {
    if (typeof shortcuts[slot] === "string") base.shortcuts[slot] = shortcuts[slot];
  }
  base.autostartInitialized = raw.autostartInitialized === true;
  return base;
}

function createSettingsStore({ file, logger = console }) {
  let data = null;

  function load() {
    try {
      data = normalize(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logger.warn?.("Flowbase settings unreadable, using defaults", { error: error?.message });
      }
      data = defaults();
    }
    return data;
  }

  function get() {
    return data || load();
  }

  // Atomar schreiben (tmp + rename), damit ein Absturz keine halbe Datei hinterlässt.
  function update(patch) {
    const next = normalize({ ...get(), ...patch });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    data = next;
    return data;
  }

  return { load, get, update };
}

module.exports = { SLOTS, DEFAULT_SHORTCUTS, createSettingsStore, normalize };
