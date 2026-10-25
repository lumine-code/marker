"use strict";

const { CompositeDisposable, Disposable, Emitter } = require("lumine");
const { itemsEqual, normalizeItems } = require("./items");

// One provider's markers for one editor -- the only copy there is.
//
// The layer owns the data half of the contract: the provider's cache, its
// subscriptions and the items it last produced. Geometry is the
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
    this.destroyed = false;
    this.update = () => {
      if (this.destroyed) return;
      this.set.schedule(this);
    };
    // The threshold hides, it does not empty: items survive full-length and each
    // renderer skips drawing while their count exceeds `limit` times its own
    // scale. The registry holds one subscription per provider and keeps this
    // field current across every editor -- see `addProvider`.
    this.limit = set.registry.limits.get(props.name) ?? 0;
  }

  get name() {
    return this.props.name;
  }

  updateSync() {
    this.set.pendingLayers.delete(this);
    // The component guard gates every renderer at once: an editor without a
    // component is drawn by none of them.
    if (this.destroyed || this.set.destroyed || !this.editor.component) {
      return;
    }
    if (!this.props.getItems) {
      return;
    }
    // A falsy return keeps the previous items: `null` skips a cycle, an empty
    // array clears the layer.
    const raw = this.props.getItems(this);
    if (!raw || this.destroyed || this.set.layers.get(this.name) !== this) {
      return;
    }
    // Most providers already return sorted, separate rows. If those rows are
    // unchanged, avoid copying and sorting them just to rediscover that fact.
    // Compare against our owned snapshot: providers may mutate cached objects.
    if (itemsEqual(this.items, raw)) return;
    // Reported only when the markers actually moved: every emit costs each
    // renderer a repaint, and the busiest recomputes -- a cursor wandering
    // along one row -- reproduce the same items every frame. Keeping the old
    // array on a match also makes its identity a change signal a renderer may
    // cache against.
    const next = normalizeItems(raw, this.props);
    if (itemsEqual(this.items, next)) {
      return;
    }
    this.items = next;
    this.set.registry.emitItemsChanged(this);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.set.pendingLayers.delete(this);
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
    this.pendingLayers = new Set();
    this.pendingUpdate = null;
    this.update = () => this.schedule();
    this.disposables = new CompositeDisposable(
      // Geometry changes are the signals every layer has to answer no matter
      // what it subscribed to. Folds collapse rows; a reset is a re-wrap — the soft-wrap
      // column following a pane resize, a font change, a soft-wrap toggle.
      // Providers convert buffer rows to screen rows when getItems runs, so
      // items computed before a re-wrap point at rows the document no longer
      // has there, and the markers drift down the map by the accumulated wrap
      // difference until something else happens to re-poll.
      editor.displayLayer.onDidChange((changes) => {
        // Fold layers emit updates on every edit, including edits far from any
        // fold. The display layer reports the actual affected screen rows.
        // Replacing one screen row with one screen row moves no row-only
        // overview coordinates; wrapped rows and row-count changes do.
        if (
          changes.some(({ oldRange, newRange }) => {
            const oldRows = oldRange.end.row - oldRange.start.row;
            const newRows = newRange.end.row - newRange.start.row;
            return oldRows !== newRows || oldRows > 1 || newRows > 1;
          })
        ) {
          this.update();
        }
      }),
      editor.getBuffer().onDidChangeText(({ changes }) => {
        // A multiline replacement inside a collapsed fold can move anchored
        // diagnostic ranges while the displayed row count stays unchanged.
        if (
          changes.some(
            ({ oldRange, newRange }) =>
              oldRange.start.row !== oldRange.end.row || newRange.start.row !== newRange.end.row,
          )
        ) {
          this.update();
        }
      }),
      editor.displayLayer.onDidReset(this.update),
      editor.onDidChangeGrammar(() => {
        if (this.destroyed) return;
        if (editor.getGrammar() === lumine.grammars.nullGrammar) {
          this.pendingUpdate?.dispose();
          this.pendingUpdate = null;
          this.pendingLayers.clear();
          const retired = [...this.layers.values()];
          this.layers.clear();
          for (const layer of retired) layer.destroy();
        } else {
          for (const props of registry.providers.values()) this.addLayer(props)?.update();
        }
        registry.emitLayersChanged();
      }),
      // The set outlives any single renderer's interest but never the editor.
      editor.onDidDestroy(() => this.registry.releaseEditor(editor)),
    );
  }

  addLayer(props) {
    if (
      this.destroyed ||
      this.editor.getGrammar() === lumine.grammars.nullGrammar ||
      !this.registry.isEnabled(props.name) ||
      this.layers.has(props.name)
    ) {
      return;
    }
    const layer = new Layer(this.editor, props, this);
    this.layers.set(props.name, layer);
    try {
      props.initialize?.(layer);
    } catch (error) {
      if (this.layers.get(props.name) === layer) this.layers.delete(props.name);
      layer.destroy();
      throw error;
    }
    return layer.destroyed ? null : layer;
  }

  delLayer(name) {
    const layer = this.layers.get(name);
    this.layers.delete(name);
    layer?.destroy();
  }

  // Providers publish when their own work is ready. Batch those signals with
  // geometry invalidation, so every affected layer is read at most once in the
  // editor's frame, however many maps or subscriptions requested it.
  schedule(layer) {
    if (this.destroyed || this.editor.getGrammar() === lumine.grammars.nullGrammar) return;
    if (layer) this.pendingLayers.add(layer);
    else for (const current of this.layers.values()) this.pendingLayers.add(current);
    if (this.pendingUpdate) return;
    const update = lumine.views.readDocument(() => {
      if (this.pendingUpdate !== update) return;
      this.pendingUpdate = null;
      if (this.destroyed) return;
      for (const pending of [...this.pendingLayers]) {
        // An earlier provider can retire another pending layer while updating.
        if (this.pendingLayers.has(pending)) pending.updateSync();
      }
    });
    this.pendingUpdate = update;
  }

  updateSync() {
    this.pendingUpdate?.dispose();
    this.pendingUpdate = null;
    this.pendingLayers.clear();
    for (const layer of this.layers.values()) {
      layer.updateSync();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingUpdate?.dispose();
    this.pendingUpdate = null;
    this.pendingLayers.clear();
    this.disposables.dispose();
    for (const layer of this.layers.values()) {
      layer.destroy();
    }
    this.layers.clear();
  }
}

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

// Compatibility paths expose this same engine generation without adding normal
// bootstrap module loads. Keep the established registry export keys enumerable.
Object.defineProperties(module.exports, {
  Cursors: { value: Cursors, writable: true, configurable: true },
  Layer: { value: Layer, writable: true, configurable: true },
  LayerSet: { value: LayerSet, writable: true, configurable: true },
});
