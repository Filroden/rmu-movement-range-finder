/**
 * RMU Movement Range Finder - Pathfinding
 * ---------------------------------------
 * Architecture: Nav-Mesh Portal & Dijkstra/Theta* Implementation
 * * This file contains the core spatial mathematics for the module. It handles:
 * 1. 2D Routing: Evaluating movement costs across Square, Hex, and Gridless topologies.
 * 2. 3D Routing: Utilising Foundry V14 Scene Regions to calculate contiguous paths
 * across multiple elevations (e.g., climbing stairs and continuing to move).
 * 3. Cache Management: Isolating native-floor calculations from dynamic view-floor
 * renders to maintain high performance.
 */

import { getRoundingMode, getGridlessResolution } from "./rmu-mrf-settings.js";

// --- CONSTANTS & CONVERSION ---
const METRIC_UNITS = new Set(["m", "m.", "meter", "meters", "metre", "metres"]);
const FT_PER_METER = 3.33333;

/**
 * Global cache for cross-floor navigation.
 * Stores reachable portals discovered during the native floor pass. This prevents
 * the engine from recalculating the entire base floor every time the GM changes
 * their elevation view to inspect the upper floors.
 * @type {Map<string, object>}
 */
const globalPortalCache = new Map();

/**
 * Primary entry point for range calculations.
 * Orchestrates the transition between native pathfinding and cross-floor navigation.
 * * @param {Token} token - The active token moving across the grid.
 * @param {Array} movementPaces - Formatted paces extracted from the RMU actor system.
 * @param {object|null} originOverride - Used if the path originates from a saved anchor point.
 * @param {number} trackedViewZ - The absolute elevation currently being viewed by the camera.
 * @param {boolean} forceRecalc - If true, bypasses caches and rebuilds the node matrix.
 * @returns {Map} A matrix of reachable cells and their associated costs/metadata.
 */
export function calculateReachableSquares(token, movementPaces, originOverride = null, trackedViewZ = 0, forceRecalc = false) {
    if (!token?.actor || !movementPaces || movementPaces.length === 0) return new Map();

    const grid = canvas.grid;
    const regionCache = _buildRegionCache();

    // Scale distances dynamically if the scene uses a metric grid
    const units = canvas.scene.grid.units?.toLowerCase();
    const distanceScale = units && METRIC_UNITS.has(units) ? 1 / FT_PER_METER : 1;
    const scaledPaces = movementPaces.map((p) => ({ ...p, distance: p.distance * distanceScale }));

    const startX = originOverride ? originOverride.x : token.document.x;
    const startY = originOverride ? originOverride.y : token.document.y;
    const tw = token.w;
    const th = token.h;
    const centerPt = originOverride ? { x: startX + tw / 2, y: startY + th / 2 } : token.center;

    // TRUE ABSOLUTE ELEVATION
    const viewZ = trackedViewZ;
    const tokenZ = token.document?.elevation ?? 0;

    // Shared cache for collision raycasts to drastically reduce CPU load within a single pass
    const wallCheckCache = new Map();

    // ---------------------------------------------------------
    // PHASE 1: NATIVE FLOOR CACHING
    // ---------------------------------------------------------
    let cacheData = globalPortalCache.get(token.id);

    // Invalidate the cache if the token physically moves or changes elevation
    const tokenHasMoved = !cacheData || cacheData.nativeZ !== tokenZ || cacheData.x !== startX || cacheData.y !== startY;

    // Architectural Guard: Only allow wall-updates (forceRecalc) to wipe the native cache
    // IF we are actively viewing the native floor. If we recalculate the native floor
    // while viewing a different floor, Foundry tests the native paths against the wrong wall geometry!
    const shouldRecalcNative = tokenHasMoved || (forceRecalc && viewZ === tokenZ);

    if (shouldRecalcNative) {
        const nativeResults = _runAlgorithm({ grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ: tokenZ, regionCache });

        // Scan the results for portals (stairs) and cache them as launchpads for upper floors
        _cacheReachablePortals(token.id, startX, startY, nativeResults, regionCache, tokenZ);

        if (viewZ === tokenZ) return nativeResults;
    }

    // ---------------------------------------------------------
    // PHASE 2: RENDERER ROUTING
    // ---------------------------------------------------------
    if (viewZ === tokenZ) {
        // If we are on the native floor but didn't trigger a native cache rebuild (e.g. standard hover refresh)
        return _runAlgorithm({ grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ: viewZ, regionCache });
    } else {
        // Multi-level view: Extract the cached portals and use them as new starting seeds
        const seeds = _getSeedsForView(token.id, viewZ, scaledPaces);
        if (!seeds || seeds.length === 0) return new Map();

        return _runAlgorithm({ grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ: viewZ, regionCache, seeds });
    }
}

