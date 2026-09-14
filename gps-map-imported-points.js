// Imported GPS Points Functions for gps-map.js
// These functions are injected into gps-map.js to handle imported GPS points

/**
 * Load imported GPS points from IndexedDB and render them on the map
 * @param {L.LayerGroup} markerLayer - Leaflet layer group for markers
 * @param {Array} bounds - Array to accumulate point bounds for map fitting
 */
async function loadAndRenderImportedGpsPoints(markerLayer, bounds) {
    if (!window.parent || !window.parent.gpsRegistry) {
        return;
    }

    const gpsRegistry = window.parent.gpsRegistry;
    
    if (!gpsRegistry.isLoaded) {
        return;
    }

    const importedPoints = Array.from(gpsRegistry.points.values());

    if (!importedPoints || importedPoints.length === 0) {
        return;
    }

    importedPoints.forEach(function (point, index) {
        const lat = Number(point.lat);
        const lon = Number(point.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }

        // Determine marker style based on status
        const isMarked = point.status === "marked" && point.stpIndex !== -1;
        const markerStyle = {
            radius: 6,
            color: isMarked ? "#4CAF50" : "#FF9800",  // green if marked, orange if unmarked
            weight: isMarked ? 3 : 2,
            dashArray: isMarked ? "" : "4",  // dashed for unmarked points
            fillColor: isMarked ? "#4CAF50" : "#FF9800",
            fillOpacity: isMarked ? 0.85 : 0.6
        };

        const marker = window.L.circleMarker([lat, lon], markerStyle);

        // Create popup content
        const stpLabel = isMarked ? (window.parent.state && window.parent.state.stps[point.stpIndex]?.stpLabel) ? window.parent.state.stps[point.stpIndex].stpLabel : "STP #" + (point.stpIndex + 1) : "(unmarked)";
        const popupHtml = "<strong>" + escapeHtml(point.label || ("Point " + (index + 1))) + "</strong><br>"
            + "<span>Status: " + (isMarked ? "Marked - " + stpLabel : "Not yet marked") + "</span><br>"
            + "<span>" + lat.toFixed(6) + ", " + lon.toFixed(6) + "</span><br>"
            + "<span>Source: " + escapeHtml(point.source || "imported") + "</span>";

        marker.bindPopup(popupHtml);
        marker.addTo(markerLayer);

        bounds.push([lat, lon]);
    });
}

/**
 * Handle when an STP is updated with GPS coordinates
 * This function is called via event listener
 */
function handleStpGpsUpdate(pointId, stpIndex) {
    if (!window.parent || !window.parent.gpsRegistry) {
        return;
    }

    const point = window.parent.gpsRegistry.points.get(pointId);
    if (point) {
        point.status = "marked";
        point.stpIndex = stpIndex;
    }

    // Re-render map to show updated marker status
    if (window.renderMapLayers) {
        window.renderMapLayers();
    }
}

/**
 * Listen for GPS point updates from parent window (main app)
 */
function setupGpsEventListeners() {
    if (!window.parent) {
        return;
    }

    try {
        // Listen for point marked event
        if (window.parent.gpsEventBus) {
            window.parent.gpsEventBus.addEventListener("gps:point-marked", function (event) {
                handleStpGpsUpdate(event.detail.pointId, event.detail.stpIndex);
            });

            window.parent.gpsEventBus.addEventListener("stp:gps-changed", function (event) {
                // Re-render map when STP GPS changes
                if (window.renderMapLayers) {
                    window.renderMapLayers();
                }
            });
        }
    } catch (error) {
        console.warn("Could not setup GPS event listeners:", error);
    }
}

// Initialize event listeners when DOM is ready
document.addEventListener("DOMContentLoaded", setupGpsEventListeners);
