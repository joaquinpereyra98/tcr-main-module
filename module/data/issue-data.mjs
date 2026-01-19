import IssueSheet from "../apps/issue-sheet.mjs";
import {
  ISSUE_STATUSES,
  ISSUE_TYPES,
  MODULE_ID,
  PRIORITY,
  USER_FLAGS,
} from "../constants.mjs";
import JiraIssueManager from "../jira/jira-manager.mjs";
import MappingFieldV2 from "./fields/mapping-field-v2.mjs";
import IssueCommentData from "./issue-comment-data.mjs";

/**
 * Data Model representing a single Issue report.
 * @extends {foundry.abstract.DataModel}
 */
export default class IssueData extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    const f = foundry.data.fields;

    return {
      key: new f.StringField({
        label: "Issue Key",
        hint: "A unique identifier for this issue.",
        readonly: true,
      }),

      created: new f.NumberField({
        required: true,
        nullable: false,
        initial: Date.now,
        readonly: true,
      }),

      updated: new f.NumberField({
        required: true,
        nullable: false,
        initial: Date.now,
        readonly: true,
      }),

      summary: new f.StringField({
        required: true,
        blank: false,
        textSearch: true,
        label: "Summary",
        hint: "A brief, descriptive title for the issue.",
      }),

      description: new f.HTMLField({
        textSearch: true,
        label: "Description",
        hint: "Detailed information providing context or steps to reproduce.",
      }),

      issueType: new f.StringField({
        required: true,
        choices: Object.values(ISSUE_TYPES).reduce((acc, { key, label }) => {
          acc[key] = label;
          return acc;
        }, {}),
        initial: Object.keys(ISSUE_TYPES)[0],
        label: "Issue Type",
        hint: "The category that best describes this report.",
      }),

      attachments: new f.ArrayField(
        new f.FilePathField({
          categories: ["IMAGE"],
        }),
        {
          initial: [],
          label: "Attached Images",
          hint: "A collection of screenshots or reference images.",
          base64: true,
        },
      ),

      user: new f.ForeignDocumentField(foundry.documents.BaseUser, {
        required: false,
        initial: game.user.id,
        label: "User",
      }),

      priority: new f.StringField({
        required: true,
        initial: PRIORITY.medium.key,
        choices: Object.values(PRIORITY).reduce((acc, { key, label }) => {
          acc[key] = label;
          return acc;
        }, {}),
        label: "Priority",
        hint: "The severity and urgency of this issue.",
      }),

      score: new f.NumberField({
        nullable: false,
        initial: 0,
        integer: true,
        required: true,
      }),

      status: new f.StringField({
        required: true,
        blank: false,
        label: "Status",
        choices: Object.values(ISSUE_STATUSES).reduce((acc, { key, label }) => {
          acc[key] = label;
          return acc;
        }, {}),
        initial: ISSUE_STATUSES.unread.key,
        hint: "The current stage of this issue in the Jira workflow.",
      }),

      comments: new MappingFieldV2(new f.EmbeddedDataField(IssueCommentData)),
    };
  }

  /* -------------------------------------------- */

  /** @type {IssueSheet} */
  #app;

  /**
   * Lazily obtain the Application instance used to configure this Issue.
   * @type {IssueSheet}
   */
  get app() {
    if (!this.#app) this.#app = new IssueSheet({ issue: this });
    return this.#app;
  }

  /* -------------------------------------------- */

  /**
   * Extracts only the numeric portion of the Jira key.
   * @returns {string}
   */
  get numericID() {
    return this.key.replace(/\D/g, "");
  }

  /**
   * Gets the display name of the author.
   * @returns {string} The user's name if available, otherwise an "User Unavailable".
   */
  get author() {
    return this.user?.name ?? "User Unavailable";
  }

  /**
   * The formatted date string based on the issue's timestamp and the current game language.
   * @type {string}
   */
  get createdLabel() {
    const date = new Date(this.created);
    const lang = game.i18n.lang;

    return {
      date: date.toLocaleDateString(lang, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: date.toLocaleTimeString(lang, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  /**
   * The formatted date string based on the issue's timestamp.
   * @type {string}
   */
  get updatedLabel() {
    const date = new Date(this.updated);
    const lang = game.i18n.lang;

    return {
      date: date.toLocaleDateString(lang, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: date.toLocaleTimeString(lang, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }

  /**
   * An HTML string representing the icon for this issue type.
   * @type {string}
   */
  get typeIcon() {
    const type = ISSUE_TYPES[this.issueType] ?? ISSUE_TYPES.bug;
    return `<i class="issue-icon fa-solid ${type.iconClass}" style="color: ${type.color}"></i>`;
  }

  /**
   * The localized human-readable label for the current issue type.
   * @type {string}
   */
  get typeLabel() {
    const type = ISSUE_TYPES[this.issueType] ?? ISSUE_TYPES.bug;
    return type.label ?? "";
  }

  /**
   * An HTML string representing the priority for this issue type.
   * @type {string}
   */
  get priorityIcon() {
    const type = PRIORITY[this.priority] ?? PRIORITY.medium;
    return `<i class="issue-icon fa-solid ${type.iconClass}" style="color: ${type.color}"></i>`;
  }

  /**
   * The localized human-readable priority for the current issue type.
   * @type {string}
   */
  get priorityLabel() {
    const priority = PRIORITY[this.priority] ?? PRIORITY.bug;
    return priority.label ?? "";
  }

  get statusIcon() {
    const status = ISSUE_STATUSES[this.status] ?? ISSUE_STATUSES.unread;
    return `<i class="issue-icon ${status.iconClass}" style="color: ${status.color}"></i>`;
  }

  /**
   * The localized human-readable priority for the current issue type.
   * @type {string}
   */
  get statusLabel() {
    const status = ISSUE_STATUSES[this.status] ?? ISSUE_STATUSES.unread;
    return status.label ?? "";
  }

  /**
   * Check the current user's vote status for this issue.
   * @returns {number|null} 1 for upvote, -1 for downvote, null for no vote.
   */
  get userVote() {
    const votes = game.user.getFlag(MODULE_ID, USER_FLAGS.ISSUE_VOTES) || {};
    return votes[this.key] || null;
  }

  /**
   * Boolean getter to check if the user has voted at all.
   * @type {boolean}
   */
  get hasVoted() {
    return this.userVote !== null;
  }

  async getEnrichDescription() {
    return await TextEditor.enrichHTML(this.description);
  }

  /* -------------------------------------------- */

  toJira({ source = true } = {}) {
    const obj = this.toObject(source);
    delete obj.user;
    obj.userName = this.user?.name ?? "";
    return obj;
  }

  /**
   * Transforms Jira data into a local IssueData instance.
   * @param {Object} data - The raw data from Jira.
   * @returns {IssueData} A new instance of IssueData.
   */
  static fromJira(data) {
    data.user = game.users.getName(data.userName)?._id ?? data.user ?? null;
    return new IssueData(data);
  }

  /* ---------------------------------------- */
  /*  Data Management                         */
  /* ---------------------------------------- */

  updateSource(changes = {}, options = {}) {
    super.updateSource(changes, options);
    this.app.render()
  }
  /* -------------------------------------------- */
  /* CRUD Operations                              */
  /* -------------------------------------------- */

  /**
   * Create a new Issue in Jira.
   * @param {object} data - The issue data to create.
   * @returns {Promise<IssueData>}
   */
  static async create(data) {
    const result = await JiraIssueManager.create(new IssueData(data).toJira());
    return result;
  }

  /**
   * Update this issue in Jira.
   * @param {object} changes - The data to update.
   * @returns {Promise<IssueData>}
   */
  async update(changes) {
    this.validate({ changes, clean: true, fallback: false });
    await JiraIssueManager.update(this.key, changes);
    return this;
  }

  /**
   * Delete this issue from Jira.
   * @returns {Promise<void>}
   */
  async delete() {
    await JiraIssueManager.delete(this.key);
    this.app.close();
  }
}
