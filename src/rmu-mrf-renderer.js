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

    if (data.type === "gridless") {
        // Gridless mode (Legacy/Future support)
        _drawConcentricRings(token, data, settings, anchor);
    } else {
        // Grid mode (Square & Hex)
        _drawGridHighlight(token, data, settings);
    }
}

export function clearOverlay() {
    const container = canvas.interface.reverseMask || canvas.interface;
    const toRemove = container.children.filter(
        (c) => c.name === "rmuMovementGraphics" || c.name === "rmuMovementRing",
    );
    toRemove.forEach((c) => c.destroy());

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

    // --- PASS 1: DRAW CELLS (Fill & Text) ---
    for (const [key, square] of squareMap) {
        let centerX, centerY;
        const isHex = square.gridType !== CONST.GRID_TYPES.SQUARE;

        if (isHex) {
            const center = canvas.grid.getCenterPoint({
                i: square.i,
                j: square.j,
            });
            centerX = center.x;
            centerY = center.y;
        } else {
            centerX = square.x + square.w / 2;
            centerY = square.y + square.h / 2;
        }

        // Fog Check
        const isPlayerToken = token.document.hasPlayerOwner;
        const shouldEnforceFog = !game.user.isGM || isPlayerToken;

        if (shouldEnforceFog) {
            const isExplored = canvas.fog.isPointExplored({
                x: centerX,
                y: centerY,
            });
            const isVisible = canvas.visibility.testVisibility(
                { x: centerX, y: centerY },
                { object: token },
            );
            if (!isExplored && !isVisible) continue;
        }

        const colorInt = Color.from(square.color).valueOf();

        // Ghost Mode: Lower opacity for Unsafe (Bridge/Wall) cells
        const drawOpacity = square.isSafe
            ? settings.opacity
            : settings.opacity * 0.4;

        graphics.beginFill(colorInt, drawOpacity);
        graphics.lineStyle(1, 0x000000, 0.3);

        if (isHex) {
            const vertices = canvas.grid.getVertices({
                i: square.i,
                j: square.j,
            });
            if (vertices && vertices.length > 0) {
                const flatPoints = [];
                for (const p of vertices) flatPoints.push(p.x, p.y);
                graphics.drawPolygon(flatPoints);
            }
        } else {
            graphics.drawRect(square.x, square.y, square.w, square.h);
        }
        graphics.endFill();

        // Only draw text labels on SAFE squares
        if (settings.showLabels && square.isSafe) {
            const dist = parseFloat(square.cost.toFixed(1));
            const labelText = `${dist} ${gridUnit}`;
            const text = new PIXI.Text(labelText, textStyle);
            text.anchor.set(0.5);
            text.position.set(centerX, centerY);
            graphics.addChild(text);
        }
    }

    // --- PASS 2: DRAW LIMIT BOUNDARY LINES (Thick Border) ---
    // We iterate through all "Inner Zone" cells (including Ghosts).
    // If a neighbor is NOT in the inner zone (or doesn't exist), we draw the shared edge.

    for (const [key, square] of squareMap) {
        if (!square.isInnerZone) continue;

        // FIX: We do NOT skip unsafe squares here.
        // We want the boundary to wrap around the entire reachable path, including bridges.

        // Fog Check (Reuse logic)
        const isPlayerToken = token.document.hasPlayerOwner;
        const shouldEnforceFog = !game.user.isGM || isPlayerToken;
        let centerX, centerY;

        if (square.gridType !== CONST.GRID_TYPES.SQUARE) {
            const center = canvas.grid.getCenterPoint({
                i: square.i,
                j: square.j,
            });
            centerX = center.x;
            centerY = center.y;
        } else {
            centerX = square.x + square.w / 2;
            centerY = square.y + square.h / 2;
        }

        if (shouldEnforceFog) {
            const isExplored = canvas.fog.isPointExplored({
                x: centerX,
                y: centerY,
            });
            const isVisible = canvas.visibility.testVisibility(
                { x: centerX, y: centerY },
                { object: token },
            );
            if (!isExplored && !isVisible) continue;
        }

        // Set Color from the square metadata (Limit Color)
        const borderColor = Color.from(square.limitColor).valueOf();
        graphics.lineStyle(4, borderColor, 1.0);

        if (square.gridType === CONST.GRID_TYPES.SQUARE) {
            // --- SQUARE LOGIC ---
            const x = square.x;
            const y = square.y;
            const w = square.w;
            const h = square.h;

            const top = squareMap.get(`${Math.round(x)}.${Math.round(y - h)}`);
            const bottom = squareMap.get(
                `${Math.round(x)}.${Math.round(y + h)}`,
            );
            const left = squareMap.get(`${Math.round(x - w)}.${Math.round(y)}`);
            const right = squareMap.get(
                `${Math.round(x + w)}.${Math.round(y)}`,
            );

            // Draw edge if neighbor is NOT inner zone
            if (!top || !top.isInnerZone) {
                graphics.moveTo(x, y);
                graphics.lineTo(x + w, y);
            }
            if (!bottom || !bottom.isInnerZone) {
                graphics.moveTo(x, y + h);
                graphics.lineTo(x + w, y + h);
            }
            if (!left || !left.isInnerZone) {
                graphics.moveTo(x, y);
                graphics.lineTo(x, y + h);
            }
            if (!right || !right.isInnerZone) {
                graphics.moveTo(x + w, y);
                graphics.lineTo(x + w, y + h);
            }
        } else {
            // --- HEX LOGIC ---
            // 1. Get all 6 vertices of this hex
            const vertices = canvas.grid.getVertices({
                i: square.i,
                j: square.j,
            });
            if (!vertices || vertices.length < 6) continue;

            // 2. Get all 6 neighbors coordinates
            const neighbors = canvas.grid.getAdjacentOffsets({
                i: square.i,
                j: square.j,
            });

            // Geometric Heuristic: Match Edge to Neighbor
            // We iterate the 6 edges (vertex pairs).
            // The neighbor that shares this edge is the one whose center is closest to the edge's midpoint.

            for (let v = 0; v < 6; v++) {
                const p1 = vertices[v];
                const p2 = vertices[(v + 1) % 6]; // Wrap around to 0

                // Edge Midpoint
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;

                let closestNeighbor = null;
                let minDst = Infinity;

                for (const n of neighbors) {
                    const nCenter = canvas.grid.getCenterPoint({
                        i: n.i,
                        j: n.j,
                    });
                    const d = Math.hypot(nCenter.x - midX, nCenter.y - midY);
                    if (d < minDst) {
                        minDst = d;
                        closestNeighbor = n;
                    }
                }

                if (closestNeighbor) {
                    // Determine if we should draw the line
                    // We draw IF:
                    // 1. Neighbor is not in our results (unreachable/off-map)
                    // 2. OR Neighbor is reachable but is NOT Inner Zone (Outer Zone)

                    const nTopLeft = canvas.grid.getTopLeftPoint({
                        i: closestNeighbor.i,
                        j: closestNeighbor.j,
                    });
                    const nKey = `${Math.round(nTopLeft.x)}.${Math.round(nTopLeft.y)}`;
                    const neighborData = squareMap.get(nKey);

                    if (!neighborData || !neighborData.isInnerZone) {
                        graphics.moveTo(p1.x, p1.y);
                        graphics.lineTo(p2.x, p2.y);
                    }
                }
            }
        }
    }

    container.addChild(graphics);
}
