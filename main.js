/**
 * RMU Movement Range Finder - Main Entry Point
 * --------------------------------------------
 * This module visualises movement ranges for Rolemaster Unified (RMU).
 *
 * Core Concept: "Anchor & Scout"
 * 1. Anchor: When a token is selected, its exact position is saved as the 'Anchor'.
 * All pathfinding costs and distances are calculated starting from this Anchor.
 * This ensures that mid-turn movement does not reset the token's available pace limit.
 * 2. Scout: As the user moves the token (the 'Scout') across the map, the visual
 * overlay is dynamically updated. The pathing uses the Anchor for cost calculations,
 * but uses the Scout's current position to determine line-of-sight and fog-of-war visibility.
 */

import { calculateReachableSquares } from "./src/rmu-mrf-pathfinding.js";
import { drawOverlay, clearOverlay } from "./src/rmu-mrf-renderer.js";
import { registerSettings, getVisualSettings, MODULE_ID } from "./src/rmu-mrf-settings.js";
import { getMovementPaces } from "./src/rmu-mrf-calculator.js";

// Limit processing exclusively to actors that can physically move.
const VALID_ACTOR_TYPES = new Set(["Character", "Creature"]);

/**
 * Validates if the provided token represents a viable actor for movement calculations.
 * @param {Token} token - The Foundry VTT Token object.
 * @returns {boolean}
 */
const isValidActor = (token) => {
    return token?.actor && VALID_ACTOR_TYPES.has(token.actor.type);
};

// --- STATE MANAGEMENT ---

/**
 * ANCHOR CACHE
 * Stores the starting coordinates {x, y} for every token ID interacted with during the current session.
 * This persists even if the user deselects and reselects the token, preventing the origin
 * from resetting mid-turn. It is only cleared when the token is deleted or the grid changes.
 * @type {Map<string, {x: number, y: number}>}
 */
const _anchorCache = new Map();

/**
 * CURRENT CACHE
 * Stores the calculated pathfinding result matrix for the *currently selected* token.
 * This acts as a heavy optimisation layer, preventing the module from running costly
 * A* or Theta* algorithms when the user is simply panning the camera or moving the mouse.
 * @type {object}
 */
let _cachedData = {
    tokenId: null,
    anchor: null,
    result: null,
    viewZ: null, // Tracks the scene elevation level the user was looking at when the cache was built
};

