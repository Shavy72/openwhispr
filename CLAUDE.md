# Flowbase Stimme — Claude-Anweisungen

Desktop-App (Electron) für Flowbase-Chatter. Fork von OpenWhispr, auf den Flowbase-Kern reduziert
(Ticket Shavy72/FLOWBASE#80).

## Was die App kann
- Flowbase-Konto (Login/Logout), Model-Wahl
- Kürzel A: Diktat über Flowbase → Text einfügen
- Kürzel B: markierter Feldtext → Sprachnachricht (MP3) einfügen
- Kürzel C: Sprechen → Sprachnachricht (MP3) einfügen
- Selbst-Update aus Shavy72/openwhispr-Releases, Autostart, Tray

## Aufbau
- `main.js` — schlanker Boot (Identität → Lock → Fenster → Kürzel → Tray → Update)
- `src/flowbase/main/` — identity, settings, shortcuts, ipc, windows
- `preload.js` — exponiert genau `window.flowbase` (Vertrag: `src/flowbase/bridge.d.ts`)
- `src/flowbase/ui/` — Flowbase-Bildschirm + Aufnahme-Pille (`?pill=1`)
- `src/helpers/` — flowbaseClient, voiceMessageShortcut, flowbaseRecordingShortcut, clipboard, updater

## Regeln
- Nichts aus einer OpenWhispr-Installation lesen oder übernehmen (Config, Schlüsselbund, Autostart).
- Identität: productName „Flowbase Stimme“, appId `com.flowbase.stimme`, userData „Flowbase Stimme“.
- UI-Texte deutsch mit echten Umlauten.
- Tests: `node --import tsx --test "test/**/*.test.js"`
