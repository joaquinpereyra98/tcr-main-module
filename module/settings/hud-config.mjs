import SegmentConfig from "./segment-config.mjs";
import { MAIN_HUD_KEY, MODULE_ID, SETTINGS } from "../constants.mjs";
import SegmentData from "../data/segment-data.mjs";
import TabData from "../data/tab-data.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import {ApplicationFormSubmission, ApplicationClickAction, ApplicationConfiguration} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 */

/**
 * The application responsible for configuring the main hud
 * @extends {ApplicationV2}
 */
export default class HUDConfig extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-hud-config`,
    tag: "form",
    classes: [MODULE_ID, "hud-config"],
    window: {
      title: "HUD Tab Configuration",
      icon: "fa-solid fa-wrench",
      resizable: true,
    },
    position: {
      width: 400,
      height: 500,
    },
    form: {
      closeOnSubmit: true,
      handler: HUDConfig.#onSubmit,
    },
    actions: {
      addTab: HUDConfig.#onAddTab,
      toggleAccordion: HUDConfig.#onToggleAccordion,
      deleteTab: HUDConfig.#onDeleteTab,
      addSegment: HUDConfig.#onAddSegment,
      editSegment: HUDConfig.#onEditSegment,
      deleteSegment: HUDConfig.#onDeleteSegment,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/settings/hud-config.hbs`,
      scrollable: [""],
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  /* -------------------------------------------- */
  /*  Setting                                     */
  /* -------------------------------------------- */

  /**
   * Register setting and menu.
   */
  static registerSetting() {
    game.settings.register(MODULE_ID, SETTINGS.TAB_CONFIGURATION, {
      config: false,
      type: Object,
      scope: "world",
      initial: () => {
        const id = foundry.utils.randomID();
        const data = new TabData({ id, label: "Home", columns: 3 });
        return { [id]: data };
      },
      onChange: () => ui[MAIN_HUD_KEY]?.render(),
    });

    game.settings.registerMenu(MODULE_ID, SETTINGS.TAB_CONFIGURATION, {
      name: "Configure HUD Tabs",
      label: "Edit Tabs",
      icon: "fa-solid fa-table-cells",
      type: HUDConfig,
      restricted: false,
    });
  }

  /**@type {Record<String, TabData>} */
  static get SETTING() {
    return game.settings.get(MODULE_ID, SETTINGS.TAB_CONFIGURATION);
  }

  /**
   * Storage for the instantiated TabData objects
   */
  _setting = null;

  /** @return {Record<string, TabData>} */
  get setting() {
    if (!this._setting) {
      this._setting = Object.fromEntries(
        Object.entries(HUDConfig.SETTING).map(([id, data]) => [
          id,
          new TabData({ ...data, id }),
        ])
      );
    }

    return this._setting;
  }

  /* -------------------------------------------- */
  /*  Application                                 */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      setting: this.setting,
      buttons: [
        {
          type: "button",
          icon: "fa-solid fa-square-plus",
          action: "addTab",
          label: "Add New Tab",
        },
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "SETTINGS.Save",
        },
      ],
    };
  }

  /**
   * Prepare data used to synchronize the state of a template part.
   * @param {string} partId                       The id of the part being rendered
   * @param {HTMLElement} newElement              The new rendered HTML element for the part
   * @param {HTMLElement} priorElement            The prior rendered HTML element for the part
   * @param {object} state                        A state object which is used to synchronize after replacement
   * @protected
   */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);

    priorElement.querySelectorAll("[data-tab-id]").forEach((el) => {
      const { tabId } = el.dataset;

      const expanded = el?.classList.contains("expanded");

      newElement
        .querySelector(`[data-tab-id="${tabId}"]`)
        ?.classList.toggle("expanded", expanded);
    });
  }

  /**
   * @type {ApplicationFormSubmission}
   * @this {HUDConfig}
   */
  static async #onSubmit(_event, _form, formData) {
    const { mergeObject } = foundry.utils;
    const config = Object.fromEntries(
      Object.entries(this.setting).map(([id, tab]) => [id, tab.toObject()])
    );
    const expanded = foundry.utils.expandObject(formData.object);

    await game.settings.set(
      MODULE_ID,
      SETTINGS.TAB_CONFIGURATION,
      mergeObject(config, expanded, { inplace: false })
    );

    for (const app of foundry.applications.instances.values()) {
      if (app instanceof SegmentConfig) app.close();
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onAddTab(_event, _target) {
    const n = Object.keys(this._setting).length;
    const newTab = new TabData({
      label: n ? `New Tab ${n}` : "New Tab",
    });

    this._setting[newTab.id] = newTab;
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onToggleAccordion(_event, target) {
    const container = target.closest(".accordion-container");
    container.classList.toggle("expanded");
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onDeleteTab(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    if (!tabId) return;
    delete this._setting[tabId];
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onAddSegment(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    const tabData = this.setting[tabId];
    if (!tabData) return;

    const count = tabData.segments.length;
    const segment = new SegmentData({
      name: count ? `New Segment ${count}` : "New Segment",
    });

    tabData.updateSource({
      segments: [...tabData.segments, segment],
    });

    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onEditSegment(_event, target) {
    const segmentId = target.closest("[data-segment-id]")?.dataset.segmentId;
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    if (!segmentId || !tabId) return;

    const segment = this.setting[tabId].segments.find(
      (s) => s.id === segmentId
    );
    segment.app.render({ force: true });
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static #onDeleteSegment(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    const segmentId = target.closest("[data-segment-id]")?.dataset.segmentId;
    const tabData = this.setting[tabId];

    if (!tabData || !segmentId) return;

    for (const app of foundry.applications.instances.values()) {
      if (app instanceof SegmentConfig && app.segment.id === segmentId)
        app.close();
    }

    tabData.updateSource({
      segments: tabData.segments.filter((s) => s.id !== segmentId),
    });

    this.render();
  }
}
