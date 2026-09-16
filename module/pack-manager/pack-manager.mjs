import LoginTracker from "../settings/login-tracker.mjs";
import { hasDocumentsInFolder } from "../utils.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import WorldFolderField from "../data/fields/world-folder-field.mjs";

const MS_PER_DAY = 86_400_000;
const MS_PER_MIN = 60000;

/**
 * @import {ActorData, FolderData} from "../../foundry/resources/app/common/types.mjs"
 */

/**
 * @typedef {Object} ActorIndex
 * @property {string} folder - The unique identifier of the folder containing the entry.
 * @property {string} img - The URL or path to the image asset.
 * @property {string} name - The display name of the index item.
 * @property {number} sort - The sort order integer for list positioning.
 * @property {string} type - The document type (e.g., "character").
 * @property {string} uuid - The full universal unique identifier path.
 * @property {string} _id - The database unique identifier.
 */

export default class TCRPackManager {
  /**@returns {Folder|undefined} */
  static get _unpackingFolder() {
    const folderID = game.settings.get(MODULE_ID, SETTINGS.UNPACKING_FOLDER);
    return game.actors.folders.get(folderID);
  }

  static get COLORS() {
    return {
      online: game.settings.get(MODULE_ID, SETTINGS.COLOR_ONLINE) ?? "#2549be",
      offline:
        game.settings.get(MODULE_ID, SETTINGS.COLOR_OFFLINE) ?? "#be2549",
      noUser: game.settings.get(MODULE_ID, SETTINGS.COLOR_NO_USER) ?? "#be9a25",
    };
  }

  /**@returns {boolean} */
  static get startPacking() {
    return game.settings.get(MODULE_ID, SETTINGS.AUTO_PACKING);
  }

