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
   * @param {string} options.className Class for the modal host element.
   * @param {string} options.emptyMessage Shown when nothing is registered.
   * @param {string} options.disabledKey Config path holding this renderer's disabled layer names.
   * @param {Array<{name: string, description?: string, isEnabled: () => boolean, toggle: () => void}>} [options.extras]
   */
  constructor({ registry, className, emptyMessage, disabledKey, extras = [] }) {
    this.registry = registry;
    this.className = className;
    this.emptyMessage = emptyMessage;
    this.disabledKey = disabledKey;
    this.extras = extras;
    // One view id per renderer, derived from the config key it writes, which is
    // the only input unique to a map by construction. `toggle` closes a session
    // already carrying the same root id, so two maps sharing one id would close
    // each other's list instead of replacing it.
    const scope = disabledKey.split(".").slice(0, -1);
    this.viewId = `marker.${(scope.length ? scope : [disabledKey]).join("-")}-layers`;
  }

  items() {
    return [...this.extras, ...this.registry.providers.values()];
  }

  disabledLayers() {
    return atom.config.get(this.disabledKey) ?? [];
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
    atom.config.set(this.disabledKey, disabled);
  }

  // The ViewSpec handed to `atom.modals`. Built per open so the list reflects
  // whatever is registered at that moment, the way `willShow` used to.
  spec() {
    return {
      id: this.viewId,
      className: this.className,
      emptyMessage: this.emptyMessage,
      source: () => this.items(),
      renderer: {
        // A refresh re-finds the focused row by this id, and a toggled layer
        // keeps its descriptor object, so identity is the descriptor itself.
        entry: (item) => ({ id: item, text: `${item.name} ${item.description ?? ""}` }),
        row: (item, ctx) => {
          // The name sits in its own `.tag` chip and the description trails it
          // as plain text; both maps style that from their own stylesheet.
          const label = document.createDocumentFragment();
          const tag = document.createElement("span");
          tag.classList.add("tag");
          tag.appendChild(ctx.highlight(item.name));
          label.appendChild(tag);
          if (item.description) {
            label.appendChild(document.createTextNode(item.description));
          }
          return {
            label,
            icon: this.isEnabled(item) ? ["icon-check"] : ["icon-circle-slash"],
          };
        },
      },
      confirm: ({ item }) => {
        // Toggling keeps the list open on the same row: switching several layers
        // on and off in one pass is the normal way this list is used.
        this.toggle(item);
        return { keepOpen: true, refresh: true };
      },
    };
  }

  show() {
    atom.modals.toggle(this.spec());
  }

  destroy() {
    // The kernel owns the modal, so teardown is only about not leaving this
    // renderer's list up once the renderer itself is gone.
    const session = atom.modals.getActiveSession();
    if (session && session.rootSpec.id === this.viewId) {
      session.cancel();
    }
  }
}

module.exports = { LayerPicker };
