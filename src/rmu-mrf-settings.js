/**
 * RMU Movement Range Finder - Settings
 * ------------------------------------
 * Manages module configuration.
 * Uses a DOM-injection hook to enhance the standard settings menu with 
 * native HTML colour pickers and properly localised labels.
 */

export const MODULE_ID = "rmu-movement-range-finder";

export const SETTING_ENABLED = "enableOverlay";
export const SETTING_ROUNDING = "movementRounding";
export const SETTING_OPACITY = "overlayOpacity";
export const SETTING_SHOW_LABELS = "showDistanceLabels";

// Experimental Toggles
export const SETTING_EXPERIMENTAL_HEX = "experimentalHex"; 
export const SETTING_EXPERIMENTAL_GRIDLESS = "experimentalGridless";

// Colour Setting Keys
export const SETTING_COLOR_CREEP  = "colorCreep";
export const SETTING_COLOR_WALK   = "colorWalk";
export const SETTING_COLOR_JOG    = "colorJog";
export const SETTING_COLOR_RUN    = "colorRun";
export const SETTING_COLOR_SPRINT = "colorSprint";
export const SETTING_COLOR_DASH   = "colorDash";

/**
 * Register all module settings.
 */
export function registerSettings() {

    // 1. Master Toggle & Keybindings
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: game.i18n.localize("RMU_MRF.settings.enableOverlay.name"),
        hint: game.i18n.localize("RMU_MRF.settings.enableOverlay.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay
    });

    game.keybindings.register(MODULE_ID, "toggleOverlay", {
        name: game.i18n.localize("RMU_MRF.keybindings.toggleOverlay.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.toggleOverlay.hint"),
        editable: [{ key: "KeyM" }],
        onDown: () => {
            const current = game.settings.get(MODULE_ID, SETTING_ENABLED);
            game.settings.set(MODULE_ID, SETTING_ENABLED, !current);
            const newState = !current;
            const message = newState 
                ? game.i18n.localize("RMU_MRF.notifications.enabled") 
                : game.i18n.localize("RMU_MRF.notifications.disabled");
            ui.notifications.info(message);
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    // Reset Anchor Keybinding
    game.keybindings.register(MODULE_ID, "resetAnchor", {
        name: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.hint"),
        editable: [{ key: "KeyM", modifiers: [ "Control" ] }], // Ctrl + M
        onDown: () => {
            Hooks.callAll("rmuMRFResetAnchor");
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });

    // 2. Logic Settings
    game.settings.register(MODULE_ID, SETTING_ROUNDING, {
        name: game.i18n.localize("RMU_MRF.settings.movementRounding.name"),
        hint: game.i18n.localize("RMU_MRF.settings.movementRounding.hint"),
        scope: "world",
        config: true,
        type: String,
        default: "full",
        choices: {
            "any": game.i18n.localize("RMU_MRF.settings.movementRounding.choices.any"),
            "half": game.i18n.localize("RMU_MRF.settings.movementRounding.choices.half"),
            "full": game.i18n.localize("RMU_MRF.settings.movementRounding.choices.full")
        },
        onChange: refreshOverlay
    });

    // 3. Experimental Toggles
    game.settings.register(MODULE_ID, SETTING_EXPERIMENTAL_HEX, {
        name: game.i18n.localize("RMU_MRF.settings.experimentalHex.name"),
        hint: game.i18n.localize("RMU_MRF.settings.experimentalHex.hint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: false, 
        onChange: refreshOverlay
    });

    game.settings.register(MODULE_ID, SETTING_EXPERIMENTAL_GRIDLESS, {
        name: game.i18n.localize("RMU_MRF.settings.experimentalGridless.name"),
        hint: game.i18n.localize("RMU_MRF.settings.experimentalGridless.hint"),
        scope: "world",
        config: true,
        type: Boolean,
        default: false, 
        onChange: refreshOverlay
    });

    // 4. Visual Settings
    game.settings.register(MODULE_ID, SETTING_OPACITY, {
        name: game.i18n.localize("RMU_MRF.settings.overlayOpacity.name"),
        hint: game.i18n.localize("RMU_MRF.settings.overlayOpacity.hint"),
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0.0, max: 1.0, step: 0.05 },
        default: 0.4,
        onChange: refreshOverlay
    });

    game.settings.register(MODULE_ID, SETTING_SHOW_LABELS, {
        name: game.i18n.localize("RMU_MRF.settings.showDistanceLabels.name"),
        hint: game.i18n.localize("RMU_MRF.settings.showDistanceLabels.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay
    });

    // 5. Colour Settings
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
            config: true,
            type: String,
            default: data.color,
            onChange: refreshOverlay
        });
    }
}

// Hook: Inject Colour Pickers and Labels
Hooks.on("renderSettingsConfig", (app, html, data) => {
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
        const settingName = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${settingName}"]`);
        
        if (input.length) {
            // 1. Inject Colour Picker
            const picker = $(`<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0; background: none; cursor: pointer;">`);
            picker.val(input.val());
            picker.on("change", (e) => input.val(e.target.value));
            input.on("change", (e) => picker.val(e.target.value));
            input.after(picker);
            input.css("flex", "0 0 70%");

            // 2. Label Formatting
            const paceName = key.replace("color", ""); 
            const localizedPace = game.i18n.localize(`RMU_MRF.paces.${paceName}`);
            const correctLabel = game.i18n.format("RMU_MRF.settings.colorPace", { pace: localizedPace });

            // Find the label element in the form group and update text
            const formGroup = input.closest(".form-group");
            formGroup.find("label").text(correctLabel);
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
        experimentalHex: game.settings.get(MODULE_ID, SETTING_EXPERIMENTAL_HEX),
        experimentalGridless: game.settings.get(MODULE_ID, SETTING_EXPERIMENTAL_GRIDLESS), 
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