# RMU Movement Range Finder

![Latest Version](https://img.shields.io/badge/Version-1.4.0-blue)
![Foundry Version](https://img.shields.io/badge/Foundry-v13-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)
![System](https://img.shields.io/badge/System-RMU-blue)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/rmu-movement-range-finder.zip)
![Download Count](https://img.shields.io/github/downloads/Filroden/rmu-movement-range-finder/latest/rmu-movement-range-finder.zip)
![Last Commit](https://img.shields.io/github/last-commit/Filroden/rmu-movement-range-finder)
![Issues](https://img.shields.io/github/issues/Filroden/rmu-movement-range-finder)

**RMU Movement Range Finder** is a tactical aid for the *Rolemaster Unified* (RMU) system that visualises movement for gridless, square, and hex maps. It calculates exactly how far a token can move based on their Base Movement Rate and the map's terrain, seamlessly routing around walls and obstacles. It also highlights the movement area using colour-graduated cells based on movement paces (Walk, Run, Sprint, etc.) to help determine pace penalties when moving while acting.

*Rolemaster Unified* does not currently have official rules for grid-based movement. To stay as true to "Rules As Written" as possible, the module calculates the exact distance between grid centres and displays any remaining movement in the outermost grid squares.
> ***Note**: Because tokens must occasionally zig-zag to follow straight lines on Hex grids, you may notice a rough 15% "hex movement tax" loss of range on those maps.*

> ***Note**: The module does not take into account a token's size, leaving it to each table to decide their own rules for squeezing through tight spaces.*

## How it works

It features an **"Anchor & Scout"** system that allows players to move their token to "peek" around corners without losing track of their original movement starting point.

![Anchor and Scout system](https://github.com/Filroden/rmu-movement-range-finder/blob/main/assets/screenshots/anchor_and_scout.gif)

* **Anchor & Scout Logic:**
  * **The Anchor:** When you first select a token, the module remembers where you started. The coloured grid always shows your movement budget from that starting point. The Anchor point remains persistent until reset.
  * **The Scout:** As you move your token, the overlay dynamically updates visibility. You can see into new rooms and corridors as if you were moving there, but the movement cost is always calculated from your Anchor.
* **Organic Gridless Pathfinding:** On gridless maps, the module abandons rigid squares and uses advanced Theta\* algorithms to draw smooth, true-Euclidean movement circles that fluidly wrap around corners and walls.
* **Visual Paces & Action Limits:** Displays distinct coloured overlays for different movement paces (Creep, Walk, Jog, Run, Sprint, Dash). It automatically highlights the boundary of the **1 AP** limit with a thicker border, helping players manage their action economy.
* **Metric Support:** Automatically detects if a scene is using metres and scales the underlying calculations to match RMU standards.

## How to use it

1. **Toggle Visibility:** Press `M` (default hotkey) to toggle the overlay on or off.
2. **Create a new Anchor:** Select a Token and press `Ctrl + M` (default hotkey). This will "anchor" the token's starting position.
3. **Move:** Move your token along the path you wish to take. The overlay will remain anchored to your starting point. You will reveal new areas as your token's vision moves or as doors open. Press `Ctrl + M` again whenever you want to lock in a new anchor point.

## Game settings

* **Rounding Rules:** (World Setting) Choose between "Permissive" (enter square if >0 movement remains), "Standard" (enter if >50% remains), or "Strict" (must have 100% cost).
* **Gridless Resolution:** (Player Setting) Controls the visual fidelity of the movement boundary on Gridless maps. Lower values create smoother shapes but require significantly more PC power.
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
