import InteractiveMixin from "./interactive-mixin.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import TabData from "../data/tab-data.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * @import {ApplicationTabsConfiguration} from "./_types.mjs"
 */

/**
 * @import {ApplicationClickAction, ApplicationConfiguration, ApplicationRenderContext, ApplicationRenderOptions} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 */

export default class MainHud extends InteractiveMixin(ApplicationV2) {
  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-main-hud`,
    classes: [MODULE_ID, "main-hud"],
    window: {
      minimizable: false,
    },
    position: {
      width: 800,
      height: 600,
    },
    actions: {
      clickSegment: {
        handler: MainHud.#onClickSegment,
        buttons: [0, 2],
      },
      toggleGrid: MainHud.#onToggleGrid,
      openSetting: MainHud.#onOpenSetting,
    },
  };

  /**
   * Define tabs that should always exist regardless of settings.
   * @returns {Record<string, ApplicationTabsConfiguration}
   */
  static TABS = {
    primary: {
      tabs: [
        {
          id: "bugTracker",
          icon: "fa-solid fa-bug",
          label: "Bug Tracker",
          background: { color: "#121416", src: undefined },
        },
      ],
    },
  };

  /** @override */
  static PARTS = {
    tabs: {
      template: `modules/${MODULE_ID}/templates/main-hud/tab-navigation.hbs`,
    },
    body: {
      template: `modules/${MODULE_ID}/templates/main-hud/body.hbs`,
      templates: [`modules/${MODULE_ID}/templates/main-hud/bug-tracker.hbs`],
    },
  };

  get setting() {
    return game.settings.get(MODULE_ID, SETTINGS.TAB_CONFIGURATION);
  }

  /**
   * @type {Boolean}
   */
  _showGrid = false;

  /**
   * Initialize configuration options for the Application instance.
   * @param {Partial<ApplicationConfiguration>} options - Options provided directly to the constructor
   * @returns {ApplicationConfiguration} Configured options for the application instance
   */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    const { clientWidth, clientHeight } = document.documentElement;
    const isMobile = clientWidth <= 768;

    if (isMobile) {
      const baseWidth = options.position.width;
      const baseHeight = options.position.height;

      const widthScale = (clientWidth * 0.9) / baseWidth;
      const heightScale = (clientHeight * 0.8) / baseHeight;

      options.position.scale = Math.min(1.0, widthScale, heightScale);
    }

    return options;
  }

  /**
   * Prepare application rendering context data for a given render request.
   * @param {ApplicationRenderOptions} options - Options which configure application rendering behavior
   * @returns {Promise<ApplicationRenderContext>} - Context data for the render operation
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const enrichedTabs = await Promise.all(
      Object.values(this.setting).map(async (tabData) => {
        const tab = new TabData(tabData);
        const segments = await Promise.all(
          tab.segments.map(async (segment) => {
            return {
              model: segment,
              style: segment.styleAttr,
              enrichedHTML: await segment.getEnrichedContent(),
            };
          })
        );
        return {
          model: tab,
          id: tab.id,
          style: tab.styleAttr,
          segments: segments,
        };
      })
    );

    return {
      ...context,
      setting: enrichedTabs,
      showGrid: this._showGrid,
      showFixedButtons: game.user.isGM && Object.keys(this.setting).includes(this.tabGroups.primary),
    };
  }

  /**@inheritdoc */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const tabsConfig = this._getTabsConfig("primary");
    const tabData = tabsConfig.tabs.find(
      (t) => t.id === this.tabGroups.primary
    );
    const { color, src } = tabData.background ?? {};

    const content = src ? VideoHelper.hasVideoExtension(src)
      ? `<video src="${src}" autoplay loop muted playsinline class="bg-video visible"></video>`
      : `<img src="${src}" class="bg-image visible" alt="" >` : "";

    frame
      .querySelector(".window-content")
      ?.insertAdjacentHTML(
        "beforeBegin",
        `<div class="hud-background-layer" style="--bg-color: ${color}">${content}</div>`
      );

    return frame;
  }

  /**@inheritdoc */
  changeTab(tab, group, options = {}) {
    if (group === "primary") this._updateBackground(tab);
    super.changeTab(tab, group, options);
    this.render();
  }

  /**
   * Get the configuration for a tabs group.
   * @param {string} group The ID of a tabs group
   * @returns {ApplicationTabsConfiguration|null}
   * @protected
   */
  _getTabsConfig(group) {
    return group === "primary"
      ? this._getPrimaryTabs()
      : this.constructor.TABS[group] ?? null;
  }

  /**
   *
   * @returns {ApplicationTabsConfiguration}
   */
  _getPrimaryTabs() {
    const setting = this.setting;

    const tabs = [
      ...Object.values(setting),
      ...this.constructor.TABS.primary.tabs,
    ];

    return {
      tabs,
      initial: tabs[0].id,
    };
  }

  /**
   * Updates the application background based on a specific tab's data
   * @param {string} tabId
   */
  _updateBackground(tabId) {
    const tabsConfig = this._getTabsConfig("primary");
    const tabData = tabsConfig.tabs.find((t) => t.id === tabId);

    const container = this.element.querySelector(".hud-background-layer");
    const oldElement = container.querySelector(".bg-video, .bg-image");

    const { src, color } = tabData?.background ?? {};
    if (src) {
      const isVideo = VideoHelper.hasVideoExtension(src);
      const htmlString = isVideo
        ? `<video src="${src}" autoplay loop muted playsinline class="bg-video"></video>`
        : `<img src="${src}" class="bg-image" alt="">`;

      const newElement = foundry.applications.parseHTML(htmlString);
      container.appendChild(newElement);

      requestAnimationFrame(() => newElement.classList.add("visible"));
    }

    if (oldElement) {
      oldElement.classList.remove("visible");

      setTimeout(() => {
        oldElement.remove();
      }, 500);
    }

    container.setAttribute("style", `--bg-color: ${color}`);
  }

  /**
   * @type {ApplicationClickAction}
   * @this {MainHud}
   */
  static #onClickSegment(event, target) {
    event.preventDefault();

    const { tabId, segmentId } = target.dataset;
    const tabData = this.setting[tabId];
    if (!tabData) return;
    const tab = new TabData(tabData);
    const segment = tab.segments.find((s) => s.id === segmentId);

    segment.onClickAction(event);
  }

  /**
   * @type {ApplicationClickAction}
   * @this {MainHud}
   */
  static #onToggleGrid(_event, target) {
    /**@type {HTMLElement} */
    const gridContainer = this.element.querySelector(".grid-container");
    const haveClass = gridContainer.classList.toggle("show-grid");
    this._showGrid = haveClass;
    target.classList.toggle("active", haveClass);
  }

  /**
   * @type {ApplicationClickAction}
   * @this {MainHud}
   */
  static async #onOpenSetting(_event) {
    const menu = game.settings.menus.get(
      `${MODULE_ID}.${SETTINGS.TAB_CONFIGURATION}`
    );

    if (!menu)
      return void ui.notifications.error(
        "No submenu found for the provided key"
      );
    const app = new menu.type();
    await app.render(true);
  }
}
