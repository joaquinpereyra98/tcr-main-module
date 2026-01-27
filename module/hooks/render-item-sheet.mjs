import { ITEM_FLAGS, MODULE_ID } from "../constants.mjs";
import HTMLDocumentTagsElementV2 from "../apps/elements/document-tags-v2.mjs";

/**
 * A hook event that fires whenever an ItemsSheet5e is rendered.
 * @param {ApplicationV2} application - The Application instance being rendered
 * @param {HTMLElement} element - The inner HTML of the document that will be displayed and may be modified
 * @param {import("../../foundry/resources/app/client-esm/applications/_types.mjs").ApplicationRenderContext} _context - The application rendering context data
 * @param {import("../../foundry/resources/app/client-esm/applications/_types.mjs").ApplicationRenderOptions} _options - The application rendering options
 */
export default function onRenderItemSheet5e(app, [element], _context, _options) {
  const item = app.document;

  if (item.type !== "spell") return;

  /**@type {HTMLElement} */
  const sourceClass = element.querySelector(
    '.tidy-tab.details .form-group[data-form-group-for="system.sourceClass"]',
  );

  const input = HTMLDocumentTagsElementV2.create({
    name: `flags.${MODULE_ID}.${ITEM_FLAGS.SPELL_CLASSES}`,
    type: "Item",
    subtypes: ["class", "subclass"],
    value: item.getFlag(MODULE_ID, ITEM_FLAGS.SPELL_CLASSES) ?? [],
    single: false,
    disabled: !app.isEditable,
  });

  input.addEventListener("change", (event) => {
    item.setFlag(MODULE_ID, ITEM_FLAGS.SPELL_CLASSES, event.target.value);
  });

  const formGroup = foundry.applications.fields.createFormGroup({
    label: "Spell Classes",
    hint: "List the classes that grant access to this spell",
    input,
  });

  sourceClass.insertAdjacentElement("afterend", formGroup);
}
