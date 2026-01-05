import SegmentConfig from "../settings/segment-config.mjs";

/**
 * TCR Macro Hub Segment Data Model
 */
export default class SegmentData extends foundry.abstract.DataModel {
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
      }),

      actions: new f.SchemaField({
        click: createScriptField({ label: "Left Click Script" }),
        contextMenu: createScriptField({ label: "Right Click Script" }),
      }),
    };
  }

  _app;

  get app() {
    this._app ??= new SegmentConfig({ segment: this });
    return this._app;
  }

  /** @returns {string} */
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
      styles.push(`background-image: url('${content.src}')`);
    }

    return styles.join("; ");
  }

  get isClickable() {
    return !!(this.actions.click || this.actions.contextMenu);
  }

  /**
   * 
   * @param {PointerEvent} event 
   */
  onClickAction(event) {
    const isContext = event.button === 2;
    if( isContext && !game.user.isGM) return;
    try {
      const command = isContext ? this.actions.contextMenu : this.actions.click;
      const fn = new foundry.utils.AsyncFunction(
        "event",
        `{${command}\n}`
      );
      fn.call(this, event);
    } catch (err) {
      console.error("HUD | Action Script Error:", err);
      ui.notifications.error(
        "There was an error in the segment action script."
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

const createScriptField = (options = {}) =>
  new foundry.data.fields.JavaScriptField({
    async: true,
    required: false,
    ...options,
  });

const createGeometryField = (options = {}) =>
  new foundry.data.fields.NumberField({
    required: true,
    integer: true,
    min: 1,
    initial: 1,
    ...options,
  });
