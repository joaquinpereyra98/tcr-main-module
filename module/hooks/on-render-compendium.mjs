import { MODULE_ID, SETTINGS } from "../constants.mjs";
import TCRPackManager from "../pack-manager/pack-manager.mjs";

/**
 * Foundry VTT render hook handler for `renderCompendium`.
 * Color-codes child folders based on user ownership and document content.
 * @param {Application} app - The Collection application instance.
 * @param {[HTMLElement]} root - Array containing the root HTMLElement for the directory.
 */
export default function onRenderCompendium(app, [html]) {
  const packKey = game.settings.get(MODULE_ID, SETTINGS.PACKING_COMPENDIUM);

  if (app.collection.metadata.id !== packKey) return;

  const childFolders = html.querySelectorAll(
    ".directory-item.folder[data-folder-depth='1']",
  );
  for (const el of childFolders) {
    const folder = app.collection.folders.get(el.dataset.folderId);

    if (!folder) continue;

    const overrideColors = game.settings.get(MODULE_ID, SETTINGS.FOLDER_COLORS);
    if (!overrideColors && folder.color) continue;

    const user = game.users.getName(folder.name);

    const color = !user
      ? TCRPackManager.COLORS.noUser
      : !user.active
        ? TCRPackManager.COLORS.online
        : TCRPackManager.COLORS.offline;

    el.querySelector("header.folder-header")?.style.setProperty(
      "background-color",
      color,
    );
    el.querySelector("ol.subdirectory")?.style.setProperty(
      "border-left-color",
      color,
    );
  }
}
