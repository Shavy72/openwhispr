// Kürzel A (Aufnahme → Text) und C (Aufnahme → Sprachnachricht).
// Externes nur aus echten Aufzeichnungen (test/fixtures/flowbase, aus dem
// Flowbase-Server-Repo: ElevenLabs-Mitschnitte vom 2026-10-20). Der lokale
// Server zerlegt multipart wie die echten Flowbase-Türen (Response.formData).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createFlowbaseClient } = require("../../src/helpers/flowbaseClient");
const {
  createFlowbaseRecordingShortcut,
  MESSAGES,
} = require("../../src/helpers/flowbaseRecordingShortcut");

const FIXTURES = path.join(__dirname, "..", "fixtures", "flowbase");
const HALLO_MP3 = fs.readFileSync(path.join(FIXTURES, "tts-hallo.mp3"));
const HALLO_STT = JSON.parse(fs.readFileSync(path.join(FIXTURES, "stt-hallo.json"), "utf8")).body;
const STS_INPUT = fs.readFileSync(path.join(FIXTURES, "sts-input.mp3"));
const STS_LOLA = fs.readFileSync(path.join(FIXTURES, "sts-lola.mp3"));

function startServer(state) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const json = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      state.calls.push(`${req.method} ${req.url}`);
      if (req.url === "/api/auth/login") {
        return json(200, {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          user: { id: "u1", email: "a@b.de", name: "Chatter Eins", role: "chatter" },
        });
      }
      if (req.url === "/api/auth/refresh") {
        state.access = "access-2";
        return json(200, { accessToken: "access-2", refreshToken: "refresh-2" });
      }
      if (req.headers.authorization !== `Bearer ${state.access}`) {
        return json(401, { error: "Token expired", code: "TOKEN_EXPIRED" });
      }
      let form;
      try {
        form = await new Response(raw, {
          headers: { "content-type": req.headers["content-type"] || "" },
        }).formData();
      } catch {
        return json(400, { error: "Aufnahme fehlt (multipart mit Feld „audio“ erwartet)" });
      }
      const file = form.get("audio");
      state.uploads.push({
        url: req.url,
        modelId: form.get("modelId"),
        type: file.type,
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
      if (state.status) return json(state.status, state.body ?? {});
      if (req.url === "/api/voice-text") {
        return json(200, {
          text: HALLO_STT.text,
          languageCode: HALLO_STT.language_code,
          languageProbability: HALLO_STT.language_probability,
        });
      }
      if (req.url === "/api/voice-message") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(STS_LOLA);
      }
      json(404, { error: "Not found" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const FAKE_CRYPTO = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((b) => b ^ 0x5a)),
  decrypt: (buf) => ({
    value: Buffer.from(buf.map((b) => b ^ 0x5a)).toString("utf8"),
    needsReencrypt: false,
  }),
};

async function setup(t, { login = true, model = "rec1" } = {}) {
  const state = { calls: [], uploads: [], access: "access-1" };
  const server = await startServer(state);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowbase-recording-"));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const deps = {
    fetch: globalThis.fetch,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sessionFile: path.join(dir, "flowbase-session.bin"),
    tempDir: path.join(dir, "voice"),
    crypto: FAKE_CRYPTO,
  };
  const client = createFlowbaseClient(deps);
  if (login) assert.equal((await client.login("a@b.de", "richtig")).ok, true);
  if (model) await client.setActiveModel(model);
  return { state, deps, client };
}

test("Kürzel A: echte Aufnahme → /api/voice-text mit audio + modelId → Text", async (t) => {
  const { client, state } = await setup(t);
  const result = await client.transcribeAudio(HALLO_MP3, "audio/mpeg");
  assert.deepEqual(result, { ok: true, text: "Hallo, wie geht's dir?" });
  assert.equal(state.uploads.length, 1);
  const up = state.uploads[0];
  assert.equal(up.url, "/api/voice-text");
  assert.equal(up.modelId, "rec1");
  assert.equal(up.type, "audio/mpeg");
  assert.equal(up.name, "aufnahme.mpeg");
  assert.deepEqual(up.bytes, HALLO_MP3);
});

test("Kürzel C: echte Aufnahme → /api/voice-message → MP3 der Model-Stimme", async (t) => {
  const { client, state, deps } = await setup(t);
  // MediaRecorder liefert "audio/webm;codecs=opus" – der codecs-Zusatz fliegt raus.
  const result = await client.makeVoiceMessageFromAudio(STS_INPUT, "audio/webm;codecs=opus");
  assert.equal(result.ok, true);
  assert.ok(result.filePath.startsWith(deps.tempDir));
  assert.deepEqual(fs.readFileSync(result.filePath), STS_LOLA);
  const up = state.uploads[0];
  assert.equal(up.url, "/api/voice-message");
  assert.equal(up.modelId, "rec1");
  assert.equal(up.type, "audio/webm");
  assert.equal(up.name, "aufnahme.webm");
  assert.deepEqual(up.bytes, STS_INPUT);
});

