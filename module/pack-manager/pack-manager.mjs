import LoginTracker from "../settings/login-tracker.mjs";
import { hasDocumentsInFolder } from "../utils.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import WorldFolderField from "../data/fields/world-folder-field.mjs";

const MS_PER_DAY = 86_400_000;

export default class TCRPackManager {
  /**@returns {Folder|undefined} */
  static get #unpackingFolder() {
    const folderID = game.settings.get(MODULE_ID, SETTINGS.UNPACKING_FOLDER);
    return game.actors.folders.get(folderID);
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

  /* -------------------------------------------- */
  /*  Main Methods                                */
  /* -------------------------------------------- */

  /**
   * Register setting and menu.
   */
  static registerSetting() {
    game.settings.register(MODULE_ID, SETTINGS.UNPACKING_FOLDER, {
      name: "Unpacking Destination Folder",
      hint: "Select the world folder where player actors will be unpacked from the compendium.",
      config: true,
      scope: "world",
      default: "",
      type: new WorldFolderField({
        required: false,
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
    console.log("TCR | Initializing GM Auto-Packing check...");

    /**@type {Folder} */
    const playersFolder = this.#unpackingFolder;
    if (!playersFolder) return;

    try {
      const perUserFolders = playersFolder.getSubfolders();

      const nonEmptyFolders = [];

      for (const userFolder of perUserFolders) {
        if (hasDocumentsInFolder(userFolder)) {
          nonEmptyFolders.push(userFolder);
        }
      }

      const nonEmptyFolderNames = new Set(nonEmptyFolders.map((f) => f.name));
      const INACTIVE_THRESHOLD = LoginTracker.INACTIVE_THRESHOLD_SETTING;

      const inactiveUsersWithFolder = game.users.filter((u) => {
        if (u.isGM || !nonEmptyFolderNames.has(u.name)) return false;

        const { lastLogin } = LoginTracker.getLoginData(u);
        const daysSince = (Date.now() - lastLogin) / MS_PER_DAY;
        return daysSince > INACTIVE_THRESHOLD;
      });

      if (!inactiveUsersWithFolder.length)
        return void console.log("TCR | No inactive player folders to pack.");

      // 6. Execute Packing Process
      const pack = await this.#getCompendium({ unlock: true });
      if (!pack) {
        console.warn(
          "TCR | Could not open compendium. Aborting packing process.",
        );
        return;
      }
      const inactiveUserNames = new Set(
        inactiveUsersWithFolder.map((u) => u.name),
      );
      const foldersToExport = nonEmptyFolders.filter((f) =>
        inactiveUserNames.has(f.name),
      );

      const actorsToDelete = [];

      for (const folder of foldersToExport) {
        console.log(`TCR | Exporting folder "${folder.name}" to compendium...`);

        const targetCompendiumFolder = await this.#getOrCreateCompendiumFolder(
          pack,
          folder.name,
        );

        await folder.exportToCompendium(pack, {
          folder: targetCompendiumFolder.id,
          keepFolders: true,
          keepId: true,
          updateByName: true,
        });

        const getDocIds = (f) => [
          ...(f.contents?.map((c) => c.id) || []),
          ...(f.children || []).flatMap(getDocIds),
        ];

        actorsToDelete.push(...getDocIds(folder));
      }

      await Actor.deleteDocuments(actorsToDelete);
    } catch (error) {
      console.error("TCR | Auto-Packing encountered an error:", error);
    }
  }

  /**
   * Unpacks Actorsfrom a user-specific compendium folder into the world's.
   * @returns {Promise<void>}
   */
  static async unpackingProcess() {
    if (game.user.isGM) return;
    console.log("TCR | Initializing PLayer Auto-UnPacking check...");

    const playersFolders = this.#unpackingFolder;

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
      const targetWorldFolderId = resolveFolderId(compFolder);
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
