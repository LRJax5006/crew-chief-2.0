// gps/offline.js
// Caches GPS data for unreliable connections

let cachedPositions = [];

export function cachePosition(pos) {
    cachedPositions.push(pos);
}

export function getCachedPositions() {
    return cachedPositions.slice();
}

export function clearCachedPositions() {
    cachedPositions = [];
}
