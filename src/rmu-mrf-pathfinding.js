/**
 * RMU Movement Range Finder - Pathfinding (Origin Override)
 */

import { getRoundingMode } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ['m', 'm.', 'meter', 'meters', 'metre', 'metres'];
const FT_PER_METER = 3.33333;

/**
 * Calculates reachable squares.
 * @param {Token} token - The token object.
 * @param {Array} movementPaces - List of movement speeds.
 * @param {Object|null} originOverride - {x, y} to force calculation from a specific point (Session Origin).
 */
export function calculateReachableSquares(token, movementPaces, originOverride = null) {
    if (!token?.actor || !movementPaces || movementPaces.length === 0) return new Map();

    const grid = canvas.grid;
    const gridType = grid.type;
    
    // Metric Scaling
    const units = canvas.scene.grid.units?.toLowerCase();
    const isMetric = units && METRIC_UNITS.includes(units);
    const distanceScale = isMetric ? (1 / FT_PER_METER) : 1;

    const scaledPaces = movementPaces.map(p => ({
        ...p,
        distance: p.distance * distanceScale
    }));

    // --- SETUP START (Origin Logic) ---
    // If originOverride is provided (from Session Cache), use it.
    // Otherwise, default to the token's current position.
    const startX = originOverride ? originOverride.x : token.document.x;
    const startY = originOverride ? originOverride.y : token.document.y;
    const tw = token.w;
    const th = token.h;

    const minCosts = new Map();
    const queue = [];

    // Define "Safe Zone" relative to the START point
    const margin = grid.size * 0.02; 
    const safeLeft = startX + margin;
    const safeRight = (startX + tw) - margin;
    const safeTop = startY + margin;
    const safeBottom = (startY + th) - margin;

    // Scan Loop Bounds relative to START point
    const c1 = grid.getOffset({ x: startX, y: startY });
    const c2 = grid.getOffset({ x: startX + tw, y: startY + th });
    
    const padding = 1; 
    const minI = Math.min(c1.i, c2.i) - padding;
    const maxI = Math.max(c1.i, c2.i) + padding;
    const minJ = Math.min(c1.j, c2.j) - padding;
    const maxJ = Math.max(c1.j, c2.j) + padding;

    // Scan for starting squares
    for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
            const center = grid.getCenterPoint({ i, j });

            if (center.x >= safeLeft && center.x <= safeRight &&
                center.y >= safeTop && center.y <= safeBottom) {
                
                const key = `${i}.${j}`;
                if (!minCosts.has(key)) {
                    minCosts.set(key, 0);
                    queue.push({ i, j, cost: 0 });
                }
            }
        }
    }
    
    // Fallback
    if (queue.length === 0) {
        // If override provided, use that center. Else token center.
        const centerPt = originOverride 
            ? { x: startX + tw/2, y: startY + th/2 } 
            : token.center;

        const centerOffset = grid.getOffset(centerPt);
        const i = Math.round(centerOffset.i);
        const j = Math.round(centerOffset.j);
        const key = `${i}.${j}`;
        minCosts.set(key, 0);
        queue.push({ i, j, cost: 0 });
    }

    const costPerGridUnit = Number(grid.distance); 
    const maxDistance = Math.max(...scaledPaces.map(p => p.distance));
    const searchLimit = maxDistance + costPerGridUnit; 
    const roundingRule = getRoundingMode();

    const sortedPacesRef = [...scaledPaces].sort((a, b) => b.distance - a.distance);
    const limitPace = scaledPaces.find(p => p.isActionLimit) 
                   || scaledPaces.find(p => p.name === "Sprint")
                   || (sortedPacesRef.length > 1 ? sortedPacesRef[1] : sortedPacesRef[0]);
    
    const limitDistance = limitPace ? limitPace.distance : maxDistance;
    const limitColor = limitPace ? limitPace.color : "#FFFFFF";

    let iterations = 0;
    const MAX_ITERATIONS = 60000; 

    // --- Dijkstra Calculation ---
    while (queue.length > 0) {
        iterations++;
        if (iterations > MAX_ITERATIONS) break;

        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();

        const currentKey = `${current.i}.${current.j}`;
        if (current.cost > minCosts.get(currentKey)) continue;

        let neighbors = [];
        
        if (gridType === CONST.GRID_TYPES.SQUARE) {
            neighbors = [
                {di: -1, dj: 0}, {di: 1, dj: 0}, {di: 0, dj: -1}, {di: 0, dj: 1}, 
                {di: -1, dj: -1, isDiag: true}, {di: -1, dj: 1, isDiag: true},
                {di: 1, dj: -1, isDiag: true}, {di: 1, dj: 1, isDiag: true}
            ];
        } else {
            neighbors = grid.getAdjacentOffsets({i: current.i, j: current.j}).map(n => ({
                di: n.i - current.i,
                dj: n.j - current.j
            }));
        }

        for (const offset of neighbors) {
            const nextI = current.i + offset.di;
            const nextJ = current.j + offset.dj;
            const neighborKey = `${nextI}.${nextJ}`;

            const neighborCenter = grid.getCenterPoint({ i: nextI, j: nextJ });
            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;

            let stepDist = costPerGridUnit;
            if (gridType === CONST.GRID_TYPES.SQUARE && offset.isDiag) {
                stepDist *= 1.4142;
            }
            stepDist = Math.round(stepDist * 100) / 100;

            const newCost = current.cost + stepDist;
            if (newCost > searchLimit) continue;

            const existingCost = minCosts.get(neighborKey);
            if (existingCost !== undefined && newCost >= existingCost) continue;

            // Wall Check (Source = Token, but logic handles raycasting fine)
            // Note: We use the token as the source object for wall permissions,
            // even if the geometry is calculated from the "ghost" origin.
            const currentCenter = grid.getCenterPoint({ i: current.i, j: current.j });
            const rayDiffX = neighborCenter.x - currentCenter.x;
            const rayDiffY = neighborCenter.y - currentCenter.y;
            const testEnd = { x: currentCenter.x + (rayDiffX * 0.9), y: currentCenter.y + (rayDiffY * 0.9) };

            const hasWall = CONFIG.Canvas.polygonBackends.move.testCollision(
                currentCenter, testEnd, { type: "move", mode: "any", source: token }
            );

            if (hasWall) continue;

            minCosts.set(neighborKey, newCost);
            queue.push({ i: nextI, j: nextJ, cost: newCost });
        }
    }

    // --- Process Results ---
    const resultSquares = new Map();
    const sortedPaces = [...scaledPaces].sort((a, b) => a.distance - b.distance);
    const gridSizePixels = Number(grid.size);

    for (const [key, cost] of minCosts) {
        if (cost === 0) continue; 

        const [i, j] = key.split('.').map(Number);
        
        let bestPace = null;
        for (const pace of sortedPaces) {
            if (isCostWithinPace(cost, pace.distance, roundingRule, costPerGridUnit)) {
                bestPace = pace;
                break; 
            }
        }

        if (bestPace) {
            const topLeft = grid.getTopLeftPoint({i, j});
            const safeX = Math.round(topLeft.x);
            const safeY = Math.round(topLeft.y);
            const renderKey = `${safeX}.${safeY}`;
            
            const isInnerZone = isCostWithinPace(cost, limitDistance, roundingRule, costPerGridUnit);

            resultSquares.set(renderKey, {
                i: i,
                j: j,
                x: safeX,
                y: safeY,
                w: gridSizePixels, 
                h: gridSizePixels,
                gridType: gridType, 
                color: bestPace.color,
                paceName: bestPace.name,
                cost: cost,
                isInnerZone: isInnerZone,
                limitColor: limitColor
            });
        }
    }

    return resultSquares;
}

function isCostWithinPace(cost, limit, rule, gridSize) {
    if (cost <= limit) return true;
    const overBudget = cost - limit;
    const approximateLastStep = gridSize; 
    const movementBeforeStep = approximateLastStep - overBudget; 
    switch (rule) {
        case "any": return movementBeforeStep > 0.01; 
        case "half": return movementBeforeStep >= (approximateLastStep / 2);
        case "full": default: return cost <= limit;
    }
}