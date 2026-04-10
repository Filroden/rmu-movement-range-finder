/**
 * RMU Movement Range Finder - Renderer
 * ------------------------------------
 * Handles the drawing of the visual overlay using PIXI Graphics.
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";

const HOVER_PATH_STYLES = {
    currentFloor: { thickness: 6, color: 0xffffff, alpha: 0.7 },
    crossFloor: { thickness: 4, color: 0xffffff, alpha: 0.6 },
};

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

    const toRemove = container.children.filter((c) => c.name === "rmuMovementGraphics" || c.name === "rmuMovementHoverLayer");

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

    const isPlayerToken = token.document.hasPlayerOwner;
    const shouldEnforceFog = !game.user.isGM || isPlayerToken;
    const anchorColorInt = Color.from(settings.colors.Anchor).valueOf();
    const isGridless = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;

    // Execute Passes
    _drawCellsPass(graphics, squareMap, token, settings, shouldEnforceFog, isGridless, anchorColorInt);
    _drawBoundariesPass(graphics, squareMap, anchorColorInt);

    container.addChild(graphics);

    _setupHoverTooltip(container, squareMap, settings, isGridless);
}

// ----------------------------------------------------------------------
// PASS 1: CELLS & FOG
// ----------------------------------------------------------------------
function _drawCellsPass(graphics, squareMap, token, settings, shouldEnforceFog, isGridless, anchorColorInt) {
    const portalColorInt = Color.from(settings.colors.Portal).valueOf();

    for (const square of squareMap.values()) {
        const isHex = square.gridType !== CONST.GRID_TYPES.SQUARE;

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

        if (shouldEnforceFog) {
            const isExplored = canvas.fog.isPointExplored({ x: square.centerX, y: square.centerY });
            const isVisible = canvas.visibility.testVisibility({ x: square.centerX, y: square.centerY }, { object: token });
            square.isHiddenByFog = !isExplored && !isVisible;
            if (square.isHiddenByFog) continue;
        } else {
            square.isHiddenByFog = false;
        }

        if (square.colorInt === undefined) square.colorInt = Color.from(square.color).valueOf();

        const drawOpacity = square.isSafe ? settings.opacity : settings.opacity * 0.4;

        if (square.isAnchor) graphics.beginFill(anchorColorInt, settings.opacity);
        else if (square.isPortal) graphics.beginFill(portalColorInt, settings.opacity + 0.3);
        else graphics.beginFill(square.colorInt, drawOpacity);

        if (isGridless) graphics.lineStyle(0);
        else graphics.lineStyle(1, 0x000000, 0.3);

        if (isHex) {
            if (square.flatVertices === undefined) {
                const vertices = canvas.grid.getVertices({ i: square.i, j: square.j });
                square.flatVertices = [];
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

        if (square.anchorBorderLines.length > 0) {
            graphics.lineStyle(2, anchorColorInt, 1);
            for (const line of square.anchorBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

        if (square.paceBorderLines.length > 0) {
            if (square.darkPaceColorInt === undefined) square.darkPaceColorInt = _darkenColor(square.colorInt, 0.5);
            graphics.lineStyle(2, square.darkPaceColorInt, 1);
            for (const line of square.paceBorderLines) {
                graphics.moveTo(line.x1, line.y1);
                graphics.lineTo(line.x2, line.y2);
            }
        }

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
function _setupHoverTooltip(container, squareMap, settings, isGridless) {
    const gridSize = canvas.scene.grid.size;
    const gridUnit = canvas.scene.grid.units || "ft";

    const hoverLayer = new PIXI.Container();
    hoverLayer.name = "rmuMovementHoverLayer";

    const hoverPath = new PIXI.Graphics();
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

    container._rmuHoverListener = (event) => _handleHoverEvent(event, container, squareMap, settings, isGridless, hoverPath, hoverText, gridUnit);
    canvas.stage.on("pointermove", container._rmuHoverListener);
}

function _handleHoverEvent(event, container, squareMap, settings, isGridless, hoverPath, hoverText, gridUnit) {
    const local = container.worldTransform.applyInverse(event.data.global);
    let hoverKey = null;

    if (isGridless) {
        const sampleSquare = squareMap.values().next().value;
        if (!sampleSquare) {
            hoverText.visible = false;
            return;
        }
        const res = sampleSquare.w;
        hoverKey = `${Math.round(Math.floor(local.x / res) * res)}.${Math.round(Math.floor(local.y / res) * res)}`;
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

    if (settings.showHoverPath) _drawHoverBreadcrumbs(hoveredSquare, squareMap, hoverPath);

    hoverPath.beginFill(0xffffff, 0.9);
    hoverPath.lineStyle(2, 0x000000, 0.8);
    hoverPath.drawCircle(hoveredSquare.centerX, hoveredSquare.centerY, 8);
    hoverPath.endFill();

    hoverText.text = `${Number.parseFloat(hoveredSquare.cost.toFixed(1))} ${gridUnit}`;
    hoverText.position.set(hoveredSquare.centerX, hoveredSquare.centerY - 15);
    hoverText.visible = true;
}

function _drawHoverBreadcrumbs(hoveredSquare, squareMap, hoverPath) {
    const currentFloorPoints = [];
    const otherFloorPoints = [];
    let curr = hoveredSquare;
    const visitedKeys = new Set();

    while (curr) {
        currentFloorPoints.push({ x: curr.centerX, y: curr.centerY });
        if (curr.isAnchor) break;

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

    if (otherFloorPoints.length > 0) {
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

    if (currentFloorPoints.length > 1) {
        const currentStyle = HOVER_PATH_STYLES.currentFloor;
        hoverPath.lineStyle(currentStyle.thickness, currentStyle.color, currentStyle.alpha);

        hoverPath.moveTo(currentFloorPoints[0].x, currentFloorPoints[0].y);
        for (let i = 1; i < currentFloorPoints.length; i++) hoverPath.lineTo(currentFloorPoints[i].x, currentFloorPoints[i].y);
    }
}

/**
 * Helper to safely darken a PIXI color integer.
 * Factor of 0.5 makes it 50% darker.
 */
function _darkenColor(colorInt, factor) {
    const r = Math.max(0, Math.min(255, Math.floor(((colorInt >> 16) & 0xff) * factor)));
    const g = Math.max(0, Math.min(255, Math.floor(((colorInt >> 8) & 0xff) * factor)));
    const b = Math.max(0, Math.min(255, Math.floor((colorInt & 0xff) * factor)));
    return (r << 16) | (g << 8) | b;
}
