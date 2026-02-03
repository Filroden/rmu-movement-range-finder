/**
 * RMU Movement Range Finder - Settings
 */

export const MODULE_ID = "rmu-movement-range-finder";

export const SETTING_ROUNDING = "movementRounding";
export const SETTING_OPACITY = "overlayOpacity";
export const SETTING_SHOW_LABELS = "showDistanceLabels"; // NEW

// Color Keys
export const SETTING_COLOR_CREEP  = "colorCreep";
export const SETTING_COLOR_WALK   = "colorWalk";
export const SETTING_COLOR_JOG    = "colorJog";
export const SETTING_COLOR_RUN    = "colorRun";
export const SETTING_COLOR_SPRINT = "colorSprint";
export const SETTING_COLOR_DASH   = "colorDash";

export function registerSettings() {

    // --- Logic Settings ---
    game.settings.register(MODULE_ID, SETTING_ROUNDING, {
        name: "Grid Movement Rounding Rule",
        hint: "Determines if a unit can enter a square if they lack the full movement cost.",
        scope: "world",
        config: true,
        type: String,
        default: "full",
        choices: {
            "any": "Permissive: Enter if ANY movement remains (> 0)",
            "half": "Standard: Enter if > 50% of grid cost remains",
            "full": "Strict: Enter only if FULL grid cost remains (100%)"
        },
        onChange: refreshOverlay
    });

    // --- Visual Settings ---
    game.settings.register(MODULE_ID, SETTING_OPACITY, {
        name: "Overlay Opacity",
        hint: "Transparency of the movement grid (0.1 = transparent, 1.0 = solid).",
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0.1, max: 1.0, step: 0.1 },
        default: 0.4,
        onChange: refreshOverlay
    });

    game.settings.register(MODULE_ID, SETTING_SHOW_LABELS, {
        name: "Show Distance Labels",
        hint: "Display the distance cost (e.g., '15 ft') on every grid square.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay
    });

    const defaultColors = {
        [SETTING_COLOR_CREEP]:  { name: "Creep",  color: "#00FFFF" }, // Cyan
        [SETTING_COLOR_WALK]:   { name: "Walk",   color: "#00FF00" }, // Green
        [SETTING_COLOR_JOG]:    { name: "Jog",    color: "#ADFF2F" }, // GreenYellow
        [SETTING_COLOR_RUN]:    { name: "Run",    color: "#FFFF00" }, // Yellow
        [SETTING_COLOR_SPRINT]: { name: "Sprint", color: "#FFA500" }, // Orange
        [SETTING_COLOR_DASH]:   { name: "Dash",   color: "#FF0000" }  // Red
    };

    for (const [key, data] of Object.entries(defaultColors)) {
        game.settings.register(MODULE_ID, key, {
            name: `Color: ${data.name}`,
            scope: "client",
            config: true,
            type: String,
            default: data.color,
            onChange: refreshOverlay
        });
    }
}

export function getRoundingMode() {
    return game.settings.get(MODULE_ID, SETTING_ROUNDING);
}

export function getVisualSettings() {
    return {
        opacity: game.settings.get(MODULE_ID, SETTING_OPACITY),
        showLabels: game.settings.get(MODULE_ID, SETTING_SHOW_LABELS),
        colors: {
            "Creep":  game.settings.get(MODULE_ID, SETTING_COLOR_CREEP),
            "Walk":   game.settings.get(MODULE_ID, SETTING_COLOR_WALK),
            "Jog":    game.settings.get(MODULE_ID, SETTING_COLOR_JOG),
            "Run":    game.settings.get(MODULE_ID, SETTING_COLOR_RUN),
            "Sprint": game.settings.get(MODULE_ID, SETTING_COLOR_SPRINT),
            "Dash":   game.settings.get(MODULE_ID, SETTING_COLOR_DASH)
        }
    };
}

function refreshOverlay() {
    Hooks.callAll("rmuMRFRefresh");
}