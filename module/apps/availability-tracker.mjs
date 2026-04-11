import {
  AVAILABILITY_TRACKER_KEY,
  MODULE_ID,
  USER_FLAGS,
} from "../constants.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2 } =
  foundry.applications.api;

/**
 * @import { ApplicationClickAction, ApplicationConfiguration } from "../../foundry/resources/app/client-esm/applications/_types.mjs";
 * @import { HandlebarsTemplatePart } from "../../foundry/resources/app/client-esm/applications/api/handlebars-application.mjs"
 */

export default class AvailabilityTracker extends HandlebarsApplicationMixin(
  DocumentSheetV2,
) {
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
      toggleRow: AvailabilityTracker.#onToggleRow,
      clearAll: AvailabilityTracker.#onClearAll,
    },
    sheetConfig: false,
  };

  static async renderAvailabilityTracker(options = {}) {
    const sheet = ui[AVAILABILITY_TRACKER_KEY];
    options.force ??= true;
    await sheet.render(options);
    return sheet;
  }

  /* -------------------------------------------- */
  /* Properties & Getters                         */
  /* -------------------------------------------- */

  /**
   * Configure a registry of template parts which are supported for this application for partial rendering.
   * @type {Record<string, HandlebarsTemplatePart>}
   */
  static PARTS = {
    tracker: {
      template: `modules/${MODULE_ID}/templates/availability-tracker/tracker.hbs`,
    },
  };

  /**
   * Gets the preferred time zone offset for the current user.
   * @returns {number}
   */
  static get timeZone() {
    return (
      game.user.getFlag(MODULE_ID, USER_FLAGS.TIME_ZONE) ??
      -(new Date().getTimezoneOffset() / 60)
    );
  }

  static getNextState(state) {
    return (state + 1) % 3;
  }

  static DRAG_ORIENTATION = {
    HORIZONTAL: "h",
    VERTICAL: "v",
  };

  /**
   * @type {Number[]}
   */
  static get availabilityUTC() {
    return (
      game.user.getFlag(MODULE_ID, USER_FLAGS.AVAILABILITY) ||
      Array(168).fill(0)
    );
  }

  get availabilityUTC() {
    return AvailabilityTracker.availabilityUTC;
  }

  get localAvailability() {
    return AvailabilityTracker.shiftAvailability(
      this.availabilityUTC,
      AvailabilityTracker.timeZone,
    );
  }

  /**
   * @type {{
   *    active: boolean,
   *    startIdx: number|null,
   *    paintState: number|null,
   *    orientation: "h"|"v"|null,
   *    lastTargetIdx: number|null
   * }}
   */
  _dragState = {
    active: false,
    startIdx: null,
    paintState: null,
    orientation: null,
    lastTargetIdx: null,
  };

  _baselineAvailability = null;
  _lastAffectedIndices = [];

  /* -------------------------------------------- */
  /* Lifecycle Methods                            */
  /* -------------------------------------------- */

  /**@inheritdoc */
  _initializeApplicationOptions(options) {
    Object.assign(options, {
      document: game.user,
    });
    return super._initializeApplicationOptions(options);
  }

  /** @inheritDoc */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const copyId = frame.querySelector('[data-action="copyUuid"]');
    if (copyId) copyId.remove();
    return frame;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    /**@type {HTMLElement} */
    const daysGrid = this.element.querySelector(".days-grid");
    if (daysGrid) {
      daysGrid.addEventListener("mousedown", this.#onPointerDown.bind(this));
      daysGrid.addEventListener("contextmenu", (e) => e.preventDefault());
    }
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
      timeZone: AvailabilityTracker.timeZone,
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
   * Calculates the line and updates the local UI and internal working array
   */
  #updateAvailabilityRange(startIdx, endIdx) {
    if ( !this._baselineAvailability ) return;

    const utcArray = [...this._baselineAvailability];
    const offset = AvailabilityTracker.timeZone;
    const state = this._dragState.paintState;

    const startX = startIdx % 24;
    const startY = Math.floor(startIdx / 24);
    const endX = endIdx % 24;
    const endY = Math.floor(endIdx / 24);

    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);

    const affectedLocalIndices = [];
    if (this._dragState.orientation === "v") {
      for (let y = minY; y <= maxY; y++)
        affectedLocalIndices.push(y * 24 + startX);
    } else {
      for (let x = minX; x <= maxX; x++)
        affectedLocalIndices.push(startY * 24 + x);
    }

    if (affectedLocalIndices.length === 0) affectedLocalIndices.push(startIdx);

    // Revert cells that are no longer in the drag range
    this._lastAffectedIndices.forEach(idx => {
      if ( affectedLocalIndices.includes(idx) ) return;
      const el = this.element.querySelector(`.day-cell[data-index="${idx}"]`);
      if ( el ) {
        const utcIdx = (idx - offset + 168) % 168;
        const baselineState = this._baselineAvailability[utcIdx];
        el.dataset.state = baselineState;
        el.innerHTML = this.#getCellIcon(baselineState);
      }
    });

    // Apply the current range
    affectedLocalIndices.forEach((localIdx) => {
      const utcIdx = (localIdx - offset + 168) % 168;
      utcArray[utcIdx] = state;

      const el = this.element.querySelector(`.day-cell[data-index="${localIdx}"]`);
      if (el) {
        el.dataset.state = state;
        el.innerHTML = this.#getCellIcon(state);
      }
    });

    this._lastAffectedIndices = affectedLocalIndices;
    this._workingArray = utcArray;
  }

  #getCellIcon(state) {
    if ( state === 1 ) return '<i class="cell-icon fa-regular fa-circle"></i>';
    if ( state === 2 ) return '<i class="cell-icon fa-solid fa-xmark"></i>';
    return "";
  }

  /* -------------------------------------------- */
  /* Event Dragging Handlers                      */
  /* -------------------------------------------- */

  /**
   * @param {MouseEvent} event
   */
  #onPointerDown(event) {
    if ( event.button !== 0 && event.button !== 2 ) return;
    const target = event.target;
    const cell = target.closest(".day-cell");
    if (!cell) return;
    event.preventDefault();

    const localIndex = parseInt(cell.dataset.index);
    const isRightClick = event.button === 2;

    const offset = AvailabilityTracker.timeZone;
    const currentUTC = AvailabilityTracker.availabilityUTC;
    const utcIdx = (localIndex - offset + 168) % 168;
    const paintState = isRightClick ? 2 : ((currentUTC[utcIdx] ?? 0) + 1) % 3;

    this._baselineAvailability = [...currentUTC];
    this._workingArray = [...currentUTC];
    this._lastAffectedIndices = [];

    this._dragState = {
      active: true,
      startIdx: localIndex,
      orientation: null,
      lastTargetIdx: localIndex,
      paintState: paintState
    };

    this.#updateAvailabilityRange(localIndex, localIndex);

    const onMouseMove = (e) => this.#onPointerMove(e);
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      this.#onPointerUp();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  /**
   *
   * @param {MouseEvent} event
   */
  #onPointerMove(event) {
    if (!this._dragState.active) return;
    const cell = event.target.closest(".day-cell");
    if (!cell) return;

    const currentIdx = parseInt(cell.dataset.index);
    if (currentIdx === this._dragState.lastTargetIdx) return;

    const startIdx = this._dragState.startIdx;

    const startX = startIdx % 24;
    const startY = Math.floor(startIdx / 24);
    const currX = currentIdx % 24;
    const currY = Math.floor(currentIdx / 24);

    const dx = currX - startX;
    const dy = currY - startY;

    if (!this._dragState.orientation && (dx !== 0 || dy !== 0)) {
      this._dragState.orientation = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
    }

    let targetX = currX;
    let targetY = currY;

    if (this._dragState.orientation === "h") targetY = startY;
    else if (this._dragState.orientation === "v") targetX = startX;

    const projectedIdx = targetY * 24 + targetX;

    if (projectedIdx !== this._dragState.lastTargetIdx) {
      this._dragState.lastTargetIdx = projectedIdx;
      this.#updateAvailabilityRange(startIdx, projectedIdx);
    }
  }

  /**
   *
   */
  #onPointerUp() {
    if ( !this._dragState.active ) return;
    this._dragState.active = false;
    this._baselineAvailability = null;
    game.user.setFlag(MODULE_ID, USER_FLAGS.AVAILABILITY, this._workingArray);
  }

  /* -------------------------------------------- */
  /*  Event Click Handlers                        */
  /* -------------------------------------------- */

  /**
   * Toggles an entire row between states.
   * @type {ApplicationClickAction}
   * @this AvailabilityTracker
   */
  static async #onToggleRow(_event, target) {
    const dayIndex = parseInt(target.dataset.day); // 0-6
    const utcArray = [...this.availabilityUTC];
    const offset = AvailabilityTracker.timeZone;

    const startIdx = dayIndex * 24;

    const firstCellLocal = (startIdx - offset + 168) % 168;
    const nextState = AvailabilityTracker.getNextState(
      utcArray[firstCellLocal] ?? 0,
    );

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
