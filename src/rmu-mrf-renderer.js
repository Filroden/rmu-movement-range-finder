/**
 * RMU Movement Range Finder - Renderer
 * ------------------------------------
 * Handles the drawing of the visual overlay using PIXI Graphics.
 *
 * Key Responsibilities:
 * 1. Grid Rendering: Grid squares with dual-vision checks.
 * 2. Gridless Rendering: Anchored rings that show movement budget from start of turn.
 * 3. Fog of War: Supports scouting logic.
 */

import { getVisualSettings } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];
const FT_PER_METER = 3.33333;

/**
 * Main draw function.
 * @param {Token} token - The token being dragged.
 * @param {any} data - The calculated data (square map or paces array).
 * @param {string} mode - 'grid' or 'gridless'.
 * @param {Object} anchor - {x, y} The session anchor point.
 */
export function drawOverlay(token, data, mode, anchor) {
    clearOverlay();
    const settings = getVisualSettings();

    if (mode === "grid") {
        _drawGridHighlight(token, data, settings);
    } else {
        _drawConcentricRings(token, data, settings, anchor);
    }
}

/**
 * Clears any existing movement overlays from the canvas.
 */
export function clearOverlay() {
    const container = canvas.interface.reverseMask || canvas.interface;
    const toRemove = container.children.filter(c => c.name === "rmuMovementGraphics" || c.name === "rmuMovementRing");
    toRemove.forEach(c => c.destroy());

    if (container._rmuHoverListener) {
        container.off("pointermove", container._rmuHoverListener);
        container._rmuHoverListener = null;
    }
}

// ... [ _drawGridHighlight remains unchanged ] ...
function _drawGridHighlight(token, squareMap, settings) {
    const container = canvas.interface.reverseMask || canvas.interface;
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics";
    graphics.eventMode = 'none';

    const textStyle = new PIXI.TextStyle({
        fontFamily: "Arial",
        fontSize: 11,
        fontWeight: "bold",
        fill: "white",
        stroke: "black",
        strokeThickness: 3,
        align: "center"
    });
    const gridUnit = canvas.scene.grid.units || "ft";

    for (const [key, square] of squareMap) {

        let centerX, centerY;
        const isHex = (square.gridType !== CONST.GRID_TYPES.SQUARE);

        if (isHex) {
            const center = canvas.grid.getCenterPoint({i: square.i, j: square.j});
            centerX = center.x;
            centerY = center.y;
        } else {
            centerX = square.x + square.w/2;
            centerY = square.y + square.h/2;
        }

        const isPlayerToken = token.document.hasPlayerOwner;
        const shouldEnforceFog = !game.user.isGM || isPlayerToken;

        if (shouldEnforceFog) {
            const isExplored = canvas.fog.isPointExplored({x: centerX, y: centerY});
            const isVisible = canvas.visibility.testVisibility({x: centerX, y: centerY}, {object: token});

            if (!isExplored && !isVisible) {
                continue;
            }
        }

        const colorInt = Color.from(square.color).valueOf();
        const colorStr = String(square.color).toLowerCase();
        const limitStr = String(square.limitColor).toLowerCase();
        const isLimitZone = (colorStr === limitStr);

        graphics.beginFill(colorInt, settings.opacity);

        if (isLimitZone) {
            graphics.lineStyle(3, 0x000000, 0.5);
        } else {
            graphics.lineStyle(1, 0x000000, 0.3);
        }

        if (isHex) {
            const vertices = canvas.grid.getVertices({i: square.i, j: square.j});
            if (vertices && vertices.length > 0) {
                const flatPoints = [];
                for (const p of vertices) flatPoints.push(p.x, p.y);
                graphics.drawPolygon(flatPoints);
            }
        } else {
            graphics.drawRect(square.x, square.y, square.w, square.h);
        }

        graphics.endFill();

        if (settings.showLabels) {
            const dist = parseFloat(square.cost.toFixed(1));
            const labelText = `${dist} ${gridUnit}`;
            const text = new PIXI.Text(labelText, textStyle);
            text.anchor.set(0.5);
            text.position.set(centerX, centerY);
            graphics.addChild(text);
        }
    }

    if (canvas.grid.type === CONST.GRID_TYPES.SQUARE) {
        for (const [key, square] of squareMap) {
            if (!square.isInnerZone) continue;

            const centerX = square.x + square.w/2;
            const centerY = square.y + square.h/2;

            const isPlayerToken = token.document.hasPlayerOwner;
            const shouldEnforceFog = !game.user.isGM || isPlayerToken;

            if (shouldEnforceFog) {
                const isExplored = canvas.fog.isPointExplored({x: centerX, y: centerY});
                const isVisible = canvas.visibility.testVisibility({x: centerX, y: centerY}, {object: token});
                if (!isExplored && !isVisible) continue;
            }

            const borderColor = Color.from(square.limitColor).valueOf();
            graphics.lineStyle(4, borderColor, 1.0);

            const x = square.x; const y = square.y;
            const w = square.w; const h = square.h;

            const topKey    = `${x}.${y - h}`;
            const bottomKey = `${x}.${y + h}`;
            const leftKey   = `${x - w}.${y}`;
            const rightKey  = `${x + w}.${y}`;

            const top    = squareMap.get(topKey);
            const bottom = squareMap.get(bottomKey);
            const left   = squareMap.get(leftKey);
            const right  = squareMap.get(rightKey);

            if (!top || !top.isInnerZone) { graphics.moveTo(x, y); graphics.lineTo(x + w, y); }
            if (!bottom || !bottom.isInnerZone) { graphics.moveTo(x, y + h); graphics.lineTo(x + w, y + h); }
            if (!left || !left.isInnerZone) { graphics.moveTo(x, y); graphics.lineTo(x, y + h); }
            if (!right || !right.isInnerZone) { graphics.moveTo(x + w, y); graphics.lineTo(x + w, y + h); }
        }
    }

    container.addChild(graphics);
}

