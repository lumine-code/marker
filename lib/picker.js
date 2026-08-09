"use strict";

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

    this.selectList = lumine.workspace.buildSelectList({
      className,
      crumb: "Marker Layers",
      emptyMessage,
      willShow: () => {
        this.selectList.update({ items: this.items() });
      },
      filterKeyForItem: (item) => `${item.name} ${item.description ?? ""}`,
      elementForItem: (item, { highlight }) => {
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
      didConfirmSelection: (item) => {
        // Toggling keeps the list open on the same row: switching several layers
        // on and off in one pass is the normal way this list is used.
        const index = this.selectList.selectionIndex;
        this.toggle(item);
        this.selectList.update({ items: this.items() });
        this.selectList.selectIndex(index);
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
  }

  items() {
    return [...this.extras, ...this.registry.providers.values()];
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

  show() {
    this.selectList.toggle();
  }

  destroy() {
    this.selectList.destroy();
  }
}

module.exports = { LayerPicker };
