import CompendiumBrowser from "../apps/compendium-browser.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @typedef {Object} SourceData
 * @property {string|null} label
 */

/**
 * @typedef {Record<string, SourceData>} SourcesData
 */

/**
 * @import {ApplicationFormSubmission, ApplicationClickAction, ApplicationConfiguration, ApplicationFormConfiguration} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 */

/**
 * The application responsible for configuring the main hud
 * @extends {ApplicationV2}
 */
export default class SourcesConfig extends HandlebarsApplicationMixin(
  ApplicationV2
) {
  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-sources-config`,
    tag: "form",
    classes: [MODULE_ID, "sources-config"],
    window: {
      title: "Sources Configuration",
      icon: "fa-solid fa-wrench",
      resizable: true,
    },
    position: {
      height: 400,
    },
    form: {
      closeOnSubmit: true,
      handler: SourcesConfig.#onSubmit,
    },
    actions: {
      addCompenidum: SourcesConfig.#onAddCompenidum,
      removeCompendium: SourcesConfig.#onRemoveCompenidum,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/settings/sources-config.hbs`,
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
    game.settings.register(MODULE_ID, SETTINGS.SOURCES_CONFIGURATION, {
      config: false,
      type: Object,
      scope: "world",
      change: () => {
        for(const app of foundry.applications.instances) {
          if(app instanceof CompendiumBrowser) app.render()
        }
      },
      default: {},
    });

    game.settings.registerMenu(MODULE_ID, SETTINGS.SOURCES_CONFIGURATION, {
      name: "Compendium Source Management",
      label: "Configure Sources",
      icon: "fa-solid fa-book-atlas",
      type: SourcesConfig,
      restricted: false,
    });
  }

  /**@type {SourcesData} */
  static get SETTING() {
    return game.settings.get(MODULE_ID, SETTINGS.SOURCES_CONFIGURATION) ?? {};
  }

  /**@type {SourcesData} */
  #sources;

  /**@type {SourcesData} */
  get sources() {
    this.#sources ??= SourcesConfig.SETTING;
    return this.#sources;
  }

  /**
   * Get source options object.
   * @param {Object} options - The configuration object.
   * @param {boolean} [options.includeBlank=true] - Whether to prepend an empty string entry.
   * @returns {Object.<string, string>} A record where the key is the pack ID and the value is the label.
   */
  getSourcesOptions({ includeBlank = true }) {
    const entries = game.packs
      .map((p) => [p.metadata.id, p.metadata.label])
      // Filter out IDs that already exist in sources
      .filter(([id, _]) => !Object.keys(this.sources).includes(id))
      // Sort alphabetically by label
      .sort((a, b) => a[1].localeCompare(b[1]));

    if (includeBlank) entries.unshift(["", ""]);

    return Object.fromEntries(entries);
  }

  /* -------------------------------------------- */
  /*  Application                                 */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const sources = Object.fromEntries(
      Object.entries(this.sources).map(([id, obj]) => [
        id,
        { ...obj, name: game.packs.get(id)?.metadata.label ?? "---" },
      ])
    );

    return {
      ...context,
      sources,
      sourcesOptions: this.getSourcesOptions({
        includeBlank: true,
      }),
      buttons: [
        {
          type: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "SETTINGS.Save",
        },
      ],
    };
  }

  /**
   * @type {ApplicationFormSubmission}
   * @this SourcesConfig
   */
  static async #onSubmit(_event, _form, _formData) {
    const sources = foundry.utils.duplicate(this.sources);
    return game.settings.set(
      MODULE_ID,
      SETTINGS.SOURCES_CONFIGURATION,
      sources
    );
  }

  /**
   * Handle changes to an input element within the form.
   * @param {ApplicationFormConfiguration} formConfig     The form configuration for which this handler is bound
   * @param {Event} event                                 An input change event within the form
   */
  _onChangeForm(formConfig, event) {
    /**@type {HTMLInputElement} */
    const input = event.target;
    const targetName = input.name ?? "";
    const lastDot = targetName.lastIndexOf(".");
    const id = targetName.slice(0, lastDot);
    const prop = targetName.slice(lastDot + 1);

    if (this.sources[id]) this.#sources[id][prop] = input.type === "checkbox" ? input.checked : input.value;

    super._onChangeForm(formConfig, event);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * @this SourcesConfig
   * @type {ApplicationClickAction}
   */
  static #onAddCompenidum(_event, target) {
    const select = target
      .closest(".add-row")
      ?.querySelector("select.new-sources");
    if (!select.value) return;

    this.#sources[select.value] = {
      label: null,
    };

    this.render();
  }

  /**
   * @this SourcesConfig
   * @type {ApplicationClickAction}
   */
  static #onRemoveCompenidum(_event, target) {
    const key = target.closest("[data-key]")?.dataset.key;
    delete this.#sources[key];
    this.render();
  }
}
