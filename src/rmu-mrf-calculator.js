/**
 * RMU Movement Range Finder - Calculator
 * --------------------------------------
 * Acts as the translation layer between the Rolemaster Unified (RMU) system
 * data architecture and this module's rendering engine.
 * * It extracts the mathematically correct movement distances for the current
 * phase, merges them with the GM's visual preferences, and formats them
 * into a structured array ready for the pathfinding algorithms.
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";

/**
 * Parses a token's actor data to determine their available movement paces
 * and distances for the current combat phase.
 * * @param {Token} token - The Foundry VTT Token object.
 * @returns {Array<object>|null} An array of pace objects, or null if data is missing.
 */
export function getMovementPaces(token) {
    // Guard: Ensure the token is a valid RMU actor with a populated movement block
    if (!token?.actor?.system?._movementBlock) return null;

    const moveBlock = token.actor.system._movementBlock;
    const settings = getVisualSettings();

    // RMU supports multiple movement modes (e.g., Walking, Flying, Swimming).
    // We must isolate the specific mode the actor currently has toggled active.
    const activeModeLabel = moveBlock._selected;
    const activeOption = moveBlock._options?.find((opt) => opt.value === activeModeLabel);

    // Guard: Abort if the active mode has no configured pace rates
    if (!activeOption || !activeOption.paceRates) {
        return null;
    }

    // Map the raw system data into a clean, renderer-friendly structure
    const paces = activeOption.paceRates.map((rate) => {
        const paceValue = rate.pace.value; // e.g., "Walk", "Sprint"

        // Merge the system's pace with the user's customised colour configuration
        const color = settings.colors[paceValue] || "#FFFFFF";

        return {
            name: paceValue,
            label: rate.pace.label,
            distance: rate.perPhase, // The actual traversable distance for this phase
            penalty: rate.pace.modifier,
            color: color,
            allowed: rate.allowedPace, // Exposed primarily for debugging edge cases
        };
    });

    /**
     * CRITICAL: Z-Index Sorting (The Painter's Algorithm)
     * PIXI.js Graphics draw in the exact order they are called. If we draw the
     * smallest boundary (Walk) first, the larger boundary (Sprint) will be drawn
     * immediately over the top of it, completely hiding the Walk zone.
     * By sorting descending by distance, the renderer draws the massive 'Dash'
     * footprint first, then overlays the progressively smaller paces on top.
     */
    paces.sort((a, b) => b.distance - a.distance);

    return paces;
}
