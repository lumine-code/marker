describe("marker registry", () => {
  let workspaceElement, mainModule, service;

  async function activate() {
    const pack = await atom.packages.activatePackage("marker");
    mainModule = pack.mainModule;
    service = mainModule.provideMarkerRegistry();
    return mainModule;
  }

  async function makeEditor() {
    const editor = await atom.workspace.open();
    editor.setText(Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"));
    return editor;
  }

  beforeEach(async () => {
    workspaceElement = atom.views.getView(atom.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);
    await activate();
  });

  describe("providers", () => {
    it("builds one layer per registered provider on attach", async () => {
      mainModule.consumeMarkerLayer({ name: "a", getItems: () => [{ row: 1 }] });
      mainModule.consumeMarkerLayer({ name: "b", getItems: () => [{ row: 2 }] });

      const handle = service.attach(await makeEditor());

      expect([...handle.layers()].map((layer) => layer.name)).toEqual(["a", "b"]);
      expect(service.providers().map((props) => props.name)).toEqual(["a", "b"]);
    });

    it("reaches every live editor with a provider registered after attach", async () => {
      const first = service.attach(await makeEditor());
      const second = service.attach(await makeEditor());

      mainModule.consumeMarkerLayer({ name: "late", getItems: () => [] });

      expect(first.layerFor("late")).toBeDefined();
      expect(second.layerFor("late")).toBeDefined();
    });

    // The loser of a name collision must not be able to unregister the winner --
    // disposing it used to take the registered layer with it.
    it("refuses a duplicate name with an inert disposable", async () => {
      spyOn(console, "warn");
      const handle = service.attach(await makeEditor());

      const first = mainModule.consumeMarkerLayer({ name: "dup", getItems: () => [{ row: 1 }] });
      const second = mainModule.consumeMarkerLayer({ name: "dup", getItems: () => [{ row: 5 }] });

      second.dispose();

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn.calls.argsFor(0)[0]).toMatch(/already registered/);
      expect(handle.layerFor("dup")).toBeDefined();
      expect(service.providers().length).toBe(1);

      first.dispose();
      expect(service.providers().length).toBe(0);
    });

    it("removes a disposed provider's layer from every editor and says so", async () => {
      const disposable = mainModule.consumeMarkerLayer({ name: "a", getItems: () => [] });
      const handle = service.attach(await makeEditor());
      const membership = jasmine.createSpy("membership");
      service.onDidChangeLayers(membership);

      disposable.dispose();

      expect(handle.layerFor("a")).toBeUndefined();
      expect(membership).toHaveBeenCalled();
    });
  });

  describe("layers", () => {
    it("computes items once and reports them to every subscriber", async () => {
      const getItems = jasmine.createSpy("getItems").and.returnValue([{ row: 2 }, { row: 1 }]);
      mainModule.consumeMarkerLayer({ name: "a", merge: true, getItems });
      const editor = await makeEditor();
      const first = service.attach(editor);
      const second = service.attach(editor);
      const changed = jasmine.createSpy("changed");
      service.onDidChangeItems(changed);

      first.update();
      advanceClock(30);

      expect(getItems).toHaveBeenCalledTimes(1);
      expect(first.layerFor("a").items).toEqual([{ row: 1, end: 2 }]);
      // Both handles read the very same layer, not a copy each.
      expect(second.layerFor("a")).toBe(first.layerFor("a"));
      expect(changed.calls.mostRecent().args[0].name).toBe("a");
    });

    // `null` means "nothing new to say", which is not the same as "no markers".
    it("keeps the previous items on a null return and clears on an empty array", async () => {
      let next = [{ row: 1 }];
      mainModule.consumeMarkerLayer({ name: "a", getItems: () => next });
      const handle = service.attach(await makeEditor());
      handle.updateSync();

      next = null;
      handle.updateSync();
      expect(handle.layerFor("a").items).toEqual([{ row: 1 }]);

      next = [];
      handle.updateSync();
      expect(handle.layerFor("a").items).toEqual([]);
    });

    it("recomputes the layers on a fold, since screen rows moved", async () => {
      const getItems = jasmine.createSpy("getItems").and.returnValue([]);
      mainModule.consumeMarkerLayer({ name: "a", getItems });
      const editor = await makeEditor();
      const handle = service.attach(editor);
      handle.updateSync();
      const before = getItems.calls.count();

      editor.foldBufferRange([
        [1, 0],
        [3, 5],
      ]);
      advanceClock(30);

      expect(getItems.calls.count()).toBeGreaterThan(before);
    });

    it("runs initialize once per editor, however many renderers attach", async () => {
      const initialize = jasmine.createSpy("initialize");
      mainModule.consumeMarkerLayer({ name: "a", initialize, getItems: () => [] });
      const editor = await makeEditor();

      service.attach(editor);
      service.attach(editor);

      expect(initialize).toHaveBeenCalledTimes(1);
    });

    it("keeps layer.limit current without re-running getItems", async () => {
      atom.config.set("marker.specThreshold", 2);
      const getItems = jasmine
        .createSpy("getItems")
        .and.returnValue([{ row: 0 }, { row: 3 }, { row: 6 }]);
      mainModule.consumeMarkerLayer({
        name: "a",
        threshold: "marker.specThreshold",
        getItems,
      });
      const handle = service.attach(await makeEditor());
      handle.updateSync();
      const layer = handle.layerFor("a");
      const changed = jasmine.createSpy("changed");
      service.onDidChangeItems(changed);

      // Items survive full-length: the hide is each renderer's draw-time call.
      expect(layer.items.length).toBe(3);
      expect(layer.limit).toBe(2);
      const scale = (s) => layer.limit && layer.items.length > layer.limit * s;
      expect(scale(1)).toBe(true);
      expect(scale(2)).toBe(false);

      const computes = getItems.calls.count();
      atom.config.set("marker.specThreshold", 5);

      expect(layer.limit).toBe(5);
      expect(changed).toHaveBeenCalled();
      expect(getItems.calls.count()).toBe(computes);
    });
  });

  describe("teardown", () => {
    it("keeps the layers while any handle holds the editor", async () => {
      let disposed = 0;
      mainModule.consumeMarkerLayer({
        name: "a",
        initialize: (layer) => {
          layer.disposables.add({ dispose: () => disposed++ });
        },
        getItems: () => [],
      });
      const editor = await makeEditor();
      const first = service.attach(editor);
      const second = service.attach(editor);

      first.dispose();
      expect(disposed).toBe(0);
      expect(second.layerFor("a")).toBeDefined();

      second.dispose();
      expect(disposed).toBe(1);
      expect(mainModule.registry.sets.size).toBe(0);
    });

    it("survives a double dispose without corrupting the count", async () => {
      mainModule.consumeMarkerLayer({ name: "a", getItems: () => [] });
      const editor = await makeEditor();
      const first = service.attach(editor);
      const second = service.attach(editor);

      first.dispose();
      first.dispose();

      expect(second.layerFor("a")).toBeDefined();
      expect(mainModule.registry.sets.size).toBe(1);
      second.dispose();
      expect(mainModule.registry.sets.size).toBe(0);
    });

    it("stops computing once the last handle lets go", async () => {
      const getItems = jasmine.createSpy("getItems").and.returnValue([]);
      mainModule.consumeMarkerLayer({ name: "a", getItems });
      const editor = await makeEditor();
      const handle = service.attach(editor);
      handle.updateSync();
      const before = getItems.calls.count();

      handle.dispose();
      editor.foldBufferRange([
        [1, 0],
        [3, 5],
      ]);
      advanceClock(30);
      handle.updateSync();

      expect(getItems.calls.count()).toBe(before);
      expect([...handle.layers()]).toEqual([]);
    });

    it("tears the set down with the editor and leaves stale handles inert", async () => {
      let disposed = 0;
      mainModule.consumeMarkerLayer({
        name: "a",
        initialize: (layer) => {
          layer.disposables.add({ dispose: () => disposed++ });
        },
        getItems: () => [],
      });
      const editor = await makeEditor();
      const handle = service.attach(editor);

      editor.destroy();

      expect(disposed).toBe(1);
      expect(mainModule.registry.sets.size).toBe(0);
      expect([...handle.layers()]).toEqual([]);
      // A late release must not double-destroy or corrupt another editor's set.
      expect(() => handle.dispose()).not.toThrow();
    });

    it("hands a computed set to a renderer attaching late, without recomputing", async () => {
      const getItems = jasmine.createSpy("getItems").and.returnValue([{ row: 1 }]);
      mainModule.consumeMarkerLayer({ name: "a", getItems });
      const editor = await makeEditor();
      const first = service.attach(editor);
      first.updateSync();
      const computes = getItems.calls.count();

      const second = service.attach(editor);

      expect(getItems.calls.count()).toBe(computes);
      expect(second.layerFor("a").items).toEqual([{ row: 1 }]);
    });

    it("goes inert rather than throwing when the hub deactivates first", async () => {
      const getItems = jasmine.createSpy("getItems").and.returnValue([]);
      mainModule.consumeMarkerLayer({ name: "a", getItems });
      const editor = await makeEditor();
      const handle = service.attach(editor);
      handle.update();

      await atom.packages.deactivatePackage("marker");

      advanceClock(30);
      expect(getItems).not.toHaveBeenCalled();
      expect([...handle.layers()]).toEqual([]);
      expect(() => handle.dispose()).not.toThrow();
      expect(() => handle.updateSync()).not.toThrow();
      // A consumer racing the teardown lands on a no-op, not an error.
      expect([...service.attach(editor).layers()]).toEqual([]);
    });
  });
});
