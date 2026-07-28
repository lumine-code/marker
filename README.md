# marker

Host the marker layers drawn on the scrollbar and minimap.

Layer packages such as `marker-git-diff` or `marker-linter` register a descriptor here, the hub computes each layer's markers exactly once per editor, and the overview maps — `scrollmap` on the vertical scrollbar, `minimap` over the code — draw the shared result. Without at least one map installed the hub draws nothing itself.

## Features

- **One computation**: each layer's items are produced once per editor and shared by every map that draws them.
- **Layer lifecycle**: the hub owns per-editor layers, their throttles, caches and subscriptions, and tears them down when the last map lets go.
- **Draw toolkit**: maps draw through hub-supplied canvas machinery, so one stylesheet rule in a layer package paints identically everywhere.
- **Style probes**: marker colors, opacity and stacking are resolved from ordinary CSS, and a layer that resolves to no color is reported once instead of failing silently.
- **Layer pickers**: each map gets its own picker over the same registry, bound to its own disabled-layers setting.

## Installation

To install `marker` search for _marker_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/marker`.

## Services

- **[marker.layer](docs/marker.layer.md)** (`^1.0.0`): consumed to let packages register marker layers with the hub.
- **[marker.registry](docs/marker.registry.md)** (`1.0.0`): provided to the overview maps — every editor's computed layers plus the toolkit to draw them.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
