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
    },
  };

  /** @override */
  static PARTS = {
    header: {
      template: `${TRASH_TEMPLATE_PATH}/trash-header.hbs`,
    },
    store: {
      template: `${TRASH_TEMPLATE_PATH}/trash-store.hbs`,
      scrollable: [""],
    },
  };

  /* -------------------------------------------- */
  /*  Batching & Search Configuration             */
  /* -------------------------------------------- */

  /**
   * Batching configuration ported from CompendiumBrowser.
   */
  static BATCHING = {
    MARGIN: 50,
    SIZE: 50,
  };

  /**
   * Delay in milliseconds between user keypresses before executing a search.
   */
  static SEARCH_DELAY = 200;

  /* -------------------------------------------- */
  /*  Socket Messaging & Syncing                  */
  /* -------------------------------------------- */

  static get socket() {
    const module = game.modules.get(MODULE_ID);
    return module.socket;
  }

  static get SOCKET_KEY() {
    return `${MODULE_ID}.refreshTrashBinStore`;
  }

  static _registerSocketListeners() {
    this.socket.register(TrashBin.SOCKET_KEY, (socketData) => {
      this._handleRemoteRefresh(socketData);
    });
  }

  static _handleRemoteRefresh(docType) {
    const instance = TrashBin.instance;
    if (!instance) return;

    const formattedType = docType.capitalize();
    instance.#reloadFlag[formattedType] = true;

    if (instance.rendered && instance.#currentType === formattedType) {
      instance.render({ parts: ["store"] });
    }
  }

  /* -------------------------------------------- */
  /*  Static Properties                           */
  /* -------------------------------------------- */

  /**
   * The unique key used for the module application.
   * @type {string}
   * @readonly
   */
  static get KEY() {
    return `${MODULE_ID}.TrashBin`;
  }

  /**@type {TrashBin} */
  static get instance() {
    return ui[TrashBin.KEY];
  }

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

  /**@type {Set<string>} */
  static ignore = new Set();

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  #reloadFlag = Object.fromEntries(
    Object.keys(TrashBin.DOC_TYPES).map((k) => [k, true]),
  );

  /** @type {string} */
  #currentType = "Actor";

  /** @type {string} */
  #searchQuery = "";

  /** @type {Record<string, TrashStoreEntry[] | Promise<TrashStoreEntry[]>>} */
  #trashStores = Object.fromEntries(
    Object.keys(TrashBin.DOC_TYPES).map((type) => [type, []]),
  );

  /** @type {Promise<TrashStoreEntry[]>|TrashStoreEntry[]} */
  #results = [];

  /** @type {number} */
  #resultIndex = -1;

  /** @type {boolean} */
  #renderThrottle = false;

  #contentScroll = {};

  /** @type {number|null} Store the timer ID for interval updates */
  #timeUpdateInterval = null;

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
    const storeEl = this.element?.querySelector(
      '[data-application-part="store"]',
    );
    if (storeEl) {
      this._onScrollResults({ target: storeEl.closest(".window-content") });
    }
  }, 100);

  /**
   * Extracted document type names from cached store file paths.
   */
  get storeNames() {
    if (!TrashBin.#isInitialized) TrashBin.getStorePaths();
    return TrashBin.#storeNames;
  }

  /**
   * Mapping of tracked trash store entries by document type.
   */
  get trashStores() {
    return this.#trashStores;
  }

  /* -------------------------------------------- */
  /*  Initialization & Settings                   */
  /* -------------------------------------------- */

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
          await TrashBin._onDeleteOperation.call(
            this,
            documents,
            operation,
            user,
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
  /*  Application Lifecycle                       */
  /* -------------------------------------------- */

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
    this.element.addEventListener("scroll", this._onScrollResults.bind(this), {
      capture: true,
      passive: true,
    });
    this.element.addEventListener("keydown", this._debouncedSearch, {
      passive: true,
    });
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    if (options.parts?.includes("store") || !options.parts) {
      this._debouncedResizeResults();
    }

    this._startTimeSinceInterval();
  }

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
    };
  }

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    if (partId === "store") {
      return this._prepareStoreContext(context, options);
    }
    return context;
  }

  /**
   * Prepare store context and filter data by search query.
   * @protected
   */
  async _prepareStoreContext(context, options) {
    const type = this.#currentType;
    if (this.#reloadFlag[type]) {
      this.#trashStores[type] = this.storeNames.has(type)
        ? TrashBin.loadTrashStore(type)
        : [];
    }

    let entries = await this.#trashStores[type];
    if (this.#searchQuery?.trim()) {
      const q = this.#searchQuery.toLowerCase();
      entries = entries.filter((e) => e.name?.toLowerCase().includes(q));
    }

    this.#results = entries;
    return context;
  }

  /** @inheritDoc */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "store") this._renderResults();
  }

  /* -------------------------------------------- */
  /*  Results Rendering & Scroll Processing       */
  /* -------------------------------------------- */

  /**
   * Render a single item entry.
   * @param {TrashStoreEntry} entry  The entry.
   * @param {string} documentClass   The entry's Document class.
   * @returns {Promise<HTMLElement>}
   * @protected
   */
  async _renderItem(entry) {
    const user = game.users.get(entry.deletedBy);
    const userAnchor = user
      ? user.toAnchor().outerHTML
      : (entry.deletedBy ?? "");

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
      userAnchor,
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

    const path = `${TRASH_TEMPLATE_PATH}/store-entry.hbs`;
    const html = await renderTemplate(path, context);
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
  }

  /**
   * Process and render initial results or reset on fresh load.
   * @protected
   */
  async _renderResults() {
    this.#resultIndex = 0;
    const storeEl = this.element?.querySelector(
      '[data-application-part="store"]',
    );
    if (!storeEl) return;

    const itemList = storeEl.querySelector(".bin-list, .item-list");
    if (itemList) itemList.replaceChildren();

    const loadingEl = this.element.querySelector(".store-loading");
    if (loadingEl) loadingEl.hidden = false;

    this.#results = await this.#results;

    if (loadingEl) loadingEl.hidden = true;

    const scrollContainer = this.element.querySelector(".window-content");
    if (scrollContainer) {
      Object.assign(scrollContainer, this.#contentScroll);
      await this._onScrollResults({ target: scrollContainer });
    }
  }

  /**
   * Handles batching results when the user scrolls near the bottom of the container.
   * @protected
   */
  async _onScrollResults(event) {
    const target = event.target ?? event;
    if (this.#renderThrottle || !target?.matches?.(".window-content")) return;

    if (
      this.#results instanceof Promise ||
      this.#resultIndex >= this.#results.length
    )
      return;

    while (
      this.#resultIndex < this.#results.length &&
      (target.scrollHeight <= target.clientHeight ||
        target.scrollTop + target.clientHeight >=
          target.scrollHeight - this.constructor.BATCHING.MARGIN)
    ) {
      this.#renderThrottle = true;

      const rendered = [];
      const batchStart = this.#resultIndex;
      const batchEnd = Math.min(
        batchStart + this.constructor.BATCHING.SIZE,
        this.#results.length,
      );

      for (let i = batchStart; i < batchEnd; i++) {
        const entry = this.#results[i];
        if (entry) rendered.push(this._renderItem(entry));
      }

      const container = this.element.querySelector(
        '[data-application-part="store"] .bin-list, [data-application-part="store"] .item-list',
      );
      if (container) {
        container.append(...(await Promise.all(rendered)));
      }
      this.#resultIndex = batchEnd;

      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    this.#renderThrottle = false;
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
  /*  Event Handlers & Actions                     */
  /* -------------------------------------------- */

  /**
   * Debounced callback to update search input.
   * @protected
   */
  _onSearchName(event) {
    if (!event.target.matches('input[type="search"]')) return;
    this.#searchQuery = event.target.value;
    this.render({ parts: ["store"] });
  }

  /**
   * Action handler to switch visible document type tab.
   * @type {ApplicationClickAction}
   * @this {TrashBin}
   */
  static #selectDocType(_, target) {
    this.#currentType = target.dataset.docType.capitalize() ?? "Actor";
    this.#searchQuery = "";
    this.render({ parts: ["header", "store"] });
  }

  /**
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
    const entryIndex = entries?.findIndex((e) => e.id === entryId);
    if (entryIndex === -1 || entryIndex === undefined) return;

    const entry = entries[entryIndex];

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

      entries.splice(entryIndex, 1);
      await TrashBin.saveTrashStore(this.#currentType, entries);

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
    const entryIndex = entries?.findIndex((e) => e.id === entryId);
    if (entryIndex === -1 || entryIndex === undefined) return;

    const entry = entries[entryIndex];

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Permanently Delete Document" },
      content: `<p>Are you sure you want to permanently delete <strong>${entry.name}</strong>?</p><p>This action cannot be undone.</p>`,
      rejectClose: false,
    });

    if (!confirmed) return;

    if (this.#currentType === "Compendium") {
      await TrashBin.deleteCompendiumContentStore(pack.id);
    }

    entries.splice(entryIndex, 1);
    await TrashBin.saveTrashStore(this.#currentType, entries);

    ui.notifications.info(`Permanently deleted "${entry.name}" from trash.`);
    this.render({ parts: ["store"] });
  }

  /* -------------------------------------------- */
  /*  Document Interception & Maintenance          */
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
    const store = TrashBin.#storeNames.has(this.documentName)
      ? await TrashBin.loadTrashStore(this.documentName)
      : [];

    for (const doc of documents) {
      const id = doc.id ?? doc._id;
      if (TrashBin.ignore.has(id)) {
        TrashBin.ignore.delete(id);
        continue;
      }

      store.push({
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

    const docType = this.documentName.capitalize();
    await TrashBin.saveTrashStore(docType, store);
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

    const store = TrashBin.#storeNames.has("Compendium")
      ? await TrashBin.loadTrashStore("Compendium")
      : [];

    store.push({
      id: this.collection,
      name: this.title ?? metadata.label,
      deletedAt: Date.now(),
      deletedBy: game.user.id,
      data: metadata,
    });

    await TrashBin.saveTrashStore("Compendium", store);
    TrashBin.#storeNames.add("Compendium");

    if (TrashBin.instance) {
      TrashBin.instance.render({ parts: ["store"] });
    }
  }

  /**
   *
   * @param {Actor|TokenDocument} _source
   * @param {PreparedTransaction} sourceUpdates
   * @param {Actor|TokenDocument} _target
   * @param {PreparedTransaction} _targetUpdates
   * @param {string|boolean} _interactionId
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
   * Writes the updated array of documents for a document type to its persistent JSON file.
   * @param {string} docType - The document type key to save.
   * @param {TrashStoreEntry[]} store - The updated list of trash store entries.
   * @returns {Promise<void>}
   */
  static async saveTrashStore(docType, store) {
    const file = new File(
      [JSON.stringify(store, null, 2)],
      `${docType.capitalize()}.json`,
      {
        type: "application/json",
      },
    );
    try {
      await FilePicker.uploadPersistent(
        MODULE_ID,
        "trash-store",
        file,
        {},
        { notify: false },
      );
      TrashBin.socket.executeForOthers(
        TrashBin.SOCKET_KEY,
        docType.capitalize(),
      );
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to upload JSON store for ${docType}:`,
        err,
      );
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
    const filePath = `${TRASH_STORE_PATH}/compendium-store/${packKey}.json`;
    try {
      await FilePicker.deleteFile(filePath, { storage: "data" });
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

        socket?.executeForOthers("refreshTrashBinStore", docType);
      }
    }

    if (storeChanged && TrashBin.instance?.rendered) {
      TrashBin.instance.render({ parts: ["store"] });
    }
  }
}
