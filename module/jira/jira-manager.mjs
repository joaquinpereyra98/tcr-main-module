import IssueData from "../data/issue-data.mjs";
import { BASE_URL, MAIN_HUD_KEY, MODULE_ID, SETTINGS } from "../constants.mjs";
import MainHud from "../apps/main-hud.mjs";
/**
 * A singleton manager responsible for synchronizing Jira issues with Foundry VTT.
 */
export default class JiraIssueManager {
  /** * The singleton instance of the manager.
   * @type {JiraIssueManager}
   * @private
   */
  static #instance;

  /** * The local cache of issue data.
   * @type {foundry.utils.Collection<string, IssueData>}
   * @private
   */
  #issues = new foundry.utils.Collection();

  /**
   * Performance metrics for Jira issues.
   * @type {{
   * totalAllTime: number,
   * resolvedAllTime: number,
   * totalSpanTime: number,
   * resolvedSpanTime: number
   * }}
   * @private
   */
  #metrics = {
    totalAllTime: 0,
    resolvedAllTime: 0,
    totalSpanTime: 0,
    resolvedSpanTime: 0,
  };

  /**
   * Constructs the JiraIssueManager.
   * Implements the Singleton pattern; returns the existing instance if available.
   */
  constructor() {
    if (JiraIssueManager.#instance) return JiraIssueManager.#instance;

    /** @type {number|null} Timestamp of the last successful sync */
    this.lastSync = null;

    /** @type {number} Time in milliseconds between automatic refreshes (default 5 mins). */
    this.refreshInterval = 300000;

    /** @type {number|null} The ID of the active setInterval timer. */
    this._intervalId = null;

    JiraIssueManager.#instance = this;
  }

  static SOCKET_EVENT = `${MODULE_ID}.refreshJira`;

  static registerTokenSetting() {
    game.settings.register(MODULE_ID, SETTINGS.TOKEN_API, {
      name: "Jira Token Api",
      hint: "",
      scope: "world",
      config: true,
      type: String,
      default: "",
      onChange: (t) => JiraIssueManager.instance.#updateJiraToken(t),
    });
  }

  /**
   * Handles incoming socket broadcasts from other clients to synchronize the local state.
   * @this {JiraIssueManager}
   * @param {object} data - The message packet received from the socket.
   * @param {"CREATE_ISSUE"|"UPDATE_ISSUE"|"DELETE_ISSUE"} data.type - The type of sync operation.
   * @param {object} data.payload - The data required to perform the sync.
   * @param {string} data.payload.key - The unique Jira key (e.g., "PROJ-123").
   * @param {object} [data.payload.data] - The raw Jira data used for creation or updates.
   * @private
   */
  static _handleSocketEvent({ type, payload }) {
    switch (type) {
      case "CREATE_ISSUE":
        this.#issues.set(payload.key, payload.data);
        break;
      case "UPDATE_ISSUE":
        const issueToUpdate = this.#issues.get(payload.key);
        if (issueToUpdate) {
          issueToUpdate.updateSource(payload.data);
          issueToUpdate.app?.render();
        }
        break;
      case "DELETE_ISSUE":
        const issueToDelete = this.#issues.get(payload.key);
        if (issueToDelete) {
          issue.app.close();
          this.#issues.delete(payload.key);
        }
        break;
    }

    JiraIssueManager._refreshApps();
  }

  /**
   * Broadcasts a state change to all other connected clients via the Foundry Socket API.
   * @param {"CREATE_ISSUE"|"UPDATE_ISSUE"|"DELETE_ISSUE"} type - The specific action being broadcasted.
   * @param {object} payload - The data packet associated with the event.
   * @param {string} payload.key - The unique Jira issue key (e.g., "PROJ-123").
   * @param {object} [payload.data] - The updated issue data or the full issue object (required for CREATE/UPDATE).
   * @private
   */
  static _emitRefresh(type, payload) {
    game.socket.emit(JiraIssueManager.SOCKET_EVENT, {
      type,
      payload,
    });
  }

  /**
   * Static access to the issue collection.
   * @type {foundry.utils.Collection<string, IssueData>}
   * @readonly
   */
  static get issues() {
    return this.instance.issues;
  }

  /**
   * Returns the singleton instance of the manager.
   * @type {JiraIssueManager}
   * @readonly
   */
  static get instance() {
    if (!this.#instance) this.#instance = new JiraIssueManager();
    return this.#instance;
  }

  /**
   * Instance access to the issue collection.
   * @type {foundry.utils.Collection<string, IssueData>}
   * @readonly
   */
  get issues() {
    return this.#issues;
  }

  /**
   * Performance metrics for Jira issues.
   * @type {{
   * totalAllTime: number,
   * resolvedAllTime: number,
   * totalSpanTime: number,
   * resolvedSpanTime: number
   * }}
   */
  get metrics() {
    return this.#metrics;
  }

  /* -------------------------------------------- */
  /* Initialization & Sync                       */
  /* -------------------------------------------- */

  /**
   * Performs initial data fetch and starts the automatic refresh timer.
   * @returns {Promise<void>}
   */
  async initialize() {
    game.socket.on(
      JiraIssueManager.SOCKET_EVENT,
      JiraIssueManager._handleSocketEvent.bind(this),
    );

    await this.loadAll();
    await this.loadMetrics();
    this.startAutoRefresh();
  }

  /**
   * Clears any existing interval and starts a new synchronization timer.
   * @void
   */
  startAutoRefresh() {
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = setInterval(() => {
      this.loadAll();
      this.loadMetrics();
    }, this.refreshInterval);
  }

  /**
   * Stops the automatic refresh timer.
   * @void
   */
  stopAutoRefresh() {
    clearInterval(this._intervalId);
    this._intervalId = null;
  }

  /* -------------------------------------------- */
  /* API Methods                                 */
  /* -------------------------------------------- */

  /**
   * Internal helper for making authenticated/formatted requests to the middleware.
   * @param {string} endpoint - The API path (relative to BASE_URL).
   * @param {RequestInit} [options={}] - Standard Fetch API options.
   * @returns {Promise<object>} The parsed JSON response.
   * @throws {Error} If the network response is not OK.
   * @private
   * @static
   */
  static async #fetchAPI(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        ...options,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP Error ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("API Fetch Error:", error.message);
      return { error: true, message: error.message };
    }
  }

  /**
   *
   * @param {String} token
   */
  async #updateJiraToken(token) {
    const response = await fetch("https://jira.tcrdnd.com/api/config/token", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update token');
    }

    console.log('Success:', data.message);
  }

  async loadMetrics() {
    const value = game.settings.get(MODULE_ID, SETTINGS.METRICS_TIME_VALUE);
    const unit = game.settings.get(MODULE_ID, SETTINGS.METRICS_TIME_UNIT);

    const data = await JiraIssueManager.#fetchAPI("/metrics", {
      method: "POST",
      body: JSON.stringify({ value, unit }),
    });

    this.#metrics = foundry.utils.mergeObject(
      {
        totalAllTime: 0,
        resolvedAllTime: 0,
        totalSpanTime: 0,
        resolvedSpanTime: 0,
      },
      data,
      { inplace: false },
    );

    ui[MAIN_HUD_KEY]?._renderMetrics();
  }

  /**
   * Fetches all issues from the middleware and updates the local collection cache.
   * @returns {Promise<foundry.utils.Collection<string, IssueData>>} The updated collection.
   */
  async loadAll() {
    try {
      console.log("Jira | Syncing issues...");
      const data = await JiraIssueManager.#fetchAPI("/search", {
        method: "POST",
        body: JSON.stringify({}),
      });

      this.#issues.clear();
      for (const issue of data) {
        const model = IssueData.fromJira(issue);
        this.#issues.set(model.key, model);
      }

      JiraIssueManager._refreshApps();
      this.lastSync = Date.now();

      console.log("Jira | Synchronized issues!");
      return this.#issues;
    } catch (err) {
      ui.notifications?.error(`Jira Load Error: ${err.message}`);
      return this.#issues;
    }
  }

  /**
   * Re-renders any that are instances of the MainHud class.
   * @private
   */
  static _refreshApps() {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof MainHud) app.render({ parts: ["bugTracker"] });
    }
  }

  /**
   * Sends a creation request to the Jira middleware.
   * @param {object} data - The raw issue data to be created.
   * @returns {Promise<IssueData>} The newly created issue model.
   * @throws {Error} If creation fails.
   * @static
   */
  static async create(data) {
    try {
      const result = await this.#fetchAPI("", {
        method: "POST",
        body: JSON.stringify(data),
      });

      const newIssue = IssueData.fromJira(result);

      this._emitRefresh("CREATE_ISSUE", { key: newIssue.key, data: newIssue });

      this.issues.set(newIssue.key, newIssue);

      JiraIssueManager._refreshApps();
      ui.notifications.info(`Issue ${newIssue.key} created.`);
      return newIssue;
    } catch (err) {
      ui.notifications.error(`Creation failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Updates an existing Jira issue with the provided changes.
   * @param {string} issueID - The unique Jira key (e.g., "PROJ-123").
   * @param {object} changes - An object containing the fields to update.
   * @returns {Promise<IssueData>}
   * @static
   */
  static async update(issueID, changes) {
    if (changes instanceof IssueData) changes = changes.toObject();

    /**@type {IssueData} */
    const existing = this.issues.get(issueID);

    try {
      if (changes.user !== existing.user?._id) delete changes.user;

      const fullData = existing.clone(changes).toObject();
      const { message, result } = await this.#fetchAPI(`/${issueID}`, {
        method: "PUT",
        body: JSON.stringify(fullData),
      });

      if (existing) {
        existing.updateSource(result);
        this._emitRefresh("EDIT_ISSUE", { data: existing.toObject() });
      }

      JiraIssueManager._refreshApps();
      console.log(message);
      return existing;
    } catch (err) {
      ui.notifications.error(`Update failed: ${err.message}`);
    }
  }

  /**
   * Deletes an issue from Jira and removes it from the local collection.
   * @param {string} issueID - The unique Jira key to delete.
   * @returns {Promise<void>}
   * @static
   */
  static async delete(issueID) {
    if (!game.user.isGM) {
      ui.notifications.error(
        "Jira Integration | Access Denied. Only Gamemasters can sync changes to Jira.",
      );
      return;
    }

    try {
      await this.#fetchAPI(`/${issueID}`, { method: "DELETE" });

      this._emitRefresh("DELETE_ISSUE", { key: issueID });

      this.issues.delete(issueID);
      JiraIssueManager._refreshApps();
      ui.notifications.warn(`Issue ${issueID} deleted.`);
    } catch (err) {
      ui.notifications.error(`Deletion failed: ${err.message}`);
    }
  }

  /* -------------------------------------------- */
  /* Comment Methods                              */
  /* -------------------------------------------- */

  /**
   * Adds a comment to a specific Jira issue.
   * @param {string} issueID - The Jira key (e.g., "PROJ-123").
   * @param {string} htmlContent - The comment body from Foundry.
   * @returns {Promise<object>} The Jira response data.
   * @static
   */
  static async addComment(issueID, htmlContent) {
    try {
      const result = await this.#fetchAPI(`/${issueID}/comments`, {
        method: "POST",
        body: JSON.stringify({
          comment: htmlContent,
          user: game.user.id,
        }),
      });

      const issue = this.issues.get(issueID);

      issue.updateSource({ comments: result });
      JiraIssueManager._emitRefresh("UPDATE_ISSUE", {
        key: issue.key,
        data: issue.toObject(),
      });

      console.log(`Comment added to ${issueID}.`);
      return issue;
    } catch (err) {
      ui.notifications.error(`Failed to add comment: ${err.message}`);
      throw err;
    }
  }

  /**
   * Updates an existing comment in Jira.
   * @param {string} issueID - The Jira key.
   * @param {string} commentID - The ID of the comment to modify.
   * @param {string} newHtmlContent - The updated HTML content.
   * @returns {Promise<object>}
   * @static
   */
  static async editComment(issueID, commentID, newHtmlContent) {
    try {
      const { result } = await this.#fetchAPI(
        `/${issueID}/comments/${commentID}`,
        {
          method: "PUT",
          body: JSON.stringify({ body: newHtmlContent }),
        },
      );

      const issue = this.issues.get(issueID);
      issue.updateSource({ [`comments.${commentID}`]: result });
      issue.app.render({ parts: ["footer"] });
      JiraIssueManager._emitRefresh("UPDATE_ISSUE", {
        key: issue.key,
        data: issue.toObject(),
      });

      JiraIssueManager._refreshApps();
      return result;
    } catch (err) {
      ui.notifications.error(`Failed to edit comment: ${err.message}`);
      throw err;
    }
  }

  /**
   * Deletes a comment from Jira.
   * @param {string} issueID - The Jira key.
   * @param {string} commentID - The ID of the comment to remove.
   * @returns {Promise<void>}
   * @static
   */
  static async deleteComment(issueID, commentID) {
    if (!game.user.isGM) {
      ui.notifications.error(
        "Jira Integration | Access Denied. Only Gamemasters can sync changes to Jira.",
      );
      return;
    }

    try {
      await this.#fetchAPI(`/${issueID}/comments/${commentID}`, {
        method: "DELETE",
      });

      const issue = this.issues.get(issueID);
      if (issue && issue.comments) {
        issue.updateSource({ [`comments.-=${commentID}`]: null });
        issue.app.render({ parts: ["footer"] });
        JiraIssueManager._emitRefresh("UPDATE_ISSUE", {
          key: issue.key,
          data: issue.toObject(),
        });
      }

      JiraIssueManager._refreshApps();
      console.log("Comment deleted.");
    } catch (err) {
      ui.notifications.error(`Failed to delete comment: ${err.message}`);
      throw err;
    }
  }
}
