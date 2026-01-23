export default class IssueCommentData extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    const f = foundry.data.fields;

    return {
      id: new f.NumberField({
        required: true,
        nullable: false,
        integer: true,
      }),
      body: new f.HTMLField(),
      user: new f.ForeignDocumentField(foundry.documents.BaseUser, {
        required: false,
        nullable: true,
        label: "User",
      }),
      created: new f.NumberField({
        required: true,
        nullable: false,
        initial: Date.now,
        readonly: true,
      }),
    };
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
   * Processes the raw body text into enriched HTML.
   * @returns {Promise<string>}
   */
  async getEnrichBody() {
    return await TextEditor.enrichHTML(this.body);
  }
}
