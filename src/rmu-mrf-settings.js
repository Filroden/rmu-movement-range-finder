/**
 * RMU Movement Range Finder - Settings (DOM Injection Method)
 */

export const MODULE_ID = "rmu-movement-range-finder";

export const SETTING_ENABLED = "enableOverlay";
export const SETTING_ROUNDING = "movementRounding";
export const SETTING_OPACITY = "overlayOpacity";
export const SETTING_SHOW_LABELS = "showDistanceLabels";

// Color Keys
export const SETTING_COLOR_CREEP  = "colorCreep";
export const SETTING_COLOR_WALK   = "colorWalk";
export const SETTING_COLOR_JOG    = "colorJog";
export const SETTING_COLOR_RUN    = "colorRun";
export const SETTING_COLOR_SPRINT = "colorSprint";
export const SETTING_COLOR_DASH   = "colorDash";

export function registerSettings() {

    // --- 1. TOGGLE SETTING ---
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: "Enable Movement Overlay",
        hint: "Toggle the visual overlay on/off. Can also be toggled via hotkey (Default: 'M').",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay
    });

    // --- 2. KEYBINDING ---
    game.keybindings.register(MODULE_ID, "toggleOverlay", {
        name: "Toggle Movement Overlay",
        hint: "Shows or hides the RMU movement range finder.",
        editable: [{ key: "KeyM" }],
        onDown: () => {
            const current = game.settings.get(MODULE_ID, SETTING_ENABLED);
            game.settings.set(MODULE_ID, SETTING_ENABLED, !current);
            const newState = !current;
            ui.notifications.info(`RMU Movement: ${newState ? "Enabled" : "Disabled"}`);
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    // --- 3. LOGIC SETTINGS ---
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

    // --- 4. COLOR SETTINGS (Standard Registration) ---
    // We register these as normal text strings so they appear in the list.
    // The Hook below will turn them into pickers.
    const defaultColors = {
        [SETTING_COLOR_CREEP]:  { name: "Creep",  color: "#00FFFF" }, 
        [SETTING_COLOR_WALK]:   { name: "Walk",   color: "#00FF00" }, 
        [SETTING_COLOR_JOG]:    { name: "Jog",    color: "#ADFF2F" }, 
        [SETTING_COLOR_RUN]:    { name: "Run",    color: "#FFFF00" }, 
        [SETTING_COLOR_SPRINT]: { name: "Sprint", color: "#FFA500" }, 
        [SETTING_COLOR_DASH]:   { name: "Dash",   color: "#FF0000" }  
    };

    for (const [key, data] of Object.entries(defaultColors)) {
        game.settings.register(MODULE_ID, key, {
            name: `Color: ${data.name}`,
            scope: "client",
            config: true, // Show in main list
            type: String,
            default: data.color,
            onChange: refreshOverlay
        });
    }
}

// --- HOOK: Inject Color Pickers into Settings Menu ---
Hooks.on("renderSettingsConfig", (app, html, data) => {
    // This hook runs whenever the "Configure Settings" window opens.
    // We find our text inputs and append a color picker next to them.
    const $html = $(html);
    
    const colorSettings = [
        SETTING_COLOR_CREEP,
        SETTING_COLOR_WALK,
        SETTING_COLOR_JOG,
        SETTING_COLOR_RUN,
        SETTING_COLOR_SPRINT,
        SETTING_COLOR_DASH
    ];

    colorSettings.forEach(key => {
        // Construct the input name Foundry uses (moduleID.settingKey)
        const name = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${name}"]`);
        
        if (input.length) {
            // Create a small color picker input
            const picker = $(`<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0; background: none; cursor: pointer;">`);
            picker.val(input.val());

            // 1. Picker changes -> Update Text Input
            picker.on("change", (e) => {
                input.val(e.target.value);
            });

            // 2. Text Input changes -> Update Picker
            input.on("change", (e) => {
                picker.val(e.target.value);
            });

            // Insert picker after the text box
            input.after(picker);
            
            // Optional: Shrink the text box slightly so they fit nicely
            input.css("flex", "0 0 70%");
        }
    });
});

export function getRoundingMode() {
    return game.settings.get(MODULE_ID, SETTING_ROUNDING);
}

export function getVisualSettings() {
    return {
        enabled: game.settings.get(MODULE_ID, SETTING_ENABLED),
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