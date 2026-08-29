import { MODULE_ID } from "../constants.mjs";

const { HandlebarsApplicationMixin: HAM, ApplicationV2 } =
  foundry.applications.api;

const RESOLVER_TEMPLATE = `modules/${MODULE_ID}/templates/actor-importer-resolver`;

/**
 * @import { ApplicationClickAction } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 * @import { DocumentsImportResolverConfiguration } from "./_types.mjs";
 * @import Document from "../../foundry/resources/app/common/abstract/document.mjs";
 */

export default class TCRDocumentsImportResolver extends HAM(ApplicationV2) {
  /** @param {Partial<DocumentsImportResolverConfiguration>} options*/
  constructor(options = {}) {
    super(options);
    this.source = options.source;
    this.existing = options.existing;
    this.pack = options.pack;
    this.folderId = options.folderId;
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

  static EMBEDDED_SECTIONS = {
    base: `${RESOLVER_TEMPLATE}/embedded-sections/base-section.hbs`,
    Cards: `${RESOLVER_TEMPLATE}/embedded-sections/cards-section.hbs`,
    JournalEntry: `${RESOLVER_TEMPLATE}/embedded-sections/journal-section.hbs`,
    RollTable: `${RESOLVER_TEMPLATE}/embedded-sections/roll-table-section.hbs`,
  };

  static PANELS = {
    base: `${RESOLVER_TEMPLATE}/panels/base-panel.hbs`,
    Cards: `${RESOLVER_TEMPLATE}/panels/cards-panel.hbs`,
    JournalEntry: `${RESOLVER_TEMPLATE}/panels/journal-panel.hbs`,
    RollTable: `${RESOLVER_TEMPLATE}/panels/roll-table-panel.hbs`,
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
      options.pack.documentName,
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
    return this.pack.documentName;
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
          headerFields: this._prepareHeadersFields(this.source),
        },
        {
          doc: this.existing,
          title: "Existing in Compendium",
          class: "old",
          embedded: await this._prepareEmbeddedDocuments(this.existing),
          headerFields: this._prepareHeadersFields(this.existing),
        },
      ],
      config: CONFIG,
      packName: this.pack.title,
    };
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
        class: "name",
        value: doc.name,
        tooltip: doc.name,
      },
    ];

    if (doc.type) {
      headerFields.push({
        class: "meta",
        value: game.i18n.localize(
          CONFIG[this.documentName].typeLabels[doc.type],
        ),
      });
    }

    headerFields.push({ class: "uuid", value: doc.uuid, tooltip: doc.uuid });

    switch (this.documentName) {
      case "Actor":
        headerFields.push({
          class: "meta",
          value: `${doc.items.size} embedded item(s)`,
        });
        break;
      case "Item":
        headerFields.push({
          class: "desccription",
          value: `${doc.items.size} embedded item(s)`,
        });
        break;
      case "Scene":
        headerFields.push({
          class: "bg",
          value: doc.background.src ?? "No background source",
          tooltip: doc.background.src,
        });
        break;
    }

    return headerFields;
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
   */
  static async showDialog(options) {
    if (typeof options.pack === "string") options.pack = game.packs.get(options.pack);
    if (typeof options.source === "string") options.source = await fromUuid(options.source);
    if (typeof options.existing === "string") options.existing = await fromUuid(options.existing);

    const app = new this(options);
    app.render({ force: true });
    return app.promise;
  }

  /**
   * Monkey-patches `Collection.prototype._createDroppedEntry`
   */
  static patchCollectionMethod() {
    const originalMethod = Compendium.prototype._createDroppedEntry;
    if (typeof originalMethod !== "function") return;

    Compendium.prototype._createDroppedEntry = function (...args) {
      const callOriginal = (...overrideArgs) =>
        originalMethod.apply(this, overrideArgs.length ? overrideArgs : args);

      return TCRDocumentsImportResolver._createDroppedEntry.call(
        this,
        callOriginal,
        ...args,
      );
    };
  }

  /**
   * Create a dropped Entry in this Compendium
   * @param {Function} callOriginal
   * @param {DirectoryMixinEntry} entry       The Entry being dropped
   * @param {string} [folderId]               The ID of the Folder to which the Entry should be added
   * @returns {Promise<DirectoryMixinEntry>}  The created Entry
   * @this {Compendium}
   */
  static async _createDroppedEntry(callOriginal, entry, folderId) {
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
          i.background?.src === document.background?.src,
      );
      if (match) existing = await collection.getDocument(match._id);
    } else {
      [existing] = await collection.getDocuments({ name: document.name });
    }

    if (existing) {
      entry = await TCRDocumentsImportResolver.showDialog({
        source: document,
        existing,
        folderId,
        pack: collection,
      });
      if (!entry) return;
    }

    return callOriginal(entry, folderId);
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

    const indexes = this.pack?.index.filter((i) => i.folder === this.folderId);

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
