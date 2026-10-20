// Live-Check gegen echtes Flowbase: Login → Models → Sprachnachricht als MP3.
// Aufruf: FLOWBASE_TEST_EMAIL=… FLOWBASE_TEST_PASSWORD=… [FLOWBASE_URL=…]
//         [FLOWBASE_TEST_MODEL_ID=…] node scripts/flowbase-live-check.mjs <ausgabe.mp3>
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createFlowbaseClient, FLOWBASE_BASE_URL } = require("../src/helpers/flowbaseClient.js");

const email = process.env.FLOWBASE_TEST_EMAIL;
const password = process.env.FLOWBASE_TEST_PASSWORD;
const outFile = process.argv[2];
if (!email || !password || !outFile) {
  console.error(
    "Benutzung: FLOWBASE_TEST_EMAIL/FLOWBASE_TEST_PASSWORD setzen, Ausgabe-MP3-Pfad als Argument."
  );
  process.exit(2);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "flowbase-live-"));
const client = createFlowbaseClient({
  fetch: globalThis.fetch,
  baseUrl: process.env.FLOWBASE_URL || FLOWBASE_BASE_URL,
  sessionFile: path.join(workDir, "flowbase-session.bin"),
  tempDir: path.join(workDir, "voice"),
  crypto: { isAvailable: () => false },
});

function fail(step, message) {
  console.error(`FEHLER bei ${step}: ${message}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
}

try {
  const login = await client.login(email, password);
  if (!login.ok) fail("Login", login.message);
  console.log(`Login ok: ${login.user.name} (${login.user.role})`);

  const list = await client.listModels();
  if (!list.ok) fail("Model-Liste", list.message);
  console.log(`Models: ${list.models.length} (${list.models.map((m) => m.name).join(", ")})`);

  const modelId = process.env.FLOWBASE_TEST_MODEL_ID || list.models[0]?.id;
  if (!modelId) fail("Model-Wahl", "kein Model zugewiesen");
  await client.setActiveModel(modelId);

  const voice = await client.makeVoiceMessage("Hallo, das ist ein kurzer Test.");
  if (!voice.ok) fail("Sprachnachricht", voice.message);
  fs.copyFileSync(voice.filePath, path.resolve(outFile));
  console.log(`MP3 ok: ${path.resolve(outFile)} (${fs.statSync(outFile).size} Bytes)`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
