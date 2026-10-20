const assert = require("node:assert/strict");
const test = require("node:test");
const { createVoiceMessageShortcut, MESSAGES } = require("../../src/helpers/voiceMessageShortcut");

function setup({
  fieldText = "Hallo Schatz",
  result = { ok: true, filePath: "C:/tmp/a.mp3" },
} = {}) {
  const calls = [];
  const statuses = [];
  let releaseVoice;
  const shortcut = createVoiceMessageShortcut({
    readFieldText: async () => {
      calls.push("read");
      return fieldText;
    },
    clearField: async () => {
      calls.push("clear");
    },
    pasteFile: async (filePath) => {
      calls.push(`paste:${filePath}`);
    },
    makeVoiceMessage: async (text) => {
      calls.push(`make:${text}`);
      if (result === "hold" && !releaseVoice) {
        return new Promise((resolve) => {
          releaseVoice = resolve;
        });
      }
      return result;
    },
    notify: (status) => statuses.push(status),
  });
  return { shortcut, calls, statuses, release: (r) => releaseVoice(r) };
}

test("Erfolg: lesen → erzeugen → Feld leeren vor Datei einfügen", async () => {
  const { shortcut, calls, statuses } = setup();
  await shortcut.run();
  assert.deepEqual(calls, ["read", "make:Hallo Schatz", "clear", "paste:C:/tmp/a.mp3"]);
  assert.deepEqual(
    statuses.map((s) => s.state),
    ["working", "done"]
  );
  assert.equal(statuses[0].message, MESSAGES.working);
});

test("leeres Feld: Meldung, keine Sprachnachricht", async () => {
  const { shortcut, calls, statuses } = setup({ fieldText: "   " });
  await shortcut.run();
  assert.deepEqual(calls, ["read"]);
  assert.deepEqual(statuses, [{ state: "error", message: "Kein Text im Feld." }]);
});

test("Fehler von Flowbase: Text bleibt, Meldung wird durchgereicht", async () => {
  const { shortcut, calls, statuses } = setup({
    result: { ok: false, message: "Kein aktives Model gewählt." },
  });
  await shortcut.run();
  assert.ok(!calls.includes("clear"));
  assert.ok(!calls.some((c) => c.startsWith("paste:")));
  assert.deepEqual(statuses.at(-1), { state: "error", message: "Kein aktives Model gewählt." });
});

test("Doppelauslösung während eines Laufs wird ignoriert", async () => {
  const { shortcut, calls, statuses, release } = setup({ result: "hold" });
  const first = shortcut.run();
  await new Promise((resolve) => setImmediate(resolve));
  await shortcut.run();
  release({ ok: true, filePath: "C:/tmp/b.mp3" });
  await first;
  assert.equal(calls.filter((c) => c === "read").length, 1);
  assert.equal(statuses.at(-1).state, "done");

  await shortcut.run();
  assert.equal(calls.filter((c) => c === "read").length, 2);
});
