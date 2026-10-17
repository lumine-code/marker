"use strict";

const { Cursors, Registry } = require("./registry");
const { CompositeDisposable } = require("lumine");

// The service object handed to every renderer. One frozen instance: ServiceHub
// may ask more than once, and two renderers comparing payload members must see
// the same functions.
function buildService(registry) {
  const { classNameFor } = require("./items");
  const {
    MarkerCanvas,
    MarkerStyles,
    drawRegions,
    resolveLength,
    resizeCanvas,
  } = require("./canvas");
  return Object.freeze({
    // --- data ---
    attach: (editor) => registry.attach(editor),
    providers: () => [...registry.providers.values()],
    onDidChangeItems: (callback) => registry.onDidChangeItems(callback),
    onDidChangeLayers: (callback) => registry.onDidChangeLayers(callback),
    // --- renderer toolkit: constructors and pure functions, never instances ---
    classNameFor,
    MarkerCanvas,
    MarkerStyles,
    drawRegions,
    resolveLength,
    resizeCanvas,
  });
}

module.exports = {
  activate() {
    this.registry = new Registry();
    this.cursors = new Cursors(this.registry);
    this.service = null;
    this.picker = null;
    this.pickers = new Map();
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "marker:toggle-focus": {
          description: "Choose which marker layers the overview maps display.",
          didDispatch: (event) => this.toggleFocus(event.context?.window),
        },
      }),
    );
  },

  deactivate() {
    this.disposables?.dispose();
    for (const { picker, lease } of this.pickers?.values() ?? []) {
      lease.dispose();
      picker.destroy();
    }
    this.pickers?.clear();
    this.picker = null;
    // Through the normal provider path, before the registry is torn down.
    this.cursors?.destroy();
    this.cursors = null;
    this.registry?.destroy();
    this.service = null;
  },

  consumeMarkerLayer(provider) {
    return this.registry.addProvider(provider);
  },

  provideMarkerRegistry() {
    this.service ??= buildService(this.registry);
    return this.service;
  },

  toggleFocus(window = lumine.workspace.getMainWindow()) {
    if (this.registry.destroyed) return;
    let record = this.pickers.get(window);
    if (!record) {
      const registry = this.registry;
      const { LayerPicker } = require("./picker");
      const picker = new LayerPicker(registry, window);
      if (this.registry !== registry || registry.destroyed) {
        picker.destroy();
        return;
      }
      const lease = window.onWillDestroy(() => {
        this.pickers.delete(window);
        lease.dispose();
        picker.destroy();
      });
      record = { picker, lease };
      this.pickers.set(window, record);
      if (window.isMain()) this.picker = picker;
    }
    record.picker.toggleFocus();
  },

  provideBackgroundTips() {
    return {
      packageName: "marker",
      tips: [
        "You can choose the marker layers shown on the overview maps with {{ 'marker:toggle-focus' | keystroke }}",
      ],
    };
  },
};
