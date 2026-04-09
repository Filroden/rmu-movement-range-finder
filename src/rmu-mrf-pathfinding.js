/**
 * RMU Movement Range Finder - Pathfinding
 * Nav-Mesh Portal Architecture
 */

import { getRoundingMode, getGridlessResolution } from "./rmu-mrf-settings.js";

const METRIC_UNITS = ["m", "m.", "meter", "meters", "metre", "metres"];
const FT_PER_METER = 3.33333;

const globalPortalCache = new Map();

export function calculateReachableSquares(token, movementPaces, originOverride = null, trackedViewZ = 0) {
    if (!token?.actor || !movementPaces || movementPaces.length === 0) return new Map();

    const grid = canvas.grid;
    const regionCache = _buildRegionCache();

    const units = canvas.scene.grid.units?.toLowerCase();
    const distanceScale = units && METRIC_UNITS.includes(units) ? 1 / FT_PER_METER : 1;
    const scaledPaces = movementPaces.map((p) => ({ ...p, distance: p.distance * distanceScale }));

    const startX = originOverride ? originOverride.x : token.document.x;
    const startY = originOverride ? originOverride.y : token.document.y;
    const tw = token.w;
    const th = token.h;
    const centerPt = originOverride ? { x: startX + tw / 2, y: startY + th / 2 } : token.center;

    // TRUE ABSOLUTE ELEVATION
    const viewZ = trackedViewZ; // FIX: Use the perfectly tracked Hook value
    const tokenZ = token.document?.elevation ?? 0;

    const wallCheckCache = new Map();

    // ---------------------------------------------------------
    // PHASE 1: GUARANTEED CACHE GENERATION
    // ---------------------------------------------------------
    let cacheData = globalPortalCache.get(token.id);

    // Rebuild cache if token changes its absolute floor OR moves horizontally
    if (!cacheData || cacheData.nativeZ !== tokenZ || cacheData.x !== startX || cacheData.y !== startY) {
        const nativeResults = _runAlgorithm(grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, tokenZ, regionCache);
        _cacheReachablePortals(token.id, startX, startY, nativeResults, regionCache, tokenZ);
        cacheData = globalPortalCache.get(token.id);

        if (viewZ === tokenZ) return nativeResults;
    }

    // ---------------------------------------------------------
    // PHASE 2: RENDERER ROUTING
    // ---------------------------------------------------------
    if (viewZ === tokenZ) {
        return _runAlgorithm(grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, viewZ, regionCache);
    } else {
        const seeds = _getSeedsForView(token.id, viewZ, scaledPaces);
        if (!seeds || seeds.length === 0) return new Map(); // Fails safely if no stairs reach this floor

        return _runAlgorithm(grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, viewZ, regionCache, seeds);
    }
}

// ----------------------------------------------------------------------
// ALGORITHM WRAPPER
// ----------------------------------------------------------------------
function _runAlgorithm(grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null) {
    const isHex = grid.type !== CONST.GRID_TYPES.SQUARE && grid.type !== CONST.GRID_TYPES.GRIDLESS;

    if (grid.type === CONST.GRID_TYPES.GRIDLESS) {
        return _calculateGridlessTheta(token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds);
    } else if (isHex) {
        return _calculateHex(token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds);
    } else {
        return _calculateSquare(token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds);
    }
}

// ----------------------------------------------------------------------
// THE PORTAL SYSTEM
// ----------------------------------------------------------------------
function _buildRegionCache() {
    const portals = [];
    const surfaces = [];
    if (!canvas.scene.regions) return { portals, surfaces };

    for (const regionDoc of canvas.scene.regions.contents) {
        // V14 Level support: Safely convert the Foundry Set into a standard Array
        const regionLevels = regionDoc.levels ? Array.from(regionDoc.levels) : [];

        if (regionDoc.behaviors.some((b) => b.type === "changeLevel" && !b.disabled)) {
            portals.push({
                doc: regionDoc,
                levels: regionLevels,
                bottomZ: regionDoc.elevation.bottom ?? -10000,
                topZ: regionDoc.elevation.top ?? 10000,
            });
        }
        if (regionDoc.behaviors.some((b) => b.type === "defineSurface" && !b.disabled)) {
            surfaces.push({
                doc: regionDoc,
                levels: regionLevels,
                bottomZ: regionDoc.elevation.bottom ?? 0,
            });
        }
    }
    return { portals, surfaces };
}

