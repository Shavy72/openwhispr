const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { iconPath, ROOT } = require("../../../src/flowbase/main/windows");

test("iconPath: entpackt (Entwicklung) liegt unter ROOT/src/assets", () => {
  assert.equal(
    iconPath({ isPackaged: false, resourcesPath: "/res", platform: "linux" }),
    path.join(ROOT, "src", "assets", "icon.png")
  );
  assert.equal(
    iconPath({ isPackaged: false, resourcesPath: "/res", platform: "win32" }),
    path.join(ROOT, "src", "assets", "icon.ico")
  );
});

test("iconPath: gepackt liegt unter resourcesPath/src/assets (extraResources)", () => {
  assert.equal(
    iconPath({ isPackaged: true, resourcesPath: "/res", platform: "linux" }),
    path.join("/res", "src", "assets", "icon.png")
  );
  assert.equal(
    iconPath({ isPackaged: true, resourcesPath: "/res", platform: "win32" }),
    path.join("/res", "src", "assets", "icon.ico")
  );
});
