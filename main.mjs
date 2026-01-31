import * as apps from "./module/apps/_module.mjs";
import * as settings from "./module/settings/_module.mjs";
import * as data from "./module/data/_module.mjs";
import * as hooks from "./module/hooks/_module.mjs";

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

  window.customElements.define(
    apps.elements.HTMLDocumentTagsElementV2.tagName,
    apps.elements.HTMLDocumentTagsElementV2,
  );

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
          choices: Array.from({ length: 10 }, (_, i) => ({
            label: game.i18n.localize(`DND5E.SpellLevel${i}`),
          })),
        },
        createFilter: (filters, value, def, key, operators) => {
          const choices = foundry.utils.deepClone(def.config.choices);
          if (def.config.blank) choices._blank = "";
          const opCfg = operators[key] ?? { pos: "AND", neg: "OR" };

          const [positive, negative] = Object.entries(value ?? {}).reduce(
            ([positive, negative], [k, v]) => {
              if (k in choices) {
                if (k === "_blank") k = "";
                if (v === 1) positive.push(k);
                else if (v === -1) negative.push(k);
              }
              return [positive, negative];
            },
            [[], []],
          );

          if (positive.length) {
            const posOp = opCfg.pos === "OR" ? "hasany" : "hasall";

            filters.push({
              k: def.config.keyPath,
              o: def.config.multiple ? posOp : "in",
              v: positive.map((s) => parseInt(s)),
            });
          }
          if (negative.length) {
            const negOp = opCfg.pos === "OR" ? "hasany" : "hasall";
            filters.push({
              o: "NOT",
              v: {
                k: def.config.keyPath,
                o: def.config.multiple ? negOp : "in",
                v: negative.map((s) => parseInt(s)),
              },
            });
          }
        },
      });

      return map;
    },
    configurable: true,
  });

  document.addEventListener("paste", (event) => {
    const app = ui.activeWindow;
    if (app instanceof apps.IssueSheet) apps.IssueSheet.onPasteFile?.call(app, event);
  });
});

Hooks.on("ready", () => {
  settings.LoginTracker.initialize();
});

Hooks.on("renderItemSheet", hooks.onRenderItemSheet);
