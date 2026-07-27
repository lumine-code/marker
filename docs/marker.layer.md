# marker.layer

A package registers a named layer of markers that the editor's overview maps draw.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideMarkerLayer()` returning one layer descriptor   |
| Consumed by | `consumeMarkerLayer(provider)` returning a `Disposable` |
| Owner       | [`marker`](https://github.com/lumine-code/marker)       |

The `marker` package is the sole consumer: it computes each layer's items once per editor, and the overview maps — `scrollmap` on the vertical scrollbar, `minimap` over the code — draw those items through [marker.registry](marker.registry.md). A provider never sees the renderers.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "marker.layer": {
      "versions": { "1.0.0": "provideMarkerLayer" }
    }
  }
}
```

Export `provideMarkerLayer` from your main module and return **one** descriptor object. The hub keys layers by `provider.name` and never iterates an array, so returning an array registers a layer named `undefined` and draws nothing. A package that needs several layers declares several `providedServices` entries.

## Contract

Only `name` is required.

| Field  | Type   | Description                                                                                                                                     |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` | string | Layer identity. Becomes the CSS class `marker-<name>` and the key in each renderer's layer picker. Must be unique across every installed layer. |

Everything else is optional.

| Field         | Type                              | Default | Description                                                                                                                                                                                         |
| ------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | string                            | —       | Shown beside the layer in the renderers' layer pickers.                                                                                                                                             |
| `position`    | `"left"` \| `"right"` \| `"full"` | —       | Column for every item in the layer. Each renderer maps it to its own width.                                                                                                                         |
| `timer`       | number                            | `20`    | Throttle interval in milliseconds for `update()`.                                                                                                                                                   |
| `merge`       | boolean                           | `false` | Sort items and merge adjacent rows that share the same `cls` and `position`.                                                                                                                        |
| `threshold`   | string                            | —       | A config key path read as a limit. Each renderer skips drawing the layer while it holds more items than the value there, scaled by that renderer's `thresholdScale`; the items themselves are kept. |
| `initialize`  | `(layer) => void`                 | —       | Called once per editor, when the layer is attached to it.                                                                                                                                           |
| `getItems`    | `(layer) => item[] \| null`       | —       | Called on every update to produce the markers.                                                                                                                                                      |

A marker item:

| Field      | Type                              | Description                                               |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| `row`      | number                            | Screen row. Required.                                     |
| `end`      | number                            | Last screen row of a range; the marker spans `row`–`end`. |
| `cls`      | string                            | Extra CSS class, appended after `marker marker-<name>`.   |
| `position` | `"left"` \| `"right"` \| `"full"` | Overrides the layer's `position` for this item.           |

Rows are **screen** rows, not buffer rows, so folds and soft wrap move them. The hub subscribes to fold changes itself, so you do not need to.

The `layer` instance passed to `initialize` and `getItems`:

| Member         | Type                  | Description                                                                                                     |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `editor`       | `TextEditor`          | The editor this layer belongs to.                                                                               |
| `props`        | object                | The descriptor you returned.                                                                                    |
| `cache`        | `Map`                 | Free store for bridging external data into `getItems`. Write it from a service callback, read it in `getItems`. |
| `items`        | array                 | The current items. Read-only for providers.                                                                     |
| `disposables`  | `CompositeDisposable` | Disposed when the layer is destroyed.                                                                           |
| `update()`     | function              | Throttled. Re-runs `getItems` and re-renders.                                                                   |
| `updateSync()` | function              | `update()` without the throttle, for flicker-free handovers such as swapping the editors of a diff.             |

## Minimal example

```js
module.exports = {
  provideMarkerLayer() {
    return {
      name: "mylayer",
      description: "Rows that mention TODO",
      position: "left",
      merge: true,
      threshold: "mypackage.markerLimit",
      initialize: (layer) => {
        layer.disposables.add(layer.editor.onDidStopChanging(layer.update));
      },
      getItems: (layer) => {
        const rows = [];
        layer.editor.scan(/TODO/g, ({ range }) => rows.push({ row: range.start.row }));
        return rows;
      },
    };
  },
};
```

## Behavior

**One layer per editor, by construction.** The hub builds exactly one `Layer` from your descriptor for each editor, however many maps draw it, and `initialize` runs once when the first of them attaches. Per-editor state belongs in `layer.cache`, or in a plain `Map` keyed by editor; see [Teardown](#teardown).

A falsy `getItems` return keeps the previous items: return `null` to skip an update cycle, and an empty array to clear the layer.

The hub copies every item before merging, so you may hand out cached objects without them being mutated. The array it ends up with is shared by every renderer — none of them writes to it, and neither should you.

With `merge` you return raw, unsorted ranges and leave ordering and merging to the hub. Merging joins two items when they carry the same `cls` and `position` and the second starts no more than one row after the first ends. Setting `threshold` also subscribes the layer to that config key; a change redraws the maps without re-running `getItems`. Each renderer scales the limit by its own `thresholdScale` setting, since a count that saturates an 8px strip means something else on a map showing a couple of hundred rows at a time.

**Styling.** A layer stylesheet sets **colour, opacity and z-index**; **geometry belongs to the renderer.** Write class-only rules so they resolve in either map, and keep the `.marker` qualifier so they cannot reach unrelated elements:

```css
.marker.marker-mylayer {
  z-index: 14;
  background-color: var(--text-color-info);
}
```

A class that resolves to no background colour draws nothing, and each renderer reports it once — usually a stylesheet still scoped to one map.

Registering a second layer under a name that is already taken logs a warning and returns a no-op `Disposable`; the second layer never draws. Nothing else reports a mistake — a misspelled service name, or a `provideMarkerLayer` that is not exported from the main module, produces no error at all. Run `npm run check:services` to catch the second.

If a layer registers but never appears, open the renderer's layer picker first: a layer the user has disabled looks exactly like one that never registered. The maps keep separate lists, so a layer can be on in one and off in the other.

## Teardown

Add every subscription to `layer.disposables`. The hub disposes it when the layer is destroyed — when the editor closes, when your package deactivates, or when the hub itself is destroyed — and also cancels the pending throttle and clears `cache` and `items`.

To reach your layers from outside `getItems`, a plain `Map` keyed by editor is all it takes:

```js
initialize: (layer) => {
  this.layers.set(layer.editor, layer);
  layer.disposables.add(
    new Disposable(() => {
      this.layers.delete(layer.editor);
    }),
  );
},
```

You never dispose anything yourself: `consumeMarkerLayer` returns the `Disposable` that unregisters your layer from every editor.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