/**
 * Determines if a valid walkable surface exists at the target coordinates and elevation.
 * Updated for Foundry V14 Scene Region Levels.
 */
function _hasFloorAt(x, y, targetZ, regionCache) {
    // Determine which V14 Level exists at this specific elevation
    const activeLevel = canvas.scene.levels.find((l) => targetZ >= l.elevation.bottom && targetZ < l.elevation.top);
    const activeLevelId = activeLevel?.id;

    // 1. Check Defined Surfaces (Floors)
    for (const s of regionCache.surfaces) {
        const levelMatch = activeLevelId && s.levels?.includes(activeLevelId);
        const elevationMatch = targetZ === s.bottomZ;

        // If the level matches OR the numeric elevation matches, test the point geometry
        if ((levelMatch || elevationMatch) && s.doc.testPoint({ x, y, elevation: targetZ })) {
            return true;
        }
    }

    // 2. Check Portals (Stairs/Ladders)
    for (const p of regionCache.portals) {
        const levelMatch = activeLevelId && p.levels?.includes(activeLevelId);
        const elevationMatch = targetZ >= p.bottomZ && targetZ <= p.topZ;

        if ((levelMatch || elevationMatch) && p.doc.testPoint({ x, y, elevation: targetZ })) {
            return true;
        }
    }

    // 3. Scene Base Elevation Fallback
    const baseZ = canvas.scene?.elevation ?? 0;
    if (targetZ === baseZ || targetZ === 0) return true;

    return false;
}

function _cacheReachablePortals(tokenId, startX, startY, resultMap, regionCache, currentZ) {
    const reachablePortals = [];

    // Apply the strict exclusive-top level checking here
    const nativeLevelId = canvas.scene.levels.find((l) => currentZ >= l.elevation.bottom && currentZ < l.elevation.top)?.id;

    for (const [key, square] of resultMap.entries()) {
        const center = canvas.grid.getCenterPoint({ i: square.i, j: square.j });
        for (const portal of regionCache.portals) {
            let levelMatch = false;
            if (nativeLevelId && portal.levels?.length) {
                levelMatch = portal.levels.includes(nativeLevelId);
            } else {
                levelMatch = currentZ >= portal.bottomZ && currentZ < portal.topZ;
            }

            // Use currentZ instead of portal's bottom value to validate geometry correctly
            if (levelMatch && portal.doc.testPoint({ x: center.x, y: center.y, elevation: currentZ })) {
                // MUTATE NATIVE MAP: Flag this square as a portal for native floor rendering
                square.isPortal = true;

                // CACHE THE PATH: Build the array of points back to the anchor
                const pathToPortal = [];
                let pathSq = square;
                const visited = new Set();
                while (pathSq) {
                    const pCenter = canvas.grid.getCenterPoint({ i: pathSq.i, j: pathSq.j });
                    pathToPortal.push({ x: pCenter.x, y: pCenter.y });
                    if (pathSq.isAnchor || visited.has(pathSq.parentKey)) break;
                    visited.add(pathSq.parentKey);
                    pathSq = resultMap.get(pathSq.parentKey);
                }

                reachablePortals.push({
                    i: square.i,
                    j: square.j,
                    cost: square.cost,
                    parentGridKey: square.parentGridKey,
                    losOrigin: square.losOrigin || null,
                    portalTop: portal.topZ,
                    portalBottom: portal.bottomZ,
                    levels: portal.levels,
                    pathToPortal: pathToPortal, // INJECT PATH
                });
                break; // Prevent pushing the same portal multiple times for a single square
            }
        }
    }
    globalPortalCache.set(tokenId, { nativeZ: currentZ, x: startX, y: startY, portals: reachablePortals });
}

/**
 * Generates pathfinding seeds for the current view elevation based on reachable portals.
 * Updated for Foundry V14 Scene Region Levels.
 */
