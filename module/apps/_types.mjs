/**
 * @typedef ApplicationTabsConfiguration
 * @property {{id: string; icon?: string; label?: string; tooltip?: string, cssClass?: string}[]} tabs
 *                                  An array of tab configuration data
 * @property {string} [initial]     The tab in this group that will be active on first render
 * @property {string} [labelPrefix] A localization path prefix for all tabs in the group: if set, a label is generated
 *                                  for each tab using a full path of `${labelPrefix}.${tabId}`.
 */
