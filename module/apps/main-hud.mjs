import InteractiveMixin from "./interactive-mixin.mjs";
import {
  ISSUE_STATUSES,
  ISSUE_TYPES,
  MODULE_ID,
  PRIORITY,
  SETTINGS,
} from "../constants.mjs";
import TabData from "../data/tab-data.mjs";
import JiraIssueManager from "../jira/jira-manager.mjs";
import IssueData from "../data/issue-data.mjs";
import Fuse from "../lib/fuse.mjs";

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
      addScoreIssue: MainHud.#onAddScoreIssue,
      toggleGrid: MainHud.#onToggleGrid,
      openSetting: MainHud.#onOpenSetting,
      createIssue: MainHud.#onCreateIssue,
      deleteIssue: MainHud.#onDeleteIssue,
      editIssue: MainHud.#onEditIssue,
      toggleSelfFilter: MainHud.#onToggleSelfFilter,
      loginKofi: MainHud.#onLoginKofi,
      sortIssues: MainHud.#onSortIssues,
      openFilterMenu: MainHud.#onOpenFilterMenu,
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
      tabs: [
        ...tabsSetting,
        {
          id: "bugTracker",
          icon: "fa-solid fa-bug",
          label: "Bug Tracker",
          background: { color: "#121416", src: undefined },
        },
      ],
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
    bugTracker: {
      template: `modules/${MODULE_ID}/templates/main-hud/bug-tracker.hbs`,
      scrollable: [".scrollable"],
    },
  };

  /**
   * Configuration for result batching and infinite scrolling.
   * @type {{MARGIN: number, SIZE: number}}
   */
  static BATCHING = {
    /** The number of pixels before reaching the end of the scroll container to begin loading additional entries.*/
    MARGIN: 50,

    /** The number of entries to load per batch.*/
    SIZE: 20,
  };

  /**@enum {Number} */
  static SORT_DIRECTIONS = {
    ASCENDING: 1,
    DESCENDING: -1,
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

  /**
   * The function to invoke when searching results by name.
   * @type {Function}
   */
  _debouncedSearch = foundry.utils.debounce(
    this._onSearchName.bind(this),
    this.constructor.SEARCH_DELAY,
  );

  /**
   * The current index of the next issue to be rendered in the batch.
   * @type {number}
   * @private
   */
  #issueIndex = 0;

  /**
   * Whether a batch rendering operation is currently in progress.
   * @type {boolean}
   * @private
   */
  #renderThrottle = false;

  /**
   * The full list of issues available for rendering, used for slicing batches.
   * @type {Array<object>}
   */
  #filteredIssues = [];

  #filters = {
    searchQuery: "",
    showOnlySelf: false,
    sort: {
      key: "updated",
      direction: MainHud.SORT_DIRECTIONS.DESCENDING,
    },
    activeFilters: {
      issueType: "",
      status: "",
    },
  };

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
      options.position.width = clientWidth * 0.95;
      options.position.height = clientHeight;
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

    const level = game.membership?.membershipLevel;

    // Simple map: only store the logged-in tiers
    const rankMap = {
      0: ["<i class='fa-solid fa-check'></i> Member", "#ffffff"],
      1: ["<i class='fa-solid fa-check'></i> Benefactor", "#4da6ff"],
      2: [
        "<i class='fa-solid fa-check'></i> Benefactor of Knowledge",
        "#ffac33",
      ],
    };

    const [label, spanColor] = rankMap[level] || [
      "<i class='fa-solid fa-xmark'></i> Not Logged In",
      "#ff4d4d",
    ];

    frame
      .querySelector('.header-control[data-action="close"]')
      ?.insertAdjacentHTML(
        "beforebegin",
        `
      <span class="login-status" style="color: ${spanColor} ;">${label}</span>
      <button type="button" class="header-control fa-solid fa-mug"
              data-tooltip="Kofi" aria-label="kofi" data-action="loginKofi"></button>
      `,
      );

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
    } else if (partId === "bugTracker")
      await this._prepareIssueTrackerContext(context, options);
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

  /**
   *
   * @param {ApplicationRenderContext} context
   * @param {HandlebarsRenderOptions} _options
   */
  async _prepareIssueTrackerContext(context, _options) {
    context.filters = this.#filters;
    context.filterIcon = {
      type: Object.fromEntries(
        Object.values(ISSUE_TYPES).map(({ key, iconClass }) => [
          key,
          `fa-solid ${iconClass}`,
        ]),
      ),
      statuses: Object.fromEntries(
        Object.values(ISSUE_STATUSES).map(({ key, iconClass }) => [
          key,
          `${iconClass}`,
        ]),
      ),
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

    // 3. Cleanup
    setTimeout(() => {
      oldLayers.forEach((el) => el.remove());
    }, 850); // Slightly longer than transition to be safe
  }

  /**
   * Renders a single issue entry using a Handlebars template.
   * @param {object} issue - The Jira issue data model to render.
   * @returns {Promise<HTMLElement>} - The rendered issue element.
   */
  async _renderIssue(issue) {
    const path = `modules/${MODULE_ID}/templates/main-hud/issue-item.hbs`;
    const html = await renderTemplate(path, {issue, currentUser: game.user});
    const temp = document.createElement("div");
    temp.innerHTML = html;
    return temp.firstElementChild;
  }

  /**
   * Renders a specific slice of issues based on the current index and batch size,
   * then appends them to the DOM.
   * @returns {Promise<void>}
   */
  async _renderIssueBatch() {
    const container = this.element.querySelector(".bug-tracker.tab .grid-body");
    const batchEnd = Math.min(
      this.#issueIndex + MainHud.BATCHING.SIZE,
      this.#filteredIssues.length,
    );

    const promises = [];
    for (let i = this.#issueIndex; i < batchEnd; i++) {
      promises.push(this._renderIssue(this.#filteredIssues[i]));
    }

    const elements = await Promise.all(promises);
    container.append(...elements);

    this.#issueIndex = batchEnd;
  }

  /**
   * Prepares the issue list by resetting the batch index and clearing the container,
   * then triggers the first batch render.
   * @returns {Promise<void>}
   */
  async _renderIssues() {
    let issues = Array.from(JiraIssueManager.issues.values());
    const { searchQuery, showOnlySelf, activeFilters } = this.#filters;
    if (searchQuery) {
      const fuse = new Fuse(issues, {
        keys: ["summary"],
        threshold: 0.4,
      });

      const results = fuse.search(this.#filters.searchQuery);
      issues = results.map((result) => result.item);
    }

    if (showOnlySelf) {
      issues = issues.filter((issue) => issue.user?.isSelf === true);
    }

    if (activeFilters.status) {
      issues = issues.filter((i) => i.status === activeFilters.status);
    }
    if (activeFilters.issueType) {
      issues = issues.filter((i) => i.issueType === activeFilters.issueType);
    }

    const { key, direction } = this.#filters.sort;

    this.#filteredIssues = issues.sort((a, b) => {
      let valA = a[key] ?? "";
      let valB = b[key] ?? "";

      if (key === "priority") {
        valA = PRIORITY[valA].sort ?? 0;
        valB = PRIORITY[valB].sort ?? 0;
      }

      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
      return 0;
    });

    this.#issueIndex = 0;

    const container = this.element.querySelector(".bug-tracker.tab .grid-body");
    if (!container) return;

    container.innerHTML = "";
    await this._renderIssueBatch();
  }

  _renderMetrics() {
    const { metrics } = JiraIssueManager.instance;
    const val = game.settings.get(MODULE_ID, SETTINGS.METRICS_TIME_VALUE);
    const unit = game.settings
      .get(MODULE_ID, SETTINGS.METRICS_TIME_UNIT)
      .capitalize();
    const timeLabel = `${val} ${unit}`;

    const cards =
      this.element?.querySelectorAll(".bug-tracker.tab .stat-card") ?? [];
    if (!cards.length) return;

    cards.forEach((card) => {
      const key = card.dataset.key;
      card.querySelector(".value span").innerText = metrics[key] ?? 0;

      if (key.endsWith("SpanTime")) {
        card.querySelector(".stat-time").innerText = timeLabel;
      }
    });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _attachFrameListeners() {
    super._attachFrameListeners();
    this.element.addEventListener("scroll", this._onScrollIssues.bind(this), {
      capture: true,
      passive: true,
    });

    this.element.addEventListener("keydown", this._debouncedSearch, {
      passive: true,
    });
  }

  /** @inheritDoc */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "bugTracker") {
      this._renderIssues();
      this._renderMetrics();
    }
  }

  /**
   * Handles the scroll event on the Bug Tracker container to trigger batch loading
   * when the user approaches the bottom of the list.
   * @param {Event} event - The scroll event.
   * @returns {Promise<void>}
   */
  async _onScrollIssues(event) {
    if (this.#renderThrottle || !event.target.closest(".bug-tracker.tab"))
      return;

    if (this.#issueIndex >= this.#filteredIssues.length) return;

    const { scrollTop, scrollHeight, clientHeight } = event.target;
    if (scrollTop + clientHeight < scrollHeight - MainHud.BATCHING.MARGIN)
      return;

    this.#renderThrottle = true;
    await this._renderIssueBatch();
    this.#renderThrottle = false;
  }

  /**
   * Handle searching for a Document by name.
   * @param {KeyboardEvent} event  The triggering event.
   * @protected
   */
  _onSearchName(event) {
    if (!event.target.matches(".search > input")) return;
    this.#filters.searchQuery = event.target.value.trim();
    this._renderIssues();
  }

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

  /**
   * Open the Jira issue editor for a specific issue key
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onEditIssue(event, target) {
    if (event.target.closest(".col-score")) return;
    const key = target.dataset.key;
    const issue = JiraIssueManager.issues.get(key);
    issue.app.render({ force: true });
  }

  /**
   *
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onCreateIssue(_event, target) {
    const issue = new IssueData({
      summary: "New Issue",
      user: game.user.id,
    });

    issue.app.render({ force: true });
  }

  /**
   *
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onDeleteIssue(event, target) {
    event.preventDefault();
    const key = target.closest(".grid-row").dataset.key;
    const issue = JiraIssueManager.issues.get(key);
    if (event.shiftKey) return issue.delete();
    return Dialog.confirm({
      title: `${game.i18n.format("DOCUMENT.Delete", { type: "Issue" })}: ${issue.key}`,
      content: `<h4>${game.i18n.localize("AreYouSure")}</h4><p>${game.i18n.format("SIDEBAR.DeleteWarning", { type: "Issue" })}</p>`,
      yes: () => issue.delete(),
    });
  }

  /**
   * Toggle the visibility of issues assigned to others
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onToggleSelfFilter(_event, target) {
    this.#filters.showOnlySelf = !this.#filters.showOnlySelf;

    const filter = this.#filters.showOnlySelf ? "self" : "all";

    const buttons = target.querySelectorAll(".btn");
    buttons.forEach((b) =>
      b.classList.toggle("active", b.dataset.filter === filter),
    );

    const pill = target.querySelector(".selection-pill");
    if (pill) {
      pill.classList.toggle("active", this.#filters.showOnlySelf);
    }

    this._renderIssues();
  }

  /**
   * Toggle the visibility of issues assigned to others
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onLoginKofi() {
    document.getElementById("dt-btn")?.click();
  }

  /**
   * Toggles or adds a user's score to a specific Jira issue.
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static async #onAddScoreIssue(_event, target) {
    const score = Number(target.dataset.score);
    const key = target.closest(".grid-row")?.dataset.key;
    const issue = JiraIssueManager.issues.get(key);
    if (!score || !issue) return;

    const currentVoters = issue._source.voters;
    const existingVoter = currentVoters.find((v) => v.userId === game.user.id);

    let newVoters;

    if (existingVoter?.vote === score) {
      newVoters = currentVoters.filter((v) => v.userId !== game.user.id);
    } else {
      newVoters = [
        ...currentVoters.filter((v) => v.userId !== game.user.id),
        { userId: game.user.id, vote: score },
      ];
    }

    const span = target.parentElement.querySelector("span");
    span.innerText = "";
    span.classList.add("fa-solid", "fa-spinner", "fa-spin");
    span.style.opacity = 0.5;
    await issue.update({ voters: newVoters });
  }

  /**
   * Handle clicking a header to sort the issues list.
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onSortIssues(_event, target) {
    const { ASCENDING, DESCENDING } = MainHud.SORT_DIRECTIONS;
    const newKey = target.dataset.sort;
    const { sort } = this.#filters;

    if (sort.key !== newKey) {
      sort.key = newKey;
      sort.direction = DESCENDING;
    } else if (sort.direction === DESCENDING) {
      sort.direction = ASCENDING;
    } else if (sort.direction === ASCENDING) {
      sort.key = "updated";
      sort.direction = DESCENDING;
    }

    this.render({ parts: ["bugTracker"] });
  }

  /**
   *
   * @type {ApplicationClickAction}
   * @this MainHud
   */
  static #onOpenFilterMenu(_event, target) {
    const { key } = target.dataset;
    const config = key === "issueType" ? ISSUE_TYPES : ISSUE_STATUSES;

    let options = Object.values(config).map(({ key, label }) => ({
      value: key,
      label,
    }));

    if (key === "status") options.pop();

    const menu = document.createElement("div");
    menu.classList.add("tooltip-filter-menu");

    const select = foundry.applications.fields.createSelectInput({
      name: "filter",
      options,
      blank: "All",
      value: this.#filters.activeFilters[key],
    });

    select.addEventListener("change", (ev) => {
      this.#filters.activeFilters[key] = ev.target.value;
      this.render({ parts: ["bugTracker"] });
    });

    menu.innerHTML = `<i class="fa-solid fa-filter"></i> `;

    menu.appendChild(select);
    game.tooltip.activate(target, {
      content: menu,
      locked: true,
      direction: "UP",
      cssClass: MODULE_ID,
    });
  }
}
