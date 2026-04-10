import { getVisualSettings } from "./rmu-mrf-settings.js";

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

function _buildLegendHTML(colors) {
    let html = `<h3 class="rmu-mrf-legend-header">${game.i18n.localize("RMU_MRF.legend.title")}</h3>`;

    // 1. Hotkey Hints
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
