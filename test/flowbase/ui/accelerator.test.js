import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventToAccelerator,
  acceleratorLabel,
  acceleratorParts,
} from "../../../src/flowbase/ui/accelerator.ts";

const ev = (code, key, mods = {}) => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

test("Strg+Alt+Buchstabe wird zum Electron-Accelerator", () => {
  assert.deepEqual(eventToAccelerator(ev("KeyB", "b", { ctrlKey: true, altKey: true })), {
    kind: "accelerator",
    accelerator: "Control+Alt+B",
  });
});

test("Modifier-Reihenfolge ist fest: Control, Alt, Shift, Super", () => {
  const r = eventToAccelerator(
    ev("Digit1", "!", { shiftKey: true, metaKey: true, altKey: true, ctrlKey: true })
  );
  assert.deepEqual(r, { kind: "accelerator", accelerator: "Control+Alt+Shift+Super+1" });
});

test("Layout-unabhängig über code (deutsches Z/Y)", () => {
  assert.equal(
    eventToAccelerator(ev("KeyY", "z", { ctrlKey: true, altKey: true })).accelerator,
    "Control+Alt+Y"
  );
});

test("Sondertasten, Numpad und F-Tasten", () => {
  assert.equal(eventToAccelerator(ev("Space", " ", { altKey: true })).accelerator, "Alt+Space");
  assert.equal(eventToAccelerator(ev("ArrowUp", "ArrowUp", { ctrlKey: true })).accelerator, "Control+Up");
  assert.equal(eventToAccelerator(ev("Numpad5", "5", { ctrlKey: true })).accelerator, "Control+num5");
  assert.equal(eventToAccelerator(ev("F9", "F9")).accelerator, "F9");
  assert.equal(eventToAccelerator(ev("F5", "F5", { shiftKey: true })).accelerator, "Shift+F5");
});

test("Nur Modifier gedrückt → warten", () => {
  assert.deepEqual(eventToAccelerator(ev("ControlLeft", "Control", { ctrlKey: true })), {
    kind: "pending",
  });
});

test("Esc bricht ab, Entf/Backspace schaltet aus", () => {
  assert.deepEqual(eventToAccelerator(ev("Escape", "Escape")), { kind: "cancel" });
  assert.deepEqual(eventToAccelerator(ev("Delete", "Delete")), { kind: "clear" });
  assert.deepEqual(eventToAccelerator(ev("Backspace", "Backspace")), { kind: "clear" });
  // Mit Modifier sind es normale Tasten
  assert.equal(
    eventToAccelerator(ev("Delete", "Delete", { ctrlKey: true, altKey: true })).accelerator,
    "Control+Alt+Delete"
  );
});

test("Buchstabe ohne Modifier oder nur mit Shift ist ungültig", () => {
  assert.equal(eventToAccelerator(ev("KeyA", "a")).kind, "invalid");
  assert.equal(eventToAccelerator(ev("KeyA", "A", { shiftKey: true })).kind, "invalid");
  assert.equal(eventToAccelerator(ev("IntlBackslash", "<", { ctrlKey: true })).kind, "invalid");
});

test("Anzeige-Label auf Deutsch", () => {
  assert.equal(acceleratorLabel("Control+Alt+B"), "Strg + Alt + B");
  assert.equal(acceleratorLabel("CommandOrControl+Shift+Space"), "Strg + Shift + Leertaste");
  assert.equal(acceleratorLabel("Super+Delete"), "Win + Entf");
  assert.equal(acceleratorLabel("Control+num5"), "Strg + Num 5");
  assert.equal(acceleratorLabel(""), "Aus");
  assert.deepEqual(acceleratorParts("Control+Alt+a"), ["Strg", "Alt", "A"]);
  assert.deepEqual(acceleratorParts("Control++"), ["Strg", "+"]);
});

test("Rundlauf: erfasster Accelerator ergibt erwartetes Label", () => {
  const r = eventToAccelerator(ev("KeyC", "c", { ctrlKey: true, altKey: true }));
  assert.equal(acceleratorLabel(r.accelerator), "Strg + Alt + C");
});
