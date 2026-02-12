import InteractiveMixin from "./interactive-mixin.mjs";
import {
  MODULE_ID,
  SETTINGS,
} from "../constants.mjs";
import TabData from "../data/tab-data.mjs";

const { ApplicationV2 } = foundry.applications.api;

/**
 * @import {ApplicationTabsConfiguration} from "./_types.mjs";
 * @import {ApplicationClickAction, ApplicationConfiguration, ApplicationRenderContext, ApplicationRenderOptions} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import {HandlebarsRenderOptions, HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 */

export default class MainHud extends InteractiveMixin(ApplicationV2) {
  /* -------------------------------------------- */
  /*  Static Properties                           */
  /* -------------------------------------------- */

  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-main-hud`,
    classes: [MODULE_ID, "main-hud"],
    window: {
      minimizable: true,
      resizable: true,
      title: "Main HUD",
    },
    position: {
      width: 800,
      height: 700,
    },
    actions: {
      toggleGrid: MainHud.#onToggleGrid,
      openSetting: MainHud.#onOpenSetting,
    },
  };

  /**@type {Record<String, TabData>} */
  static get SETTING() {
    return game.settings.get(MODULE_ID, SETTINGS.TAB_CONFIGURATION);
  }

  /**
   * Static Tabs.
   * @returns {Record<string, ApplicationTabsConfiguration}
   */
  static _TABS = {};

  /**@override */
  static get TABS() {
    const tabsSetting = Object.values(MainHud.SETTING).filter((tab) => {
      const rankIdx = (game.membership?.membershipLevel ?? -1) + 1;
      return game.user.isGM || Object.values(tab.visibility)[rankIdx];
    });

    /**@type {ApplicationTabsConfiguration} */
    const primary = {
      tabs: [...tabsSetting],
      initial: tabsSetting[0]?.id ?? "bugTracker",
    };
    return {
      primary,
      ...MainHud._TABS,
    };
  }

  /** @override */
  static get PARTS() {
    const tabsSetting = Object.values(MainHud.SETTING).filter((tab) => {
      const rankIdx = (game.membership?.membershipLevel ?? -1) + 1;
      return game.user.isGM || Object.values(tab.visibility)[rankIdx];
    });

    return tabsSetting.reduce((acc, tab) => {
      acc[tab.id] = {
        template: `modules/${MODULE_ID}/templates/main-hud/tab-partial.hbs`,
        classes: [tab.id],
      };

      return acc;
    }, foundry.utils.duplicate(MainHud.BASE_PARTS));
  }

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static BASE_PARTS = {
    tabs: {
      template: `modules/${MODULE_ID}/templates/main-hud/tab-navigation.hbs`,
    },
  };
  
  /**
   * The number of milliseconds to delay between user keypresses before executing a search.
   * @type {number}
   */
  static SEARCH_DELAY = 200;

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /** @type {Boolean} */
  _showGrid = false;

  /**@type {HTMLElement} */
  #background;

  get setting() {
    return MainHud.SETTING;
  }

  /* -------------------------------------------- */
  /*  Initialization                              */
  /* -------------------------------------------- */

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
      const widthScale = (clientWidth * 0.9) / options.position.width;
      const heightScale = (clientHeight * 0.8) / options.position.height;
      options.position.scale = Math.min(1.0, widthScale, heightScale);
    }

    return options;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**@inheritdoc */
  _configureRenderOptions(options) {
    const tabId = this.tabGroups.primary ?? MainHud.TABS.primary.initial;
    options.background = MainHud.TABS.primary.tabs.find(
      (t) => t.id === tabId,
    ).background;
    super._configureRenderOptions(options);
  }

  /** @inheritdoc */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);

    this.#background = document.createElement("div");
    this.#background.classList.add("background-container");
    frame.insertAdjacentElement("afterbegin", this.#background);

    const { src, color } = options.background;
    this.#applyBackgroundTransition(src, color);

    return frame;
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const tabs = this.element.querySelectorAll('.tab[data-group="primary"]');
    let tabContainer = this.element.querySelector(".tab-container");
    if (!tabContainer) {
      tabContainer = document.createElement("div");
      tabContainer.classList.add("tab-container");
    }
    tabContainer.classList.toggle("show-grid", this._showGrid);

    tabContainer.append(...tabs);

    this.element.querySelector(".window-content").append(tabContainer);

    this.element
      .querySelectorAll('[data-action="clickSegment"]')
      .forEach((el) =>
        el.addEventListener("mousedown", (ev) =>
          MainHud.#onClickSegment.call(this, ev, el),
        ),
      );
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /**
   * Prepare application rendering context data for a given render request.
   * @param {ApplicationRenderOptions} options - Options which configure application rendering behavior
   * @returns {Promise<ApplicationRenderContext>} - Context data for the render operation
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    return {
      ...context,
      showGrid: this._showGrid,
      user: game.user,
    };
  }

  /**
   * Prepare context that is specific to only a single rendered part.
   *
   * @param {string} partId - The part being rendered
   * @param {ApplicationRenderContext} context - Shared context provided by _prepareContext
   * @param {HandlebarsRenderOptions} options - Options which configure application rendering behavior
   * @returns {Promise<ApplicationRenderContext>} - Context data for a specific part
   * @protected
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (this.setting[partId]) {
      await this._prepareDynamicTabContext(
        this.setting[partId],
        context,
        options,
      );
    }
    return context;
  }

  /**
   * Prepare render context for the dynamics tabs.
   * @param {TabData} tabData
   * @param {ApplicationRenderContext} context
   * @param {HandlebarsRenderOptions} options
   * @returns {Promise<void>}
   */
  async _prepareDynamicTabContext(tabData, context, _options) {
    const { active, cssClass, group } = context.tabs[tabData.id];
    const tab = new TabData(tabData);

    const segments = await Promise.all(
      tab.segments.map(async (model) => ({
        model,
        style: model.styleAttr,
        enrichedHTML: await model.getEnrichedContent(),
      })),
    );

    const cells = [];
    const isActiveTab = this.tabGroups.primary === tabData.id;

    if (this._showGrid && isActiveTab) {
      for (let r = 1; r <= tab.rows; r++) {
        for (let c = 1; c <= tab.columns; c++) {
          cells.push({
            columnStart: c,
            rowStart: r,
          });
        }
      }
    }

    context.tab = {
      active,
      cssClass,
      group,
      segments,
      model: tab,
      id: tab.id,
      style: tab.styleAttr,
      cells,
    };
  }

  /* -------------------------------------------- */
  /*  Other Public Methods                        */
  /* -------------------------------------------- */

  /**@inheritdoc */
  changeTab(tab, group, options = {}) {
    if (group === "primary") {
      const tabsConfig = this._getTabsConfig("primary");
      const tabData = tabsConfig.tabs.find((t) => t.id === tab);
      const { src, color } = tabData?.background ?? {};
      this.#applyBackgroundTransition(src, color);

      if (this._showGrid) {
        this.render({ parts: [tab] });
      }
    }
    super.changeTab(tab, group, options);
  }

  /* -------------------------------------------- */
  /*  Helper Methods                              */
  /* -------------------------------------------- */

  /**
   * Handles the cross-fade transition for any background type (Video, Image, or Color)
   */
  #applyBackgroundTransition(src, color) {
    if (!this.#background) return;

    const oldLayers = Array.from(this.#background.children);
    const isVideo = VideoHelper.hasVideoExtension(src);
    const newLayer = document.createElement(isVideo ? "video" : "div");

    newLayer.classList.add("bg-layer");
    newLayer.style.opacity = "0";
    newLayer.style.transition = "opacity 800ms ease-in-out";
    newLayer.style.position = "absolute";
    newLayer.style.inset = "0";

    if (isVideo) {
      newLayer.src = src;
      newLayer.autoplay = true;
      newLayer.muted = true;
      newLayer.loop = true;
      newLayer.playsInline = true;
    }

    newLayer.style.background = isVideo
      ? "none"
      : src
        ? `url("${src}") center/cover no-repeat`
        : color;

    this.#background.appendChild(newLayer);

    requestAnimationFrame(() => {
      newLayer.style.opacity = "1";

      oldLayers.forEach((layer) => {
        layer.style.transition = "opacity 800ms ease-in-out";
        layer.style.opacity = "0";
      });
    });

    setTimeout(() => {
      oldLayers.forEach((el) => el.remove());
    }, 850);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  #buffer = {
    clickTimer: null,
    lastBtn: null,
    lastTime: 0,
  };

  /**
   * Handle clicking a tab segment to trigger its specific action
   * @param {MouseEvent} event
   * @param {HTMLElement} target
   * @this MainHud
   */
  static #onClickSegment(event, target) {
    const { tabId, segmentId } = target.dataset;
    const tabData = this.setting[tabId];
    if (!tabData) return;

    const tab = new TabData(tabData);
    const segment = tab.segments.find((s) => s.id === segmentId);
    if (!segment) return;

    const now = Date.now();
    const timeSinceLast = now - this.#buffer.lastTime;
    const COMBO_WINDOW = 300;

    const isBothHeld = event.buttons === 3;
    const isSequentialCombo =
      timeSinceLast < COMBO_WINDOW && this.#buffer.lastBtn !== event.button;

    if (isBothHeld || isSequentialCombo) {
      clearTimeout(this.#buffer.clickTimer);
      this.#buffer.clickTimer = null;
      this.#buffer.lastTime = 0;
      if (game.user.isGM) return segment.app?.render({ force: true });
    }
    this.#buffer.lastBtn = event.button;
    this.#buffer.lastTime = now;

    clearTimeout(this.#buffer.clickTimer);
    this.#buffer.clickTimer = setTimeout(() => {
      segment.onClickAction(event);
      this.#buffer.clickTimer = null;
    }, 150);
  }

  /**
   * Toggle the visibility of the layout grid in the application
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static async #onToggleGrid(_event, target) {
    this._showGrid = !this._showGrid;

    target.classList.toggle("active", this._showGrid);

    const tabContainer = this.element.querySelector(".tab-container");
    tabContainer?.classList.toggle("show-grid", this._showGrid);
    await new Promise((r) => setTimeout(r, 300));

    const activeTabId = this.tabGroups.primary;

    if (activeTabId) {
      this.render({ parts: [activeTabId] });
    }
  }

  /**
   * Open the module configuration menu for tab settings
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static async #onOpenSetting() {
    const menu = game.settings.menus.get(
      `${MODULE_ID}.${SETTINGS.TAB_CONFIGURATION}`,
    );

    /**@type {ApplicationV2} */
    const Cls = menu.type;

    const app =
      foundry.applications.instances.get(`${MODULE_ID}-hud-config`) ??
      new Cls();

    if (app.rendered) app.bringToFront();
    return app.render({ force: true });
  }


}
