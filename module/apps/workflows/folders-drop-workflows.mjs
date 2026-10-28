import { getSubfoldersInCompendium, delay } from "../../utils.mjs";
import TCRDocumentsImportResolver from "../documents-import-resolver.mjs";

/**
 * @import Document from "../../../foundry/resources/app/common/abstract/document.mjs";
 */

/**
 * Abstract Base Class defining the Template Method for folder drop workflows.
 * @abstract
 */
export default class FolderDropWorkflow {
  static getWorkflow(isFromCompendium, isToCompendium) {
    if (!isFromCompendium) return DirectoryToCompendiumFolderWorkflow;
    return isToCompendium
      ? CompendiumToCompendiumFolderWorkflow
      : CompendiumToDirectoryFolderWorkflow;
  }

  /**
   * Creates an instance of FolderDropWorkflow.
   * @param {Object} context - The context object managing drop interactions and helpers.
   * @param {Folder} folder - The source folder being dropped.
   * @param {string|null} closestFolderId - The ID of the target folder where the drop occurred, if any.
   */
  constructor(context, folder, closestFolderId) {
    /** @type {Object} */
    this.context = context;
    /** @type {Folder} */
    this.folder = folder;
    /** @type {string|null} */
    this.closestFolderId = closestFolderId;
    /** @type {Collection<Document>} */
    this.collection = context.collection;
    /** @type {boolean} */
    this.isFromCompendium = !!folder.pack;
  }

  /** @type {typeof Document} */
  get documentClass() {
    return this.collection.documentClass;
  }

  /** @type {boolean} */
  get isItem() {
    return this.documentClass.documentName === "Item";
  }

  /** @type {boolean} */
  get isScene() {
    return this.documentClass.documentName === "Scene";
  }

  /** @type {CompendiumCollection|null} */
  get sourceCompendium() {
    return this.isFromCompendium ? this.folder.compendium : null;
  }

  /**
   * Fields required when building the compendium index. Overridden or customized as needed.
   * @type {string[]}
   */
  get indexFields() {
    if (this.isScene) return ["background.src"];
    if (this.isItem) return ["system.container"];
    return [];
  }

  /**
   * Defines the fixed execution skeleton for dropping folders.
   * @returns {Promise<{ folder: Folder|null, sortNeeded: boolean }|null>}
   */
  async execute() {
    const targetFolderId = await this.resolveTargetFolderId();

    const payload = await this.preparePayloads(targetFolderId);
    if (!payload) return null;

    const { foldersToCreate, documentsToCreate } = payload;
    if (!foldersToCreate.length && !documentsToCreate.length) return null;

    const { finalFolderId, createdFolders } = await this.createFolders(
      foldersToCreate,
      targetFolderId,
    );

    const processedSourceDocs = await this._processDocumentsInBatches(
      documentsToCreate,
      finalFolderId,
    );

    let deletedIds = new Set();
    if (createdFolders?.length) {
      deletedIds = await this.#deleteEmptyTargetFolders(createdFolders);
    }

    if (processedSourceDocs.length && this.shouldDeleteSource) {
      await Promise.all([
        this.#deleteSourceDocuments(processedSourceDocs),
        this.#deleteSourceFolders(this.folder, processedSourceDocs),
      ]);
    }

    return this.formatResult(createdFolders ?? [], finalFolderId, deletedIds);
  }

