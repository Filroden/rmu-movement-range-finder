/**
 * RMU Movement Range Finder - Renderer
 * ------------------------------------
 * Handles the drawing of the visual overlay using Foundry's WebGL engine (PIXI.js).
 * * Architecture Note:
 * To maintain low cyclomatic complexity and high performance, the rendering loop
 * is strictly separated into three distinct, single-responsibility passes:
 * 1. Pass 1: Fills & Fog of War (Paints the base cell colours)
 * 2. Pass 2: Boundaries (Draws crisp lines between different movement zones)
 * 3. Pass 3: Interactivity (Injects the dynamic hover tooltip and breadcrumb trail)
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";
import { drawLegend, clearLegend } from "./rmu-mrf-legend.js";

/**
 * Centralised styling configuration for interactive paths.
 * Extracts "magic numbers" from the rendering loops to ensure consistency
 * and allow for easy future expansion (e.g., adding teleportation lines).
 */
const HOVER_PATH_STYLES = {
    currentFloor: { thickness: 6, color: 0xffffff, alpha: 0.7 },
    crossFloor: { thickness: 4, color: 0xffffff, alpha: 0.6 },
};

/**
 * Primary entry point for rendering.
 * @param {Token} token - The active token being moved.
 * @param {Map} data - The calculated pathfinding matrix.
 * @param {string} mode - Rendering mode (currently defaults to "grid").
 * @param {object} anchor - The starting {x, y} coordinate.
 */
export function drawOverlay(token, data, mode, anchor) {
    clearOverlay(); // Always purge the previous frame to prevent WebGL memory leaks
    const settings = getVisualSettings();

    _drawGridHighlight(token, data, settings);
    drawLegend();
}

/**
 * Safely dismantles the overlay, removes DOM elements, and purges PIXI memory.
 */
export function clearOverlay() {
    const container = canvas.interface.reverseMask || canvas.interface;

    if (container._rmuHoverListener) {
        canvas.stage.off("pointermove", container._rmuHoverListener);
        container._rmuHoverListener = null;
    }

    // 1. Purge interactive UI layers from the UI Glass
    const uiToRemove = container.children.filter((c) => c.name === "rmuMovementHoverLayer");
    uiToRemove.forEach((c) => {
        c.removeChildren();
        c.destroy({ children: true });
    });

    // 2. Purge 3D-aware base graphics from the Primary Canvas
    // Safe null-chaining without an early return to ensure clearLegend() always runs
    const primaryToRemove = canvas.primary?.children?.filter((child) => child.name === "rmuMovementGraphics") || [];
    primaryToRemove.forEach((child) => {
        child.removeChildren();
        child.destroy({ children: true });
    });

    // Remove the HTML HUD
    clearLegend();
}

/**
 * Main Orchestrator: Sets up the PIXI canvas environment and executes the rendering passes.
 */
function _drawGridHighlight(token, squareMap, settings) {
    const container = canvas.interface.reverseMask || canvas.interface;
    const isPlayerToken = token.document.hasPlayerOwner;
    const shouldEnforceFog = !game.user.isGM || isPlayerToken;
    const anchorColorInt = Color.from(settings.colors.Anchor).valueOf();
    const isGridless = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;

    // 1. Bucket the matrix by elevation.
    const elevationGroups = new Map();
    for (const [key, square] of squareMap.entries()) {
        const z = square.elevation ?? 0;
        if (!elevationGroups.has(z)) elevationGroups.set(z, new Map());
        elevationGroups.get(z).set(key, square);
    }

    // 2. Render 3D-aware elements to the Primary Canvas
    for (const [z, groupMap] of elevationGroups) {
        const graphics = new PIXI.Graphics();
        graphics.name = "rmuMovementGraphics";
        graphics.eventMode = "none";

        // --- NATIVE 3D STACK PROPERTIES ---
        graphics.elevation = z;
        graphics.zIndex = z;
        graphics.sortLayer = 350;

        _drawCellsPass(graphics, groupMap, token, settings, shouldEnforceFog, isGridless, anchorColorInt);
        _drawBoundariesPass(graphics, groupMap, anchorColorInt);

        // Append strictly to the native 3D stack
        canvas.primary.addChild(graphics);
    }

    // 3. Render purely 2D UI elements (tooltips) back to the Interface Canvas
    _setupHoverTooltip(container, squareMap, settings, isGridless);
}

