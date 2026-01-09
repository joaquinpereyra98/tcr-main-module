import SegmentData from "./segment-data.mjs";

export default class TabData extends foundry.abstract.DataModel {
  /**@override */
  static defineSchema() {
    const f = foundry.data.fields;

    return {
      id: new f.DocumentIdField({ initial: () => foundry.utils.randomID() }),
      label: new f.StringField({
        required: true,
        blank: false,
        initial: "New Tab",
        label: "Tab Label",
      }),
      icon: new f.StringField({
        blank: true,
        placeholder: "fa-solid fa-table",
        label: "Display Icon",
        hint: "The Font Awesome class string (e.g., 'fa-solid fa-fire' or 'fa-solid fa-github')",
      }),
      columns: new f.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 1,
        min: 1,
        label: "Columns",
      }),
      rows: new f.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 1,
        min: 1,
        label: "Rows",
      }),
      background: new f.SchemaField({
        color: new f.ColorField({
          required: false,
          initial: undefined,
          label: "Background Color",
        }),
        src: new f.FilePathField({
          categories: ["IMAGE", "VIDEO"],
          blank: true,
          initial: "",
          label: "Background Image",
        }),
      }),
      segments: new f.ArrayField(new f.EmbeddedDataField(SegmentData)),
    };
  }

  get styleAttr() {
    const styles = [];

    // Handle Columns & Rows
    styles.push(`--hud-columns: ${this.columns}`);
    styles.push(`--hud-rows: ${this.rows}`);

    return styles.join("; ");
  }
}
