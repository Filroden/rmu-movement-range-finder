import { getVisualSettings } from "./rmu-mrf-settings.js";

export function getMovementPaces(token) {
    if (!token?.actor?.system?._movementBlock) return null;

    const moveBlock = token.actor.system._movementBlock;
    const settings = getVisualSettings(); 

    const activeModeLabel = moveBlock._selected; 
    const activeOption = moveBlock._options?.find(opt => opt.value === activeModeLabel);
    
    if (!activeOption || !activeOption.paceRates) {
        return null;
    }

    const paces = activeOption.paceRates.map(rate => {
        const paceValue = rate.pace.value; 
        const color = settings.colors[paceValue] || "#FFFFFF"; 

        return {
            name: paceValue,
            label: rate.pace.label, 
            distance: rate.perPhase, 
            penalty: rate.pace.modifier, 
            color: color,
            allowed: rate.allowedPace // For debug
        };
    });

    // Debug output: Check console to see if Sprint/Dash distances are correct
    console.log("RMU Movement Paces:", paces);

    // Sort by Distance Descending (Largest First) for the Renderer
    // The renderer draws Largest Circle (Dash) first, then overlays Smallest (Walk).
    paces.sort((a, b) => b.distance - a.distance);

    return paces;
}