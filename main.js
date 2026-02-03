import { registerSettings } from "./src/rmu-mrf-settings.js";
import { getMovementPaces } from "./src/rmu-mrf-calculator.js";
import { calculateReachableSquares } from "./src/rmu-mrf-pathfinding.js";
import { drawOverlay, clearOverlay } from "./src/rmu-mrf-renderer.js";

Hooks.once("init", () => {
    registerSettings();
});

function updateRangeOverlay(token) {
    if (!token) return;
    
    // 1. Cleanup
    clearOverlay();
    
    // 2. Data
    const movementData = getMovementPaces(token);
    if (!movementData) return;

    // 3. Draw
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) {
        drawOverlay(token, movementData, "rings");
    } else {
        const squares = calculateReachableSquares(token, movementData);
        drawOverlay(token, squares, "grid");
    }
}

Hooks.on("controlToken", (token, controlled) => {
    if (!controlled) {
        clearOverlay();
        return;
    }
    updateRangeOverlay(token);
});

Hooks.on("rmuMRFRefresh", () => {
    // If a token is currently selected, redraw it with new settings
    if (canvas.tokens.controlled.length > 0) {
        updateRangeOverlay(canvas.tokens.controlled[0]);
    }
});