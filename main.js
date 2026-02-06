/**
 * RMU Movement Range Finder - Main Entry Point
 * --------------------------------------------
 * This module visualizes movement ranges for Rolemaster Unified (RMU).
 *
 * Core Concept: "Anchor & Scout"
 * 1. Anchor: When a token is selected, its position is saved as the 'Anchor'.
 * All movement costs are calculated starting from this Anchor.
 * 2. Scout: As the user drags the token (the 'Scout'), the overlay is redrawn
 * using the Anchor for costs but the Scout for visibility.
 */

import { calculateReachableSquares } from "./src/rmu-mrf-pathfinding.js";
import { drawOverlay, clearOverlay } from "./src/rmu-mrf-renderer.js";
import { registerSettings, getVisualSettings, MODULE_ID } from "./src/rmu-mrf-settings.js";
import { getMovementPaces } from "./src/rmu-mrf-calculator.js";

// ANCHOR CACHE
// Stores the start point {x, y} for every token ID seen this session.
// This persists even if you deselect/reselect the token.
const _anchorCache = new Map();

// CURRENT CACHE
// Stores the calculated result for the *currently selected* token to optimize re-renders.
let _cachedData = {
    tokenId: null,
    anchor: null, 
    result: null,
    mode: null
};

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initializing RMU Movement Range Finder`);
    registerSettings();
});

Hooks.once("ready", () => {
    Hooks.on("rmuMRFRefresh", () => {
        triggerUpdate(true);
    });
});

Hooks.on("sightRefresh", () => {
    triggerUpdate(false); 
});

// Manual Anchor Reset Hook (Ctrl + M)
Hooks.on("rmuMRFResetAnchor", () => {
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) return;
    
    const token = tokens[0];
    const newAnchor = { x: token.document.x, y: token.document.y };
    
    // Update both the persistent map and current session cache
    _anchorCache.set(token.id, newAnchor);
    _cachedData.anchor = newAnchor;
    
    // Invalidate result to force new pathfinding from new origin
    _cachedData.result = null;
    
    ui.notifications.info("RMU Movement: Anchor Reset");
    triggerUpdate(true);
});

// Wall Update Hooks (Topology Changes)
Hooks.on("updateWall", () => triggerUpdate(true));
Hooks.on("createWall", () => triggerUpdate(true));
Hooks.on("deleteWall", () => triggerUpdate(true));

// Clean up cache when tokens are deleted
Hooks.on("deleteToken", (document) => {
    if (_anchorCache.has(document.id)) {
        _anchorCache.delete(document.id);
    }
});

Hooks.on("updateScene", (document, change, options, userId) => {
    if (change.grid || change.gridType || change.gridDistance || change.gridUnits) {
        _anchorCache.clear(); // Grid changed, all old anchors are invalid
        triggerUpdate(true);
    }
});

Hooks.on("controlToken", (token, controlled) => {
    if (controlled) {
        if (canvas.tokens.controlled.length === 1) {
            _cachedData.tokenId = token.id;
            _cachedData.result = null; 

            // IMPORTANT: Do NOT auto-set anchor to current position.
            // Check cache first. If this token has a saved anchor, use it.
            // This allows deselecting/reselecting without losing progress.
            let savedAnchor = _anchorCache.get(token.id);
            if (!savedAnchor) {
                // First time selecting this token? Set anchor to current.
                savedAnchor = { x: token.document.x, y: token.document.y };
                _anchorCache.set(token.id, savedAnchor);
            }
            _cachedData.anchor = savedAnchor;

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
        // Token moved. We keep the anchor (Start of turn) and just refresh visibility.
        triggerUpdate(false); 
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

    // --- GRID SUPPORT GATES ---
    const gridType = canvas.grid.type;
    const isGridless = (gridType === CONST.GRID_TYPES.GRIDLESS);
    const isSquare = (gridType === CONST.GRID_TYPES.SQUARE);
    const isHex = !isGridless && !isSquare;

    // Gate 1: Hex Grids
    if (isHex && !settings.experimentalHex) {
        console.warn("RMU Movement: Hex grids are currently unsupported in V1 (Wall Leaks). Enable 'Experimental Hex' in settings to force.");
        clearOverlay();
        return;
    }

    // Gate 2: Gridless
    if (isGridless && !settings.experimentalGridless) {
        console.warn("RMU Movement: Gridless mode ignores walls (Euclidean Distance). Enable 'Experimental Gridless' in settings to force.");
        clearOverlay();
        return;
    }

    const paces = getMovementPaces(token);
    if (!paces || paces.length === 0) return;

    const mode = isGridless ? "gridless" : "grid";

    // Double check anchor integrity
    let anchor = _cachedData.anchor;
    if (!anchor || _cachedData.tokenId !== token.id) {
        // Fallback: Check cache or set new
        anchor = _anchorCache.get(token.id);
        if (!anchor) {
            anchor = { x: token.document.x, y: token.document.y };
            _anchorCache.set(token.id, anchor);
        }
        _cachedData.anchor = anchor;
        _cachedData.tokenId = token.id;
    }

    if (!forceRecalc && _cachedData.result) {
        drawOverlay(token, _cachedData.result, mode, anchor);
        return;
    }

    let dataToRender = null;
    if (isGridless) {
        dataToRender = paces; 
    } else {
        dataToRender = calculateReachableSquares(token, paces, anchor);
    }

    _cachedData.result = dataToRender;
    _cachedData.mode = mode;

    drawOverlay(token, dataToRender, mode, anchor);
}