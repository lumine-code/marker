// The kernel's shared spec vocabulary. Reached by relative path because it
// lives in the editor checkout, which CI places next to `pkg_lumine/marker`.
const {
  activeSession,
  modalElement,
  visibleLabels,
  confirm,
  settle,
} = require("../../../lumine/spec/helpers/modal-helpers");

describe("layer picker", () => {
  let mainModule, service;

  async function activate() {
    const pack = await atom.packages.activatePackage("marker");
    mainModule = pack.mainModule;
    service = mainModule.provideMarkerRegistry();
  }

  beforeEach(async () => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    await activate();
    atom.config.set("marker.specA.disabledLayers", []);
    atom.config.set("marker.specB.disabledLayers", []);
  });

  afterEach(() => {
    if (atom.modals.isOpen()) atom.modals.cancel();
  });

  function makePicker(disabledKey, extras) {
    return service.createPicker({
      className: "marker-spec-view",
      emptyMessage: "No layers",
      disabledKey,
      extras,
    });
  }

  function iconClasses() {
    return Array.from(modalElement().querySelectorAll("ol.list-group > li .primary-line")).map(
      (line) => (line.classList.contains("icon-check") ? "check" : "slash"),
    );
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

    expect(atom.config.get("marker.specA.disabledLayers")).toEqual(["layer1"]);
    expect(atom.config.get("marker.specB.disabledLayers")).toEqual([]);
    expect(pickerA.isEnabled({ name: "layer1" })).toBe(false);
    expect(pickerB.isEnabled({ name: "layer1" })).toBe(true);

    pickerA.toggle({ name: "layer1" });
    expect(atom.config.get("marker.specA.disabledLayers")).toEqual([]);
    expect(pickerA.isEnabled({ name: "layer1" })).toBe(true);

    pickerA.destroy();
    pickerB.destroy();
  });

  it("reads the disabled list live rather than caching it", () => {
    const picker = makePicker("marker.specA.disabledLayers");

    atom.config.set("marker.specA.disabledLayers", ["layer1"]);

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
    expect(atom.config.get("marker.specA.disabledLayers")).toEqual([]);
    picker.destroy();
  });

  describe("the modal", () => {
    it("shows every layer with its enabled state", async () => {
      mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
      mainModule.consumeMarkerLayer({ name: "layer2", description: "second", getItems: () => [] });
      atom.config.set("marker.specA.disabledLayers", ["layer2"]);
      const picker = makePicker("marker.specA.disabledLayers");

      picker.show();
      await settle();

      expect(visibleLabels()).toEqual(["layer1", "layer2second"]);
      expect(iconClasses()).toEqual(["check", "slash"]);
      picker.destroy();
    });

    // The list is rebuilt on every open, the way `willShow` used to refresh it.
    it("picks up a layer registered after the last open", async () => {
      const picker = makePicker("marker.specA.disabledLayers");
      picker.show();
      await settle();
      expect(visibleLabels()).toEqual([]);

      picker.show(); // toggles it shut again
      mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
      picker.show();
      await settle();

      expect(visibleLabels()).toEqual(["layer1"]);
      picker.destroy();
    });

    // Switching several layers in one pass is the normal way this list is used.
    it("stays open on the same row after confirming", async () => {
      mainModule.consumeMarkerLayer({ name: "layer1", getItems: () => [] });
      mainModule.consumeMarkerLayer({ name: "layer2", getItems: () => [] });
      const picker = makePicker("marker.specA.disabledLayers");

      picker.show();
      await settle();
      activeSession().focusItem(picker.items()[1]);
      confirm();
      await settle();

      expect(atom.config.get("marker.specA.disabledLayers")).toEqual(["layer2"]);
      expect(atom.modals.isOpen()).toBe(true);
      expect(activeSession().getFocusedItem().name).toBe("layer2");
      expect(iconClasses()).toEqual(["check", "slash"]);

      confirm();
      await settle();

      expect(atom.config.get("marker.specA.disabledLayers")).toEqual([]);
      expect(iconClasses()).toEqual(["check", "check"]);
      picker.destroy();
    });

    it("toggles its own list closed", async () => {
      const picker = makePicker("marker.specA.disabledLayers");

      picker.show();
      await settle();
      expect(atom.modals.isOpen()).toBe(true);

      picker.show();
      expect(atom.modals.isOpen()).toBe(false);
      picker.destroy();
    });

    // Each map has its own view id, so one map's list replaces the other's
    // rather than closing it and leaving nothing up.
    it("replaces the other map's list rather than toggling it shut", async () => {
      const pickerA = makePicker("marker.specA.disabledLayers");
      const pickerB = makePicker("marker.specB.disabledLayers");

      pickerA.show();
      await settle();
      pickerB.show();
      await settle();

      expect(atom.modals.isOpen()).toBe(true);
      expect(activeSession().rootSpec.id).toBe("marker.marker-specB-layers");

      // A renderer going away takes its own list down, and nobody else's.
      pickerA.destroy();
      expect(atom.modals.isOpen()).toBe(true);
      pickerB.destroy();
      expect(atom.modals.isOpen()).toBe(false);
    });
  });
});
