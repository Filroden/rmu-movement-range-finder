/**
 * RMU Movement Range Finder - Renderer
 * ------------------------------------
 * Handles the drawing of the visual overlay using PIXI Graphics.
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];
const FT_PER_METER = 3.33333;

export function drawOverlay(token, data, mode, anchor) {
    clearOverlay();
    const settings = getVisualSettings();

    // Grid mode (Square & Hex)
    _drawGridHighlight(token, data, settings);
}

export function clearOverlay() {
    const container = canvas.interface.reverseMask || canvas.interface;
    const toRemove = container.children.filter(
        (c) => c.name === "rmuMovementGraphics" || c.name === "rmuMovementRing",
    );

    toRemove.forEach((c) => {
        // Detach our cached text objects before destroying
        // the graphics container so PIXI doesn't garbage collect them!
        c.removeChildren();
        c.destroy();
    });

    if (container._rmuHoverListener) {
        container.off("pointermove", container._rmuHoverListener);
        container._rmuHoverListener = null;
    }
}

/**
 * Draws the highlighted grid squares/hexes AND the boundary lines.
 */
function _drawGridHighlight(token, squareMap, settings) {
    const container = canvas.interface.reverseMask || canvas.interface;
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics";
    graphics.eventMode = "none";

    const gridSize = canvas.scene.grid.size;
    const fontSize = Math.max(10, Math.floor(gridSize * 0.15));

    const textStyle = new PIXI.TextStyle({
        fontFamily: "Arial",
        fontSize: fontSize,
        fontWeight: "bold",
        fill: "white",
        stroke: "black",
        strokeThickness: 3,
        align: "center",
    });
    const gridUnit = canvas.scene.grid.units || "ft";

    // OPTIMISATION: Hoist invariant variables outside the loop
    const isPlayerToken = token.document.hasPlayerOwner;
    const shouldEnforceFog = !game.user.isGM || isPlayerToken;

    // Check if we are faking a micro-grid on a gridless map
    const isGridless = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;

    // Calculate the ratio between the micro-grid and the scene grid
    // E.g., if scene grid is 100px and micro-grid is 20px, ratio is 5.
    let microGridRatio = 1;
    if (isGridless) {
        // We use squareMap.values().next().value.w to safely grab the micro-grid size
        const sampleSquare = squareMap.values().next().value;
        if (sampleSquare) {
            microGridRatio = Math.floor(
                canvas.scene.grid.size / sampleSquare.w,
            );
            if (microGridRatio < 1) microGridRatio = 1;
        }
    }

    // --- PASS 1: DRAW CELLS (Fill & Text) ---
    for (const [key, square] of squareMap) {
        const isHex = square.gridType !== CONST.GRID_TYPES.SQUARE;

        if (square.centerX === undefined) {
            if (isHex) {
                const center = canvas.grid.getCenterPoint({
                    i: square.i,
                    j: square.j,
                });
                square.centerX = center.x;
                square.centerY = center.y;
            } else {
                square.centerX = square.x + square.w / 2;
                square.centerY = square.y + square.h / 2;
            }
        }

        if (shouldEnforceFog) {
            const isExplored = canvas.fog.isPointExplored({
                x: square.centerX,
                y: square.centerY,
            });
            const isVisible = canvas.visibility.testVisibility(
                { x: square.centerX, y: square.centerY },
                { object: token },
            );

            square.isHiddenByFog = !isExplored && !isVisible;
            if (square.isHiddenByFog) continue;
        } else {
            square.isHiddenByFog = false;
        }

        if (square.colorInt === undefined) {
            square.colorInt = Color.from(square.color).valueOf();
        }

        const drawOpacity = square.isSafe
            ? settings.opacity
            : settings.opacity * 0.4;

        graphics.beginFill(square.colorInt, drawOpacity);

        // HIDE INTERIOR BORDERS ON GRIDLESS
        if (isGridless) {
            graphics.lineStyle(0);
        } else {
            graphics.lineStyle(1, 0x000000, 0.3);
        }

        if (isHex) {
            if (square.flatVertices === undefined) {
                const vertices = canvas.grid.getVertices({
                    i: square.i,
                    j: square.j,
                });
                square.flatVertices = [];
                if (vertices) {
                    for (const p of vertices)
                        square.flatVertices.push(p.x, p.y);
                }
            }
            if (square.flatVertices.length > 0) {
                graphics.drawPolygon(square.flatVertices);
            }
        } else {
            graphics.drawRect(square.x, square.y, square.w, square.h);
        }
        graphics.endFill();

        // NEW: SPARSE LABELS FOR GRIDLESS
        let showGridlessLabel = false;
        if (isGridless) {
            // Only flag true if both X and Y micro-coordinates are multiples of the ratio.
            // This draws exactly one label per scene grid square (e.g., every 5 feet).
            showGridlessLabel =
                square.i % microGridRatio === 0 &&
                square.j % microGridRatio === 0;
        }

        // Apply the Sparse Label logic
        if (
            settings.showLabels &&
            square.isSafe &&
            (!isGridless || showGridlessLabel)
        ) {
            if (!square.textObj || square.textObj.destroyed) {
                const dist = parseFloat(square.cost.toFixed(1));
                const labelText = `${dist} ${gridUnit}`;
                square.textObj = new PIXI.Text(labelText, textStyle);
                square.textObj.anchor.set(0.5);
                square.textObj.position.set(square.centerX, square.centerY);
            }
            graphics.addChild(square.textObj);
        }
    }

    // --- PASS 2: DRAW LIMIT BOUNDARY LINES (Thick Border) ---
    for (const [key, square] of squareMap) {
        if (!square.isInnerZone) continue;

        // Skip if hidden by fog (Using state cached in Pass 1!)
        if (square.isHiddenByFog) continue;

        // CACHE: Limit Color
        if (square.limitColorInt === undefined) {
            square.limitColorInt = Color.from(square.limitColor).valueOf();
        }
        graphics.lineStyle(4, square.limitColorInt, 1.0);

        // CACHE: Heavy Border Geometric Math
        if (square.borderLines === undefined) {
            square.borderLines = [];

            if (square.gridType === CONST.GRID_TYPES.SQUARE) {
                const x = square.x,
                    y = square.y,
                    w = square.w,
                    h = square.h;
                const top = squareMap.get(
                    `${Math.round(x)}.${Math.round(y - h)}`,
                );
                const bottom = squareMap.get(
                    `${Math.round(x)}.${Math.round(y + h)}`,
                );
                const left = squareMap.get(
                    `${Math.round(x - w)}.${Math.round(y)}`,
                );
                const right = squareMap.get(
                    `${Math.round(x + w)}.${Math.round(y)}`,
                );

                if (!top || !top.isInnerZone)
                    square.borderLines.push({ x1: x, y1: y, x2: x + w, y2: y });
                if (!bottom || !bottom.isInnerZone)
                    square.borderLines.push({
                        x1: x,
                        y1: y + h,
                        x2: x + w,
                        y2: y + h,
                    });
                if (!left || !left.isInnerZone)
                    square.borderLines.push({ x1: x, y1: y, x2: x, y2: y + h });
                if (!right || !right.isInnerZone)
                    square.borderLines.push({
                        x1: x + w,
                        y1: y,
                        x2: x + w,
                        y2: y + h,
                    });
            } else {
                const vertices = canvas.grid.getVertices({
                    i: square.i,
                    j: square.j,
                });
                const neighbors = canvas.grid.getAdjacentOffsets({
                    i: square.i,
                    j: square.j,
                });

                if (vertices && vertices.length >= 6) {
                    for (let v = 0; v < 6; v++) {
                        const p1 = vertices[v];
                        const p2 = vertices[(v + 1) % 6];
                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2;

                        let closestNeighbor = null;
                        let minDst = Infinity;

                        for (const n of neighbors) {
                            const nCenter = canvas.grid.getCenterPoint({
                                i: n.i,
                                j: n.j,
                            });
                            const d = Math.hypot(
                                nCenter.x - midX,
                                nCenter.y - midY,
                            );
                            if (d < minDst) {
                                minDst = d;
                                closestNeighbor = n;
                            }
                        }

                        if (closestNeighbor) {
                            const nTopLeft = canvas.grid.getTopLeftPoint({
                                i: closestNeighbor.i,
                                j: closestNeighbor.j,
                            });
                            const nKey = `${Math.round(nTopLeft.x)}.${Math.round(nTopLeft.y)}`;
                            const neighborData = squareMap.get(nKey);

                            if (!neighborData || !neighborData.isInnerZone) {
                                square.borderLines.push({
                                    x1: p1.x,
                                    y1: p1.y,
                                    x2: p2.x,
                                    y2: p2.y,
                                });
                            }
                        }
                    }
                }
            }
        }

        // Draw the cached lines instantly without any math
        for (const line of square.borderLines) {
            graphics.moveTo(line.x1, line.y1);
            graphics.lineTo(line.x2, line.y2);
        }
    }

    container.addChild(graphics);
}
