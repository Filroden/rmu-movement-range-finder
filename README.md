# RMU Movement Range Finder (Foundry V13)

A tactical movement visualizer for the **Rolemaster Unified (RMU)** system in Foundry VTT v13.

![Movement Preview](https://placehold.co/600x400?text=Tactical+Movement+Overlay)

This module automatically calculates and displays the exact movement range for a selected token, broken down by RMU Paces (Creep, Walk, Jog, Run, Sprint, Dash). It accounts for **walls, doors, difficult terrain geometry**, and even handles **large tokens** correctly.

## Features

### 🟢 Tactical Flood Fill (Grid Mode)
When you select a token on a Square Grid scene:
- **Wall-Aware:** Movement flows around walls and through open doors.
- **Pace-Aware:** Shows exactly how far you can go at each Pace setting.
- **Large Tokens:** Correctly calculates range from the *edge* of tokens larger than 1x1 (e.g., Giants, Dragons).
- **Rounding Logic:** Configurable settings for how to handle "partial" squares at the end of a move.

### 🔵 Range Rings (Gridless Mode)
When you select a token on a Gridless scene:
- Draws concentric rings indicating the maximum "Crow Flies" distance for each pace.
- Useful for theater-of-mind or rough range estimation.

### 🎨 Customizable "X-COM" Style
- Comes with a preset "Tactical Blue" color scheme inspired by classic turn-based strategy games.
- Fully customizable colors and opacity in Module Settings.

## Installation

1.  Copy this folder to your `Data/modules/` directory.
2.  Launch Foundry VTT.
3.  Enable **RMU Movement Range Finder** in "Manage Modules".

## Usage

1.  **Select a Token:** The movement overlay appears instantly.
2.  **Move/Drag:** The overlay updates (or persists) to help you measure your step.
3.  **Deselect:** The overlay disappears.

### Settings
Go to **Configure Settings > Module Settings** to adjust:
- **Rounding Rule:**
    - *Strict (Default):* You must have 100% of the movement required to enter a square.
    - *Standard:* You can enter if you have >50% of the cost remaining.
    - *Permissive:* You can enter if you have ANY movement left (>0).
- **Colors & Opacity:** Change the colors for Walk, Jog, Run, etc. to match your table's aesthetic.

## Compatibility

-   **Foundry VTT:** v13+ (Verified 13.351)
-   **System:** Rolemaster Unified (RMU)
-   **Grid Types:** Square Grid, Gridless (Hex support experimental).

## Technical Details for GMs

-   **Performance:** Uses a custom Dijkstra implementation optimized for V13's new grid API.
-   **Calculations:** Reads derived movement data directly from `actor.system._movementBlock`, ensuring it respects Encumbrance, Injuries, and Talents automatically calculated by the RMU system.

## License

MIT License.