# RMU Movement Range Finder

![Latest Version](https://img.shields.io/badge/Version-1.2.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry-v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System](https://img.shields.io/badge/System-RMU-blue)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/rmu-movement-range-finder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/latest/rmu-movement-range-finder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/rmu-movement-range-finder)
![Issues](https://img.shields.io/github/issues/Filroden/rmu-movement-range-finder)

**RMU Movement Range Finder** is a tactical aid for the *Rolemaster Unified* (RMU) system to support movement for square and hex grids. It calculates and visualises how far a token can move based on their Base Movement Rate and the cost of the grid, taking into account walls. It also shows colour graduated grid cells based on movement paces (Walk, Run, Sprint, etc.) to help determine pace penalty if moving while acting.

*Rolemaster Unified* does not currently have official rules for grid-based movement, so this module calculates the exact distance between grid centres and shows any remaining movement in the outermost grid squares to stay as true to the Rules As Written when using a grid-based map. It does not take into account a token's size, leaving it to each table to decide their own rules for what size can squeeze through what space.

Note that there is a "hex movement tax", with a rough 15% loss of range because tokens often have to zigzag to move rather than follow straight line paths on square grids.

This module does not support movement range finding on gridless scenes yet. This is planned for a future major update.

## How it works

It features an **"Anchor & Scout"** system that allows players to move their token to "peek" around corners without losing track of their original movement starting point.

![Anchor and Scout system](https://github.com/Filroden/rmu-movement-range-finder/blob/main/assets/screenshots/anchor_and_scout.gif)

* **Anchor & Scout Logic:**
  * **The Anchor:** When you first select a token, the module remembers where you started. The coloured grid always shows your movement budget from that starting point. The Anchor point remains persistent until reset. To reset the Anchor, the default key press is **`Control-M`**.
  * **The Scout:** As you move your token, the overlay updates visibility. You can see into new rooms and corridors as if you were moving there, but the movement cost is always calculated from the start of your move.
* **Dynamic Pathfinding:** Calculates movement costs around corners and obstacles. It automatically detects when doors are opened or walls are removed and recalculates the path.
* **Visual Paces:** Displays distinct coloured overlays for different movement paces (Creep, Walk, Jog, Run, Sprint, Dash).
* **Action Point Limit:** Automatically highlights the boundary of the **1 AP** limit with a thicker border, helping players manage their action economy.
* **Metric Support:** Automatically detects if a scene is using metres and scales the underlying calculations to match RMU standards.

## How to use it

1. **Toggle Visibility:** Press **`m`** (default hotkey) to toggle the overlay on or off.
2. **Create a new Anchor:** Select a Token and press `Control-m`(default hotkey). This will "anchor" the token's starting position.
3. **Move:** Move your token along the path you wish to take. The overlay will remain anchored to your starting point. You will reveal new areas as your token's vision moves or as doors open, etc. Then just press `Control-m` again if you want to create a new anchor point.

## Game settings

* **Rounding Rules:** (World Setting) Choose between "Permissive" (enter square if >0 movement remains), "Standard" (enter if >50% remains), or "Strict" (must have 100% cost).
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
