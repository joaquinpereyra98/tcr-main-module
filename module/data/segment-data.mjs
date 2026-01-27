import SegmentConfig from "../settings/segment-config.mjs";

/**
 * TCR Macro Hub Segment Data Model
 */
export default class SegmentData extends foundry.abstract.DataModel {
  /**@inheritdoc */
  static defineSchema() {
    const f = foundry.data.fields;

    return {
      id: new f.StringField({
        required: true,
        nullable: false,
        initial: () => foundry.utils.randomID(),
      }),

      name: new f.StringField({
        required: true,
        blank: false,
        textSearch: true,
        label: "Name",
        hint: "The display name for this segment.",
      }),

      display: new f.SchemaField({
        textColor: new f.ColorField({
          placeholder: "#ffffff",
          label: "Text Color",
        }),
        textSize: new f.StringField({
          placeholder: "1.2em",
          label: "Text Size",
        }),
      }),

      geometry: new f.SchemaField({
        col: createGeometryField({ label: "Column Start" }),
        row: createGeometryField({ label: "Row Start" }),
        colSpan: createGeometryField({ label: "Width (Columns)" }),
        rowSpan: createGeometryField({ label: "Height (Rows)" }),
      }),

      content: new f.SchemaField({
        raw: new f.HTMLField({
          label: "Inner HTML Content",
        }),

        src: new f.FilePathField({
          categories: ["IMAGE"],
          label: "Background Image",
          blank: true,
        }),

        opacity: new f.NumberField({
          min: 0,
          max: 1,
          step: 0.1,
          initial: 1,
          nullable: false,
          required: true,
          label: "Background Opacity",
        }),
      }),

      actions: new f.SchemaField({
        click: createScriptField({ label: "Left Click Script" }),
        contextMenu: createScriptField({ label: "Right Click Script" }),
      }),
    };
  }

  /**
   * Internal reference to the configuration application.
   * @type {SegmentConfig|null}
   * @private
   */
  _app;

  /**
   * Get or create the configuration sheet for this segment.
   * @type {SegmentConfig}
   */
  get app() {
    this._app ??= new SegmentConfig({ segment: this });
    return this._app;
  }

  /**
   * Generates an inline CSS style string based on geometry and display data.
   * Used for the element's 'style' attribute in the DOM.
   * @type {string}
   */
  get styleAttr() {
    const styles = [];
    const { display, geometry, content } = this;

    // --- Geometry (CSS Grid Placement) ---
    // grid-column: [start] / span [count]
    if (geometry.col && geometry.colSpan) {
      styles.push(`grid-column: ${geometry.col} / span ${geometry.colSpan}`);
    }

    // grid-row: [start] / span [count]
    if (geometry.row && geometry.rowSpan) {
      styles.push(`grid-row: ${geometry.row} / span ${geometry.rowSpan}`);
    }

    // --- Visual Display ---
    if (display.textColor) styles.push(`color: ${display.textColor}`);
    if (display.textSize) styles.push(`font-size: ${display.textSize}`);

    // --- Content Background ---
    if (content.src) {
      const imagePath =
        content.src.startsWith("http") || content.src.startsWith("/")
          ? content.src
          : `/${content.src}`;

      styles.push(`--bg-image: url('${imagePath}')`);

      const opacityValue = content.opacity !== undefined ? content.opacity : 1;
      styles.push(`--bg-opacity: ${opacityValue}`);
    }

    return styles.join("; ");
  }

  /**
   * Checks if the segment has any executable scripts assigned.
   * @type {boolean}
   */
  get isClickable() {
    return !!(this.actions.click || this.actions.contextMenu);
  }

  /**
   * Handles the execution of assigned scripts when the segment is clicked.
   * Right-click actions are restricted to GMs only.
   * @param {PointerEvent} event - The triggering pointer event.
   * @returns {Promise<void>}
   */
  onClickAction(event) {
    const isContext = event.button === 2;
    if (isContext && !game.user.isGM) return;
    try {
      const command = isContext ? this.actions.contextMenu : this.actions.click;
      const fn = new foundry.utils.AsyncFunction("event", `{${command}\n}`);
      fn.call(this, event);
    } catch (err) {
      console.error("HUD | Action Script Error:", err);
      ui.notifications.error(
        "There was an error in the segment action script.",
      );
    }
  }

  /**
   * Enriches the raw HTML content for display.
   * @param {object} [options={}]  Options passed to TextEditor.enrichHTML
   * @returns {Promise<string>}    The enriched HTML string
   */
  async getEnrichedContent(options = {}) {
    const enrichOptions = {
      secrets: false,
      ...options,
    };

    return TextEditor.enrichHTML(this.content.raw ?? "", enrichOptions);
  }
}

/**
 * Helper to create a standardized JavaScript script field.
 * @param {object} [options] - Field configuration options.
 * @returns {foundry.data.fields.JavaScriptField}
 * @private
 */
const createScriptField = (options = {}) =>
  new foundry.data.fields.JavaScriptField({
    async: true,
    required: false,
    ...options,
  });

/**
 * Helper to create a standardized integer field for grid geometry.
 * @param {object} [options] - Field configuration options.
 * @returns {foundry.data.fields.NumberField}
 * @private
 */
const createGeometryField = (options = {}) =>
  new foundry.data.fields.NumberField({
    required: true,
    integer: true,
    min: 1,
    initial: 1,
    ...options,
  });
