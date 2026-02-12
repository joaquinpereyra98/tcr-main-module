import * as apps from "./module/apps/_module.mjs";
import * as settings from "./module/settings/_module.mjs";
import * as data from "./module/data/_module.mjs";

import { moduleToObject } from "./module/utils.mjs";
import {
  MAIN_HUD_KEY,
} from "./module/constants.mjs";

Hooks.on("init", () => {
  const module = game.modules.get("tcr-main-module");

  module.api = {
    apps: moduleToObject(apps),
    settings: moduleToObject(settings),
    data: moduleToObject(data),
  };

  CONFIG.ui[MAIN_HUD_KEY] = module.api.apps.MainHud;

  settings.HUDConfig.registerSetting();

});
