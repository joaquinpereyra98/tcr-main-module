import {
  AVAILABILITY_VIEWER_KEY,
  MODULE_ID,
  USER_FLAGS,
} from "../constants.mjs";

/**
 * @import { DatabaseUpdateOperation } from "../../foundry/resources/app/common/abstract/_types.mjs"
 */

/**
 * A hook event that fires for every User after conclusion of an update workflow.
 * @param {User} _user - The user instance being updated
 * @param {object} changed - Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} _options Additional options which modify the update request
 * @param {string} _userId - The ID of the requesting user, always game.user.id
 * @returns {boolean|void}
 */
export default function onUpdateUser(_user, changed, _options, _userId) {
  const moduleFlag = foundry.utils.getProperty(changed, `flags.${MODULE_ID}`) ?? {};
  const flags = Object.keys(moduleFlag);

  if (flags.some((k) => Object.values(USER_FLAGS).includes(k))) {
    ui[AVAILABILITY_VIEWER_KEY].render();
  }
}
