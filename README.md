# RMU Movement Range Finder

![Latest Version](https://img.shields.io/badge/Version-1.0.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry-v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System](https://img.shields.io/badge/System-RMU-blue)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/rmu-movement-range-finder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/latest/rmu-movement-range-finder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/rmu-movement-range-finder)
![Issues](https://img.shields.io/github/issues/Filroden/rmu-movement-range-finder)

**RMU Movement Range Finder** is a tactical aid for the *Rolemaster Unified* (RMU) system. It calculates and visualises how far a token can move based on their Base Movement Rate and the cost of the grid, taking into account walls and movement paces (Walk, Run, Sprint, etc.).

*Rolemaster Unified* does not currently have official rules for grid-based movement, so this module calculates the exact distance between grid centres and shows any remaining movement in the outermost grid squares to stay as true to the Rules As Written when using a grid-based map.

It features an **"Anchor & Scout"** system that allows players to move their token to "peek" around corners without losing track of their original movement starting point.

## Features

* **Anchor & Scout Logic:**
  * **The Anchor:** When you first select a token, the module remembers where you started. The coloured grid always shows your movement budget from that starting point. The Anchor point remains persistent until reset. To reset the Anchor, the default key press is **`Control-M`**.
  * **The Scout:** As you move your token, the overlay updates visibility. You can see into new rooms and corridors as if you were moving there, but the movement cost is always calculated from the start of your move.
* **Dynamic Pathfinding:** Calculates movement costs around corners and obstacles. It automatically detects when doors are opened or walls are removed and recalculates the path.
* **Visual Paces:** Displays distinct coloured overlays for different movement paces (Creep, Walk, Jog, Run, Sprint, Dash).
* **Action Point Limit:** Automatically highlights the boundary of the **1 AP** limit with a thicker border, helping players manage their action economy.
* **Metric Support:** Automatically detects if a scene is using metres and scales the underlying calculations to match RMU standards.

## Experimental Modes

While this module is designed primarily for **Square Grids**, it includes experimental support for other grid types. These must be enabled in the module settings.

* **Hex Grids (Experimental):** Hex grids generally work in open areas, but may experience "leaks" (movement passing through walls) in tight dungeons due to how VTT geometry handles hex centres vs. wall lines.
* **Gridless (Experimental):** Uses a "Crow Flies" (Euclidean) distance calculation. This mode ignores walls and simply draws range rings anchored to your starting position. Again, this is okay for open spaces, but is less helpful for tight dungeons.

I am working on a new pathfinding algorithm for version 2 that will work on any map and provide exact movement ranges, taking into account corners, etc., which will resolve these issues.

## How to Use

1. **Toggle Visibility:** Press **`M`** (default hotkey) to toggle the overlay on or off.
2. **Create Anchor:** Select a Token and press `Control-M`(default hotkey). This will "anchor" the token's starting position.
3. **Move:** Move your token along the path you wish to take. The overlay will remain anchored to your start point, but will reveal new areas as your token's vision moves.

## Settings

* **Rounding Rules:** (World Setting) Choose between "Permissive" (enter square if >0 movement remains), "Standard" (enter if >50% remains), or "Strict" (must have 100% cost).
* **Enable Experimental Support:** (World Setting) Enable experimental support for hex and/or gridless maps.
* **Opacity:** (Player Setting) Adjust how transparent the grid overlay is.
* **Labels:** (Player Setting) Toggle text labels showing the exact distance cost on every square.
* **Colour Palette:** (Player Setting) Customise the colours for every pace (Creep through Dash) using the colour picker.

## Important Note on Visibility

To prevent this module from revealing parts of the map that players should not see, you must ensure your Scene is configured correctly:

1. **Scene Settings:** "Token Vision" and "Fog of War" must be enabled.
2. **Token Settings:** The player's token must have "Vision" enabled.

**If these are disabled, the module may draw the movement grid in unexplored/hidden rooms.**

## Installation

1. In Foundry VTT, go to the **Add-on Modules** tab.
2. Click **Install Module**.
3. Search for "RMU Movement Range Finder" or paste the manifest URL:
    `https://github.com/Filroden/rmu-movement-range-finder/releases/latest/download/module.json`

## Compatibility

* **Foundry VTT:** Version 13+ is required.
* **System:** Designed for *Rolemaster Unified* (RMU).

## License

This module is licensed under the [MIT License](LICENSE).
