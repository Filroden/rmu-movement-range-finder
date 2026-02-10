/**
 * RMU Movement Range Finder - Pathfinding (Unified Strict Safety)
 * ---------------------------------------------------------------
 * 1. Square: Uses Dijkstra with STRICT center checks (Fixes 45-degree wall leaks).
 * 2. Hex: Uses Dijkstra with Jump/Bridge logic (Fixes bisected corridors).
 */

import { getRoundingMode } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];
const FT_PER_METER = 3.33333;

export function calculateReachableSquares(
    token,
    movementPaces,
    originOverride = null,
) {
    if (!token?.actor || !movementPaces || movementPaces.length === 0)
        return new Map();

    const grid = canvas.grid;
    const isHex = grid.type !== CONST.GRID_TYPES.SQUARE;

    // Metric Scaling
    const units = canvas.scene.grid.units?.toLowerCase();
    const isMetric = units && METRIC_UNITS.includes(units);
    const distanceScale = isMetric ? 1 / FT_PER_METER : 1;

    const scaledPaces = movementPaces.map((p) => ({
        ...p,
        distance: p.distance * distanceScale,
    }));

    // --- SETUP START ---
    const startX = originOverride ? originOverride.x : token.document.x;
    const startY = originOverride ? originOverride.y : token.document.y;
    const tw = token.w;
    const th = token.h;

    // Define the Calculation Origin (Center)
    const centerPt = originOverride
        ? { x: startX + tw / 2, y: startY + th / 2 }
        : token.center;

    // --- ROUTING ---
    if (isHex) {
        return _calculateHex(
            token,
            scaledPaces,
            grid,
            centerPt,
            startX,
            startY,
            tw,
            th,
        );
    } else {
        return _calculateSquare(
            token,
            scaledPaces,
            grid,
            centerPt,
            startX,
            startY,
            tw,
            th,
        );
    }
}

/**
 * ALGORITHM 1: SQUARE GRID
 * Standard Dijkstra, but upgraded to use checkCellStrict.
 * This ensures we don't snap to centers that are inside diagonal walls.
 */
