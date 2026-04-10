/**
 * @import { HTMLMultiCheckboxElement } from "../../../foundry/resources/app/client-esm/applications/elements/multi-select.mjs";
 * @import { FormInputConfig, SelectInputConfig } from "../../../foundry/resources/app/client-esm/applications/forms/fields.mjs"
 */

/**
 * A multi-checkbox element that includes a search bar to filter options.
 * @extends {HTMLMultiCheckboxElement}
 */
export default class HTMLSearchableMultiCheckboxElement
  extends foundry.applications.elements.HTMLMultiCheckboxElement
{
  /** @override */
  static tagName = "searchable-multi-checkbox";

  /**
   * The search input element.
   * @type {HTMLInputElement}
   */
  #search;

  /* -------------------------------------------- */

  /** @override */
  _buildElements() {
    const children = super._buildElements();

    this.#search = document.createElement("input");
    Object.assign(this.#search, {
      type: "search",
      placeholder: "Search options...",
      className: "multi-select-search",
    });

    const labels = children.flatMap((child) => {
      if (child instanceof HTMLFieldSetElement) {
        return Array.from(child.querySelectorAll("label.checkbox"));
      }
      return child.matches?.("label.checkbox") ? [child] : [];
    });

    for (const label of labels) {
      const checkbox = label.querySelector("input");
      const span = document.createElement("span");
      span.textContent = label.textContent.trim();
      label.replaceChildren(checkbox, span);
    }

    return [this.#search, ...children];
  }

  /* -------------------------------------------- */

  /** @override */
  _activateListeners() {
    super._activateListeners();
    this.#search.addEventListener("input", this.#onSearch.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle the search input event to filter visible checkboxes.
   * @param {InputEvent} event
   */
  #onSearch(event) {
    const query = event.target.value.toLowerCase();

    // Filter individual checkbox labels
    for (const checkbox of this.querySelectorAll("label.checkbox")) {
      const text = checkbox.innerText.toLowerCase();
      const isMatch = text.includes(query);
      checkbox.style.display = isMatch ? "" : "none";
    }

    // Hide or show groups (fieldsets) based on whether they contain visible children
    for (const group of this.querySelectorAll("fieldset.checkbox-group")) {
      const hasVisibleChildren = Array.from(
        group.querySelectorAll("label.checkbox"),
      ).some((label) => label.style.display !== "none");
      group.style.display = hasVisibleChildren ? "" : "none";
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _toggleDisabled(disabled) {
    super._toggleDisabled(disabled);
    this.#search.disabled = disabled;
  }

  /**
   * Create a HTMLSearchableMultiCheckboxElement using provided configuration data.
   * @param {FormInputConfig<string[]> & Omit<SelectInputConfig, "blank">} config
   * @returns {HTMLSearchableMultiCheckboxElement}
   */
  static create(config) {
    const element = document.createElement(this.tagName);

    element.name = config.name;
    foundry.applications.fields.setInputAttributes(element, config);

    const groups =
      foundry.applications.fields.prepareSelectOptionGroups(config);

    const _appendOption = (option, parent) => {
      const { value, label, selected, disabled, dataset } = option;
      if (value === undefined || label === undefined) return;

      const o = document.createElement("option");
      o.value = value;
      o.innerText = label;
      if (selected || config.value?.includes(value)) o.selected = true;
      if (disabled) o.disabled = true;

      if (dataset) {
        for (const [key, val] of Object.entries(dataset)) {
          o.dataset[key] = val;
        }
      }
      parent.appendChild(o);
    };

    const _appendOptgroup = (label, parent) => {
      const g = document.createElement("optgroup");
      g.label = label;
      parent.appendChild(g);
      return g;
    };

    for (const g of groups) {
      let parent = element;
      if (g.group) parent = _appendOptgroup(g.group, parent);
      for (const o of g.options) _appendOption(o, parent);
    }

    if (typeof element._initialize === "function") {
      element._initialize();
    }

    return element;
  }
}
