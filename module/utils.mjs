/**
 * @import BaseFolder from "../foundry/resources/app/common/documents/folder.mjs";
 */

/**
 *
 * @param {Module} module
 * @returns
 */
export function moduleToObject(module) {
  return { ...module };
}

/**
 *
 * @param {String} str
 * @returns {String}
 */
export function toCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase())
    .trim();
}

export function getRankFolderNames() {
  const userRank = game.membership?.membershipLevel;

  if(!userRank) return null;

  return Object.entries(game.membership.RANKS)
    .filter(([_, v]) => v !== -1 && userRank >= v)
    .map(([k]) =>
      game.settings.get("foundryvtt-actor-studio", `donation-tracker-rank-${k}`)
    );
}

/**
 * Checks if a folder or any of its subfolders contain at least one document.
 * @param {BaseFolder} folder - The folder itself.
 * @returns {boolean} True if at least one document exists.
 */
export function hasDocumentsInFolder(folder) {
  if (!folder) return false;

  // 1. Check if this folder has content
  if (folder.contents.length > 0) return true;

  // 2. Check if any subfolder has content (recursive early exit)
  return folder.children.some((child) => hasDocumentsInFolder(child.folder));
}

/**
 *
 * @param {BaseFolder} folder - The folder itself.
 * @returns {BaseFolder[]}
 */
export function getSubfoldersInCompenidum(folder) {
  const subfolders = folder.compendium.folders.filter(
    (f) => f.folder?.id === folder.id
  );

  return subfolders.concat(subfolders.flatMap((f) => getSubfolders(f)));
}
