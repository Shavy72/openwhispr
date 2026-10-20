const assert = require("node:assert/strict");
const test = require("node:test");
const { installBrowserGlobals } = require("../lib/rendererTestHarness");

// Every signed-out "sign in" entry point used to reset onboarding progress (#2128), and
// re-walking the wizard rewrote the provider setup the user had configured. Signing in now
// only drops the guest flag, which is what sends AppRouter to the reauthentication screen
// instead of the wizard.

const PROMPTED_AT_KEY = "signInPromptedAt";
const GUEST_ON_OWN_SETUP = {
  onboardingCompleted: "true",
  authenticationSkipped: "true",
  skipAuth: "true",
  transcriptionMode: "local",
  useLocalWhisper: "true",
  cloudTranscriptionMode: "byok",
  cloudTranscriptionProvider: "groq",
  cloudTranscriptionModel: "whisper-large-v3-turbo",
  remoteTranscriptionUrl: "http://192.168.1.4:8000/v1",
  whisperModel: "base",
};

async function signIn(t, settings = {}) {
  let reloads = 0;
  const { storage } = installBrowserGlobals(t, {
    initialStorage: { ...GUEST_ON_OWN_SETUP, ...settings },
    window: {
      location: {
        reload() {
          reloads += 1;
        },
      },
    },
  });
  const { requestSignIn } = await import("../../src/utils/requestSignIn.ts");
  requestSignIn();
  return { storage, reloads: () => reloads };
}

test(
  "signing in logs the guest out instead of restarting onboarding",
  { skip: "Flowbase-Fork #72: Upstream-Login durch Flowbase-Konto ersetzt" },
  async (t) => {
    const { storage, reloads } = await signIn(t);

    // Onboarding stays finished and no wizard state is written, so the reload lands on
    // AppRouter's reauthentication branch: completed, signed out, no guest flag.
    assert.equal(storage.getItem("authenticationSkipped"), null);
    assert.equal(storage.getItem("skipAuth"), null);
    assert.equal(storage.getItem("onboardingCompleted"), "true");
    assert.equal(storage.getItem("onboardingSessionV2"), null);
    assert.equal(storage.getItem("onboardingCurrentStep"), null);
    assert.equal(storage.getItem("localSetupPending"), null);
    assert.equal(reloads(), 1);
  }
);

test(
  "signing in switches nothing the user configured",
  { skip: "Flowbase-Fork #72: Upstream-Login durch Flowbase-Konto ersetzt" },
  async (t) => {
    const { storage } = await signIn(t);

    // A post-sign-in cloud switch is what overrode Local for #2086.
    assert.equal(storage.getItem("transcriptionMode"), "local");
    assert.equal(storage.getItem("useLocalWhisper"), "true");
    assert.equal(storage.getItem("cloudTranscriptionMode"), "byok");
    assert.equal(storage.getItem("cloudTranscriptionProvider"), "groq");
    assert.equal(storage.getItem("cloudTranscriptionModel"), "whisper-large-v3-turbo");
    assert.equal(storage.getItem("remoteTranscriptionUrl"), "http://192.168.1.4:8000/v1");
    assert.equal(storage.getItem("whisperModel"), "base");
    assert.equal(storage.getItem("pendingCloudMigration"), null);
  }
);

test(
  "the Cloud nudge marker survives the reload the sign-in goes through",
  { skip: "Flowbase-Fork #72: Upstream-Login durch Flowbase-Konto ersetzt" },
  async (t) => {
    const before = Date.now();
    const { storage } = await signIn(t);

    const promptedAt = Number(storage.getItem(PROMPTED_AT_KEY));
    assert.ok(promptedAt >= before && promptedAt <= Date.now());
  }
);

// Flowbase-Fork #72: Anmelden öffnet nur das Flowbase-Konto. Kein Reload, keine
// Änderung an Onboarding, Gast-Flags oder Transkriptions-Einstellungen.
test("Flowbase-Fork: sign-in opens the Flowbase account and touches no stored state", async (t) => {
  const events = [];
  let reloads = 0;
  const { storage } = installBrowserGlobals(t, {
    initialStorage: { ...GUEST_ON_OWN_SETUP },
    window: {
      location: {
        reload() {
          reloads += 1;
        },
      },
      dispatchEvent(event) {
        events.push(event.type);
        return true;
      },
    },
  });
  const { requestSignIn, FLOWBASE_ACCOUNT_REQUEST_EVENT } =
    await import("../../src/utils/requestSignIn.ts");
  requestSignIn();

  assert.deepEqual(events, [FLOWBASE_ACCOUNT_REQUEST_EVENT]);
  assert.equal(reloads, 0);
  for (const [key, value] of Object.entries(GUEST_ON_OWN_SETUP)) {
    assert.equal(storage.getItem(key), value);
  }
});
