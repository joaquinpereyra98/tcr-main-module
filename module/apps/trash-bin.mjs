import { MODULE_ID, SETTINGS } from "../constants.mjs";
const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * @import { ApplicationClickAction, ApplicationConfiguration } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import Document from  "../../foundry/resources/app/common/abstract/document.mjs"
 */

/**
 * @callback _onDeleteOperationType
 * @param {Document[]} documents - The Document instances which were deleted
 * @param {import("../../foundry/resources/app/common/abstract/_types.mjs").DatabaseDeleteOperation} operation -Parameters of the database deletion operation
 * @param {User} user - The User who performed the deletion operation
 * @returns {Promise<void>}
 * @internal
 */

/**
 * @typedef {object} TrashStoreEntry
 * @property {string} id - The original document ID.
 * @property {string} name - The original document name.
 * @property {string} uuid - The full UUID of the deleted document.
 * @property {number} deletedAt - Epoch timestamp (in milliseconds) when the document was deleted.
 * @property {string} deletedBy - The ID of the User who deleted the document.
 * @property {object|null} parent - Parent document reference metadata, or null if unembedded.
 * @property {string} parent.uuid - The full UUID of the parent document.
 * @property {string|null} parent.type - The sub-type of the parent document, if applicable.
 * @property {string|null} pack - The compendium collection ID (e.g. "world.my-pack") if deleted from a pack.
 * @property {object} data - Complete serialized document source object.
 */

/**
 * @typedef {Object} ItemDelta
 * @property {Record<string, any>} item The cloned item data object, with updated quantity and flag attributes.
 * @property {number} quantity The net change in quantity applied to the item during this transaction.
 * @property {string} [type] The type classification of the item change (e.g., "item", "currency", "attribute").
 */

/**
 * @typedef {Object} PreparedTransaction
 * @property {Record<string, *>} documentChanges Key-value map of document attribute paths and their new target values.
 * @property {Array} itemsToCreate Array of raw item data objects staged for creation.
 * @property {string[]} itemsToDelete Array of item IDs scheduled to be removed from the document.
 * @property {Array} itemsToUpdate Array of partial item update objects (each containing an `_id`).
 * @property {Record<string, number>} attributeDeltas Key-value map of attribute paths to their net numerical change.
 * @property {ItemDelta[]} itemDeltas Array summarizing item quantity changes made during this transaction.
 */

const TRASH_TEMPLATE_PATH = `modules/${MODULE_ID}/templates/trash-bin`;
const TRASH_STORE_PATH = `modules/${MODULE_ID}/storage/trash-store`;

