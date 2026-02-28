/**
 * RMU Movement Range Finder - Pathfinding
 * ---------------------------------------------------------------
 * 1. Square: Uses Dijkstra with STRICT center checks.
 * 2. Hex: Uses Dijkstra with Jump/Bridge logic.
 * 3. Gridless: Uses Theta* on a synthetic Micro-Grid for true Euclidean circles.
 */

import { getRoundingMode, getGridlessResolution } from "./rmu-mrf-settings.js";

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
    const isHex =
        grid.type !== CONST.GRID_TYPES.SQUARE &&
        grid.type !== CONST.GRID_TYPES.GRIDLESS;

    // Metric Scaling
    const units = canvas.scene.grid.units?.toLowerCase();
    const isMetric = units && METRIC_UNITS.includes(units);
    const distanceScale = isMetric ? 1 / FT_PER_METER : 1;

    const scaledPaces = movementPaces.map((p) => ({
        ...p,
        distance: p.distance * distanceScale,
    }));

    const startX = originOverride ? originOverride.x : token.document.x;
    const startY = originOverride ? originOverride.y : token.document.y;
    const tw = token.w;
    const th = token.h;

    const centerPt = originOverride
        ? { x: startX + tw / 2, y: startY + th / 2 }
        : token.center;

    const wallCheckCache = new Map();

    // --- ROUTING ---
    if (grid.type === CONST.GRID_TYPES.GRIDLESS) {
        return _calculateGridlessTheta(
            token,
            scaledPaces,
            centerPt,
            startX,
            startY,
            tw,
            th,
        );
    } else if (isHex) {
        return _calculateHex(
            token,
            scaledPaces,
            grid,
            centerPt,
            startX,
            startY,
            tw,
            th,
            wallCheckCache,
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
            wallCheckCache,
        );
    }
}

/**
 * ALGORITHM 3: GRIDLESS (Theta* Micro-Grid)
 * Evaluates a synthetic grid but uses line-of-sight to origin to draw perfect circles.
 */
