const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createFlowbaseClient, cleanupTempVoiceFiles } = require("../../src/helpers/flowbaseClient");

const MP3 = Buffer.from("ID3\u0003fake-mp3-bytes");

// Lokaler Server mit den dokumentierten Flowbase-Antworten.
function startServer(state) {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const auth = req.headers.authorization || "";
      const json = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      state.calls.push(`${req.method} ${req.url}`);
      if (req.url === "/api/auth/login") {
        if (body.password !== "richtig") return json(401, { error: "Invalid credentials" });
        return json(200, {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          user: { id: "u1", email: body.email, name: "Chatter Eins", role: state.role },
        });
      }
      if (req.url === "/api/auth/refresh") {
        if (state.refreshStatus) return json(state.refreshStatus, state.refreshBody ?? {});
        if (body.refreshToken !== "refresh-1") return json(401, { error: "Invalid refresh token" });
        if (!state.freezeAccess) state.access = "access-2";
        return json(200, { accessToken: "access-2", refreshToken: "refresh-2" });
      }
      if (auth !== `Bearer ${state.access}`) {
        if (state.plain401) return json(401, { error: "Invalid token" });
        return json(401, { error: "Token expired", code: "TOKEN_EXPIRED" });
      }
      if (req.url === "/api/team/my-models") {
        if (state.role === "admin") return json(200, { models: null, isAdmin: true });
        return json(200, { models: [{ id: "rec1", name: "Lena" }] });
      }
      if (req.url === "/api/team/models") {
        return json(200, {
          models: [
            { id: "rec1", name: "Lena" },
            { id: "rec2", name: "Mia" },
          ],
        });
      }
      if (req.url === "/api/voice-message") {
        if (state.voiceStatus !== 200) {
          return json(state.voiceStatus, state.voiceBody ?? { error: "x" });
        }
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(state.voiceEmpty ? Buffer.alloc(0) : MP3);
      }
      json(404, { error: "Not found" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Reversible Test-Verschlüsselung (XOR): echte secretCrypto braucht Electron/Keychain.
const FAKE_CRYPTO = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(Buffer.from(text, "utf8").map((b) => b ^ 0x5a)),
  decrypt: (buf) => ({
    value: Buffer.from(buf.map((b) => b ^ 0x5a)).toString("utf8"),
    needsReencrypt: false,
  }),
};

async function setup(t, { role = "chatter", crypto = FAKE_CRYPTO } = {}) {
  const state = { calls: [], role, access: "access-1", voiceStatus: 200 };
  const server = await startServer(state);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowbase-client-"));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const deps = {
    fetch: globalThis.fetch,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sessionFile: path.join(dir, "flowbase-session.bin"),
    tempDir: path.join(dir, "voice"),
    crypto,
  };
  return { state, deps, dir, client: createFlowbaseClient(deps) };
}

test("login, Model wählen, Sprachnachricht als MP3", async (t) => {
  const { client, deps } = await setup(t);
  assert.deepEqual(client.getSession(), { loggedIn: false });
  const bad = await client.login("a@b.de", "falsch");
  assert.deepEqual(bad, { ok: false, message: "E-Mail oder Passwort falsch." });

  const ok = await client.login("a@b.de", "richtig");
  assert.deepEqual(ok, {
    ok: true,
    user: { name: "Chatter Eins", email: "a@b.de", role: "chatter" },
  });
  assert.deepEqual(await client.listModels(), { ok: true, models: [{ id: "rec1", name: "Lena" }] });

  const noModel = await client.makeVoiceMessage("Hallo");
  assert.equal(noModel.ok, false);
  assert.match(noModel.message, /Kein Model aktiv/);

  assert.deepEqual(await client.setActiveModel("rec1"), { ok: true });
  const voice = await client.makeVoiceMessage("Hallo du");
  assert.equal(voice.ok, true);
  assert.ok(voice.filePath.startsWith(deps.tempDir));
  assert.deepEqual(fs.readFileSync(voice.filePath), MP3);

  // Neustart: neue Instanz liest Sitzung + aktives Model aus der Datei.
  const restarted = createFlowbaseClient(deps);
  assert.equal(restarted.getActiveModel(), "rec1");
  assert.equal(restarted.getSession().loggedIn, true);

  assert.equal(cleanupTempVoiceFiles(deps.tempDir), true);
  assert.equal(fs.existsSync(deps.tempDir), false);
});

test("abgelaufener Access-Token wird genau einmal erneuert", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  state.access = "access-neu"; // Server akzeptiert access-1 nicht mehr
  const res = await client.listModels();
  assert.equal(res.ok, true);
  assert.deepEqual(state.calls.slice(-3), [
    "GET /api/team/my-models",
    "POST /api/auth/refresh",
    "GET /api/team/my-models",
  ]);
});

