/**
 * RMU Movement Range Finder - Pathfinding Logic (Border Fix)
 */
import { getRoundingMode } from "./rmu-mrf-settings.js";

export function calculateReachableSquares(token, movementPaces) {
    if (!token?.actor || !movementPaces || movementPaces.length === 0) return new Map();

    const grid = canvas.grid;
    
    // Setup Start
    const startIndices = grid.getOffset({ x: token.document.x, y: token.document.y });
    const startI = Math.round(startIndices.i);
    const startJ = Math.round(startIndices.j);

    const tokenWidth = token.document.width; 
    const tokenHeight = token.document.height;

    const minCosts = new Map();
    const queue = [];

    // Initialize Queue
    for (let dy = 0; dy < tokenHeight; dy++) {
        for (let dx = 0; dx < tokenWidth; dx++) {
            const i = startI + dy;
            const j = startJ + dx;
            const key = `${i}.${j}`;
            minCosts.set(key, 0);
            queue.push({ i, j, cost: 0 });
        }
    }

    const costPerGridUnit = Number(grid.distance); 
    const maxDistance = Math.max(...movementPaces.map(p => p.distance));
    const searchLimit = maxDistance + costPerGridUnit; 
    const roundingRule = getRoundingMode();

    // FIX: More robust lookup for the 1 AP Limit (Sprint)
    // 1. Try explicit flag
    // 2. Try explicit name "Sprint"
    // 3. Fallback to the 2nd longest distance (assuming Dash is 1st)
    const sortedPacesRef = [...movementPaces].sort((a, b) => b.distance - a.distance);
    
    const limitPace = movementPaces.find(p => p.isActionLimit) 
                   || movementPaces.find(p => p.name === "Sprint")
                   || (sortedPacesRef.length > 1 ? sortedPacesRef[1] : sortedPacesRef[0]);

    const limitDistance = limitPace ? limitPace.distance : maxDistance;
    const limitColor = limitPace ? limitPace.color : "#FFFFFF"; // Capture color for border

    let iterations = 0;
    const MAX_ITERATIONS = 50000; 

    // BFS
    while (queue.length > 0) {
        iterations++;
        if (iterations > MAX_ITERATIONS) break;

        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();

        const currentKey = `${current.i}.${current.j}`;
        if (current.cost > minCosts.get(currentKey)) continue;

        const neighborOffsets = [
            {di: -1, dj: -1}, {di: -1, dj: 0}, {di: -1, dj: 1},
            {di:  0, dj: -1},                {di:  0, dj: 1},
            {di:  1, dj: -1}, {di:  1, dj: 0}, {di:  1, dj: 1}
        ];

        for (const offset of neighborOffsets) {
            const nextI = current.i + offset.di;
            const nextJ = current.j + offset.dj;
            const neighborKey = `${nextI}.${nextJ}`;

            const neighborCenter = grid.getCenterPoint({ i: nextI, j: nextJ });
            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;

            const isDiagonal = (offset.di !== 0) && (offset.dj !== 0);
            let stepDist = isDiagonal ? (costPerGridUnit * 1.4142) : costPerGridUnit;
            stepDist = Math.round(stepDist * 100) / 100;

            const newCost = current.cost + stepDist;
            if (newCost > searchLimit) continue;

            const existingCost = minCosts.get(neighborKey);
            if (existingCost !== undefined && newCost >= existingCost) continue;

            // Wall Check
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

    // Process Results
    const resultSquares = new Map();
    const sortedPaces = [...movementPaces].sort((a, b) => a.distance - b.distance);
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
                x: safeX,
                y: safeY,
                w: gridSizePixels, 
                h: gridSizePixels,
                color: bestPace.color,
                paceName: bestPace.name,
                cost: cost,
                penalty: bestPace.penalty,
                isActionLimit: bestPace.isActionLimit,
                isInnerZone: isInnerZone,
                limitColor: limitColor // <--- Pass the Sprint color for the border
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