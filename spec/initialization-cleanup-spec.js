describe("marker initialization cleanup", () => {
  let pack;

  beforeEach(async () => {
    if (lumine.packages.getLoadedPackage("marker"))
      await lumine.packages.unloadPackage("marker", { serialize: false });
    pack = lumine.packages.loadPackage("marker");
    pack.initializeForExternalUse("initialization cleanup spec");
    expect(pack.mainActivationStarted).toBe(false);
  });

  afterEach(async () => {
    if (lumine.packages.getLoadedPackage("marker"))
      await lumine.packages.unloadPackage("marker", { serialize: false });
  });

  it("deactivates before activation and can activate afterwards", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(pack.deactivate()).toBeResolved();
    expect(scope.disposed).toBe(true);
    const active = await lumine.packages.activatePackage("marker");
    expect(active.mainActivated).toBe(true);
    expect(active.lifecycleContext.subscriptions.disposed).toBe(false);
  });

  it("unloads an initialized main before activation", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(lumine.packages.unloadPackage("marker", { serialize: false })).toBeResolved();
    expect(scope.disposed).toBe(true);
    expect(lumine.packages.getLoadedPackage("marker")).toBeUndefined();
  });
});
