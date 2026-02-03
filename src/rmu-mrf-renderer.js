/**
 * RMU Movement Range Finder - Renderer
 */
import { getVisualSettings } from "./rmu-mrf-settings.js";

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
        if (canvas.interface._rmuTooltipActive) {
            game.tooltip.deactivate();
            canvas.interface._rmuTooltipActive = false;
        }
    }
}

function _drawGridHighlight(token, squareMap, settings) {
    const container = canvas.interface.reverseMask || canvas.interface;
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics";
    graphics.eventMode = 'static'; 

    const textStyle = new PIXI.TextStyle({
        fontFamily: "Arial", fontSize: 12, fontWeight: "bold",
        fill: "white", stroke: "black", strokeThickness: 3, align: "center"
    });
    const gridUnit = canvas.scene.grid.units || "ft";

    // 1. Draw Squares & Labels
    for (const [key, square] of squareMap) {
        const colorInt = Color.from(square.color).valueOf();
        
        graphics.beginFill(colorInt, settings.opacity);
        graphics.lineStyle(1, 0x000000, 0.3);
        graphics.drawRect(square.x, square.y, square.w, square.h);
        graphics.endFill();

        if (settings.showLabels) {
            const labelText = `${Math.round(square.cost)} ${gridUnit}`;
            const text = new PIXI.Text(labelText, textStyle);
            text.anchor.set(0.5);
            text.position.set(square.x + square.w/2, square.y + square.h/2);
            graphics.addChild(text);
        }
    }

    // 2. Draw "Action Limit" Outer Border
    // We iterate again to draw the border ON TOP of fills
    for (const [key, square] of squareMap) {
        if (!square.isInnerZone) continue;

        // Use the passed limitColor (Sprint Color) for the border
        // Opacity 1.0 ensures it stands out against the semi-transparent fill
        const borderColor = Color.from(square.limitColor).valueOf();
        graphics.lineStyle(4, borderColor, 1.0); 

        const x = square.x;
        const y = square.y;
        const w = square.w;
        const h = square.h;

        const topKey    = `${x}.${y - h}`;
        const bottomKey = `${x}.${y + h}`;
        const leftKey   = `${x - w}.${y}`;
        const rightKey  = `${x + w}.${y}`;

        const top    = squareMap.get(topKey);
        const bottom = squareMap.get(bottomKey);
        const left   = squareMap.get(leftKey);
        const right  = squareMap.get(rightKey);

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
    }

    container.addChild(graphics);

    // 3. Tooltips
    const onMouseMove = (event) => {
        const pos = event.getLocalPosition(container);
        const indices = canvas.grid.getOffset({x: pos.x, y: pos.y});
        const topLeft = canvas.grid.getTopLeftPoint({i: Math.round(indices.i), j: Math.round(indices.j)});
        const lookupKey = `${Math.round(topLeft.x)}.${Math.round(topLeft.y)}`;

        const square = squareMap.get(lookupKey);

        if (square) {
            const apStatus = square.isInnerZone ? "Within 100% Activity" : "Requires Momentum / Dash";
            const html = `
                <div style="text-align: left; font-family: sans-serif;">
                    <div style="font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 4px;">${apStatus}</div>
                    <div><span style="color:${square.color}">●</span> <b>${square.paceName}</b> (Penalty: ${square.penalty})</div>
                    <div style="font-size: 0.9em; color: #ccc;">Distance: ${Math.round(square.cost)} ${gridUnit}</div>
                </div>
            `;
            game.tooltip.activate(graphics, { text: html, direction: "UP" });
            canvas.interface._rmuTooltipActive = true;
        } else {
            if (canvas.interface._rmuTooltipActive) {
                game.tooltip.deactivate();
                canvas.interface._rmuTooltipActive = false;
            }
        }
    };

    container.on("pointermove", onMouseMove);
    container._rmuHoverListener = onMouseMove;
    
    graphics.on("pointerout", () => {
        game.tooltip.deactivate();
        canvas.interface._rmuTooltipActive = false;
    });
}

function _drawConcentricRings(token, paces, settings) {
    const graphics = new PIXI.Graphics();
    graphics.name = "rmuMovementGraphics"; 
    const sortedPaces = [...paces].sort((a, b) => b.distance - a.distance);
    
    for (const pace of sortedPaces) {
        const pixelRadius = (pace.distance / canvas.scene.grid.distance) * canvas.scene.grid.size;
        const colorInt = Color.from(pace.color).valueOf();
        graphics.beginFill(colorInt, settings.opacity);
        graphics.lineStyle(2, colorInt, 0.8);
        graphics.drawCircle(token.center.x, token.center.y, pixelRadius);
        graphics.endFill();
    }
    const container = canvas.interface.reverseMask || canvas.interface;
    container.addChild(graphics);
}