describe("layer picker", () => {
  let mainModule, service;

  async function activate() {
    const pack = await lumine.packages.activatePackage("marker");
    mainModule = pack.mainModule;
    service = mainModule.provideMarkerRegistry();
  }

  beforeEach(async () => {
    await activate();
    lumine.config.set("marker.specA.disabledLayers", []);
    lumine.config.set("marker.specB.disabledLayers", []);
  });

  function makePicker(disabledKey, extras) {
    return service.createPicker({
      className: "marker-spec-view",
      emptyMessage: "No layers",
      disabledKey,
      extras,
    });
  }

  it("lists the extras before the registered providers", () => {
    mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
    const extra = { name: "extra1", isEnabled: () => true, toggle() {} };
    const picker = makePicker("marker.specA.disabledLayers", [extra]);

    expect(picker.items().map((item) => item.name)).toEqual(["extra1", "layer1"]);
    picker.destroy();
  });

  // Two maps over one registry: each picker writes its own key and nothing else.
  it("keeps two pickers on separate disabled keys independent", () => {
    mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
    const pickerA = makePicker("marker.specA.disabledLayers");
    const pickerB = makePicker("marker.specB.disabledLayers");

    pickerA.toggle({ name: "layer1" });

    expect(lumine.config.get("marker.specA.disabledLayers")).toEqual(["layer1"]);
    expect(lumine.config.get("marker.specB.disabledLayers")).toEqual([]);
    expect(pickerA.isEnabled({ name: "layer1" })).toBe(false);
    expect(pickerB.isEnabled({ name: "layer1" })).toBe(true);

    pickerA.toggle({ name: "layer1" });
    expect(lumine.config.get("marker.specA.disabledLayers")).toEqual([]);
    expect(pickerA.isEnabled({ name: "layer1" })).toBe(true);

    pickerA.destroy();
    pickerB.destroy();
  });

  it("reads the disabled list live rather than caching it", () => {
    const picker = makePicker("marker.specA.disabledLayers");

    lumine.config.set("marker.specA.disabledLayers", ["layer1"]);

    expect(picker.isEnabled({ name: "layer1" })).toBe(false);
    picker.destroy();
  });

  // An extra is a renderer-owned toggle: the picker must never route it through
  // the disabled list.
  it("lets an extra bring its own state and toggle", () => {
    let enabled = true;
    const extra = {
      name: "extra1",
      isEnabled: () => enabled,
      toggle: () => {
        enabled = !enabled;
      },
    };
    const picker = makePicker("marker.specA.disabledLayers", [extra]);

    expect(picker.isEnabled(extra)).toBe(true);
    picker.toggle(extra);
    expect(enabled).toBe(false);
    expect(lumine.config.get("marker.specA.disabledLayers")).toEqual([]);
    picker.destroy();
  });
});
