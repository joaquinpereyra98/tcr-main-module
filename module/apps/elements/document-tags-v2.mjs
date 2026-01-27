const { HTMLStringTagsElement, AbstractFormInputElement } =
  foundry.applications.elements;

/**
 * @import {FormInputConfig} from "@common/data/_types.mjs";
 */

/**
 * @typedef DocumentTagsInputConfig
 * @property {string} [type]      A specific document type in CONST.ALL_DOCUMENT_TYPES
 * @property {boolean} [single]   Only allow referencing a single document. In this case the submitted form value will
 *                                be a single UUID string rather than an array
 * @property {number} [max]       Only allow attaching a maximum number of documents
 */

/**
 * @typedef HTMLDocumentTagsOptions
 * @property {string[]} [values]  An array of Document UUIDs to initialize the element with.
 */

/**
 * A custom HTMLElement used to render a set of associated Documents referenced by UUID.
 * @extends {AbstractFormInputElement<string|string[]|null>}
 */
export default class HTMLDocumentTagsElementV2 extends AbstractFormInputElement {
  /**
   * @param {HTMLDocumentTagsOptions} [options]
   */
  constructor({ values } = {}) {
    super();
    this._initializeTags(values);
  }

  /** @override */
  static tagName = "document-tags-v2";

  /* -------------------------------------------- */

  /**
   * @override
   * @type {Record<string, string>}
   * @protected
   */
  _value = {};

  /**
   * The button element to add a new document.
   * @type {HTMLButtonElement}
   */
  #button;

  /**
   * The input element to define a Document UUID.
   * @type {HTMLInputElement}
   */
  #input;

  /**
   * The list of tagged documents.
   * @type {HTMLDivElement}
   */
  #tags;

  /* -------------------------------------------- */

  /**
   * Restrict this element to documents of a particular type.
   * @type {string|null}
   */
  get type() {
    return this.getAttribute("type");
  }

  set type(value) {
    if (!value) {
      this.removeAttribute("type");
      return;
    }
    if (!CONST.ALL_DOCUMENT_TYPES.includes(value)) {
      throw new Error(
        `"${value}" is not a valid Document type in CONST.ALL_DOCUMENT_TYPES`,
      );
    }
    this.setAttribute("type", value);
  }

  /* -------------------------------------------- */

  /**
   * Filter by the document subtypes.
   * @type {String[]|null}
   */
  get subtypes() {
    const attr = this.getAttribute("subtypes");
    return attr ? attr.split(",").map(s => s.trim()) : [];
  }

