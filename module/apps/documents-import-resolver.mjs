import { MODULE_ID } from "../constants.mjs";

const { HandlebarsApplicationMixin: HAM, ApplicationV2 } =
  foundry.applications.api;

const RESOLVER_TEMPLATE = `modules/${MODULE_ID}/templates/actor-importer-resolver`;

/**
 * @import { ApplicationClickAction } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 * @import { DocumentsImportResolverConfiguration } from "./_types.mjs";
 * @import Document from "../../foundry/resources/app/common/abstract/document.mjs";
 * @import EmbeddedCollection from "../../foundry/resources/app/common/abstract/embedded-collection.mjs";
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
      deleteOriginal: TCRDocumentsImportResolver.#onDeleteOriginal,
      keepBoth: TCRDocumentsImportResolver.#onKeepBoth,
      keepOriginal: TCRDocumentsImportResolver.#onKeepOriginal,
      renameBoth: TCRDocumentsImportResolver.#onRenameBoth,
    },
  };

  static PARTIALS = {
    Actor: `${RESOLVER_TEMPLATE}/partials/actor-panel.hbs`,
    Cards: "",
    Item: "",
    JournalEntry: "",
    RollTable: "",
    Scene: `${RESOLVER_TEMPLATE}/partials/scene-panel.hbs`,
  };

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    summary: {
      template: `${RESOLVER_TEMPLATE}/summary.hbs`,
      templates: Object.values(this.PARTIALS).filter(Boolean),
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

  /**@inheritdoc */
  get title() {
    const title = this.options.window.title;
    return title.replace("documentName", this.documentName);
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
      panelPartial: this.getPanelPartial(),
      panels: [
        {
          doc: this.source,
          title: "New Imported",
          class: "new",
          embedded: this._prepareEmbeddedDocuments(this.source),
          ...this._prepareDocumentTypeContext(this.source),
        },
        {
          doc: this.existing,
          title: "Existing in Compendium",
          class: "old",
          embedded: this._prepareEmbeddedDocuments(this.existing),
          ...this._prepareDocumentTypeContext(this.existing),
        },
      ],
      config: CONFIG,
      packName: this.pack.title,
    };
  }

  /**
   * Executes a document-specific context preparation method based on the document's type.
   * @param {Document} doc - The primary document being prepared.
   * @returns {Record<string, any>}
   */
  _prepareDocumentTypeContext(doc) {
    const methodName = `_prepare${this.documentName}Context`;
    const fn = this[methodName];

    if (typeof fn === "function") return fn.call(this, doc);
    return {};
  }

  _prepareSceneContext(doc) {
    return {};
  }

  getPanelPartial() {
    const partials = TCRDocumentsImportResolver.PARTIALS;
    return partials[this.documentName] || partials.Actor;
  }

  /**
   * Prepares and groups embedded documents across all sub-collections by document type.
   * @param {Document} doc - The primary parent document containing embedded collections.
   * @returns {Array<Array<{ type: string, label: string, items: HTMLAnchorElement[] }>>} Array of grouped embedded document lists.
   */
  _prepareEmbeddedDocuments(doc) {
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
   */
  static async showDialog(options = {}) {
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
