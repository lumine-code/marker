describe("marker layer picker", () => {
  let mainModule, picker, workspaceElement;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    mainModule = (await lumine.packages.activatePackage("marker")).mainModule;
    mainModule.cursors.destroy();
    lumine.commands.dispatch(workspaceElement, "marker:toggle-focus");
    picker = mainModule.picker;
  });

  it("owns one picker without an overview renderer", () => {
    expect(picker.selectListHost.isVisible()).toBe(true);
    lumine.commands.dispatch(workspaceElement, "marker:toggle-focus");
    expect(picker.selectListHost.isVisible()).toBe(false);
    lumine.commands.dispatch(workspaceElement, "marker:toggle-focus");
    expect(mainModule.picker).toBe(picker);
    expect(picker.selectListHost.isVisible()).toBe(true);
    expect(mainModule.provideMarkerRegistry().createPicker).toBeUndefined();
  });

  it("keeps disabled providers listed and toggles their own enable setting", () => {
    lumine.config.set("marker.specPickerEnabled", false);
    mainModule.consumeMarkerLayer({
      name: "layer1",
      enabled: "marker.specPickerEnabled",
      getItems: () => [],
    });
    expect(picker.items().map((item) => item.name)).toEqual(["layer1"]);
    expect(picker.isEnabled({ name: "layer1" })).toBe(false);
    picker.toggle({ name: "layer1" });
    expect(lumine.config.get("marker.specPickerEnabled")).toBe(true);
    expect(picker.isEnabled({ name: "layer1" })).toBe(true);
    picker.toggle({ name: "layer1" });
    expect(lumine.config.get("marker.specPickerEnabled")).toBe(false);
    expect(picker.items().map((item) => item.name)).toEqual(["layer1"]);
  });

  it("updates the open list when a provider arrives or retires", () => {
    const registration = mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
    expect(picker.selectList.getItems().map((item) => item.name)).toEqual(["layer1"]);
    registration.dispose();
    expect(picker.selectList.getItems()).toEqual([]);
  });

  it("toggles one shared layer for every attached map", async () => {
    mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [{ row: 1 }] });
    const editor = await lumine.workspace.open();
    const service = mainModule.provideMarkerRegistry();
    const firstMap = service.attach(editor);
    const secondMap = service.attach(editor);
    const oldLayer = firstMap.layerFor("layer1");
    picker.toggle({ name: "layer1" });
    expect(lumine.config.get("marker.disabledLayers")).toEqual(["layer1"]);
    expect(firstMap.layerFor("layer1")).toBeUndefined();
    expect(secondMap.layerFor("layer1")).toBeUndefined();
    picker.toggle({ name: "layer1" });
    expect(firstMap.layerFor("layer1")).not.toBe(oldLayer);
    expect(firstMap.layerFor("layer1")).toBe(secondMap.layerFor("layer1"));
    firstMap.dispose();
    secondMap.dispose();
  });

  it("keeps the selection and window open after its primary action", async () => {
    mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
    await picker.selectList.selectItemById("layer1");
    await picker.selectList.confirmSelection();
    expect(lumine.config.get("marker.disabledLayers")).toEqual(["layer1"]);
    expect(picker.selectList.getSelectedItemId()).toBe("layer1");
    expect(picker.selectListHost.isVisible()).toBe(true);
  });

  it("destroys the picker when marker deactivates", async () => {
    spyOn(picker, "destroy").and.callThrough();
    await lumine.packages.deactivatePackage("marker");
    expect(picker.destroy).toHaveBeenCalledTimes(1);
    expect(workspaceElement.querySelector(".marker-view")).toBeNull();
    expect(() => picker.toggleFocus()).not.toThrow();
    expect(picker.toggle({ name: "cursors" })).toBe(false);
  });
});
