"use strict";

const { CompositeDisposable, Disposable } = require("lumine");

// The hub's own built-in layer: cursor positions and selections.
//
// Registered straight on the registry rather than through `marker.layer` --
// the hub is its own provider here, and the service round trip would add
// nothing but a second name for the same object.
class Cursors {
  constructor(registry) {
    // One layer per editor, keyed by editor. The settings below and the active
    // editor answer the same question for every one of them, so they are
    // subscribed once here for the package instead of once per editor.
    this.layers = new Map();
    this.disposables = new CompositeDisposable(
      lumine.config.observe("marker.cursors.showAll", (value) => {
        this.showAll = value;
        this.updateLayers();
      }),
      lumine.config.observe("marker.cursors.showSelections", (value) => {
        this.showSelections = value;
        this.updateLayers();
      }),
      lumine.config.observe("marker.cursors.inactiveShow", (value) => {
        this.inactiveShow = value;
        this.updateLayers();
      }),
      lumine.workspace.onDidChangeActiveTextEditor(() => this.updateLayers()),
      // Registered last, so every field above exists before getItems can run.
      registry.addProvider({
        name: "cursors",
        description: "Cursor and selection markers",
        enabled: "marker.cursors.enabled",
        threshold: "marker.cursors.threshold",
        initialize: (layer) => {
          this.layers.set(layer.editor, layer);
          layer.disposables.add(
            new Disposable(() => this.layers.delete(layer.editor)),
            layer.editor.observeCursors(layer.update),
            layer.editor.onDidRemoveCursor(layer.update),
            layer.editor.onDidChangeCursorPosition(layer.update),
            layer.editor.onDidChangeSelectionRange(layer.update),
          );
        },
        getItems: ({ editor }) => {
          if (!this.inactiveShow && lumine.workspace.getActiveTextEditor() !== editor) {
            return [];
          }
          const items = this.getCursorItems(editor);
          if (this.showSelections) {
            // Selections render below the cursors that own them.
            items.unshift(...this.getSelectionItems(editor));
          }
          return items;
        },
      }),
    );
  }

  destroy() {
    this.disposables.dispose();
    this.layers.clear();
  }

  updateLayers() {
    for (const layer of this.layers.values()) {
      layer.update();
    }
  }

  // One item per cursor row, merging cursors sitting on adjacent rows.
  getCursorItems(editor) {
    const positions = this.showAll
      ? editor.getCursorScreenPositions()
      : [editor.getCursorScreenPosition()];
    positions.sort((a, b) => a.row - b.row);
    const items = [];
    let lastItem = null;
    for (const position of positions) {
      if (lastItem && position.row <= (lastItem.end ?? lastItem.row) + 1) {
        lastItem.end = position.row;
      } else {
        if (lastItem) items.push(lastItem);
        lastItem = { row: position.row };
      }
    }
    if (lastItem) items.push(lastItem);
    return items;
  }

  // One full-width item per non-empty selection.
  getSelectionItems(editor) {
    const ranges = this.showAll
      ? editor.getSelectedScreenRanges()
      : [editor.getLastSelection().getScreenRange()];
    const items = [];
    for (const range of ranges) {
      if (range.isEmpty()) {
        continue;
      }
      // A selection ending at column 0 does not cover its last row.
      const end =
        range.end.column === 0 && range.end.row > range.start.row
          ? range.end.row - 1
          : range.end.row;
      items.push({ row: range.start.row, end, position: "full", cls: "selection" });
    }
    return items;
  }
}

module.exports = { Cursors };
