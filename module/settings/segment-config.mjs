import { MODULE_ID, SETTINGS } from "../constants.mjs";
import SegmentData from "../data/segment-data.mjs";
import HUDConfig from "./hud-config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import {ApplicationConfiguration, ApplicationFormSubmission} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 */

export default class SegmentConfig extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /** @param {Partial<ApplicationConfiguration> & {segment: SegmentData}} options */
  constructor(options) {
    super(options);

    this.#segment = options.segment;
  }
  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${SegmentConfig.name}-{id}`,
    tag: "form",
    classes: [MODULE_ID, "segment-config"],
    window: {
      resizable: true,
      icon: "fa-solid fa-puzzle-piece",
    },
    position: { width: 550, height: 600 },
    form: {
      handler: SegmentConfig.#onSubmitForm,
      submitOnChange: true,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/segment-config/body.hbs`,
      scrollable: [""],
    },
  };

  /* -------------------------------------------- */

  /**
   * The Document instance associated with the application
   * @type {SegmentData}
   */
  get segment() {
    return this.#segment;
  }

  #segment;

  /* -------------------------------------------- */

  /** @override */
  get title() {
    const { name, id } = this.segment;
    return `Segment: ${name || id}`;
  }

  /** @inheritDoc */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    options.uniqueId = options.segment.id;
    return options;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    return {
      ...context,
      segment: this.segment,
      fields: this.segment.schema.fields,
    };
  }

  /**
   * @type {ApplicationFormSubmission}
   * @this {SegmentConfig}
   */
  static async #onSubmitForm(_event, _form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    this.segment.updateSource(expanded);
    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    const tabData = this.segment.parent.toObject();
    settings[tabData.id] = tabData;

    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
    this.render();
  }
}