  /**
   * Process a list of raw document data objects in batches to optimize network calls and UI response time.
   * @param {Array<Object>} rawDocuments Array of document data objects or Document instances.
   * @param {string} targetFolderId Default target folder ID.
   * @returns {Promise<Array<Document>>} Array of processed source documents.
   */
  async _processDocumentsInBatches(rawDocuments, targetFolderId) {
    const CHUNK_SIZE = 50;
    const processedSourceDocs = [];
    const totalDocs = rawDocuments.length;

    const labelPlural = game.i18n.format(
      this.documentClass.metadata.labelPlural,
    );

    const label = `Importing ${labelPlural} Documents...`;

    const cachedIndex = await this.#getTargetIndex();

    SceneNavigation.displayProgressBar({
      label,
      pct: 0,
    });

    try {
      for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
        const chunk = rawDocuments.slice(i, i + CHUNK_SIZE);
        const batchToCreate = [];
        const batchSourceDocs = [];

        for (const docData of chunk) {
          const result = await this.#processSingleDocument(
            docData,
            targetFolderId,
            cachedIndex,
          );
          if (!result) continue;

          batchToCreate.push(...result.toCreate);
          batchSourceDocs.push(result.sourceDoc);
        }

        // Execute bulk creation for current chunk
        if (batchToCreate.length) {
          const createdDocs = await this.documentClass.createDocuments(
            batchToCreate,
            {
              pack: this.collection.collection,
              keepId: true,
            },
          );

          if (createdDocs.length) {
            processedSourceDocs.push(...batchSourceDocs);
          }
        }

        const progressPct = Math.min(
          Math.round(((i + chunk.length) / totalDocs) * 100),
          100,
        );
        SceneNavigation.displayProgressBar({ label, pct: progressPct });

        await delay(5);
      }
    } finally {
      SceneNavigation.displayProgressBar({ label, pct: 100 });
    }

    return processedSourceDocs;
  }

  /**
   * Fetches and caches the index for compendium collections if applicable.
   */
  async #getTargetIndex() {
    if (!(this.collection instanceof CompendiumCollection)) return null;
    return await this.collection.getIndex({ fields: this.indexFields });
  }

  /**
   * Hydrates document data if sourced from a compendium pack.
   */
  async _hydrateDocument(docData, options = {}) {
    return docData instanceof this.documentClass
      ? docData
      : new this.documentClass(docData, options);
  }

  /**
   * Handles individual document setup, resolution, and container contents formatting.
   */
  async #processSingleDocument(docData, targetFolderId, cachedIndex) {
    const sourceDoc = await this._hydrateDocument(docData);
    const folderId = docData.folder || targetFolderId;

    const resolution = await TCRDocumentsImportResolver._resolveDroppedEntry(
      this.collection,
      sourceDoc,
      folderId,
      cachedIndex,
    );

    if (!resolution) return null;

    const { resolvedEntry, targetFolderId: finalFolderId } = resolution;
    let toCreate = [];
    const contents = await sourceDoc.system?.contents;

    if (this.isItem && contents?.size) {
      toCreate = await CONFIG.Item.documentClass.createWithContents(
        [sourceDoc],
        { transformAll: (item) => item.toCompendium(item) },
      );

      const resolvedData = resolvedEntry.toCompendium(resolvedEntry);
      const rootIndex = toCreate.findIndex((d) => d._id === sourceDoc.id) ?? 0;

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

    return { toCreate, sourceDoc };
  }

  /**
   * Delete newly created target folders if they ended up empty.
   * @param {Folder[]} createdFolders
   */
  async #deleteEmptyTargetFolders(createdFolders) {
    const deletedIds = new Set();

    const sorted = [...createdFolders].sort(
      (a, b) => (b.ancestors?.length ?? 0) - (a.ancestors?.length ?? 0),
    );

    const foldersToDelete = [];
    for (const f of sorted) {
      const id = f.id ?? f._id;
      if (!id || deletedIds.has(id)) continue;

      const folderDoc = this.collection.folders.get(id);
      if (!folderDoc) continue;

      const hasContents = folderDoc.contents?.length > 0;
      const hasSubfolders = folderDoc.children?.some(
        (child) => !deletedIds.has(child.id ?? child._id),
      );

      if (!hasContents && !hasSubfolders) {
        foldersToDelete.push(id);
        deletedIds.add(id);
      }
    }

    if (foldersToDelete.length) {
      try {
        const packId =
          this.collection instanceof CompendiumCollection
            ? this.collection.collection
            : undefined;

        await CONFIG.Folder.documentClass.deleteDocuments(foldersToDelete, {
          pack: packId,
        });
      } catch (err) {
        console.error("Failed to delete empty target folders:", err);
        foldersToDelete.forEach((id) => deletedIds.delete(id));
      }
    }

    return deletedIds;
  }

  /**
   * Delete the original source document from World Directory or Compendium A
   * @param {Document|Document[]} entries
   */
  async #deleteSourceDocuments(entries) {
    if (!entries) return;
    const docs = Array.isArray(entries) ? entries : [entries];
    if (!docs.length) return;

    const worldDocsToDelete = [];
    const compendiumGroups = new Map();

    for (const entry of docs) {
      if (!entry) continue;

      if (entry.pack && entry.pack !== this.context?.collection?.collection) {
        if (!compendiumGroups.has(entry.pack)) {
          compendiumGroups.set(entry.pack, []);
        }
        compendiumGroups.get(entry.pack).push(entry);
      } else if (!entry.pack) {
        worldDocsToDelete.push(entry);
      }
    }

    if (worldDocsToDelete.length) {
      try {
        const ids = worldDocsToDelete.map((d) => d._id);
        const hasContents = worldDocsToDelete.some(
          (d) => !!d?.system?.contentsCount,
        );

        await this.documentClass.deleteDocuments(ids, {
          deleteContents: hasContents,
        });
      } catch (err) {
        console.error("Failed to delete world source documents:", err);
      }
    }

    for (const [packId, packDocs] of compendiumGroups) {
      try {
        /**@type {CompendiumCollection} */
        const sourcePack = game.packs.get(packId);
        if (!sourcePack) continue;

        const ids = packDocs.map((d) => d.id ?? d._id);
        const hasContents = packDocs.some((d) => !!d?.system?.contentsCount);

        await this.documentClass.deleteDocuments(ids, {
          pack: packId,
          deleteContents: hasContents,
        });
      } catch (err) {
        console.error(
          `Failed to delete compendium source documents in ${packId}:`,
          err,
        );
      }
    }
  }

  /**
   * Helper to clean up empty source folders after moving documents.
   * @param {Folder} rootFolder - The root folder being dropped
   * @param {Document[]} movedDocuments - Array of documents successfully imported
   */
  async #deleteSourceFolders(rootFolder, movedDocuments) {
    const subfolders = rootFolder.pack
      ? getSubfoldersInCompendium(rootFolder)
      : rootFolder.getSubfolders(true);
    const allFolders = [rootFolder, ...subfolders].sort(
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

  /* --- Steps to be implemented or overridden by subclasses --- */

  /**
   * Resolves the target folder ID where elements will be imported.
   * @returns {Promise<string>} The target folder ID.
   */
  async resolveTargetFolderId() {
    return (
      this.closestFolderId ??
      (
        await TCRDocumentsImportResolver.getOrCreateUnsortedFolder(
          this.collection,
        )
      ).id
    );
  }

  /**
   * Prepares the folder creation and document payloads.
   * Must be implemented by subclasses.
   * @abstract
   * @param {string} targetFolderId - The resolved destination folder ID.
   * @returns {Promise<{ foldersToCreate: Object[], documentsToCreate: Object[], createdFolder: Folder|null }>}
   */
  async preparePayloads(targetFolderId) {
    throw new Error("preparePayloads must be implemented by subclass");
  }

  /**
   * Creates the folder structure in the destination.
   * @param {Object[]} foldersToCreate - Array of folder data objects to create.
   * @param {string} targetFolderId - Fallback target folder ID.
   * @returns {Promise<string>} The ID of the primary created folder or target folder.
   */
  async createFolders(foldersToCreate, targetFolderId) {
    if (!foldersToCreate.length)
      return { finalFolderId: targetFolderId, createdFolders: [] };

    try {
      const packId =
        this.collection instanceof CompendiumCollection
          ? this.collection.collection
          : undefined;
      const createdFolders = await Folder.createDocuments(foldersToCreate, {
        pack: packId,
        keepId: true,
      });
      return {
        finalFolderId: createdFolders[0]?.id ?? targetFolderId,
        createdFolders,
      };
    } catch (err) {
      ui.notifications.error(err.message);
      throw err;
    }
  }

  /**
   * Determines whether the source folder and documents should be deleted after moving.
   * @returns {boolean} True if source should be deleted, false otherwise.
   */
  get shouldDeleteSource() {
    return !this.folder.pack;
  }

  /**
   * Formats the final workflow result output.
   * @param {Folder[]} [createdFolders=[]] - The folders created by {@link createFolders}
   * @param {string} targetFolderId - The destination folder ID resolved by
   * @param {Set<string>} [deletedIds=new Set()] - IDs of target folders that were removed by {@link #deleteEmptyTargetFolders}.
   * @returns {{ folder: Folder|null, sortNeeded: boolean }}
   */
  formatResult(createdFolders, targetFolderId, deletedIds = new Set()) {
    const survivingCreated = [...createdFolders]
      .filter((f) => !deletedIds.has(f.id ?? f._id))
      .sort(
        (a, b) => (a.ancestors?.length ?? 0) - (b.ancestors?.length ?? 0),
      )[0];

    const resolved =
      survivingCreated ??
      (targetFolderId && !deletedIds.has(targetFolderId)
        ? (this.collection.folders.get(targetFolderId) ?? null)
        : this.#findNearestSurvivingAncestor(targetFolderId, deletedIds));

    return { folder: resolved, sortNeeded: !!resolved };
  }

  /**
   * Walks up the folder hierarchy starting from `folderId` and returns the first
   * ancestor that still exists in the collection and was not pruned.
   * @param {string} folderId - The ID of the folder to start walking up from.
   * @param {Set<string>} deletedIds - IDs known to have been deleted;
   * @returns {Folder|null} The nearest surviving ancestor folder, or `null`
   */
  #findNearestSurvivingAncestor(folderId, deletedIds) {
    let current = this.collection.folders.get(folderId);
    while (current) {
      const parentId = current.parent?.id ?? current.folder?._id;
      if (!parentId) return null;
      if (!deletedIds.has(parentId)) {
        return this.collection.folders.get(parentId) ?? null;
      }
      current = this.collection.folders.get(parentId);
    }
    return null;
  }
}

