"use strict";

const { Disposable, Emitter } = require("lumine");
const { LayerSet } = require("./layer");

// The hub every marker layer lives in.
//
// One `LayerSet` per editor, however many renderers draw it: satellites feed
// descriptors in through `marker.layer`, renderers refcount editors in through
// `attach`, and each layer computes its items exactly once for all of them.
class Registry {
  constructor() {
    this.providers = new Map();
    this.sets = new Map();
    this.emitter = new Emitter();
    this.destroyed = false;
  }

  // Registers a provider with every editor, present and future.
  //
  // A second layer under a name already taken is refused with a no-op
  // disposable: disposing the loser must not unregister the winner.
  addProvider(props) {
    if (!props?.name) {
      console.warn("marker: a layer was provided without a name");
      return new Disposable(() => {});
    }
    if (this.providers.has(props.name)) {
      console.warn(`marker: a layer named "${props.name}" is already registered`);
      return new Disposable(() => {});
    }
    this.providers.set(props.name, props);
    for (const set of this.sets.values()) {
      set.addLayer(props);
      set.update();
    }
    this.emitLayersChanged();

    return new Disposable(() => {
      this.providers.delete(props.name);
      for (const set of this.sets.values()) {
        set.delLayer(props.name);
      }
      this.emitLayersChanged();
    });
  }

  // A renderer's refcounted hold on one editor's layers. The first attach does
  // the work -- builds the set, runs every provider's `initialize` -- and a
  // later renderer finds items that are already computed.
  attach(editor) {
    if (this.destroyed || editor.isDestroyed()) {
      return new AttachHandle(this, null);
    }
    let set = this.sets.get(editor);
    if (!set) {
      set = new LayerSet(editor, this);
      this.sets.set(editor, set);
      for (const props of this.providers.values()) {
        set.addLayer(props);
      }
    }
    set.refs++;
    return new AttachHandle(this, set);
  }

  releaseEditor(editor) {
    const set = this.sets.get(editor);
    if (!set) {
      return;
    }
    this.sets.delete(editor);
    set.destroy();
  }

  emitItemsChanged(layer) {
    if (this.destroyed) {
      return;
    }
    this.emitter.emit("did-change-items", layer);
  }

  emitLayersChanged() {
    if (this.destroyed) {
      return;
    }
    this.emitter.emit("did-change-layers");
  }

  onDidChangeItems(callback) {
    if (this.destroyed) {
      return new Disposable(() => {});
    }
    return this.emitter.on("did-change-items", callback);
  }

  onDidChangeLayers(callback) {
    if (this.destroyed) {
      return new Disposable(() => {});
    }
    return this.emitter.on("did-change-layers", callback);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const set of this.sets.values()) {
      set.destroy();
    }
    this.sets.clear();
    this.providers.clear();
    this.emitter.dispose();
  }
}

// What `attach` returns: iteration over the editor's layers plus the release.
//
// A handle on a destroyed registry or editor is inert rather than an error --
// a renderer racing teardown must land on a no-op, not a throw.
class AttachHandle {
  constructor(registry, set) {
    this.registry = registry;
    this.set = set;
    this.disposed = false;
  }

  get editor() {
    return this.set?.editor;
  }

  *layers() {
    if (!this.set || this.set.destroyed) {
      return;
    }
    yield* this.set.layers.values();
  }

  layerFor(name) {
    if (!this.set || this.set.destroyed) {
      return undefined;
    }
    return this.set.layers.get(name);
  }

  update() {
    if (!this.set || this.set.destroyed) {
      return;
    }
    this.set.update();
  }

  updateSync() {
    if (!this.set || this.set.destroyed) {
      return;
    }
    this.set.updateSync();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const set = this.set;
    // An editor-destroy teardown beats a late dispose to the set; decrementing
    // then would corrupt the count of a set that no longer exists.
    if (!set || set.destroyed) {
      return;
    }
    set.refs--;
    if (set.refs <= 0) {
      this.registry.releaseEditor(set.editor);
    }
  }
}

module.exports = { AttachHandle, Registry };