// ----------------------------------------------------------------------
// PASS 1: CELLS & FOG
// ----------------------------------------------------------------------

/**
 * Iterates through the pathfinding matrix to draw the base coloured fill for each valid cell.
 * Integrates directly with Foundry's Lighting and Fog of War systems to hide unreachable/unseen areas.
 */
function _drawCellsPass(graphics, squareMap, token, settings, shouldEnforceFog, isGridless, anchorColorInt) {
    const portalColorInt = Color.from(settings.colors.Portal).valueOf();

    for (const square of squareMap.values()) {
        const isHex = square.gridType !== CONST.GRID_TYPES.SQUARE;

        // Ensure we have a calculated centre point for Fog of War radial checks
        if (square.centerX === undefined) {
            if (isHex) {
                const center = canvas.grid.getCenterPoint({ i: square.i, j: square.j });
                square.centerX = center.x;
                square.centerY = center.y;
            } else {
                square.centerX = square.x + square.w / 2;
                square.centerY = square.y + square.h / 2;
            }
        }

        // --- FOG OF WAR CULLING ---
        if (shouldEnforceFog) {
            // isPointExplored: Has the token ever seen this location?
            const isExplored = canvas.fog.isPointExplored({ x: square.centerX, y: square.centerY });
            // testVisibility: Can the token see this location right now?
            const isVisible = canvas.visibility.testVisibility({ x: square.centerX, y: square.centerY }, { object: token });

            square.isHiddenByFog = !isExplored && !isVisible;

            // If hidden by fog, skip rendering this cell entirely
            if (square.isHiddenByFog) continue;
        } else {
            square.isHiddenByFog = false;
        }

        // Convert the HTML hex string (e.g., "#FF0000") to a PIXI-compatible integer (e.g., 0xFF0000)
        if (square.colorInt === undefined) square.colorInt = Color.from(square.color).valueOf();

        // Dim the opacity if the cell exceeds the token's remaining pace limits
        const drawOpacity = square.isSafe ? settings.opacity : settings.opacity * 0.4;

        if (square.isAnchor) graphics.beginFill(anchorColorInt, settings.opacity);
        else if (square.isPortal) graphics.beginFill(portalColorInt, settings.opacity + 0.3);
        else graphics.beginFill(square.colorInt, drawOpacity);

        // Gridless maps use smooth curves, so we remove the rigid cell borders
        if (isGridless) graphics.lineStyle(0);
        else graphics.lineStyle(1, 0x000000, 0.3);

        if (isHex) {
            if (square.flatVertices === undefined) {
                const vertices = canvas.grid.getVertices({ i: square.i, j: square.j });
                square.flatVertices = [];
                // Flatten the {x, y} array into a 1D array [x1, y1, x2, y2...] required by PIXI.drawPolygon
                if (vertices) for (const p of vertices) square.flatVertices.push(p.x, p.y);
            }
            if (square.flatVertices.length > 0) graphics.drawPolygon(square.flatVertices);
        } else {
            graphics.drawRect(square.x, square.y, square.w, square.h);
        }
        graphics.endFill();
    }
}

// ----------------------------------------------------------------------
// PASS 2: BORDERS
// ----------------------------------------------------------------------

/**
 * Draws sharp, thick outline strokes around the edges of different movement zones (e.g., Walk vs Run).
 * By running this as a second pass, we ensure the borders are drawn perfectly on top of the cell fills.
 */