function _calculateGridlessTheta(
    token,
    scaledPaces,
    centerPt,
    startX,
    startY,
    tw,
    th,
) {
    const resolutionPx = getGridlessResolution();
    const costPerGridUnit = canvas.scene.grid.distance;
    const sizePerGridUnit = canvas.scene.grid.size;

    // Generate the grid first so the helper can use it!
    const microDistance = (resolutionPx / sizePerGridUnit) * costPerGridUnit;
    const syntheticGrid = _createSyntheticGrid(resolutionPx, microDistance);

    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    // Call our unified helper (isTheta = true)
    _initializeTokenFootprint(
        queue,
        minCosts,
        safetyMap,
        syntheticGrid,
        centerPt,
        startX,
        startY,
        tw,
        th,
        true,
    );

    const searchLimit =
        Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit * 2;

    const neighborsOffsets = [
        { di: -1, dj: 0 },
        { di: 1, dj: 0 },
        { di: 0, dj: -1 },
        { di: 0, dj: 1 },
        { di: -1, dj: -1 },
        { di: -1, dj: 1 },
        { di: 1, dj: -1 },
        { di: 1, dj: 1 },
    ];

    while (queue.length > 0) {
        const current = queue.pop();
        const currentKey = `${current.i}.${current.j}`;

        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = {
            x: current.i * resolutionPx + resolutionPx / 2,
            y: current.j * resolutionPx + resolutionPx / 2,
        };

        for (const n of neighborsOffsets) {
            const nextI = current.i + n.di;
            const nextJ = current.j + n.dj;
            const neighborKey = `${nextI}.${nextJ}`;
            const neighborCenter = {
                x: nextI * resolutionPx + resolutionPx / 2,
                y: nextJ * resolutionPx + resolutionPx / 2,
            };

            if (
                !canvas.dimensions.sceneRect.contains(
                    neighborCenter.x,
                    neighborCenter.y,
                )
            )
                continue;

            let newCost;
            let nextLosOrigin;

            // 1. THETA* LOGIC: Try Line of Sight back to the active "Anchor"
            const hasLOS = !CONFIG.Canvas.polygonBackends.move.testCollision(
                current.losOrigin,
                neighborCenter,
                { type: "move", mode: "any" },
            );

            if (hasLOS) {
                // Perfect Euclidean distance from the anchor.
                const distPx = Math.hypot(
                    neighborCenter.x - current.losOrigin.x,
                    neighborCenter.y - current.losOrigin.y,
                );
                let distUnits = (distPx / sizePerGridUnit) * costPerGridUnit;

                // If measuring from the token's original center, subtract its radius
                // so we only charge movement for distance travelled OUTSIDE the token's edge.
                if (current.losOrigin.isInitial) {
                    const tokenRadiusPx = Math.min(tw, th) / 2;
                    const tokenRadiusUnits =
                        (tokenRadiusPx / sizePerGridUnit) * costPerGridUnit;
                    // Math.max(0, ...) ensures we never give negative cost if looking inside the token
                    distUnits = Math.max(0, distUnits - tokenRadiusUnits);
                }

                newCost = current.losOrigin.cost + distUnits;
                nextLosOrigin = current.losOrigin;
            } else {
                // 2. Blocked by a corner! Fallback to adjacent micro-step and drop a new anchor
                const hasAdjacentLOS =
                    !CONFIG.Canvas.polygonBackends.move.testCollision(
                        currentCenter,
                        neighborCenter,
                        { type: "move", mode: "any" },
                    );
                if (!hasAdjacentLOS) continue; // Wall blocking the adjacent cells

                const stepPx = Math.hypot(
                    neighborCenter.x - currentCenter.x,
                    neighborCenter.y - currentCenter.y,
                );
                const stepUnits = (stepPx / sizePerGridUnit) * costPerGridUnit;
                newCost = current.cost + stepUnits;

                // Drop a new anchor at this corner
                nextLosOrigin = {
                    x: currentCenter.x,
                    y: currentCenter.y,
                    cost: current.cost,
                    isInitial: false, // Explicitly flag that this is NOT the token center!
                };
            }

            if (newCost > searchLimit) continue;

            const oldCost = minCosts.get(neighborKey);
            if (oldCost === undefined || newCost < oldCost) {
                minCosts.set(neighborKey, newCost);
                safetyMap.set(neighborKey, true);
                queue.push({
                    i: nextI,
                    j: nextJ,
                    cost: newCost,
                    losOrigin: nextLosOrigin,
                });
            }
        }
    }

    return processResults(
        minCosts,
        safetyMap,
        scaledPaces,
        syntheticGrid,
        costPerGridUnit,
    );
}

function _createSyntheticGrid(resolutionPx, distancePerCell) {
    return {
        type: CONST.GRID_TYPES.SQUARE,
        size: resolutionPx,
        distance: distancePerCell,
        getOffset: (pt) => ({
            i: Math.floor(pt.x / resolutionPx),
            j: Math.floor(pt.y / resolutionPx),
        }),
        getCenterPoint: (coord) => ({
            x: coord.i * resolutionPx + resolutionPx / 2,
            y: coord.j * resolutionPx + resolutionPx / 2,
        }),
        getTopLeftPoint: (coord) => ({
            x: coord.i * resolutionPx,
            y: coord.j * resolutionPx,
        }),
    };
}

// ----------------------------------------------------------------------
// SQUARE & HEX LEGACY ALGORITHMS
// ----------------------------------------------------------------------

