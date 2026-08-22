import { MODULE_ID } from "../constants.mjs";

const { HandlebarsApplicationMixin: HAM, ApplicationV2 } =
  foundry.applications.api;

/**
 * @import { ApplicationClickAction, ApplicationConfiguration } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 */

export default class TCRActorImportResolver extends HAM(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.source = options.source;
    this.existing = options.existing;
    this.pack = options.pack;
    this.folderId = options.folderId;
  }

  /**
   * Internal Promise resolvers used to defer and return the user's resolution selection.
   * @type {{ promise: Promise<any>, resolve: Function, reject: Function }}
   */
  #resolvers = Promise.withResolvers();

  /**
   * A promise that resolves when the user submits or closes the dialog.
   * @type {Promise<any>}
   * @readonly
   */
  get promise() {
    return this.#resolvers.promise;
  }

  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: "tcr-actor-import-resolver-{id}",
    classes: [MODULE_ID, "tcr-actor-import-resolver"],
    window: {
      title: "Duplicate Actor Import Resolver",
      icon: "fa-solid fa-copy",
      resizable: true,
    },
    position: {
      width: 980,
      height: 640,
    },
    actions: {
      deleteOriginal: TCRActorImportResolver.#onDeleteOriginal,
      keepBoth: TCRActorImportResolver.#onKeepBoth,
      keepOriginal: TCRActorImportResolver.#onKeepOriginal,
      renameBoth: TCRActorImportResolver.#onRenameBoth,
    },
  };

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    summary: {
      template: `modules/${MODULE_ID}/templates/actor-importer-resolver/summary.hbs`,
    },
    actions: {
      template: `modules/${MODULE_ID}/templates/actor-importer-resolver/actions.hbs`,
    },
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options = {}) {
    const context = super._prepareContext(options);
    return {
      ...context,
      config: CONFIG,
      source: this.source,
      sourceItems: this._prepareItems(this.source),
      existing: this.existing,
      existingItems: this._prepareItems(this.existing),
      packName: this.pack?.metadata?.label ?? this.pack?.title ?? "Compendium",
    };
  }

  _prepareItems(actor) {
    const activeTypes = Object.entries(actor?.itemTypes ?? {})
      .filter(([, items]) => items.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => {
        return {
          label: CONFIG.Item?.typeLabels[key],
          items: items.map((i) => i.toAnchor()),
        };
      });

    return activeTypes;
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

      return TCRActorImportResolver._createDroppedEntry.call(
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
    if (!game.user.isGM || this.collection.documentName !== "Actor")
      return await callOriginal(entry, folderId);

    const document = entry.clone(
      { folder: folderId || null },
      { keepId: true },
    );
    const docs = await this.collection.getDocuments({
      name: document.name,
      folder: folderId,
    });
    if (docs.length > 0) {
      const existing = docs[0];

      entry = await TCRActorImportResolver.showDialog({
        source: document,
        existing: existing,
        folderId: folderId,
        pack: this.collection,
      });

      if (!entry) return;
    }
    return await callOriginal(entry, folderId);
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   *
   * @this {TCRActorImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onDeleteOriginal(event, target) {
    this.existing.delete();
    this.#resolvers.resolve(this.source);
    await this.close();
  }

  /**
   *
   * @this {TCRActorImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onKeepBoth(event, target) {
    this.#resolvers.resolve(this.source);
    await this.close();
  }

  /**
   *
   * @this {TCRActorImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onKeepOriginal(event, target) {
    this.#resolvers.resolve(null);
    await this.close();
  }

  /**
   *
   * @this {TCRActorImportResolver}
   * @type {ApplicationClickAction}
   */
  static async #onRenameBoth(event, target) {
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
