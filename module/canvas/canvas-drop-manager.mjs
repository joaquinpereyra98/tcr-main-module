import { MODULE_ID } from "../constants.mjs";

/**
 * Manages all drop interactions on the canvas for the TCR Main Module.
 */
export default class CanvasDropManager {
  /**
   * Initialize and register all drop-related handlers and overrides.
   */
  static initialize() {
    this._patchCanvasOnDrop();
  }

  static SOCKET_KEY = `${MODULE_ID}.createTokenFromBrowser`;

  static socket;

  static _registerSocketListeners() {
    this.socket = socketlib.registerModule(MODULE_ID);

    this.socket.register(this.SOCKET_KEY, (socketData) => {
      if (!game.users.activeGM.isSelf) return;
      this._handleSocketCreateToken(socketData);
    });
  }

  /**
   * Handles the server-side/GM execution of a socketed token drop.
   * @param {Object} socketData - The data packet received from the client
   * @private
   */
  static async _handleSocketCreateToken({ data, event, user }) {
    console.log(`${MODULE_ID} | GM processing socketed token drop request:`);
    let actor = await Actor.implementation.fromDropData(data);
    if (actor.compendium) {
      const actorData = game.actors.fromCompendium(actor);
      actorData.ownership ??= {};
      actorData.ownership[user] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      actor = await Actor.implementation.create(actorData, {
        fromCompendium: true,
      });
    }

    const td = await actor.getTokenDocument(
      {
        hidden: game.user.isGM && event.altKey,
        sort: Math.max(canvas.tokens.getMaxSort() + 1, 0),
      },
      { parent: canvas.scene },
    );

    const t = canvas.tokens.createObject(td);
    let position = t.getCenterPoint({ x: 0, y: 0 });
    position.x = data.x - position.x;
    position.y = data.y - position.y;
    if (!event.shiftKey) position = t.getSnappedPosition(position);
    t.destroy({ children: true });
    td.updateSource(position);

    if (!canvas.dimensions.rect.contains(td.x, td.y)) return false;

    canvas.tokens.activate();
    return td.constructor.create(td, { parent: canvas.scene });
  }

  /**
   * Monkeypatches the base canvas._onDrop method to intercept data before Core processes it.
   * @private
   */
  static _patchCanvasOnDrop() {
    const originalOnDrop = canvas._onDrop;
    canvas._onDrop =
      /** @param {DragEvent} event */
      async function (event) {
        const rawData = event.dataTransfer.getData("text/plain");
        const data = JSON.parse(rawData);

        if (
          data?.isFromCompendiumBrowser &&
          !game.user.isGM &&
          data.type === "Actor"
        ) {
          data.event = {
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          };
        }
        Object.defineProperty(event, "dataTransfer", {
          value: {
            ...event.dataTransfer,
            getData: (type) =>
              type === "text/plain"
                ? JSON.stringify(data)
                : event.dataTransfer.getData(type),
          },
          writable: true,
        });
        return await originalOnDrop.call(this, event);
      };
  }

  /**
   * Custom handling logic specifically for Actor drops
   * @param {Canvas} _canvas - The Canvas instance
   * @param {Object} data   - The dropped data payload
   */
  static async _handleActorDrop(_canvas, { event, ...data }) {
    await this.socket.executeAsGM(this.SOCKET_KEY, {
      data,
      event,
      user: game.user.id,
    });
  }
}
