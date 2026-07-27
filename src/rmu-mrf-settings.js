/**
 * RMU Movement Range Finder - Settings
 * ------------------------------------
 * Manages module configuration, persistent user preferences, and keybindings.
 * * Architecture Note:
 * This file acts as the single source of truth for all configurable parameters.
 * Instead of querying `game.settings.get()` deep within the mathematical loops
 * (which is highly inefficient), the pathfinding and rendering engines call the
 * exported getter functions here to retrieve bundled configuration objects.
 * Any changes made by the user trigger a global 'rmuMRFRefresh' hook,
 * forcing the engines to synchronise with the new state.
 */

export const MODULE_ID = "rmu-movement-range-finder";

// --- CONSTANTS ---
// Using constants for setting keys prevents typos across getter functions and registration.
const SETTING_ENABLED = "enabled";
const SETTING_SHOW_HOVER_PATH = "showHoverPath";
const SETTING_ROUNDING = "roundingMode";
const SETTING_OPACITY = "opacity";

// Colour Setting Keys
const SETTING_COLOR_CREEP = "colorCreep";
const SETTING_COLOR_WALK = "colorWalk";
const SETTING_COLOR_JOG = "colorJog";
const SETTING_COLOR_RUN = "colorRun";
const SETTING_COLOR_SPRINT = "colorSprint";
const SETTING_COLOR_DASH = "colorDash";
const SETTING_COLOR_ANCHOR = "colorAnchor";
const SETTING_COLOR_PORTAL = "colorPortal";

/**
 * Applies the selected hue class to the Foundry document body.
 * @param {string} hue - The hue string ('gold' or 'teal').
 */
export function applyThemeHue(hue) {
    document.body.classList.remove("rmu-mrf-hue-gold", "rmu-mrf-hue-teal");
    document.body.classList.add(`rmu-mrf-hue-${hue}`);
}

/**
 * Registers all module settings and keybindings with Foundry's core API.
 * Called exactly once during the Foundry 'init' hook.
 */