test("Admin bekommt alle Models", async (t) => {
  const { client } = await setup(t, { role: "admin" });
  await client.login("chef@b.de", "richtig");
  const res = await client.listModels();
  assert.deepEqual(
    res.models.map((m) => m.id),
    ["rec1", "rec2"]
  );
});

test("Chatter bekommt nur zugewiesene Models, nie die Gesamtliste", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  const res = await client.listModels();
  assert.deepEqual(
    res.models.map((m) => m.id),
    ["rec1"]
  );
  assert.equal(state.calls.includes("GET /api/team/models"), false);
});

test("Server-Fehler werden zu deutschen Klartexten", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  const cases = {
    403: "Dieses Model ist dir nicht zugewiesen.",
    404: "Für dieses Model ist noch keine Stimme hinterlegt.",
    429: "Tageslimit erreicht (200 Sprachnachrichten). Morgen geht's weiter.",
  };
  for (const [status, message] of Object.entries(cases)) {
    state.voiceStatus = Number(status);
    assert.deepEqual(await client.makeVoiceMessage("Hallo"), { ok: false, message });
  }
  assert.match((await client.makeVoiceMessage("x".repeat(1001))).message, /zu lang/);
});

test("Flowbase nicht erreichbar", async (t) => {
  const { deps } = await setup(t);
  const client = createFlowbaseClient({ ...deps, baseUrl: "http://127.0.0.1:1" });
  assert.deepEqual(await client.login("a@b.de", "richtig"), {
    ok: false,
    message: "Flowbase nicht erreichbar.",
  });
});

test("logout löscht die Sitzung", async (t) => {
  const { client, deps } = await setup(t);
  await client.login("a@b.de", "richtig");
  assert.deepEqual(await client.logout(), { ok: true });
  assert.equal(fs.existsSync(deps.sessionFile), false);
  assert.deepEqual(createFlowbaseClient(deps).getSession(), { loggedIn: false });
});

test("logout behält das aktive Model, die Anmeldung kommt nach Neustart nicht zurück", async (t) => {
  const { client, deps } = await setup(t);
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  assert.deepEqual(await client.logout(), { ok: true });
  const restarted = createFlowbaseClient(deps);
  assert.deepEqual(restarted.getSession(), { loggedIn: false });
  assert.equal(restarted.getActiveModel(), "rec1");
});

test("logout meldet Fehler, wenn die Sitzungsdatei nicht überschreibbar ist", async (t) => {
  const { client, deps } = await setup(t);
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  fs.rmSync(deps.sessionFile, { force: true });
  fs.mkdirSync(deps.sessionFile);
  const result = await client.logout();
  assert.equal(result.ok, false);
  assert.match(result.message, /Abmelden fehlgeschlagen/);
  assert.equal(client.getSession().loggedIn, false);
});

const EXPIRED = "Anmeldung abgelaufen. Bitte neu anmelden.";
const OFFLINE = "Flowbase nicht erreichbar.";

for (const status of [401, 403]) {
  test(`Refresh abgelehnt (${status}) → abgemeldet, aktives Model bleibt`, async (t) => {
    const { client, state } = await setup(t);
    await client.login("a@b.de", "richtig");
    await client.setActiveModel("rec1");
    state.access = "access-neu";
    state.refreshStatus = status;
    assert.deepEqual(await client.listModels(), { ok: false, message: EXPIRED });
    assert.equal(client.getSession().loggedIn, false);
    assert.equal(client.getActiveModel(), "rec1");
  });
}