export default class TrashBin extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  /* -------------------------------------------- */
  /*  Static Properties & Constants               */
  /* -------------------------------------------- */

  /**
   * Default configuration options assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-trash-bin`,
    classes: [MODULE_ID, "trash-bin"],
    window: {
      icon: "fa-solid fa-trash",
      title: "Trash Bin",
      resizable: true,
    },
    position: { width: 920, height: 600 },
    actions: {
      selectDocType: TrashBin.#selectDocType,
      openEntry: TrashBin.#onOpenEntry,
      restoreEntry: TrashBin.#onRestoreEntry,
      deleteEntry: TrashBin.#onDeleteEntry,
      toggleSort: TrashBin.#onToggleSort,
    },
  };

  /** @override */
  static PARTS = {
    header: {
      template: `${TRASH_TEMPLATE_PATH}/trash-header.hbs`,
    },
    store: {
      template: `${TRASH_TEMPLATE_PATH}/trash-store.hbs`,
      scrollable: [".store-section"],
    },
  };

  /**
   * Batching configuration.
   */
  static BATCHING = {
    MARGIN: 50,
    SIZE: 25,
  };

  /**
   * Delay in milliseconds between user keypresses before executing a search.
   */
  static SEARCH_DELAY = 200;

  /**@enum {Number} */
  static SORT_DIRECTIONS = {
    ASCENDING: 1,
    DESCENDING: -1,
  };

  /**
   * Supported Foundry VTT Document types tracked by the trash bin.
   * @type {Record<string, { label: string, icon: string }>}
   */
  static DOC_TYPES = {
    ActiveEffect: {
      label: "DOCUMENT.ActiveEffect",
      icon: "fa-solid fa-bolt",
    },
    Actor: {
      label: "DOCUMENT.Actor",
      icon: "fa-solid fa-user",
    },
    Adventure: {
      label: "DOCUMENT.Adventure",
      icon: "fa-solid fa-compass",
    },
    Card: {
      label: "DOCUMENT.Card",
      icon: "fa-solid fa-card-spade",
    },
    Cards: {
      label: "DOCUMENT.Cards",
      icon: "fa-solid fa-cards",
    },
    Compendium: {
      label: "SIDEBAR.TabCompendium",
      icon: "fa-solid fa-atlas",
    },
    Folder: {
      label: "DOCUMENT.Folder",
      icon: "fa-solid fa-folder",
    },
    Item: {
      label: "DOCUMENT.Item",
      icon: "fa-solid fa-suitcase",
    },
    JournalEntry: {
      label: "DOCUMENT.JournalEntry",
      icon: "fa-solid fa-book-open",
    },
    JournalEntryPage: {
      label: "DOCUMENT.JournalEntryPage",
      icon: "fa-solid fa-file-lines",
    },
    Macro: {
      label: "DOCUMENT.Macro",
      icon: "fa-solid fa-code",
    },
    Note: {
      //texture.src
      label: "DOCUMENT.Note",
      icon: "fa-solid fa-bookmark",
    },
    Playlist: {
      label: "DOCUMENT.Playlist",
      icon: "fa-solid fa-music",
    },
    Region: {
      label: "DOCUMENT.Region",
      icon: "fa-regular fa-game-board",
    },
    RollTable: {
      label: "DOCUMENT.RollTable",
      icon: "fa-solid fa-table-list",
    },
    Scene: {
      //background.src
      label: "DOCUMENT.Scene",
      icon: "fa-solid fa-map",
    },
  };

  /**
   * Set of document IDs ignored during deletion handling.
   * @type {Set<string>}
   */
  static ignore = new Set();

  /**
   * Set of document types that currently have an existing JSON trash store file.
   * @type {Set<string>}
   */
  static #storeNames = new Set();

  /** @type {boolean} Flag indicating whether store paths have been fetched once */
  static #isInitialized = false;

  /** @type {Promise<Set<string>>|null} Promise lock to prevent concurrent redundant fetches */
  static #initPromise = null;

  /**
   * Queue mapping for save operations per document type to avoid race conditions.
   * @type {Map<string, { isSaving: boolean, pendingMutators: Array<Function|TrashStoreEntry[]> }>}
   */
  static #saveQueue = new Map();

  /* -------------------------------------------- */
  /*  Static Getters                              */
  /* -------------------------------------------- */

  /**
   * Retrieves the current active module socket instance.
   * @type {object}
   * @readonly
   */
  static get socket() {
    const module = game.modules.get(MODULE_ID);
    return module.socket;
  }

  /**
   * Unique identifier key used for socket event messaging.
   * @type {string}
   * @readonly
   */
  static get SOCKET_KEY() {
    return `${MODULE_ID}.refreshTrashBinStore`;
  }

  /**
   * The unique key used for the module application.
   * @type {string}
   * @readonly
   */
  static get KEY() {
    return `${MODULE_ID}.TrashBin`;
  }

  /**
   * Retrieves the active singleton application instance`.
   * @type {TrashBin|undefined}
   * @readonly
   */
  static get instance() {
    return ui[TrashBin.KEY];
  }

  /* -------------------------------------------- */
  /*  Static Setup & Event Listeners              */
  /* -------------------------------------------- */

  /**
   * Registers socket listeners for cross-client store synchronization.
   */
  static _registerSocketListeners() {
    this.socket.register(TrashBin.SOCKET_KEY, (socketData) => {
      this._handleRemoteRefresh(socketData);
    });
  }

  /**
   * Handles remote socket updates triggered when another user mutates a trash store.
   * @param {string} docType - The document type name sent via socket message.
   * @protected
   */
  static _handleRemoteRefresh(docType) {
    const instance = TrashBin.instance;
    if (!instance) return;

    const formattedType = docType.capitalize();
    instance.#reloadFlag[formattedType] = true;

    if (instance.rendered && instance.#currentType === formattedType) {
      instance.render({ parts: ["store"] });
    }
  }

  /**
   * Registers module configuration settings for retention management.
   */
  static registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.TRASH_RETENTION_DAYS, {
      name: "Retention Period (Days)",
      hint: "Number of days before deleted items are permanently purged from the JSON registry.",
      scope: "world",
      config: true,
      type: Number,
      default: 14,
      onChange: () => TrashBin.pruneExpiredEntries(),
    });
  }

  /**
   * Registers `libWrapper` patches on document standard `_onDeleteOperation` methods.
   */
  static registerPatch() {
    for (const docName of Object.keys(TrashBin.DOC_TYPES)) {
      if (docName === "Compendium") continue;
      const CLS = getDocumentClass(docName);
      if (!CLS) continue;

      libWrapper.register(
        MODULE_ID,
        `CONFIG.${docName}.documentClass._onDeleteOperation`,
        async function (wrapped, documents, operation, user) {
          TrashBin._onDeleteOperation.call(
            this,
            foundry.utils.deepClone(documents),
            foundry.utils.deepClone(operation),
            foundry.utils.deepClone(user),
          );
          return await wrapped(documents, operation, user);
        },
        "WRAPPER",
      );
    }

    libWrapper.register(
      MODULE_ID,
      `CompendiumCollection.prototype.deleteCompendium`,
      async function (wrapped) {
        await TrashBin._onDeleteCompendium.call(this);
        return await wrapped();
      },
      "WRAPPER",
    );
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /** @type {Record<string, boolean>} Internal flags indicating whether a document type store needs reloading */
  #reloadFlag = Object.fromEntries(
    Object.keys(TrashBin.DOC_TYPES).map((k) => [k, true]),
  );

  /** @type {string} Currently selected document type filter */
  #currentType = "Actor";

  /** @type {string} Active search string query filter */
  #searchQuery = "";

  /** @type { 1 | -1 } Active direction sorting multiplier */
  #sortDirection = TrashBin.SORT_DIRECTIONS.DESCENDING;

  /** @type {Record<string, TrashStoreEntry[] | Promise<TrashStoreEntry[]>>} Cached trash store lists by document type */
  #trashStores = Object.fromEntries(
    Object.keys(TrashBin.DOC_TYPES).map((type) => [type, []]),
  );

  /** @type {Promise<TrashStoreEntry[]>|TrashStoreEntry[]} Active filtered and sorted results array */
  #results = [];

  /** @type {number} Current index marker for batch rendering */
  #resultIndex = -1;

  /** @type {boolean} Throttle flag for scroll handling */
  #renderThrottle = false;

  /** @type {object} Scroll position cache */
  #contentScroll = {};

  /** @type {number|null} Store the timer ID for interval updates */
  #timeUpdateInterval = null;

  /** @type {number} Default item card size in pixels */
  #gridSize = 100;

  /**
   * Debounced search function.
   * @type {Function}
   */
  _debouncedSearch = foundry.utils.debounce(
    this._onSearchName.bind(this),
    this.constructor.SEARCH_DELAY,
  );

  /**
   * Debounced callback to recalculate scroll position for results.
   * @type {Function}
   */
  _debouncedResizeResults = foundry.utils.debounce(() => {
    const storeEl = this.element?.querySelector(".store-section");
    if (storeEl) {
      this._onScrollResults({ target: storeEl });
    }
  }, 50);

  /* -------------------------------------------- */
  /*  Instance Getters & Setters                  */
  /* -------------------------------------------- */

  /**
   * Extracted document type names from cached store file paths.
   * @type {Set<string>}
   * @readonly
   */
  get storeNames() {
    if (!TrashBin.#isInitialized) TrashBin.getStorePaths();
    return TrashBin.#storeNames;
  }

  /**
   * Mapping of tracked trash store entries by document type.
   * @type {Record<string, TrashStoreEntry[]|Promise<TrashStoreEntry[]>>}
   * @readonly
   */
  get trashStores() {
    return this.#trashStores;
  }

  /**
   * Active grid icon size pulled from user settings flags or default fallback.
   * @type {number}
   */
  get _gridSize() {
    const userFlag = game.user.getFlag(MODULE_ID, "tashBinGridSize");
    return Number.isNumeric(userFlag) ? Number(userFlag) : this.#gridSize;
  }

  set _gridSize(val) {
    this.#gridSize = val;
  }

  /* -------------------------------------------- */
  /*  Application Lifecycle                       */
  /* -------------------------------------------- */

  /**@inheritdoc */
  _replaceHTML(result, content, options) {
    const { scrollTop, scrollLeft } = content;
    Object.assign(this.#contentScroll, { scrollTop, scrollLeft });
    super._replaceHTML(result, content, options);
  }

  /** @inheritDoc */
  _onPosition(position) {
    super._onPosition(position);
    this._debouncedResizeResults();
  }

  /** @inheritDoc */
  _attachFrameListeners() {
    super._attachFrameListeners();
    this.element.addEventListener(
      "scroll",
      this._debouncedResizeResults.bind(this),
      {
        capture: true,
        passive: true,
      },
    );
    this.element.addEventListener("keydown", this._debouncedSearch.bind(this), {
      passive: true,
    });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    if (options.parts?.includes("store") || !options.parts) {
      const storeEl = this.element?.querySelector(".store-section");
      if (storeEl) this._onScrollResults({ target: storeEl });
    }

    /**@type {HTMLInputElement} */
    const rangeInput = this.element.querySelector(
      ".size-range-picker > input[type=range]",
    );
    if (rangeInput) {
      rangeInput.addEventListener("input", this.onSliderChange.bind(this));
    }
    this.updateGridSizeCSS();

    this._startTimeSinceInterval();
  }

  /** @inheritDoc */
  _onClose(options = {}) {
    this._stopTimeSinceInterval();
    super._onClose(options);
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const store = Object.entries(TrashBin.DOC_TYPES).map(([name, config]) => {
      return {
        name,
        label: game.i18n.localize(config.label),
        icon: config.icon,
        active: name === this.#currentType,
      };
    });

    return {
      ...context,
      rootId: this.id,
      store,
      gridSize: this._gridSize,
      isSortAsc: this.#sortDirection === TrashBin.SORT_DIRECTIONS.ASCENDING,
    };
  }

  /** @inheritDoc */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "store") {
      this._renderResults();
    }
  }

  /* -------------------------------------------- */
  /*  Results Rendering & Processing              */
  /* -------------------------------------------- */

  /**
   * Fetches, filters, and sorts trash store entries for the active document type.
   * @returns {Promise<void>}
   */
  async prepareStoresEntries() {
    const type = this.#currentType;
    if (this.#reloadFlag[type]) {
      this.#trashStores[type] = this.storeNames.has(type)
        ? TrashBin.loadTrashStore(type)
        : [];

      this.#reloadFlag[type] = false;
    }

    let entries = await this.#trashStores[type];

    // Filter by search query
    if (this.#searchQuery?.trim()) {
      const q = this.#searchQuery.toLowerCase();
      entries = entries.filter((e) => e.name?.toLowerCase().includes(q));
    }

    // Sort by deletedAt timestamp
    entries.sort((a, b) => {
      const timeA = a.deletedAt ?? 0;
      const timeB = b.deletedAt ?? 0;
      return (timeA - timeB) * this.#sortDirection;
    });

    this.#results = entries;
  }

  /**
   * Prepares render context data for a single store entry item.
   * @param {TrashStoreEntry} entry
   * @returns {Promise<object>}
   * @protected
   */
  async _prepareItemContext(entry) {
    const user = game.users.get(entry.deletedBy) ?? entry.deletedBy;
    const inCompendium = !!entry.pack;
    const isPack = this.#currentType === "Compendium";
    const inEmbedded = !!entry?.parent;

    let canRestore = true;
    let restoreTooltip = "Restore Document";

    if (inCompendium) {
      const compendium = game.packs.get(entry.pack);
      if (!compendium) {
        canRestore = false;
        restoreTooltip =
          "Cannot restore: Origin compendium pack no longer exists";
      } else if (compendium.locked) {
        canRestore = false;
        restoreTooltip = "Cannot restore: Target compendium pack is locked";
      }
    }

    if (canRestore && inEmbedded) {
      const parentDoc = await fromUuid(entry.parent.uuid).catch(() => null);
      if (!parentDoc) {
        canRestore = false;
        restoreTooltip = "Cannot restore: Parent document no longer exists";
      }
    }

    if (["Note", "Scene"].includes(this.#currentType)) {
      const { background, texture } = entry.data;
      entry.data.img ??= texture?.src ?? background?.src ?? "";
      entry.data.name ??= entry.data.text;
    }

    const context = {
      ...entry,
      user,
      inCompendium,
      inEmbedded,
      isPack,
      canRestore,
      restoreTooltip,
      timeSinceDeleted: foundry.utils.timeSince(entry.deletedAt),
      fullDeletedDate: new Date(entry.deletedAt).toLocaleString(),
    };

    if (isPack) {
      context.folders = entry.data.folders ?? 0;
      context.documents = entry.data.documents ?? 0;
      context.packType = TrashBin.DOC_TYPES[entry.data.type];
      const map = { world: World, system: System, module: Module };
      const pkg = map[entry.data.packageType];

      context.sourceType = {
        icon: pkg?.icon,
        label: pkg?.name,
      };
    }

    return context;
  }

  /**
   * Process and render initial store list results or reset on fresh load.
   * @protected
   */
  async _renderResults() {
    this.#resultIndex = 0;
    const storeEl = this.element?.querySelector(
      '[data-application-part="store"]',
    );

    if (!storeEl) return;

    const itemList = storeEl.querySelector(".bin-list");
    if (itemList) itemList.replaceChildren();

    const loadingEl = this.element.querySelector(".store-loading");
    if (loadingEl) loadingEl.hidden = false;

    const emptyEl = this.element.querySelector(".store-empty");
    if (emptyEl) emptyEl.hidden = true;

    await this.prepareStoresEntries();

    if (loadingEl) loadingEl.hidden = true;
    if (emptyEl) emptyEl.hidden = this.#results.length > 0;

    const scrollContainer = this.element.querySelector(".store-section");
    if (scrollContainer) {
      await this._onScrollResults({ target: scrollContainer });
    }
  }

  /**
   * Handles batching entries into DOM nodes when the user scrolls near the bottom of the container.
   * @param {Event|HTMLElement} event - The DOM scroll event or scrollable HTML container element.
   * @protected
   */
  async _onScrollResults(event) {
    const target = event.target ?? event;
    if (this.#renderThrottle || !target?.matches?.(".store-section")) return;

    if (
      this.#results instanceof Promise ||
      this.#resultIndex >= this.#results.length
    )
      return;

    const templatePath = `${TRASH_TEMPLATE_PATH}/store-entry.hbs`;

    while (
      this.#resultIndex < this.#results.length &&
      (target.scrollHeight <= target.clientHeight ||
        target.scrollTop + target.clientHeight >=
          target.scrollHeight - this.constructor.BATCHING.MARGIN)
    ) {
      this.#renderThrottle = true;

      const batchStart = this.#resultIndex;

      const batchEnd = Math.min(
        batchStart + this.constructor.BATCHING.SIZE,
        this.#results.length,
      );

      const batchEntries = this.#results.slice(batchStart, batchEnd);
      const contexts = await Promise.all(
        batchEntries.map((entry) => this._prepareItemContext(entry)),
      );

      const htmlStrings = await Promise.all(
        contexts.map((ctx) => renderTemplate(templatePath, ctx)),
      );

      const container = this.element.querySelector(".bin-list");
      if (container && htmlStrings.length > 0) {
        const range = document.createRange();
        range.selectNodeContents(container);
        const fragment = range.createContextualFragment(htmlStrings.join(""));
        container.appendChild(fragment);
      }

      this.#resultIndex = batchEnd;

      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    this.#renderThrottle = false;
  }

  /* -------------------------------------------- */
  /*  Event Handlers & UI Updates                 */
  /* -------------------------------------------- */

  /**
   * Debounced callback to update search input.
   * @param {Event} event - Input keyboard or search event.
   * @protected
   */
  _onSearchName(event) {
    if (!event.target.matches('input[type="search"]')) return;
    this.#searchQuery = event.target.value;
    this.render({ parts: ["store"] });
  }

  /**
   * Debounced function to save the grid size flag to avoid write spam while dragging.
   * @type {Function}
   */
  _debouncedSaveGridSize = foundry.utils.debounce((val) => {
    game.user.setFlag(MODULE_ID, "tashBinGridSize", val);
  }, 100);

  /**
   * Event handler for grid size range slider changes.
   * @param {Event} event - HTML range input event.
   */
  onSliderChange(event) {
    const val = Number(event.target.value ?? 0);
    this._gridSize = val;

    this.updateGridSizeCSS(val);
    this._debouncedSaveGridSize(val);
  }

  /**
   * Updates CSS custom properties on the container element to adjust grid item rendering width.
   */
  updateGridSizeCSS(val = this._gridSize) {
    this.element.style.setProperty("--grid-size", `${val + 140}px`);
  }

  /* -------------------------------------------- */
  /*  Timestamp Interval Management               */
  /* -------------------------------------------- */

  /**
   * Starts a periodic timer to update time-since-deleted timestamps in place.
   */
  _startTimeSinceInterval() {
    this._stopTimeSinceInterval(); // Ensure any existing interval is cleared first

    // Updates every 20 seconds
    this.#timeUpdateInterval = setInterval(() => {
      this._updateRelativeTimestamps();
    }, 20 * 1000);
  }

  /**
   * Stops the active relative time update timer.
   */
  _stopTimeSinceInterval() {
    if (this.#timeUpdateInterval) {
      clearInterval(this.#timeUpdateInterval);
      this.#timeUpdateInterval = null;
    }
  }

  /**
   * Iterates through rendered item elements and updates relative timestamps.
   * @protected
   */
  _updateRelativeTimestamps() {
    const storeSection = this.element?.querySelector(".store-section");
    if (!storeSection) return;

    const timeNodes = storeSection.querySelectorAll(
      ".item-deleted-time[data-timestamp]",
    );
    for (const node of timeNodes) {
      const span = node.querySelector("span");
      const timestamp = Number(node.dataset.timestamp);
      if (span) span.textContent = foundry.utils.timeSince(timestamp);
    }
  }

  /* -------------------------------------------- */
  /*  Private Application Actions                 */
  /* -------------------------------------------- */

  /**
   * Action handler to switch visible document type tab.
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static #selectDocType(_, target) {
    this.#currentType = target.dataset.docType.capitalize() ?? "Actor";
    this.#searchQuery = "";
    this.#resultIndex = 0;
    this.#results = [];

    const storeSection = this.element?.querySelector(".store-section");
    if (storeSection) storeSection.scrollTop = 0;
    this.render({ parts: ["header", "store"] });
  }

  /**
   * Action handler to preview or open a read-only sheet for a deleted entry.
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static async #onOpenEntry(_, target) {
    const { entryId } = target.closest("[data-entry-id]")?.dataset ?? {};
    const entries = await this.#trashStores[this.#currentType];
    const entry = entries?.find((e) => e.id === entryId);
    if (!entry || this.#currentType === "Compendium") return;

    let parent = null;
    if (entry.parent) {
      const { uuid, type } = entry.parent;
      parent = await fromUuid(uuid).catch(() => null);
      const { documentType, documentId } = foundry.utils.parseUuid(uuid);
      if (!parent && documentType) {
        const ParentCls = getDocumentClass(documentType);
        if (ParentCls) {
          parent = new ParentCls(
            {
              _id: documentId ?? "trashparent00000",
              name: "Deleted Parent",
              type,
            },
            { keepId: true },
          );
        }
      }
    }
    const cls = getDocumentClass(this.#currentType);
    const doc = new cls(entry.data, { parent, keepId: true });
    doc.sheet.render(true, { editable: false });
  }

  /**
   * Action handler to restore a deleted entry back to its original location.
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static async #onRestoreEntry(_, target) {
    const { entryId } = target.closest("[data-entry-id]")?.dataset ?? {};
    const entries = await this.#trashStores[this.#currentType];
    const entry = entries?.find((e) => e.id === entryId);
    if (!entry) return;

    try {
      if (this.#currentType === "Compendium") {
        const metadata = entry.data;
        const contentStore = await TrashBin.loadCompendiumContentStore(
          entry.id,
        );

        if (!contentStore) {
          throw new Error(
            `Could not find compendium details file for "${entry.id}".`,
          );
        }

        const { folders, documents } = contentStore;
        const pack = await CompendiumCollection.createCompendium(metadata);

        if (folders?.length) {
          await Folder.createDocuments(folders, {
            pack: pack.collection,
            keepId: true,
          });
        }

        if (documents?.length) {
          await pack.documentClass.createDocuments(documents, {
            pack: pack.collection,
            keepId: true,
          });
        }

        await TrashBin.deleteCompendiumContentStore(entry.id);
      } else if (entry.parent) {
        const parentDoc = await fromUuid(entry.parent.uuid);
        if (!parentDoc) throw new Error("Parent document no longer exists.");

        await parentDoc.createEmbeddedDocuments(
          this.#currentType,
          [entry.data],
          {
            keepId: true,
          },
        );
      } else if (entry.pack) {
        const pack = game.packs.get(entry.pack);
        if (!pack)
          throw new Error(
            `Compendium collection "${entry.pack}" no longer exists.`,
          );
        if (pack.locked)
          throw new Error(`Compendium collection "${entry.pack}" is locked.`);

        await pack.documentClass.create(entry.data, {
          pack: entry.pack,
          keepId: true,
        });
      } else {
        const cls = getDocumentClass(this.#currentType);
        await cls.create(entry.data, { keepId: true });
      }

      await TrashBin.saveTrashStore(this.#currentType, (currentStore) => {
        return currentStore.filter((e) => e.id !== entryId);
      });

      ui.notifications.info(
        `Restored ${this.#currentType}: "${entry.name ?? entry.text}"`,
      );
      this.render({ parts: ["store"] });
    } catch (err) {
      console.error(`${MODULE_ID} | Error restoring entry:`, err);
      ui.notifications.error(`Failed to restore ${entry.name}: ${err.message}`);
    }
  }

  /**
   * Action handler to permanently purge a single entry from the trash store.
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static async #onDeleteEntry(_, target) {
    const { entryId } = target.closest("[data-entry-id]")?.dataset ?? {};
    const entries = await this.#trashStores[this.#currentType];
    const entry = entries?.find((e) => e.id === entryId);
    if (!entry) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Permanently Delete Document" },
      content: `<p>Are you sure you want to permanently delete <strong>${entry.name}</strong>?</p><p>This action cannot be undone.</p>`,
      rejectClose: false,
    });

    if (!confirmed) return;

    if (this.#currentType === "Compendium") {
      await TrashBin.deleteCompendiumContentStore(entry.id);
    }

    await TrashBin.saveTrashStore(this.#currentType, (currentStore) => {
      return currentStore.filter((e) => e.id !== entryId);
    });

    ui.notifications.info(`Permanently deleted "${entry.name}" from trash.`);
    this.render({ parts: ["store"] });
  }

  /**
   * Action handler to toggle the entry sorting order (ascending / descending).
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static async #onToggleSort(_, target) {
    this.#sortDirection = this.#sortDirection * -1;

    target.querySelector("i").className =
      this.#sortDirection === TrashBin.SORT_DIRECTIONS.ASCENDING
        ? "fa-solid fa-arrow-down-wide-short"
        : "fa-solid fa-arrow-up-wide-short";

    this.render({ parts: ["store"] });
  }
  /* -------------------------------------------- */
  /*  Document Interception Hooks                 */
  /* -------------------------------------------- */

  /**
   * Handles capturing deleted items and storing them into the JSON file.
   * @type {_onDeleteOperationType}
   * @this {typeof Document}
   */
  static async _onDeleteOperation(documents, operation, user) {
    if (!user.isSelf) return;

    await TrashBin.getStorePaths();

    const now = Date.now();
    const newEntries = [];

    for (const doc of documents) {
      const id = doc.id ?? doc._id;
      if (TrashBin.ignore.has(id)) {
        TrashBin.ignore.delete(id);
        continue;
      }

      newEntries.push({
        id,
        name: doc.name,
        uuid: doc.uuid,
        deletedAt: now,
        deletedBy: user.id,
        parent: doc.parent
          ? {
              uuid: doc.parent.uuid,
              type: doc.parent.type ?? null,
            }
          : null,
        pack: doc.pack,
        data: doc.toObject(),
      });
    }

    if (!newEntries.length) return;

    const docType = this.documentName.capitalize();

    await TrashBin.saveTrashStore(docType, (currentStore) => {
      return [...currentStore, ...newEntries];
    });
    TrashBin.#storeNames.add(docType);
    TrashBin.instance.render({ parts: ["store"] });
  }

  /**
   * Intercepts compendium deletion, extracts metadata, folders, and contents, and stores them in trash.
   * @this {CompendiumCollection}
   */
  static async _onDeleteCompendium() {
    if (!game.user.isGM) return;

    await TrashBin.getStorePaths();

    const folders = this.folders._source;
    const documents = (await this.getDocuments()).map((d) => d.toObject());

    const metadata = foundry.utils.mergeObject(
      this.metadata,
      {
        folders: folders.length,
        documents: documents.length,
      },
      { inplace: false },
    );

    await TrashBin.saveCompendiumContentStore(this.collection, {
      key: this.collection,
      folders,
      documents,
    });

    const newEntry = {
      id: this.collection,
      name: this.title ?? metadata.label,
      deletedAt: Date.now(),
      deletedBy: game.user.id,
      data: metadata,
    };

    await TrashBin.saveTrashStore("Compendium", (currentStore) => {
      return [...currentStore, newEntry];
    });

    TrashBin.#storeNames.add("Compendium");

    if (TrashBin.instance) {
      TrashBin.instance.render({ parts: ["store"] });
    }
  }

  /**
   * Hook callback triggered before items are transferred between two actors/tokens.
   * @param {Actor|TokenDocument} sourceActor - The source actor or token document losing items.
   * @param {PreparedTransaction} sourceUpdates - The prepared transaction data for the source actor, containing item changes and removals (`itemsToDelete`, `itemDeltas`, etc.).
   * @param {Actor|TokenDocument} targetActor - The target actor or token document receiving items.
   * @param {PreparedTransaction} targetUpdates - The prepared transaction data for the target actor.
   * @param {string|boolean} interactionId - The unique identifier for the interaction, or `false` if none was provided.
   * @returns {boolean|void}
   */
  static preTransferItems(
    _source,
    sourceUpdates,
    _target,
    _targetUpdates,
    _interactionId,
  ) {
    const { itemsToDelete } = sourceUpdates;
    if (!itemsToDelete.length) return;
    itemsToDelete.forEach((id) => TrashBin.ignore.add(id));
  }

  /* -------------------------------------------- */
  /*  Store Storage & Maintenance                 */
  /* -------------------------------------------- */

  /**
   * Fetches existing trash JSON store names and caches them in memory.
   * @returns {Promise<Set<string>>}
   */
  static async getStorePaths() {
    if (this.#isInitialized) return this.#storeNames;
    if (this.#initPromise) return this.#initPromise;

    this.#initPromise = (async () => {
      try {
        const { files } = await FilePicker.browse("data", TRASH_STORE_PATH, {
          extensions: [".json"],
        });

        const storeNames = files
          .map((path) => path.split("/").pop().replace(".json", ""))
          .filter((fileName) => fileName && fileName === fileName.capitalize());

        this.#storeNames = new Set(storeNames);
      } catch {
        this.#storeNames.clear();
      } finally {
        this.#isInitialized = true;
        this.#initPromise = null;
      }
      return this.#storeNames;
    })();

    return this.#initPromise;
  }

  /**
   * Loads the stored JSON trash store file for a specific document type.
   * @param {string} docType - The document type key to load.
   * @returns {Promise<TrashStoreEntry[]>}
   */
  static async loadTrashStore(docType) {
    if (!docType) return [];

    const filePath = `${TRASH_STORE_PATH}/${docType.capitalize()}.json`;

    try {
      return await foundry.utils.fetchJsonWithTimeout(
        `${filePath}?t=${Date.now()}`,
        {},
        { timeoutMs: 5000 },
      );
    } catch (err) {
      console.warn(
        `${MODULE_ID} | No existing trash store found for ${docType}:`,
        err.message,
      );
    }
    return [];
  }

  /**
   * Writes updated document entries for a document type to its persistent JSON file.
   * Accepts either an array of entries or a mutation callback `(currentStore) => updatedStore`.
   * Queues concurrent calls per document type to batch/merge writes safely.
   *
   * @param {string} docType - The document type key to save.
   * @param {TrashStoreEntry[] | ((currentStore: TrashStoreEntry[]) => TrashStoreEntry[])} storeOrMutator - The updated entries or mutation function.
   * @returns {Promise<void>}
   */
  static async saveTrashStore(docType, storeOrMutator) {
    const formattedType = docType.capitalize();

    if (!this.#saveQueue.has(formattedType)) {
      this.#saveQueue.set(formattedType, {
        isSaving: false,
        pendingMutators: [],
      });
    }

    const queue = this.#saveQueue.get(formattedType);
    queue.pendingMutators.push(storeOrMutator);

    if (queue.isSaving) return;
    queue.isSaving = true;

    try {
      while (queue.pendingMutators.length > 0) {
        const batch = queue.pendingMutators.splice(
          0,
          queue.pendingMutators.length,
        );

        let currentStore = await TrashBin.loadTrashStore(formattedType);

        for (const mutator of batch) {
          currentStore =
            typeof mutator === "function" ? mutator(currentStore) : mutator;
        }

        const file = new File(
          [JSON.stringify(currentStore, null, 2)],
          `${formattedType}.json`,
          { type: "application/json" },
        );

        try {
          await FilePicker.uploadPersistent(
            MODULE_ID,
            "trash-store",
            file,
            {},
            { notify: false },
          );

          TrashBin.socket.executeForOthers(TrashBin.SOCKET_KEY, formattedType);
        } catch (err) {
          console.error(
            `${MODULE_ID} | Failed to upload JSON store for ${formattedType}:`,
            err,
          );
        }
      }
    } finally {
      queue.isSaving = false;
    }
  }

  /**
   * Saves compendium contents files
   * @param {string} packKey - E.g. "world.my-pack"
   * @param {object} contentData
   */
  static async saveCompendiumContentStore(packKey, contentData) {
    const file = new File(
      [JSON.stringify(contentData, null, 2)],
      `${packKey}.json`,
      { type: "application/json" },
    );
    try {
      await FilePicker.uploadPersistent(
        MODULE_ID,
        "trash-store/compendium-store",
        file,
        {},
        { notify: false },
      );
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to upload compendium store file for ${packKey}:`,
        err,
      );
    }
  }

  /**
   * Loads full compendium contents
   * @param {string} packKey
   * @returns {Promise<object|null>}
   */
  static async loadCompendiumContentStore(packKey) {
    try {
      return await foundry.utils.fetchJsonWithTimeout(
        `${TRASH_STORE_PATH}/compendium-store/${packKey}.json?t=${Date.now()}`,
        {},
        { timeoutMs: 5000 },
      );
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Failed to load compendium details for ${packKey}:`,
        err.message,
      );
    }
    return null;
  }

  /**
   * Deletes a compendium contents file.
   * @param {string} packKey
   */
  static async deleteCompendiumContentStore(packKey) {
    try {
      const file = new File([JSON.stringify({}, null, 2)], `${packKey}.json`, {
        type: "application/json",
      });

      await FilePicker.uploadPersistent(
        MODULE_ID,
        "trash-store/compendium-store",
        file,
        {},
        { notify: false },
      );
    } catch (err) {}
  }

  /**
   * Auto-prunes entries that exceed the retention period set in settings across all stores.
   * @returns {Promise<void>}
   */
  static async pruneExpiredStore() {
    if (!game.user.isGM) return;

    const retentionDays = game.settings.get(
      MODULE_ID,
      SETTINGS.TRASH_RETENTION_DAYS,
    );
    if (!retentionDays || retentionDays <= 0) return;

    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    await TrashBin.getStorePaths();

    let storeChanged = false;
    for (const docType of TrashBin.#storeNames) {
      const store = await TrashBin.loadTrashStore(docType);
      if (!store.length) continue;

      const validEntries = store.filter(
        (entry) => entry.deletedAt > cutoffTime,
      );

      if (validEntries.length !== store.length) {
        await TrashBin.saveTrashStore(docType, validEntries);
        TrashBin.#storeNames.add(docType);
        storeChanged = true;

        TrashBin.socket?.executeForOthers("refreshTrashBinStore", docType);
      }
    }

    if (storeChanged && TrashBin.instance?.rendered) {
      TrashBin.instance.render({ parts: ["store"] });
    }
  }
}
