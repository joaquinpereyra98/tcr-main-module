import * as apps from "./module/apps/_module.mjs";
import * as settings from "./module/settings/_module.mjs";
import * as data from "./module/data/_module.mjs";

import JiraIssueManager from "./module/jira/jira-manager.mjs";

import { moduleToObject } from "./module/utils.mjs";
import {
  LOGIN_TRACKER_KEY,
  MAIN_HUD_KEY,
  MODULE_ID,
} from "./module/constants.mjs";

Hooks.on("init", () => {
  const module = game.modules.get("tcr-main-module");

  module.api = {
    apps: moduleToObject(apps),
    settings: moduleToObject(settings),
    data: moduleToObject(data),
  };

  globalThis.tcrMain = {
    renderCompendiumBrowser: apps.CompendiumBrowser.renderCompendiumBrowser,
  };

  CONFIG.ui[MAIN_HUD_KEY] = module.api.apps.MainHud;
  CONFIG.ui[LOGIN_TRACKER_KEY] = module.api.settings.LoginTracker;

  settings.HUDConfig.registerSetting();
  settings.SourcesConfig.registerSetting();
  settings.LoginTracker.registerSetting();
  settings.registerMetricsSetting();

  JiraIssueManager.instance
    .initialize()
    .then(() => console.log(`${MODULE_ID} | Jira Issues Loaded!`));
});

Hooks.on("ready", () => {
  settings.LoginTracker.initialize();
});
