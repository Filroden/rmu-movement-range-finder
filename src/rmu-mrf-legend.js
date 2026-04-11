import { getVisualSettings, MODULE_ID } from "./rmu-mrf-settings.js";

const LEGEND_ID = "rmu-mrf-legend";

export function drawLegend() {
    if (document.getElementById(LEGEND_ID)) return;

    const legend = document.createElement("div");
    legend.id = LEGEND_ID;
    legend.className = "rmu-mrf-legend-container";

    const settings = getVisualSettings();
    legend.innerHTML = _buildLegendHTML(settings.colors);

    const uiRight = document.getElementById("ui-right");
    if (uiRight) {
        uiRight.appendChild(legend);
    } else {
        document.body.appendChild(legend);
    }
}

export function clearLegend() {
    const legend = document.getElementById(LEGEND_ID);
    if (legend) legend.remove();
}

/**
 * Dynamically retrieves the user's current configured keybinding from Foundry
 * and formats it into HTML <kbd> tags for the UI.
 * * @param {string} action - The ID of the registered keybinding action.
 * @returns {string} - Formatted HTML string of the keybinding.
 */
function _formatKeybinding(action) {
    const bindings = game.keybindings.get(MODULE_ID, action);

    // Fallback if the user has completely deleted the keybinding
    if (!bindings || bindings.length === 0) return `<kbd>-</kbd>`;

    const b = bindings[0]; // Always display the primary binding
    const keys = [];

    // 1. Format modifiers first
    if (b.modifiers?.includes("Control")) keys.push("<kbd>Ctrl</kbd>");
    if (b.modifiers?.includes("Shift")) keys.push("<kbd>Shift</kbd>");
    if (b.modifiers?.includes("Alt")) keys.push("<kbd>Alt</kbd>");

    // 2. Format the primary key
    let mainKey = b.key;
    // Foundry stores raw KeyboardEvent.code strings (e.g. "KeyM" or "Digit1")
    if (mainKey.startsWith("Key")) mainKey = mainKey.slice(3);
    else if (mainKey.startsWith("Digit")) mainKey = mainKey.slice(5);

    keys.push(`<kbd>${mainKey}</kbd>`);

    return keys.join(" + ");
}

function _buildLegendHTML(colors) {
    let html = `<h3 class="rmu-mrf-legend-header">${game.i18n.localize("RMU_MRF.legend.title")}</h3>`;

    // 1. Dynamic Hotkey Hints
    html += `<div class="rmu-mrf-legend-hints">`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.toggleLayer")}</span>
        <div class="rmu-mrf-hint-keys">${_formatKeybinding("toggleOverlay")}</div>
    </div>`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.resetAnchor")}</span>
        <div class="rmu-mrf-hint-keys">${_formatKeybinding("resetAnchor")}</div>
    </div>`;
    html += `
    <div class="rmu-mrf-hint-group">
        <span>${game.i18n.localize("RMU_MRF.legend.togglePath")}</span>
        <div class="rmu-mrf-hint-keys">${_formatKeybinding("toggleHoverPath")}</div>
    </div>`;
    html += `</div>`;

    // 2. Dynamic Pace Colours
    html += `<div class="rmu-mrf-legend-paces">`;
    const paceKeys = ["Creep", "Walk", "Jog", "Run", "Sprint", "Dash"];

    for (const pace of paceKeys) {
        const hex = colors[pace];
        if (!hex) continue;

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
