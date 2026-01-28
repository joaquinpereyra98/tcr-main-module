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

/**
 * Retrieves the donation membership levels formatted for schema fields.
 * * @returns {{k: string, label: string}[] | null}
 */
export function getRanks() {
  if (!game.modules.get("donation-tracker").active) return null;
  const setting = game.settings.get("donation-tracker", "membershipLevels");
  return (
    setting?.levels?.map(({ id, name }) => ({ k: id, label: name })) ?? null
  );
}
/**
 * Retrieves the names of folders associated with the user's current donation rank.
 * @returns {string[]|null} An array of folder name strings.
 */
export function getRankFolderNames() {
  if (!game.modules.get("donation-tracker").active) return null;

  const { levels } =
    game.settings.get("donation-tracker", "membershipLevels") ?? {};

  const membershipLevel =
    game.membership?.membershipLevel === -1
      ? 0
      : game.membership.membershipLevel;

  const userRank = game.user.isGM ? levels.length : membershipLevel;

  if (userRank === undefined || userRank === null) return null;

  return Object.entries(game.membership.RANKS)
    .filter(([_, value]) => value !== -1 && userRank >= value)
    .map(([key]) =>
      game.settings.get(
        "foundryvtt-actor-studio",
        `donation-tracker-rank-${key}`,
      ),
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
    (f) => f.folder?.id === folder.id,
  );

  return subfolders.concat(subfolders.flatMap((f) => f.getSubfolders(true)));
}

/**
 * Converts identifiers with dashes/underscores into capitalized labels with spaces.
 * @param {string} identifier
 * @returns {string}
 */
export function formatIdentifier(identifier) {
  if (!identifier) return "";
  return identifier.replace(/[-_]/g, " ").titleCase();
}
