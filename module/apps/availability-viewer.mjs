import { USER_ROLE_NAMES } from "../../foundry/resources/app/common/constants.mjs";
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
 */

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
    position: { width: 1000, height: 600 },
    actions: {
      toggleGraphType: AvailabilityViewer.#onToggleGraphType,
      toggleUsersPool: AvailabilityViewer.#onToggleUsersPool,
      toggleGranularity: AvailabilityViewer.#onToggleGranularity,
      openFilterMenu: AvailabilityViewer.#onOpenFilterMenu,
      openLoginTracker: AvailabilityViewer.#onOpenLoginTracker,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/availability-viewer/body.hbs`,
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
  

  /** @inheritdoc */
  setPosition(position) {
    super.setPosition(position);
    if (this.chart) this.chart.resize();
  }

  /**@inheritdoc */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    /** @type {HTMLElement} */
    const oldLayout = priorElement.querySelector(".content-layout");
    const newLayout = newElement.querySelector(".content-layout");
    if (oldLayout && newLayout) {
      const sidebarOpen = oldLayout.classList.contains("active");
      newLayout.classList.toggle("active", sidebarOpen);
    }
  }

  /**
   * @inheritdoc
   * @param {ApplicationRenderOptions} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      state: this.#filterStates,
      isGM: game.user.isGM,
      drillDown: this.#drillDownData,
      timeZoneDistribution: this._getTimeZoneDistribution(),
    };
  }

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
      const flag = user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE);
      const k = flag ? `UTC${flag}` : "Unknown";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(count)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** @inheritdoc*/
  _onRender(context, options) {
    super._onRender(context, options);
    const element = this.element;

    element
      .querySelectorAll('.comparison-grid input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
          const type = event.target.dataset.type;
          this.#filterStates.comparison[type] = event.target.checked;
          this.render();
        });
      });

    /**@type {HTMLCanvasElement } */
    const canvas = element.querySelector(".analytics-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");

      if (this.#chart) this.#chart.destroy();

      this.#chart = new Chart(ctx, {
        type: this.#filterStates.type,
        data: this._getChartData(),
        options: {
          responsive: true,
          maintainAspectRatio: false,
          elements: {
            line: {
              tension: 0.33,
            },
          },
          onClick: (event, elements) => this._handleDrillDown(elements),
          plugins: {
            tooltip: {
              backgroundColor: "#161b22",
              titleColor: "#d0d7de",
              bodyColor: "#8b949e",
              borderColor: "rgba(56, 139, 253, 0.4)",
              borderWidth: 1,
              cornerRadius: 4,
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
              ticks: { color: "#ffffff", font: { size: 11 } },
            },
          },
        },
      });
    }
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

  /**
   * Logic for Drill-Down (Clicking a bar)
   * Consolidates categories into a single entry per user.
   * @param {object[]} elements The active chart elements clicked.
   */
  async _handleDrillDown(elements) {
    if (elements.length === 0) {
      const contentLayout = this.element.querySelector(".content-layout");
      contentLayout?.classList.remove("active");
      await waitForTransition(contentLayout);
      this.#drillDownData = null;
      this.render();
      return;
    }

    const targetIndex = elements[0].index;
    const abrr = this.chart.data.labels[targetIndex];
    const label =
      AvailabilityViewer.DAYS_LABELS.find((d) => d.abrr === abrr)?.name ?? abrr;

    const { days, hours } = this.#filterStates.selections;
    const activeDays = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
    const activeHours =
      hours?.length > 0 ? hours : Array.from({ length: 24 }, (_, i) => i);

    let targetDayIdx;
    let targetHour;

    if (this.isDaily) {
      targetDayIdx = activeDays[targetIndex];
    } else {
      targetDayIdx = activeDays[Math.floor(targetIndex / activeHours.length)];
      targetHour = activeHours[targetIndex % activeHours.length];
    }

    const userResultsMap = new Map();

    for (const [category, userMap] of Object.entries(this.#indexMap)) {
      if (!(userMap instanceof Map)) continue;

      for (const [userId, bitArray] of userMap.entries()) {
        if (bitArray[targetIndex] === 1) {
          if (!userResultsMap.has(userId)) {
            const user = game.users.get(userId);
            userResultsMap.set(userId, {
              name: user.name,
              color: user.color,
              role: user.isGM ? "GM" : "Player",
              categories: {},
              timeZone: user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE),
            });
          }

          // Add the category data to the existing user entry
          const entry = userResultsMap.get(userId);
          const user = game.users.get(userId);

          const rawBits = category.includes("Rec")
            ? this._getLoginRecordBitArray(user)
            : this._getAvailabilityBitArray(user);

          const matchedHours = [];
          if (this.isDaily) {
            const dayOffset = targetDayIdx * 24;
            for (const h of activeHours) {
              if (rawBits[dayOffset + h] === 1) {
                matchedHours.push(`${h.toString().padStart(2, "0")}:00`);
              }
            }
          } else {
            matchedHours.push(`${targetHour.toString().padStart(2, "0")}:00`);
          }

          entry.categories[category] = {
            active: true,
            label: category.includes("Rec") ? "History" : "Availability",
            hours: matchedHours,
          };
        }
      }
    }

    this.#drillDownData = {
      title: label,
      users: Array.from(userResultsMap.values()),
    };

    await this.render();
    this.element.querySelector(".content-layout")?.classList.add("active");
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
        stack: "Stack 0",
      },
      gmAvail: {
        label: "GM Avail.",
        color: "rgb(63, 185, 80)",
        stack: "Stack 0",
      },
      playerRec: {
        label: "Player Record",
        color: "rgb(34, 58, 100)",
        stack: "Stack 1",
      },
      gmRec: {
        label: "GM Record",
        color: "rgb(34, 100, 43)",
        stack: "Stack 1",
      },
    };

    const isLine =
      this.#filterStates.type === AvailabilityViewer.GRAPH_TYPES.LINE;

    return Object.entries(configs)
      .map(([key, cfg]) => ({
        label: cfg.label,
        data: series[key],
        backgroundColor: cfg.color,
        borderColor: cfg.color,
        borderWidth: 2,
        fill: false,
        pointRadius: isLine ? 3 : 0,
        stack: isLine ? undefined : cfg.stack,
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

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onToggleGraphType(_event) {
    const { BAR, LINE } = AvailabilityViewer.GRAPH_TYPES;
    this.#filterStates.type = this.#filterStates.type === BAR ? LINE : BAR;
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onToggleGranularity(_event) {
    const { DAILY, HOURLY } = AvailabilityViewer.GRANULARITY;
    this.#filterStates.granularity = this.isDaily ? HOURLY : DAILY;
    this.render();
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityViewer
   */
  static #onToggleUsersPool() {
    this.#filterStates.onlyActive = !this.#filterStates.onlyActive;
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
   * @this AvailabilityTracker
   */
  static #onOpenLoginTracker() {
    const app = ui["tcr-main-module.LoginTracker"];
    if (app.rendered) app.bringToFront();
    else app.render({ force: true });
  }
}