// --- FOUNDRY VTT HOOKS ---

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | Initialising RMU Movement Range Finder`);
    registerSettings();
});

Hooks.once("ready", () => {
    // Custom hook emitted by settings changes to force a complete visual and mathematical refresh
    Hooks.on("rmuMRFRefresh", () => {
        triggerUpdate(true);
    });
});

/**
 * Hooks into Foundry's vision refresh cycle.
 * Called continuously as a token is dragged. We trigger an update with forceRecalc = false
 * to redraw the visual layer (masking cells hidden by fog-of-war) without recalculating the actual pathfinding math.
 */
Hooks.on("sightRefresh", () => {
    triggerUpdate(false);
});

/**
 * Manual Anchor Reset Hook (Ctrl + M)
 * Allows the GM/Player to explicitly declare a new start-of-turn position,
 * wiping the persistent anchor cache for the selected token.
 */
Hooks.on("rmuMRFResetAnchor", () => {
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) return;

    const token = tokens[0];

    if (!isValidActor(token)) return;

    const newAnchor = { x: token.document.x, y: token.document.y };

    // Synchronise both the persistent map and current session cache
    _anchorCache.set(token.id, newAnchor);
    _cachedData.anchor = newAnchor;

    // Invalidate the mathematical result cache to force new pathfinding from the new origin
    _cachedData.result = null;

    ui.notifications.info("RMU Movement: Anchor Reset");
    triggerUpdate(true);
});

// Wall Update Hooks (Topology Changes)
// Any change to the physical environment strictly requires a full mathematical recalculation.
Hooks.on("updateWall", () => triggerUpdate(true));
Hooks.on("createWall", () => triggerUpdate(true));
Hooks.on("deleteWall", () => triggerUpdate(true));

// Clean up memory leaks when tokens are permanently removed from the scene
Hooks.on("deleteToken", (document) => {
    if (_anchorCache.has(document.id)) {
        _anchorCache.delete(document.id);
    }
});

// Wipe all persistent anchors if the fundamental mathematics of the scene change
Hooks.on("updateScene", (document, change, options, userId) => {
    if (change.grid || change.gridType || change.gridDistance || change.gridUnits) {
        _anchorCache.clear();
        triggerUpdate(true);
    }
});

/**
 * Primary selection hook.
 * Establishes the anchor and prepares the caches when a user selects a token.
 */
Hooks.on("controlToken", (token, controlled) => {
    // 1. Guard: If we don't have exactly one token selected, clear the overlay and abort.
    if (canvas.tokens.controlled.length !== 1) {
        clearOverlay();
        return;
    }

    // 2. Guard: If a token is losing control (but exactly 1 remains selected), do nothing.
    if (!controlled) return;

    // 3. Guard: If the single selected token is not a valid actor, clear the overlay and abort.
    if (!isValidActor(token)) {
        clearOverlay();
        return;
    }

    // --- Core Logic ---
    _cachedData.tokenId = token.id;
    _cachedData.result = null;

    let savedAnchor = _anchorCache.get(token.id);
    if (!savedAnchor) {
        savedAnchor = { x: token.document.x, y: token.document.y };
        _anchorCache.set(token.id, savedAnchor);
    }
    _cachedData.anchor = savedAnchor;

    // Force a full recalculation now that a valid token is actively controlled
    triggerUpdate(true);
});

/**
 * Hooks into token data updates.
 * If the token's X/Y coordinates change, it means the token has successfully moved.
 * We keep the anchor (as it represents the start of the turn) and trigger a non-forced update to refresh visibility.
 */
Hooks.on("updateToken", (document, change, options, userId) => {
    if (!document.object?.controlled) return;
    if (change.x || change.y) {
        triggerUpdate(false);
    }
});

// --- CORE ROUTER ---

/**
 * The central nervous system of the module.
 * Validates state, manages cache lifecycle, and routes data between the pathfinding and rendering engines.
 * * @param {boolean} forceRecalc - If true, bypasses the pathfinding cache and forces a fresh A* or Theta* matrix calculation.
 */
function triggerUpdate(forceRecalc) {
    const tokens = canvas.tokens.controlled;
    if (tokens.length !== 1) {
        clearOverlay();
        return;
    }
    const token = tokens[0];

    if (!isValidActor(token)) {
        clearOverlay();
        return;
    }

    const settings = getVisualSettings();
    if (!settings.enabled) {
        clearOverlay();
        return;
    }

    const paces = getMovementPaces(token);
    if (!paces || paces.length === 0) return;

    // Double-check anchor integrity to prevent desyncs during rapid selection changes
    let anchor = _cachedData.anchor;
    if (!anchor || _cachedData.tokenId !== token.id) {
        // Fallback: Check persistent cache or set a new origin
        anchor = _anchorCache.get(token.id);
        if (!anchor) {
            anchor = { x: token.document.x, y: token.document.y };
            _anchorCache.set(token.id, anchor);
        }
        _cachedData.anchor = anchor;
        _cachedData.tokenId = token.id;
    }

    // Fast-path: If no recalculation is forced and we have a valid cache, send directly to the renderer
    if (!forceRecalc && _cachedData.result) {
        drawOverlay(token, _cachedData.result, "grid", anchor);
        return;
    }

    /**
     * DYNAMIC VIEW ELEVATION TRACKING
     * Reads the active render slice elevation directly from the primary canvas group.
     * This is critical for multi-level maps, allowing the module to pathfind across portals
     * based on which floor the user is actively viewing.
     */
    const dynamicViewZ = canvas.primary?.background?.elevation ?? token.document?.elevation ?? 0;

    // Strict fast-path: Only use the visual cache if the force flag is false AND we are still looking at the exact same floor
    if (!forceRecalc && _cachedData.result && _cachedData.viewZ === dynamicViewZ) {
        drawOverlay(token, _cachedData.result, "grid", anchor);
        return;
    }

    const startTime = performance.now();

    // Hand off to the heavy pathfinding algorithms
    const dataToRender = calculateReachableSquares(token, paces, anchor, dynamicViewZ, forceRecalc);

    // Store the resulting mathematical matrix and the elevation state
    _cachedData.result = dataToRender;
    _cachedData.viewZ = dynamicViewZ;

    // Hand off the mathematical matrix to the PIXI.js renderer
    drawOverlay(token, dataToRender, "grid", anchor);

    // --- END TIMER ---
    const endTime = performance.now();
    console.log(`RMU MRF | Pathfinding & Render took ${(endTime - startTime).toFixed(2)} ms`);
}