export function registerSettings() {
    // 1. Master Toggle
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: game.i18n.localize("RMU_MRF.settings.enableOverlay.name"),
        hint: game.i18n.localize("RMU_MRF.settings.enableOverlay.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: refreshOverlay,
    });

    // --- KEYBINDINGS ---
    // Registering via game.keybindings (rather than standard JS event listeners)
    // ensures our hotkeys respect Foundry's native keybinding menu, allowing
    // users to easily rebind them to avoid conflicts with other modules.

    // Toggle Layer Keybinding
    game.keybindings.register(MODULE_ID, "toggleOverlay", {
        name: game.i18n.localize("RMU_MRF.keybindings.toggleOverlay.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.toggleOverlay.hint"),
        editable: [{ key: "KeyM" }],
        onDown: () => {
            const current = game.settings.get(MODULE_ID, SETTING_ENABLED);
            game.settings.set(MODULE_ID, SETTING_ENABLED, !current);
            const newState = !current;
            const message = newState ? game.i18n.localize("RMU_MRF.notifications.enabled") : game.i18n.localize("RMU_MRF.notifications.disabled");
            ui.notifications.info(message);
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    // Reset Anchor Keybinding (Ctrl + M)
    game.keybindings.register(MODULE_ID, "resetAnchor", {
        name: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.resetAnchor.hint"),
        editable: [{ key: "KeyM", modifiers: ["Control"] }],
        onDown: () => {
            Hooks.callAll("rmuMRFResetAnchor");
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    // Toggle Hover Path Keybinding
    game.keybindings.register(MODULE_ID, "toggleHoverPath", {
        name: game.i18n.localize("RMU_MRF.keybindings.toggleHoverPath.name"),
        hint: game.i18n.localize("RMU_MRF.keybindings.toggleHoverPath.hint"),
        editable: [{ key: "KeyP" }],
        onDown: () => {
            const current = game.settings.get(MODULE_ID, SETTING_SHOW_HOVER_PATH);
            const newState = !current;
            game.settings.set(MODULE_ID, SETTING_SHOW_HOVER_PATH, newState);
            const message = newState ? game.i18n.localize("RMU_MRF.notifications.hoverEnabled") : game.i18n.localize("RMU_MRF.notifications.hoverDisabled");
            ui.notifications.info(message);
        },
        restricted: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });

    /**
     * Gridless Resolution (Micro-Grid)
     * Crucial for the Theta* pathfinding algorithm on gridless scenes.
     * Since gridless maps lack discrete nodes, the algorithm overlays a synthetic
     * "micro-grid" to evaluate spatial validity, line-of-sight, and movement costs.
     * A lower resolution (e.g., 5px) creates highly accurate radial boundaries but
     * drastically increases cyclomatic complexity and heap memory usage.
     * Kept as a 'client' scope so players on lower-end hardware can degrade quality for performance.
     */
    game.settings.register(MODULE_ID, "gridlessResolution", {
        name: "Gridless Resolution (Pixels)",
        hint: "Controls the size of the invisible grid on Gridless maps. Lower values create a smoother, more accurate shape but require significantly more PC power. Default is 20.",
        scope: "client",
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
            any: game.i18n.localize("RMU_MRF.settings.movementRounding.choices.any"),
            half: game.i18n.localize("RMU_MRF.settings.movementRounding.choices.half"),
            full: game.i18n.localize("RMU_MRF.settings.movementRounding.choices.full"),
        },
        onChange: refreshOverlay,
    });

    // 3. Visual Settings
    game.settings.register(MODULE_ID, SETTING_SHOW_HOVER_PATH, {
        name: game.i18n.localize("RMU_MRF.settings.showHoverPath.name"),
        hint: game.i18n.localize("RMU_MRF.settings.showHoverPath.hint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: refreshOverlay,
    });

    game.settings.register(MODULE_ID, SETTING_OPACITY, {
        name: game.i18n.localize("RMU_MRF.settings.overlayOpacity.name"),
        hint: game.i18n.localize("RMU_MRF.settings.overlayOpacity.hint"),
        scope: "client",
        config: true,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0.15,
        onChange: refreshOverlay,
    });

    // 4. Colour Settings
    const defaultColors = {
        [SETTING_COLOR_ANCHOR]: { name: "Anchor", color: "#0000AA" },
        [SETTING_COLOR_PORTAL]: { name: "Portal", color: "#800080" },
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

    // 5. UI Theme Hue Setting
    game.settings.register(MODULE_ID, "themeHue", {
        name: game.i18n.localize("RMU_MRF.settings.themeHue.name"),
        hint: game.i18n.localize("RMU_MRF.settings.themeHue.hint"),
        scope: "client",
        config: true,
        type: String,
        choices: {
            gold: game.i18n.localize("RMU_MRF.settings.themeHue.choices.gold"),
            teal: game.i18n.localize("RMU_MRF.settings.themeHue.choices.teal"),
        },
        default: "gold",
        onChange: (value) => applyThemeHue(value),
    });
}

/**
 * DOM Injection Hook: Settings Configuration
 * Foundry's core V1 settings API does not natively render HTML5 colour pickers
 * for string inputs. This hook intercepts the rendering of the settings menu,
 * isolates our specific hex string inputs, and dynamically injects an
 * <input type="color"> element alongside them to significantly improve GM UX.
 */
Hooks.on("renderSettingsConfig", (app, html, data) => {
    const $html = $(html);

    const colorSettings = [SETTING_COLOR_ANCHOR, SETTING_COLOR_PORTAL, SETTING_COLOR_CREEP, SETTING_COLOR_WALK, SETTING_COLOR_JOG, SETTING_COLOR_RUN, SETTING_COLOR_SPRINT, SETTING_COLOR_DASH];

    colorSettings.forEach((key) => {
        const settingName = `${MODULE_ID}.${key}`;
        const input = $html.find(`input[name="${settingName}"]`);

        if (input.length) {
            // 1. Inject HTML5 Colour Picker
            const picker = $(`<input type="color" style="margin-left: 5px; max-width: 40px; height: 26px; border: none; padding: 0; background: none; cursor: pointer;">`);
            picker.val(input.val());

            // Bidirectional binding: Updating the text updates the picker, and vice-versa
            picker.on("change", (e) => input.val(e.target.value));
            input.on("change", (e) => picker.val(e.target.value));

            input.after(picker);
            input.css("flex", "0 0 70%");

            // 2. Localisation and Label Formatting
            const paceName = key.replace("color", "");
            // Safe fallback handles static colours like Portal/Anchor alongside dynamic paces
            const localizedString = game.i18n.has(`RMU_MRF.paces.${paceName}`) ? game.i18n.localize(`RMU_MRF.paces.${paceName}`) : paceName;
            const correctLabel = game.i18n.format("RMU_MRF.settings.colorPace", { pace: localizedString });

            const formGroup = input.closest(".form-group");
            formGroup.find("label").text(correctLabel);
        }
    });
});

// --- EXPORTED CONFIGURATION GETTERS ---

export function getRoundingMode() {
    return game.settings.get(MODULE_ID, SETTING_ROUNDING);
}

/**
 * Bundles all visual and colour settings into a single object.
 * Called constantly by the PIXI.js renderer during updates to dictate layer properties.
 */
export function getVisualSettings() {
    return {
        enabled: game.settings.get(MODULE_ID, SETTING_ENABLED),
        opacity: game.settings.get(MODULE_ID, SETTING_OPACITY),
        showHoverPath: game.settings.get(MODULE_ID, SETTING_SHOW_HOVER_PATH),
        colors: {
            Anchor: game.settings.get(MODULE_ID, SETTING_COLOR_ANCHOR),
            Portal: game.settings.get(MODULE_ID, SETTING_COLOR_PORTAL),
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

/**
 * Emits a global hook to immediately force a full overlay recalculation.
 * Attached as the 'onChange' callback for all settings that affect calculations or rendering.
 */
function refreshOverlay() {
    Hooks.callAll("rmuMRFRefresh");
}
