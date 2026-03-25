import { MODULE_ID, USER_FLAGS } from "../constants.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2 } =
  foundry.applications.api;

/**
 * @import {ApplicationClickAction, ApplicationConfiguration, ApplicationRenderContext, ApplicationRenderOptions} from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import {HandlebarsRenderOptions, HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 */

export default class AvailabilityTracker extends HandlebarsApplicationMixin(
  DocumentSheetV2,
) {
  constructor(options = {}) {
    options.document = game.user;
    options.sheetConfig = false;
    super(options);
  }

  /**
   * The default configuration options which are assigned to every instance of this Application class.
   * @type {Partial<ApplicationConfiguration>}
   */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-availability-tracker`,
    classes: [MODULE_ID, "availability-tracker"],
    window: {
      title: "Availability Tracker",
      icon: "fa-solid fa-calendar",
    },
    form: {
      submitOnChange: true,
    },
    actions: {
      toggleState: AvailabilityTracker.#onToggleState,
      toggleRow: AvailabilityTracker.#onToggleRow,
      clearAll: AvailabilityTracker.#onClearAll,
    },
  };

  /**
   * Enum for availability states.
   * @readonly
   * @enum {number}
   */
  static AVAILABILITY_STATES = Object.freeze({
    NONE: 0,
    AVAILABLE: 1,
    UNAVAILABLE: 2,
  });

  /**
   * @readonly
   * @enum {number}
   */
  static WEEK_DAYS = Object.freeze({
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  });

  /**
   * @readonly
   * @enum {boolean}
   */
  static TIME_MODE = Object.freeze({
    H24: false,
    H12: true,
  });

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    tracker: {
      template: `modules/${MODULE_ID}/templates/availability-tracker/tracker.hbs`,
    },
  };

  get timeZone() {
    return (
      game.user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE) ??
      -(new Date().getTimezoneOffset() / 60)
    );
  }

  get availabilityUTC() {
    return (
      game.user.getFlag(MODULE_ID, USER_FLAGS.AVAILABILITY) ||
      Array(168).fill(0)
    );
  }

  get localAvailability() {
    return AvailabilityTracker.shiftAvailability(
      this.availabilityUTC,
      this.timeZone,
    );
  }

  /** @inheritDoc */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const copyId = frame.querySelector('[data-action="copyUuid"]');
    if (copyId) copyId.remove();
    return frame;
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const timeMode =
      game.user.getFlag(MODULE_ID, USER_FLAGS.TIME_MODE) ?? false;

    const hourLabels = timeMode
      ? Array.from({ length: 24 }, (_, i) => (i % 12 || 12).toString())
      : Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));

    return {
      ...context,
      timeZonesOptions: this.getTimeZoneOptions(),
      timeZone: this.timeZone,
      dayLabels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      localAvailability: this.localAvailability,
      timeMode,
      hourLabels: hourLabels,
    };
  }

  /**
   * Shifts a 168-hour array by a given offset.
   * @param {Number[]} data - The 168-element array.
   * @param {number} hourOffset - Offset used to get to new time
   * @returns {Number[]}
   */
  static shiftAvailability(data, hourOffset) {
    if (!data || data.length !== 168) return Array(168).fill(0);
    const shift = (168 - (hourOffset % 168) + 168) % 168;
    if (shift === 0) return [...data];
    return [...data.slice(shift), ...data.slice(0, shift)];
  }

  /**
   * Generates options from -12 to +12 for timezone offsets.
   * @param {number} current - The currently saved offset (e.g., -5).
   * @returns {{label: string, value: number}[]} - HTML string of <option> tags.
   */
  getTimeZoneOptions() {
    const options = [];
    for (let i = -12; i <= 12; i++) {
      const label = `UTC ${i.signedString()}`;
      options.push({ label, value: i });
    }
    return options;
  }

  /**
   * @type {ApplicationClickAction}
   * @this AvailabilityTracker
   */
  static async #onToggleState(_event, target) {
    const { index } = target.dataset;
    const localIndex = parseInt(index);
    const utcArray = [...this.availabilityUTC];
    const offset = this.timeZone;
    const utcIndex = (localIndex - offset + 168) % 168;
    const nextState = ((utcArray[utcIndex] ?? 0) + 1) % 3;

    utcArray[utcIndex] = nextState;

    await game.user.setFlag(MODULE_ID, USER_FLAGS.AVAILABILITY, utcArray);
  }

  /**
   * Toggles an entire row between states.
   * @type {ApplicationClickAction}
   * @this AvailabilityTracker
   */
  static async #onToggleRow(_event, target) {
    const dayIndex = parseInt(target.dataset.day); // 0-6
    const utcArray = [...this.availabilityUTC];
    const offset = this.timeZone;

    const startIdx = dayIndex * 24;

    const firstCellLocal = (startIdx - offset + 168) % 168;
    const currentState = utcArray[firstCellLocal] ?? 0;
    const nextState = (currentState + 1) % 3;

    for (let h = 0; h < 24; h++) {
      const localIdx = startIdx + h;
      const utcIdx = (localIdx - offset + 168) % 168;
      utcArray[utcIdx] = nextState;
    }

    await game.user.setFlag(MODULE_ID, USER_FLAGS.AVAILABILITY, utcArray);
  }

  /**
   * Resets the entire 168h array to 0.
   * @type {ApplicationClickAction}
   * @this AvailabilityTracker
   */
  static async #onClearAll(event, _target) {
    if (!event.shiftKey) {
      const confirm = await foundry.applications.api.DialogV2.confirm({
        window: {
          title: "Clear Availability",
        },
        content: "<p>Are you sure you want to clear your entire schedule?</p>",
      });
      if (!confirm) return;
    }

    await game.user.setFlag(
      MODULE_ID,
      USER_FLAGS.AVAILABILITY,
      Array(168).fill(0),
    );
  }
}