test("abgelaufener Token: Aufnahme wird nach Refresh vollständig erneut gesendet", async (t) => {
  const { client, state } = await setup(t);
  state.access = "access-neu"; // Server akzeptiert access-1 nicht mehr → Refresh
  const result = await client.transcribeAudio(HALLO_MP3, "audio/mpeg");
  assert.equal(result.ok, true);
  assert.deepEqual(state.calls.slice(-2), ["POST /api/auth/refresh", "POST /api/voice-text"]);
  assert.deepEqual(state.uploads.at(-1).bytes, HALLO_MP3);
});

test("Vorprüfungen: leere Aufnahme, kein Model, nicht angemeldet – ohne Upload", async (t) => {
  const { client, state } = await setup(t, { model: null });
  assert.deepEqual(await client.transcribeAudio(Buffer.alloc(0), "audio/webm"), {
    ok: false,
    message: "Keine Aufnahme vorhanden.",
  });
  const noModel = await client.makeVoiceMessageFromAudio(STS_INPUT, "audio/webm");
  assert.match(noModel.message, /Kein Model aktiv/);
  await client.logout();
  const loggedOut = await client.transcribeAudio(HALLO_MP3, "audio/mpeg");
  assert.equal(loggedOut.message, "Nicht bei Flowbase angemeldet.");
  assert.equal(state.uploads.length, 0);
});

test("Server-Fehler und leerer Text werden deutsche Klartexte", async (t) => {
  const { client, state } = await setup(t);
  state.status = 400;
  state.body = { error: "Aufnahme ist zu groß (höchstens 10 MB)" };
  assert.deepEqual(await client.makeVoiceMessageFromAudio(STS_INPUT, "audio/webm"), {
    ok: false,
    message: "Aufnahme ist zu groß (höchstens 10 MB)",
  });
  state.status = 403;
  assert.match((await client.transcribeAudio(HALLO_MP3, "audio/mpeg")).message, /nicht zugewiesen/);
  state.status = 200;
  state.body = { text: "  " };
  assert.deepEqual(await client.transcribeAudio(HALLO_MP3, "audio/mpeg"), {
    ok: false,
    message: "Flowbase hat keinen Text erkannt.",
  });
});

// Ablauf-Logik des Kürzels (reine Reihenfolge/Meldungen, Flowbase-Wege als Attrappe).
function shortcutSetup({ text, voice, pasteThrows = false } = {}) {
  const calls = [];
  const statuses = [];
  const shortcut = createFlowbaseRecordingShortcut({
    transcribeAudio: async (audio, mime) => {
      calls.push(`text:${audio.length}:${mime}`);
      if (text instanceof Error) throw text;
      return text ?? { ok: true, text: "Hallo" };
    },
    makeVoiceMessageFromAudio: async (audio, mime) => {
      calls.push(`voice:${audio.length}:${mime}`);
      return voice ?? { ok: true, filePath: "/tmp/a.mp3" };
    },
    pasteFile: async (filePath) => {
      calls.push(`paste:${filePath}`);
      if (pasteThrows) throw new Error("xdotool fehlt");
    },
    notify: (s) => statuses.push(s),
  });
  return { shortcut, calls, statuses };
}

test("Ablauf A: Text zurück an den Renderer, nur Arbeits-Hinweis wird geschlossen", async () => {
  const { shortcut, calls, statuses } = shortcutSetup();
  const result = await shortcut.handleRecording("text", Buffer.from("abc"), "audio/webm");
  assert.deepEqual(result, { ok: true, text: "Hallo" });
  assert.deepEqual(calls, ["text:3:audio/webm"]);
  assert.deepEqual(
    statuses.map((s) => s.state),
    ["working", "idle"]
  );
});

test("Ablauf C: erzeugen → einfügen → fertig, Feld wird nicht geleert", async () => {
  const { shortcut, calls, statuses } = shortcutSetup();
  assert.deepEqual(await shortcut.handleRecording("voice", Buffer.from("ab"), "audio/webm"), {
    ok: true,
  });
  assert.deepEqual(calls, ["voice:2:audio/webm", "paste:/tmp/a.mp3"]);
  assert.deepEqual(statuses.at(-1), { state: "done", message: MESSAGES.voiceDone });
});

test("Fehler werden als deutscher Toast mit passendem Titel gemeldet", async () => {
  let s = shortcutSetup({ voice: { ok: false, message: "Tageslimit erreicht." } });
  await s.shortcut.handleRecording("voice", Buffer.from("a"), "audio/webm");
  assert.deepEqual(s.statuses.at(-1), {
    state: "error",
    title: "Sprachnachricht fehlgeschlagen",
    message: "Tageslimit erreicht.",
  });
  assert.ok(!s.calls.some((c) => c.startsWith("paste")));

  s = shortcutSetup({ pasteThrows: true });
  assert.equal((await s.shortcut.handleRecording("voice", Buffer.from("a"), "")).ok, false);
  assert.equal(s.statuses.at(-1).message, MESSAGES.pasteFailed);

  s = shortcutSetup({ text: new Error("boom") });
  assert.deepEqual(await s.shortcut.handleRecording("text", Buffer.from("a"), ""), {
    ok: false,
    message: "Text konnte nicht erstellt werden.",
  });
  assert.equal(s.statuses.at(-1).title, "Diktat fehlgeschlagen");

  s = shortcutSetup();
  assert.equal((await s.shortcut.handleRecording("x", Buffer.from("a"), "")).ok, false);
  assert.equal(s.statuses.at(-1).message, "Unbekanntes Kürzel.");
});
