# Flowbase Stimme

Desktop-App (Electron) für das Flowbase-Team. Sie verbindet sich mit dem eigenen Flowbase-Konto und
legt drei Tastenkürzel an:

- **A – Diktat:** sprechen, Flowbase schreibt den Text, die App fügt ihn ins aktive Feld ein.
- **B – Feldtext → Sprachnachricht:** markierter Text wird mit der Stimme des gewählten Models zur MP3
  und eingefügt.
- **C – Sprechen → Sprachnachricht:** eigene Aufnahme wird in die Stimme des Models umgewandelt und als
  MP3 eingefügt.

Dazu: Login/Logout, Model-Wahl, Status-Meldungen, Selbst-Update über GitHub-Releases, Autostart, Tray.

## Aufbau

- `main.js` – Start des Hauptprozesses, Tray, Fenster
- `preload.js` – einzige Renderer-Schnittstelle `window.flowbase` (Vertrag: `src/flowbase/bridge.d.ts`)
- `src/flowbase/main/` – Identität, Einstellungen, Kürzel, IPC, Fenster
- `src/flowbase/ui/` – Flowbase-Bildschirm und Aufnahme-Pille
- `src/helpers/` – Flowbase-Client, Einfügen (Zwischenablage), Autostart, Logging
- `src/updater.js` – Selbst-Update

## Bauen

Node ≥ 24.

```bash
npm install
npm test                 # alle Tests
npm run build:renderer   # Oberfläche nach src/dist
npm start                # App lokal starten
npm run build:win        # Windows-Installer (lädt vorher nircmd + windows-fast-paste)
npm run build:linux:appimage
```

## Lizenz

MIT, siehe `LICENSE` (abgeleitet von OpenWhispr).
