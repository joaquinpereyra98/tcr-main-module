import {
  AVAILABILITY_VIEWER_KEY,
  MODULE_ID,
  USER_FLAGS,
} from "../constants.mjs";
import LoginTracker from "../settings/login-tracker.mjs";
import { waitForTransition } from "../utils.mjs";
import AvailabilityTracker from "./availability-tracker.mjs";
import HTMLSearchableMultiCheckboxElement from "./elements/searchable-multi-select.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import { ApplicationClickAction, ApplicationConfiguration, ApplicationRenderOptions } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { User } from "../../foundry/resources/app/dist/database/database.mjs"
 *
 * @typedef {Object} TimeZoneDistribution
 * @property {string} label - The time zone label (e.g., "UTC+5", "UTC-3", "Unknown")
 * @property {number} count - The number of users in this time zone
 * @property {Array<User>} users - Array of user objects in this time zone
 */

/**
 * @typedef {Object} DrillDownCategory
 * @property {boolean} active - Whether the category is active for this user.
 * @property {string} label - The display label (e.g., "History" or "Availability").
 * @property {string[]} hours - Formatted hour strings or ranges.
 */

/**
 * @typedef {Object} DrillDownUser
 * @property {string} name - The user's display name.
 * @property {string} color - The hex color code associated with the user.
 * @property {("GM"|"Player")} role - The user's role in the session.
 * @property {string|null} timeZone - The formatted time zone string (e.g., "+2").
 * @property {Object.<string, DrillDownCategory>} categories - Data keyed by category ID.
 */

/**
 * @typedef {Object} DrillDownData
 * @property {string} title - The name of the day or time slot.
 * @property {DrillDownUser[]} users - List of users matching the drill-down criteria.
 */

const VIEWER_TEMPLATE_PATH = `modules/${MODULE_ID}/templates/availability-viewer`;

/**
 * An application that displays a the player availability schedules.
 * @extends {ApplicationV2}
 * @mixes HandlebarsApplicationMixin
 */
