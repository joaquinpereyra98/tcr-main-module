/**
 * @typedef {Object} _WorldFolderFieldOptions
 * @property {string} [contentType] The allowed Folder document type (e.g., "Actor", "Item").
 */

/**
 * @typedef {import("../../../foundry/resources/app/common/data/fields.mjs").StringFieldOptions & _WorldFolderFieldOptions} WorldFolderFieldOptions
 */

export default class WorldFolderField
  extends foundry.data.fields.ForeignDocumentField
{
  #contentType;

  /**
   * @param {WorldFolderFieldOptions} [options]
   * @param {foundry.data.fields.DataFieldContext} [context]
   */
  constructor(options = {}, context = {}) {
    super(foundry.documents.BaseFolder, options, context);
    this.#contentType = options.contentType;
  }

  /** The allowed document type for folders in this field. */
  get contentType() {
    return this.#contentType;
  }

  /** @override */
  _toInput(config) {
    const collection = game.folders;
    const current = collection.get(config.value);

    const options = [];
    let hasCurrent = false;

    for (const doc of collection) {
      if (!doc.visible) continue;
      if (this.#contentType && doc.type !== this.#contentType) continue;

      if (doc === current) hasCurrent = true;
      options.push({ value: doc.id, label: doc.name });
    }

    // Preserve the current selection even if hidden/filtered out
    if (current && !hasCurrent) {
      options.unshift({ value: current.id, label: current.name });
    }

    // Allow a blank option if field is optional or nullable
    const blank = !this.required || this.nullable ? "" : undefined;

    return foundry.applications.fields.createSelectInput({
      ...config,
      options,
      ...(blank !== undefined && { blank }),
    });
  }
}
