/**
 * RMU Movement Range Finder - Legend HUD
 * --------------------------------------
 * Manages the injection and teardown of the native HTML overlay.
 *
 * Architecture Note:
 * We deliberately use a standard HTML DOM element for the legend rather than
 * drawing text onto the WebGL (PIXI.js) canvas. This ensures the legend stays
 * perfectly crisp, anchors reliably to the user interface, respects native CSS
 * theme variables, and never zooms or pans away when the GM moves the camera.
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";

const LEGEND_ID = "rmu-mrf-legend";

/**
 * Constructs and injects the legend into the Foundry UI.
 * Called by the renderer whenever the visual overlay is active.
 */
export function drawLegend() {
    // Guard: Prevent duplicate injection if the legend is already rendered
    if (document.getElementById(LEGEND_ID)) return;

    const legend = document.createElement("div");
    legend.id = LEGEND_ID;
    legend.className = "rmu-mrf-legend-container";

    // Fetch the bundled visual settings to pass dynamic data (like user-defined colours)
    const settings = getVisualSettings();
    legend.innerHTML = _buildLegendHTML(settings.colors);

    // Target Foundry's native right-side UI wrapper.
    // Appending it here ensures the legend smoothly slides in and out
    // alongside the chat sidebar when the GM collapses the UI.
    const uiRight = document.getElementById("ui-right");
    if (uiRight) {
        uiRight.appendChild(legend);
    } else {
        // Safe fallback to the primary body element if Foundry's UI architecture changes
        document.body.appendChild(legend);
    }
}

/**
 * Safely removes the legend from the DOM.
 * Called by the renderer during teardown, token deselection, or when the tool is toggled off.
 */
export function clearLegend() {
    const legend = document.getElementById(LEGEND_ID);
    if (legend) legend.remove();
}

/**
 * Constructs the internal HTML structure for the legend.
 * Note: All static styling is strictly delegated to `rmu-mrf.css`. The only inline
 * style permitted here is the dynamically generated background colour for the swatches.
 *
 * @param {object} colors - The colour configuration object retrieved from settings.
 * @returns {string} - The constructed HTML string.
 */
function _buildLegendHTML(colors) {
    let html = `<h3 class="rmu-mrf-legend-header">${game.i18n.localize("RMU_MRF.legend.title")}</h3>`;

    // 1. Hotkey Hints
    // Uses a modular flexbox layout (rmu-mrf-hint-group) to align text flush-left and keys flush-right.
    html += `<div class="rmu-mrf-legend-hints">`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.toggleLayer")}</span>
        <div class="rmu-mrf-hint-keys"><kbd>M</kbd></div>
    </div>`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.resetAnchor")}</span>
        <div class="rmu-mrf-hint-keys"><kbd>Ctrl</kbd> + <kbd>M</kbd></div>
    </div>`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.togglePath")}</span>
        <div class="rmu-mrf-hint-keys"><kbd>P</kbd></div>
    </div>`;
    html += `</div>`;

    // 2. Dynamic Pace Colours
    html += `<div class="rmu-mrf-legend-paces">`;

    // Iterate strictly through known paces to ensure a consistent top-to-bottom rendering order,
    // rather than relying on the arbitrary looping order of the settings object keys.
    const paceKeys = ["Creep", "Walk", "Jog", "Run", "Sprint", "Dash"];

    for (const pace of paceKeys) {
        const hex = colors[pace];
        if (!hex) continue; // Skip rendering if the user has somehow wiped this pace colour

        // Safely fallback to the raw string if a custom or non-standard pace
        // lacks a corresponding localisation key in the language files.
        const label = game.i18n.has(`RMU_MRF.paces.${pace}`) ? game.i18n.localize(`RMU_MRF.paces.${pace}`) : pace;

        html += `
        <div class="rmu-mrf-legend-row">
            <div class="rmu-mrf-legend-swatch" style="background-color: ${hex};"></div>
            <span>${label}</span>
        </div>`;
    }
    html += `</div>`;

    return html;
}