/**
 * Draws concentric rings for Gridless scenes.
 * FIXED: Now centers rings on the ANCHOR, not the Token.
 * Draws a ruler line from Anchor -> Token.
 */
function _drawConcentricRings(token, paces, settings, anchor) {
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics";

    const sortedPaces = [...paces].sort((a, b) => b.distance - a.distance);

    // Metric Conversion
    const units = canvas.scene.grid.units?.toLowerCase();
    const isMetric = units && METRIC_UNITS.includes(units);
    const distanceScale = isMetric ? (1 / FT_PER_METER) : 1;

    // Use Anchor center if available, otherwise token center
    // Note: Anchor is top-left, so we add width/height to get center
    const centerX = anchor ? (anchor.x + token.w/2) : token.center.x;
    const centerY = anchor ? (anchor.y + token.h/2) : token.center.y;

    // 1. Draw Rings around Anchor
    for (const pace of sortedPaces) {
        const adjustedDist = pace.distance * distanceScale;
        // In gridless, scene.grid.distance is usually 1, but we keep the math safe
        const pixelRadius = (adjustedDist / canvas.scene.grid.distance) * canvas.scene.grid.size;
        const colorInt = Color.from(pace.color).valueOf();

        graphics.beginFill(colorInt, settings.opacity);

        const isLimit = (pace.isActionLimit || pace.name === "Sprint");
        if (isLimit) {
            graphics.lineStyle(4, colorInt, 1.0);
        } else {
            graphics.lineStyle(2, colorInt, 0.8);
        }

        graphics.drawCircle(centerX, centerY, pixelRadius);
        graphics.endFill();
    }

    // 2. Draw Travel Ruler (Anchor -> Token)
    // Only draw if we have moved slightly
    const dx = token.center.x - centerX;
    const dy = token.center.y - centerY;
    const distSq = dx*dx + dy*dy;

    if (distSq > 100) { // Slight buffer
        const distPx = Math.sqrt(distSq);
        // Convert pixels back to map units (e.g. feet)
        const unitsMoved = (distPx / canvas.scene.grid.size) * canvas.scene.grid.distance;
        
        // Inverse metric scaling to show "Feet" (or Map Units) correctly
        // If map is meters, unitsMoved is meters. If map is feet, it's feet.
        // We generally display what the map says.
        const label = `${Math.round(unitsMoved)} ${canvas.scene.grid.units}`;

        // Draw Line
        graphics.lineStyle(3, 0xFFFFFF, 1.0); // White line
        graphics.moveTo(centerX, centerY);
        graphics.lineTo(token.center.x, token.center.y);

        // Draw Dot at Anchor
        graphics.beginFill(0xFFFFFF);
        graphics.drawCircle(centerX, centerY, 4);
        graphics.endFill();

        // Draw Label Text
        const textStyle = new PIXI.TextStyle({
            fontFamily: "Arial",
            fontSize: 16,
            fontWeight: "bold",
            fill: "white",
            stroke: "black",
            strokeThickness: 4
        });
        const text = new PIXI.Text(label, textStyle);
        text.anchor.set(0.5, 1); // Center bottom
        // Position text halfway along line
        text.position.set(centerX + dx/2, centerY + dy/2);
        graphics.addChild(text);
    }

    const container = canvas.interface.reverseMask || canvas.interface;
    container.addChild(graphics);
}