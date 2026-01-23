const { MappingField } = dnd5e.dataModels.fields;

export default class MappingFieldV2 extends MappingField {
  /** @inheritDoc */
  _validateValues(value, options) {
    const errors = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("-=")) continue;
      const error = this.model.validate(v, options);
      if (error) errors[k] = error;
    }
    return errors;
  }

  /** @inheritDoc */
  _cleanType(value, options) {
    Object.entries(value).forEach(([k, v]) => {
      if (k.startsWith("-=")) return;
      value[k] = this.model.clean(v, options);
    });
    return value;
  }
}
