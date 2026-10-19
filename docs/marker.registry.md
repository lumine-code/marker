# marker.registry

The marker hub hands a renderer every editor's computed layers and the toolkit to draw them.

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Version     | `1.0.0`                                                    |
| Provided by | `provideMarkerRegistry()` returning the registry object    |
| Consumed by | `consumeMarkerRegistry(registry)` returning a `Disposable` |
| Owner       | [`marker`](https://github.com/lumine-code/marker)          |

Layers come from packages providing [marker.layer](marker.layer.md); the hub computes each one exactly once per editor. A renderer consumes this service to read those items and to draw them with the same canvas machinery as every other map, so one stylesheet rule in a layer package paints identically everywhere.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "marker.registry": {
      "versions": { "^1.0.0": "consumeMarkerRegistry" }
    }
  }
}
```

Export `consumeMarkerRegistry(registry)` from your main module and **return a `Disposable`**: it is disposed when the hub deactivates, and must drop every handle and canvas you built from the payload. The layer picker belongs to `marker` and is independent of renderer activation.

## Contract

```ts
interface Registry {
  // data
  attach(editor: TextEditor): AttachHandle; // refcounted
  providers(): Descriptor[]; // registration order, including disabled providers
  onDidChangeItems(cb: (layer: Layer) => void): Disposable; // items or limit moved; layer.editor addresses the redraw
  onDidChangeLayers(cb: () => void): Disposable; // a provider registered, unregistered, or its shared enabled state changed

  // toolkit — constructors and pure functions, never instances
  classNameFor(props: Descriptor, item: Item): string; // "marker marker-<name> [position] [cls]"
  MarkerStyles: typeof MarkerStyles; // style probe, scoped to the element you append it into
  MarkerCanvas: typeof MarkerCanvas; // element + canvas + its own MarkerStyles
  drawRegions(canvas, styles, regions, width, height): void;
  resolveLength(value: string, basis: number, fallback?: number): number;
  resizeCanvas(canvas, width, height): CanvasRenderingContext2D;
}

interface AttachHandle {
  readonly editor: TextEditor | undefined;
  layers(): Iterable<Layer>; // registration order
  layerFor(name: string): Layer | undefined;
  update(): void; // next-frame recompute of every layer
  updateSync(): void;
  dispose(): void; // refcount release; idempotent
}

// Only enabled providers become layers; a disabled provider has none anywhere.
interface Layer {
  readonly name: string;
  readonly props: Descriptor; // what the provider registered
  readonly items: readonly Item[]; // shared with every renderer — never write to it
  readonly limit: number; // the provider's threshold; 0 means unlimited
}
```

## Minimal example

```js
const ROW = 3; // px per screen row in this toy map

module.exports = {
  consumeMarkerRegistry(registry) {
    this.registry = registry;
    this.views = new Map();

    const draw = (view) => {
      if (!view) return;
      const regions = [];
      for (const layer of view.handle.layers()) {
        if (layer.limit && layer.items.length > layer.limit) continue;
        for (const item of layer.items) {
          regions.push({
            y: item.row * ROW,
            height: ((item.end ?? item.row) - item.row + 1) * ROW,
            className: registry.classNameFor(layer.props, item),
          });
        }
      }
      view.canvas.draw(regions, 10, 600);
    };

    return new CompositeDisposable(
      lumine.workspace.observeTextEditors((editor) => {
        const view = {
          handle: registry.attach(editor),
          canvas: new registry.MarkerCanvas({ className: "mymap" }),
        };
        this.views.set(editor, view);
        editor.getElement().appendChild(view.canvas.element);
        editor.onDidDestroy(() => {
          this.views.delete(editor);
          view.handle.dispose();
          view.canvas.destroy();
        });
      }),
      registry.onDidChangeItems((layer) => draw(this.views.get(layer.editor))),
    );
  },
};
```

## Behavior

**One computation, shared.** Whatever the number of consumers, `getItems` runs once per layer per update; every handle on the same editor reads the same items array. A late `attach` finds items already computed.

**Events are synchronous and editor-addressed.** `onDidChangeItems` fires with the layer that moved; look up your view by `layer.editor` and coalesce repaints yourself. Default layer updates run in the editor's document read phase. A renderer can join that frame with `lumine.views.readDocument()` and queue its paint through `lumine.views.updateDocument()` from the read callback: this paints after the editor's measurements without requesting a second animation frame. Explicit positive provider timers and `updateSync()` can also emit outside that phase. A recompute that reproduced the same items does not fire, and `layer.items` keeps its identity until the markers really move — so the array itself is a change signal you may cache against. `onDidChangeLayers` means the picker list and every map changed shape.

**Layer selection belongs to the hub.** `marker:toggle-focus` opens the single layer picker. Switching a layer off destroys its instances, subscriptions, throttles and caches in every editor. Switching it back on initializes fresh instances and recomputes only that layer. Disabled providers remain in the picker. A provider's `enabled` setting is its single switch; providers without that setting use `marker.disabledLayers`. Renderers keep no separate enabled lists and see changes through `onDidChangeLayers`.

**Density belongs to the renderer.** Observe your own `thresholdScale` setting, cache it, and skip a layer while `layer.limit && layer.items.length > layer.limit * thresholdScale`. The hub keeps each `layer.limit` current and emits a change when it moves without re-running `getItems`.

**Instantiate the toolkit per renderer.** `MarkerStyles` probes resolve percentage widths and offsets against the element you mount them in, and warn once per class that resolves to no colour, naming your map. Sharing an instance between two maps would give one of them the other's geometry.

## Teardown

Hold each handle for the **editor's lifetime, not your visibility**: dispose on `editor.onDidDestroy` or in your own teardown, never on hide — the last dispose destroys the layers, their caches and their in-flight work, and a map that merely toggled off would come back to cold layers. Everything is idempotent: a handle disposed twice, or after the editor or the hub died, is a no-op. The `Disposable` you return from `consumeMarkerRegistry` is disposed when the hub deactivates — drop every handle and canvas in it; payload methods on a destroyed hub are inert, not errors.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
