"use strict";

const { CompositeDisposable } = require("lumine");
const { normalizeItems } = require("./items");
const { throttles } = require("./timing");

const DEFAULT_TIMER = 20;

// One provider's markers for one editor -- the only copy there is.
//
// The layer owns the data half of the contract: the provider's cache, its
// subscriptions, the throttle, and the items it last produced. Geometry is the
// renderers': every renderer draws from these items, so nothing here -- and
// nobody downstream -- may write to them.
class Layer {
  constructor(editor, props, set) {
    this.editor = editor;
    this.props = props;
    this.set = set;
    this.cache = new Map();
    this.items = [];
    this.disposables = new CompositeDisposable();
    this.throttled = throttles(() => this.updateSync(), props.timer ?? DEFAULT_TIMER);
    [this.update] = this.throttled;
    // The threshold hides, it does not empty: items survive full-length and each
    // renderer skips drawing while their count exceeds `limit` times its own
    // scale. A limit change therefore needs a redraw, never a recompute.
    this.limit = props.threshold ? (lumine.config.get(props.threshold) ?? 0) : 0;
    if (props.threshold) {
      this.disposables.add(
        lumine.config.onDidChange(props.threshold, ({ newValue }) => {
          this.limit = newValue ?? 0;
          this.set.registry.emitItemsChanged(this);
        }),
      );
    }
    props.initialize?.(this);
  }

  get name() {
    return this.props.name;
  }

  updateSync() {
    // The component guard gates every renderer at once: an editor without a
    // component is drawn by none of them.
    if (this.set.destroyed || !this.editor.component) {
      return;
    }
    if (this.props.getItems) {
      const raw = this.props.getItems(this);
      // A falsy return keeps the previous items: `null` skips a cycle, an empty
      // array clears the layer.
      if (raw) {
        this.items = normalizeItems(raw, this.props);
      }
    }
    this.set.registry.emitItemsChanged(this);
  }

  destroy() {
    this.throttled.cancel();
    this.cache.clear();
    this.items = [];
    this.disposables.dispose();
  }
}

// Every layer of one editor, shared by every renderer attached to it.
class LayerSet {
  constructor(editor, registry) {
    this.editor = editor;
    this.registry = registry;
    this.layers = new Map();
    this.refs = 0;
    this.destroyed = false;
    this.throttled = throttles(() => this.updateSync(), DEFAULT_TIMER);
    [this.update] = this.throttled;
    this.disposables = new CompositeDisposable(
      // The one signal that moves screen rows without the buffer changing, so
      // the one every layer has to answer no matter what it subscribed to.
      editor.displayLayer.foldsMarkerLayer.onDidUpdate(this.update),
      // The set outlives any single renderer's interest but never the editor.
      editor.onDidDestroy(() => this.registry.releaseEditor(editor)),
    );
  }

  addLayer(props) {
    if (this.layers.has(props.name)) {
      return;
    }
    this.layers.set(props.name, new Layer(this.editor, props, this));
  }

  delLayer(name) {
    this.layers.get(name)?.destroy();
    this.layers.delete(name);
  }

  updateSync() {
    for (const layer of this.layers.values()) {
      layer.updateSync();
    }
  }

  destroy() {
    this.destroyed = true;
    this.throttled.cancel();
    this.disposables.dispose();
    for (const layer of this.layers.values()) {
      layer.destroy();
    }
    this.layers.clear();
  }
}

module.exports = { DEFAULT_TIMER, Layer, LayerSet };
