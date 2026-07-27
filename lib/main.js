"use strict";

const { Registry } = require("./registry");

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
    createPicker(options) {
      // Deferred so an install without a renderer never loads select-list.
      const { LayerPicker } = require("./picker");
      return new LayerPicker({ registry, ...options });
    },
  });
}

module.exports = {
  activate() {
    this.registry = new Registry();
    this.service = null;
  },

  deactivate() {
    this.registry.destroy();
    this.service = null;
  },

  consumeMarkerLayer(provider) {
    return this.registry.addProvider(provider);
  },

  provideMarkerRegistry() {
    this.service ??= buildService(this.registry);
    return this.service;
  },
};
