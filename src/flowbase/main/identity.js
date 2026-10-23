// Eigene Identität von „Flowbase Stimme“: Name, userData-Ordner, Windows-AppUserModelId.
// Muss vor jedem app.getPath("userData") und vor dem Single-Instance-Lock laufen,
// denn der Lock hängt am userData-Ordner. So kommt sich die App nie mit einem
// installierten OpenWhispr in die Quere (Config, Lock, Taskleiste).

const path = require("path");

const APP_NAME = "Flowbase Stimme";
const APP_USER_MODEL_ID = "com.flowbase.stimme";

// Reine Funktion (testbar ohne Electron).
function resolveIdentity({ appDataPath, isDev }) {
  const folder = isDev ? `${APP_NAME}-dev` : APP_NAME;
  return {
    name: APP_NAME,
    userDataPath: path.join(appDataPath, folder),
    appUserModelId: APP_USER_MODEL_ID,
  };
}

function applyIdentity(app, { platform = process.platform, isDev = false } = {}) {
  const identity = resolveIdentity({ appDataPath: app.getPath("appData"), isDev });
  app.setName(identity.name);
  app.setPath("userData", identity.userDataPath);
  if (platform === "win32") app.setAppUserModelId(identity.appUserModelId);
  return identity;
}

module.exports = { APP_NAME, APP_USER_MODEL_ID, resolveIdentity, applyIdentity };
