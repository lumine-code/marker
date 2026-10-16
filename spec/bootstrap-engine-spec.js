const path = require("node:path");
const { createRequire } = require("node:module");

describe("marker engine module identity", () => {
  let pack;
  const currentRequire = () => createRequire(path.join(pack.path, "package.json"));

  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("marker")) await lumine.packages.unloadPackage("marker");
    pack = await lumine.packages.activatePackage("marker");
  });

  afterEach(async () => {
    await lumine.packages.unloadPackage("marker");
  });

  it("registers and attaches the synchronous engine without loading compatibility modules", async () => {
    for (const name of ["cursors", "layer"]) {
      const filename = path.join(pack.path, "lib", `${name}.js`);
      expect(Object.values(require.cache).some((entry) => entry?.filename === filename)).toBe(
        false,
      );
    }
    const service = pack.mainModule.provideMarkerRegistry();
    expect(service).toBe(pack.mainModule.provideMarkerRegistry());
    expect(service.providers().some((provider) => provider.name === "cursors")).toBe(true);
    const editor = await lumine.workspace.open();
    const handle = service.attach(editor);
    const engine = currentRequire()("./lib/registry");
    const legacy = currentRequire()("./lib/layer");
    expect(handle.set instanceof legacy.LayerSet).toBe(true);
    expect(handle.layerFor("cursors") instanceof legacy.Layer).toBe(true);
    expect(legacy.LayerSet).toBe(engine.LayerSet);
    expect(Object.keys(legacy)).toEqual(["DEFAULT_TIMER", "Layer", "LayerSet"]);
    expect(Object.keys(engine)).toEqual(["AttachHandle", "Registry"]);
    handle.dispose();
    editor.destroy();
  });

  for (const helper of ["cursors", "layer"]) {
    it(`shares the engine when ${helper} is required before the package main module`, async () => {
      await lumine.packages.unloadPackage("marker");
      const early = currentRequire()(`./lib/${helper}`);
      pack = await lumine.packages.activatePackage("marker");
      const engine = currentRequire()("./lib/registry");
      for (const [name, value] of Object.entries(early)) expect(engine[name]).toBe(value);
      expect(pack.mainModule.cursors instanceof engine.Cursors).toBe(true);
      expect(pack.mainModule.registry instanceof engine.Registry).toBe(true);
    });
  }

  it("retires the old service and reacquires every constructor after unload and reload", async () => {
    const old = currentRequire()("./lib/registry");
    const service = pack.mainModule.provideMarkerRegistry();
    await lumine.packages.unloadPackage("marker");
    expect(service.providers()).toEqual([]);
    pack = await lumine.packages.activatePackage("marker");
    const fresh = currentRequire()("./lib/registry");
    for (const name of ["Registry", "Cursors", "Layer", "LayerSet"])
      expect(fresh[name]).not.toBe(old[name]);
    expect(currentRequire()("./lib/cursors").Cursors).toBe(fresh.Cursors);
    expect(currentRequire()("./lib/layer").LayerSet).toBe(fresh.LayerSet);
    expect(pack.mainModule.cursors instanceof fresh.Cursors).toBe(true);
    expect(pack.mainModule.registry instanceof fresh.Registry).toBe(true);
  });
});
