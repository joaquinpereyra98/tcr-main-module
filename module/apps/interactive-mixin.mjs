const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @import {ApplicationTabsConfiguration} from "./_types.mjs"
 */

export default function InteractiveMixin(BaseApplication) {
  /**
   * @extends {foundry.applications.api.ApplicationV2}
   */
  class InteractiveApplication extends HandlebarsApplicationMixin(
    BaseApplication
  ) {
    /** @inheritDoc */
    static DEFAULT_OPTIONS = {
      contextMenus: [],
    };

    _contextMenus;

    /** @inheritDoc */
    async _onRender(context, options) {
      await super._onRender(context, options);

      /**
       * DragDrop
       */
      const DragDropCls = DragDrop.implementation ?? DragDrop;

      new DragDropCls({
        dragSelector: ".draggable",
        permissions: {
          dragstart: this._canDragStart.bind(this),
          drop: this._canDragDrop.bind(this),
        },
        callbacks: {
          dragstart: this._onDragStart.bind(this),
          dragover: this._onDragOver.bind(this),
          drop: this._onDrop.bind(this),
        },
      }).bind(this.element);
    }

    /** @inheritDoc */
    _onFirstRender(context, options) {
      super._onFirstRender(context, options);
      this._contextMenus = this._createContextMenus();
    }

    static TABS = {};

    /**
     * @returns {ContextMenu[]}
     */
    _createContextMenus() {
      if (Array.isArray(this.options.contextMenus))
        return this.options.contextMenus.map(
          ({ selector, menuItems, options }) => {
            if (game.release.generation >= 13)
              return this._createContextMenu(
                Array.isArray(menuItems) ? () => menuItems : menuItems,
                selector,
                { ...options }
              );
            else
              return ContextMenu.create(
                this,
                this.element,
                selector,
                menuItems(),
                options
              );
          }
        );
      else {
        console.error(
          `${SYSTEM_CONST.SYSTEM_NAME} | Error _createContextMenus | this.options.contextMenus should be a Array`
        );
        return [];
      }
    }

    /** @override */
    async _prepareContext(options) {
      const baseContext = await super._prepareContext(options);
      return {
        ...baseContext,
        tabs: this._prepareTabs(),
      };
    }

    /**
     * Prepare application tab data for a single tab group.
     * @param {string} group The ID of the tab group to prepare
     * @returns {Record<string, ApplicationTab>}
     * @protected
     */
    _prepareTabs(group = "primary") {
      const {
        tabs,
        labelPrefix,
        initial = null,
      } = this._getTabsConfig(group) ?? { tabs: [] };

      this.tabGroups[group] ??= initial;

      return tabs.reduce((prepared, { id, cssClass, ...tabConfig }) => {
        const active = this.tabGroups[group] === id;
        if (active) cssClass = [cssClass, "active"].filterJoin(" ");
        const tab = { group, id, active, cssClass, ...tabConfig };
        if (labelPrefix) tab.label ??= `${labelPrefix}.${id}`;
        prepared[id] = tab;
        return prepared;
      }, {});
    }

    /**
     * Get the configuration for a tabs group.
     * @param {string} group The ID of a tabs group
     * @returns {ApplicationTabsConfiguration|null}
     * @protected
     */
    _getTabsConfig(group) {
      return this.constructor.TABS[group] ?? null;
    }

    /* -------------------------------------------- */
    /*  Drag and Drop                               */
    /* -------------------------------------------- */

    /**
     * Define whether a user is able to begin a dragstart workflow for a given drag selector.
     * @param {string} selector       The candidate HTML selector for dragging
     * @returns {boolean}             Can the current user drag this selector?
     * @protected
     */
    _canDragStart(selector) {
      return this.isEditable;
    }

    /* -------------------------------------------- */

    /**
     * Define whether a user is able to conclude a drag-and-drop workflow for a given drop selector.
     * @param {string} selector       The candidate HTML selector for the drop target
     * @returns {boolean}             Can the current user drop on this selector?
     * @protected
     */
    _canDragDrop(selector) {
      return this.isEditable;
    }

    /* -------------------------------------------- */

    /**
     * An event that occurs when a drag workflow begins for a draggable item on the sheet.
     * @param {DragEvent} event       The initiating drag start event
     * @returns {Promise<void>}
     * @protected
     */
    async _onDragStart(event) {
      const target = event.currentTarget;
      if ("link" in event.target.dataset) return;
      let dragData;

      const { documentClass, docId } = target.dataset;
      const doc = this.document.getEmbeddedDocument(documentClass, docId);
      dragData = doc.toDragData();

      // Set data transfer
      if (!dragData) return;
      event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    }

    /* -------------------------------------------- */

    /**
     * An event that occurs when a drag workflow moves over a drop target.
     * @param {DragEvent} event
     * @protected
     */
    _onDragOver(event) {}
    /* -------------------------------------------- */

    /**
     * An event that occurs when data is dropped into a drop target.
     * @param {DragEvent} event
     * @returns {Promise<void>}
     * @protected
     */
    async _onDrop(event) {}

    /* -------------------------------------------- */

    /**
     * Handle a dropped document on the ActorSheet
     * @param {DragEvent} event         The initiating drop event
     * @param {Document} document       The resolved Document class
     * @returns {Promise<void>}
     * @protected
     */
    async _onDropDocument(event, document) {}

    /* -------------------------------------------- */
    /*  Event Listeners and Handlers                */
    /* -------------------------------------------- */
  }

  return InteractiveApplication;
}