function _calculateSquare(
    token,
    scaledPaces,
    grid,
    centerPt,
    startX,
    startY,
    tw,
    th,
    wallCheckCache,
) {
    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    _initializeTokenFootprint(
        queue,
        minCosts,
        safetyMap,
        grid,
        centerPt,
        startX,
        startY,
        tw,
        th,
        false,
    );

    const costPerGridUnit = Number(grid.distance);
    const maxDistance = Math.max(...scaledPaces.map((p) => p.distance));
    const searchLimit = maxDistance + costPerGridUnit;

    const fallbackNeighbors = [
        { di: -1, dj: 0, isDiag: false },
        { di: 1, dj: 0, isDiag: false },
        { di: 0, dj: -1, isDiag: false },
        { di: 0, dj: 1, isDiag: false },
        { di: -1, dj: -1, isDiag: true },
        { di: -1, dj: 1, isDiag: true },
        { di: 1, dj: -1, isDiag: true },
        { di: 1, dj: 1, isDiag: true },
    ];

    while (queue.length > 0) {
        const current = queue.pop();
        const currentKey = `${current.i}.${current.j}`;

        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = grid.getCenterPoint({
            i: current.i,
            j: current.j,
        });

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
            neighbors = fallbackNeighbors.map((n) => ({
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

            const oldCost = minCosts.get(neighborKey);
            const wasSafe = safetyMap.get(neighborKey);
            const isNowSafe = true;

            if (oldCost !== undefined && newCost >= oldCost) {
                if (wasSafe && !isNowSafe) continue;
                if (wasSafe === isNowSafe) continue;
            }

            const isReachable = checkCellStrict(
                token,
                currentCenter,
                neighborCenter,
                neighborKey,
                wallCheckCache,
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

function _calculateHex(
    token,
    scaledPaces,
    grid,
    centerPt,
    startX,
    startY,
    tw,
    th,
    wallCheckCache,
) {
    const minCosts = new Map();
    const safetyMap = new Map();
    const queue = new MinHeap();

    _initializeTokenFootprint(
        queue,
        minCosts,
        safetyMap,
        grid,
        centerPt,
        startX,
        startY,
        tw,
        th,
        false,
    );

    const costPerGridUnit = Number(grid.distance);
    const maxDistance = Math.max(...scaledPaces.map((p) => p.distance));
    const searchLimit = maxDistance + costPerGridUnit;

    while (queue.length > 0) {
        const current = queue.pop();
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

            const isDirectReachable = checkCellStrict(
                token,
                currentCenter,
                neighborCenter,
                neighborKey,
                wallCheckCache,
            );

            if (isDirectReachable) {
                const newCost = current.cost + stepDist;

                if (newCost <= searchLimit) {
                    const oldCost = minCosts.get(neighborKey);
                    const wasSafe = safetyMap.get(neighborKey);
                    const isNowSafe = true;

                    let shouldUpdate = false;
                    if (oldCost === undefined) shouldUpdate = true;
                    else if (wasSafe === false && isNowSafe === true)
                        shouldUpdate = true;
                    else if (newCost < oldCost && wasSafe === isNowSafe)
                        shouldUpdate = true;

                    if (shouldUpdate) {
                        minCosts.set(neighborKey, newCost);
                        safetyMap.set(neighborKey, true);
                        queue.push({ i: nextI, j: nextJ, cost: newCost });
                    }
                }
            } else {
                const jumpNeighbors = grid.getAdjacentOffsets({
                    i: nextI,
                    j: nextJ,
                });

                for (const jn of jumpNeighbors) {
                    const jumpI = jn.i;
                    const jumpJ = jn.j;
                    if (jumpI === current.i && jumpJ === current.j) continue;

                    const jumpKey = `${jumpI}.${jumpJ}`;
                    const jumpCenter = grid.getCenterPoint({
                        i: jumpI,
                        j: jumpJ,
                    });

                    const isJumpReachable = checkCellStrict(
                        token,
                        currentCenter,
                        jumpCenter,
                        jumpKey,
                        wallCheckCache,
                    );

                    if (isJumpReachable) {
                        const jumpCost = current.cost + stepDist * 2;
                        if (jumpCost > searchLimit) continue;

                        const bridgeCost = current.cost + stepDist;
                        const oldJumpCost = minCosts.get(jumpKey);
                        const jumpWasSafe = safetyMap.get(jumpKey);
                        const jumpIsSafe = true;

                        let updateJump = false;
                        if (oldJumpCost === undefined) updateJump = true;
                        else if (jumpWasSafe === false && jumpIsSafe === true)
                            updateJump = true;
                        else if (
                            jumpCost < oldJumpCost &&
                            jumpWasSafe === jumpIsSafe
                        )
                            updateJump = true;

                        if (updateJump) {
                            minCosts.set(jumpKey, jumpCost);
                            safetyMap.set(jumpKey, true);
                            queue.push({ i: jumpI, j: jumpJ, cost: jumpCost });
                        }

                        const oldBridgeCost = minCosts.get(neighborKey);
                        const bridgeWasSafe = safetyMap.get(neighborKey);

                        let updateBridge = false;
                        if (oldBridgeCost === undefined) updateBridge = true;
                        else if (bridgeWasSafe === true) updateBridge = false;
                        else if (bridgeCost < oldBridgeCost)
                            updateBridge = true;

                        if (updateBridge) {
                            minCosts.set(neighborKey, bridgeCost);
                            safetyMap.set(neighborKey, false);
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

function checkCellStrict(
    token,
    originPoint,
    destCenter,
    cacheKey,
    wallCheckCache,
) {
    let isClear = wallCheckCache.get(cacheKey);
    if (isClear === undefined) {
        // We removed the 2px bounding box tolerance check here that was artificially snagging on doors!
        isClear = true;
        wallCheckCache.set(cacheKey, isClear);
    }
    if (!isClear) return false;

    return !CONFIG.Canvas.polygonBackends.move.testCollision(
        originPoint,
        destCenter,
        { type: "move", mode: "any", source: null },
    );
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
                    isAnchor: cost === 0,
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

class MinHeap {
    constructor() {
        this.data = [];
    }
    push(val) {
        this.data.push(val);
        this.bubbleUp(this.data.length - 1);
    }
    pop() {
        if (this.data.length === 0) return undefined;
        if (this.data.length === 1) return this.data.pop();
        const top = this.data[0];
        this.data[0] = this.data.pop();
        this.bubbleDown(0);
        return top;
    }
    get length() {
        return this.data.length;
    }
    bubbleUp(index) {
        while (index > 0) {
            let parent = (index - 1) >>> 1;
            if (this.data[parent].cost <= this.data[index].cost) break;
            let tmp = this.data[parent];
            this.data[parent] = this.data[index];
            this.data[index] = tmp;
            index = parent;
        }
    }
    bubbleDown(index) {
        const len = this.data.length;
        while (true) {
            let left = (index << 1) + 1;
            let right = left + 1;
            let smallest = index;
            if (left < len && this.data[left].cost < this.data[smallest].cost)
                smallest = left;
            if (right < len && this.data[right].cost < this.data[smallest].cost)
                smallest = right;
            if (smallest === index) break;
            let tmp = this.data[index];
            this.data[index] = this.data[smallest];
            this.data[smallest] = tmp;
            index = smallest;
        }
    }
}

/**
 * Unifies the initial token footprint calculation across all 3 grid modes.
 * Prevents wall leaks and handles Tiny tokens that don't fill a whole square.
 */
function _initializeTokenFootprint(
    queue,
    minCosts,
    safetyMap,
    grid,
    centerPt,
    startX,
    startY,
    tw,
    th,
    isTheta = false,
) {
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

    // Added isInitial flag to track when we are measuring from the true center
    const startOrigin = {
        x: centerPt.x,
        y: centerPt.y,
        cost: 0,
        isInitial: true,
    };

    for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
            const center = grid.getCenterPoint({ i, j });
            if (
                center.x >= safeLeft &&
                center.x <= safeRight &&
                center.y >= safeTop &&
                center.y <= safeBottom
            ) {
                const isVisible =
                    !CONFIG.Canvas.polygonBackends.move.testCollision(
                        centerPt,
                        center,
                        { type: "move", mode: "any" },
                    );

                if (isVisible) {
                    const key = `${i}.${j}`;
                    if (!minCosts.has(key)) {
                        minCosts.set(key, 0);
                        safetyMap.set(key, true);
                        if (isTheta) {
                            queue.push({
                                i,
                                j,
                                cost: 0,
                                losOrigin: startOrigin,
                            });
                        } else {
                            queue.push({ i, j, cost: 0 });
                        }
                    }
                }
            }
        }
    }

    // Fallback: If token is so small it doesn't encompass any grid centers (e.g. Tiny),
    // force its current occupied cell as the starting point.
    if (queue.length === 0) {
        const centerOffset = grid.getOffset(centerPt);
        const key = `${centerOffset.i}.${centerOffset.j}`;
        minCosts.set(key, 0);
        safetyMap.set(key, true);
        if (isTheta) {
            queue.push({
                i: centerOffset.i,
                j: centerOffset.j,
                cost: 0,
                losOrigin: startOrigin,
            });
        } else {
            queue.push({ i: centerOffset.i, j: centerOffset.j, cost: 0 });
        }
    }
}
