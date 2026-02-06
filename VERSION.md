# Version History

| Version | Changes |
| :--- | :--- |
| **Version 1.0.1** | **BUG FIXES**<br>* Fixed missing pace names in the game settings.|
| **Version 1.0.0** | **INITIAL RELEASE**<br>* **Anchor Reset:** Anchor position is persistent until reset. The default keypress to reset the Anchor point is Control-M.<br>* **Opacity:** Opacity can now be set in 0.05 steps. This is particularly useful for games where movement is usually taken as an action, and the colour fill of the grid is less relevant.<br>* **Grid borders:** Removed the heavier borders on grids in the "sprint" zone. On square grids there is still a thick outer boundary border drawn to represent the limit of 1AP / 1xBMR.|
| **Version 1.0.0-beta1** | **BETA 1 RELEASE**<br>* **Anchor & Scout System:** Move tokens to reveal fog without losing the movement origin point.<br>* **Pathfinding:** Full Dijkstra algorithm support for Square grids, respecting walls and doors.<br>* **Metric Support:** Auto-scaling for metric scenes.<br>* **Experimental Support:** Added opt-in support for Hex and Gridless maps.<br>* **Customisation:** Full control over colours, opacity, and rounding rules via Settings.|