function _getSeedsForView(tokenId, viewZ, scaledPaces) {
    const cacheData = globalPortalCache.get(tokenId);
    if (!cacheData) return null;

    const seeds = [];
    const costPerGridUnit = Number(canvas.scene.grid.distance);
    const maxSearchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;

    // Get Level IDs for the token's floor and the floor the GM/User is currently viewing
    const nativeLevelId = canvas.scene.levels.find((l) => cacheData.nativeZ >= l.elevation.bottom && cacheData.nativeZ < l.elevation.top)?.id;
    const viewLevelId = canvas.scene.levels.find((l) => viewZ >= l.elevation.bottom && viewZ < l.elevation.top)?.id;

    for (const p of cacheData.portals) {
        let isReachable = false;

        // V14 Level Validation: The region must span both the start and end levels
        if (nativeLevelId && viewLevelId && p.levels) {
            // FIX: Ensure p.levels exists before checking
            isReachable = p.levels.includes(nativeLevelId) && p.levels.includes(viewLevelId);
        }

        // Fallback: If Levels aren't defined, use numeric elevation ranges
        if (!isReachable) {
            const minZ = Math.min(cacheData.nativeZ, viewZ);
            const maxZ = Math.max(cacheData.nativeZ, viewZ);
            isReachable = p.portalBottom <= minZ && p.portalTop >= maxZ;
        }

        if (isReachable) {
            // Cost includes the horizontal distance to the portal + vertical transition
            const zDiffUnits = Math.abs(viewZ - cacheData.nativeZ);
            const totalCost = p.cost + zDiffUnits;

            if (totalCost <= maxSearchLimit) {
                seeds.push({
                    i: p.i,
                    j: p.j,
                    cost: totalCost,
                    parentGridKey: p.parentGridKey,
                    losOrigin: p.losOrigin,
                    pathToPortal: p.pathToPortal, // FORWARD PATH TO NEW FLOOR
                });
            }
        }
    }
    return seeds;
}

