import { MODULE_ID, SETTINGS } from "../constants.mjs";
import TCRPackManager from "../pack-manager/pack-manager.mjs";

/**
 * Foundry VTT render hook handler for `renderActorDirectory`.
 * Color-codes child folders based on user ownership and document content.
 * @param {Application} app - The Actor Directory application instance.
 * @param {[HTMLElement]} root - Array containing the root HTMLElement for the directory.
 */
export default function onRenderActorDirectory(_app, [html]) {
  const targetId = TCRPackManager._unpackingFolder?.id;
  const parentEl = targetId
    ? html.querySelector(`.directory-item.folder[data-folder-id='${targetId}']`)
    : null;
  if (!parentEl) return;

  const targetDepth = Number(parentEl.dataset.folderDepth) + 1;
  const childFolders = parentEl.querySelectorAll(
    `.directory-item.folder[data-folder-depth='${targetDepth}']`,
  );

  for (const el of childFolders) {
    const folder = game.actors.folders.get(el.dataset.folderId);
    if (!folder) continue;

    const overrideColors = game.settings.get(MODULE_ID, SETTINGS.FOLDER_COLORS);
    if (!overrideColors && folder.color) continue;

    const color = game.users.getName(folder.name)?.active
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