/**
 * Directory to Compendium.
 * Flattens the nested source folder structure and imports all contents directly into the compendium destination.
 * @extends FolderDropWorkflow
 */
class DirectoryToCompendiumFolderWorkflow extends FolderDropWorkflow {
  /** @override */
  async preparePayloads(targetFolderId) {
    const flattenFolder = (node) => [
      ...(node.contents || []).map((doc) => {
        const data = doc.toObject
          ? doc.toObject()
          : foundry.utils.deepClone(doc);
        data.folder = targetFolderId;
        return data;
      }),
      ...(node.children || []).flatMap(flattenFolder),
    ];

    const documentsToCreate = flattenFolder(this.folder);

    return { foldersToCreate: [], documentsToCreate, createdFolder: null };
  }

  /**@override */
  formatResult(createdFolders, targetFolderId, deletedIds = new Set()) {
    const { folder } = super.formatResult(
      createdFolders,
      targetFolderId,
      deletedIds,
    );

    return { folder, sortNeeded: false };
  }
}

/**
 * Compendium to WorldDirectory
 * Handles dragging folders and documents from a compendium pack into the world directory.
 * @extends FolderDropWorkflow
 */
class CompendiumToDirectoryFolderWorkflow extends FolderDropWorkflow {
  /** @override */
  async resolveTargetFolderId() {
    return this.closestFolderId;
  }

