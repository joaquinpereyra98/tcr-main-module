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

Hooks.once("setup", () => {
  const SpellModel = CONFIG.Item.dataModels.spell;
  const descriptor = Object.getOwnPropertyDescriptor(
    SpellModel,
    "compendiumBrowserFilters",
  );
  Object.defineProperty(SpellModel, "compendiumBrowserFilters", {
    get: function () {
      const map = descriptor.get.call(this);
      map.set("level", {
        label: "DND5E.Level",
        type: "set",
        config: {
          keyPath: "system.level",
          choices: Object.fromEntries(
            Array.from({ length: 10 }, (_, i) => [
              i,
              { label: game.i18n.localize(`DND5E.SpellLevel${i}`) },
            ]),
          ),
        },
      });

      return map;
    },
    configurable: true,
  });
});

Hooks.on("ready", () => {
  settings.LoginTracker.initialize();
});
