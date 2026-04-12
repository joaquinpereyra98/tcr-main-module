import { MODULE_ID, USER_FLAGS } from "../constants.mjs";

/**
 * A hook event that fires for every User before execution of an update workflow.
 * @param {import("../../foundry/resources/app/dist/database/database.mjs").User} user - The user instance being updated
 * @param {object} changed - Differential data that will be used to update the document
 * @param {Partial<import("../../foundry/resources/app/common/abstract/_types.mjs").DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId - The ID of the requesting user, always game.user.id
 * @returns {boolean|void}
 */
export default function preUpdateUser(_user, changed, _options, _userId) {
  const hasAvail = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${USER_FLAGS.AVAILABILITY}`);
  if(hasAvail) {
    foundry.utils.setProperty(changed, `flags.${MODULE_ID}.${USER_FLAGS.LAST_AVAIL_UPDATE}`, Date.now());
  }
}