  set subtypes(value) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      this.removeAttribute("subtypes");
    } else {
      const normalized = Array.isArray(value) ? value.join(",") : value;
      this.setAttribute("subtypes", normalized);
    }
  }

  /* -------------------------------------------- */

  /**
   * Restrict to only allow referencing a single Document instead of an array of documents.
   * @type {boolean}
   */
  get single() {
    return this.hasAttribute("single");
  }

  set single(value) {
    this.toggleAttribute("single", value === true);
  }

  /* -------------------------------------------- */

  /**
   * Allow a maximum number of documents to be tagged to the element.
   * @type {number}
   */
  get max() {
    const max = parseInt(this.getAttribute("max"));
    return isNaN(max) ? Infinity : max;
  }

  set max(value) {
    if (Number.isInteger(value) && value > 0)
      this.setAttribute("max", String(value));
    else this.removeAttribute("max");
  }

  /* -------------------------------------------- */

  /**
   * Initialize innerText or an initial value attribute of the element as a serialized JSON array.
   * @param {string[]} [values]  An array of Document UUIDs to initialize the element with.
   * @protected
   */
  _initializeTags(values) {
    let tags = [];
    if (Array.isArray(values)) tags = values;
    else {
      const initial = this.getAttribute("value") || this.innerText || "";
      if (initial) tags = initial.split(",");
    }
    for (const t of tags) {
      try {
        this.#add(t);
      } catch (err) {
        this._value[t] = `${t} [INVALID]`; // Display invalid UUIDs as a raw string
      }
    }
    this.innerText = "";
    this.removeAttribute("value");
  }

  /* -------------------------------------------- */

  /** @override */
  _buildElements() {
    // Create tags list
    this.#tags = document.createElement("div");
    this.#tags.className = "tags input-element-tags";

    // Create input element
    this.#input = this._primaryInput = document.createElement("input");
    this.#input.type = "text";
    this.#input.placeholder = game.i18n.format(
      "HTMLDocumentTagsElement.PLACEHOLDER",
      {
        type: game.i18n.localize(
          this.type
            ? getDocumentClass(this.type).metadata.label
            : "DOCUMENT.Document",
        ),
      },
    );

    // Create button
    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.className = "icon";
    this.#button.innerHTML = `<i class="fa-solid fa-file-plus"></i>`
    this.#button.dataset.tooltip = "ELEMENTS.DOCUMENT_TAGS.Add";
    this.#button.setAttribute("aria-label", this.#button.dataset.tooltip);
    return [this.#tags, this.#input, this.#button];
  }

  /* -------------------------------------------- */

  /** @override */
  _refresh() {
    if (!this.#tags) return; // Not yet connected
    const tags = Object.entries(this._value).map(([k, v]) =>
      this.constructor.renderTag(k, v, this.editable),
    );
    this.#tags.replaceChildren(...tags);
  }

  /* -------------------------------------------- */

  /**
   * Create an HTML string fragment for a single document tag.
   * @param {string} uuid              The document UUID
   * @param {string} name              The document name
   * @param {boolean} [editable=true]  Is the tag editable?
   * @returns {HTMLDivElement}
   */
  static renderTag(uuid, name, editable = true) {
    const div = HTMLStringTagsElement.renderTag(
      uuid,
      TextEditor.truncateText(name, { maxLength: 32 }),
      editable,
    );
    div.classList.add("document-tag");
    div.querySelector("span").dataset.tooltipText = uuid;
    if (editable) {
      const t = game.i18n.localize("ELEMENTS.DOCUMENT_TAGS.Remove");
      const a = div.querySelector("a");
      a.dataset.tooltipText = t;
      a.ariaLabel = t;
    }
    return div;
  }

  /* -------------------------------------------- */

  /** @override */
  _activateListeners() {
    this.#button.addEventListener("click", () =>
      this.#tryAdd(this.#input.value),
    );
    this.#tags.addEventListener("click", this.#onClickTag.bind(this));
    this.#input.addEventListener("keydown", this.#onKeydown.bind(this));
    this.#input.addEventListener("change", (event) => event.stopPropagation());
    this.addEventListener("drop", this.#onDrop.bind(this), {
      signal: this.abortSignal,
    });
  }

  /* -------------------------------------------- */

  /**
   * Remove a single coefficient by clicking on its tag.
   * @param {PointerEvent} event
   */
  #onClickTag(event) {
    if (!event.target.classList.contains("remove") || !this.editable) return;
    const tag = event.target.closest(".tag");
    delete this._value[tag.dataset.key];
    this.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true }),
    );
    this._refresh();
  }

  /* -------------------------------------------- */

  /**
   * Add a new document tag by pressing the ENTER key in the UUID input field.
   * @param {KeyboardEvent} event
   */
  #onKeydown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    this.#tryAdd(this.#input.value);
  }

  /* -------------------------------------------- */

  /**
   * Handle data dropped onto the form element.
   * @param {DragEvent} event
   */
  #onDrop(event) {
    event.preventDefault();
    const dropData = TextEditor.getDragEventData(event);
    if (dropData.uuid) this.#tryAdd(dropData.uuid);
  }

  /* -------------------------------------------- */

  /**
   * Add a Document to the tagged set using the value of the input field.
   * @param {string} uuid     The UUID to attempt to add
   */
  #tryAdd(uuid) {
    try {
      this.#add(uuid);
      this._refresh();
    } catch (err) {
      ui.notifications.error(err.message);
    }
    this.#input.value = "";
    this.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true }),
    );
    this.#input.focus();
  }

  /* -------------------------------------------- */

  /**
   * Add a new UUID to the tagged set, throwing an error if the UUID is not valid.
   * @param {string} uuid   The UUID to add
   * @throws {Error}        If the UUID is not valid
   */
  #add(uuid) {
    if (!this.editable) return;
    const { type: requiredType, max, subtypes: requiredSubtypes } = this;

    // Require the UUID to be theoretically valid
    const { type, id, collection } = foundry.utils.parseUuid(uuid) ?? {};
    if (!collection || !foundry.data.validators.isValidId(id)) {
      throw new Error(
        `Provided UUID "${uuid}" does not contain a valid document ID "${id}"`,
      );
    }

    // Require specific Document type
    if (requiredType && type !== requiredType) {
      throw new Error(
        `Incorrect document type "${type}" provided to document tag field which requires` +
          `"${requiredType}" documents.`,
      );
    }

    // Restrict to a maximum number of tagged documents
    if (max && Object.keys(this._value).length >= max) {
      throw new Error(
        `You may only attach at most ${max} Documents to the "${this.name}" field`,
      );
    }

    // Replace singleton
    if (this.single) {
      for (const k of Object.keys(this._value)) delete this._value[k];
    }

    // Display the document name if known
    const record = fromUuidSync(uuid);
    if (requiredSubtypes.length > 0 && record) {
      const recordType = record.type.toLowerCase();
      const isAllowed = requiredSubtypes.some(s => s.toLowerCase() === recordType);
      
      if (!isAllowed) {
        throw new Error(
          `Incorrect subtype "${record.type}". Expected one of: ${requiredSubtypes.join(", ")}.`
        );
      }
    }

    this._value[uuid] = record?.name || `${type}: ${id}`;
  }

  /* -------------------------------------------- */
  /*  Form Handling                               */
  /* -------------------------------------------- */

  /** @override */
  _getValue() {
    const uuids = Object.keys(this._value);
    if (this.single) return uuids[0] ?? null;
    else return uuids;
  }

  /** @override */
  _setValue(value) {
    this._value = {};
    if (!value) return;
    if (typeof value === "string") value = [value];
    for (const uuid of value) this.#add(uuid);
  }

  /* -------------------------------------------- */

  /** @override */
  _toggleDisabled(disabled) {
    this.#input.disabled = disabled;
    this.#button.disabled = disabled;
  }

  /* -------------------------------------------- */

  /**
   * Create a HTMLDocumentTagsElement using provided configuration data.
   * @param {FormInputConfig & DocumentTagsInputConfig} config
   * @returns {HTMLDocumentTagsElement}
   */
  static create(config) {
    // Coerce value to an array
    let values;
    if (config.value instanceof Set) values = Array.from(config.value);
    else if (!Array.isArray(config.value)) values = [config.value];
    else values = config.value;

    const tags = new this({ values });
    tags.name = config.name;
    tags.setAttribute("value", values);
    tags.type = config.type;
    tags.subtypes = config.subtypes;
    tags.max = config.max;
    tags.single = config.single;
    foundry.applications.fields.setInputAttributes(tags, config);
    return tags;
  }
}
