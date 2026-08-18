describe("cursors layer", () => {
  let workspaceElement, mainModule, service, editor, handle, layer;

  const KEYS = [
    "marker.cursors.enabled",
    "marker.cursors.threshold",
    "marker.cursors.showAll",
    "marker.cursors.showSelections",
    "marker.cursors.inactiveShow",
  ];

  beforeEach(async () => {
    for (const key of KEYS) {
      lumine.config.unset(key);
    }
    workspaceElement = lumine.views.getView(lumine.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);
    const pack = await lumine.packages.activatePackage("marker");
    mainModule = pack.mainModule;
    service = mainModule.provideMarkerRegistry();
    editor = await lumine.workspace.open();
    editor.setText(Array(50).fill("hello world").join("\n"));
    handle = service.attach(editor);
    layer = handle.layerFor("cursors");
    handle.updateSync();
  });

  it("registers the built-in layer with the hub on activation", () => {
    expect(layer).toBeDefined();
    expect(layer.props.enabled).toBe("marker.cursors.enabled");
    expect(layer.props.threshold).toBe("marker.cursors.threshold");
    expect(typeof layer.props.description).toBe("string");
  });

  it("returns one item per cursor screen row", () => {
    editor.setCursorScreenPosition([0, 0]);
    editor.addCursorAtScreenPosition([10, 0]);
    editor.addCursorAtScreenPosition([20, 0]);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 0 }, { row: 10 }, { row: 20 }]);
  });

  it("merges cursors on adjacent rows into a single ranged item", () => {
    editor.setCursorScreenPosition([5, 0]);
    editor.addCursorAtScreenPosition([6, 0]);
    editor.addCursorAtScreenPosition([7, 0]);
    editor.addCursorAtScreenPosition([20, 0]);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 5, end: 7 }, { row: 20 }]);
  });

  it("only shows the last cursor when showAll is disabled", () => {
    lumine.config.set("marker.cursors.showAll", false);
    editor.setCursorScreenPosition([3, 0]);
    editor.addCursorAtScreenPosition([12, 0]);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 12 }]);
  });

  it("returns a full width item per non-empty selection, ahead of the cursors", () => {
    editor.setSelectedScreenRange([
      [3, 2],
      [8, 4],
    ]);
    handle.updateSync();
    expect(layer.items).toEqual([
      { row: 3, end: 8, position: "full", cls: "selection" },
      { row: 8 },
    ]);
  });

  it("ignores empty selections", () => {
    editor.setCursorScreenPosition([6, 0]);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 6 }]);
  });

  it("does not extend a selection onto a trailing row it only touches at column 0", () => {
    editor.setSelectedScreenRange([
      [3, 2],
      [8, 0],
    ]);
    handle.updateSync();
    expect(layer.items[0]).toEqual({ row: 3, end: 7, position: "full", cls: "selection" });
  });

  it("keeps a single-row selection on its own row", () => {
    editor.setSelectedScreenRange([
      [4, 1],
      [4, 6],
    ]);
    handle.updateSync();
    expect(layer.items[0]).toEqual({ row: 4, end: 4, position: "full", cls: "selection" });
  });

  it("returns an item per selection and only the last one when showAll is disabled", () => {
    editor.setSelectedScreenRanges([
      [
        [1, 0],
        [2, 3],
      ],
      [
        [10, 0],
        [11, 3],
      ],
    ]);
    handle.updateSync();
    expect(layer.items.filter((item) => item.cls === "selection")).toEqual([
      { row: 1, end: 2, position: "full", cls: "selection" },
      { row: 10, end: 11, position: "full", cls: "selection" },
    ]);

    lumine.config.set("marker.cursors.showAll", false);
    handle.updateSync();
    expect(layer.items.filter((item) => item.cls === "selection")).toEqual([
      { row: 10, end: 11, position: "full", cls: "selection" },
    ]);
  });

  it("omits selection markers when showSelections is disabled", () => {
    lumine.config.set("marker.cursors.showSelections", false);
    editor.setSelectedScreenRange([
      [3, 2],
      [8, 4],
    ]);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 8 }]);
  });

  // The old package emptied the items itself; the hub field hides at draw time
  // instead, so the items survive full-length and each map applies the limit
  // scaled by its own thresholdScale.
  it("keeps items full-length past the threshold and publishes the limit", () => {
    lumine.config.set("marker.cursors.threshold", 1);
    editor.setCursorScreenPosition([0, 0]);
    editor.addCursorAtScreenPosition([10, 0]);
    handle.updateSync();
    expect(layer.items.length).toBe(2);
    expect(layer.limit).toBe(1);
  });

  it("hides markers in inactive editors when inactiveShow is disabled", async () => {
    lumine.config.set("marker.cursors.inactiveShow", false);
    editor.setCursorScreenPosition([4, 0]);
    await lumine.workspace.open();
    handle.updateSync();
    expect(layer.items).toEqual([]);

    lumine.config.set("marker.cursors.inactiveShow", true);
    handle.updateSync();
    expect(layer.items).toEqual([{ row: 4 }]);
  });

  it("updates the layer when cursors are added, moved, or removed", () => {
    editor.setCursorScreenPosition([0, 0]);
    const cursor = editor.addCursorAtScreenPosition([15, 0]);
    advanceClock(30);
    expect(layer.items).toEqual([{ row: 0 }, { row: 15 }]);

    cursor.setScreenPosition([16, 0]);
    advanceClock(30);
    expect(layer.items).toEqual([{ row: 0 }, { row: 16 }]);

    cursor.destroy();
    advanceClock(30);
    expect(layer.items).toEqual([{ row: 0 }]);
  });

  it("updates the layer when a selection range changes", () => {
    editor.setSelectedScreenRange([
      [2, 0],
      [5, 0],
    ]);
    advanceClock(30);
    expect(layer.items[0]).toEqual({ row: 2, end: 4, position: "full", cls: "selection" });
  });

  it("subscribes to the settings once for the package, not once per editor", async () => {
    // The observers live in the Cursors constructor, not in initialize(). If
    // one moved back, every extra editor's layer would add its own observer
    // and fan a single settings change out once per layer instead of once.
    const otherEditor = await lumine.workspace.open();
    otherEditor.setText("hello\nworld");
    spyOn(lumine.config, "observe").and.callThrough();
    const second = service.attach(otherEditor);
    expect(lumine.config.observe).not.toHaveBeenCalled();

    // A second cursor in each editor, so the flip below really changes the
    // items -- a recompute that reproduces them is deliberately not reported.
    editor.addCursorAtScreenPosition([10, 0]);
    otherEditor.addCursorAtScreenPosition([1, 0]);
    advanceClock(30);

    const changed = jasmine.createSpy("changed");
    service.onDidChangeItems(changed);
    lumine.config.set("marker.cursors.showAll", false);
    advanceClock(30);

    const editors = changed.calls.all().map((call) => call.args[0].editor);
    expect(editors).toContain(editor);
    expect(editors).toContain(otherEditor);
    second.dispose();
  });

  it("vanishes and returns with marker.cursors.enabled", () => {
    lumine.config.set("marker.cursors.enabled", false);
    expect(handle.layerFor("cursors")).toBeUndefined();

    lumine.config.set("marker.cursors.enabled", true);
    advanceClock(30);
    expect(handle.layerFor("cursors")).toBeDefined();
    expect(handle.layerFor("cursors").items.length).toBeGreaterThan(0);
  });
});