test("401 ohne TOKEN_EXPIRED → abgemeldet ohne Refresh", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  state.access = "access-neu";
  state.plain401 = true;
  assert.deepEqual(await client.listModels(), { ok: false, message: EXPIRED });
  assert.equal(client.getSession().loggedIn, false);
  assert.equal(state.calls.includes("POST /api/auth/refresh"), false);
});

test("erneutes 401 nach erfolgreichem Refresh → abgemeldet", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  state.access = "access-neu";
  state.freezeAccess = true;
  assert.deepEqual(await client.listModels(), { ok: false, message: EXPIRED });
  assert.equal(client.getSession().loggedIn, false);
  assert.equal(state.calls.filter((c) => c === "POST /api/auth/refresh").length, 1);
});

for (const [label, status, body] of [
  ["502", 502, { error: "Bad Gateway" }],
  ["429", 429, {}],
  ["200 ohne Token", 200, {}],
]) {
  test(`Refresh-Server ${label} → Sitzung bleibt, Meldung offline`, async (t) => {
    const { client, state, deps } = await setup(t);
    await client.login("a@b.de", "richtig");
    state.access = "access-neu";
    state.refreshStatus = status;
    state.refreshBody = body;
    assert.deepEqual(await client.listModels(), { ok: false, message: OFFLINE });
    assert.equal(client.getSession().loggedIn, true);
    assert.equal(createFlowbaseClient(deps).getSession().loggedIn, true);
  });
}

test("ohne Verschlüsselung: keine Tokens auf der Platte, Model bleibt", async (t) => {
  const { client, deps } = await setup(t, { crypto: { isAvailable: () => false } });
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  assert.equal(client.getSession().loggedIn, true);
  const stored = JSON.parse(fs.readFileSync(deps.sessionFile, "utf8"));
  assert.deepEqual(stored, { activeModelId: "rec1" });
  const restarted = createFlowbaseClient(deps);
  assert.equal(restarted.getSession().loggedIn, false);
  assert.equal(restarted.getActiveModel(), "rec1");
});

test("mit Verschlüsselung: Datei nicht lesbar, Neustart stellt Sitzung her", async (t) => {
  const { client, deps } = await setup(t);
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  const raw = fs.readFileSync(deps.sessionFile);
  assert.throws(() => JSON.parse(raw.toString("utf8")));
  assert.equal(raw.toString("utf8").includes("access-1"), false);
  const restarted = createFlowbaseClient(deps);
  assert.equal(restarted.getSession().loggedIn, true);
  assert.equal(restarted.getActiveModel(), "rec1");
});

test("weitere Server-Fehler und leere MP3", async (t) => {
  const { client, state } = await setup(t);
  await client.login("a@b.de", "richtig");
  await client.setActiveModel("rec1");
  const cases = [
    [400, { error: "Text fehlt." }, "Text fehlt."],
    [400, {}, "Text oder Model fehlt."],
    [502, { error: "Stimm-Dienst nicht erreichbar." }, "Stimm-Dienst nicht erreichbar."],
    [502, {}, "Flowbase hat einen Fehler gemeldet. Bitte später erneut versuchen."],
    [500, {}, "Flowbase hat einen Fehler gemeldet. Bitte später erneut versuchen."],
  ];
  for (const [status, body, message] of cases) {
    state.voiceStatus = status;
    state.voiceBody = body;
    assert.deepEqual(await client.makeVoiceMessage("Hallo"), { ok: false, message });
  }
  state.voiceStatus = 200;
  state.voiceEmpty = true;
  assert.deepEqual(await client.makeVoiceMessage("Hallo"), {
    ok: false,
    message: "Flowbase hat keine Audiodatei geliefert.",
  });
});

test("zwei parallele Aufrufe mit abgelaufenem Token → genau ein Refresh", async (t) => {
  const { client, state, deps } = await setup(t);
  await client.login("a@b.de", "richtig");
  state.access = "access-neu";
  const [a, b] = await Promise.all([client.listModels(), client.listModels()]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(state.calls.filter((c) => c === "POST /api/auth/refresh").length, 1);
  const stored = JSON.parse(FAKE_CRYPTO.decrypt(fs.readFileSync(deps.sessionFile)).value);
  assert.equal(stored.refreshToken, "refresh-2");
  assert.equal(stored.accessToken, "access-2");
});
