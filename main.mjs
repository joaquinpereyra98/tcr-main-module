import * as apps from "./module/apps/_module.mjs";
import * as settings from "./module/settings/_module.mjs";
import * as data from "./module/data/_module.mjs";

import JiraIssueManager from "./module/jira/jira-manager.mjs";

import { moduleToObject } from "./module/utils.mjs";
import { MAIN_HUD_KEY, MODULE_ID } from "./module/constants.mjs";

Hooks.on("init", () => {
  const module = game.modules.get("tcr-main-module");

  module.api = {
    apps: moduleToObject(apps),
    settings: moduleToObject(settings),
    data: moduleToObject(data),
  };

  CONFIG.ui[MAIN_HUD_KEY] = module.api.apps.MainHud;

  settings.HUDConfig.registerSetting();
  settings.SourcesConfig.registerSetting();
  settings.registerMetricsSetting()

  JiraIssueManager.instance
    .initialize()
    .then(() => console.log(`${MODULE_ID} | Jira Issues Loaded!`));
});
