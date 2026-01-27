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
  ApplicationV2,
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
      handler: HUDConfig.#onSubmit,
      submitOnChange: true,
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
      default: () => {
        const id = foundry.utils.randomID();
        const data = new TabData({ id, label: "Home", columns: 3 });
        return { [id]: data };
      },
      onChange: () => {
        foundry.applications.instances.get(`${MODULE_ID}-hud-config`)?.render();
        ui[MAIN_HUD_KEY]?.render();
      },
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
    return game.settings.get(MODULE_ID, SETTINGS.TAB_CONFIGURATION) ?? {};
  }

  /** @return {Record<string, TabData>} */
  get setting() {
    return Object.fromEntries(
      Object.entries(HUDConfig.SETTING).map(([id, data]) => [
        id,
        new TabData({ ...data, id }),
      ]),
    );
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
    const expanded = foundry.utils.expandObject(formData.object);
    const updated = foundry.utils.mergeObject(
      HUDConfig.SETTING,
      expanded,
      { inplace: false },
    );
    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, updated);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

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
  static async #onAddTab(_event, _target) {
    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    const n = Object.keys(settings).length;
    const newTab = new TabData({ label: n ? `New Tab ${n}` : "New Tab" });
    settings[newTab.id] = newTab.toObject();
    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static async #onDeleteTab(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    if (!tabId) return;

    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    delete settings[tabId];
    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static async #onAddSegment(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    const tabData = settings[tabId];

    if (!tabData) return;

    const segment = new SegmentData({
      name: tabData.segments?.length
        ? `New Segment ${tabData.segments.length}`
        : "New Segment",
    });

    tabData.segments = [...(tabData.segments ?? []), segment.toObject()];
    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
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
      (s) => s.id === segmentId,
    );
    segment.app.render({ force: true });
  }

  /**
   * @type {ApplicationClickAction}
   * @this {HUDConfig}
   */
  static async #onDeleteSegment(_event, target) {
    const tabId = target.closest("[data-tab-id]")?.dataset.tabId;
    const segmentId = target.closest("[data-segment-id]")?.dataset.segmentId;
    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    const tabData = settings[tabId];

    if (!tabData || !segmentId) return;

    for (const app of foundry.applications.instances.values()) {
      if (app instanceof SegmentConfig && app.segment.id === segmentId)
        app.close();
    }

    tabData.segments = tabData.segments.filter((s) => s.id !== segmentId);
    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
  }
}
