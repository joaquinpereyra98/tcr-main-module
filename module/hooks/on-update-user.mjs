import {
  AVAILABILITY_VIEWER_KEY,
  MODULE_ID,
  USER_FLAGS,
} from "../constants.mjs";

/**
 * A hook event that fires for every User after conclusion of an update workflow.
 * @param {import("../../foundry/resources/app/dist/database/database.mjs").User} user - The user instance being updated
 * @param {object} changed - Differential data that will be used to update the document
 * @param {Partial<import("../../foundry/resources/app/common/abstract/_types.mjs").DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId - The ID of the requesting user, always game.user.id
 * @returns {boolean|void}
 */
export default function onUpdateUser(_user, changed, _options, _userId) {
  const moduleFlag = foundry.utils.getProperty(changed, `flags.${MODULE_ID}`);
  const flags = Object.keys(moduleFlag);

  if (flags.some((k) => Object.values(USER_FLAGS).includes(k))) {
    ui[AVAILABILITY_VIEWER_KEY].render();
  }
}