// ----------------------------------------------------------------------
// ALGORITHM 1: SQUARE
// ----------------------------------------------------------------------
function _calculateSquare(token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null) {
    const parents = new Map();
    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    _initializeQueue(parents, queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, false, wallCheckCache, targetZ, seeds);

    const costPerGridUnit = Number(grid.distance);
    const searchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;
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

        const currentCenter = grid.getCenterPoint({ i: current.i, j: current.j });
        let neighbors = grid.getAdjacentOffsets
            ? grid.getAdjacentOffsets({ i: current.i, j: current.j }).map((n) => ({ i: n.i, j: n.j, isDiag: Math.abs(n.i - current.i) === 1 && Math.abs(n.j - current.j) === 1 }))
            : fallbackNeighbors.map((n) => ({ i: current.i + n.di, j: current.j + n.dj, isDiag: n.isDiag }));

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.i}.${neighbor.j}`;
            const neighborCenter = grid.getCenterPoint({ i: neighbor.i, j: neighbor.j });

            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;

            if (!_hasFloorAt(neighborCenter.x, neighborCenter.y, targetZ, regionCache)) continue;

            let stepDist = neighbor.isDiag ? costPerGridUnit * 1.4142 : costPerGridUnit;
            const newCost = current.cost + stepDist;
            if (newCost > searchLimit) continue;

            const origin3D = { x: currentCenter.x, y: currentCenter.y, elevation: targetZ + 0.1 };
            const dest3D = { x: neighborCenter.x, y: neighborCenter.y, elevation: targetZ + 0.1 };

            if (checkCellStrict(origin3D, dest3D, wallCheckCache)) {
                const oldCost = minCosts.get(neighborKey);
                if (oldCost === undefined || newCost < oldCost) {
                    minCosts.set(neighborKey, newCost);
                    parents.set(neighborKey, currentKey);
                    safetyMap.set(neighborKey, true);
                    queue.push({ i: neighbor.i, j: neighbor.j, cost: newCost });
                }
            }
        }
    }
    return processResults(minCosts, safetyMap, scaledPaces, grid, costPerGridUnit, parents, seeds);
}

// ----------------------------------------------------------------------
// ALGORITHM 2: HEX
// ----------------------------------------------------------------------
function _calculateHex(token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null) {
    const parents = new Map();
    const minCosts = new Map();
    const safetyMap = new Map();
    const queue = new MinHeap();

    _initializeQueue(parents, queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, false, wallCheckCache, targetZ, seeds);

    const costPerGridUnit = Number(grid.distance);
    const searchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;

    while (queue.length > 0) {
        const current = queue.pop();
        const currentKey = `${current.i}.${current.j}`;
        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = grid.getCenterPoint({ i: current.i, j: current.j });
        const neighbors = grid.getAdjacentOffsets({ i: current.i, j: current.j });

        for (const neighbor of neighbors) {
            const nextI = neighbor.i;
            const nextJ = neighbor.j;
            const neighborKey = `${nextI}.${nextJ}`;
            const neighborCenter = grid.getCenterPoint({ i: nextI, j: nextJ });

            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;

            if (!_hasFloorAt(neighborCenter.x, neighborCenter.y, targetZ, regionCache)) continue;

            const stepDist = costPerGridUnit;
            const newCost = current.cost + stepDist;

            const origin3D = { x: currentCenter.x, y: currentCenter.y, elevation: targetZ + 0.1 };
            const dest3D = { x: neighborCenter.x, y: neighborCenter.y, elevation: targetZ + 0.1 };

            if (checkCellStrict(origin3D, dest3D, wallCheckCache)) {
                if (newCost <= searchLimit) {
                    const oldCost = minCosts.get(neighborKey);
                    if (oldCost === undefined || newCost < oldCost) {
                        minCosts.set(neighborKey, newCost);
                        parents.set(neighborKey, currentKey);
                        safetyMap.set(neighborKey, true);
                        queue.push({ i: nextI, j: nextJ, cost: newCost });
                    }
                }
            } else {
                const jumpNeighbors = grid.getAdjacentOffsets({ i: nextI, j: nextJ });
                for (const jn of jumpNeighbors) {
                    const jumpI = jn.i;
                    const jumpJ = jn.j;
                    if (jumpI === current.i && jumpJ === current.j) continue;

                    const jumpKey = `${jumpI}.${jumpJ}`;
                    const jumpCenter = grid.getCenterPoint({ i: jumpI, j: jumpJ });

                    if (!_hasFloorAt(jumpCenter.x, jumpCenter.y, targetZ, regionCache)) continue;

                    const jumpCost = current.cost + costPerGridUnit * 2;
                    if (jumpCost > searchLimit) continue;

                    const jumpDest3D = { x: jumpCenter.x, y: jumpCenter.y, elevation: targetZ + 0.1 };

                    if (checkCellStrict(origin3D, jumpDest3D, wallCheckCache)) {
                        const oldJumpCost = minCosts.get(jumpKey);
                        if (oldJumpCost === undefined || jumpCost < oldJumpCost) {
                            minCosts.set(jumpKey, jumpCost);
                            parents.set(jumpKey, currentKey);
                            safetyMap.set(jumpKey, true);
                            queue.push({ i: jumpI, j: jumpJ, cost: jumpCost });
                        }
                    }
                }
            }
        }
    }
    return processResults(minCosts, safetyMap, scaledPaces, grid, costPerGridUnit, parents, seeds);
}

// ----------------------------------------------------------------------
// ALGORITHM 3: GRIDLESS (Theta*)
// ----------------------------------------------------------------------
function _calculateGridlessTheta(token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null) {
    const parents = new Map();
    const resolutionPx = getGridlessResolution();
    const costPerGridUnit = canvas.scene.grid.distance;
    const sizePerGridUnit = canvas.scene.grid.size;

    const microDistance = (resolutionPx / sizePerGridUnit) * costPerGridUnit;
    const syntheticGrid = _createSyntheticGrid(resolutionPx, microDistance);

    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    _initializeQueue(parents, queue, minCosts, safetyMap, syntheticGrid, centerPt, startX, startY, tw, th, true, wallCheckCache, targetZ, seeds);

    const searchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit * 2;
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

        const currentCenter = { x: current.i * resolutionPx + resolutionPx / 2, y: current.j * resolutionPx + resolutionPx / 2 };

        for (const n of neighborsOffsets) {
            const nextI = current.i + n.di;
            const nextJ = current.j + n.dj;
            const neighborKey = `${nextI}.${nextJ}`;
            const neighborCenter = { x: nextI * resolutionPx + resolutionPx / 2, y: nextJ * resolutionPx + resolutionPx / 2 };

            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;

            if (!_hasFloorAt(neighborCenter.x, neighborCenter.y, targetZ, regionCache)) continue;

            let newCost;
            let nextLosOrigin;

            const losOrigin3D = { x: current.losOrigin.x, y: current.losOrigin.y, elevation: targetZ + 0.1 };
            const current3D = { x: currentCenter.x, y: currentCenter.y, elevation: targetZ + 0.1 };
            const dest3D = { x: neighborCenter.x, y: neighborCenter.y, elevation: targetZ + 0.1 };

            const hasLOS = !CONFIG.Canvas.polygonBackends.move.testCollision(losOrigin3D, dest3D, { type: "move", mode: "any" });

            if (hasLOS) {
                const distPx = Math.hypot(neighborCenter.x - current.losOrigin.x, neighborCenter.y - current.losOrigin.y);
                let distUnits = (distPx / sizePerGridUnit) * costPerGridUnit;

                if (current.losOrigin.isInitial) {
                    const tokenRadiusPx = Math.min(tw, th) / 2;
                    distUnits = Math.max(0, distUnits - (tokenRadiusPx / sizePerGridUnit) * costPerGridUnit);
                }
                newCost = current.losOrigin.cost + distUnits;
                nextLosOrigin = current.losOrigin;
            } else {
                const hasAdjacentLOS = !CONFIG.Canvas.polygonBackends.move.testCollision(current3D, dest3D, { type: "move", mode: "any" });
                if (!hasAdjacentLOS) continue;

                const stepPxXY = Math.hypot(neighborCenter.x - currentCenter.x, neighborCenter.y - currentCenter.y);
                newCost = current.cost + (stepPxXY / sizePerGridUnit) * costPerGridUnit;
                nextLosOrigin = { x: currentCenter.x, y: currentCenter.y, cost: current.cost, isInitial: false };
            }

            if (newCost > searchLimit) continue;

            const oldCost = minCosts.get(neighborKey);
            if (oldCost === undefined || newCost < oldCost) {
                minCosts.set(neighborKey, newCost);
                parents.set(neighborKey, currentKey);
                safetyMap.set(neighborKey, true);
                queue.push({ i: nextI, j: nextJ, cost: newCost, losOrigin: nextLosOrigin });
            }
        }
    }
    return processResults(minCosts, safetyMap, scaledPaces, syntheticGrid, costPerGridUnit, parents, seeds);
}

function _createSyntheticGrid(resolutionPx, distancePerCell) {
    return {
        type: CONST.GRID_TYPES.SQUARE,
        size: resolutionPx,
        distance: distancePerCell,
        getOffset: (pt) => ({ i: Math.floor(pt.x / resolutionPx), j: Math.floor(pt.y / resolutionPx) }),
        getCenterPoint: (coord) => ({ x: coord.i * resolutionPx + resolutionPx / 2, y: coord.j * resolutionPx + resolutionPx / 2 }),
        getTopLeftPoint: (coord) => ({ x: coord.i * resolutionPx, y: coord.j * resolutionPx }),
    };
}

// --- HELPERS ---

function checkCellStrict(originPt, destPt, wallCheckCache) {
    const cacheKey = `${Math.round(originPt.x)},${Math.round(originPt.y)}->${Math.round(destPt.x)},${Math.round(destPt.y)}`;
    let isClear = wallCheckCache.get(cacheKey);
    if (isClear === undefined) {
        isClear = !CONFIG.Canvas.polygonBackends.move.testCollision(originPt, destPt, { type: "move", mode: "any" });
        wallCheckCache.set(cacheKey, isClear);
    }
    return isClear;
}

function processResults(minCosts, safetyMap, scaledPaces, grid, costPerGridUnit, parents, seeds = null) {
    const roundingRule = getRoundingMode();
    const resultSquares = new Map();
    const sortedPaces = [...scaledPaces].sort((a, b) => a.distance - b.distance);

    const limitPace = scaledPaces.find((p) => p.isActionLimit) || scaledPaces.find((p) => p.name === "Sprint") || (sortedPaces.length > 1 ? sortedPaces[1] : sortedPaces[0]);
    const limitDistance = limitPace ? limitPace.distance : 0;
    const limitColor = limitPace ? limitPace.color : "#FFFFFF";

    // Create a fast lookup for seeds on this floor
    const seedLookup = new Map();
    if (seeds) {
        for (const s of seeds) seedLookup.set(`${s.i}.${s.j}`, s);
    }

    for (const [key, cost] of minCosts) {
        const [i, j] = key.split(".").map(Number);

        const parentKeyData = parents ? parents.get(key) : null;
        let parentKey = null;
        if (parentKeyData) {
            const [pI, pJ] = parentKeyData.split(".").map(Number);
            const pTopLeft = grid.getTopLeftPoint({ i: pI, j: pJ });
            parentKey = `${Math.round(pTopLeft.x)}.${Math.round(pTopLeft.y)}`;
        }

        let bestPace = null;
        for (const pace of sortedPaces) {
            if (isCostWithinPace(cost, pace.distance, roundingRule, costPerGridUnit)) {
                bestPace = pace;
                break;
            }
        }

        if (bestPace) {
            const topLeft = grid.getTopLeftPoint({ i, j });
            const isInnerZone = isCostWithinPace(cost, limitDistance, roundingRule, costPerGridUnit);
            const isSafe = safetyMap.get(key) === true;

            const seedData = seedLookup.get(key);

            resultSquares.set(`${Math.round(topLeft.x)}.${Math.round(topLeft.y)}`, {
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
                isPortal: !!seedData,
                pathToPortal: seedData ? seedData.pathToPortal : null,
                parentGridKey: parentKeyData, // i.j key exclusively for cross-floor Dijkstra linkage
                parentKey: parentKey, // x.y key exclusively for hover rendering
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
            if (left < len && this.data[left].cost < this.data[smallest].cost) smallest = left;
            if (right < len && this.data[right].cost < this.data[smallest].cost) smallest = right;
            if (smallest === index) break;
            let tmp = this.data[index];
            this.data[index] = this.data[smallest];
            this.data[smallest] = tmp;
            index = smallest;
        }
    }
}

function _initializeQueue(parents, queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, isTheta, wallCheckCache, targetZ, seeds) {
    if (seeds && seeds.length > 0) {
        for (const seed of seeds) {
            const key = `${seed.i}.${seed.j}`;

            const oldCost = minCosts.get(key);
            if (oldCost === undefined || seed.cost < oldCost) {
                minCosts.set(key, seed.cost);
                safetyMap.set(key, true);
                parents.set(key, seed.parentGridKey); // Use the protected i.j key!

                if (isTheta) {
                    const center = grid.getCenterPoint({ i: seed.i, j: seed.j });
                    seed.losOrigin = seed.losOrigin || { x: center.x, y: center.y, cost: seed.cost, isInitial: false };
                }
                queue.push(seed);
            }
        }
        return;
    }

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

    const startOrigin = { x: centerPt.x, y: centerPt.y, cost: 0, isInitial: true };
    const origin3D = { x: centerPt.x, y: centerPt.y, elevation: targetZ + 0.1 };

    for (let i = minI; i <= maxI; i++) {
        for (let j = minJ; j <= maxJ; j++) {
            const center = grid.getCenterPoint({ i, j });
            if (center.x >= safeLeft && center.x <= safeRight && center.y >= safeTop && center.y <= safeBottom) {
                const dest3D = { x: center.x, y: center.y, elevation: targetZ + 0.1 };
                const isVisible = checkCellStrict(origin3D, dest3D, wallCheckCache);

                if (isVisible) {
                    const key = `${i}.${j}`;
                    if (!minCosts.has(key)) {
                        minCosts.set(key, 0);
                        safetyMap.set(key, true);
                        if (isTheta) queue.push({ i, j, cost: 0, losOrigin: startOrigin });
                        else queue.push({ i, j, cost: 0 });
                    }
                }
            }
        }
    }

    if (queue.length === 0) {
        const centerOffset = grid.getOffset(centerPt);
        const key = `${centerOffset.i}.${centerOffset.j}`;
        minCosts.set(key, 0);
        safetyMap.set(key, true);
        if (isTheta) queue.push({ i: centerOffset.i, j: centerOffset.j, cost: 0, losOrigin: startOrigin });
        else queue.push({ i: centerOffset.i, j: centerOffset.j, cost: 0 });
    }
}
