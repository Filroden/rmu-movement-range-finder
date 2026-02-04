/**
 * RMU Movement Range Finder - Renderer (Metric Fix)
 */
import { getVisualSettings } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];
const FT_PER_METER = 3.33333;

export function drawOverlay(token, data, mode) {
    clearOverlay();
    const settings = getVisualSettings();

    if (mode === "grid") {
        _drawGridHighlight(token, data, settings);
    } else {
        _drawConcentricRings(token, data, settings);
    }
}

export function clearOverlay() {
    const container = canvas.interface.reverseMask || canvas.interface;
    const toRemove = container.children.filter(c => c.name === "rmuMovementGraphics" || c.name === "rmuMovementRing");
    toRemove.forEach(c => c.destroy());
    
    if (container._rmuHoverListener) {
        container.off("pointermove", container._rmuHoverListener);
        container._rmuHoverListener = null;
    }
}

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

        if (shouldEnforceFog && !canvas.fog.isPointExplored({x: centerX, y: centerY})) {
             continue;
        }

        const colorInt = Color.from(square.color).valueOf();
        
        // --- THICKNESS LOGIC ---
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
            if (shouldEnforceFog && !canvas.fog.isPointExplored({x: centerX, y: centerY})) continue;
            
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

function _drawConcentricRings(token, paces, settings) {
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics"; 
    
    const sortedPaces = [...paces].sort((a, b) => b.distance - a.distance);
    
    // --- METRIC CHECK ---
    const units = canvas.scene.grid.units?.toLowerCase();
    const isMetric = units && METRIC_UNITS.includes(units);
    // If Metric: Scale feet down (e.g. 50ft -> 15m)
    // If Imperial: Keep as is (e.g. 50ft -> 50 units)
    const distanceScale = isMetric ? (1 / FT_PER_METER) : 1;

    for (const pace of sortedPaces) {
        // Apply scaling to the pace distance (which is in feet)
        const adjustedDist = pace.distance * distanceScale;

        // Calculate radius in pixels based on the SCENE'S grid distance
        const pixelRadius = (adjustedDist / canvas.scene.grid.distance) * canvas.scene.grid.size;
        
        const colorInt = Color.from(pace.color).valueOf();
        
        graphics.beginFill(colorInt, settings.opacity);
        
        const isLimit = (pace.isActionLimit || pace.name === "Sprint");

        if (isLimit) {
            graphics.lineStyle(4, colorInt, 1.0); 
        } else {
            graphics.lineStyle(2, colorInt, 0.8); 
        }

        graphics.drawCircle(token.center.x, token.center.y, pixelRadius);
        graphics.endFill();
    }
    const container = canvas.interface.reverseMask || canvas.interface;
    container.addChild(graphics);
}