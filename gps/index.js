// gps/index.js
// Main entry for GPS and mapping logic
// Exposes: getCurrentPosition, watchPosition, getStatus, onPosition, onError

import { getCurrentPosition, watchPosition, stopWatch } from './geolocation.js';
import { renderMap, addGrid, clearGrid } from './map.js';

export {
    getCurrentPosition,
    watchPosition,
    stopWatch,
    renderMap,
    addGrid,
    clearGrid
};
