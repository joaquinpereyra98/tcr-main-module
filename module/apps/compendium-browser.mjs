import { ITEM_FLAGS, MODULE_ID } from "../constants.mjs";
import SourcesConfig from "../settings/sources-config.mjs";
import {
  formatIdentifier,
  getRankFolderNames,
  getSubfoldersInCompenidum,
  hasDocumentsInFolder,
} from "../utils.mjs";

/**
 * @import {ApplicationClickAction, ApplicationConfiguration, ApplicationFormConfiguration, ApplicationRenderContext} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import ApplicationV2 from "../../foundry/resources/app/client-esm/applications/api/application.mjs";
 * @import {HandlebarsRenderOptions} from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 * @import Document from "../../foundry/resources/app/common/abstract/document.mjs";
 * @import { CompendiumBrowserFilterDefinition, CompendiumBrowserConfiguration, CompendiumBrowserFilterState, CompendiumBrowserFilters } from "./_types.mjs";
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @extends ApplicationV2
 * @mixes HandlebarsApplicationMixin
 * @template {CompendiumBrowserConfiguration}
 */
export default class CompendiumBrowser extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  constructor(...args) {
    super(...args);
    this.#filters = this.options.filters?.initial ?? {};

    const initialSources = this.options.sources?.initial ?? [];
    this.#sources = new Set(initialSources);
  }

  /* -------------------------------------------- */

  /** @type {ApplicationConfiguration & {filters: CompendiumBrowserFilterState}} */
  static DEFAULT_OPTIONS = {
    id: "compendium-browser-{id}",
    classes: ["dnd5e2", "compendium-browser", MODULE_ID, "compendium-browser"],
    tag: "form",
    window: {
      title: "DND5E.CompendiumBrowser.Title",
      minimizable: true,
      resizable: true,
      background: {
        src: "",
        color: "#0d0b0b url(../../ui/denim075.png)",
      },
    },
    actions: {
      clearName: CompendiumBrowser.#onClearName,
      setFilter: CompendiumBrowser.#onSetFilter,
      setType: CompendiumBrowser.#onSetType,
      setSource: CompendiumBrowser.#onSetSource,
      toggleCollapse: CompendiumBrowser.#onToggleCollapse,
      toggleHeader: CompendiumBrowser.#onToggleHeader,
      toggleLogic: CompendiumBrowser.#onToggleLogic,
      clickEntry: {
        buttons: [0, 2],
        handler: CompendiumBrowser.#onClickEntry,
      },
    },
    form: {
      closeOnSubmit: false,
    },
    position: {
      width: 850,
      height: 700,
    },
    hiddenSubtitle: false,
    filters: {
      locked: {},
      initial: {
        documentClass: "Item",
        operators: {},
      },
    },
    sources: {
      locked: [],
      initial: [],
    },
    selection: {
      min: null,
      max: null,
    },
    tab: "classes",
  };

  /* -------------------------------------------- */

  /** @override */
  static PARTS = {
    header: {
      template: `modules/${MODULE_ID}/templates/compendium/browser-header.hbs`,
      classes: ["header"],
      scrollable: [".filter-sections-wrapper"],
    },
    search: {
      id: "header-search",
      classes: ["search-part", "filter-element"],
      template: "systems/dnd5e/templates/compendium/browser-sidebar-search.hbs",
    },
    sources: {
      id: "header-sources",
      classes: ["header-part"],
      template: `modules/${MODULE_ID}/templates/compendium/browser-sidebar-sources.hbs`,
    },
    types: {
      id: "header-types",
      classes: ["header-part"],
      template: `modules/${MODULE_ID}/templates/compendium/browser-sidebar-types.hbs`,
    },
    filters: {
      id: "header-filters",
      classes: ["header-part"],
      template: `modules/${MODULE_ID}/templates/compendium/browser-sidebar-filters.hbs`,
    },
    results: {
      id: "results",
      classes: ["results"],
      template: "systems/dnd5e/templates/compendium/browser-results.hbs",
      templates: ["systems/dnd5e/templates/compendium/browser-entry.hbs"],
      scrollable: [""],
    },
  };

  /* -------------------------------------------- */

  /**
   * Batching configuration.
   * @type {Record<string, number>}
   */
  static BATCHING = {
    /**
     * The number of pixels before reaching the end of the scroll container to begin loading additional entries.
     */
    MARGIN: 50,

    /**
     * The number of entries to load per batch.
     */
    SIZE: 50,
  };

  /* -------------------------------------------- */

  /**
   * The number of milliseconds to delay between user keypresses before executing a search.
   * @type {number}
   */
  static SEARCH_DELAY = 200;

  static renderCompendiumBrowser(options = {}) {
    const cls = game.modules.get("tcr-main-module").api.apps.CompendiumBrowser;
    const app = new cls(options);
    return app.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * Should the selection controls be displayed?
   * @type {boolean}
   */
  get displaySelection() {
    return !!this.options.selection.min || !!this.options.selection.max;
  }

  /* -------------------------------------------- */

  /**
   * Currently defined filters.
   */
  #filters;

  /**
   * Current filters selected.
   * @type {CompendiumBrowserFilters}
   */
  get currentFilters() {
    const filters = foundry.utils.mergeObject(
      this.#filters,
      this.options.filters.locked,
      { inplace: false },
    );
    filters.documentClass ??= "Item";
    return filters;
  }

  /**
   * The current set of source IDs, merging active selection with locked sources.
   * @type {Set<string>}
   */
  get currentSources() {
    const locked = this.options.sources?.locked ?? [];
    return this.#sources.union(new Set(locked));
  }

  /* -------------------------------------------- */

  /**
   * Fetched results.
   * @type {Promise<object[]|Document[]>|object[]|Document[]}
   */
  #results;

  /* -------------------------------------------- */

  /**
   * The index of the next result to render as part of batching.
   * @type {number}
   */
  #resultIndex = -1;

  /* -------------------------------------------- */

  /**
   * Whether rendering is currently throttled.
   * @type {boolean}
   */
  #renderThrottle = false;

  /* -------------------------------------------- */

  /**@type {Boolean} */
  _headerCollapsed = false;

  /* -------------------------------------------- */

  /**
   * Set of pack ids
   * @type {Set<string>}
   */
  #sources = new Set();

  /* -------------------------------------------- */

  /**
   * The function to invoke when searching results by name.
   * @type {Function}
   */
  _debouncedSearch = foundry.utils.debounce(
    this._onSearchName.bind(this),
    this.constructor.SEARCH_DELAY,
  );

  /* -------------------------------------------- */

  /**@type {HTMLElement} */
  #background;

  /**
   * @type {Map<String, String>} identifier - uuid
   */
  static #identifierMap = new Map();

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);

    this.#background = document.createElement("div");
    this.#background.classList.add("background-container");
    frame.insertAdjacentElement("afterbegin", this.#background);

    const { src, color } = this.options.window.background ?? {};
    if (src || color) this.#applyBackgroundTransition(src, color);

    return frame;
  }

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);

    const searchContainer = this.element.querySelector(".search-container");
    const filterSections = this.element.querySelector(
      ".filter-sections-wrapper",
    );

    if (searchContainer && !searchContainer.querySelector(".search-part")) {
      const searchPart = this.element.querySelector(".search-part");
      if (searchPart) searchContainer.appendChild(searchPart);
    }

    if (filterSections && filterSections.children.length === 0) {
      filterSections.append(...this.element.querySelectorAll(".header-part"));
    }
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rankNames = getRankFolderNames();
    context.filters = this.currentFilters;

    const dataModels = await this._getActiveDataModels(context, rankNames);

    context.filterDefinitions = this._getMergedFilterDefinitions(dataModels);

    await this._prepareSpecialFilters(context, dataModels);

    this._prepareRankFilters(context, rankNames);

    context.sources = this._getSourcesOptions();

    return context;
  }

  /**
   * Retrieves the data models that are currently active based on document filters
   * or visibility within specific source packs.
   * @param {ApplicationRenderContext} context - The current application context.
   * @param {string[]} rankNames - A list of folder names/ranks used to determine visibility
   * for non-GM users.
   * @returns {Promise<Array<[string, foundry.abstract.TypeDataModel]>>}
   */
  async _getActiveDataModels(context, rankNames) {
    let dataModels = Object.entries(
      CONFIG[context.filters.documentClass].dataModels,
    );
    const hasSelectedTypes = context.filters.types?.size > 0;

    if (hasSelectedTypes) {
      return dataModels.filter(([type]) => context.filters.types.has(type));
    }

    const availableTypeKeys = new Set();
    for (const sourceId of this.currentSources) {
      const pack = game.packs.get(sourceId);
      if (!pack) continue;
      const index = await pack.getIndex();

      for (const entry of index) {
        const folder = pack.folders.get(entry.folder);
        const isVisible =
          game.user.isGM ||
          !entry.folder ||
          folder?.ancestors.some((f) => rankNames.includes(f.name)) ||
          rankNames.includes(folder?.name);

        if (isVisible) availableTypeKeys.add(entry.type);
      }
    }
    return dataModels.filter(([type]) => availableTypeKeys.has(type));
  }

  /**
   * Aggregates and merges unique filter definitions from the provided data models.
   * @param {Array<[string, foundry.abstract.TypeDataModel]>} dataModels - An array of data model entries.
   * @returns {Map<string, any>} A Map containing merged filter definitions
   */
  _getMergedFilterDefinitions(dataModels) {
    return dataModels
      .map(([, d]) => d.compendiumBrowserFilters ?? new Map())
      .reduce((merged, current) => {
        for (let [key, value] of current) {
          if (!merged.has(key)) merged.set(key, foundry.utils.deepClone(value));
        }
        return merged;
      }, new Map());
  }

  /**
   * Dynamically prepares and adds class-related filters for both Subclasses and Spells.
   * @param {Object} context - The current application context.
   * @param {Array<[string, foundry.abstract.TypeDataModel]>} dataModels - Array of active data model entries.
   * @returns {Promise<void>}
   */
  async _prepareSpecialFilters(context, dataModels) {
    const types = context.filters.types;
    const hasNoFilters = !types || types.size === 0;

    // Determine if we need to scan for subclasses or spells
    const wantsSubclass =
      types?.has("subclass") ||
      (hasNoFilters && dataModels.some(([t]) => t === "subclass"));
    const wantsSpell =
      types?.has("spell") ||
      (hasNoFilters && dataModels.some(([t]) => t === "spell"));

    if (!wantsSubclass && !wantsSpell) return;

    const classIdentifiers = new Set();
    const classUuids = new Set();
    const spellFlagPath = `flags.${MODULE_ID}.${ITEM_FLAGS.SPELL_CLASSES}`;

    // Single pass over sources
    for (const sourceId of this.currentSources) {
      const pack = game.packs.get(sourceId);
      if (!pack) continue;

      // Fetch all required fields in one index call
      const fields = [];
      if (wantsSubclass) fields.push("system.classIdentifier");
      if (wantsSpell) fields.push(spellFlagPath);

      const index = await pack.getIndex({ fields });

      for (const entry of index) {
        // Logic for Subclasses
        if (
          wantsSubclass &&
          entry.type === "subclass" &&
          entry.system?.classIdentifier
        ) {
          classIdentifiers.add(entry.system.classIdentifier);
        }

        // Logic for Spells
        if (wantsSpell && entry.type === "spell") {
          const spellClasses = foundry.utils.getProperty(entry, spellFlagPath);
          if (Array.isArray(spellClasses)) {
            spellClasses.forEach((uuid) => classUuids.add(uuid));
          }
        }
      }
    }

    if (classIdentifiers.size > 0) {
      context.filterDefinitions.set("classIdentifier", {
        type: "set",
        label: "Parent Class",
        config: {
          keyPath: "system.classIdentifier",
          choices: Array.from(classIdentifiers)
            .map((id) => ({ id, label: formatIdentifier(id) }))
            .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
            .reduce((acc, item) => {
              acc[item.id] = { label: item.label };
              return acc;
            }, {}),
          multiple: false,
        },
      });
    }

    if (classUuids.size > 0) {
      context.filterDefinitions.set(ITEM_FLAGS.SPELL_CLASSES, {
        type: "set",
        label: "Sources Class",
        config: {
          keyPath: "_classIdentifiers",
          choices: await this.#preprareSpellClassChoices(classUuids),
          multiple: true,
        },
      });
    }
  }

  async #preprareSpellClassChoices(classUuids) {
    const packs = new Set(
      Array.from(classUuids).map(
        (uuid) => foundry.utils.parseUuid(uuid).collection,
      ),
    );

    const indexMap = new Map();
    await Promise.all(
      Array.from(packs).map(async (pack) => {
        const index = await pack?.getIndex({ fields: ["system.identifier"] });
        if (index) indexMap.set(pack.metadata.id, index);
      }),
    );

    const choiceData = Array.from(classUuids).map((uuid) => {
      const { collection, id } = foundry.utils.parseUuid(uuid);
      const entry = indexMap.get(collection.metadata.id)?.get(id);

      CompendiumBrowser.#identifierMap.set(uuid, entry?.system?.identifier);

      return {
        identifier: entry?.system?.identifier || id,
        name: entry?.name || uuid,
        type: entry?.type || "unknown",
      };
    });

    const priorities = { class: 1, subclass: 2 };
    choiceData.sort((a, b) => {
      const priorityA = priorities[a.type] || 3;
      const priorityB = priorities[b.type] || 3;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name, game.i18n.lang);
    });

    return Object.fromEntries(
      choiceData.map((i) => [i.identifier, { label: i.name }]),
    );
  }

  /**
   * Processes folders within active compendium packs to build a "Rank Access" filter.
   * @param {ApplicationRenderContext} context - The current application context.
   * @param {string[]} rankNames - An array of folder names of valid ranks
   * @returns {void}
   */
  _prepareRankFilters(context, rankNames) {
    const rankChoices = {};
    const gmoFolderIds = new Set();

    for (const sourceId of this.currentSources) {
      const pack = game.packs.get(sourceId);
      if (!pack) continue;

      for (const folder of pack.folders) {
        const rankMatch = rankNames.includes(folder.name)
          ? folder.name
          : folder.ancestors.find((f) => rankNames.includes(f.name))?.name;

        if (rankMatch) {
          rankChoices[rankMatch] = rankMatch;
        } else {
          gmoFolderIds.add(folder.id);
        }
      }
    }

    if (Object.keys(rankChoices).length || gmoFolderIds.size) {
      const choices = { ...rankChoices };
      if (gmoFolderIds.size) choices["gm-only"] = "GMO";

      context.filterDefinitions.set("rankFilter", {
        type: "set",
        label: "Rank Access",
        config: { keyPath: "folder", choices, multiple: true },
        createFilter: (filters, value, def) => {
          const selected = Object.entries(value)
            .filter(([k, v]) => v === 1)
            .map(([k]) => k);
          if (!selected.length) return;

          const targetFolderIds = [];
          for (const selection of selected) {
            if (selection === "gm-only") {
              targetFolderIds.push(...gmoFolderIds);
            } else {
              for (const sId of this.currentSources) {
                const p = game.packs.get(sId);
                const matches = p?.folders.filter(
                  (f) =>
                    f.name === selection ||
                    f.ancestors.some((a) => a.name === selection),
                );
                if (matches) targetFolderIds.push(...matches.map((f) => f.id));
              }
            }
          }
          filters.push({ k: "folder", o: "in", v: targetFolderIds });
        },
      });
    }
  }

  /**
   * Generates a sorted list of available compendium sources based on user rank and folder content.
   * @returns {Object[]} An array of formatted and sorted source options.
   */
  _getSourcesOptions() {
    const allowedNames = getRankFolderNames() ?? [];

    const lockedSources = new Set(this.options.sources?.locked ?? []);

    // 2. Iterate through all defined settings to build the final list
    return Object.entries(SourcesConfig.SETTING)
      .reduce((acc, [id, { label }]) => {
        const pack = game.packs.get(id);
        if (!pack) return acc;

        // Check conditions for visibility:
        // A. Always show to GM if pack is not empty
        // B. Show if there are documents not inside any folder (loose items)
        // C. Show if user has rank-access to at least one top-level folder that contains documents
        const isVisible =
          (game.user.isGM && pack.index.size > 0) ||
          pack.index.some((i) => !i.folder) ||
          (allowedNames.length > 0 &&
            pack.folders.some(
              (f) =>
                f.depth === 1 &&
                allowedNames.includes(f.name) &&
                hasDocumentsInFolder(f),
            ));

        if (isVisible) {
          acc.push({
            id,
            label: label ?? pack.metadata.label,
            selected: this.#sources.has(id),
            locked: lockedSources.has(id),
          });
        }

        return acc;
      }, [])
      .sort((a, b) => a.label.localeCompare(b.label)); // Alphabetical sort by label
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    switch (partId) {
      case "header":
      case "types":
      case "filters":
        return this._prepareHeaderContext(partId, context, options);
      case "results":
        return this._prepareResultsContext(context, options);
    }
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the header context.
   * @param {string} partId - The part being rendered.
   * @param {ApplicationRenderContext} context - Shared context provided by _prepareContext.
   * @param {HandlebarsRenderOptions} options - Options which configure application rendering behavior.
   * @returns {Promise<ApplicationRenderContext>} - Context data for a specific part.
   * @protected
   */
  async _prepareHeaderContext(partId, context, options) {
    context.headerCollapsed = this._headerCollapsed;

    context.isLocked = { documentClass: true };
    context.isLocked.filters = "additional" in this.options.filters.locked;
    context.isLocked.types =
      "types" in this.options.filters.locked || context.isLocked.filters;
    context.isLocked.documentClass =
      "documentClass" in this.options.filters.locked || context.isLocked.types;

    const types =
      foundry.utils.getProperty(options, "dnd5e.browser.types") ?? [];

    if (partId === "types") {
      context.showTypes = true;

      const allTypes = CONFIG[
        context.filters.documentClass
      ].documentClass.compendiumBrowserTypes({
        chosen: context.filters.types,
      });

      const rankNames = getRankFolderNames();
      const availableTypeKeys = new Set();

      for (const sourceId of this.currentSources) {
        const pack = game.packs.get(sourceId);
        if (!pack) continue;

        const index = await pack.getIndex();
        for (const entry of index) {
          const folder = pack.folders.get(entry.folder);
          const isVisible =
            game.user.isGM ||
            !entry.folder ||
            folder?.ancestors.some((f) => rankNames.includes(f.name)) ||
            rankNames.includes(folder?.name);

          if (isVisible) availableTypeKeys.add(entry.type);
        }
      }

      const filterTypeMap = (typeMap) => {
        return Object.entries(typeMap).reduce((acc, [key, data]) => {
          if (data.children) {
            data.children = filterTypeMap(data.children);
            if (Object.keys(data.children).length > 0) acc[key] = data;
          } else if (availableTypeKeys.has(key)) {
            acc[key] = data;
          }
          return acc;
        }, {});
      };

      context.types = filterTypeMap(allTypes);

      // Special case handling for 'Items' tab in basic mode.
      if (types[0] === "physical")
        context.types = context.types.physical?.children ?? {};

      if (context.isLocked.types) {
        for (const [key, value] of Object.entries(context.types)) {
          if (!value.children && !value.chosen) delete context.types[key];
          else if (value.children) {
            for (const [k, v] of Object.entries(value.children)) {
              if (!v.chosen) delete value.children[k];
            }
            if (foundry.utils.isEmpty(value.children))
              delete context.types[key];
          }
        }
      }
    } else if (partId === "filters") {
      if (!this.currentSources.size) {
        context.additional = [];
        return context;
      }

      const activeTypes = context.filters.types;
      let filteredDefinitions;
      if (!activeTypes || activeTypes.size === 0) {
        filteredDefinitions = context.filterDefinitions;
      } else {
        filteredDefinitions = new Map();
        const allModels = CONFIG[context.filters.documentClass].dataModels;
        for (const type of activeTypes) {
          const model = allModels[type];
          const modelFilters = model?.compendiumBrowserFilters;
          if (modelFilters) {
            for (const [key, def] of modelFilters) {
              if (!filteredDefinitions.has(key))
                filteredDefinitions.set(key, def);
            }
          }
        }
        const specialKeys = [
          "classIdentifier",
          "rankFilter",
          `flags.${MODULE_ID}.${ITEM_FLAGS.SPELL_CLASSES}`,
        ];
        for (const key of specialKeys) {
          if (context.filterDefinitions.has(key)) {
            if (key.includes("spell") && !activeTypes.has("spell")) continue;
            filteredDefinitions.set(key, context.filterDefinitions.get(key));
          }
        }
      }

      context.additional = Array.from(
        filteredDefinitions.entries() ?? [],
      ).reduce((arr, [key, data]) => {
        const filterValue = context.filters.additional?.[key] ?? {};

        const posCount = Object.values(filterValue).filter(
          (v) => v === 1,
        ).length;

        const negCount = Object.values(filterValue).filter(
          (v) => v === -1,
        ).length;

        // Special case handling for 'Feats' tab in basic mode.
        if (types[0] === "feat" && (key === "category" || key === "subtype"))
          return arr;

        let sort = 0;
        switch (data.type) {
          case "boolean":
            sort = 1;
            break;
          case "range":
            sort = 2;
            break;
          case "set":
            sort = 3;
            break;
        }

        arr.push(
          foundry.utils.mergeObject(
            data,
            {
              key,
              sort,
              value: context.filters.additional?.[key],
              locked: this.options.filters.locked?.additional?.[key],
              operators: this.#filters.operators?.[key] ?? {
                pos: "AND",
                neg: "OR",
              },
              posCount: posCount > 0 ? posCount : null,
              negCount: negCount > 0 ? negCount : null,
            },
            { inplace: false },
          ),
        );
        return arr;
      }, []);

      context.additional.sort((a, b) => a.sort - b.sort);
    }

    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the results context.
   * @param {ApplicationRenderContext} context     Shared context provided by _prepareContext.
   * @param {HandlebarsRenderOptions} options      Options which configure application rendering behavior.
   * @returns {Promise<ApplicationRenderContext>}  Context data for a specific part.
   * @protected
   */
  async _prepareResultsContext(context, options) {
    const filters = CompendiumBrowser.applyFilters(
      context.filterDefinitions,
      context.filters.additional,
    );
    // Add the name filter
    if (this.#filters.name?.length)
      filters.push({ k: "name", o: "icontains", v: this.#filters.name });

    this.#results = CompendiumBrowser.fetch(
      CONFIG[context.filters.documentClass].documentClass,
      {
        filters,
        types: context.filters.types,
        sources: this.currentSources,
      },
    );
    context.displaySelection = this.displaySelection;
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Render a single result entry.
   * @param {object|Document} entry  The entry.
   * @param {string} documentClass   The entry's Document class.
   * @returns {Promise<HTMLElement>}
   * @protected
   */
  async _renderResult(entry, documentClass) {
    const { img, name, type, uuid } = entry;

    const label = CONFIG[documentClass]?.typeLabels?.[type] ?? "";
    const subtitle = this.options.hiddenSubtitle ? "" : label;

    const compId = foundry.utils.parseUuid(uuid)?.collection?.metadata.id;
    const isDrag = game.user.isGM || !!SourcesConfig.SETTING[compId]?.draggable;

    const context = {
      entry: { img, name, subtitle, uuid, isDrag },
      displaySelection: this.displaySelection,
    };
    const path = `modules/${MODULE_ID}/templates/compendium/browser-entry-grid.hbs`;
    const html = await renderTemplate(path, context);
    const template = document.createElement("template");
    template.innerHTML = html;
    const element = template.content.firstElementChild;
    if (documentClass !== "Item") return element;
    const itemImg = element.querySelector(".item-image");

    itemImg.dataset.tooltip = `
      <section class="loading" data-uuid="${uuid}">
        <i class="fa-solid fa-spinner fa-spin-pulse" inert></i>
      </section>
    `;
    itemImg.dataset.tooltipClass = "dnd5e2 dnd5e-tooltip item-tooltip";
    itemImg.dataset.tooltipDirection ??= "RIGHT";

    return element;
  }

  /* -------------------------------------------- */

  /**
   * Render results once loaded to avoid holding up initial app display.
   * @protected
   */
  async _renderResults() {
    let rendered = [];
    const { documentClass } = this.currentFilters;
    const results = await this.#results;
    this.#results = results;
    const batchEnd = Math.min(this.constructor.BATCHING.SIZE, results.length);
    for (let i = 0; i < batchEnd; i++) {
      rendered.push(this._renderResult(results[i], documentClass));
    }
    this.element.querySelector(".results-loading").hidden = true;
    this.element
      .querySelector('[data-application-part="results"] .item-list')
      .replaceChildren(...(await Promise.all(rendered)));
    this.#resultIndex = batchEnd;
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _attachFrameListeners() {
    super._attachFrameListeners();
    this.element.addEventListener("scroll", this._onScrollResults.bind(this), {
      capture: true,
      passive: true,
    });
    this.element.addEventListener("dragstart", this._onDragStart.bind(this));
    this.element.addEventListener("keydown", this._debouncedSearch, {
      passive: true,
    });
    this.element.addEventListener("keydown", this._onKeyAction.bind(this), {
      passive: true,
    });
    this.element.addEventListener("pointerdown", (event) => {
      if (
        event.button === 1 &&
        document.getElementById("tooltip")?.classList.contains("active")
      ) {
        event.preventDefault();
      }
    });
  }

  /**
   * Handles the cross-fade transition for any background type (Video, Image, or Color)
   */
  #applyBackgroundTransition(src, color) {
    if (!this.#background) return;

    const oldLayers = Array.from(this.#background.children);

    const isVideo = VideoHelper.hasVideoExtension(src);
    const newLayer = document.createElement(isVideo ? "video" : "div");

    newLayer.classList.add("bg-layer");
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
    });

    if (oldLayers.length > 0) {
      setTimeout(() => {
        oldLayers.forEach((el) => el.remove());
      }, 800);
    }
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "results") this._renderResults();
  }

  /* -------------------------------------------- */

  /**
   * Handle changes to an input element within the form.
   * @param {ApplicationFormConfiguration} _formConfig - The form configuration for which this handler is bound
   * @param {Event} event - An input change event within the form
   * @protected
   */
  _onChangeForm(_formConfig, event) {
    if (event.target.name?.startsWith("additional."))
      CompendiumBrowser.#onSetFilter.call(this, event, event.target);
  }

  /* -------------------------------------------- */

  /**
   * Handle dragging an entry.
   * @param {DragEvent} event  The drag event.
   * @protected
   */
  _onDragStart(event) {
    const card = event.target.closest(".grid-card");
    const { uuid } = card.dataset ?? {};
    if (card.draggable) return;
    try {
      const { type } = foundry.utils.parseUuid(uuid);
      event.dataTransfer.setData("text/plain", JSON.stringify({ type, uuid }));
    } catch (e) {
      console.error(e);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle triggering an action via keyboard.
   * @param {KeyboardEvent} event  The originating event.
   * @protected
   */
  _onKeyAction(event) {
    const target = event.target.closest("[data-action]");
    if (event.key !== " " || !target) return;
    const { action } = target.dataset;
    const handler = this.options.actions[action];
    if (handler) handler.call(this, event, target);
  }

  /* -------------------------------------------- */

  /**
   * Handle rendering a new batch of results when the user scrolls to the bottom of the list.
   * @param {Event} event  The originating scroll event.
   * @protected
   */
  async _onScrollResults(event) {
    if (
      this.#renderThrottle ||
      !event.target.matches('[data-application-part="results"]')
    )
      return;
    if (
      this.#results instanceof Promise ||
      this.#resultIndex >= this.#results.length
    )
      return;
    const { scrollTop, scrollHeight, clientHeight } = event.target;
    if (
      scrollTop + clientHeight <
      scrollHeight - this.constructor.BATCHING.MARGIN
    )
      return;
    this.#renderThrottle = true;
    const { documentClass } = this.currentFilters;
    const rendered = [];
    const batchStart = this.#resultIndex;
    const batchEnd = Math.min(
      batchStart + this.constructor.BATCHING.SIZE,
      this.#results.length,
    );
    for (let i = batchStart; i < batchEnd; i++) {
      rendered.push(this._renderResult(this.#results[i], documentClass));
    }
    this.element
      .querySelector('[data-application-part="results"] .item-list')
      .append(...(await Promise.all(rendered)));
    this.#resultIndex = batchEnd;
    this.#renderThrottle = false;
  }

  /* -------------------------------------------- */

  /**
   * Handle searching for a Document by name.
   * @param {KeyboardEvent} event  The triggering event.
   * @protected
   */
  _onSearchName(event) {
    if (!event.target.matches("search > input")) return;
    this.#filters.name = event.target.value;
    this.render({ parts: ["results"] });
  }

  /* -------------------------------------------- */

  /**
   * Handle clearing the name filter.
   * @this CompendiumBrowser
   * @type {ApplicationClickAction}
   */
  static async #onClearName(event, target) {
    const input = target.closest("search").querySelector(":scope > input");
    input.value = this.#filters.name = "";
    this.render({ parts: ["results"] });
  }

  /* -------------------------------------------- */

  /**
   * Handle opening a link to an item.
   * @this {CompendiumBrowser}
   * @type {ApplicationClickAction}
   */
  static async #onClickEntry(event, target) {
    const isContextMenu = event.button === 2;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const doc = await fromUuid(uuid);

    if (!doc) return;

    if (isContextMenu) {
      if (doc.documentName === "Scene") {
        return new ImagePopout(doc.texture.src, {
          title: doc.name,
          uuid: doc.uuid,
        }).render(true);
      } else {
        return doc.compenidum.render(true);
      }
    }

    return doc.sheet.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle setting the document class or a filter.
   * @this {CompendiumBrowser}
   * @type {ApplicationClickAction}
   */
  static async #onSetFilter(event, target) {
    const name = target.name;
    const value = target.value;
    const existingValue = foundry.utils.getProperty(this.#filters, name);
    if (value === existingValue) return;
    foundry.utils.setProperty(
      this.#filters,
      name,
      value === "" ? undefined : value,
    );

    if (target.tagName === "BUTTON")
      for (const button of this.element.querySelectorAll(`[name="${name}"]`)) {
        button.ariaPressed = button.value === value;
      }

    this.render({ parts: ["results"] });
  }

  /* -------------------------------------------- */

  /**
   * Handle setting a type restriction.
   * @this {CompendiumBrowser}
   * @type {ApplicationClickAction}
   */
  static async #onSetType(event, target) {
    this.#filters.types ??= new Set();
    const typeValue = target.value;

    if (target.checked) {
      this.#filters.types.add(typeValue);
    } else {
      this.#filters.types.delete(typeValue);
    }

    target.closest(".type-tag")?.classList.toggle("active", target.checked);

    this.render({ parts: ["filters", "results"] });
  }

  /**
   * Handle setting a type restriction.
   * @this {CompendiumBrowser}
   * @type {ApplicationClickAction}
   */
  static async #onSetSource(event, target) {
    const sourceId = target.dataset.source;
    this.#filters.types ??= new Set();
    if (!sourceId) return;

    if (target.checked) this.#sources.add(sourceId);
    else this.#sources.delete(sourceId);

    this.render({ parts: ["filters", "results", "sources", "types"] });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the collapsed state of a collapsible section.
   * @this {CompendiumBrowser}
   * @type {ApplicationClickAction}
   */
  static async #onToggleCollapse(_event, target) {
    const collapsible = target.closest(".collapsible");
    if (!collapsible) return;

    collapsible.classList.toggle("collapsed");

    const counters = collapsible.querySelector(".filter-counters");
    if (!counters) return;

    const values = Object.values(
      this.#filters.additional?.[collapsible.dataset.filterId] ?? {},
    );

    const posCount = values.filter((v) => v === 1).length;
    const negCount = values.filter((v) => v === -1).length;

    counters.innerHTML = `
    ${posCount ? `<span class="count pos">${posCount}</span>` : ""}
    ${negCount ? `<span class="count neg">${negCount}</span>` : ""}
  `;
  }

  /* -------------------------------------------- */

  /**
   * @type {ApplicationClickAction}
   * @this CompendiumBrowser
   */
  static #onToggleHeader(_event, target) {
    this._headerCollapsed = target
      .closest(".collapsible-filters")
      .classList.toggle("collapsed");
    this.render({ parts: ["filters", "types", "sources"] });
  }

  /* -------------------------------------------- */

  /**
   * @type {ApplicationClickAction}
   * @this CompendiumBrowser
   */
  static #onToggleLogic(event, target) {
    const key = target.dataset.filter;
    const type = target.dataset.logicType;

    this.#filters.operators ??= {};
    this.#filters.operators[key] ??= { pos: "AND", neg: "OR" };

    const current = this.#filters.operators[key][type];
    this.#filters.operators[key][type] = current === "AND" ? "OR" : "AND";

    this.render({ parts: ["filters", "results"] });
  }

  /* -------------------------------------------- */
  /*  Database Access                             */
  /* -------------------------------------------- */

  /**
   * Retrieve a listing of documents from all compendiums for a specific Document type, with additional filters
   * optionally applied.
   * @param {typeof Document} documentClass  Document type to fetch (e.g. Actor or Item).
   * @param {object} [options={}]
   * @param {Set<string>} [options.types]    Individual document subtypes to filter upon (e.g. "loot", "class", "npc").
   * @param {FilterDescription[]} [options.filters]  Filters to provide further filters.
   * @param {boolean} [options.index=true]   Should only the index for each document be returned, or the whole thing?
   * @param {Set<string>} [options.indexFields]  Key paths for fields to index.
   * @param {boolean|string|Function} [options.sort=true]  Should the contents be sorted? By default sorting will be
   *                                         performed using document names, but a key path can be provided to sort on
   *                                         a specific property or a function to provide more advanced sorting.
   * @returns {object[]|Document[]}
   */
  static async fetch(
    documentClass,
    {
      types = new Set(),
      filters = [],
      index = true,
      indexFields = new Set(),
      sort = true,
      sources = new Set(),
    } = {},
  ) {
    // Nothing within containers should be shown
    filters.push({ k: "system.container", o: "in", v: [null, undefined] });

    // If filters are provided, merge their keys with any other fields needing to be indexed
    if (filters.length)
      indexFields = indexFields.union(dnd5e.Filter.uniqueKeys(filters));

    // Ensure folder is always indexed
    if (!indexFields.has("folder")) indexFields.add("folder");

    const rankNames = getRankFolderNames() ?? [];

    // Iterate over all packs
    /** @type {Promise<Document[]>}*/
    let documents = game.packs
      .filter((p) => {
        // Skip packs that have the wrong document class
        const isCorrectType = p.metadata.type === documentClass.metadata.name;

        // Do not show entries inside compendia that are not visible to the current user.
        const isVisible = p.visible;

        //const matchesSource = !sources?.size || sources.has(p.metadata.id);
        const matchesSource = !sources?.size
          ? false
          : sources.has(p.metadata.id);

        // If types are set and specified in compendium flag, only include those that include the correct types
        const matchesTypes =
          !types.size ||
          !p.metadata.flags.dnd5e?.types ||
          new Set(p.metadata.flags.dnd5e.types).intersects(types);

        return isCorrectType && isVisible && matchesSource && matchesTypes;
      })
      .map(async (p) => {
        const allowedFolderIds = new Set(
          rankNames.flatMap((name) => {
            const parent = p.folders.getName(name);
            return parent
              ? [parent, ...getSubfoldersInCompenidum(parent)].map((f) => f.id)
              : [];
          }),
        );

        // Fetch the index
        /**@type {foundry.utils.Collection} */
        let packIndex = await p.getIndex({ fields: Array.from(indexFields) });
        // Apply module art to the new index
        packIndex = game.dnd5e.moduleArt.apply(packIndex);

        const filteredIndex = packIndex.filter((i) => {
          // Remove any documents that don't match the specified types or the provided filters
          const matchesType = !types.size || types.has(i.type);

          if (i.type === "spell") {
            const uuids =
              foundry.utils.getProperty(
                i,
                `flags.${MODULE_ID}.${ITEM_FLAGS.SPELL_CLASSES}`,
              ) || [];

            i._classIdentifiers = uuids.map((uuid) =>
              CompendiumBrowser.#identifierMap.get(uuid),
            );
            const levelFilter = filters.find(f => f.k === "system.level");
            if(levelFilter)levelFilter.v.map(s => parseInt(s));
          }
          const matchesFilters =
            !filters.length || dnd5e.Filter.performCheck(i, filters);

          // Always allow if GM or if item has no folder. Otherwise, check if folder is in the allowed set.
          const matchesFolder =
            game.user.isGM || !i.folder || allowedFolderIds?.has(i.folder);

          return matchesType && matchesFilters && matchesFolder;
        });

        return index
          ? filteredIndex
          : await Promise.all(filteredIndex.map((i) => fromUuid(i.uuid)));
      });

    // Wait for everything to finish loading and flatten the arrays
    documents = (await Promise.all(documents)).flat();

    if (sort) {
      if (sort === true) sort = "name";
      const sortFunc =
        foundry.utils.getType(sort) === "function"
          ? sort
          : (lhs, rhs) => {
              return String(foundry.utils.getProperty(lhs, sort)).localeCompare(
                String(foundry.utils.getProperty(rhs, sort)),
              );
            };
      documents.sort(sortFunc);
    }

    return documents;
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Transform filter definition and additional filters values into the final filters to apply.
   * @param {CompendiumBrowserFilterDefinition} definition  Filter definition provided by type.
   * @param {object} values                                 Values of currently selected filters.
   * @returns {FilterDescription[]}
   */
  static applyFilters(definition, values) {
    const filters = [];
    const operators = values?.operators ?? {};

    for (const [key, value] of Object.entries(values ?? {})) {
      if (key === "operators") continue;
      const def = definition.get(key);
      if (!def) continue;
      if (foundry.utils.getType(def.createFilter) === "function") {
        def.createFilter(filters, value, def, key, operators);
        continue;
      }
      switch (def.type) {
        case "boolean":
          if (value) filters.push({ k: def.config.keyPath, v: value === 1 });
          break;
        case "range":
          const min = Number(value.min);
          const max = Number(value.max);
          if (Number.isFinite(min))
            filters.push({ k: def.config.keyPath, o: "gte", v: min });
          if (Number.isFinite(max))
            filters.push({ k: def.config.keyPath, o: "lte", v: max });
          break;
        case "set":
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
              v: positive,
            });
          }
          if (negative.length) {
            const negOp = opCfg.pos === "OR" ? "hasany" : "hasall";
            filters.push({
              o: "NOT",
              v: {
                k: def.config.keyPath,
                o: def.config.multiple ? negOp : "in",
                v: negative,
              },
            });
          }
          break;
        default:
          console.warn(`Filter type ${def.type} not handled.`);
          break;
      }
    }
    return filters;
  }

  /* -------------------------------------------- */

  /**
   * Inject the compendium browser button into the compendium sidebar.
   * @param {HTMLElement} html  HTML of the sidebar being rendered.
   */
  static injectSidebarButton(html) {
    if (game.release.generation < 12) return;
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("open-compendium-browser");
    button.innerHTML = `
      <i class="fa-solid fa-book-open-reader" inert></i>
      ${game.i18n.localize("DND5E.CompendiumBrowser.Action.Open")}
    `;
    button.addEventListener("click", (event) =>
      new CompendiumBrowser().render({ force: true }),
    );

    const headerActions = html.querySelector(".header-actions");
    headerActions.append(button);
  }

  /* -------------------------------------------- */

  /**
   * Take two filter sets and find only the filters that match between the two.
   * @param {CompendiumBrowserFilterDefinition} first
   * @param {CompendiumBrowserFilterDefinition>} second
   * @returns {CompendiumBrowserFilterDefinition}
   */
  static intersectFilters(first, second) {
    const final = new Map();

    // Iterate over all keys in first map
    for (const [key, firstConfig] of first.entries()) {
      const secondConfig = second.get(key);
      if (firstConfig.type !== secondConfig?.type) continue;
      const finalConfig = foundry.utils.deepClone(firstConfig);

      switch (firstConfig.type) {
        case "range":
          if ("min" in firstConfig.config || "min" in secondConfig.config) {
            if (
              !("min" in firstConfig.config) ||
              !("min" in secondConfig.config)
            )
              continue;
            finalConfig.config.min = Math.max(
              firstConfig.config.min,
              secondConfig.config.min,
            );
          }
          if ("max" in firstConfig.config || "max" in secondConfig.config) {
            if (
              !("max" in firstConfig.config) ||
              !("max" in secondConfig.config)
            )
              continue;
            finalConfig.config.max = Math.min(
              firstConfig.config.max,
              secondConfig.config.max,
            );
          }
          if (
            "min" in finalConfig.config &&
            "max" in finalConfig.config &&
            finalConfig.config.min > finalConfig.config.max
          )
            continue;
          break;
        case "set":
          Object.keys(finalConfig.config.choices).forEach((k) => {
            if (!(k in secondConfig.config.choices))
              delete finalConfig.config.choices[k];
          });
          if (foundry.utils.isEmpty(finalConfig.config.choices)) continue;
          break;
      }

      final.set(key, finalConfig);
    }
    return final;
  }
}
