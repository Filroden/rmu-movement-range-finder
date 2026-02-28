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

    // Clean up the interactive mouse listener
    if (container._rmuHoverListener) {
        canvas.stage.off("pointermove", container._rmuHoverListener);
        container._rmuHoverListener = null;
    }

    const toRemove = container.children.filter(
        (c) =>
            c.name === "rmuMovementGraphics" ||
            c.name === "rmuMovementHoverLayer",
    );

    toRemove.forEach((c) => {
        c.removeChildren();
        c.destroy({ children: true }); // Ensure deep cleanup
    });
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
    const gridUnit = canvas.scene.grid.units || "ft";

    // OPTIMISATION: Hoist invariant variables outside the loop
    const isPlayerToken = token.document.hasPlayerOwner;
    const shouldEnforceFog = !game.user.isGM || isPlayerToken;
    const anchorColorInt = Color.from(settings.colors.Anchor).valueOf();

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

        if (square.isAnchor) {
            graphics.beginFill(anchorColorInt, settings.opacity);
        } else {
            graphics.beginFill(square.colorInt, drawOpacity);
        }

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
    }

    // --- PASS 2: DRAW BOUNDARY LINES (Thick Limit & Thin Pace Borders) ---
    for (const [key, square] of squareMap) {
        if (square.isHiddenByFog) continue;

        // CACHE: Heavy Limit Border & Thin Pace Border Math
        if (
            square.limitBorderLines === undefined ||
            square.paceBorderLines === undefined
        ) {
            square.limitBorderLines = [];
            square.paceBorderLines = [];
            square.anchorBorderLines = [];

            if (square.gridType === CONST.GRID_TYPES.SQUARE) {
                const x = square.x,
                    y = square.y,
                    w = square.w,
                    h = square.h;

                const neighbors = [
                    {
                        dir: "top",
                        data: squareMap.get(
                            `${Math.round(x)}.${Math.round(y - h)}`,
                        ),
                        line: { x1: x, y1: y, x2: x + w, y2: y },
                    },
                    {
                        dir: "bottom",
                        data: squareMap.get(
                            `${Math.round(x)}.${Math.round(y + h)}`,
                        ),
                        line: { x1: x, y1: y + h, x2: x + w, y2: y + h },
                    },
                    {
                        dir: "left",
                        data: squareMap.get(
                            `${Math.round(x - w)}.${Math.round(y)}`,
                        ),
                        line: { x1: x, y1: y, x2: x, y2: y + h },
                    },
                    {
                        dir: "right",
                        data: squareMap.get(
                            `${Math.round(x + w)}.${Math.round(y)}`,
                        ),
                        line: { x1: x + w, y1: y, x2: x + w, y2: y + h },
                    },
                ];

                for (const n of neighbors) {
                    const nIsInner = n.data ? n.data.isInnerZone : false;
                    const isLimitBoundary = square.isInnerZone !== nIsInner;

                    // 1. Limit Boundary (Only the inside square draws it to prevent double-thickness)
                    if (square.isInnerZone && !nIsInner) {
                        square.limitBorderLines.push(n.line);
                    }

                    // 2. Pace Boundary (Draw if paces are different, BUT skip if it's a Limit Boundary)
                    if (!n.data || n.data.paceName !== square.paceName) {
                        if (!isLimitBoundary) {
                            square.paceBorderLines.push(n.line);
                        }
                    }

                    // 3. Anchor Boundary (Only the inside square draws it)
                    if (square.isAnchor && (!n.data || !n.data.isAnchor)) {
                        square.anchorBorderLines.push(n.line);
                    }
                }
            } else {
                // HEX GRID EDGE DETECTION
                const vertices = canvas.grid.getVertices({
                    i: square.i,
                    j: square.j,
                });
                const hexNeighbors = canvas.grid.getAdjacentOffsets({
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

                        for (const n of hexNeighbors) {
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

                            const lineSegment = {
                                x1: p1.x,
                                y1: p1.y,
                                x2: p2.x,
                                y2: p2.y,
                            };

                            const nIsInner = neighborData
                                ? neighborData.isInnerZone
                                : false;
                            const isLimitBoundary =
                                square.isInnerZone !== nIsInner;

                            // 1. Limit Boundary
                            if (square.isInnerZone && !nIsInner) {
                                square.limitBorderLines.push(lineSegment);
                            }

                            // 2. Pace Boundary
                            if (
                                !neighborData ||
                                neighborData.paceName !== square.paceName
                            ) {
                                if (!isLimitBoundary) {
                                    square.paceBorderLines.push(lineSegment);
                                }
                            }

                            // 3. Anchor Boundary
                            if (
                                square.isAnchor &&
                                (!neighborData || !neighborData.isAnchor)
                            ) {
                                square.anchorBorderLines.push(lineSegment);
                            }
                        }
                    }
                }
            }
        }

        // --- DRAWING THE CACHED LINES ---

        // Draw Solid Anchor Borders
        if (square.anchorBorderLines && square.anchorBorderLines.length > 0) {
            // Draw a solid 2px line using the user's custom Anchor color!
            graphics.lineStyle(2, anchorColorInt, 1.0);
            for (const line of square.anchorBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

        // Draw Thin Pace Borders using a Darkened Pace Color
        if (square.paceBorderLines && square.paceBorderLines.length > 0) {
            // CACHE: Calculate a color that is 50% darker than the square's fill
            if (square.darkPaceColorInt === undefined) {
                square.darkPaceColorInt = _darkenColor(square.colorInt, 0.5);
            }

            // Draw a solid, dark 2px line
            graphics.lineStyle(2, square.darkPaceColorInt, 1.0);
            for (const line of square.paceBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

        // Draw Thick Limit Borders
        if (
            square.isInnerZone &&
            square.limitBorderLines &&
            square.limitBorderLines.length > 0
        ) {
            // CACHE: Parse the limit color
            if (square.limitColorInt === undefined) {
                square.limitColorInt = Color.from(square.limitColor).valueOf();
            }

            graphics.lineStyle(4, square.limitColorInt, 1.0);
            for (const line of square.limitBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }
    }

    container.addChild(graphics);

    // --- PASS 3: INTERACTIVE HOVER TOOLTIP  ---
    const hoverLayer = new PIXI.Container();
    hoverLayer.name = "rmuMovementHoverLayer";

    const hoverPath = new PIXI.Graphics();
    const hoverText = new PIXI.Text(
        "",
        new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: Math.max(16, Math.floor(gridSize * 0.35)), // Big, readable font!
            fontWeight: "bold",
            fill: "white",
            stroke: "black",
            strokeThickness: 4,
            dropShadow: true,
            dropShadowColor: "#000000",
            dropShadowBlur: 4,
            dropShadowDistance: 2,
            align: "center",
        }),
    );
    hoverText.anchor.set(0.5, 1); // Anchor at the bottom center so it floats ABOVE the mouse

    hoverLayer.addChild(hoverPath);
    hoverLayer.addChild(hoverText);
    container.addChild(hoverLayer);

    // Create the mouse tracking listener
    container._rmuHoverListener = (event) => {
        // Convert screen coordinates to canvas map coordinates
        const local = container.worldTransform.applyInverse(event.data.global);

        let hoverKey = null;

        // Figure out exactly which cell the mouse is currently hovering over
        if (isGridless) {
            const res = squareMap.values().next().value.w;
            const i = Math.floor(local.x / res);
            const j = Math.floor(local.y / res);
            hoverKey = `${Math.round(i * res)}.${Math.round(j * res)}`;
        } else {
            const offset = canvas.grid.getOffset(local);
            const topLeft = canvas.grid.getTopLeftPoint(offset);
            hoverKey = `${Math.round(topLeft.x)}.${Math.round(topLeft.y)}`;
        }

        const hoveredSquare = squareMap.get(hoverKey);

        hoverPath.clear();

        if (!hoveredSquare || hoveredSquare.isHiddenByFog) {
            hoverText.visible = false;
            return;
        }

        // 1. Trace the breadcrumbs back to the Anchor
        const pathPoints = [];
        let curr = hoveredSquare;
        while (curr) {
            pathPoints.push({ x: curr.centerX, y: curr.centerY });
            if (curr.isAnchor) break;
            curr = squareMap.get(curr.parentKey);
        }

        // 2. Draw the path line (Thick, bright white with a slight transparency)
        if (pathPoints.length > 1) {
            hoverPath.lineStyle(6, 0xffffff, 0.7);
            hoverPath.moveTo(pathPoints[0].x, pathPoints[0].y);
            for (let i = 1; i < pathPoints.length; i++) {
                hoverPath.lineTo(pathPoints[i].x, pathPoints[i].y);
            }
        }

        // 3. Draw a crisp circle directly under the mouse
        hoverPath.beginFill(0xffffff, 0.9);
        hoverPath.lineStyle(2, 0x000000, 0.8);
        hoverPath.drawCircle(hoveredSquare.centerX, hoveredSquare.centerY, 8);
        hoverPath.endFill();

        // 4. Update and position the large tooltip text
        hoverText.text = `${parseFloat(hoveredSquare.cost.toFixed(1))} ${gridUnit}`;
        hoverText.position.set(
            hoveredSquare.centerX,
            hoveredSquare.centerY - 15,
        );
        hoverText.visible = true;
    };

    // Attach the listener to the canvas stage
    canvas.stage.on("pointermove", container._rmuHoverListener);
}

/**
 * Helper to safely darken a PIXI color integer.
 * Factor of 0.5 makes it 50% darker.
 */
function _darkenColor(colorInt, factor) {
    const r = Math.max(
        0,
        Math.min(255, Math.floor(((colorInt >> 16) & 0xff) * factor)),
    );
    const g = Math.max(
        0,
        Math.min(255, Math.floor(((colorInt >> 8) & 0xff) * factor)),
    );
    const b = Math.max(
        0,
        Math.min(255, Math.floor((colorInt & 0xff) * factor)),
    );
    return (r << 16) | (g << 8) | b;
}
