/**
 * RMU Movement Range Finder - Settings
 * ------------------------------------
 * Manages module configuration.
 * Uses a DOM-injection hook to enhance the standard settings menu with
 * native HTML colour pickers and properly localised labels.
 */

export const MODULE_ID = "rmu-movement-range-finder";

// --- CONSTANTS ---
const SETTING_ENABLED = "enabled";
const SETTING_ROUNDING = "roundingMode";
const SETTING_OPACITY = "opacity";
const SETTING_SHOW_LABELS = "showLabels";

// Colour Setting Keys
const SETTING_COLOR_CREEP = "colorCreep";
const SETTING_COLOR_WALK = "colorWalk";
const SETTING_COLOR_JOG = "colorJog";
const SETTING_COLOR_RUN = "colorRun";
const SETTING_COLOR_SPRINT = "colorSprint";
const SETTING_COLOR_DASH = "colorDash";
const SETTING_COLOR_ANCHOR = "colorAnchor";

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
        onChange: refreshOverlay,
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
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    // Reset Anchor Keybinding
    game.keybindings.register(MODULE_ID, "resetAnchor", {
        name: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.hint"),
        editable: [{ key: "KeyM", modifiers: ["Control"] }], // Ctrl + M
        onDown: () => {
            Hooks.callAll("rmuMRFResetAnchor");
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    game.settings.register(MODULE_ID, "gridlessResolution", {
        name: "Gridless Resolution (Pixels)",
        hint: "Controls the size of the invisible grid on Gridless maps. Lower values create a smoother, more accurate shape but require significantly more PC power. Default is 20.",
        scope: "client", // "client" lets each player pick what their PC can handle
        config: true,
        type: Number,
        range: {
            min: 5,
            max: 50,
            step: 5,
        },
        default: 20,
        onChange: () => Hooks.callAll("rmuMRFRefresh"),
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
            any: game.i18n.localize(
                "RMU_MRF.settings.movementRounding.choices.any",
            ),
            half: game.i18n.localize(
                "RMU_MRF.settings.movementRounding.choices.half",
            ),
            full: game.i18n.localize(
                "RMU_MRF.settings.movementRounding.choices.full",
            ),
        },
        onChange: refreshOverlay,
    });

    // 3. Visual Settings
    game.settings.register(MODULE_ID, SETTING_OPACITY, {
        name: game.i18n.localize("RMU_MRF.settings.overlayOpacity.name"),
        hint: game.i18n.localize("RMU_MRF.settings.overlayOpacity.hint"),
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0.0, max: 1.0, step: 0.05 },
        default: 0.15,
        onChange: refreshOverlay,
    });

    game.settings.register(MODULE_ID, SETTING_SHOW_LABELS, {
        name: game.i18n.localize("RMU_MRF.settings.showDistanceLabels.name"),
        hint: game.i18n.localize("RMU_MRF.settings.showDistanceLabels.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay,
    });

    // 4. Colour Settings
    const defaultColors = {
        [SETTING_COLOR_ANCHOR]: { name: "Anchor", color: "#0000AA" },
        [SETTING_COLOR_CREEP]: { name: "Creep", color: "#00FFFF" },
        [SETTING_COLOR_WALK]: { name: "Walk", color: "#00FF00" },
        [SETTING_COLOR_JOG]: { name: "Jog", color: "#ADFF2F" },
        [SETTING_COLOR_RUN]: { name: "Run", color: "#FFFF00" },
        [SETTING_COLOR_SPRINT]: { name: "Sprint", color: "#FFA500" },
        [SETTING_COLOR_DASH]: { name: "Dash", color: "#FF0000" },
    };

    for (const [key, data] of Object.entries(defaultColors)) {
        game.settings.register(MODULE_ID, key, {
            name: `Color: ${data.name}`,
            scope: "client",
            config: true,
            type: String,
            default: data.color,
            onChange: refreshOverlay,
        });
    }
}

// Hook: Inject Colour Pickers and Labels
Hooks.on("renderSettingsConfig", (app, html, data) => {
    const $html = $(html);

    const colorSettings = [
        SETTING_COLOR_ANCHOR,
        SETTING_COLOR_CREEP,
        SETTING_COLOR_WALK,
        SETTING_COLOR_JOG,
        SETTING_COLOR_RUN,
        SETTING_COLOR_SPRINT,
        SETTING_COLOR_DASH,
    ];

    colorSettings.forEach((key) => {
        const settingName = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${settingName}"]`);

        if (input.length) {
            // 1. Inject Colour Picker
            const picker = $(
                `<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0; background: none; cursor: pointer;">`,
            );
            picker.val(input.val());
            picker.on("change", (e) => input.val(e.target.value));
            input.on("change", (e) => picker.val(e.target.value));
            input.after(picker);
            input.css("flex", "0 0 70%");

            // 2. Label Formatting
            const paceName = key.replace("color", "");
            const localizedPace = game.i18n.localize(
                `RMU_MRF.paces.${paceName}`,
            );
            const correctLabel = game.i18n.format(
                "RMU_MRF.settings.colorPace",
                { pace: localizedPace },
            );

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
        colors: {
            Anchor: game.settings.get(MODULE_ID, SETTING_COLOR_ANCHOR),
            Creep: game.settings.get(MODULE_ID, SETTING_COLOR_CREEP),
            Walk: game.settings.get(MODULE_ID, SETTING_COLOR_WALK),
            Jog: game.settings.get(MODULE_ID, SETTING_COLOR_JOG),
            Run: game.settings.get(MODULE_ID, SETTING_COLOR_RUN),
            Sprint: game.settings.get(MODULE_ID, SETTING_COLOR_SPRINT),
            Dash: game.settings.get(MODULE_ID, SETTING_COLOR_DASH),
        },
    };
}

export function getGridlessResolution() {
    return game.settings.get(MODULE_ID, "gridlessResolution");
}

function refreshOverlay() {
    Hooks.callAll("rmuMRFRefresh");
}