  /** @override */
  async preparePayloads(targetFolderId) {
    const targetFolder = this.collection.folders.get(targetFolderId);
    const { foldersToCreate, documentsToCreate } =
      await this.context._organizeDroppedFoldersAndDocuments(
        this.folder,
        targetFolder,
      );

    return { foldersToCreate, documentsToCreate, createdFolder: null };
  }

  /**@override */
  async _hydrateDocument(docData) {
    let currentData = docData;

    if (!currentData.toObject) {
      const doc = await this.sourceCompendium.getDocument(currentData._id);
      if (doc) currentData = doc.toObject();
    }

    return super._hydrateDocument(currentData, {
      pack: this.sourceCompendium.collection,
    });
  }

  /** @override */
  get shouldDeleteSource() {
    return false;
  }
}

/**
 * Compendium to Compendium.
 * Handles moving folders and documents internally within the same compendium pack.
 * @extends FolderDropWorkflow
 */
class CompendiumToCompendiumFolderWorkflow extends FolderDropWorkflow {
  /** @override */
  async preparePayloads(targetFolderId) {
    const targetFolder = this.collection.folders.get(targetFolderId);
    const { foldersToCreate, documentsToCreate } =
      await this.context._organizeDroppedFoldersAndDocuments(
        this.folder,
        targetFolder,
      );

    return { foldersToCreate, documentsToCreate, createdFolder: null };
  }

  /**@override */
  async _hydrateDocument(docData) {
    let currentData = docData;

    if (!currentData.toObject) {
      const doc = await this.sourceCompendium.getDocument(currentData._id);
      if (doc) currentData = doc.toObject();
    }

    return super._hydrateDocument(currentData, {
      pack: this.sourceCompendium.collection,
    });
  }

  /** @override */
  get shouldDeleteSource() {
    return true;
  }
}
