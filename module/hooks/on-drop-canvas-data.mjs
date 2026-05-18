import CanvasDropManager from "../canvas/canvas-drop-manager.mjs";
/**
 * A hook event that fires when some useful data is dropped onto the Canvas.
 * @param {Canvas} canvas- The Canvas
 * @param {object} data - The data that has been dropped onto the Canvas
 */
export default function onDropCanvasData(canvas, data) {
  if (
    data.isFromCompendiumBrowser &&
    !game.user.isGM &&
    data.type === "Actor"
  ) {
    CanvasDropManager._handleActorDrop(canvas, data);
    return false;
  }
}