function _calculateSquare(
    token,
    scaledPaces,
    grid,
    centerPt,
    startX,
    startY,
    tw,
    th,
) {
    const minCosts = new Map();
    const queue = [];
    const safetyMap = new Map();

    // Define "Safe Zone"
    const margin = grid.size * 0.02;
    const safeLeft = startX + margin;
    const safeRight = startX + tw - margin;
    const safeTop = startY + margin;
    const safeBottom = startY + th - margin;

    const c1 = grid.getOffset({ x: startX, y: startY });
    const c2 = grid.getOffset({ x: startX + tw, y: startY + th });
    const padding = 1;
    const minI = Math.min(c1.i, c2.i) - padding;
    const maxI = Math.max(c1.i, c2.i) + padding;
    const minJ = Math.min(c1.j, c2.j) - padding;
    const maxJ = Math.max(c1.j, c2.j) + padding;

    // 1. Initialize Start
    for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
            const center = grid.getCenterPoint({ i, j });
            if (
                center.x >= safeLeft &&
                center.x <= safeRight &&
                center.y >= safeTop &&
                center.y <= safeBottom
            ) {
                const key = `${i}.${j}`;
                if (!minCosts.has(key)) {
                    minCosts.set(key, 0);
                    safetyMap.set(key, true);
                    queue.push({ i, j, cost: 0 });
                }
            }
        }
    }

    if (queue.length === 0) {
        const centerOffset = grid.getOffset(centerPt);
        const key = `${centerOffset.i}.${centerOffset.j}`;
        minCosts.set(key, 0);
        safetyMap.set(key, true);
        queue.push({ i: centerOffset.i, j: centerOffset.j, cost: 0 });
    }

    const costPerGridUnit = Number(grid.distance);
    const maxDistance = Math.max(...scaledPaces.map((p) => p.distance));
    const searchLimit = maxDistance + costPerGridUnit;

    // 2. Standard Dijkstra Loop
    while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        const currentKey = `${current.i}.${current.j}`;

        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = grid.getCenterPoint({
            i: current.i,
            j: current.j,
        });

        // Get Neighbors
        let neighbors = [];
        if (grid.getAdjacentOffsets) {
            neighbors = grid
                .getAdjacentOffsets({ i: current.i, j: current.j })
                .map((n) => ({
                    i: n.i,
                    j: n.j,
                    isDiag:
                        Math.abs(n.i - current.i) === 1 &&
                        Math.abs(n.j - current.j) === 1,
                }));
        } else {
            neighbors = [
                { di: -1, dj: 0 },
                { di: 1, dj: 0 },
                { di: 0, dj: -1 },
                { di: 0, dj: 1 },
                { di: -1, dj: -1, isDiag: true },
                { di: -1, dj: 1, isDiag: true },
                { di: 1, dj: -1, isDiag: true },
                { di: 1, dj: 1, isDiag: true },
            ].map((n) => ({
                i: current.i + n.di,
                j: current.j + n.dj,
                isDiag: n.isDiag,
            }));
        }

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.i}.${neighbor.j}`;
            const neighborCenter = grid.getCenterPoint({
                i: neighbor.i,
                j: neighbor.j,
            });

            if (
                !canvas.dimensions.sceneRect.contains(
                    neighborCenter.x,
                    neighborCenter.y,
                )
            )
                continue;

            let stepDist = costPerGridUnit;
            if (neighbor.isDiag) stepDist *= 1.4142;
            stepDist = Math.round(stepDist * 100) / 100;

            const newCost = current.cost + stepDist;
            if (newCost > searchLimit) continue;
            if (
                minCosts.has(neighborKey) &&
                newCost >= minCosts.get(neighborKey)
            )
                continue;

            // UPDATED: Use Strict Check (was Simple)
            // This forces a check against isPointClearOfWalls()
            const isReachable = checkCellStrict(
                token,
                currentCenter,
                neighbor.i,
                neighbor.j,
            );

            if (isReachable) {
                minCosts.set(neighborKey, newCost);
                safetyMap.set(neighborKey, true);
                queue.push({ i: neighbor.i, j: neighbor.j, cost: newCost });
            }
        }
    }

    return processResults(
        minCosts,
        safetyMap,
        scaledPaces,
        grid,
        costPerGridUnit,
    );
}

/**
 * ALGORITHM 2: HEX GRID
 * Complex Jump/Bridge logic for Hexes.
 */
function _calculateHex(
    token,
    scaledPaces,
    grid,
    centerPt,
    startX,
    startY,
    tw,
    th,
) {
    const minCosts = new Map();
    const safetyMap = new Map();
    const queue = [];

    const margin = grid.size * 0.02;
    const safeLeft = startX + margin;
    const safeRight = startX + tw - margin;
    const safeTop = startY + margin;
    const safeBottom = startY + th - margin;

    const c1 = grid.getOffset({ x: startX, y: startY });
    const c2 = grid.getOffset({ x: startX + tw, y: startY + th });
    const padding = 1;
    const minI = Math.min(c1.i, c2.i) - padding;
    const maxI = Math.max(c1.i, c2.i) + padding;
    const minJ = Math.min(c1.j, c2.j) - padding;
    const maxJ = Math.max(c1.j, c2.j) + padding;

    for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
            const center = grid.getCenterPoint({ i, j });
            if (
                center.x >= safeLeft &&
                center.x <= safeRight &&
                center.y >= safeTop &&
                center.y <= safeBottom
            ) {
                const key = `${i}.${j}`;
                if (!minCosts.has(key)) {
                    minCosts.set(key, 0);
                    safetyMap.set(key, true);
                    queue.push({ i, j, cost: 0 });
                }
            }
        }
    }

    if (queue.length === 0) {
        const centerOffset = grid.getOffset(centerPt);
        const key = `${centerOffset.i}.${centerOffset.j}`;
        minCosts.set(key, 0);
        safetyMap.set(key, true);
        queue.push({ i: centerOffset.i, j: centerOffset.j, cost: 0 });
    }

    const costPerGridUnit = Number(grid.distance);
    const maxDistance = Math.max(...scaledPaces.map((p) => p.distance));
    const searchLimit = maxDistance + costPerGridUnit;

    while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const current = queue.shift();
        const currentKey = `${current.i}.${current.j}`;

        if (current.cost > minCosts.get(currentKey)) continue;

        const neighbors = grid.getAdjacentOffsets({
            i: current.i,
            j: current.j,
        });
        const currentCenter = grid.getCenterPoint({
            i: current.i,
            j: current.j,
        });

        for (const neighbor of neighbors) {
            const nextI = neighbor.i;
            const nextJ = neighbor.j;
            const neighborKey = `${nextI}.${nextJ}`;
            const neighborCenter = grid.getCenterPoint({ i: nextI, j: nextJ });

            if (
                !canvas.dimensions.sceneRect.contains(
                    neighborCenter.x,
                    neighborCenter.y,
                )
            )
                continue;

            let stepDist = costPerGridUnit;

            // 1. Direct Path
            const isDirectReachable = checkCellStrict(
                token,
                currentCenter,
                nextI,
                nextJ,
            );

            if (isDirectReachable) {
                const newCost = current.cost + stepDist;
                if (newCost > searchLimit) continue;
                if (
                    minCosts.has(neighborKey) &&
                    newCost >= minCosts.get(neighborKey)
                )
                    continue;

                minCosts.set(neighborKey, newCost);
                safetyMap.set(neighborKey, true);
                queue.push({ i: nextI, j: nextJ, cost: newCost });
            } else {
                // 2. Jump/Bridge Logic
                const jumpNeighbors = grid.getAdjacentOffsets({
                    i: nextI,
                    j: nextJ,
                });

                for (const jn of jumpNeighbors) {
                    const jumpI = jn.i;
                    const jumpJ = jn.j;
                    if (jumpI === current.i && jumpJ === current.j) continue;

                    const isJumpReachable = checkCellStrict(
                        token,
                        currentCenter,
                        jumpI,
                        jumpJ,
                    );

                    if (isJumpReachable) {
                        const jumpCost = current.cost + stepDist * 2;
                        if (jumpCost > searchLimit) continue;

                        const jumpKey = `${jumpI}.${jumpJ}`;
                        if (
                            !minCosts.has(jumpKey) ||
                            jumpCost < minCosts.get(jumpKey)
                        ) {
                            minCosts.set(jumpKey, jumpCost);
                            safetyMap.set(jumpKey, true);
                            queue.push({ i: jumpI, j: jumpJ, cost: jumpCost });
                        }

                        const bridgeCost = current.cost + stepDist;
                        if (
                            !minCosts.has(neighborKey) ||
                            bridgeCost < minCosts.get(neighborKey)
                        ) {
                            minCosts.set(neighborKey, bridgeCost);
                            safetyMap.set(neighborKey, false); // Ghost
                        }
                    }
                }
            }
        }
    }

    return processResults(
        minCosts,
        safetyMap,
        scaledPaces,
        grid,
        costPerGridUnit,
    );
}

// --- HELPERS ---

/** * Strict safety check for both Square and Hex.
 * 1. Checks if point is inside a wall.
 * 2. Raycasts from center to center.
 */
function checkCellStrict(token, originPoint, i, j) {
    const grid = canvas.grid;
    const destCenter = grid.getCenterPoint({ i, j });

    // 1. Safety Check (This fixes the 45-degree leak)
    if (!isPointClearOfWalls(destCenter)) return false;

    // 2. Raycast
    return !CONFIG.Canvas.polygonBackends.move.testCollision(
        originPoint,
        destCenter,
        { type: "move", mode: "any", source: token },
    );
}

function isPointClearOfWalls(point) {
    if (canvas.walls && canvas.walls.quadtree) {
        const tolerance = 2;
        const bounds = new PIXI.Rectangle(
            point.x - tolerance,
            point.y - tolerance,
            tolerance * 2,
            tolerance * 2,
        );
        const walls = canvas.walls.quadtree.getObjects(bounds);
        for (const wall of walls) {
            if (wall.document.move === CONST.WALL_SENSE_TYPES.NONE) continue;
            const A = wall.edge?.a ?? wall.A;
            const B = wall.edge?.b ?? wall.B;
            const dist = _distToSegment(point, A, B);
            if (dist < tolerance) return false;
        }
    }
    return true;
}

function _distToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return Math.hypot(p.x - projection.x, p.y - projection.y);
}

function processResults(
    minCosts,
    safetyMap,
    scaledPaces,
    grid,
    costPerGridUnit,
) {
    const roundingRule = getRoundingMode();
    const resultSquares = new Map();
    const sortedPaces = [...scaledPaces].sort(
        (a, b) => a.distance - b.distance,
    );

    const limitPace =
        scaledPaces.find((p) => p.isActionLimit) ||
        scaledPaces.find((p) => p.name === "Sprint") ||
        (sortedPaces.length > 1 ? sortedPaces[1] : sortedPaces[0]);

    const limitDistance = limitPace ? limitPace.distance : 0;
    const limitColor = limitPace ? limitPace.color : "#FFFFFF";

    for (const [key, cost] of minCosts) {
        if (cost === 0) continue;
        const [i, j] = key.split(".").map(Number);

        let bestPace = null;
        for (const pace of sortedPaces) {
            if (
                isCostWithinPace(
                    cost,
                    pace.distance,
                    roundingRule,
                    costPerGridUnit,
                )
            ) {
                bestPace = pace;
                break;
            }
        }

        if (bestPace) {
            const topLeft = grid.getTopLeftPoint({ i, j });
            const isInnerZone = isCostWithinPace(
                cost,
                limitDistance,
                roundingRule,
                costPerGridUnit,
            );

            const isSafe = safetyMap.get(key) === true;

            resultSquares.set(
                `${Math.round(topLeft.x)}.${Math.round(topLeft.y)}`,
                {
                    i,
                    j,
                    x: Math.round(topLeft.x),
                    y: Math.round(topLeft.y),
                    w: grid.size,
                    h: grid.size,
                    gridType: grid.type,
                    color: bestPace.color,
                    paceName: bestPace.name,
                    cost,
                    isInnerZone,
                    limitColor,
                    isSafe: isSafe,
                },
            );
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
        case "any":
            return movementBeforeStep > 0.01;
        case "half":
            return movementBeforeStep >= approximateLastStep / 2;
        case "full":
        default:
            return cost <= limit;
    }
}
