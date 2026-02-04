/**
 * RMU Movement Range Finder - Main Entry Point (Final V1)
 */
import { calculateReachableSquares } from "./src/rmu-mrf-pathfinding.js";
import { drawOverlay, clearOverlay } from "./src/rmu-mrf-renderer.js";
import { registerSettings, getVisualSettings, MODULE_ID } from "./src/rmu-mrf-settings.js";
import { getMovementPaces } from "./src/rmu-mrf-calculator.js";

// CACHE
let _cachedData = {
    tokenId: null,
    x: null,
    y: null,
    result: null,
    mode: null
};

Hooks.once("init", async () => {
    console.log(`${MODULE_ID} | Initializing RMU Movement Range Finder`);
    registerSettings();
});

Hooks.once("ready", () => {
    Hooks.on("rmuMRFRefresh", () => {
        triggerUpdate(true);
    });
});

// HOOK: SIGHT REFRESH (Fog of War)
Hooks.on("sightRefresh", () => {
    triggerUpdate(false); 
});

// HOOK: SCENE UPDATE (Grid Changes)
Hooks.on("updateScene", (document, change, options, userId) => {
    // If Grid Type, Size, or Units changed, we must recalculate
    if (change.grid || change.gridType || change.gridDistance || change.gridUnits) {
        triggerUpdate(true);
    }
});

Hooks.on("controlToken", (token, controlled) => {
    if (controlled) {
        if (canvas.tokens.controlled.length === 1) {
            triggerUpdate(true); 
        } else {
            clearOverlay();
        }
    } else {
        if (canvas.tokens.controlled.length === 0) {
            clearOverlay();
        }
    }
});

Hooks.on("updateToken", (document, change, options, userId) => {
    if (!document.object?.controlled) return;
    if (change.x || change.y) {
        triggerUpdate(true); 
    }
});

function triggerUpdate(forceRecalc) {
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) {
        clearOverlay();
        return;
    }
    const token = tokens[0];

    const settings = getVisualSettings();
    if (!settings.enabled) {
        clearOverlay();
        return;
    }

    if (!forceRecalc && 
        _cachedData.tokenId === token.id && 
        _cachedData.x === token.document.x && 
        _cachedData.y === token.document.y &&
        _cachedData.result) {
        
        drawOverlay(token, _cachedData.result, _cachedData.mode);
        return;
    }

    const paces = getMovementPaces(token);
    if (!paces || paces.length === 0) return;

    const gridType = canvas.grid.type;
    const isGridless = (gridType === CONST.GRID_TYPES.GRIDLESS);
    const mode = isGridless ? "gridless" : "grid";

    let dataToRender = null;

    if (isGridless) {
        dataToRender = paces; 
    } else {
        dataToRender = calculateReachableSquares(token, paces);
    }

    _cachedData = {
        tokenId: token.id,
        x: token.document.x,
        y: token.document.y,
        result: dataToRender,
        mode: mode
    };

    drawOverlay(token, dataToRender, mode);
}