import LoginTracker from "../settings/login-tracker.mjs";
import { hasDocumentsInFolder } from "../utils.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import WorldFolderField from "../data/fields/world-folder-field.mjs";

const MS_PER_DAY = 86_400_000;

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
  static #EXPORT_OPTIONS = Object.freeze({
    keepFolders: true,
    keepId: true,
    updateByName: true,
    clearOwnership: false,
  });

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
      const created = await Folder.createDocuments(
        [
          {
            name: folderName,
            type: pack.documentName,
            folder: null,
          },
        ],
        { pack: pack.collection },
      );
      parentFolder = created[0];
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
   * Deletes actors in batches to prevent UI freeze or API rate-limiting issues.
   * @param {string[]} actorIDs - Array of document IDs for the actors to be deleted.
   * @returns {Promise<void>}
   */
  static async #deleteActors(actorIDs) {
    if (actorIDs.length) {
      const BATCH_SIZE = 20;

      for (let i = 0; i < actorIDs.length; i += BATCH_SIZE) {
        const batch = actorIDs.slice(i, i + BATCH_SIZE);

        await Actor.deleteDocuments(batch);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  /***************************************************************/

  /**
   * Export all Documents contained in this Folder to a given Compendium pack.
   * Optionally update existing Documents within the Pack by name, otherwise append all new entries.
   * @this {Folder}
   * @param {CompendiumCollection} pack       A Compendium pack to which the documents will be exported
   * @param {object} [options] - Additional options which customize how content is exported. See {@link ClientDocumentMixin#toCompendium}
   * @param {boolean} [options.updateByName=false] - Update existing entries in the Compendium pack, matching by name
   * @param {boolean} [options.keepId=false] - Retain the original _id attribute when updating an entity
   * @param {boolean} [options.keepFolders=false] - Retain the existing Folder structure
   * @param {string} [options.folder] - A target folder id to which the documents will be exported
   * @returns {Promise<CompendiumCollection>}  The updated Compendium Collection instance
   */
  static async exportToCompendium(pack, options = {}) {
    const updateByName = options.updateByName ?? false;
    const index = await pack.getIndex();
    ui.notifications.info(
      game.i18n.format("FOLDER.Exporting", {
        type: game.i18n.localize(
          getDocumentClass(this.type).metadata.labelPlural,
        ),
        compendium: pack.collection,
      }),
    );
    options.folder ||= null;

    // Classify creations and updates
    const foldersToCreate = [];
    const foldersToUpdate = [];
    const documentsToCreate = [];
    const documentsToUpdate = [];

    // Ensure we do not overflow maximum allowed folder depth
    const originDepth = this.ancestors.length;
    const targetDepth = options.folder
      ? (pack.folders.get(options.folder)?.ancestors.length ?? 0) + 1
      : 0;

    /**
     * Recursively extract the contents and subfolders of a Folder into the Pack
     * @param {Folder} folder       The Folder to extract
     * @param {number} [_depth]     An internal recursive depth tracker
     * @private
     */
    const _extractFolder = async (folder, _depth = 0) => {
      const folderData = folder.toCompendium(pack, {
        ...options,
        clearSort: false,
        keepId: true,
      });

      if (options.keepFolders) {
        // Ensure that the exported folder is within the maximum allowed folder depth
        const currentDepth = _depth + targetDepth - originDepth;
        const exceedsDepth = currentDepth > pack.maxFolderDepth;
        if (exceedsDepth) {
          throw new Error(
            `Folder "${folder.name}" exceeds maximum allowed folder depth of ${pack.maxFolderDepth}`,
          );
        }

        // Re-parent child folders into the target folder or into the compendium root
        if (folderData.folder === this.id) folderData.folder = options.folder;

        // Classify folder data for creation or update
        if (folder !== this) {
          const existing = updateByName
            ? pack.folders.find((f) => f.name === folder.name)
            : pack.folders.get(folder.id);
          if (existing) {
            folderData._id = existing._id;
            foldersToUpdate.push(folderData);
          } else foldersToCreate.push(folderData);
        }
      }

      // Iterate over Documents in the Folder, preparing each for export
      for (let doc of folder.contents) {
        const data = doc.toCompendium(pack, options);

        // Re-parent immediate child documents into the target folder.
        if (data.folder === this.id) data.folder = options.folder;
        // Otherwise retain their folder structure if keepFolders is true.
        else
          data.folder = options.keepFolders ? folderData._id : options.folder;

        // Generate thumbnails for Scenes
        if (doc instanceof Scene) {
          const { thumb } = await doc.createThumbnail({
            img: data.background.src,
          });
          data.thumb = thumb;
        }

        // Classify document data for creation or update
        const existing = updateByName
          ? index.find((i) => i.name === data.name)
          : index.find((i) => i._id === data._id);
        if (existing) {
          data._id = existing._id;
          documentsToUpdate.push(data);
        } else documentsToCreate.push(data);
        console.log(
          `Prepared "${data.name}" for export to "${pack.collection}"`,
        );
      }

      // Iterate over subfolders of the Folder, preparing each for export
      for (let c of folder.children) await _extractFolder(c.folder, _depth + 1);
    };

    // Prepare folders for export
    try {
      await _extractFolder(this, 0);
    } catch (err) {
      const msg = `Cannot export Folder "${this.name}" to Compendium pack "${pack.collection}":\n${err.message}`;
      return ui.notifications.error(msg, { console: true });
    }

    // Create and update Folders
    if (foldersToUpdate.length) {
      await this.constructor.updateDocuments(foldersToUpdate, {
        pack: pack.collection,
        diff: false,
        recursive: false,
        render: false,
      });
    }
    if (foldersToCreate.length) {
      await this.constructor.createDocuments(foldersToCreate, {
        pack: pack.collection,
        keepId: true,
        render: false,
      });
    }

    // Create and update Documents
    const cls = pack.documentClass;
    if (documentsToUpdate.length)
      await cls.updateDocuments(documentsToUpdate, {
        pack: pack.collection,
        diff: false,
        recursive: false,
        render: false,
      });
    if (documentsToCreate.length)
      await cls.createDocuments(documentsToCreate, {
        pack: pack.collection,
        keepId: options.keepId,
        render: false,
      });

    // Re-render the pack
    ui.notifications.info(
      game.i18n.format("FOLDER.ExportDone", {
        type: game.i18n.localize(
          getDocumentClass(this.type).metadata.labelPlural,
        ),
        compendium: pack.collection,
      }),
    );
    pack.render(false);
    return pack;
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

    console.log("TCR | Initializing GM Auto-Packing check...");

    try {
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack) {
        console.warn(
          "TCR | Could not open compendium. Aborting packing process.",
        );
        return;
      }

      const FIVE_MINUTES =
        game.settings.get(MODULE_ID, SETTINGS.INACTIVE_THRESHOLD) * 60000;
      const now = Date.now();

      for (const userFolder of playersFolder.getSubfolders()) {
        const user = game.users.getName(userFolder.name);
        const { lastLogin } = user ? LoginTracker.getLoginData(user) : {};
        const timeSinceLogin = lastLogin ? now - lastLogin : 0;

        const isInactive =
          user &&
          timeSinceLogin > MS_PER_DAY * LoginTracker.INACTIVE_THRESHOLD_SETTING;
        const isOffline = user && !isInactive && timeSinceLogin > FIVE_MINUTES;

        if (!hasDocumentsInFolder(userFolder)) continue;

        if (!user || isOffline || isInactive) {
          let logMsg = "";

          if (isInactive) {
            logMsg = `Player "${user.name}" is inactive. Packing and deleting folder.`;
          } else if (isOffline) {
            logMsg = `Player "${user.name}" is offline. Packing stuff.`;
          } else {
            logMsg = `No player found for folder "${userFolder.name}". Packing and deleting folder.`;
          }

          console.log(`TCR | ${logMsg}`);

          const targetFolder = await this.#getOrCreateCompendiumFolder(
            pack,
            userFolder.name,
          );

          await this.exportToCompendium.call(userFolder, pack, {
            ...this.#EXPORT_OPTIONS,
            folder: targetFolder.id,
          });

          if (isOffline) {
            // Remove actors from world, but keep the user folder for returning offline players
            const actorIDs = this.#getDocIds(userFolder);
            await this.#deleteActors(actorIDs);
          } else {
            // For inactive players (or deleted users), purge the world folder completely
            await userFolder.delete({
              deleteSubfolders: true,
              deleteContents: true,
            });
          }
        }
      }
      console.log("TCR | GM Auto-Packing Finish!");
    } catch (error) {
      console.error("TCR | Auto-Packing encountered an error:", error);
    }
  }

  /**
   * Packs all subfolders in the unpacking folder into the compendium
   * @returns {Promise<void>}
   */
  static async packingAll() {
    if (!game.user.isGM) return;
    console.log("TCR | Initializing Packing...");

    const playersFolder = this._unpackingFolder;
    if (!playersFolder)
      return void console.warn(
        "TCR | Unpacking target folder not found in world actors.",
      );

    try {
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack) {
        return void console.warn(
          "TCR | Could not open compendium. Aborting packing process.",
        );
      }

      for (const userFolder of playersFolder.getSubfolders()) {
        console.log(
          `TCR | Exporting folder "${userFolder.name}" to compendium...`,
        );

        const user = game.users.getName(userFolder.name);

        const logMsg = user
          ? `Player "${user.name}". Packing stuff.`
          : `No player found for folder "${userFolder.name}". Packing and deleting folder.`;

        console.log(`TCR | ${logMsg}`);

        const targetFolder = await this.#getOrCreateCompendiumFolder(
          pack,
          userFolder.name,
        );

        await this.exportToCompendium.call(userFolder, pack, {
          ...this.#EXPORT_OPTIONS,
          folder: targetFolder.id,
        });

        if (user) {
          const actorIDs = this.#getDocIds(userFolder);
          await this.#deleteActors(actorIDs);
        } else {
          await userFolder.delete({
            deleteSubfolders: true,
            deleteContents: true,
          });
        }
      }

      ui.notifications.info(
        `Successfully packed all folder(s) into ${pack.metadata.label}.`,
      );
    } catch (error) {
      console.error("TCR | Packing All encountered an error:", error);
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
      return void console.log("TCR | Destination folder not found.");

    /**@type {Folder} */
    const targetFolder = game.actors.folders.find(
      (f) => f.name === userName && f.folder?.id === playersFolder.id,
    );

    if (!targetFolder)
      return void ui.notifications.warn(
        `TCR | No folder found for user "${userName}".`,
      );

    try {
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack) {
        console.warn(
          "TCR | Could not open compendium. Aborting packing process.",
        );
        return;
      }

      console.log(
        `TCR | Exporting folder "${targetFolder.name}" to compendium...`,
      );
      const targetCompendiumFolder = await this.#getOrCreateCompendiumFolder(
        pack,
        targetFolder.name,
      );

      await this.exportToCompendium.call(targetFolder, pack, {
        ...this.#EXPORT_OPTIONS,
        folder: targetCompendiumFolder.id,
      });

      const user = game.users.getName(userName);

      if (user) {
        const actorIDs = this.#getDocIds(targetFolder);
        await this.#deleteActors(actorIDs);
      } else {
        await targetFolder.delete({
          deleteSubfolders: true,
          deleteContents: true,
        });
      }

      ui.notifications.info(
        `Successfully packed folder for user "${userName}".`,
      );
    } catch (error) {
      console.error(
        `TCR | Failed to pack folder for user "${userName}":`,
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
    if (!playersFolders)
      return void console.warn(
        "TCR | 'Players' folder not found in world actors.",
      );

    /**@type {Folder} */
    const playerFolder = game.actors.folders.find(
      (f) => f.name === userName && f.folder?.id === playersFolders.id,
    );

    if (!playerFolder)
      return void ui.notifications.warn(
        `TCR | Target folder for "${userName}" not found in world actors.`,
      );

    const pack = await this.#getCompendium();
    if (!pack) return;

    const rootCompFolder = pack.folders?.find(
      (f) => f.name === userName && !f.folder,
    );

    if (!rootCompFolder) {
      ui.notifications.info(
        `TCR | No compendium folder found for user "${userName}".`,
      );
      return;
    }

    const subfoldersMap = new Map(
      playerFolder.getSubfolders(true).map((f) => [f.id, f]),
    );
    subfoldersMap.set(playerFolder.id, playerFolder);

    const resolveFolderId = (compFolder) => {
      if (!compFolder) return null;
      const match =
        subfoldersMap.get(compFolder.id) ||
        Array.from(subfoldersMap.values()).find(
          (f) => f.name === compFolder.name,
        );

      if (match) return match.id;
      return compFolder.folder ? resolveFolderId(compFolder.folder) : null;
    };

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
            (a) =>
              a.folder?.id === targetWorldFolderId &&
              (a.id === doc.id || a.name === doc.name),
          );

          if (!existingActor) {
            const actorData = doc.toObject();
            actorData.folder = targetWorldFolderId;
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
          `TCR | No new actors to unpack for "${userName}".`,
        );
        return;
      }

      await Actor.createDocuments(actorsToCreate, { keepId: true });
      ui.notifications.info(
        `Successfully unpacked ${actorsToCreate.length} actor(s) for "${userName}".`,
      );
    } catch (error) {
      console.error(
        `TCR | Failed to unpack folder for user "${userName}":`,
        error,
      );
    }
  }

  /**
   * Unpacks Actorsfrom a user-specific compendium folder into the world's.
   * @param {boolean} [createMissingFolders=false] - If true, recreates missing subfolder trees in the world.
   * @returns {Promise<void>}
   */
  static async unpackingProcess(createMissingFolders = false) {
    console.log("TCR | Initializing PLayer Auto-UnPacking check...");

    const playersFolders = this._unpackingFolder;

    if (!playersFolders)
      return void console.warn(
        "TCR | 'Players' folder not found in world actors.",
      );

    // 1. Validate destination folder in World
    /**@type {Folder} */
    const playerFolder = game.actors.folders.find(
      (f) =>
        f._source.name === game.user.name &&
        f._source.folder === playersFolders.id,
    );

    if (!playerFolder)
      return void console.warn(
        `TCR | ${game.user.name} folder not found in world actors.`,
      );

    // 2. Retrieve compendium and root user folder
    const pack = await this.#getCompendium();
    if (!pack)
      return void console.warn(
        "TCR | Could not open compendium. Aborting packing process.",
      );

    /**@type {Folder} */
    const rootCompFolder = pack?.folders?.getName(game.user.name);
    if (!pack || !rootCompFolder) return;

    const subfoldersMap = new Map(
      playerFolder.getSubfolders(true).map((f) => [f.id, f]),
    );

    subfoldersMap.set(playerFolder.id, playerFolder);

    /**
     * Finds the nearest existing world folder ID by matching either ID or Name.
     * @param {Folder} compFolder
     * @returns {string|null} World Folder ID or null
     */
    const resolveFolderId = (compFolder) => {
      if (!compFolder) return null;

      const match =
        subfoldersMap.get(compFolder.id) ||
        Array.from(subfoldersMap.values()).find(
          (f) => f.name === compFolder.name,
        );

      if (match) return match.id;

      return compFolder.folder ? resolveFolderId(compFolder.folder) : null;
    };

    const actorsToCreate = [];

    /**
     * Recursively creates missing world folders and extracts actor documents.
     * @param {Folder} compFolder - The current compendium folder instance
     */
    const extractContent = async (compFolder) => {
      const docs = await pack.getDocuments({ folder: compFolder.id });
      const targetWorldFolderId = await this.#resolveOrCreateWorldFolder(
        compFolder,
        subfoldersMap,
        playerFolder,
        createMissingFolders,
      );
      if (!targetWorldFolderId) return;
      for (const doc of docs) {
        const existingActor = game.actors.find(
          (a) =>
            a.folder?.id === targetWorldFolderId &&
            (a.id === doc.id || a.name === doc.name),
        );

        if (!existingActor) {
          const actorData = doc.toObject();
          actorData.folder = targetWorldFolderId; // Assign fallback folder ID
          actorsToCreate.push(actorData);
        }
      }

      const children = pack.folders.filter(
        (f) => f.folder?.id === compFolder.id,
      );
      for (const child of children) {
        await extractContent(child);
      }
    };

    await extractContent(rootCompFolder);

    if (actorsToCreate.length === 0) {
      console.log("TCR | No new folders or actors to unpack.");
      return;
    }

    if (actorsToCreate.length > 0) {
      await Actor.createDocuments(actorsToCreate, { keepId: true });
      console.log(`TCR | Unpacked ${actorsToCreate.length} actor(s).`);
    }

    ui.notifications.info(
      `Successfully unpacked actors for ${game.user.name}.`,
    );
  }
}