export default class AvailabilityViewer extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-availability-viewer`,
    classes: [MODULE_ID, "availability-viewer"],
    window: {
      icon: "fa-solid fa-chart-column",
      title: "Availability Viewer",
      resizable: true,
    },
    position: { width: 920, height: 600 },
    actions: {
      toggleGraphType: AvailabilityViewer.#onToggleGraphType,
      toggleUsersPool: AvailabilityViewer.#onToggleUsersPool,
      toggleGranularity: AvailabilityViewer.#onToggleGranularity,
      openFilterMenu: AvailabilityViewer.#onOpenFilterMenu,
      openLoginTracker: AvailabilityViewer.#onOpenLoginTracker,
      toggleSidebar: AvailabilityViewer.#onToggleSidebar,
      showTimezoneUsers: AvailabilityViewer.#onShowTimezoneUsers,
    },
  };

  /** @override */
  static PARTS = {
    main: {
      template: `${VIEWER_TEMPLATE_PATH}/main.hbs`,
    },
    sidebar: {
      template: `${VIEWER_TEMPLATE_PATH}/sidebar.hbs`,
      scrollable: [""],
    },
  };

  static GRAPH_TYPES = Object.freeze({
    BAR: "bar",
    LINE: "line",
  });

  static GRANULARITY = Object.freeze({
    DAILY: "daily",
    HOURLY: "hourly",
  });

  /**
   * Check if the current granularity state is set to daily.
   * @type {boolean}
   */
  get isDaily() {
    return (
      this.#filterStates.granularity === AvailabilityViewer.GRANULARITY.DAILY
    );
  }

  static DAYS_LABELS = [
    {
      name: "Sunday",
      abrr: "Sun",
    },
    {
      name: "Monday",
      abrr: "Mon",
    },
    {
      name: "Tuesday",
      abrr: "Tue",
    },
    {
      name: "Wednesday",
      abrr: "Wed",
    },
    {
      name: "Thursday",
      abrr: "Thu",
    },
    {
      name: "Friday",
      abrr: "Fri",
    },
    {
      name: "Saturday",
      abrr: "Sat",
    },
  ];

  /**
   * Helper method to render or bring to focus the singleton instance of this application.
   * @param {ApplicationRenderOptions} [options] Rendering options.
   * @returns {Promise<AvailabilityViewer>}
   */
  static async renderAvailabilityViewer(options = {}) {
    const sheet = ui[AVAILABILITY_VIEWER_KEY];
    options.force ??= true;
    await sheet.render(options);
    return sheet;
  }

  /**
   * Retrieves the raw availability flag from a user document.
   * @param {User} user
   * @returns {number[]|null} A 168-element array or null if invalid/missing.
   */
  static getAvailabilityFlag(user) {
    const flag = user.getFlag(MODULE_ID, USER_FLAGS.AVAILABILITY);
    if (!Array.isArray(flag) || flag.length !== 168) return null;
    return flag;
  }

  /**
   * Data for the drill-down sidebar.
   * @type {object|null}
   */
  #drillDownData = null;

  /**
   * Tracks what the sidebar is currently showing so it can be refreshed.
   * @type {{type: "chart"|"timezone"|"selection", value: any}|null}
   */
  #drillDownIndex = null;

  /**
   * The Chart.js instance.
   * @type {Chart|null}
   */
  #chart;

  /**
   * A getter to access the Chart.js instance.
   * @returns {Chart|null}
   */
  get chart() {
    return this.#chart;
  }

  /**
   * The internal filters state of the viewer application.
   * @type {object}
   */
  #filterStates = {
    type: AvailabilityViewer.GRAPH_TYPES.BAR,
    granularity: AvailabilityViewer.GRANULARITY.DAILY,

    comparison: {
      playerAvail: true,
      gmAvail: true,
      playerRec: false,
      gmRec: false,
    },

    onlyActive: true,
    recency: null,

    selections: {
      users: [],
      days: [],
      hours: [],
    },

    selectionRange: {
      xMin: null,
      xMax: null,
    },
  };

  /**
   * @type {{
   *   playerAvail: Map<string, number[]>,
   *   gmAvail: Map<string, number[]>,
   *   playerRec: Map<string, number[]>,
   *   gmRec: Map<string, number[]>,
   *   clear: function(): void
   * }}
   */
  #indexMap = {
    playerAvail: new Map(),
    gmAvail: new Map(),
    playerRec: new Map(),
    gmRec: new Map(),
    clear() {
      Object.values(this).forEach((v) => v instanceof Map && v.clear());
    },
  };

  #dragStartX = null;
  #isDragging = false;

  /** @inheritDoc */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);

    if (game.user.isGM) {
      const loginLabel = "Open Login Tracker";
      const loginBtn = `<button type="button" class="header-control fa-solid fa-calendar-clock" data-action="openLoginTracker"
                              data-tooltip="${loginLabel}" aria-label="${loginLabel}"></button>`;

      this.window.close.insertAdjacentHTML("beforebegin", loginBtn);
    }

    return frame;
  }

  /**@inheritdoc */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    /** @type {HTMLElement} */
    const oldSidebar = priorElement.querySelector(".sidebar-part");
    const newSidebar = newElement.querySelector(".sidebar-part");
    if (oldSidebar && newSidebar) {
      const sidebarOpen = oldSidebar.classList.contains("active");
      newSidebar.classList.toggle("active", sidebarOpen);
    }
  }

  /**
   * @inheritdoc
   * @param {ApplicationRenderOptions} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#refreshDrillDownData();

    return {
      ...context,
      state: this.#filterStates,
      comparisonLabels: {
        playerAvail: "Players Availability",
        gmAvail: "GM Availability",
        playerRec: "Login Players Record",
        gmRec: "Login GM Record",
      },
      isGM: game.user.isGM,
      drillDown: this.#drillDownData,
      timeZoneDistribution: this._getTimeZoneDistribution(),
    };
  }

  /**
   * Re-calculates the drillDownData based on the current sidebarContext.
   */
  #refreshDrillDownData() {
    if (!this.#drillDownIndex) {
      this.#drillDownData = null;
      return;
    }

    const { type, value } = this.#drillDownIndex;

    if (type === "timezone") {
      const distribution = this._getTimeZoneDistribution();
      const entry = distribution.find((d) => d.label === value);
      if (!entry) return;

      this.#drillDownData = {
        title: value,
        users: entry.users.map((u) => this._formatUserForDrilldown(u)),
      };
    } else if (type === "chart") {
      this.#drillDownData = this.#calculateBarDrillDown(value);
    }
  }

  /**
   * Helper to ensure user objects are always formatted the same way
   */
  _formatUserForDrilldown(user) {
    const flag = Number(user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE));
    return {
      name: user.name,
      color: user.color,
      role: user.isGM ? "GM" : "Player",
      timeZone: !Number.isNaN(flag) ? flag.signedString() : null,
    };
  }

  /**
   * Calculates the distribution of users by their time zone offsets.
   * @returns {Array<TimeZoneDistribution>}
   */
  _getTimeZoneDistribution() {
    const { onlyActive, selections } = this.#filterStates;

    const filteredUsers = this._getUsers({
      onlyActive,
      showGM: true,
      showPlayers: true,
    }).filter((u) => {
      const ids = selections.users;
      return !ids || !ids.length || ids.includes(u.id);
    });

    const count = filteredUsers.reduce((acc, user) => {
      const flag = Number(user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE));
      const k = !Number.isNaN(flag) ? `UTC${flag.signedString()}` : "Unknown";
      if (!acc[k]) acc[k] = [];
      acc[k].push(user);
      return acc;
    }, {});

    return Object.entries(count)
      .map(([label, users]) => ({
        label,
        count: users.length,
        users: users,
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** @inheritdoc*/
  _onRender(context, options) {
    super._onRender(context, options);

    this.element
      .querySelectorAll('.comparison-grid input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.addEventListener("change", async (event) => {
          const type = event.target.dataset.type;
          this.#filterStates.comparison[type] = event.target.checked;
          if (this.#drillDownIndex?.type === "selection") {
            const { startIndex, endIndex } = this.#drillDownIndex.value;
            this._getChartData();
            await this._filterAvailablePlayers(startIndex, endIndex);
          } else this.render();
        });
      });

    this.#createGraph();
  }

  #createGraph() {
    /**@type {HTMLCanvasElement } */
    const canvas = this.element.querySelector(".analytics-canvas");
    const ctx = canvas.getContext("2d");

    if (this.#chart) this.#chart.destroy();

    const { xMin, xMax } = this.#filterStates.selectionRange;

    this.#chart = new Chart(ctx, {
      type: this.#filterStates.type,
      data: this._getChartData(),
      plugins: [
        {
          id: "eventCatcher",
          beforeEvent: (chart, { event }) => {
            ({
              mousedown: this.#onMouseDownChart.bind(this),
              mousemove: this.#onMouseMoveChart.bind(this),
              mouseup: this.#onMouseUpChart.bind(this),
              click: this.#onClickChart.bind(this),
            })[event.type]?.(event, chart);
          },
        },
      ],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        events: ["click", "mousedown", "mouseup", "mousemove"],
        elements: {
          line: {
            tension: 0.33,
          },
        },
        plugins: {
          tooltip: {
            backgroundColor: "#161b22",
            titleColor: "#d0d7de",
            bodyColor: "#8b949e",
            borderColor: "rgba(56, 139, 253, 0.4)",
            borderWidth: 1,
            cornerRadius: 4,
          },
          annotation: {
            annotations: {
              box1: {
                type: "box",
                drawTime: "beforeDatasetsDraw",
                xMin: xMin !== null ? xMin - 0.5 : 0,
                xMax: xMax !== null ? xMax + 0.5 : 0,
                z: -5,
                display: xMin !== null,
                backgroundColor: "rgba(255, 0, 0, 0.2)",
                borderColor: "red",
                borderWidth: 1,
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: "rgba(56, 139, 253, 0.5)" },
            ticks: { color: "#ffffff", font: { size: 11 }, stepSize: 1 },
          },
          x: {
            grid: {
              color: "rgba(56, 139, 253, 0.5)",
              drawOnChartArea: false,
            },
            offset: true,
            ticks: { color: "#ffffff", font: { size: 11 } },
          },
        },
      },
    });
  }

  /**
   * Generic change handler for filter inputs that update the internal state.
   * @param {Event} event
   * @protected
   */
  _onChangeFilterInput(event) {
    const { name, value, dataset } = event.currentTarget;
    const finalValue =
      dataset.dtype === "Number"
        ? Array.isArray(value)
          ? value.map(Number)
          : Number(value)
        : value;
    foundry.utils.setProperty(this.#filterStates, name, finalValue);
    this.render();
  }

  /**
   * Filter the game users based on current participants state.
   * @param {object} [options]
   * @param {boolean} [options.onlyActive=false] - Filter by recent login threshold.
   * @param {boolean} [options.showGM=false] - Include GMs in the result.
   * @param {boolean} [options.showPlayers=false] - Include Players in the result.
   * @returns {User[]}.
   * @protected
   */
  _getUsers({ onlyActive = false, showGM = false, showPlayers = false } = {}) {
    const threshold = LoginTracker.INACTIVE_THRESHOLD_SETTING;
    const now = Date.now();

    return game.users.filter((u) => {
      const data = LoginTracker.getLoginData(u);
      const daysSince = (now - (data.lastLogin ?? 0)) / (24 * 60 * 60 * 1000);

      const isActive = daysSince <= threshold;
      const isRoleValid = (u.isGM && showGM) || (!u.isGM && showPlayers);

      return (!onlyActive || isActive) && isRoleValid;
    });
  }

  /**
   * Factory method to generate specific filter menu inputs for the tooltip menus.
   * @param {string} type The filter type identifier.
   * @returns {HTMLElement|void}
   * @protected
   */
  _renderFilterMenus(type) {
    let input;
    switch (type) {
      case "players":
        const { gmRec, gmAvail, playerRec, playerAvail } =
          this.#filterStates.comparison;
        input = HTMLSearchableMultiCheckboxElement.create({
          name: "selections.users",
          value: this.#filterStates.selections.users,
          options: this._getUsers({
            onlyActive: this.#filterStates.onlyActive,
            showGM: gmRec || gmAvail,
            showPlayers: playerRec || playerAvail,
          }).map((u) => ({
            value: u.id,
            label: u.name,
          })),
        });
        break;
      case "days":
        input = HTMLSearchableMultiCheckboxElement.create({
          name: "selections.days",
          value: this.#filterStates.selections.days,
          dataset: {
            dtype: "Number",
          },
          options: [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((d, i) => ({ value: i, label: d })),
        });
        break;
      case "timeLapse":
        input = HTMLSearchableMultiCheckboxElement.create({
          name: "selections.hours",
          classes: "double-grid",
          value: this.#filterStates.selections.hours,
          dataset: {
            dtype: "Number",
          },
          options: Array.from({ length: 24 }, (_, i) => ({
            value: i,
            label: `${i.toString().padStart(2, "0")}:00hs`,
          })),
        });
        break;
      case "recency":
        input = foundry.applications.fields.createNumberInput({
          name: "recency",
          dataset: {
            dtype: "Number",
          },
          value: Number(this.#filterStates.recency),
          min: 0,
          step: 1,
        });
        break;
    }

    if (input) {
      input.addEventListener("change", this._onChangeFilterInput.bind(this));
    }
    return input;
  }

  async _clearDrillDown() {
    const sidebar = this.element.querySelector(".sidebar-part");
    sidebar?.classList.remove("active");
    await waitForTransition(sidebar);
    this.#drillDownData = null;
    this.#drillDownIndex = null;
  }

  /**
   * Logic for Drill-Down (Clicking a bar)
   * @param {object[]} elements The active chart elements clicked.
   */
  async _handleDrillDown(elements) {
    if (elements.length === 0) {
      await this._clearDrillDown();
      return await this.render({ parts: ["sidebar"] });
    }

    const targetIndex = elements[0].index;

    this.#drillDownIndex = { type: "chart", value: targetIndex };

    this.#drillDownData = this.#calculateBarDrillDown(targetIndex);

    await this.render({ parts: ["sidebar"] });
    this.element.querySelector(".sidebar-part")?.classList.add("active");
  }

  /**
   * Clears the visual selection and state.
   */
  _clearSelection() {
    if (!this.chart) return;

    this.#filterStates.selectionRange.xMin = null;
    this.#filterStates.selectionRange.xMax = null;
    const annotation = this.chart.options.plugins.annotation.annotations.box1;
    annotation.xMin = null;
    annotation.xMax = null;
    annotation.display = false;

    this.chart.update("none");
  }

  /**
   * Filters players available during the selected range and updates the sidebar.
   * @param {number} startIndex
   * @param {number} endIndex
   * @protected
   */
  async _filterAvailablePlayers(startIndex, endIndex) {
    this.#filterStates.selectionRange.xMin = startIndex;
    this.#filterStates.selectionRange.xMax = endIndex;

    /**@type {Map<string, DrillDownUser & {rawCategoryData: {}}} */
    const mergedUsersMap = new Map();
    for (let i = startIndex; i <= endIndex; i++) {
      const { users } = this.#calculateBarDrillDown(i);

      for (const user of users) {
        if (!mergedUsersMap.has(user.name)) {
          mergedUsersMap.set(user.name, { ...user, rawCategoryData: {} });
        }

        const entry = mergedUsersMap.get(user.name);
        for (const [catKey, catData] of Object.entries(user.categories)) {
          if (!entry.rawCategoryData[catKey])
            entry.rawCategoryData[catKey] = new Set();

          catData.rawHours.forEach((h) => entry.rawCategoryData[catKey].add(h));
        }
      }
    }

    const availableUsers = Array.from(mergedUsersMap.values()).map((user) => {
      const finalCategories = {};

      for (const [catKey, hourSet] of Object.entries(user.rawCategoryData)) {
        const sortedHours = Array.from(hourSet).sort((a, b) => a - b);
        finalCategories[catKey] = {
          active: true,
          label: catKey.includes("Rec") ? "History" : "Availability",
          hours: this._formatHourRanges(sortedHours),
        };
      }

      delete user.rawCategoryData;
      user.categories = finalCategories;
      return user;
    });

    const labels = this.#getLabels();
    const startLabel = labels[startIndex] ?? "";
    const endLabel = labels[endIndex] ?? "";

    this.#drillDownIndex = {
      type: "selection",
      value: { startIndex, endIndex },
    };

    availableUsers.sort((a, b) => {
      if (a.isGM === b.isGM) return a.name.localeCompare(b.name);
      return a.isGM ? -1 : 1;
    });

    this.#drillDownData = {
      title: "Range Selection",
      subtitle:
        startIndex === endIndex ? startLabel : `${startLabel} to ${endLabel}`,
      users: availableUsers,
    };

    await this.render({ parts: ["main", "sidebar"] });
    this.element.querySelector(".sidebar-part")?.classList.add("active");
  }

  /**
   * Calculates drill-down data for a clicked chart bar
   * @param {Number} targetIndex
   * @returns {DrillDownData}
   */
  #calculateBarDrillDown(targetIndex) {
    const isDailyView = this.isDaily;

    const abrr = this.chart.data.labels[targetIndex];
    const label =
      AvailabilityViewer.DAYS_LABELS.find((d) => d.abrr === abrr)?.name ?? abrr;

    const { days, hours } = this.#filterStates.selections;
    const activeDays = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
    const activeHours = hours?.length
      ? hours
      : Array.from({ length: 24 }, (_, i) => i);

    let targetDayIdx, targetHour;

    if (isDailyView) {
      targetDayIdx = activeDays[targetIndex];
    } else {
      const hoursPerDay = activeHours.length;
      targetDayIdx = activeDays[Math.floor(targetIndex / hoursPerDay)];
      targetHour = activeHours[targetIndex % hoursPerDay];
    }

    const userResultsMap = new Map();

    const dayOffset = isDailyView ? targetDayIdx * 24 : null;
    const userCache = new Map();

    const formattedTargetHour = !isDailyView
      ? `${targetHour.toString().padStart(2, "0")}:00`
      : null;

    for (const [category, userMap] of Object.entries(this.#indexMap)) {
      if (!(userMap instanceof Map)) continue;

      const isRecCategory = category.includes("Rec");
      const categoryLabel = isRecCategory ? "History" : "Availability";

      for (const [userId, bitArray] of userMap.entries()) {
        if (bitArray[targetIndex] !== 1) continue;

        let entry = userResultsMap.get(userId);

        if (!entry) {
          let user = userCache.get(userId);
          if (!user) {
            user = game.users.get(userId);
            userCache.set(userId, user);
          }

          const flag = Number(user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE));
          entry = {
            name: user.name,
            color: user.color,
            role: user.isGM ? "GM" : "Player",
            categories: {},
            timeZone: !Number.isNaN(flag) ? flag.signedString() : null,
          };
          userResultsMap.set(userId, entry);
        }

        let matchedHours,
          rawHoursIndices = [];

        if (isDailyView) {
          const rawBits = isRecCategory
            ? this._getLoginRecordBitArray(userCache.get(userId))
            : this._getAvailabilityBitArray(userCache.get(userId));

          for (let i = 0; i < activeHours.length; i++) {
            const hour = activeHours[i];
            if (rawBits[dayOffset + hour] === 1) {
              rawHoursIndices.push(hour);
            }
          }
          matchedHours = this._formatHourRanges(rawHoursIndices);
        } else {
          matchedHours = [formattedTargetHour];
          rawHoursIndices = [targetHour];
        }

        entry.categories[category] = {
          active: true,
          label: categoryLabel,
          hours: matchedHours,
          rawHours: rawHoursIndices,
        };
      }
    }

    const usersArray = Array.from(userResultsMap.values());
    usersArray.sort((a, b) => {
      if (a.isGM === b.isGM) return a.name.localeCompare(b.name);
      return a.isGM ? -1 : 1;
    });

    return {
      title: label,
      users: usersArray,
    };
  }

  /**
   * Converts a list of hours into readable ranges.
   */
  _formatHourRanges(activeBits) {
    const ranges = [];
    const fmt = (h) => `${h.toString().padStart(2, "0")}:00`;
    let i = 0;
    while (i < activeBits.length) {
      let start = activeBits[i];
      let end = start;
      while (i + 1 < activeBits.length && activeBits[i + 1] === end + 1) {
        end = activeBits[i + 1];
        i++;
      }
      ranges.push(
        start === end ? fmt(start) : `${fmt(start)} - ${fmt(end + 1)}`,
      );
      i++;
    }
    return ranges;
  }

  /**
   * Generates labels for the X-axis based on current granularity.
   * @returns {string[]} - An array of strings for the chart axis.
   * @private
   */
  #getLabels() {
    const dayLabels = AvailabilityViewer.DAYS_LABELS.map((d) => d.abrr);

    const { days, hours } = this.#filterStates.selections;

    const activeDay =
      days.length > 0 ? days : Array.from({ length: 7 }, (_, i) => i);

    const activeHours =
      hours?.length > 0 ? hours : Array.from({ length: 24 }, (_, i) => i);

    if (this.isDaily) return activeDay.map((i) => dayLabels[i]);

    const labels = [];
    for (const d of activeDay) {
      for (const h of activeHours) {
        const hour = h.toString().padStart(2, "0");
        labels.push(`${dayLabels[d]} ${hour}:00`);
      }
    }
    return labels;
  }

  /**
   * Generates the Chart.js data object based on current modes and filters.
   * @returns {object} The data object for Chart.js.
   */
  _getChartData() {
    this.#indexMap.clear();

    const labels = this.#getLabels();
    const { onlyActive, comparison, selections } = this.#filterStates;

    const users = this._getUsers({
      onlyActive,
      showGM: true,
      showPlayers: true,
    }).filter((u) => {
      const ids = selections.users;
      if (!ids || !ids.length) return true;
      return ids.includes(u.id);
    });

    const { gmAvail, playerAvail, gmRec, playerRec } = this.#indexMap;

    for (const user of users) {
      const isGM = user.isGM;
      if ((isGM && comparison.gmAvail) || (!isGM && comparison.playerAvail)) {
        const bits = this._getAvailabilityBitArray(user);
        const target = isGM ? gmAvail : playerAvail;
        target.set(user.id, this.#calculateBits(bits));
      }
      if ((isGM && comparison.gmRec) || (!isGM && comparison.playerRec)) {
        const bits = this._getLoginRecordBitArray(user);
        const target = isGM ? gmRec : playerRec;
        target.set(user.id, this.#calculateBits(bits));
      }
    }

    const series = {
      playerAvail: Array(labels.length).fill(0),
      gmAvail: Array(labels.length).fill(0),
      playerRec: Array(labels.length).fill(0),
      gmRec: Array(labels.length).fill(0),
    };

    for (const [key, map] of Object.entries(this.#indexMap)) {
      if (!(map instanceof Map)) continue;
      for (const userArray of map.values()) {
        userArray.forEach((val, i) => {
          if (i < labels.length) series[key][i] += val;
        });
      }
    }

    return {
      labels,
      datasets: this.#buildDatasets(series),
    };
  }

  /**
   * Constructs the datasets array required by Chart.js.
   * @param {Record<string, number[]>} series The aggregated series data.
   * @returns {object[]}
   */
  #buildDatasets(series) {
    const configs = {
      playerAvail: {
        label: "Player Avail.",
        color: "rgb(63, 107, 185)",
      },
      gmAvail: {
        label: "GM Avail.",
        color: "rgb(63, 185, 80)",
      },
      playerRec: {
        label: "Player Record",
        color: "rgb(34, 58, 100)",
      },
      gmRec: {
        label: "GM Record",
        color: "rgb(34, 100, 43)",
      },
    };

    const isLine =
      this.#filterStates.type === AvailabilityViewer.GRAPH_TYPES.LINE;

    return Object.entries(configs)
      .map(([key, cfg]) => ({
        label: cfg.label,
        data: foundry.utils.duplicate(series[key]),
        backgroundColor: cfg.color,
        borderColor: cfg.color,
        borderWidth: 2,
        fill: false,
        pointRadius: isLine ? 3 : 0,
        hidden: !this.#filterStates.comparison[key],
      }))
      .filter((d) => !d.hidden);
  }

  /**
   * Aggregates a 168-bit array into a target series array based on current granularity.
   * @param {number[]} bits - 168-element array of states (0, 1, 2).
   * @return {number[]}.
   * @private
   */
  #calculateBits(bits) {
    const { days, hours } = this.#filterStates.selections;
    const activeDays = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
    const activeHours =
      hours?.length > 0 ? hours : Array.from({ length: 24 }, (_, i) => i);

    const targetSize = this.isDaily
      ? activeDays.length
      : activeDays.length * activeHours.length;
    const targetArray = Array(targetSize).fill(0);

    if (!bits || bits.length !== 168) return targetArray;

    if (this.isDaily) {
      activeDays.forEach((dayIdx, targetIdx) => {
        const dayOffset = dayIdx * 24;
        const hourMatches = activeHours.some((h) => bits[dayOffset + h] === 1);
        if (hourMatches) targetArray[targetIdx] = 1;
      });
    } else {
      let targetIdx = 0;
      for (const d of activeDays) {
        for (const h of activeHours) {
          const bitIdx = d * 24 + h;
          if (bits[bitIdx] === 1) {
            targetArray[targetIdx] = 1;
          }
          targetIdx++;
        }
      }
    }

    return targetArray;
  }

  /**
   * Retrieves and shifts a user's availability array based on the configured time zone.
   * @param {foundry.documents.BaseUser} user
   * @returns {number[]}
   * @protected
   */
  _getAvailabilityBitArray(user) {
    const flag = user.getFlag(MODULE_ID, USER_FLAGS.AVAILABILITY);
    return AvailabilityTracker.shiftAvailability(
      flag,
      AvailabilityTracker.timeZone,
    );
  }

  /**
   * Generates a 168-hour bit array indicating recent login activity for a user.
   * If the user has logged in within the `recency` period (in days), all 168 hours are marked as 1.
   * Otherwise, all hours are marked as 0.
   * @param {foundry.documents.User} user The user to check.
   * @returns {number[]} A 168-element array of 0s and 1s.
   * @protected
   */
  _getLoginRecordBitArray(user) {
    const bitArray = Array(168).fill(0);
    const loginData = LoginTracker.getLoginData(user);
    if (!loginData) return bitArray;

    const recencyDays = this.#filterStates.recency;
    const cutoff = recencyDays > 0 ? Date.now() - recencyDays * 86400000 : 0;

    for (const [dateString, hours] of Object.entries(loginData.history)) {
      const timestamp = new Date(dateString).getTime();
      if (timestamp < cutoff) continue;

      const dayOffset = new Date(dateString).getUTCDay() * 24;

      for (const h of hours) {
        bitArray[dayOffset + h] = 1;
      }
    }

    return AvailabilityTracker.shiftAvailability(
      bitArray,
      AvailabilityTracker.timeZone,
    );
  }

  #lastMouseIndex = null;

  /**
   * Updates the visual selection box on the chart.
   * @param {number} current - The current index under the cursor.
   * @private
   */
  #updateSelectionBox(current) {
    if (!this.chart) return;

    if (current === this.#lastMouseIndex) return;
    this.#lastMouseIndex = current;

    const xMin = Math.min(this.#dragStartX, current);
    const xMax = Math.max(this.#dragStartX, current);

    const annotation = this.chart.options.plugins.annotation.annotations.box1;

    annotation.xMin = xMin - 0.5;
    annotation.xMax = xMax + 0.5;
    annotation.display = true;

    this.chart.update("none");
  }

  /**
   * @param {MouseEvent} event
   * @param {Chart} chart
   */
  #onMouseDownChart(event, chart) {
    if (!event.native.shiftKey) return;
    const elements = chart.getElementsAtEventForMode(
      event,
      "index",
      { intersect: false },
      false,
    );
    if (!elements.length) return;

    this.#dragStartX = elements[0].index;
    this.#isDragging = true;
  }

  /**
   * @param {MouseEvent} event
   * @param {Chart} chart
   */
  #onMouseMoveChart(event, chart) {
    if (!this.#isDragging) return;

    const elements = chart.getElementsAtEventForMode(
      event,
      "index",
      { intersect: false },
      false,
    );
    if (elements.length) {
      this.#updateSelectionBox(elements[0].index);
    }
  }

  /**
   * @param {MouseEvent} event
   * @param {Chart} chart
   */
  #onMouseUpChart(event, chart) {
    if (!this.#isDragging) return;
    const annotation = chart.options.plugins.annotation.annotations.box1;

    this._filterAvailablePlayers(
      Math.ceil(annotation.xMin),
      Math.floor(annotation.xMax),
    );

    this.#isDragging = false;
    this.#dragStartX = null;
    this.#lastMouseIndex = null;
  }

  #onClickChart(event, chart) {
    if (event.native.shiftKey) return;
    const elements = chart.getElementsAtEventForMode(
      event,
      "index",
      { intersect: false },
      false,
    );

    this._clearSelection();
    return this._handleDrillDown(elements);
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static async #onToggleGraphType(_event) {
    const { BAR, LINE } = AvailabilityViewer.GRAPH_TYPES;
    this.#filterStates.type = this.#filterStates.type === BAR ? LINE : BAR;
    await this._clearDrillDown();
    this._clearSelection();
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static async #onToggleGranularity(_event) {
    const { DAILY, HOURLY } = AvailabilityViewer.GRANULARITY;
    this.#filterStates.granularity = this.isDaily ? HOURLY : DAILY;
    await this._clearDrillDown();
    this._clearSelection();
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static async #onToggleUsersPool() {
    this.#filterStates.onlyActive = !this.#filterStates.onlyActive;
    await this._clearDrillDown();
    this._clearSelection();
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onOpenFilterMenu(_event, target) {
    const { filter } = target.dataset ?? {};

    const html = this._renderFilterMenus(filter);
    if (!html) return;

    game.tooltip.activate(target, {
      content: html,
      direction: TooltipManager.TOOLTIP_DIRECTIONS.DOWN,
      locked: true,
      cssClass: `${MODULE_ID} filter-menu`,
    });
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onOpenLoginTracker() {
    const app = ui["tcr-main-module.LoginTracker"];
    if (app.rendered) app.bringToFront();
    else app.render({ force: true });
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onToggleSidebar() {
    this.element.querySelector(".sidebar-part")?.classList.remove("active");
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onShowTimezoneUsers(_event, target) {
    const label = target.dataset.label;
    const distribution = this._getTimeZoneDistribution();
    const entry = distribution.find((d) => d.label === label);
    if (!entry) return;

    this.#drillDownIndex = { type: "timezone", value: label };

    this.#drillDownData = {
      title: label,
      users: entry.users.map((u) => {
        const flag = Number(u.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE));
        return {
          name: u.name,
          color: u.color,
          role: u.isGM ? "GM" : "Player",
          timeZone: !Number.isNaN(flag) ? flag.signedString() : null,
        };
      }),
    };

    this.render({ parts: ["sidebar"] }).then(() => {
      this.element.querySelector(".sidebar-part")?.classList.add("active");
    });
  }
}