// ----------------------------------------------------------------------
// ALGORITHM WRAPPER
// ----------------------------------------------------------------------

/**
 * Evaluates the current scene's grid architecture and routes the parameters
 * to the mathematically appropriate pathfinding algorithm.
 */
function _runAlgorithm({ grid, token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null }) {
    const isHex = grid.type !== CONST.GRID_TYPES.SQUARE && grid.type !== CONST.GRID_TYPES.GRIDLESS;

    if (grid.type === CONST.GRID_TYPES.GRIDLESS) {
        return _calculateGridlessTheta({ token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds });
    } else if (isHex) {
        return _calculateHex({ token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds });
    } else {
        return _calculateSquare({ token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds });
    }
}

// ----------------------------------------------------------------------
// THE PORTAL SYSTEM (Scene Regions)
// ----------------------------------------------------------------------

/**
 * Scans the active scene to map out interactive geometric regions.
 * Extracts regions acting as portals (changeLevel) and walkable platforms (defineSurface).
 * @returns {object} Segregated arrays of portals and surfaces.
 */
function _buildRegionCache() {
    const portals = [];
    const surfaces = [];
    if (!canvas.scene.regions) return { portals, surfaces };

    for (const regionDoc of canvas.scene.regions.contents) {
        // V14 Level support: Safely convert the Foundry Set into a standard Array for iteration
        const regionLevels = regionDoc.levels ? Array.from(regionDoc.levels) : [];

        // Identify stairwells, ladders, or teleporters
        if (regionDoc.behaviors.some((b) => b.type === "changeLevel" && !b.disabled)) {
            portals.push({
                doc: regionDoc,
                levels: regionLevels,
                bottomZ: regionDoc.elevation.bottom ?? -10000,
                topZ: regionDoc.elevation.top ?? 10000,
            });
        }
        // Identify elevated platforms or pits
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
 * Crucial for multi-level maps to prevent paths from drawing through empty air.
 */
function _hasFloorAt(x, y, targetZ, regionCache) {
    // Determine which V14 Level exists at this specific elevation
    const activeLevelId = _getActiveLevelId(targetZ);

    // 1. Check Defined Surfaces (Floors/Platforms)
    for (const s of regionCache.surfaces) {
        const levelMatch = activeLevelId && s.levels?.includes(activeLevelId);
        const elevationMatch = targetZ === s.bottomZ;

        // If the level matches OR the numeric elevation matches, test the point geometry
        if ((levelMatch || elevationMatch) && s.doc.testPoint({ x, y, elevation: targetZ })) {
            return true;
        }
    }

    // 2. Check Portals (Stairs/Ladders that provide solid footing)
    for (const p of regionCache.portals) {
        const levelMatch = activeLevelId && p.levels?.includes(activeLevelId);
        const elevationMatch = targetZ >= p.bottomZ && targetZ <= p.topZ;

        if ((levelMatch || elevationMatch) && p.doc.testPoint({ x, y, elevation: targetZ })) {
            return true;
        }
    }

    // 3. Scene Base Elevation Fallback
    const baseZ = canvas.scene?.elevation ?? 0;

    return targetZ === baseZ || targetZ === 0;
}

/**
 * Evaluates whether a portal connects to the current elevation.
 */
function _isLevelMatch(portal, nativeLevelId, currentZ) {
    if (nativeLevelId && portal.levels?.length) {
        return portal.levels.includes(nativeLevelId);
    }
    return currentZ >= portal.bottomZ && currentZ < portal.topZ;
}

/**
 * Traces a path backwards from an exit portal to the token's origin anchor.
 * This array is passed to the renderer to draw the dashed breadcrumb trail
 * when hovering over distant upper floors.
 */
function _buildPathToPortal(startSquare, resultMap) {
    const pathToPortal = [];
    let pathSq = startSquare;
    const visited = new Set();

    while (pathSq) {
        const pCenterX = pathSq.x + pathSq.w / 2;
        const pCenterY = pathSq.y + pathSq.h / 2;
        pathToPortal.push({ x: pCenterX, y: pCenterY });

        if (pathSq.isAnchor || visited.has(pathSq.parentKey)) {
            break;
        }
        visited.add(pathSq.parentKey);
        pathSq = resultMap.get(pathSq.parentKey);
    }
    return pathToPortal;
}

/**
 * Scans the completed native floor matrix. Any reachable cell that collides
 * with a 'changeLevel' region is flagged and stored as a future starting point.
 */
function _cacheReachablePortals(tokenId, startX, startY, resultMap, regionCache, currentZ) {
    const reachablePortals = [];
    const nativeLevelId = _getActiveLevelId(currentZ);

    for (const square of resultMap.values()) {
        const centerX = square.x + square.w / 2;
        const centerY = square.y + square.h / 2;

        for (const portal of regionCache.portals) {
            const levelMatch = _isLevelMatch(portal, nativeLevelId, currentZ);
            const isColliding = portal.doc.testPoint({ x: centerX, y: centerY, z: currentZ, elevation: currentZ });

            if (levelMatch && isColliding) {
                square.isPortal = true;
                const pathToPortal = _buildPathToPortal(square, resultMap);

                reachablePortals.push({
                    i: square.i,
                    j: square.j,
                    cost: square.cost,
                    parentGridKey: square.parentGridKey,
                    losOrigin: square.losOrigin || null,
                    portalTop: portal.topZ,
                    portalBottom: portal.bottomZ,
                    levels: portal.levels,
                    pathToPortal: pathToPortal,
                });
                break; // A single cell only needs to trigger one portal
            }
        }
    }
    globalPortalCache.set(tokenId, { nativeZ: currentZ, x: startX, y: startY, portals: reachablePortals });
}

/**
 * Calculates new starting points (seeds) for pathfinding on non-native floors.
 * It takes the cached portals, adds the vertical transition penalty to their cost,
 * and filters out any portals that cannot physically reach the target view elevation.
 */
function _getSeedsForView(tokenId, viewZ, scaledPaces) {
    const cacheData = globalPortalCache.get(tokenId);
    if (!cacheData) return null;

    const seeds = [];
    const costPerGridUnit = Number(canvas.scene.grid.distance);

    // Determine the absolute max reach, including final buffer
    const maxSearchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;

    const nativeLevelId = _getActiveLevelId(cacheData.nativeZ);
    const viewLevelId = _getActiveLevelId(viewZ);

    for (const p of cacheData.portals) {
        let isReachable = false;

        // V14 Level Validation: The region must span both the start and end levels
        if (nativeLevelId && viewLevelId && p.levels) {
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

            // Only seed portals that haven't exhausted the token's movement budget
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

/**
 * Dijkstra variant for orthogonal grids.
 * Expands outward cell-by-cell, multiplying diagonal moves by 1.414 (√2) for accurate distances.
 */
function _calculateSquare({ token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null }) {
    const parents = new Map();
    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    // Populate the priority queue with either the token's footprint or the provided portals
    _initializeQueue({ parents, queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, isTheta: false, wallCheckCache, targetZ, seeds });

    const costPerGridUnit = Number(grid.distance);
    const searchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;

    // Explicit 8-way expansion matrix
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
        // Always pop the node with the lowest current cost to guarantee the shortest path
        const current = queue.pop();
        const currentKey = `${current.i}.${current.j}`;

        // Skip if a cheaper path to this node was already found and processed
        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = grid.getCenterPoint({ i: current.i, j: current.j });

        // Use Foundry's native grid logic if available, otherwise fallback to standard 8-way math
        let neighbors = grid.getAdjacentOffsets
            ? grid.getAdjacentOffsets({ i: current.i, j: current.j }).map((n) => ({ i: n.i, j: n.j, isDiag: Math.abs(n.i - current.i) === 1 && Math.abs(n.j - current.j) === 1 }))
            : fallbackNeighbors.map((n) => ({ i: current.i + n.di, j: current.j + n.dj, isDiag: n.isDiag }));

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.i}.${neighbor.j}`;
            const neighborCenter = grid.getCenterPoint({ i: neighbor.i, j: neighbor.j });

            // Ensure we don't calculate nodes outside the canvas bounds
            if (!canvas.dimensions.sceneRect.contains(neighborCenter.x, neighborCenter.y)) continue;
            // Ensure the cell has a walkable surface at this elevation
            if (!_hasFloorAt(neighborCenter.x, neighborCenter.y, targetZ, regionCache)) continue;

            // Apply diagonal penalty
            let stepDist = neighbor.isDiag ? costPerGridUnit * 1.4142 : costPerGridUnit;
            const newCost = current.cost + stepDist;
            if (newCost > searchLimit) continue;

            const origin3D = { x: currentCenter.x, y: currentCenter.y, elevation: targetZ + 0.1 };
            const dest3D = { x: neighborCenter.x, y: neighborCenter.y, elevation: targetZ + 0.1 };

            // Perform 3D Raycast to verify walls don't block the step
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

/**
 * Dijkstra variant tailored for Hexagonal grids.
 * Addresses Hex-specific geometry, including alternating row offsets and handling
 * "jumps" across blocked nodes to simulate realistic hex traversal.
 */
function _calculateHex({ token, scaledPaces, grid, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null }) {
    const parents = new Map();
    const minCosts = new Map();
    const safetyMap = new Map();
    const queue = new MinHeap();

    _initializeQueue({ parents, queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, isTheta: false, wallCheckCache, targetZ, seeds });

    const costPerGridUnit = Number(grid.distance);
    const searchLimit = Math.max(...scaledPaces.map((p) => p.distance)) + costPerGridUnit;

    while (queue.length > 0) {
        const current = queue.pop();
        const currentKey = `${current.i}.${current.j}`;
        if (current.cost > minCosts.get(currentKey)) continue;

        const currentCenter = grid.getCenterPoint({ i: current.i, j: current.j });

        // Native Foundry method to acquire 6 connected hexes, accounting for grid stagger
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
                // HEX JUMPING: If a direct neighbour is blocked, we check if we can bypass it
                // by testing the neighbours of that blocked cell. This creates organic flow
                // around hard corners on hex maps.
                const jumpNeighbors = grid.getAdjacentOffsets({ i: nextI, j: nextJ });
                for (const jn of jumpNeighbors) {
                    const jumpI = jn.i;
                    const jumpJ = jn.j;

                    // Prevent jumping back to the cell we are currently standing on
                    if (jumpI === current.i && jumpJ === current.j) continue;

                    const jumpKey = `${jumpI}.${jumpJ}`;
                    const jumpCenter = grid.getCenterPoint({ i: jumpI, j: jumpJ });

                    if (!_hasFloorAt(jumpCenter.x, jumpCenter.y, targetZ, regionCache)) continue;

                    // Jumping inherently traverses two hex boundaries, so costs double
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

/**
 * Theta* Algorithm for Gridless environments.
 * Unlike standard A* Dijkstra which moves rigidly from node to node, Theta* draws
 * line-of-sight directly from the origin point to the target. If clear, it skips
 * all intermediate nodes, resulting in perfectly radial, "any-angle" path shapes.
 * * To process this mathematically without a physical grid, we overlay a "Synthetic
 * Micro-Grid" based on user settings to define discrete validation points.
 */
function _calculateGridlessTheta({ token, scaledPaces, centerPt, startX, startY, tw, th, wallCheckCache, targetZ, regionCache, seeds = null }) {
    const parents = new Map();
    const resolutionPx = getGridlessResolution();
    const costPerGridUnit = canvas.scene.grid.distance;
    const sizePerGridUnit = canvas.scene.grid.size;

    // Convert pixels to abstract map distance units for cost scaling
    const microDistance = (resolutionPx / sizePerGridUnit) * costPerGridUnit;
    const syntheticGrid = _createSyntheticGrid(resolutionPx, microDistance);

    const minCosts = new Map();
    const queue = new MinHeap();
    const safetyMap = new Map();

    _initializeQueue({ parents, queue, minCosts, safetyMap, grid: syntheticGrid, centerPt, startX, startY, tw, th, isTheta: true, wallCheckCache, targetZ, seeds });

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

            // CORE THETA* LOGIC: Raycast directly from the historical origin, bypassing the current node
            const hasLOS = !CONFIG.Canvas.polygonBackends.move.testCollision(losOrigin3D, dest3D, { type: "move", mode: "any" });

            if (hasLOS) {
                // If LOS is clear, calculate true hypotenuse distance
                const distPx = Math.hypot(neighborCenter.x - current.losOrigin.x, neighborCenter.y - current.losOrigin.y);
                let distUnits = (distPx / sizePerGridUnit) * costPerGridUnit;

                // Adjust cost if this ray originates from the token's physical center
                if (current.losOrigin.isInitial) {
                    const tokenRadiusPx = Math.min(tw, th) / 2;
                    distUnits = Math.max(0, distUnits - (tokenRadiusPx / sizePerGridUnit) * costPerGridUnit);
                }
                newCost = current.losOrigin.cost + distUnits;
                nextLosOrigin = current.losOrigin;
            } else {
                // If LOS fails (wall hit), fall back to checking just the immediate neighbour jump
                const hasAdjacentLOS = !CONFIG.Canvas.polygonBackends.move.testCollision(current3D, dest3D, { type: "move", mode: "any" });
                if (!hasAdjacentLOS) continue; // Completely blocked

                const stepPxXY = Math.hypot(neighborCenter.x - currentCenter.x, neighborCenter.y - currentCenter.y);
                newCost = current.cost + (stepPxXY / sizePerGridUnit) * costPerGridUnit;

                // Establish this new point as a fresh raycasting origin for future steps
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

/**
 * Creates an abstract API object that mimics Foundry's native Grid class,
 * allowing standard algorithms to run on non-gridded maps without major refactoring.
 */
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

// ----------------------------------------------------------------------
// SPATIAL HELPERS & RESULTS MAPPING
// ----------------------------------------------------------------------

/**
 * Performs a strict 3D raycast collision check against Foundry's wall data.
 * Results are highly cached, as multiple path branches will frequently test
 * identical line segments (e.g. Hex jumps).
 */
function checkCellStrict(originPt, destPt, wallCheckCache) {
    // FIX: Include elevation in the signature to prevent 2D floor-bleed across levels
    const cacheKey = `${Math.round(originPt.x)},${Math.round(originPt.y)},${Math.round(originPt.elevation)}->${Math.round(destPt.x)},${Math.round(destPt.y)},${Math.round(destPt.elevation)}`;

    let isClear = wallCheckCache.get(cacheKey);
    if (isClear === undefined) {
        isClear = !CONFIG.Canvas.polygonBackends.move.testCollision(originPt, destPt, { type: "move", mode: "any" });
        wallCheckCache.set(cacheKey, isClear);
    }
    return isClear;
}

/**
 * Translates a grid coordinate string (i.j) into a pixel coordinate string (x.y).
 * Required by the PIXI.js renderer for drawing operations.
 */
function _formatParentKey(parentKeyData, grid) {
    if (!parentKeyData) return null;
    const [pI, pJ] = parentKeyData.split(".").map(Number);
    const pTopLeft = grid.getTopLeftPoint({ i: pI, j: pJ });
    return `${Math.round(pTopLeft.x)}.${Math.round(pTopLeft.y)}`;
}

/**
 * Iterates through sorted movement paces (Sprint -> Run -> Walk) to assign
 * the highest possible pace category to a calculated cell cost.
 */
function _determineBestPace(cost, sortedPaces, roundingRule, costPerGridUnit) {
    return sortedPaces.find((pace) => isCostWithinPace(cost, pace.distance, roundingRule, costPerGridUnit)) || null;
}

/**
 * Formats the raw mathematical output map into a structured payload for the Renderer.
 * Merges cost data, coordinate geometry, bounding colours, and portal history into single objects.
 */
function processResults(minCosts, safetyMap, scaledPaces, grid, costPerGridUnit, parents, seeds = null) {
    const roundingRule = getRoundingMode();
    const resultSquares = new Map();

    // Sort array descending to assign correct pace bounds (largest limits tested first)
    const sortedPaces = [...scaledPaces].sort((a, b) => a.distance - b.distance);

    const limitPace = scaledPaces.find((p) => p.isActionLimit) || scaledPaces.find((p) => p.name === "Sprint") || (sortedPaces.length > 1 ? sortedPaces[1] : sortedPaces[0]);
    const limitDistance = limitPace ? limitPace.distance : 0;
    const limitColor = limitPace ? limitPace.color : "#FFFFFF";

    const seedLookup = new Map();
    if (seeds) {
        for (const s of seeds) seedLookup.set(`${s.i}.${s.j}`, s);
    }

    for (const [key, cost] of minCosts) {
        const bestPace = _determineBestPace(cost, sortedPaces, roundingRule, costPerGridUnit);
        if (!bestPace) continue;

        const [i, j] = key.split(".").map(Number);
        const topLeft = grid.getTopLeftPoint({ i, j });
        const parentKeyData = parents ? parents.get(key) : null;
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
            isInnerZone: isCostWithinPace(cost, limitDistance, roundingRule, costPerGridUnit),
            limitColor,
            isSafe: safetyMap.get(key) === true,
            isAnchor: cost === 0,
            isPortal: !!seedData,
            pathToPortal: seedData ? seedData.pathToPortal : null,
            parentGridKey: parentKeyData,
            parentKey: _formatParentKey(parentKeyData, grid),
        });
    }

    return resultSquares;
}

/**
 * Validates if the movement cost exceeds the pace limit based on user rounding settings.
 * "Full" = Must have enough remaining distance to reach the center of the cell.
 * "Half" = Can enter if at least 50% of the movement is available.
 * "Any"  = Can enter if any fraction of movement remains.
 */
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

/**
 * Custom MinHeap data structure.
 * Standard `Array.sort()` is exceptionally slow when called thousands of times
 * per mouse movement. A MinHeap maintains a binary tree that guarantees the lowest
 * cost node is always at index 0, radically improving execution speed for Dijkstra and Theta*.
 */
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
            let parent = (index - 1) >>> 1; // Bitwise shift for high-speed integer division
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

// ----------------------------------------------------------------------
// QUEUE INITIALIZATION
// ----------------------------------------------------------------------

/**
 * Populates the pathfinding queue using cached cross-floor portal seeds.
 * Replaces the token's physical footprint when calculating across upper/lower floors.
 */
function _seedQueueFromPortals({ parents, queue, minCosts, safetyMap, grid, isTheta, seeds }) {
    for (const seed of seeds) {
        const key = `${seed.i}.${seed.j}`;
        const oldCost = minCosts.get(key);

        // Only use the seed if it provides the most efficient path to this point
        if (oldCost === undefined || seed.cost < oldCost) {
            minCosts.set(key, seed.cost);
            safetyMap.set(key, true);
            parents.set(key, seed.parentGridKey);

            if (isTheta) {
                const center = grid.getCenterPoint({ i: seed.i, j: seed.j });
                seed.losOrigin = seed.losOrigin || { x: center.x, y: center.y, cost: seed.cost, isInitial: false };
            }
            queue.push(seed);
        }
    }
}

/**
 * Populates the pathfinding queue by scanning the token's physical native footprint.
 * Ensures that all cells the token currently occupies are treated as valid starting points.
 */
function _seedQueueFromTokenFootprint({ queue, minCosts, safetyMap, grid, centerPt, startX, startY, tw, th, isTheta, wallCheckCache, targetZ }) {
    const margin = grid.size * 0.02; // Small tolerance to prevent precision errors on bounding boxes
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

                // Only add footprint cells if they don't cross a wall (e.g. token placed halfway through a door)
                if (checkCellStrict(origin3D, dest3D, wallCheckCache)) {
                    const key = `${i}.${j}`;
                    if (!minCosts.has(key)) {
                        minCosts.set(key, 0);
                        safetyMap.set(key, true);
                        queue.push(isTheta ? { i, j, cost: 0, losOrigin: startOrigin } : { i, j, cost: 0 });
                    }
                }
            }
        }
    }
}

/**
 * Routes initialization data.
 * Decides whether to build the queue from native footprint bounds or cached cross-floor portals.
 */
function _initializeQueue(params) {
    if (params.seeds && params.seeds.length > 0) {
        _seedQueueFromPortals(params);
        return;
    }

    _seedQueueFromTokenFootprint(params);

    // Failsafe: If the token is entirely blocked/isolated, force its immediate centre as a valid origin
    if (params.queue.length === 0) {
        const centerOffset = params.grid.getOffset(params.centerPt);
        const key = `${centerOffset.i}.${centerOffset.j}`;
        params.minCosts.set(key, 0);
        params.safetyMap.set(key, true);

        const payload = { i: centerOffset.i, j: centerOffset.j, cost: 0 };
        if (params.isTheta) {
            payload.losOrigin = { x: params.centerPt.x, y: params.centerPt.y, cost: 0, isInitial: true };
        }
        params.queue.push(payload);
    }
}

/**
 * Safely iterates Foundry's level Map to find the active Level ID for a given absolute elevation.
 * Returns null if the scene lacks configured region levels.
 */
function _getActiveLevelId(z) {
    if (!canvas.scene.levels) return null;
    for (const l of canvas.scene.levels.values()) {
        if (z >= l.elevation.bottom && z < l.elevation.top) return l._id || l.id;
    }
    return null;
}
