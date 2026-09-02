import { MODULE_ID } from "../constants.mjs";

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
          title: "Existing in Compendium",
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

    if (doc.pack && doc.folder) {
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
    this.#resolvers.resolve(null);
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
    const collection = this.collection;
    const isGM = game.user.isGM;
    const isSupportedType = !["Macro", "Playlist", "Adventure"].includes(
      collection.documentName,
    );

    if (!isGM || !isSupportedType) return callOriginal(entry, folderId);

    const document = entry.clone(
      { folder: folderId || null },
      { keepId: true },
    );

    let existing = null;

    if (collection.documentName === "Scene") {
      const index = await collection.getIndex({ fields: ["background.src"] });
      const match = index.find(
        (i) =>
          i.name === document.name ||
          (i.background?.src && i.background.src === document.background?.src),
      );
      if (match) existing = await collection.getDocument(match._id);
    } else {
      [existing] = await collection.getDocuments({ name: document.name });
    }

    if (!existing) {
      const created = callOriginal(entry, folderId);
      if (created) {
        await TCRDocumentsImportResolver.#deleteSourceDocument.call(
          this,
          entry,
        );
      }
      return created;
    }

    if (existing.folder) folderId = existing.folder._id;

    const resolvedEntry = await TCRDocumentsImportResolver.showDialog({
      source: document,
      existing,
      folderId,
      pack: collection,
    });

    if (!resolvedEntry) return;

    const created = await callOriginal(resolvedEntry, folderId);
    if (created) {
      await TCRDocumentsImportResolver.#deleteSourceDocument.call(this, entry);
    }
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
    const collection = this.collection;
    const isGM = game.user.isGM;
    const isSupportedType = !["Macro", "Playlist", "Adventure"].includes(
      collection.documentName,
    );

    if (!isGM || !isSupportedType) return callOriginal(entry, folderId);

    const document = entry.clone(
      { folder: folderId || null },
      { keepId: true },
    );

    let existing = null;

    // World collections are loaded in memory, allowing synchronous lookups
    if (collection.documentName === "Scene") {
      existing = collection.find(
        (s) =>
          s.name === document.name ||
          (s.background?.src && s.background.src === document.background?.src),
      );
    } else {
      existing = collection.getName(document.name);
    }

    if (!existing) return callOriginal(entry, folderId);

    if (existing.folder) folderId = existing.folder._id;

    const resolvedEntry = await TCRDocumentsImportResolver.showDialog({
      source: document,
      existing,
      folderId,
      collection,
    });

    if (!resolvedEntry) return;

    const created = await callOriginal(resolvedEntry, folderId);
    return created;
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
        await sourceDoc?.delete();
      } else if (!entry.pack) {
        await entry.delete();
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
    this.#resolvers.resolve(null);
    await this.close();
  }

  /**
   *
   * @this {TCRDocumentsImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onRenameBoth() {
    const baseName = this.existing.name.replace(/\s*\(\d+\)$/, "");
    const pattern = new RegExp(
      `^${RegExp.escape(baseName)}(?: \\((\\d+)\\))?$`,
    );

    const collection = this.targetCollection.index ?? this.targetCollection;
    const indexes = collection.filter(
      (i) => i.folder === this.folderId || i.folder?.id === this.folderId,
    );

    let maxCopyIndex = 0;
    for (const doc of indexes) {
      const match = doc.name.match(pattern);
      if (match) {
        const index = match[1] ? parseInt(match[1], 10) : 1;
        if (index > maxCopyIndex) maxCopyIndex = index;
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
