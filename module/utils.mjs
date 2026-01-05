/**
 *
 * @param {Module} module
 * @returns
 */
export function moduleToObject(module) {
  return { ...module };
}

/**
 *
 * @param {String} str
 * @returns {String}
 */
export function toCamelCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, character) => character.toUpperCase())
    .trim();
}