  /**
   * Recursively extracts all document IDs from a folder tree structure.
   * @param {Folder} folder
   * @returns {string[]}
   */
  static #getDocIds(folder) {
    if (!folder) return [];
    const contentIds = folder.contents?.map((c) => c.id) || [];
    const childIds = (folder.children || []).flatMap((child) =>
      this.#getDocIds(child.folder || child),
    );
    return [...contentIds, ...childIds];
  }

  /**
   * Helper to resolve or dynamically create missing world folders when unpacking.
   * @param {Folder} compFolder - The folder inside the compendium.
   * @param {Map<string, Folder>} subfoldersMap - Map of existing world subfolders.
   * @param {Folder} rootPlayerFolder - The user's root folder in the world actors sidebar.
   * @param {boolean} createMissingFolders - Whether to create missing world folders.
   * @returns {Promise<string|null>} World folder ID.
   */
  static async #resolveOrCreateWorldFolder(
    compFolder,
    subfoldersMap,
    rootPlayerFolder,
    createMissingFolders,
  ) {
    if (!compFolder) return null;

    let match =
      subfoldersMap.get(compFolder.id) ||
      Array.from(subfoldersMap.values()).find(
        (f) => f.name === compFolder.name,
      );

    if (match) return match.id;

    if (createMissingFolders) {
      let parentWorldFolderId = rootPlayerFolder.id;

      if (compFolder.folder) {
        parentWorldFolderId = await this.#resolveOrCreateWorldFolder(
          compFolder.folder,
          subfoldersMap,
          rootPlayerFolder,
          true,
        );
      }

      const newWorldFolder = await Folder.create({
        name: compFolder.name,
        type: Actor.documentName,
        folder: parentWorldFolderId,
        sorting: compFolder.sorting || "m",
      });
      subfoldersMap.set(compFolder.id, newWorldFolder);
      return newWorldFolder.id;
    }

    return compFolder.folder
      ? this.#resolveOrCreateWorldFolder(
          compFolder.folder,
          subfoldersMap,
          rootPlayerFolder,
          false,
        )
      : rootPlayerFolder.id;
  }

  /**
   * Retrieves the designated CompendiumCollection pack
   * @param {object} [options={}]
   * @param {boolean} [options.unlock=false] -unlock the compendium if it is locked.
   * @returns {Promise<CompendiumCollection|undefined>}
   */
  static async #getCompendium({ unlock = false } = {}) {
    const key = game.settings.get(MODULE_ID, SETTINGS.PACKING_COMPENDIUM);
    const pack = game.packs.get(key);
    if (!pack) {
      ui.notifications.error(`Compendium ${key} not found!`);
      return;
    }
    if (unlock && pack.locked) await pack.configure({ locked: false });
    return pack;
  }

  /**
   * Finds or creates a top-level Folder inside the target Compendium pack.
   * @param {CompendiumCollection} pack - The target compendium pack collection.
   * @param {string} folderName - The name of the folder to find or create.
   * @returns {Promise<Folder>}
   */
  static async #getOrCreateCompendiumFolder(pack, folderName) {
    let parentFolder = pack.folders.find(
      (f) => f.name === folderName && !f.folder,
    );

    if (!parentFolder) {
      parentFolder = await Folder.create(
        [
          {
            name: folderName,
            type: pack.documentName,
            folder: null,
          },
        ],
        { pack: pack.collection },
      );
    }

    return parentFolder;
  }

  /**
   * Retrieves subfolders that match the name of an existing World user.
   * @param {Folder} folder - The parent folder to search within.
   * @returns {Folder[]} An array of subfolders corresponding to registered users.
   */
  static getPerUserFolders(folder) {
    const userNames = game.users.map((u) => u.name);
    return folder.getSubfolders().filter((f) => userNames.includes(f.name));
  }

  /**
   * Processes an array in chunks, invoking an async callback for each batch
   * @template T
   * @param {(batch: T[]) => Promise<void>} callback - Function executed per batch.
   * @param {T[]} array - Items to process.
   * @param {Object} [options]
   * @param {number} [options.batchSize=20] - Number of items per batch.
   * @param {number} [options.delayMs=200] - Delay between batches in milliseconds.
   * @returns {Promise<void>}
   */
  static async #resolveBatch(
    callback,
    array,
    { batchSize = 20, delayMs = 200 } = {},
  ) {
    if (!Array.isArray(array)) return;

    for (let i = 0; i < array.length; i += batchSize) {
      const batch = array.slice(i, i + batchSize);
      await callback(batch);

      const isLastBatch = i + batchSize >= array.length;
      if (!isLastBatch && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Handles the export of a world folder to a compendium and cleans up world state.
   * @param {Folder} userFolder - The world folder to pack.
   * @param {CompendiumCollection} pack - Target compendium.
   * @param {object} [options={}]
   * @param {boolean} [options.preserveFolder=true] - Keep the world folder structure intact (delete actors only).
   * @returns {Promise<boolean>} Success indicator.
   */
  static async #packFolder(userFolder, pack, { preserveFolder = true } = {}) {
    if (userFolder.compendium) {
      console.warn(
        `TCR PackManager | Export failed for folder "${userFolder.name}". The folder need be a world folder.`,
      );
      return false;
    }
    console.log(
      `TCR PackManager | Exporting folder "${userFolder.name}" to compendium...`,
    );
    const targetCompendiumFolder = await this.#getOrCreateCompendiumFolder(
      pack,
      userFolder.name,
    );

    const result = await this.exportToCompendium(
      pack,
      userFolder,
      targetCompendiumFolder,
    );

    if (!result) {
      console.warn(
        `TCR PackManager | Export failed for folder "${userFolder.name}". Aborting deletion.`,
      );
      return false;
    }

    /**
     * Syncs embedded documents from a world actor to a target compendium document.
     * @param {Actor} targetDoc - Compendium actor document
     * @param {Actor} sourceActor - World actor document source
     */
    const syncEmbeddedDocuments = async (targetDoc, sourceActor) => {
      for (const [key, collection] of Object.entries(targetDoc.collections)) {
        const toCreate = [];
        const toUpdate = [];
        const toDelete = [];

        const sourceItemIds = new Set(
          (sourceActor[key] ?? []).map((i) => i.id),
        );

        for (const { id } of collection) {
          if (!sourceItemIds.has(id)) {
            toDelete.push(id);
          }
        }

        for (const item of sourceActor[key] ?? []) {
          const existed = collection.get(item.id);
          if (existed) {
            const diff = foundry.utils.diffObject(
              existed.toObject(),
              item.toObject(),
            );
            if (!foundry.utils.isEmpty(diff))
              toUpdate.push({ _id: item.id, ...diff });
          } else {
            toCreate.push(item.toObject());
          }
        }

        const docName = collection.documentClass.documentName;

        if (toDelete.length) {
          await targetDoc.deleteEmbeddedDocuments(docName, toDelete);
        }

        // Batch create missing embedded documents
        if (toCreate.length) {
          await targetDoc.createEmbeddedDocuments(docName, toCreate, {
            keepId: true,
          });
        }

        // Batch update existing embedded documents
        if (toUpdate.length) {
          await targetDoc.updateEmbeddedDocuments(docName, toUpdate);
        }
      }
    };

    /**
     * Updates or creates documents in the compendium batch-wise, then cleans up world counterparts.
     * @param {Partial<ActorData>[]} items
     * @param {'updateDocuments' | 'createDocuments'} method
     */
    const processBatchOperation = async (items, method) => {
      if (!items?.length) return;

      await this.#resolveBatch(async (batch) => {
        const compendiumDocs = await Actor[method](batch, {
          pack: pack.collection,
          keepId: true,
        });

        const userFolderActors = [
          ...userFolder.contents,
          ...userFolder.getSubfolders().flatMap((f) => f.contents),
        ];

        const actorsToDelete = new Set();
        for (const compDoc of compendiumDocs) {
          const { _id, name, img } = compDoc;

          const worldActor = userFolderActors.find(
            (a) =>
              !actorsToDelete.has(a._id) &&
              (a._id === _id || (a.name === name && a.img === img)),
          );

          if (!worldActor) continue;
          actorsToDelete.add(worldActor._id);
          await syncEmbeddedDocuments(compDoc, worldActor);
        }

        if (actorsToDelete.size) {
          await Actor.deleteDocuments(Array.from(actorsToDelete));
        }
      }, items);
    };

    await processBatchOperation(result.documentsToUpdate, "updateDocuments");
    await processBatchOperation(result.documentsToCreate, "createDocuments");

    if (!preserveFolder && !hasDocumentsInFolder(userFolder)) {
      await userFolder.delete({
        deleteSubfolders: true,
      });
    }
    return true;
  }

  /***************************************************************/

  /**
   * Export all Documents contained in this Folder to a given Compendium pack.
   * Optionally update existing Documents within the Pack by name, otherwise append all new entries.
   * @param {CompendiumCollection} pack       A Compendium pack to which the documents will be exported
   * @param {Folder} origin -
   * @param {Folder} target - A target folder  to which the documents will be exported
   * @returns {Promise<Boolean|{ documentsToCreate: Partial<ActorData>[], documentsToUpdate: Partial<ActorData>[] }>}
   */
  static async exportToCompendium(pack, origin, target) {
    /**@type {ActorIndex} */
    const index = await pack.getIndex();

    // Classify creations and updates
    /**@type {Partial<FolderData>[]} */
    const foldersToCreate = [];
    /**@type {Partial<FolderData>[]} */
    const foldersToUpdate = [];
    /**@type {Partial<ActorData>[]} */
    const documentsToCreate = [];
    /**@type {Partial<ActorData>[]} */
    const documentsToUpdate = [];

    // Ensure we do not overflow maximum allowed folder depth
    const originDepth = origin.ancestors.length;
    const targetDepth =
      (pack.folders.get(target.id)?.ancestors.length ?? 0) + 1;

    const exportOptions = {
      keepFolders: true,
      keepId: true,
      updateByName: true,
      clearOwnership: false,
      folder: target.id,
    };

    /**
     * Recursively extract the contents and subfolders of a Folder into the Pack
     * @param {Folder} folder       The Folder to extract
     * @param {number} [_depth]     An internal recursive depth tracker
     * @private
     */
    const _extractFolder = async (folder, _depth = 0) => {
      const folderData = folder.toCompendium(pack, {
        ...exportOptions,
        clearSort: false,
      });

      const currentDepth = _depth + targetDepth - originDepth;
      if (currentDepth > pack.maxFolderDepth) {
        throw new Error(
          `Folder "${folder.name}" exceeds maximum allowed folder depth of ${pack.maxFolderDepth}`,
        );
      }

      if (folderData.folder === origin.id) folderData.folder = target.id;

      if (folder !== origin) {
        const existingFolder = pack.folders.find(
          (f) =>
            f.name === folder.name &&
            (f.folder?.id === target.id || f.ancestors.includes(target.id)),
        );
        if (existingFolder) {
          folderData._id = existingFolder._id;
          foldersToUpdate.push(folderData);
        } else {
          foldersToCreate.push(folderData);
        }
      }

      for (const doc of folder.contents) {
        const data = doc.toCompendium(pack, exportOptions);

        // Re-parent folder reference
        data.folder = data.folder === origin.id ? target.id : folderData._id;

        // Match documents by name, image, and folder
        const existingDoc = index.find(
          (i) =>
            i.name === data.name &&
            i.img === data.img &&
            i.folder === data.folder,
        );

        if (existingDoc) {
          data._id = existingDoc._id;
          documentsToUpdate.push(data);
        } else {
          documentsToCreate.push(data);
        }

        console.log(
          `Prepared "${data.name}" for export to "${pack.collection}"`,
        );
      }

      // Iterate over subfolders of the Folder, preparing each for export
      for (let c of folder.children) await _extractFolder(c.folder, _depth + 1);
    };

    // Prepare folders for export
    try {
      await _extractFolder(origin);
    } catch (err) {
      const msg = `Cannot export Folder "${origin.name}" to Compendium pack "${pack.collection}":\n${err.message}`;
      ui.notifications.error(msg, { console: true });
      return false;
    }

    // Create and update Folders
    if (foldersToUpdate.length) {
      await Folder.updateDocuments(foldersToUpdate, {
        pack: pack.collection,
        diff: false,
        recursive: false,
        render: false,
      });
    }
    if (foldersToCreate.length) {
      await Folder.createDocuments(foldersToCreate, {
        pack: pack.collection,
        keepId: true,
        render: false,
      });
    }

    pack.render(false);
    return { documentsToCreate, documentsToUpdate };
  }

  /* -------------------------------------------- */
  /*  Main Methods                                */
  /* -------------------------------------------- */

  /**
   * Register setting and menu.
   */
  static registerSetting() {
    game.settings.register(MODULE_ID, SETTINGS.FOLDER_COLORS, {
      name: "Override Player Folder Colors",
      hint: "When enabled, forces player folders in the compendium and folder to reflect online/offline status colors, overriding any manually assigned folder colors.",
      config: true,
      scope: "world",
      default: false,
      type: Boolean,
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR_ONLINE, {
      name: "Online Folder Color",
      hint: "Background color for active/online user folders.",
      config: true,
      scope: "world",
      default: "#2549be",
      type: new foundry.data.fields.ColorField({
        initial: "#2549be",
      }),
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR_OFFLINE, {
      name: "Offline Folder Color",
      hint: "Background color for inactive/offline user folders.",
      config: true,
      scope: "world",
      default: "#be2549",
      type: new foundry.data.fields.ColorField({
        initial: "#be2549",
      }),
    });

    game.settings.register(MODULE_ID, SETTINGS.COLOR_NO_USER, {
      name: "Unmapped Folder Color",
      hint: "Background color for folders without a matching user name.",
      config: true,
      scope: "world",
      default: "#be9a25",
      type: new foundry.data.fields.ColorField({
        initial: "#be9a25",
      }),
    });

    game.settings.register(MODULE_ID, SETTINGS.MINUTES_THRESHOLD_DISCONNECTED, {
      name: "Offline Status Threshold (Minutes)",
      hint: "The number of minutes a player must be disconnected before their folder is marked as offline.",
      config: true,
      scope: "world",
      default: 5,
      type: new foundry.data.fields.NumberField({
        initial: 5,
        integer: true,
        positive: true,
      }),
    });

    game.settings.register(MODULE_ID, SETTINGS.AUTO_PACKING, {
      name: "Enable Auto-Archive on World Startup",
      hint: "When enabled, automatically archives inactive player actors into the compendium and restores logging-in player actors upon world load.",
      config: true,
      scope: "world",
      default: false,
      type: Boolean,
    });

    game.settings.register(MODULE_ID, SETTINGS.UNPACKING_FOLDER, {
      name: "Unpacking Destination Folder",
      hint: "Select the world folder where player actors will be unpacked from the compendium.",
      config: true,
      scope: "world",
      default: "",
      type: new WorldFolderField({
        required: false,
        nullable: true,
        blank: true,
        contentType: Actor.documentName,
      }),
    });

    game.settings.register(MODULE_ID, SETTINGS.PACKING_COMPENDIUM, {
      name: "Storage Compendium Pack",
      hint: "Choose the actor compendium where inactive players actors will be archived.",
      config: true,
      scope: "world",
      default: "",
      type: new foundry.data.fields.StringField({
        blank: true,
        required: false,
        choices: () =>
          Object.fromEntries(
            Array.from(game.packs.entries())
              .filter(
                ([_, { metadata }]) => metadata.type === Actor.documentName,
              )
              .map(([key, { metadata }]) => [key, metadata.label]),
          ),
      }),
    });
  }

  /**
   * Exports the actor folders of inactive player to the compendium,
   * and removes empty folders from the World.
   * @returns {Promise<void>}
   */
  static async packingProcess() {
    if (!game.users.activeGM?.isSelf) return;
    const playersFolder = this._unpackingFolder;
    if (!playersFolder) return;

    console.log("TCR PackManager | Initializing GM Auto-Packing check...");

    try {
      const pack = await this.#getCompendium({ unlock: true });

      if (!pack)
        return void console.warn(
          "TCR PackManager | Could not open compendium. Aborting.",
        );

      const INACTIVE_THRESHOLD =
        LoginTracker.INACTIVE_THRESHOLD_SETTING * MS_PER_DAY;

      const DISCONNECTED_THRESHOLD =
        game.settings.get(MODULE_ID, SETTINGS.MINUTES_THRESHOLD_DISCONNECTED) *
        MS_PER_MIN;

      const now = Date.now();

      for (const userFolder of playersFolder.getSubfolders()) {
        if (!hasDocumentsInFolder(userFolder)) continue;

        const user = game.users.getName(userFolder.name);

        // 1. Orphaned folder check (No user exists)
        if (!user) {
          console.log(
            `TCR PackManager | No player found for folder "${userFolder.name}". Packing and deleting folder.`,
          );
          await this.#packFolder(userFolder, pack, { preserveFolder: false });
          continue;
        }

        // 2. Skip immediately if logged in
        if (user.active) continue;

        const { lastLogin } = user ? LoginTracker.getLoginData(user) : {};

        // If no login record exists, assume 0 so we don't accidentally wipe a new user's folder
        const timeSinceLogin = lastLogin ? now - lastLogin : 0;

        // Offline for a very long time
        if (timeSinceLogin > INACTIVE_THRESHOLD) {
          console.log(
            `TCR PackManager | Player "${user.name}" is inactive. Packing and deleting folder.`,
          );
          await this.#packFolder(userFolder, pack, { preserveFolder: false });
        }
        //Offline for a short time
        else if (timeSinceLogin > DISCONNECTED_THRESHOLD) {
          console.log(
            `TCR PackManager | Player "${user.name}" is offline. Packing stuff.`,
          );
          await this.#packFolder(userFolder, pack, { preserveFolder: true });
        }
      }

      console.log("TCR PackManager | GM Auto-Packing Finish!");
    } catch (error) {
      console.error(
        "TCR PackManager | Auto-Packing encountered an error:",
        error,
      );
    }
  }

  /**
   * Packs all subfolders in the unpacking folder into the compendium
   * @returns {Promise<void>}
   */
  static async packingAll() {
    if (!game.user.isGM) return;
    console.log("TCR PackManager | Initializing Packing...");

    const playersFolder = this._unpackingFolder;
    if (!playersFolder)
      return void console.warn(
        "TCR PackManager | Unpacking target folder not found in world actors.",
      );

    try {
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack)
        return void console.warn(
          "TCR PackManager | Could not open compendium. Aborting.",
        );

      for (const userFolder of playersFolder.getSubfolders()) {
        const user = game.users.getName(userFolder.name);

        console.log(
          `TCR PackManager | ${
            user
              ? `Player "${user.name}". Packing stuff.`
              : `No player found for folder "${userFolder.name}". Packing and deleting folder.`
          }`,
        );

        await this.#packFolder(userFolder, pack, {
          preserveFolder: Boolean(user),
        });
      }

      ui.notifications.info(
        `TCR PackManager | Successfully packed all folder(s) into ${pack.metadata.label}.`,
        { console: true },
      );
    } catch (error) {
      console.error(
        "TCR PackManager | Packing All encountered an error:",
        error,
      );
    }
  }

  /**
   * Packs a specific user's folder into the compendium and removes the actors from the world.
   * @param {string} userName - The name of the user whose folder should be packed.
   * @returns {Promise<void>}
   */
  static async packUserFolder(userName) {
    if (!game.user.isGM) return;

    const playersFolder = this._unpackingFolder;
    if (!playersFolder)
      return void console.log(
        "TCR PackManager | Destination folder not found.",
      );

    /**@type {Folder} */
    const targetFolder = game.actors.folders.find(
      (f) => f.name === userName && f.folder?.id === playersFolder.id,
    );

    if (!targetFolder)
      return void ui.notifications.warn(
        `TCR PackManager | No folder found for user "${userName}".`,
      );

    try {
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack)
        return void console.warn(
          "TCR PackManager | Could not open compendium. Aborting.",
        );

      const user = game.users.getName(userName);
      await this.#packFolder(targetFolder, pack, {
        preserveFolder: Boolean(user),
      });

      ui.notifications.info(
        `TCR PackManager | Successfully packed folder for user "${userName}".`,
        { console: true },
      );
    } catch (error) {
      console.error(
        `TCR PackManager | Failed to pack folder for user "${userName}":`,
        error,
      );
    }
  }

  /**
   * Unpacks a specific user's folder from the compendium into their designated world folder.
   * @param {string} userName - The name of the user whose folder should be unpacked.
   * @param {boolean} [createMissingFolders=false] - If true, recreates missing subfolder trees in the world.
   * @returns {Promise<void>}
   */
  static async unpackUserFolder(userName, createMissingFolders = false) {
    const playersFolders = this._unpackingFolder;
    if (!playersFolders) {
      return void console.warn(
        "TCR PackManager | 'Players' folder not found in world actors.",
      );
    }

    /**@type {Folder} */
    const playerFolder = game.actors.folders.find(
      (f) => f.name === userName && f.folder?.id === playersFolders.id,
    );

    if (!playerFolder) {
      return void ui.notifications.warn(
        `TCR PackManager | Target folder for "${userName}" not found in world actors.`,
      );
    }

    const pack = await this.#getCompendium();
    if (!pack) {
      return void console.warn(
        "TCR PackManager | Could not open compendium. Aborting unpacking process.",
      );
    }

    const rootCompFolder = pack.folders?.find(
      (f) => f.name === userName && !f.folder,
    );

    if (!rootCompFolder) {
      return void ui.notifications.info(
        `TCR PackManager | No compendium folder found for user "${userName}".`,
        { console: true },
      );
    }

    const subfoldersMap = new Map(
      playerFolder.getSubfolders(true).map((f) => [f.id, f]),
    );
    subfoldersMap.set(playerFolder.id, playerFolder);

    const actorsToCreate = [];

    const extractContent = async (compFolder) => {
      const docs = await pack.getDocuments({ folder: compFolder.id });
      const targetWorldFolderId = await this.#resolveOrCreateWorldFolder(
        compFolder,
        subfoldersMap,
        playerFolder,
        createMissingFolders,
      );

      if (targetWorldFolderId) {
        for (const doc of docs) {
          const existingActor = game.actors.find(
            /**@param {Actor} a*/
            (a) =>
              a.folder?.id === targetWorldFolderId &&
              (a.id === doc.id || (a.name === doc.name && a.img === doc.img)),
          );

          if (!existingActor) {
            const actorData = doc.toObject();
            actorData.folder = targetWorldFolderId;

            const { OWNER, NONE } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
            actorData.ownership = {
              default: actorData.ownership.default ?? NONE,
              [game.user.id]: OWNER,
            };
            actorsToCreate.push(actorData);
          }
        }
      }

      const children = pack.folders.filter(
        (f) => f.folder?.id === compFolder.id,
      );
      for (const child of children) {
        await extractContent(child);
      }
    };

    try {
      await extractContent(rootCompFolder);

      if (actorsToCreate.length === 0) {
        ui.notifications.info(
          `TCR PackManager | No new actors to unpack for "${userName}".`,
          { console: true },
        );
        return;
      }

      this.#resolveBatch(async (batch) => {
        await Actor.createDocuments(batch, { keepId: true });
      }, actorsToCreate);

      ui.notifications.info(
        `TCR PackManager | Successfully unpacked ${actorsToCreate.length} actor(s) for "${userName}".`,
        { console: true },
      );
    } catch (error) {
      console.error(
        `TCR PackManager | Failed to unpack folder for user "${userName}":`,
        error,
      );
    }
  }

  /**
   * Unpacks Actors from the active user's compendium folder into the world.
   * @param {boolean} [createMissingFolders=false] - If true, recreates missing subfolder trees in the world.
   * @returns {Promise<void>}
   */
  static async unpackingProcess(createMissingFolders = false) {
    console.log(
      "TCR PackManager | Initializing Player Auto-Unpacking check...",
    );
    await this.unpackUserFolder(game.user.name, createMissingFolders);
  }
}
