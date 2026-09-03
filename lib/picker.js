"use strict";

const { CompositeDisposable } = require("lumine");

// The list a renderer switches its layers on and off from.
//
// Every map shows the same layers and differs only in which config key it
// writes and what it calls itself, so the hub builds the list and a renderer
// brings its `disabledKey`.
//
// `extras` are toggles a renderer owns rather than layers a package provides:
// they appear in the same list because to a reader they are the same question.
class LayerPicker {
  /**
   * @param {object} options
   * @param {Registry} options.registry The hub's layer registry.
   * @param {string} options.className Class for the select list.
   * @param {string} options.emptyMessage Shown when nothing is registered.
   * @param {string} options.disabledKey Config path holding this renderer's disabled layer names.
   * @param {Array<{name: string, description?: string, isEnabled: () => boolean, toggle: () => void}>} [options.extras]
   */
  constructor({ registry, className, emptyMessage, disabledKey, extras = [] }) {
    this.registry = registry;
    this.disabledKey = disabledKey;
    this.extras = extras;
    this.disposables = new CompositeDisposable();

    this.selectListHost = lumine.workspace.addSelectList(
      {
        emptyMessage,
        items: [],
        getItemId: (item) => item.name,
        search: { getFilterText: (item) => `${item.name} ${item.description ?? ""}` },
        renderItem: (item, { highlight }) => {
          const li = document.createElement("li");
          // primary line with icon, tag and description
          const primary = document.createElement("div");
          primary.classList.add("primary-line");
          const icon = document.createElement("span");
          icon.classList.add("icon", this.isEnabled(item) ? "icon-check" : "icon-circle-slash");
          primary.appendChild(icon);
          const tag = document.createElement("span");
          tag.classList.add("tag");
          tag.appendChild(highlight(item.name));
          primary.appendChild(tag);
          if (item.description) {
            primary.appendChild(document.createTextNode(item.description));
          }
          li.appendChild(primary);
          return li;
        },
        commands: {
          "marker:toggle-selected-layer": {
            description: "Show or hide the selected marker layer.",
            didDispatch: (event) => this.toggleSelected(event.detail.item),
          },
        },
        actions: [
          {
            command: "marker:toggle-selected-layer",
            context: "item",
            primary: true,
            disposition: "stay",
          },
        ],
      },
      { className, crumb: "Marker Layers" },
    );
    this.selectList = this.selectListHost.getModel();
    this.disposables.add(
      this.selectListHost.onDidOpen(() => this.selectList.setItems(this.items())),
    );
  }

  items() {
    // A provider switched off by its own `enabled` key is left out: it cannot
    // draw on any map, so a per-renderer toggle on it would be a lie.
    return [...this.extras, ...this.registry.enabledProviders()];
  }

  disabledLayers() {
    return lumine.config.get(this.disabledKey) ?? [];
  }

  isEnabled(item) {
    return item.isEnabled ? item.isEnabled() : !this.disabledLayers().includes(item.name);
  }

  toggle(item) {
    if (item.toggle) {
      item.toggle();
      return;
    }
    const disabled = [...this.disabledLayers()];
    const index = disabled.indexOf(item.name);
    if (index === -1) {
      disabled.push(item.name);
    } else {
      disabled.splice(index, 1);
    }
    lumine.config.set(this.disabledKey, disabled);
  }

  toggleSelected(item) {
    this.toggle(item);
    return this.selectList.setItems(this.items());
  }

  show() {
    this.selectListHost.toggle();
  }

  destroy() {
    this.disposables.dispose();
    this.selectListHost.destroy();
  }
}

module.exports = { LayerPicker };
