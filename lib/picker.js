"use strict";

const { CompositeDisposable } = require("lumine");

// One picker for the hub, independent of which overview maps are installed.
// Disabled providers remain listed so the same action can restore them.
class LayerPicker {
  constructor(registry, window = lumine.workspace.getMainWindow()) {
    const document = window.getDocument();
    this.registry = registry;
    this.destroyed = false;
    this.disposables = new CompositeDisposable();

    this.selectListHost = lumine.workspace.addSelectList(
      {
        emptyMessage: "No marker layers registered",
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
      { className: "marker-view", crumb: "Marker Layers", window },
    );
    this.selectList = this.selectListHost.getModel();
    this.disposables.add(
      this.selectListHost.onDidOpen(() => {
        if (!this.destroyed) this.selectList.setItems(this.items());
      }),
      registry.onDidChangeLayers(() => {
        if (!this.destroyed && this.selectListHost.isVisible())
          this.selectList.setItems(this.items());
      }),
    );
  }

  items() {
    return [...this.registry.providers.values()];
  }

  isEnabled(item) {
    return this.registry.isEnabled(item.name);
  }

  toggle(item) {
    if (this.destroyed || !item) return false;
    return this.registry.setEnabled(item.name, !this.isEnabled(item));
  }

  toggleSelected(item) {
    if (item) this.toggle(item);
  }

  toggleFocus() {
    if (!this.destroyed) this.selectListHost.toggle();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposables.dispose();
    this.selectListHost.destroy();
  }
}

module.exports = { LayerPicker };