function _drawBoundariesPass(graphics, squareMap, anchorColorInt) {
    for (const square of squareMap.values()) {
        if (square.isHiddenByFog) continue;

        if (square.limitBorderLines === undefined || square.paceBorderLines === undefined) {
            square.limitBorderLines = [];
            square.paceBorderLines = [];
            square.anchorBorderLines = [];

            if (square.gridType === CONST.GRID_TYPES.SQUARE) _calculateSquareBorders(square, squareMap);
            else _calculateHexBorders(square, squareMap);
        }

        // Draw the Anchor Border
        if (square.anchorBorderLines.length > 0) {
            graphics.lineStyle(2, anchorColorInt, 1);
            for (const line of square.anchorBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

        // Draw Boundaries between different paces (e.g., separating the Walk zone from the Run zone)
        if (square.paceBorderLines.length > 0) {
            if (square.darkPaceColorInt === undefined) square.darkPaceColorInt = _darkenColor(square.colorInt, 0.5);
            graphics.lineStyle(2, square.darkPaceColorInt, 1);
            for (const line of square.paceBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

        // Draw the thick outer limit boundary (The absolute maximum the token can move)
        if (square.isInnerZone && square.limitBorderLines.length > 0) {
            if (square.limitColorInt === undefined) square.limitColorInt = Color.from(square.limitColor).valueOf();
            graphics.lineStyle(4, square.limitColorInt, 1);
            for (const line of square.limitBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }
    }
}

/**
 * Mathematical helper to detect zone edges on Orthogonal (Square) grids.
 * Checks the four cardinal neighbours; if a neighbour belongs to a different zone,
 * that line segment is pushed to the boundary drawing array.
 */
function _calculateSquareBorders(square, squareMap) {
    const x = square.x,
        y = square.y,
        w = square.w,
        h = square.h;

    const neighbors = [
        { dir: "top", data: squareMap.get(`${Math.round(x)}.${Math.round(y - h)}`), line: { x1: x, y1: y, x2: x + w, y2: y } },
        { dir: "bottom", data: squareMap.get(`${Math.round(x)}.${Math.round(y + h)}`), line: { x1: x, y1: y + h, x2: x + w, y2: y + h } },
        { dir: "left", data: squareMap.get(`${Math.round(x - w)}.${Math.round(y)}`), line: { x1: x, y1: y, x2: x, y2: y + h } },
        { dir: "right", data: squareMap.get(`${Math.round(x + w)}.${Math.round(y)}`), line: { x1: x + w, y1: y, x2: x + w, y2: y + h } },
    ];

    for (const n of neighbors) {
        const nIsInner = n.data ? n.data.isInnerZone : false;
        const isLimitBoundary = square.isInnerZone !== nIsInner;

        if (square.isInnerZone && !nIsInner) square.limitBorderLines.push(n.line);
        if (n.data?.paceName !== square.paceName && !isLimitBoundary) square.paceBorderLines.push(n.line);
        if (square.isAnchor && !n.data?.isAnchor) square.anchorBorderLines.push(n.line);
    }
}

/**
 * Mathematical helper to detect zone edges on Hexagonal grids.
 * Scans the 6 vertices and maps them to the adjacent neighbour offsets to draw contiguous hex borders.
 */
function _calculateHexBorders(square, squareMap) {
    const vertices = canvas.grid.getVertices({ i: square.i, j: square.j });
    const hexNeighbors = canvas.grid.getAdjacentOffsets({ i: square.i, j: square.j });

    if (!vertices || vertices.length < 6) return;

    for (let v = 0; v < 6; v++) {
        const p1 = vertices[v];
        const p2 = vertices[(v + 1) % 6];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        let closestNeighbor = null;
        let minDst = Infinity;

        // Associate the line segment with the nearest hex coordinate
        for (const n of hexNeighbors) {
            const nCenter = canvas.grid.getCenterPoint({ i: n.i, j: n.j });
            const d = Math.hypot(nCenter.x - midX, nCenter.y - midY);
            if (d < minDst) {
                minDst = d;
                closestNeighbor = n;
            }
        }

        if (closestNeighbor) {
            const nTopLeft = canvas.grid.getTopLeftPoint({ i: closestNeighbor.i, j: closestNeighbor.j });
            const nKey = `${Math.round(nTopLeft.x)}.${Math.round(nTopLeft.y)}`;
            const neighborData = squareMap.get(nKey);

            const lineSegment = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
            const nIsInner = neighborData ? neighborData.isInnerZone : false;
            const isLimitBoundary = square.isInnerZone !== nIsInner;

            if (square.isInnerZone && !nIsInner) square.limitBorderLines.push(lineSegment);
            if (neighborData?.paceName !== square.paceName && !isLimitBoundary) square.paceBorderLines.push(lineSegment);
            if (square.isAnchor && !neighborData?.isAnchor) square.anchorBorderLines.push(lineSegment);
        }
    }
}

// ----------------------------------------------------------------------
// PASS 3: TOOLTIPS & BREADCRUMBS
// ----------------------------------------------------------------------

/**
 * Injects a dynamic PIXI text object and line renderer that follows the user's cursor.
 */
function _setupHoverTooltip(container, squareMap, settings, isGridless) {
    const gridSize = canvas.scene.grid.size;
    const gridUnit = canvas.scene.grid.units || "ft";

    const hoverLayer = new PIXI.Container();
    hoverLayer.name = "rmuMovementHoverLayer";

    const hoverPath = new PIXI.Graphics();

    // Construct the highly visible, dropshadowed text element
    const hoverText = new PIXI.Text(
        "",
        new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: Math.max(16, Math.floor(gridSize * 0.35)),
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
    hoverText.anchor.set(0.5, 1);

    hoverLayer.addChild(hoverPath);
    hoverLayer.addChild(hoverText);
    container.addChild(hoverLayer);

    // Bind the listener to the global canvas stage to track the cursor even when not over a cell
    container._rmuHoverListener = (event) => _handleHoverEvent(event, container, squareMap, settings, isGridless, hoverPath, hoverText, gridUnit);
    canvas.stage.on("pointermove", container._rmuHoverListener);
}

/**
 * Fires continuously as the mouse moves.
 * Converts screen coordinates to map coordinates, queries the pathfinding matrix,
 * and triggers the tooltip update.
 */
function _handleHoverEvent(event, container, squareMap, settings, isGridless, hoverPath, hoverText, gridUnit) {
    // Translate the global screen cursor position into the canvas's local world coordinates
    const local = container.worldTransform.applyInverse(event.data.global);
    let hoverKey = null;

    if (isGridless) {
        // Gridless relies on the abstract micro-grid resolution
        const sampleSquare = squareMap.values().next().value;
        if (!sampleSquare) {
            hoverText.visible = false;
            return;
        }
        const res = sampleSquare.w;
        hoverKey = `${Math.round(Math.floor(local.x / res) * res)}.${Math.round(Math.floor(local.y / res) * res)}`;
    } else {
        // Square/Hex relies on standard Foundry coordinate acquisition
        const offset = canvas.grid.getOffset(local);
        const topLeft = canvas.grid.getTopLeftPoint(offset);
        hoverKey = `${Math.round(topLeft.x)}.${Math.round(topLeft.y)}`;
    }

    const hoveredSquare = squareMap.get(hoverKey);
    hoverPath.clear();

    if (!hoveredSquare || hoveredSquare.isHiddenByFog || !settings.showHoverPath) {
        hoverText.visible = false;
        return;
    }

    _drawHoverBreadcrumbs(hoveredSquare, squareMap, hoverPath);

    // 3. Draw a crisp circle directly under the mouse
    hoverPath.beginFill(0xffffff, 0.9);
    hoverPath.lineStyle(2, 0x000000, 0.8);
    hoverPath.drawCircle(hoveredSquare.centerX, hoveredSquare.centerY, 8);
    hoverPath.endFill();

    // 4. Update and position the large tooltip text
    hoverText.text = `${hoveredSquare.paceName}: ${Number.parseFloat(hoveredSquare.cost.toFixed(1))} ${gridUnit}`;
    hoverText.position.set(hoveredSquare.centerX, hoveredSquare.centerY - 15);
    hoverText.visible = true;
}

/**
 * Traces the historical path from the hovered cell backwards to the anchor.
 * Supports cross-floor rendering by drawing a dashed line for historical floors
 * and a solid line for the current floor.
 */
function _drawHoverBreadcrumbs(hoveredSquare, squareMap, hoverPath) {
    const currentFloorPoints = [];
    const otherFloorPoints = [];
    let curr = hoveredSquare;
    const visitedKeys = new Set();

    // Walk backwards through the parent-linked-list generated by the pathfinding algorithm
    while (curr) {
        currentFloorPoints.push({ x: curr.centerX, y: curr.centerY });

        if (curr.isAnchor) break;

        // If we hit a portal, append the pre-calculated history from the other floor and terminate
        if (curr.pathToPortal) {
            otherFloorPoints.push(...curr.pathToPortal);
            break;
        }

        if (visitedKeys.has(curr.parentKey)) {
            console.warn("RMU MRF: Prevented an infinite loop while drawing the hover path.");
            break;
        }
        visitedKeys.add(curr.parentKey);
        curr = squareMap.get(curr.parentKey);
    }

    // Pass 1: Draw the historical (cross-floor) path as a dashed line
    if (otherFloorPoints.length > 0) {
        // Connect the start of the current floor to the end of the historical floor
        if (currentFloorPoints.length > 0) otherFloorPoints.unshift(currentFloorPoints.at(-1));

        const crossStyle = HOVER_PATH_STYLES.crossFloor;
        hoverPath.lineStyle(crossStyle.thickness, crossStyle.color, crossStyle.alpha);

        for (let i = 1; i < otherFloorPoints.length; i++) {
            const p1 = otherFloorPoints[i - 1],
                p2 = otherFloorPoints[i];
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            let drawn = 0,
                isDash = true;

            hoverPath.moveTo(p1.x, p1.y);
            // Manually interpolate dashes along the line segment
            while (drawn < dist) {
                let step = Math.min(10, dist - drawn);
                let pct = (drawn + step) / dist;
                if (isDash) hoverPath.lineTo(p1.x + (p2.x - p1.x) * pct, p1.y + (p2.y - p1.y) * pct);
                else hoverPath.moveTo(p1.x + (p2.x - p1.x) * pct, p1.y + (p2.y - p1.y) * pct);
                drawn += step;
                isDash = !isDash;
            }
        }
    }

    // Pass 2: Draw the current floor path as a solid line
    if (currentFloorPoints.length > 1) {
        const currentStyle = HOVER_PATH_STYLES.currentFloor;
        hoverPath.lineStyle(currentStyle.thickness, currentStyle.color, currentStyle.alpha);

        hoverPath.moveTo(currentFloorPoints[0].x, currentFloorPoints[0].y);
        for (let i = 1; i < currentFloorPoints.length; i++) hoverPath.lineTo(currentFloorPoints[i].x, currentFloorPoints[i].y);
    }
}

/**
 * Utility: Safely darkens a raw PIXI colour integer via bitwise manipulation.
 * @param {number} colorInt - The initial colour (e.g., 0xFF0000).
 * @param {number} factor - The darkening multiplier (0.0 to 1.0).
 * @returns {number} The new darkened integer.
 */
function _darkenColor(colorInt, factor) {
    const r = Math.max(0, Math.min(255, Math.floor(((colorInt >> 16) & 0xff) * factor)));
    const g = Math.max(0, Math.min(255, Math.floor(((colorInt >> 8) & 0xff) * factor)));
    const b = Math.max(0, Math.min(255, Math.floor((colorInt & 0xff) * factor)));
    return (r << 16) | (g << 8) | b;
}
