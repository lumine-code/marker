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
    // Provider name -> whether its layers exist right now. Always populated:
    // a provider without an `enabled` key is simply always on. Kept apart from
    // the descriptor so `attach` and the picker read one boolean, not config.
    this.enabled = new Map();
    this.enabledSubs = new Map();
    // Provider name -> current threshold limit, one config subscription per
    // provider rather than one per (provider, editor): the value is the same
    // for every editor, and a workspace holds many more layers than providers.
    this.limits = new Map();
    this.limitSubs = new Map();
    this.sets = new Map();
    this.emitter = new Emitter();
    this.destroyed = false;
    this.disabled = new Set(lumine.config.get("marker.disabledLayers") ?? []);
    this.disabledSubscription = lumine.config.onDidChange(
      "marker.disabledLayers",
      ({ newValue }) => {
        if (this.destroyed) return;
        this.disabled = new Set(newValue ?? []);
        for (const props of this.providers.values()) {
          if (props.enabled) continue;
          const enabled = !this.disabled.has(props.name);
          if (enabled === this.enabled.get(props.name)) continue;
          this.enabled.set(props.name, enabled);
          this.toggleProvider(props, enabled);
        }
      },
    );
  }

  // Registers a provider with every editor, present and future.
  //
  // A second layer under a name already taken is refused with a no-op
  // disposable: disposing the loser must not unregister the winner.
  addProvider(props) {
    if (this.destroyed) return new Disposable();
    if (!props?.name) {
      console.warn("marker: a layer was provided without a name");
      return new Disposable(() => {});
    }
    if (this.providers.has(props.name)) {
      console.warn(`marker: a layer named "${props.name}" is already registered`);
      return new Disposable(() => {});
    }
    this.providers.set(props.name, props);
    let retired = false;
    const owns = () => !retired && !this.destroyed && this.providers.get(props.name) === props;
    // The subscription is created only past both refusal guards above, so a
    // refused provider can never leak one.
    this.enabled.set(
      props.name,
      props.enabled
        ? (lumine.config.get(props.enabled) ?? true) !== false
        : !this.disabled.has(props.name),
    );
    if (props.enabled) {
      this.enabledSubs.set(
        props.name,
        lumine.config.onDidChange(props.enabled, ({ newValue }) => {
          if (!owns()) return;
          // An unset value means enabled, so undefined -> true must not churn.
          const next = (newValue ?? true) !== false;
          if (next === this.enabled.get(props.name)) {
            return;
          }
          this.enabled.set(props.name, next);
          this.toggleProvider(props, next);
        }),
      );
    }
    this.limits.set(props.name, props.threshold ? (lumine.config.get(props.threshold) ?? 0) : 0);
    if (props.threshold) {
      this.limitSubs.set(
        props.name,
        lumine.config.onDidChange(props.threshold, ({ newValue }) => {
          if (!owns()) return;
          const limit = newValue ?? 0;
          this.limits.set(props.name, limit);
          // A limit change needs a redraw, never a recompute: the items are
          // kept full-length and each renderer hides at draw time.
          for (const set of this.sets.values()) {
            const layer = set.layers.get(props.name);
            if (layer) {
              layer.limit = limit;
              this.emitItemsChanged(layer);
            }
          }
        }),
      );
    }
    const registration = new Disposable(() => {
      if (!owns()) return;
      retired = true;
      this.providers.delete(props.name);
      this.enabled.delete(props.name);
      // A subscription outliving its provider would resurrect a ghost layer on
      // the next config flip.
      this.enabledSubs.get(props.name)?.dispose();
      this.enabledSubs.delete(props.name);
      this.limits.delete(props.name);
      this.limitSubs.get(props.name)?.dispose();
      this.limitSubs.delete(props.name);
      this.destroyProviderLayers(props);
      this.emitLayersChanged();
    });
    try {
      if (this.enabled.get(props.name)) {
        for (const set of [...this.sets.values()]) {
          if (!owns()) break;
          set.addLayer(props)?.update();
        }
      }
      this.emitLayersChanged();
    } catch (error) {
      registration.dispose();
      throw error;
    }
    return registration;
  }

  // Builds or destroys a provider's layer in every editor when its `enabled`
  // key flips. Enabling is the late-registration path -- `initialize` runs
  // again, a cold start -- and disabling frees everything: a disabled layer
  // does not exist, it is not merely hidden.
  toggleProvider(props, enabled) {
    if (!enabled) {
      this.destroyProviderLayers(props);
      this.emitLayersChanged();
      return;
    }
    for (const set of [...this.sets.values()]) {
      if (
        this.destroyed ||
        this.providers.get(props.name) !== props ||
        this.isEnabled(props.name) !== enabled
      )
        break;
      set.addLayer(props)?.update();
    }
    this.emitLayersChanged();
  }

  destroyProviderLayers(props) {
    const retired = [];
    // Remove every old slot before invoking cleanup. Cleanup can enable the
    // layer or register its replacement, which must find empty slots in all
    // editors and must never be destroyed by the remaining old cleanup.
    for (const set of this.sets.values()) {
      const layer = set.layers.get(props.name);
      if (layer?.props !== props) continue;
      set.layers.delete(props.name);
      retired.push(layer);
    }
    for (const layer of retired) layer.destroy();
  }

  isEnabled(name) {
    return !this.destroyed && this.enabled.get(name) === true;
  }

  // A provider's own setting is the single switch when it declares one.
  // Providers without a setting use the hub's persistent disabled list.
  setEnabled(name, enabled) {
    if (this.destroyed) return false;
    const props = this.providers.get(name);
    if (!props) return false;
    if (this.isEnabled(name) === enabled) return true;
    if (props.enabled) return lumine.config.set(props.enabled, enabled);
    const disabled = new Set(this.disabled);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    return lumine.config.set("marker.disabledLayers", [...disabled]);
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
      set.refs++;
      try {
        for (const props of this.providers.values()) {
          if (this.enabled.get(props.name)) {
            set.addLayer(props);
          }
        }
      } catch (error) {
        this.releaseEditor(editor);
        throw error;
      }
    } else set.refs++;
    return new AttachHandle(this, set.destroyed ? null : set);
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
    this.disabledSubscription.dispose();
    for (const set of this.sets.values()) {
      set.destroy();
    }
    this.sets.clear();
    this.providers.clear();
    for (const sub of this.enabledSubs.values()) {
      sub.dispose();
    }
    this.enabledSubs.clear();
    this.enabled.clear();
    for (const sub of this.limitSubs.values()) {
      sub.dispose();
    }
    this.limitSubs.clear();
    this.limits.clear();
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
