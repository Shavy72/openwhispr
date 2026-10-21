/**
 * Flowbase-Tür des Main-Prozesses.
 *
 * Versteckt Basis-URL, verschlüsselten Sitzungs-Speicher (Tokens + aktives
 * Model), Token-Refresh und die Übersetzung von Server-Fehlern in deutsche
 * Klartexte. Aufrufer sehen nur:
 *   login, logout, getSession, listModels, setActiveModel, getActiveModel,
 *   makeVoiceMessage(text) → { ok: true, filePath } | { ok: false, message }
 *   makeVoiceMessageFromAudio(audio, mimeType) → { ok: true, filePath } | { ok: false, message }
 *   transcribeAudio(audio, mimeType) → { ok: true, text } | { ok: false, message }
 *
 * Alle HTTP-Calls laufen hier im Main-Prozess (CORS: der Renderer darf
 * Flowbase nicht direkt rufen). Abhängigkeiten sind über
 * createFlowbaseClient(deps) injizierbar, damit Tests gegen einen lokalen
 * HTTP-Server laufen können.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const FLOWBASE_BASE_URL = "https://flowbase.team";
const MAX_TEXT_LENGTH = 1000;
const REQUEST_TIMEOUT_MS = 60000;

const MESSAGES = {
  offline: "Flowbase nicht erreichbar.",
  notLoggedIn: "Nicht bei Flowbase angemeldet.",
  sessionExpired: "Anmeldung abgelaufen. Bitte neu anmelden.",
  badCredentials: "E-Mail oder Passwort falsch.",
  missingCredentials: "Bitte E-Mail und Passwort eingeben.",
  loginRateLimited: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
  noModel: "Kein Model aktiv. Bitte in den Einstellungen ein Model wählen.",
  emptyText: "Kein Text zum Vertonen.",
  textTooLong: `Text zu lang (höchstens ${MAX_TEXT_LENGTH} Zeichen).`,
  textOrModelMissing: "Text oder Model fehlt.",
  notAssigned: "Dieses Model ist dir nicht zugewiesen.",
  noVoice: "Für dieses Model ist noch keine Stimme hinterlegt.",
  dailyLimit: "Tageslimit erreicht (200 Sprachnachrichten). Morgen geht's weiter.",
  serverError: "Flowbase hat einen Fehler gemeldet. Bitte später erneut versuchen.",
  emptyAudio: "Flowbase hat keine Audiodatei geliefert.",
  saveFailed: "Sprachnachricht konnte nicht gespeichert werden.",
  modelsFailed: "Model-Liste konnte nicht geladen werden.",
  sessionSaveFailed: "Anmeldung konnte nicht gespeichert werden.",
  logoutFailed: "Abmelden fehlgeschlagen. Bitte App neu starten und erneut versuchen.",
  emptyRecording: "Keine Aufnahme vorhanden.",
  emptyTranscript: "Flowbase hat keinen Text erkannt.",
};

function defaultTempDir() {
  return path.join(os.tmpdir(), "openwhispr-voice");
}

function defaultDeps() {
  // Lazy: electron/debugLogger erst beim echten App-Start laden.
  const { app } = require("electron");
  return {
    fetch: globalThis.fetch,
    baseUrl: process.env.FLOWBASE_URL || FLOWBASE_BASE_URL,
    sessionFile: path.join(app.getPath("userData"), "flowbase-session.bin"),
    tempDir: defaultTempDir(),
    crypto: require("./secretCrypto"),
    logger: require("./debugLogger"),
  };
}

function createFlowbaseClient(overrides = {}) {
  // Tests liefern fetch/sessionFile/tempDir selbst; nur die echte App braucht electron.
  const needsDefaults = !["fetch", "sessionFile", "tempDir"].every((key) => key in overrides);
  const deps = { ...(needsDefaults ? defaultDeps() : {}), ...overrides };
  const baseUrl = String(deps.baseUrl || FLOWBASE_BASE_URL).replace(/\/+$/, "");
  const logger = deps.logger || { error() {}, warn() {} };
  let session = null; // { accessToken, refreshToken, user, activeModelId }
  let loaded = false;
  let refreshing = null;

  // ── Speicher ────────────────────────────────────────────────
  function readSession() {
    if (loaded) return session;
    loaded = true;
    try {
      if (!fs.existsSync(deps.sessionFile)) return (session = null);
      const buf = fs.readFileSync(deps.sessionFile);
      let json;
      if (deps.crypto?.isAvailable()) {
        const { value, needsReencrypt } = deps.crypto.decrypt(buf);
        json = value;
        if (needsReencrypt && json) persist(JSON.parse(json));
      } else {
        json = buf.toString("utf8");
      }
      session = json ? JSON.parse(json) : null;
    } catch (err) {
      logger.error("flowbaseClient: Sitzung nicht lesbar", { error: err?.message });
      session = null;
    }
    return session;
  }

  function persist(next) {
    const encrypted = Boolean(deps.crypto?.isAvailable());
    // Ohne Verschlüsselung landen nie Tokens im Klartext auf der Platte: nur das
    // aktive Model wird gespeichert, die Anmeldung lebt dann nur im Speicher.
    const stored = encrypted
      ? next
      : next?.activeModelId
        ? { activeModelId: next.activeModelId }
        : null;
    if (!stored) {
      fs.rmSync(deps.sessionFile, { force: true });
      return;
    }
    const json = JSON.stringify(stored);
    const data = encrypted ? deps.crypto.encrypt(json) : Buffer.from(json, "utf8");
    fs.mkdirSync(path.dirname(deps.sessionFile), { recursive: true });
    fs.writeFileSync(deps.sessionFile, data, { mode: 0o600 });
  }

  function saveSession(next) {
    persist(next);
    session = next;
    loaded = true;
  }

  function clearTokens() {
    const current = readSession();
    // Aktives Model bleibt für den nächsten Login erhalten.
    const next = current?.activeModelId ? { activeModelId: current.activeModelId } : null;
    try {
      if (next) persist(next);
      else fs.rmSync(deps.sessionFile, { force: true });
    } catch (err) {
      logger.error("flowbaseClient: Sitzung nicht löschbar", { error: err?.message });
      session = next;
      loaded = true;
      return false;
    }
    session = next;
    loaded = true;
    return true;
  }

  // ── HTTP ────────────────────────────────────────────────────
  async function request(method, route, { body, token } = {}) {
    const headers = {};
    // FormData (Aufnahme-Upload) setzt Content-Type samt boundary selbst.
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await deps.fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: body === undefined || isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn("flowbaseClient: Netzwerkfehler", { route, error: err?.message });
      return null;
    }
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  /**
   * Ergebnis: true = erneuert · false = von Flowbase abgelehnt (401/403, Tokens
   * gelöscht) · null = Flowbase gerade nicht nutzbar (offline, 5xx, 429, leere
   * Antwort) → Sitzung bleibt erhalten.
   */
  async function refreshTokens() {
    if (!refreshing) {
      refreshing = (async () => {
        const current = readSession();
        if (!current?.refreshToken) {
          clearTokens();
          return false;
        }
        const res = await request("POST", "/api/auth/refresh", {
          body: { refreshToken: current.refreshToken },
        });
        if (!res) return null; // offline: Sitzung behalten
        if (res.status === 401 || res.status === 403) {
          clearTokens();
          return false;
        }
        if (!res.ok) {
          logger.warn("flowbaseClient: Refresh fehlgeschlagen", { status: res.status });
          return null;
        }
        const data = await readJson(res);
        if (!data.accessToken) return null;
        const next = {
          ...current,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken || current.refreshToken,
        };
        try {
          saveSession(next);
        } catch (err) {
          // Neue Tokens trotzdem nutzen; der alte Refresh-Token ist serverseitig verbraucht.
          logger.error("flowbaseClient: Sitzung nicht speicherbar", { error: err?.message });
          session = next;
        }
        return true;
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  /**
   * Authentifizierter Call mit genau einem Refresh-Versuch bei TOKEN_EXPIRED.
   * Ergebnis: { res } | { message }.
   */
  async function authed(method, route, body) {
    const current = readSession();
    if (!current?.accessToken) return { message: MESSAGES.notLoggedIn };
    let res = await request(method, route, { body, token: current.accessToken });
    if (!res) return { message: MESSAGES.offline };
    if (res.status === 401) {
      const data = await readJson(res.clone());
      if (data.code !== "TOKEN_EXPIRED") {
        clearTokens();
        return { message: MESSAGES.sessionExpired };
      }
      const refreshed = await refreshTokens();
      if (refreshed === null) return { message: MESSAGES.offline };
      if (!refreshed) return { message: MESSAGES.sessionExpired };
      res = await request(method, route, { body, token: readSession().accessToken });
      if (!res) return { message: MESSAGES.offline };
      if (res.status === 401) {
        clearTokens();
        return { message: MESSAGES.sessionExpired };
      }
    }
    return { res };
  }

  async function errorMessage(res) {
    const data = await readJson(res);
    switch (res.status) {
      case 400:
        // Flowbase meldet Validierungsfehler bereits auf Deutsch.
        return data.error ? String(data.error) : MESSAGES.textOrModelMissing;
      case 403:
        return MESSAGES.notAssigned;
      case 404:
        return MESSAGES.noVoice;
      case 429:
        return MESSAGES.dailyLimit;
      default:
        logger.warn("flowbaseClient: Serverfehler", { status: res.status, error: data.error });
        // 502/503 (Stimm-Dienst) kommen als deutscher Klartext.
        return res.status >= 500 && data.error ? String(data.error) : MESSAGES.serverError;
    }
  }

  function publicUser(user) {
    if (!user) return null;
    return { name: user.name || "", email: user.email || "", role: user.role || "" };
  }

  // ── Schnittstelle ───────────────────────────────────────────
  async function login(email, password) {
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return { ok: false, message: MESSAGES.missingCredentials };
    }
    const res = await request("POST", "/api/auth/login", {
      body: { email: email.trim(), password },
    });
    if (!res) return { ok: false, message: MESSAGES.offline };
    const data = await readJson(res);
    if (!res.ok) {
      if (res.status === 400) return { ok: false, message: MESSAGES.missingCredentials };
      if (res.status === 401) return { ok: false, message: MESSAGES.badCredentials };
      if (res.status === 429) return { ok: false, message: MESSAGES.loginRateLimited };
      // 403 liefert Flowbase bereits als deutschen Klartext.
      if (res.status === 403 && data.error) return { ok: false, message: String(data.error) };
      return { ok: false, message: MESSAGES.serverError };
    }
    if (!data.accessToken || !data.refreshToken) {
      return { ok: false, message: MESSAGES.serverError };
    }
    const previous = readSession();
    const user = publicUser(data.user);
    try {
      saveSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user,
        activeModelId: previous?.activeModelId || null,
      });
    } catch (err) {
      logger.error("flowbaseClient: Sitzung nicht speicherbar", { error: err?.message });
      return { ok: false, message: MESSAGES.sessionSaveFailed };
    }
    return { ok: true, user };
  }

  async function logout() {
    // Wie ein abgelaufener Login: Tokens weg, aktives Model bleibt. Bleibt die Datei
    // liegen, käme die Anmeldung beim nächsten Start zurück — das wird gemeldet.
    if (!clearTokens()) return { ok: false, message: MESSAGES.logoutFailed };
    return { ok: true };
  }

  function getSession() {
    const current = readSession();
    if (!current?.accessToken) return { loggedIn: false };
    return {
      loggedIn: true,
      user: publicUser(current.user),
      activeModelId: current.activeModelId || null,
    };
  }

  async function listModels() {
    const mine = await authed("GET", "/api/team/my-models");
    if (mine.message) return { ok: false, message: mine.message };
    if (!mine.res.ok) return { ok: false, message: MESSAGES.modelsFailed };
    const data = await readJson(mine.res);
    if (Array.isArray(data.models)) return { ok: true, models: normalizeModels(data.models) };
    if (data.models === null && data.isAdmin) {
      // Admin: Flowbase liefert keine Zuweisung, sondern "alle" → aktive Models.
      const all = await authed("GET", "/api/team/models");
      if (all.message) return { ok: false, message: all.message };
      if (!all.res.ok) return { ok: false, message: MESSAGES.modelsFailed };
      const allData = await readJson(all.res);
      return { ok: true, models: normalizeModels(allData.models) };
    }
    return { ok: true, models: [] };
  }

  function normalizeModels(models) {
    if (!Array.isArray(models)) return [];
    return models
      .filter((m) => m && typeof m.id === "string" && m.id)
      .map((m) => ({ id: m.id, name: String(m.name || m.id) }));
  }

  async function setActiveModel(modelId) {
    const id = typeof modelId === "string" && modelId ? modelId : null;
    const current = readSession() || {};
    try {
      saveSession({ ...current, activeModelId: id });
    } catch (err) {
      logger.error("flowbaseClient: Model nicht speicherbar", { error: err?.message });
      return { ok: false, message: MESSAGES.sessionSaveFailed };
    }
    return { ok: true };
  }

  function getActiveModel() {
    return readSession()?.activeModelId || null;
  }

  async function makeVoiceMessage(text) {
    const clean = typeof text === "string" ? text.trim() : "";
    if (!clean) return { ok: false, message: MESSAGES.emptyText };
    if (clean.length > MAX_TEXT_LENGTH) return { ok: false, message: MESSAGES.textTooLong };
    if (!readSession()?.accessToken) return { ok: false, message: MESSAGES.notLoggedIn };
    const modelId = getActiveModel();
    if (!modelId) return { ok: false, message: MESSAGES.noModel };

    return saveMp3(await authed("POST", "/api/voice-message", { text: clean, modelId }));
  }

  // Aufnahme → multipart { audio, modelId } wie von Flowbase erwartet.
  function audioForm(audio, mimeType, modelId) {
    const type =
      typeof mimeType === "string" && mimeType.startsWith("audio/")
        ? mimeType.split(";")[0].trim()
        : "audio/webm";
    const form = new FormData();
    form.append("audio", new Blob([audio], { type }), `aufnahme.${type.slice(6) || "webm"}`);
    form.append("modelId", modelId);
    return form;
  }

  // Gemeinsame Vorprüfung der Aufnahme-Wege: Aufnahme da, angemeldet, Model aktiv.
  function recordingPrecheck(audio) {
    if (!audio || !audio.length) return { ok: false, message: MESSAGES.emptyRecording };
    if (!readSession()?.accessToken) return { ok: false, message: MESSAGES.notLoggedIn };
    const modelId = getActiveModel();
    if (!modelId) return { ok: false, message: MESSAGES.noModel };
    return { ok: true, modelId };
  }

  // Kürzel C: Aufnahme → MP3 in der Stimme des aktiven Models.
  async function makeVoiceMessageFromAudio(audio, mimeType) {
    const check = recordingPrecheck(audio);
    if (!check.ok) return check;
    return saveMp3(
      await authed("POST", "/api/voice-message", audioForm(audio, mimeType, check.modelId))
    );
  }

  // Kürzel A: Aufnahme → Text (Flowbase-Tür „mach Text“).
  async function transcribeAudio(audio, mimeType) {
    const check = recordingPrecheck(audio);
    if (!check.ok) return check;
    const result = await authed(
      "POST",
      "/api/voice-text",
      audioForm(audio, mimeType, check.modelId)
    );
    if (result.message) return { ok: false, message: result.message };
    if (!result.res.ok) return { ok: false, message: await errorMessage(result.res) };
    const data = await readJson(result.res);
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return { ok: false, message: MESSAGES.emptyTranscript };
    return { ok: true, text };
  }

  // Antwort von /api/voice-message → MP3 im Temp-Ordner.
  async function saveMp3(result) {
    if (result.message) return { ok: false, message: result.message };
    if (!result.res.ok) return { ok: false, message: await errorMessage(result.res) };

    let audio;
    try {
      audio = Buffer.from(await result.res.arrayBuffer());
    } catch (err) {
      logger.warn("flowbaseClient: Audio-Download abgebrochen", { error: err?.message });
      return { ok: false, message: MESSAGES.offline };
    }
    if (!audio.length) return { ok: false, message: MESSAGES.emptyAudio };

    try {
      fs.mkdirSync(deps.tempDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = path.join(
        deps.tempDir,
        `sprachnachricht-${stamp}-${crypto.randomBytes(3).toString("hex")}.mp3`
      );
      fs.writeFileSync(filePath, audio);
      return { ok: true, filePath };
    } catch (err) {
      logger.error("flowbaseClient: MP3 nicht speicherbar", { error: err?.message });
      return { ok: false, message: MESSAGES.saveFailed };
    }
  }

  return {
    login,
    logout,
    getSession,
    listModels,
    setActiveModel,
    getActiveModel,
    makeVoiceMessage,
    makeVoiceMessageFromAudio,
    transcribeAudio,
  };
}

/** Löscht alte Temp-MP3s (beim App-Start). Fehler sind nur Wartung. */
function cleanupTempVoiceFiles(dir = defaultTempDir()) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

let instance = null;
function client() {
  if (!instance) instance = createFlowbaseClient();
  return instance;
}

module.exports = {
  FLOWBASE_BASE_URL,
  MAX_TEXT_LENGTH,
  createFlowbaseClient,
  cleanupTempVoiceFiles,
  login: (email, password) => client().login(email, password),
  logout: () => client().logout(),
  getSession: () => client().getSession(),
  listModels: () => client().listModels(),
  setActiveModel: (modelId) => client().setActiveModel(modelId),
  getActiveModel: () => client().getActiveModel(),
  makeVoiceMessage: (text) => client().makeVoiceMessage(text),
  makeVoiceMessageFromAudio: (audio, mimeType) =>
    client().makeVoiceMessageFromAudio(audio, mimeType),
  transcribeAudio: (audio, mimeType) => client().transcribeAudio(audio, mimeType),
};
