# Belege Ticket Shavy72/FLOWBASE#66 – Datei einfügen (Teil B: echte Klickwege)

Stand: 2026-10-20 · Fork-Stand 77779e4 · Start `npx electron .` (Entwicklungs-Kanal, eigenes userData, Davids installiertes OpenWhispr lief parallel weiter).

Auslösung in allen getesteten Zielen über das echte Test-Kürzel **Strg+Alt+Umschalt+M** (synthetische Tasten per `keybd_event`, kein Ersatzweg nötig). Vor jeder Eingabe wurde der Titel des Vordergrundfensters (`GetForegroundWindow`) geprüft.

## 1. Explorer-Ordner

- **Weg:** leerer Ordner `C:\dev\openwhispr-paste-test` im Explorer geöffnet, Fenster in den Vordergrund, Kürzel gedrückt.
- **Beobachtung:** `beispiel.mp3` (8376 Bytes, Typ MP3-Datei) liegt danach im Ordner – Explorer behandelt das Einfügen wie Kopieren/Einfügen einer Datei.
  Danach stand ein anderes Fenster (Chrome) im Vordergrund; Ursache nicht geklärt (nur Beobachtung).
- **Erster Versuch:** abgebrochen, weil das Fenster „Kontrollzentrum“ der frisch gestarteten App den Fokus genommen hatte (Fokus-Prüfung hat gegriffen).
- **Screenshot:** `docs/belege/ticket-66-explorer.png`
- Testordner danach gelöscht.

## 2. Browser-Textfeld (Chrome)

- **Weg:** lokale Testseite (`<textarea>`, `<input type=file>`, `paste`-Listener, der `clipboardData` ausgibt) im echten Chrome geöffnet, in das Textfeld geklickt, Kürzel gedrückt.
- **Beobachtung:** `paste`-Ereignis kommt an mit `types: ["Files"]`, `files: 1` → `beispiel.mp3 | audio/mpeg | 8376 Bytes`, `text/plain` leer. Das Textfeld bleibt leer (kein Pfad als Text). Die Seite bekommt die Datei also als echte Datei, eine Web-App mit Paste-Upload kann sie übernehmen.
- **Hinweis:** ohne vorherigen Klick ins Textfeld (Seite nur per Fenster-Fokus aktiv) kam kein `paste`-Ereignis an – das Ziel braucht einen echten Eingabe-Fokus.
- **Screenshot:** `docs/belege/ticket-66-browser.png`

## 3. OnlyMonster / OnlyFans-Chat

- **Nicht getestet.** Grund: Es gibt dort keinen eigenen Test- oder Leer-Chat; jeder Chat ist eine echte Fan-Unterhaltung eines Models. Einfügen einer Datei lädt sie dort sofort als Anhang hoch (Entwurf/Medien), das ist kein sicherer, folgenloser Weg. Gesendet oder eingefügt wurde nichts.
- Nachholen nur mit einem freigegebenen Test-Account oder Test-Chat.
