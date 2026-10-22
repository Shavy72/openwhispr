// Reine Umrechnung Tastendruck → Electron-Accelerator und Accelerator → Anzeige.
// Keine DOM-Abhängigkeit: bekommt nur die Felder eines KeyboardEvent.

export interface KeyInfo {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type CaptureResult =
  | { kind: "cancel" } // Esc: Aufnahme abbrechen, nichts ändern
  | { kind: "clear" } // Entf/Backspace: Kürzel ausschalten
  | { kind: "pending" } // nur Modifier gedrückt, auf Haupttaste warten
  | { kind: "invalid"; error: string }
  | { kind: "accelerator"; accelerator: string };

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

const NAMED_CODES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
  Delete: "Delete",
  Backspace: "Backspace",
};

/** Haupttaste aus `code` (layout-unabhängig), sonst null. */
function mainKey(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `num${m[1]}`;
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (m) return `F${m[1]}`;
  return NAMED_CODES[code] ?? null;
}

export function eventToAccelerator(e: KeyInfo): CaptureResult {
  const hasModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  if (MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  if (!hasModifier) {
    if (e.key === "Escape") return { kind: "cancel" };
    if (e.key === "Delete" || e.key === "Backspace") return { kind: "clear" };
  }
  const key = mainKey(e.code);
  if (!key) return { kind: "invalid", error: "Diese Taste wird nicht unterstützt." };
  const isFKey = /^F\d+$/.test(key);
  // Ein globales Kürzel ohne Modifier würde normales Tippen kapern.
  if (!hasModifier && !isFKey) {
    return { kind: "invalid", error: "Bitte mit Strg, Alt oder Shift kombinieren." };
  }
  if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isFKey) {
    return { kind: "invalid", error: "Nur Shift reicht nicht – bitte Strg oder Alt dazunehmen." };
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(key);
  return { kind: "accelerator", accelerator: parts.join("+") };
}

const LABELS: Record<string, string> = {
  control: "Strg",
  ctrl: "Strg",
  commandorcontrol: "Strg",
  cmdorctrl: "Strg",
  alt: "Alt",
  option: "Alt",
  altgr: "AltGr",
  shift: "Shift",
  super: "Win",
  meta: "Win",
  space: "Leertaste",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  delete: "Entf",
  backspace: "Rück",
  insert: "Einfg",
  home: "Pos1",
  end: "Ende",
  pageup: "Bild ↑",
  pagedown: "Bild ↓",
  plus: "+",
};

/** Accelerator → Tasten-Chips, z. B. "Control+Alt+B" → ["Strg", "Alt", "B"]. "" → []. */
export function acceleratorParts(accelerator: string): string[] {
  if (!accelerator) return [];
  // "+" als Taste steht in Electron als "Plus"; ein literales "+" am Ende abfangen.
  const raw = accelerator.endsWith("++")
    ? [...accelerator.slice(0, -2).split("+"), "+"]
    : accelerator.split("+");
  return raw
    .filter((p) => p !== "")
    .map((p) => {
      const lower = p.toLowerCase();
      if (LABELS[lower]) return LABELS[lower];
      const num = /^num(\d)$/.exec(lower);
      if (num) return `Num ${num[1]}`;
      return p.length === 1 ? p.toUpperCase() : p;
    });
}

/** Accelerator → Anzeige-Label, z. B. "Control+Alt+B" → "Strg + Alt + B". "" → "Aus". */
export function acceleratorLabel(accelerator: string): string {
  const parts = acceleratorParts(accelerator);
  return parts.length ? parts.join(" + ") : "Aus";
}
