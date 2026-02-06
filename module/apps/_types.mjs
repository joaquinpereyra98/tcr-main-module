/**
 * @import { ApplicationConfiguration } from "../../foundry/resources/app/common/config.mjs"
 */

/**
 * @typedef ApplicationTabsConfiguration
 * @property {{id: string; icon?: string; label?: string; tooltip?: string, cssClass?: string}[]} tabs - An array of tab configuration data
 * @property {string} [initial] - The tab in this group that will be active on first render
 * @property {string} [labelPrefix] - A localization path prefix for all tabs in the group: if set, a label is generated
 *                                  for each tab using a full path of `${labelPrefix}.${tabId}`.
 */
/**
 * @typedef {object} CompendiumBrowserFilters
 * @property {string} [documentClass] - Document type to fetch (e.g., "Actor" or "Item").
 * @property {Set<string>} [types] - Individual document subtypes to filter upon (e.g., "loot", "class").
 * @property {Record<string, unknown>} [additional] - Additional type-specific filters applied.
 * @property {string} [name] - A substring to filter by Document name.
 */

/**
 * @typedef {object} CompendiumBrowserFilterState
 * @property {CompendiumBrowserFilters} locked - Filters that are locked and cannot be changed by the user.
 * @property {CompendiumBrowserFilters} initial - Filters applied at startup that the user can modify.
 */


/**
 * Filter definition object for additional filters in the Compendium Browser.
 * @typedef {object} CompendiumBrowserFilterDefinitionEntry
 * @property {string} label - Localizable label for the filter.
 * @property {"boolean"|"range"|"set"} type - Type of filter control to display.
 * @property {object} config - Type-specific configuration data.
 * @property {CompendiumBrowserFilterCreateFilters} [createFilter] - Method that can be called to create filters.
 */

/**
 * A filter description.
 *
 * @typedef FilterDescription
 * @property {string} k        Key on the data object to check.
 * @property {any} v           Value to compare.
 * @property {string} [o="_"]  Operator or comparison function to use.
 */

/**
 * @callback CompendiumBrowserFilterCreateFilters
 * @param {FilterDescription[]} filters - Array of filters to be applied that should be mutated.
 * @param {*} value - Value of the filter.
 * @param {CompendiumBrowserFilterDefinitionEntry} definition - Definition for this filter.
 */

/**
 * @typedef {Map<string, CompendiumBrowserFilterDefinitionEntry>} CompendiumBrowserFilterDefinition
 */

/**
 * @callback PartContextPreparer
 * @param {string} partId - The part being rendered.
 * @param {ApplicationRenderContext} context - Shared context provided by _prepareContext.
 * @param {HandlebarsRenderOptions} options - Options which configure application rendering behavior.
 * @returns {Promise<ApplicationRenderContext>} - Context data for a specific part.
 */

/**
 * @typedef {ApplicationConfiguration} CompendiumBrowserConfiguration
 * @property {CompendiumBrowserFilterState} filters - Filter state configuration for the browser
 * @property {object} sources - Source configuration
 * @property {string[]} sources.locked - Sources that cannot be toggled
 * @property {string[]} sources.initial - Initial source selection
 * @property {boolean} hiddenSubtitle - Whether to hide the entries subtitles
 * @property {boolean} hideOnLock - Hide filters when locked
 */
