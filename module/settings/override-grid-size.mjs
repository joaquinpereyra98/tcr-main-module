import { MODULE_ID, SETTINGS } from "../constants.mjs";

export default function registerGridSizeSetting() {
  game.settings.register(MODULE_ID, SETTINGS.OVERRIDE_GRID_SIZE, {
    config: true,
    type: Boolean,
    scope: "user",
    default: false,
    name: "Override Browser Grid Size",
    hint: "If enabled, forces the local browser to use your saved config the grid size instead of the defaults.",
  });
}
