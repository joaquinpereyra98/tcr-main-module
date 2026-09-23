import { MODULE_ID } from "../constants.mjs";
import { hasDocumentsInFolder } from "../utils.mjs";

const { HandlebarsApplicationMixin: HAM, ApplicationV2 } =
  foundry.applications.api;

const RESOLVER_TEMPLATE = `modules/${MODULE_ID}/templates/actor-importer-resolver`;

/**
 * @import { ApplicationClickAction } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 * @import { CompendiumCollection, DocumentsImportResolverConfiguration } from "./_types.mjs";
 * @import Document from "../../foundry/resources/app/common/abstract/document.mjs";
 */

/**
 * @callback createDroppedEntryFn
 * @param {Document} entry - The Entry being dropped
 * @param {string} [folderId] - The ID of the Folder to which the Entry should be added
 * @returns {Promise<Document>} - The created Entry
 */

/**
 * @callback handleDroppedForeignFolderFn
 * @param {Folder} folder - The Folder being dropped
 * @param {string} closestFolderId - The closest Folder _id to the drop target
 * @param {object} sortData - The sort data for the Folder
 * @param {string} sortData.sortKey - The sort key to use for sorting
 * @param {boolean} sortData.sortBefore - Sort before the target?
 * @returns {Promise<{folder: Folder, sortNeeded: boolean}|null>} - The created Entry
 */

