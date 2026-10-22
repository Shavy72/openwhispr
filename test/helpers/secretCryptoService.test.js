const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const Module = require("module");

// Fake keyring records every service the app opens, so we can prove the
// OpenWhispr entry is never touched.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "fb-secret-crypto-"));
const opened = [];
const store = new Map();
class FakeEntry {
  constructor(service, account) {
    opened.push(service);
    this.id = `${service}/${account}`;
  }
  getPassword() {
    return store.get(this.id) ?? null;
  }
  setPassword(value) {
    store.set(this.id, value);
  }
}
const fakeElectron = {
  app: { getPath: () => tmpUserData },
  safeStorage: { isEncryptionAvailable: () => false },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return fakeElectron;
  if (request === "@napi-rs/keyring") return { Entry: FakeEntry };
  return origLoad.call(this, request, ...rest);
};

const secretCrypto = require("../../src/helpers/secretCrypto");

test("Schlüsselbund nutzt nur den eigenen Dienst „Flowbase Stimme“", () => {
  store.set("OpenWhispr/secrets-master-key", Buffer.alloc(32, 7).toString("base64"));
  assert.equal(secretCrypto.isAvailable(), true);
  assert.deepEqual(opened, ["Flowbase Stimme"]);
  assert.ok(store.has("Flowbase Stimme/secrets-master-key"));
  const enc = secretCrypto.encrypt("geheim");
  assert.equal(secretCrypto.decrypt(enc).value, "geheim");
});
