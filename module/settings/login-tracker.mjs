import { MODULE_ID, USER_FLAGS, SETTINGS, LOGIN_TRACKER_KEY } from "../constants.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Application for tracking and displaying user login activity and session duration.
 * @extends {foundry.applications.api.ApplicationV2}
 * @mixes foundry.applications.api.HandlebarsApplicationMixin
 */
export default class LoginTracker extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: [MODULE_ID, "login-tracker"],
    window: {
      title: "Login Tracker",
      minimizable: true,
      resizable: true,
      icon: "fa-solid fa-calendar",
    },
    position: {
      height: 600,
      width: 580,
    },
    actions: {
      exportToText: LoginTracker.#onExportToText,
    },
  };

  /** @override */
  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/login-tracker/players.hbs`,
      scrollable: [""],
    },
    gamemasters: {
      template: `modules/${MODULE_ID}/templates/login-tracker/gamemasters.hbs`,
      scrollable: [""],
    },
  };

  /**
   * The interval in milliseconds for the heartbeat tracker.
   * @type {number}
   */
  static TIMER_INTERVAL = 300000;

  /**
   * Semantic status definitions for users.
   * @enum {{label: string, icon: string, color: string}}
   */
  static STATUSES = {
    UNKNOWN: {
      label: "Unknown",
      icon: "fa-solid fa-question",
      color: "#999",
    },
    NORMAL: {
      label: "Normal",
      icon: "fa-solid fa-circle-check",
      color: "#4b821e",
    },
    INACTIVE: {
      label: "Inactive",
      icon: "fa-solid fa-brake-warning",
      color: "#ff3333",
    },
  };

  /* -------------------------------------------- */
  /* Settings & Getters                          */
  /* -------------------------------------------- */

  /**
   * Register the module settings.
   */
  static registerSetting() {
    game.settings.register(MODULE_ID, SETTINGS.INACTIVE_THRESHOLD, {
      name: "Inactive Threshold (Days)",
      hint: "The number of days after which a user is considered 'Inactive'.",
      config: true,
      type: Number,
      scope: "world",
      change: () => ui[LOGIN_TRACKER_KEY]?.render(),
      default: 90,
    });
  }

  /**
   * Current threshold for inactivity in days.
   * @returns {number}
   */
  static get INACTIVE_THRESHOLD_SETTING() {
    return game.settings.get(MODULE_ID, SETTINGS.INACTIVE_THRESHOLD);
  }

  /* -------------------------------------------- */
  /* Logic & Tracking                            */
  /* -------------------------------------------- */

  /**
   * Initialize the tracker, start heartbeat, and update current session.
   */
  static initialize() {
    if (!game.user) return;
    this.updateLoginSession();
    setInterval(() => this.trackHeartbeat(), this.TIMER_INTERVAL);
  }

  /**
   * Update the user's last login timestamp.
   * @returns {Promise<User>}
   */
  static async updateLoginSession() {
    return game.user.setFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA, {
      lastLogin: Date.now(),
      timeConnected:
        game.user.getFlag(
          MODULE_ID,
          `${USER_FLAGS.LOGIN_DATA}.timeConnected`,
        ) ?? 0,
    });
  }

  /**
   * Increment the total connection time for the current user.
   * @returns {Promise<User>}
   */
  static async trackHeartbeat() {
    const current = game.user.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA) ?? {};
    const timeConnected = (current.timeConnected ?? 0) + this.TIMER_INTERVAL;

    await game.user.setFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA, {
      ...current,
      timeConnected,
    });
    ui.loginTracker?.render();

    return game.user;
  }

  /**
   * Format milliseconds into a readable "Xh Ym" string.
   * @param {number} ms - Milliseconds to format.
   * @returns {string}
   */
  static formatTimeConnected(ms) {
    if (!ms || ms < 0) return "0h 0m";
    const minutes = Math.floor(ms / 60000);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  /**
   * Get the status object based on the last login date.
   * @param {number|null} lastLogin - Timestamp of last login.
   * @returns {object}
   */
  static getUserStatus(lastLogin) {
    if (!lastLogin) return LoginTracker.STATUSES.UNKNOWN;
    const daysSince = (Date.now() - lastLogin) / (24 * 60 * 60 * 1000);
    return daysSince > LoginTracker.INACTIVE_THRESHOLD_SETTING
      ? LoginTracker.STATUSES.INACTIVE
      : LoginTracker.STATUSES.NORMAL;
  }

  /* -------------------------------------------- */
  /* Application Processing                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    return {
      ...(await super._prepareContext(options)),
      gms: this._prepareUsersData(game.users.filter((u) => u.isGM)),
      players: this._prepareUsersData(game.users.filter((u) => !u.isGM)),
    };
  }

  /**
   * Prepare user data for render.
   * @param {User[]} users
   * @returns {object[]}
   * @private
   */
  _prepareUsersData(users) {
    const lang = game.i18n.lang;

    const sortedUsers = [...users].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
  
      const dataA = a.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA)?.lastLogin ?? 0;
      const dataB = b.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA)?.lastLogin ?? 0;
      return dataB - dataA;
    });

    return sortedUsers.map((user) => {
      const { lastLogin = null, timeConnected = 0 } =
        user.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA) ?? {};

      let lastLoginData = { date: "—", time: "—" };
      let timeSinceLabel = "—";

      if (lastLogin) {
        const dateObj = new Date(lastLogin);
        lastLoginData = {
          date: dateObj.toLocaleDateString(lang, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          time: dateObj.toLocaleTimeString(lang, {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        timeSinceLabel = foundry.utils.timeSince(lastLogin);
      }

      return {
        user,
        lastLogin: lastLoginData,
        timeSinceLabel,
        timeConnected: LoginTracker.formatTimeConnected(timeConnected),
        hasData: !!lastLogin,
        status: LoginTracker.getUserStatus(lastLogin),
      };
    });
  }

  /**
   * @type {import("../../foundry/resources/app/client-esm/applications/_types.mjs").ApplicationClickAction}
   * @this {LoginTracker}
   */
  static #onExportToText(_event, target) {
    const { exportType } = target.dataset ?? {};
    const users = game.users.filter((u) =>
      exportType === "pc" ? !u.isGM : u.isGM,
    );
    const inactiveUsers = users.filter((user) => {
      const { lastLogin = null } =
        user.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA) ?? {};
      const status = LoginTracker.getUserStatus(lastLogin);
      return status === LoginTracker.STATUSES.INACTIVE;
    });

    if (inactiveUsers.length === 0) {
      return foundry.applications.api.DialogV2.prompt({
        content: "No inactive users found in this category.",
        rejectClose: false,
      });
    }

    const threshold = LoginTracker.INACTIVE_THRESHOLD_SETTING;

    let content = `Inactive ${exportType === "pc" ? "Players" : "GMs"} (Over ${threshold} days offline):\n`;
    content += "========================================\n";

    inactiveUsers.forEach((u) => {
      const data = u.getFlag(MODULE_ID, USER_FLAGS.LOGIN_DATA);
      const lastDate = data?.lastLogin
        ? new Date(data.lastLogin).toLocaleDateString()
        : "Never";
      content += `- ${u.name} (Last Login: ${lastDate})\n`;
    });

    const filename = `inactive-${exportType}-${Date.now()}.txt`;
    saveDataToFile(content, "text/plain", filename);

    ui.notifications.info(
      `Exported ${inactiveUsers.length} inactive users to ${filename}`,
    );
  }
}