export default class TCRDocumentsImportResolver extends HAM(ApplicationV2) {
  /** @param {DocumentsImportResolverConfiguration} options*/
  constructor(options = {}) {
    super(options);
    this.source = options.source;
    this.existing = options.existing;
    this.folderId = options.folderId;

    if (!this.source || !this.existing) {
      throw new Error(
        "Both 'source' and 'existing' documents are required options.",
      );
    }

    if (this.source?.documentName !== this.existing?.documentName) {
      throw new Error(
        `Document name mismatch: source ("${this.source?.documentName}") does not match existing ("${this.existing?.documentName}").`,
      );
    }
  }

  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<DocumentsImportResolverConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: "tcr-documents-import-resolver-{id}",
    classes: [MODULE_ID, "tcr-documents-import-resolver"],
    window: {
      title: "Duplicate {documentName} Import Resolver",
      icon: "fa-solid fa-copy",
      resizable: true,
    },
    position: {
      width: 980,
    },
    actions: {
      imagePopout: TCRDocumentsImportResolver.#onImagePopout,
      deleteOriginal: TCRDocumentsImportResolver.#onDeleteOriginal,
      keepBoth: TCRDocumentsImportResolver.#onKeepBoth,
      keepOriginal: TCRDocumentsImportResolver.#onKeepOriginal,
      renameBoth: TCRDocumentsImportResolver.#onRenameBoth,
    },
  };

  /**
   * @type {Record<string, String>}
   */
  static EMBEDDED_SECTIONS = {
    base: `${RESOLVER_TEMPLATE}/embedded-sections/base-section.hbs`,
    Cards: `${RESOLVER_TEMPLATE}/embedded-sections/cards-section.hbs`,
    JournalEntry: `${RESOLVER_TEMPLATE}/embedded-sections/journal-section.hbs`,
    RollTable: `${RESOLVER_TEMPLATE}/embedded-sections/roll-table-section.hbs`,
  };

  /**
   * @type {Record<string, String>}
   */
  static PANELS = {
    base: `${RESOLVER_TEMPLATE}/panels/base-panel.hbs`,
    JournalEntry: `${RESOLVER_TEMPLATE}/panels/journal-panel.hbs`,
    Scene: `${RESOLVER_TEMPLATE}/panels/scene-panel.hbs`,
  };

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    summary: {
      template: `${RESOLVER_TEMPLATE}/summary.hbs`,
      templates: [
        ...Object.values(this.PANELS),
        ...Object.values(this.EMBEDDED_SECTIONS),
        `${RESOLVER_TEMPLATE}/partials/doc-field.hbs`,
      ],
    },
    actions: {
      template: `${RESOLVER_TEMPLATE}/actions.hbs`,
    },
  };

  /* -------------------------------------------- */
  /*  Initialization                              */
  /* -------------------------------------------- */

  /**
   * @inheritdoc
   * @param {Partial<DocumentsImportResolverConfiguration>} options
   */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    options.window.title = options.window.title.replace(
      "documentName",
      options.source.documentName,
    );
    options.position.height ??= window.innerHeight * 0.9;
    return options;
  }

  /* -------------------------------------------- */
  /*  Application Properties                      */
  /* -------------------------------------------- */

  /**
   * Internal Promise resolvers used to defer and return the user's resolution selection.
   * @type {{ promise: Promise<any>, resolve: Function, reject: Function }}
   */
  #resolvers = Promise.withResolvers();

  /**
   * A promise that resolves when the user submits or closes the dialog.
   * @type {Promise<any>}
   */
  get promise() {
    return this.#resolvers.promise;
  }

  /**
   * The canonical name of this Document type, for example "Actor".
   * @type {string}
   */
  get documentName() {
    return this.source?.documentName;
  }

  /** @type {CompendiumCollection|WorldCollection} */
  get sourceCollection() {
    return this.source.compendium ?? this.source.collection;
  }

  /** @type {CompendiumCollection|WorldCollection} */
  get targetCollection() {
    return this.existing.compendium ?? this.existing.collection;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options = {}) {
    const context = super._prepareContext(options);

    return {
      ...context,
      partials: this.getPartials(),
      panels: [
        {
          doc: this.source,
          title: "New Imported",
          class: "new",
          embedded: await this._prepareEmbeddedDocuments(this.source),
          headerFields: await this._prepareHeadersFields(this.source),
          additionalFields: await this._prepareAdditionalFields(this.source),
        },
        {
          doc: this.existing,
          title: "Existing in Collection",
          class: "old",
          embedded: await this._prepareEmbeddedDocuments(this.existing),
          headerFields: await this._prepareHeadersFields(this.existing),
          additionalFields: await this._prepareAdditionalFields(this.existing),
        },
      ],
      config: CONFIG,
      collectionsNames: {
        source: this.getCollectionsName(this.sourceCollection),
        target: this.getCollectionsName(this.targetCollection),
      },
    };
  }

  /**
   * Gets the localized plural label or title for a given collection.
   * @param {WorldCollection|CompendiumCollection} collection - The collection to get the name from.
   * @returns {string} The localized plural label or title.
   */
  getCollectionsName(collection) {
    return collection instanceof WorldCollection
      ? game.i18n.localize(collection.documentClass.metadata.labelPlural)
      : collection.title;
  }

  /**
   * Prepares header visual field data for a specific Document panel.
   * @param {Document} doc - The Document being evaluated in the panel.
   * @returns {Promise<Array<Object>>} An array of header metadata objects.
   * @protected
   */
  async _prepareHeadersFields(doc) {
    const headerFields = [
      {
        class: "field-name truncate-text",
        value: doc.name,
        tooltip: doc.name,
      },
    ];

    if (doc.type) {
      const config = CONFIG[this.documentName];
      headerFields.push({
        class: "field-meta",
        value: game.i18n.localize(config.typeLabels[doc.type]),
        icon: config.sidebarIcon,
      });
    }

    headerFields.push({
      class: "field-uuid truncate-text",
      value: doc.uuid,
      tooltip: doc.uuid,
      icon: "fa-solid fa-passport",
    });

    if (doc.folder) {
      const folderPath = [doc.folder, ...doc.folder.ancestors]
        .reverse()
        .map((f) => `<span>${f.name}</span>`)
        .join('<span class="divisor"> &gt; </span>');

      headerFields.push({
        class: "field-folder-path truncate-text",
        value: folderPath,
        tooltip: folderPath,
        icon: "fa-solid fa-folder",
      });
    }

    switch (this.documentName) {
      case "Actor":
        headerFields.push({
          class: "field-meta",
          value: `${doc.items.size} embedded item(s)`,
        });
        break;
      case "Scene":
        headerFields.push({
          class: "field-bg truncate-text",
          value: doc.background.src ?? "No background source",
          tooltip: doc.background.src,
          icon: "fa-solid fa-map",
        });
        break;
    }

    return headerFields;
  }

  /**
   * @param {Document} doc - The Document being evaluated in the panel.
   * @returns {Promise<Array<Object>>}
   * @protected
   */
  async _prepareAdditionalFields(doc) {
    const additionalFields = [];
    switch (this.documentName) {
      case "Item":
        const raw = doc?.system?.description?.value ?? "";
        additionalFields.push({
          class: "field-description",
          title: "Description",
          icon: "fa-solid fa-feather-pointed",
          value: await TextEditor.enrichHTML(raw, {
            secrets: doc.isOwner,
            relativeTo: doc.item,
            rollData: doc.getRollData(),
          }),
        });
        break;
    }
    return additionalFields;
  }

  /**
   * Retrieves the partial template path configuration for the current application Document type.
   * @returns {{panel: string, embedded: string}} The panel and embedded template file paths.
   */
  getPartials() {
    const { PANELS, EMBEDDED_SECTIONS } = TCRDocumentsImportResolver;

    return {
      panel: PANELS[this.documentName] || PANELS.base,
      embedded: EMBEDDED_SECTIONS[this.documentName] || EMBEDDED_SECTIONS.base,
      docField: `${RESOLVER_TEMPLATE}/partials/doc-field.hbs`,
    };
  }

  /**
   * Retrieves the specific panel template path for the current application Document type.
   * @returns {string} The panel template path.
   */
  getPanelPartial() {
    return (
      partials[this.documentName] ||
      `${RESOLVER_TEMPLATE}/partials/base-panel.hbs`
    );
  }

  /**
   * Prepares and groups embedded documents across all sub-collections by document type.
   * @param {Document} doc - The primary parent document containing embedded collections.
   * @returns {Promise<Object[]>} Array of grouped embedded document lists.
   */
  async _prepareEmbeddedDocuments(doc) {
    switch (this.documentName) {
      case "Cards":
        return this._prepareEmbeddedCardDocuments(doc);
      case "JournalEntry":
        return this._prepareEmbeddedJournalDocuments(doc);
      case "RollTable":
        return this._prepareEmbeddedRollTableDocuments(doc);
      default:
        return Object.values(doc?.collections ?? {})
          .filter((col) => col?.size)
          .map((col) => {
            const { documentName, metadata } = col.documentClass;
            const typeLabels = CONFIG[documentName]?.typeLabels ?? {};

            const grouped = col.reduce((acc, embeddedDoc) => {
              const type = embeddedDoc.type ?? "base";
              (acc[type] ??= []).push(embeddedDoc.toAnchor().outerHTML);
              return acc;
            }, {});

            const types = Object.entries(grouped)
              .sort(([a], [b]) =>
                a === "base" ? -1 : b === "base" ? 1 : a.localeCompare(b),
              )
              .map(([type, items]) => ({
                type,
                label:
                  type === "base"
                    ? ""
                    : typeLabels[type]
                      ? game.i18n.localize(typeLabels[type])
                      : type,
                items,
              }));

            return {
              label: game.i18n.localize(metadata.labelPlural),
              types,
            };
          });
    }
  }

  /**
   * Prepares embedded Card documents from a parent Cards stack document.
   * @param {Document} doc - The parent Cards Document containing the cards collection.
   * @returns {Promise<Card[]>} A list of embedded Card documents sorted by standard order.
   */
  async _prepareEmbeddedCardDocuments(doc) {
    /**@type {Card[]} */
    const cards = doc.cards.contents;
    cards.sort(doc.sortStandard.bind(this));
    return cards;
  }

  /**
   * Prepares structured render data for embedded JournalEntryPage documents.
   * @param {Document} doc - The parent JournalEntry Document.
   * @returns {Promise<Array<{uuid: string, name: string, typeLabel: string, icon: string}>>} Array of formatted page objects.
   */
  async _prepareEmbeddedJournalDocuments(doc) {
    /**@type {JournalEntryPage[]} */
    const pages = doc.pages.contents;

    const iconMap = {
      text: "fa-solid fa-file-lines",
      image: "fa-solid fa-file-image",
      video: "fa-solid fa-file-video",
      pdf: "fa-solid fa-file-pdf",
    };

    return pages
      .map((p) => ({
        uuid: p.uuid,
        name: p.name,
        typeLabel: game.i18n.localize(
          CONFIG.JournalEntryPage.typeLabels[p.type],
        ),
        icon: iconMap[p.type] ?? "fa-solid fa-file",
      }))
      .sort((a, b) => a.sort - b.sort);
  }

  /**
   * Prepares structured render data for embedded TableResult entries within a RollTable.
   * @param {Document} doc - The parent RollTable Document.
   * @returns {Promise<Array<{uuid: string, name: string, anchor: HTMLElement|null, img: string, typeLabel: string, icon: string, range: string|number, drawn: boolean}>>} Array of formatted table result render objects.
   */
  async _prepareEmbeddedRollTableDocuments(doc) {
    /**@type {TableResult[]} */
    const results = doc.results.contents;

    const iconMap = {
      text: "fa-solid fa-align-left",
      document: "fa-solid fa-file",
      pack: "fa-solid fa-book-atlas",
    };

    const { DOCUMENT, TEXT } = CONST.TABLE_RESULT_TYPES;

    const promises = results
      .map(async (r) => {
        const data = {
          uuid: r.uuid,
          name: r.text,
          anchor: null,
          img: r.img,
        };

        if (r.type !== TEXT) {
          const targetUuid =
            r.type === DOCUMENT
              ? `${r.documentCollection}.${r.documentId}`
              : `Compendium.${r.documentCollection}.${r.documentId}`;

          const doc = await fromUuid(targetUuid);
          if (doc) {
            data.uuid = doc.uuid;
            data.name = doc.name;
            data.anchor = doc.toAnchor();
            data.img = doc.img;
          }
        }

        return {
          ...data,
          typeLabel: game.i18n.localize(CONFIG.TableResult.typeLabels[r.type]),
          icon: iconMap[r.type] ?? iconMap[TEXT],
          range: r.range[0] === r.range[1] ? r.range[0] : r.range.join(" - "),
          img: r.img,
          drawn: r.drawn,
        };
      })
      .sort((a, b) => a.sort - b.sort);

    return await Promise.all(promises);
  }

  /** @override */
  _onClose(options = {}) {
    super._onClose(options);
    this.#resolvers.resolve(false);
  }

  /* -------------------------------------------- */
  /*  Factory Methods                             */
  /* -------------------------------------------- */

  /**
   * Replacement launcher function to instantiate and render the ApplicationV2 Dialog
   * @param {Partial<DocumentsImportResolverConfiguration>} options
   * @returns {Promise<Document>}
   */
  static async showDialog(options) {
    if (typeof options.source === "string")
      options.source = await fromUuid(options.source);
    if (typeof options.existing === "string")
      options.existing = await fromUuid(options.existing);

    const app = new this(options);
    app.render({ force: true });
    return app.promise;
  }

  /**
   * Monkey-patches `DocumentDirectory.prototype._createDroppedEntry` and `Compendium.prototype._createDroppedEntry`
   */
  static patchDropHandlers() {
    const targets = [
      {
        proto: Compendium.prototype,
        handler: TCRDocumentsImportResolver._createDroppedEntryCompendium,
      },
      {
        proto: DocumentDirectory.prototype,
        handler: TCRDocumentsImportResolver._createDroppedEntryDirectory,
      },
    ];

    for (const { proto, handler } of targets) {
      const originalMethod = proto._createDroppedEntry;
      if (typeof originalMethod !== "function") continue;

      proto._createDroppedEntry = function (...args) {
        const callOriginal = (...overrideArgs) =>
          originalMethod.apply(this, overrideArgs.length ? overrideArgs : args);

        return handler.call(this, callOriginal, ...args);
      };
    }

    const targets2 = [
      {
        proto: CONFIG.ui.items.prototype,
        handler: TCRDocumentsImportResolver._handleDroppedItemDirectory,
      },
      {
        proto: dnd5e.applications.item.ItemCompendium5e.prototype,
        handler: TCRDocumentsImportResolver._handleDroppedItemCompendium,
      },
    ];

    for (const { proto, handler } of targets2) {
      const originalMethod = proto._handleDroppedEntry;
      if (typeof originalMethod !== "function") continue;

      proto._handleDroppedEntry = function (...args) {
        const callSuper = (...overrideArgs) =>
          ItemDirectory.prototype._handleDroppedEntry.apply(
            this,
            overrideArgs.length ? overrideArgs : args,
          );

        return handler.call(this, callSuper, ...args);
      };
    }
  }

  /**
   * Helper method to handle the duplicate checking and resolution workflow for dropped entries.
   * @param {WorldCollection|CompendiumCollection} collection - Target collection
   * @param {DirectoryMixinEntry} entry - The Entry being dropped
   * @param {string} [folderId] - Target folder ID
   * @returns {Promise<{resolvedEntry: DirectoryMixinEntry, targetFolderId: string}|null>} Resolved entry data or null if canceled
   */
  static async _resolveDroppedEntry(collection, entry, folderId) {
    const isGM = game.user.isGM;
    const isSupportedType = !["Macro", "Playlist", "Adventure"].includes(
      collection.documentName,
    );

    if (!isGM || !isSupportedType)
      return { resolvedEntry: entry, targetFolderId: folderId };

    const document = entry.clone(
      { folder: folderId || null },
      { keepId: true },
    );
    const excludedIds = new Set();
    let currentFolderId = folderId;

    let existing = await TCRDocumentsImportResolver.findExistingDocument(
      collection,
      document,
    );
    let resolvedEntry = document;

    while (existing) {
      if (existing.folder) {
        currentFolderId = existing.folder._id ?? existing.folder;
      }

      resolvedEntry = await TCRDocumentsImportResolver.showDialog({
        source: resolvedEntry,
        existing,
        folderId: currentFolderId,
        collection,
      });

      if (!resolvedEntry) return null;

      excludedIds.add(existing._id);

      existing = await TCRDocumentsImportResolver.findExistingDocument(
        collection,
        resolvedEntry,
        Array.from(excludedIds),
      );
    }

    return { resolvedEntry, targetFolderId: currentFolderId };
  }

  /**
   * Create a dropped Entry in this Compendium
   * @param {createDroppedEntryFn} callOriginal
   * @param {DirectoryMixinEntry} entry - The Entry being dropped
   * @param {string} [folderId] - The ID of the Folder to which the Entry should be added
   * @returns {Promise<DirectoryMixinEntry>}  The created Entry
   * @this {Compendium}
   */
  static async _createDroppedEntryCompendium(callOriginal, entry, folderId) {
    const unsortedFolder = folderId
      ? null
      : await TCRDocumentsImportResolver.getOrCreateUnsortedFolder(
          this.collection,
        );

    const resolution = await TCRDocumentsImportResolver._resolveDroppedEntry(
      this.collection,
      entry,
      folderId ?? unsortedFolder.id,
    );

    if (!resolution) return null;

    const { resolvedEntry, targetFolderId } = resolution;
    const created = await callOriginal(resolvedEntry, targetFolderId);

    if (created)
      await TCRDocumentsImportResolver.#deleteSourceDocument.call(this, entry);

    return created;
  }

  /**
   * Create a dropped Entry in this Compendium
   * @param {createDroppedEntryFn} callOriginal
   * @param {DirectoryMixinEntry} entry - The Entry being dropped
   * @param {string} [folderId] - The ID of the Folder to which the Entry should be added
   * @returns {Promise<DirectoryMixinEntry>}  The created Entry
   * @this {DocumentDirectory}
   */
  static async _createDroppedEntryDirectory(callOriginal, entry, folderId) {
    const { resolvedEntry, targetFolderId } =
      await TCRDocumentsImportResolver._resolveDroppedEntry(
        this.collection,
        entry,
        folderId,
      );

    const created = await callOriginal(resolvedEntry, targetFolderId);
    return created;
  }

  /**
   * Custom drop handler for ItemDirectory that handles containers with TCR import resolution.
   * @param {HTMLElement} target - The drop target element.
   * @param {object} data - Drag event payload data.
   * @this {ItemDirectory}
   */
  static async _handleDroppedItemDirectory(callSuper, target, data) {
    /** @type {Item} */
    const item = await this._getDroppedEntryFromData(data);
    if (!item) return;

    if (this._entryAlreadyExists(item)) {
      if (item.system?.container) {
        await item.update({ "system.container": null });
      }
      return callSuper(target, item.toDragData());
    }

    const folderId =
      target?.closest("[data-folder-id]")?.dataset.folderId || null;

    const resolution = await TCRDocumentsImportResolver._resolveDroppedEntry(
      this.collection,
      item,
      folderId,
    );

    if (!resolution) return null; // User cancelled import

    const { resolvedEntry, targetFolderId } = resolution;

    const rootData = resolvedEntry.toObject();
    const toCreate = await CONFIG.Item.documentClass.createWithContents([item]);

    if (targetFolderId) toCreate.forEach((d) => (d.folder = targetFolderId));

    const createdItems = await CONFIG.Item.documentClass.createDocuments(
      toCreate,
      {
        keepId: true,
      },
    );

    // 6. Complete standard drag-and-drop workflow
    const rootCreatedItem =
      createdItems.find((i) => i.id === rootData._id) ?? createdItems[0];

    if (rootCreatedItem) callSuper(target, rootCreatedItem.toDragData());

    return createdItems;
  }

  /**
   * Custom drop handler for ItemCompendium5e that handles containers with TCR import resolution.
   * @param {Function} callSuper - The original/parent _handleDroppedEntry method.
   * @param {HTMLElement} target - The drop target element.
   * @param {object} data - Drag event payload data.
   * @this {Compendium}
   */
  static async _handleDroppedItemCompendium(callSuper, target, data) {
    /** @type {Item} */
    const item = await this._getDroppedEntryFromData(data);
    if (!item) return;

    // If entry already exists in compendium: extract from container if needed
    if (this._entryAlreadyExists(item)) {
      if (item.system?.container) {
        await item.update({ "system.container": null });
      }
      return callSuper(target, item.toDragData());
    }

    const folderId =
      target?.closest("[data-folder-id]")?.dataset.folderId || null;

    const unsortedFolder = folderId
      ? null
      : await TCRDocumentsImportResolver.getOrCreateUnsortedFolder(
          this.collection,
        );

    const resolution = await TCRDocumentsImportResolver._resolveDroppedEntry(
      this.collection,
      item,
      folderId ?? unsortedFolder.id,
    );

    if (!resolution) return null;
    const { resolvedEntry, targetFolderId } = resolution;

    let toCreate = [];
    const contents = await item.system?.contents;

    if (contents?.size) {
      toCreate = await CONFIG.Item.documentClass.createWithContents([item], {
        transformAll: (i) => i.toCompendium(i),
      });

      const resolvedData = resolvedEntry.toCompendium(resolvedEntry);
      const rootIndex = toCreate.findIndex((d) => d._id === item.id) ?? 0;

      if (rootIndex !== -1) {
        toCreate[rootIndex] = foundry.utils.mergeObject(
          toCreate[rootIndex],
          resolvedData,
        );
        toCreate[rootIndex]._id = resolvedEntry._id;
      }
    } else {
      toCreate = [resolvedEntry.toCompendium(resolvedEntry)];
    }

    if (targetFolderId) toCreate.forEach((d) => (d.folder = targetFolderId));

    const createdItems = await CONFIG.Item.documentClass.createDocuments(
      toCreate,
      {
        pack: this.collection.collection,
        keepId: true,
      },
    );

    if (createdItems.length) {
      await TCRDocumentsImportResolver.#deleteSourceDocument.call(this, item);
    }

    const rootCreatedItem =
      createdItems.find((i) => i.id === resolvedEntry._id) ?? createdItems[0];

    if (rootCreatedItem) {
      if (rootCreatedItem.folder.id !== folderId) {
        const folderElement = this.element[0].querySelector(
          `[data-folder-id="${rootCreatedItem.folder.id}"]`,
        );
        target = folderElement.firstElementChild;
      }
      callSuper(target, rootCreatedItem.toDragData());
    }

    return createdItems;
  }

  /**
   * Monkey-patches folder drop handlers in DocumentDirectory and Compendium
   */
  static patchFolderDropHandlers() {
    const targets = [
      {
        proto: DocumentDirectory.prototype,
        handler:
          TCRDocumentsImportResolver._handleDroppedForeignFolderDirectory,
      },
    ];

    for (const { proto, handler } of targets) {
      const originalMethod = proto._handleDroppedForeignFolder;
      if (typeof originalMethod !== "function") continue;

      proto._handleDroppedForeignFolder = function (...args) {
        const callOriginal = (...overrideArgs) =>
          originalMethod.apply(this, overrideArgs.length ? overrideArgs : args);

        return handler.call(this, callOriginal, ...args);
      };
    }
  }

  /**
   * Compares documents within a dropped folder hierarchy against existing collection documents
   * and opens the import resolver for duplicates before proceeding.
   * @param {handleDroppedForeignFolderFn} callOriginal - Reference to the original _handleDroppedForeignFolder method
   * @param {Folder} folder - The Folder being dropped
   * @param {string} closestFolderId - Target parent folder ID
   * @param {object} sortData - Sorting metadata
   * @param {object} sortData - The sort data for the Folder
   * @param {string} sortData.sortKey - The sort key to use for sorting
   * @param {boolean} sortData.sortBefore - Sort before the target?
   * @returns {Promise<{folder: Folder, sortNeeded: boolean}|null>}
   * @this {DocumentDirectory}
   */
  static async _handleDroppedForeignFolderDirectory(
    callOriginal,
    folder,
    closestFolderId,
    sortData,
  ) {
    const collection = this.collection;
    if (!game.user.isGM) return callOriginal(folder, closestFolderId, sortData);

    if (collection instanceof CompendiumCollection) {
      return TCRDocumentsImportResolver._handleDroppedForeignFolderInCompenidum.call(
        this,
        folder,
        closestFolderId,
      );
    }

    const documentClass = collection.documentClass;

    const targetFolder = collection.folders.get(closestFolderId);

    let { foldersToCreate, documentsToCreate } =
      await this._organizeDroppedFoldersAndDocuments(folder, targetFolder);

    if (!foldersToCreate.length && !documentsToCreate.length) return null;

    // Hydrate document indexes if dropped from a compendium
    if (folder.compendium) {
      const ids = documentsToCreate.map((i) => i._id);
      const docs = await folder.compendium.getDocuments({ _id__in: ids });
      const docsMap = new Map(docs.map((d) => [d._id, d]));

      documentsToCreate = documentsToCreate.map((d) => {
        const doc = docsMap.get(d._id);
        const docData = d.toObject ? d.toObject() : d;
        return foundry.utils.mergeObject(doc?.toObject() ?? {}, docData, {
          inplace: false,
        });
      });
    }

    const finalDocumentsToCreate = [];
    const documentsToDelete = [];

    for (const docData of documentsToCreate) {
      const sourceDoc = new documentClass(docData);

      const resolution = await TCRDocumentsImportResolver._resolveDroppedEntry(
        collection,
        sourceDoc,
        docData.folder || closestFolderId,
      );

      // Skip document if user canceled dialog
      if (!resolution) continue;

      const { resolvedEntry } = resolution;
      const updatedData = resolvedEntry.toObject();

      // Ensure duplicate resolution generates a new ID if kept alongside existing
      if (sourceDoc._id !== updatedData._id) {
        updatedData._id = foundry.utils.randomID();
      }

      finalDocumentsToCreate.push(updatedData);
    }

    let createdFolders = [];
    try {
      createdFolders = await Folder.createDocuments(foldersToCreate, {
        pack: collection.collection,
        keepId: true,
      });
    } catch (err) {
      ui.notifications.error(err.message);
      throw err;
    }

    try {
      await documentClass.createDocuments(finalDocumentsToCreate, {
        pack: this.collection.collection,
        keepId: true,
      });

      if (documentsToDelete.length) {
        await documentClass.deleteDocuments(documentsToDelete);
        TCRDocumentsImportResolver.#deleteSourceFolders(
          folder,
          documentsToDelete,
        );
      }
    } catch (err) {
      ui.notifications.error(err.message);
      throw err;
    }

    return {
      sortNeeded: true,
      folder: createdFolders.length ? createdFolders[0] : folder,
    };
  }

  /**
   * @param {Folder} folder - The Folder being dropped
   * @param {string} closestFolderId - Target parent folder ID
   * @returns {Promise<{folder: Folder|null, sortNeeded: boolean}>}
   * @this {CompendiumDirectory|Compendium}
   */
  static async _handleDroppedForeignFolderInCompenidum(
    folder,
    closestFolderId,
  ) {
    const collection = this.collection;

    let targetFolderId = closestFolderId;
    if (!targetFolderId) {
      const unsortedFolder =
        await TCRDocumentsImportResolver.getOrCreateUnsortedFolder(collection);
      targetFolderId = unsortedFolder.id;
    }

    function getDocuments(folderNode) {
      const documents = (folderNode.contents || []).map((doc) =>
        doc.toObject ? doc.toObject() : foundry.utils.deepClone(doc),
      );

      const childDocuments = (folderNode.children || []).flatMap((child) =>
        getDocuments(child),
      );

      return [...documents, ...childDocuments];
    }

    const rawDocuments = getDocuments(folder);
    if (!rawDocuments.length) return null;

    const documentClass = collection.documentClass;
    const isItem = collection.documentName === "Item";
    const processedSourceDocs = [];

    for (const docData of rawDocuments) {
      const entry = new documentClass(docData);

      if (isItem) {
        // --- Logic from _handleDroppedItemCompendium ---
        const resolution =
          await TCRDocumentsImportResolver._resolveDroppedEntry(
            collection,
            entry,
            targetFolderId,
          );

        if (!resolution) continue;
        const { resolvedEntry, targetFolderId: finalFolderId } = resolution;

        let toCreate = [];
        const contents = await entry.system?.contents;

        if (contents?.size) {
          toCreate = await CONFIG.Item.documentClass.createWithContents(
            [entry],
            { transformAll: (i) => i.toCompendium(i) },
          );

          const resolvedData = resolvedEntry.toCompendium(resolvedEntry);
          const rootIndex = toCreate.findIndex((d) => d._id === entry.id) ?? 0;

          if (rootIndex !== -1) {
            toCreate[rootIndex] = foundry.utils.mergeObject(
              toCreate[rootIndex],
              resolvedData,
            );
            toCreate[rootIndex]._id = resolvedEntry._id;
          }
        } else {
          toCreate = [resolvedEntry.toCompendium(resolvedEntry)];
        }

        if (finalFolderId) {
          toCreate.forEach((d) => (d.folder = finalFolderId));
        }

        const createdItems = await CONFIG.Item.documentClass.createDocuments(
          toCreate,
          {
            pack: collection.collection,
            keepId: true,
          },
        );

        if (createdItems.length) {
          await TCRDocumentsImportResolver.#deleteSourceDocument.call(
            this,
            entry,
          );
          processedSourceDocs.push(entry);
        }
      } else {
        // --- Logic from _createDroppedEntryCompendium ---
        const resolution =
          await TCRDocumentsImportResolver._resolveDroppedEntry(
            collection,
            entry,
            targetFolderId,
          );

        if (!resolution) continue; // Skip if cancelled by user
        const { resolvedEntry, targetFolderId: finalFolderId } = resolution;

        const dataToCreate = resolvedEntry.toCompendium(resolvedEntry);
        if (finalFolderId) dataToCreate.folder = finalFolderId;

        const createdDocs = await documentClass.createDocuments(
          [dataToCreate],
          {
            pack: collection.collection,
            keepId: true,
          },
        );

        if (createdDocs.length) {
          await TCRDocumentsImportResolver.#deleteSourceDocument.call(
            this,
            entry,
          );
          processedSourceDocs.push(entry);
        }
      }
    }

    if (processedSourceDocs.length) {
      await TCRDocumentsImportResolver.#deleteSourceFolders(
        folder,
        processedSourceDocs,
      );
    }

    return {
      folder: collection.folders.get(targetFolderId) ?? null,
      sortNeeded: false,
    };
  }

  /**
   * Helper to clean up empty source folders after moving documents.
   * @param {Folder} rootFolder - The root folder being dropped
   * @param {Document[]} movedDocuments - Array of documents successfully imported
   */
  static async #deleteSourceFolders(rootFolder, movedDocuments) {
    const allFolders = [rootFolder, ...rootFolder.getSubfolders(true)].sort(
      (a, b) => (b.ancestors?.length ?? 0) - (a.ancestors?.length ?? 0),
    );

    const movedDocIds = new Set(movedDocuments.map((d) => d._id ?? d.id));
    const foldersToDelete = [];

    for (const f of allFolders) {
      const remainingContents =
        f.contents?.filter((c) => !movedDocIds.has(c._id ?? c.id)) ?? [];

      const remainingSubfolders =
        f.children?.filter(
          (child) =>
            !foldersToDelete.includes(child?.folder?._id ?? child?._id),
        ) ?? [];

      if (!remainingContents.length && !remainingSubfolders.length) {
        foldersToDelete.push(f._id);
      }
    }

    if (foldersToDelete.length) {
      try {
        await CONFIG.Folder.documentClass.deleteDocuments(foldersToDelete, {
          pack: rootFolder.pack,
        });
      } catch (err) {
        console.error("Failed to delete source folders:", err);
      }
    }
  }

  /**
   * Retrieves the "[unsorted]" Folder in the given compendium collection, creating it if it does not already exist.
   * @param {CompendiumCollection} collection - Target compendium collection
   * @returns {Promise<Folder>}
   */
  static async getOrCreateUnsortedFolder(collection) {
    return (
      collection.folders.getName("[unsorted]") ??
      (await Folder.create(
        { name: "[unsorted]", type: collection.documentName },
        { pack: collection.collection },
      ))
    );
  }

  /**
   * Helper to locate an existing document in a target collection or compendium index.
   * @param {WorldCollection|CompendiumCollection} collection - Target collection
   * @param {Document|Object} sourceDoc - Source document or object to look up
   * @param {string[]} [excludeIds=[]] - Array of Document IDs to ignore during lookup
   * @returns {Promise<Document|null>} Matching existing document, or null if none
   */
  static async findExistingDocument(collection, sourceDoc, excludeIds = []) {
    const isScene = collection.documentName === "Scene";
    const bgSrc = sourceDoc.background?.src;

    const matches = (i) => {
      if (excludeIds.includes(i._id)) return false;

      // Ignore items inside containers
      if (!!i.system?.container) return false;

      const nameMatch = i.name === sourceDoc.name;
      const bgMatch = isScene && bgSrc && i.background?.src === bgSrc;

      return nameMatch || bgMatch;
    };

    if (collection instanceof WorldCollection) {
      return collection.find(matches) ?? null;
    }

    const index = await collection.getIndex({
      fields: isScene ? ["background.src"] : ["system.container"],
    });
    const entry = index.find(matches);

    return entry ? collection.getDocument(entry._id) : null;
  }

  /**
   * Delete the original source document from World Directory or Compendium A
   * @param {Document} entry
   * @this {Compendium}
   */
  static async #deleteSourceDocument(entry) {
    if (!entry) return;
    try {
      // Source is in another Compendium
      if (entry.pack && entry.pack !== this.collection.metadata.id) {
        const sourcePack = game.packs.get(entry.pack);
        const sourceDoc = await sourcePack?.getDocument(entry.id);
        await sourceDoc?.delete({
          deleteContents: !!sourceDoc?.system?.contentsCount,
        });
      } else if (!entry.pack) {
        await entry.delete({
          deleteContents: !!entry?.system?.contentsCount,
        });
      }
    } catch (err) {
      console.error("Failed to delete original source document:", err);
    }
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Action handler to delete the existing compendium document and replace it with the imported source document.
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onImagePopout(_event, target) {
    const uuid = target.closest(".tcr-document-panel")?.dataset.docUuid;
    const { name } = fromUuidSync(uuid);
    new ImagePopout(target.src, {
      title: name,
      uuid: uuid,
    }).render(true);
  }

  /**
   *
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onDeleteOriginal(event, target) {
    this.existing.delete();
    this.#resolvers.resolve(this.source);
    await this.close();
  }

  /**
   *
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onKeepBoth(event, target) {
    this.#resolvers.resolve(this.source);
    await this.close();
  }

  /**
   *
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onKeepOriginal(event, target) {
    this.source.delete();
    this.#resolvers.resolve(null);
    await this.close();
  }

  /**
   * Action handler triggered when the user chooses to rename both documents during resolution.
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onRenameBoth() {
    const baseName = this.existing.name.replace(/\s*\(\d+\)$/, "");
    const pattern = new RegExp(
      `^${RegExp.escape(baseName)}(?: \\((\\d+)\\))?$`,
    );

    const collection = this.targetCollection.index ?? this.targetCollection;
    const folderId = this.existing.folder?._id ?? this.existing.folder;
    const indexes = collection.filter(
      (i) => (i.folder?._id ?? i.folder) === folderId,
    );

    let maxCopyIndex = 0;
    for (const doc of indexes) {
      const match = doc.name?.match(pattern);
      if (match) {
        const copyIndex = match[1] ? parseInt(match[1], 10) : 1;
        if (copyIndex > maxCopyIndex) maxCopyIndex = copyIndex;
      }
    }

    if (!/\(\d+\)$/.test(this.existing.name)) {
      await this.existing.update({ name: `${baseName} (1)` });
      maxCopyIndex = Math.max(maxCopyIndex, 1);
    }

    const nextIndex = maxCopyIndex + 1;
    this.source.updateSource({ name: `${baseName} (${nextIndex})` });

    this.#resolvers.resolve(this.source);
    await this.close();
  }
}
