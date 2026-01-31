import { MODULE_ID, SETTINGS } from "../constants.mjs";
import SegmentData from "../data/segment-data.mjs";
import HUDConfig from "./hud-config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import {ApplicationConfiguration, ApplicationFormSubmission} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 */

export default class SegmentConfig extends HandlebarsApplicationMixin(
  ApplicationV2,
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

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    /**@type {NodeListOf<HTMLTextAreaElement>} */
    const textAreas = this.element.querySelectorAll("textarea");

    if (textAreas.length) {
      textAreas.forEach((el) =>
        el.addEventListener("dblclick", (event) => {
          const target = event.target;
          const rect = target.getBoundingClientRect();
          const isExpanded = target.classList.contains("expanded");
          const isInResizeHandle =
            event.clientX > rect.right - 20 && event.clientY > rect.bottom - 20;
          if (isInResizeHandle) {
            if (!isExpanded) {
              target.style.height = "auto";
              target.style.height = target.scrollHeight + 10 + "px";
              target.classList.add("expanded");
              target.scrollIntoView({ behavior: "smooth", block: "end" });
            } else {
              target.style.height = 20 + "px";
              target.classList.remove("expanded");
            }
          }
        }),
      );
    }
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
    this.segment.updateSource(formData.object);
    const settings = foundry.utils.deepClone(HUDConfig.SETTING);
    const tabData = this.segment.parent.toObject();
    settings[tabData.id] = tabData;

    await game.settings.set(MODULE_ID, SETTINGS.TAB_CONFIGURATION, settings);
  }
}
