// Draw parcel outline if available
function drawParcelOutline(mapInstance) {
    try {
        let geojson = null;
        if (window._lastParcelGeojson) {
            geojson = window._lastParcelGeojson;
        } else {
            // Try to load from storage if not in memory
            let raw = null;
            try {
                raw = sessionStorage.getItem('archaeolab-gps-map-payload-v1') || localStorage.getItem('archaeolab-gps-map-payload-v1');
            } catch {}
            if (raw) {
                try { geojson = JSON.parse(raw); } catch {}
            }
        }
        if (!geojson) return;
        // Extract geometry
        let geom = geojson;
        if (geojson.type === 'FeatureCollection') {
            const polyFeature = geojson.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
            if (polyFeature) geom = polyFeature.geometry;
        } else if (geojson.type === 'Feature' && geojson.geometry && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
            geom = geojson.geometry;
        }
        // Add to map if valid geometry
        if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
            window.L.geoJSON(geom, {
                style: { color: '#e67e22', weight: 3, fill: false, dashArray: '6 4' }
            }).addTo(mapInstance);
        }
    } catch (e) {
        // fail silently
    }
}
const gpsMapPayloadStorageKey = "archaeolab-gps-map-payload-v1";
const gpsMapLayerPrefStorageKey = "archaeolab-gps-map-layer-pref-v1";

let mapInstance = null;
let markerLayer = null;
let routeLayer = null;
let activePoints = [];
let activeImportedPoints = [];
let activeMarkers = [];
let satelliteLayer = null;
let topoLayer = null;

document.addEventListener("DOMContentLoaded", initializeGpsMapPage);

// Add clear grid button handler after DOM is ready
document.addEventListener("DOMContentLoaded", function() {
    setTimeout(function() {
        const clearBtn = document.getElementById('clearGridButton');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                // Remove all grid markers and reset click points
                if (window._stpClickPoints && Array.isArray(window._stpClickPoints)) {
                    window._stpClickPoints.forEach(pt => pt.marker && mapInstance && mapInstance.removeLayer(pt.marker));
                    window._stpClickPoints = [];
                }
                // Remove all grid circleMarkers (orange grid)
                if (mapInstance) {
                    mapInstance.eachLayer(function(layer) {
                        if (layer instanceof window.L.CircleMarker && layer.options && layer.options.color === '#e67e22') {
                            mapInstance.removeLayer(layer);
                        }
                    });
                }
            });
        }

        // Add clear all STPs button handler
        const clearStpBtn = document.getElementById('clearAllStpButton');
        if (clearStpBtn) {
            clearStpBtn.addEventListener('click', async function() {
                try {
                    sessionStorage.removeItem('archaeolab-gps-map-payload-v1');
                    localStorage.removeItem('archaeolab-gps-map-payload-v1');
                    await clearStoredGpsPoints();
                    window.location.reload();
                } catch (error) {
                    console.error('Could not clear stored GPS points.', error);
                    alert('Could not clear GPS points. Try again.');
                }
            });
        }
    }, 500);
});

function clearStoredGpsPoints() {
    return new Promise(function (resolve, reject) {
        if (!('indexedDB' in window)) {
            resolve();
            return;
        }

        const request = window.indexedDB.open('archaeolab-gps-points-v1', 1);

        request.onupgradeneeded = function () {
            const database = request.result;
            if (!database.objectStoreNames.contains('points')) {
                database.createObjectStore('points', { keyPath: 'id' });
            }
        };

        request.onsuccess = function () {
            const database = request.result;
            const transaction = database.transaction('points', 'readwrite');
            transaction.objectStore('points').clear();
            transaction.oncomplete = function () {
                database.close();
                resolve();
            };
            transaction.onerror = function () {
                database.close();
                reject(transaction.error || new Error('Could not clear GPS points.'));
            };
        };

        request.onerror = function () {
            reject(request.error || new Error('Could not open GPS points storage.'));
        };
    });
}

function initializeGpsMapPage() {
    const closeButton = document.getElementById("closeMapButton");
    const connectToggle = document.getElementById("connectPointsToggle");
    const satelliteOption = document.getElementById("mapLayerSatellite");
    const topoOption = document.getElementById("mapLayerTopo");

    if (closeButton) {
        closeButton.addEventListener("click", function () {
            window.close();
            // If this tab was not opened by script, close() is ignored.
            if (!window.closed) {
                window.location.href = "./index.html";
            }
        });
    }

    if (connectToggle) {
        connectToggle.addEventListener("change", function () {
            renderMapLayers();
        });
    }

    if (satelliteOption && topoOption) {
        satelliteOption.addEventListener("change", function () {
            if (satelliteOption.checked) {
                switchMapLayer("satellite");
            }
        });
        topoOption.addEventListener("change", function () {
            if (topoOption.checked) {
                switchMapLayer("topo");
            }
        });

        // Load saved preference
        try {
            const savedLayer = localStorage.getItem(gpsMapLayerPrefStorageKey) || "topo";
            if (savedLayer === "satellite") {
                satelliteOption.checked = true;
            } else {
                topoOption.checked = true;
            }
        } catch (_error) {
            topoOption.checked = true;
        }
    }

    const payload = loadGpsMapPayload();

    if (!payload) {
        setStatus("No GPS map payload was found. Open this page from the app after saving STPs.", true);
        renderTypeLegend();
        renderPointList([]);
        return;
    }

    const titleText = toText(payload.title) || "GPS Points Map";
    document.title = titleText;

    const titleElement = document.getElementById("gpsMapTitle");
    if (titleElement) {
        titleElement.textContent = titleText;
    }

    const rawPoints = Array.isArray(payload.points) ? payload.points : [];
    const rawImportedPoints = Array.isArray(payload.importedPoints) ? payload.importedPoints : [];

    activePoints = rawPoints.map(function (point, index) {
        const latitude = Number(point && point.latitude);
        const longitude = Number(point && point.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        const typeKey = normalizeTypeKey(point && (point.entryTypeKey || point.entryTypeLabel || point.entryType));
        const typeLabel = toText(point && point.entryTypeLabel) || getTypeStyle(typeKey).label;

        return {
            label: toText(point && point.label) || ("Point " + (index + 1)),
            entryTypeKey: typeKey,
            entryTypeLabel: typeLabel,
            latitude: latitude,
            longitude: longitude,
            savedAt: toText(point && point.savedAt),
            siteName: toText(point && point.siteName),
            siteLocation: toText(point && point.siteLocation),
            strata: Array.isArray(point && point.strata) ? point.strata : []
        };
    }).filter(Boolean);

    activeImportedPoints = rawImportedPoints.map(function (point, index) {
        const latitude = Number(point && point.latitude);
        const longitude = Number(point && point.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        const typeKey = normalizeTypeKey(point && (point.entryTypeKey || point.entryTypeLabel || point.entryType || point.type));
        const typeLabel = toText(point && point.entryTypeLabel) || getTypeStyle(typeKey).label;
        const status = toText(point && point.status).toLowerCase() || "unmarked";
        const stpIndexValue = Number(point && point.stpIndex);

        return {
            id: toText(point && point.id) || ("imported-" + (index + 1)),
            label: toText(point && point.label) || ("Imported Point " + (index + 1)),
            entryTypeKey: typeKey,
            entryTypeLabel: typeLabel,
            latitude: latitude,
            longitude: longitude,
            source: toText(point && point.source),
            importedAt: toText(point && (point.importedAt || point.savedAt)),
            status: status,
            stpIndex: Number.isFinite(stpIndexValue) ? stpIndexValue : -1,
            linkedStpLabel: toText(point && point.linkedStpLabel),
            strata: []
        };
    }).filter(Boolean);

    const listPoints = activePoints.concat(activeImportedPoints);

    renderTypeLegend();
    renderPointList(listPoints);

    if (listPoints.length === 0) {
        setStatus("No valid GPS points found in the payload.", true);
        return;
    }

    renderMapLayers();
}

// Patch: Draw parcel outline after map and layers are ready

function loadGpsMapPayload() {
    // Try URL hash first — used when navigating same-tab on PWA/iOS
    try {
        const hash = window.location.hash || "";
        const hashMatch = /[#&]payload=([^&]+)/.exec(hash);
        if (hashMatch) {
            const decoded = decodeURIComponent(hashMatch[1]);
            return JSON.parse(decoded);
        }
    } catch (_error) {
        // fall through to storage fallbacks
    }

    let rawValue = "";

    try {
        rawValue = sessionStorage.getItem(gpsMapPayloadStorageKey) || "";
    } catch (_error) {
        rawValue = "";
    }

    if (!rawValue) {
        try {
            rawValue = localStorage.getItem(gpsMapPayloadStorageKey) || "";
        } catch (_error) {
            rawValue = "";
        }
    }

    if (!rawValue) {
        return null;
    }

    try {
        return JSON.parse(rawValue);
    } catch (_error) {
        return null;
    }
}

function toText(value) {
    return String(value == null ? "" : value);
}

function escapeHtml(value) {
    return toText(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatSavedAt(value) {
    if (!value) {
        return "";
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function normalizeTypeKey(value) {
    const key = toText(value).toLowerCase().trim();

    if (key === "supplemental" || key === "unit-id" || key === "base") {
        return key;
    }

    if (key.includes("supplemental")) {
        return "supplemental";
    }

    if (key.includes("unit")) {
        return "unit-id";
    }

    return "base";
}

function getTypeStyle(typeKey) {
    if (typeKey === "supplemental") {
        return {
            fill: "#f4b63e",
            stroke: "#8f6000",
            label: "Supplemental STP"
        };
    }

    if (typeKey === "unit-id") {
        return {
            fill: "#2d8f84",
            stroke: "#14554f",
            label: "Unit ID"
        };
    }

    return {
        fill: "#b21e1e",
        stroke: "#5f0f0f",
        label: "Base STP"
    };
}

function setStatus(text, isError) {
    const statusElement = document.getElementById("gpsMapStatus");

    if (!statusElement) {
        return;
    }

    statusElement.textContent = text || "";
    statusElement.className = isError ? "status error" : "status";
}

function renderTypeLegend() {
    const legend = document.getElementById("gpsTypeLegend");

    if (!legend) {
        return;
    }

    legend.innerHTML = "";

    ["base", "supplemental", "unit-id"].forEach(function (typeKey) {
        const style = getTypeStyle(typeKey);
        const item = document.createElement("span");
        const dot = document.createElement("span");
        const text = document.createElement("span");

        item.className = "legend-item";
        dot.className = "legend-dot";
        dot.style.backgroundColor = style.fill;
        dot.style.borderColor = style.stroke;
        text.textContent = style.label;

        item.appendChild(dot);
        item.appendChild(text);
        legend.appendChild(item);
    });
}

function renderPointList(points) {
    const list = document.getElementById("gpsPointList");

    if (!list) {
        return;
    }

    list.innerHTML = "";

    points.forEach(function (point, index) {
        const item = document.createElement("li");
        const label = point.label || ("Point " + (index + 1));
        const typeLabel = point.entryTypeLabel || getTypeStyle(point.entryTypeKey).label;

        item.textContent = label + " | " + typeLabel + " | "
            + point.latitude.toFixed(6) + ", " + point.longitude.toFixed(6);
        item.title = "Tap to fly to this point on the map";
        item.className = "point-list-item";

        item.addEventListener("click", function () {
            if (mapInstance && activeMarkers[index]) {
                mapInstance.setView([point.latitude, point.longitude], 17);
                activeMarkers[index].openPopup();
            }
            showStpDetail(point);
        });

        list.appendChild(item);
    });
}

function ensureMap() {
    if (typeof window.L === "undefined") {
        setStatus("Map tiles could not load. Check internet connection. Coordinates are listed below.", true);
        return false;
    }

    if (!mapInstance) {
        mapInstance = window.L.map("gpsMapCanvas", { zoomControl: true });

        satelliteLayer = window.L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 19,
                attribution: "&copy; <a href='https://www.arcgis.com/'>Esri</a> contributors"
            }
        );

        topoLayer = window.L.tileLayer(
            "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 16,
                attribution: "&copy; <a href='https://www.usgs.gov/'>USGS</a>"
            }
        );

        // Determine which layer to show based on saved preference
        let layerToShow = topoLayer;
        try {
            const savedLayer = localStorage.getItem(gpsMapLayerPrefStorageKey);
            if (savedLayer === "satellite") {
                layerToShow = satelliteLayer;
            }
        } catch (_error) {
            // use topo as default
        }

        layerToShow.addTo(mapInstance);

        markerLayer = window.L.layerGroup().addTo(mapInstance);
        routeLayer = window.L.layerGroup().addTo(mapInstance);
    } else {
        if (!markerLayer) {
            markerLayer = window.L.layerGroup().addTo(mapInstance);
        }
        if (!routeLayer) {
            routeLayer = window.L.layerGroup().addTo(mapInstance);
        }
    }

    // Add click-to-place STP workflow
    if (!mapInstance._stpClickHandlerAdded) {
        mapInstance._stpClickHandlerAdded = true;
        window._stpClickPoints = [];
        mapInstance.on('click', function(e) {
            if (!window._stpClickPoints) window._stpClickPoints = [];
            if (window._stpClickPoints.length >= 3) return; // Only allow three points
            const latlng = e.latlng;
            // Add marker for visual feedback
            let iconUrl = 'https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png';
            let popupText = 'STP Start Point';
            if (window._stpClickPoints.length === 1) {
                iconUrl = 'https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png';
                popupText = 'STP Baseline Point';
            } else if (window._stpClickPoints.length === 2) {
                iconUrl = 'https://maps.gstatic.com/mapfiles/ms2/micons/orange-dot.png';
                popupText = 'STP Fill Direction Point';
            }
            const marker = window.L.marker([latlng.lat, latlng.lng], {
                draggable: false,
                icon: window.L.icon({
                    iconUrl,
                    iconSize: [32, 32],
                    iconAnchor: [16, 32],
                })
            }).addTo(mapInstance);
            marker.bindPopup(popupText).openPopup();
            window._stpClickPoints.push({ lat: latlng.lat, lng: latlng.lng, marker });
            if (window._stpClickPoints.length === 3) {
                setTimeout(function() {
                    window.alert('Three STP points placed. Generating grid...');
                    generateStpGridFromThreePoints(window._stpClickPoints);
                }, 300);
            }
        // Generate grid using three user-placed points: baseline (first two), fill direction (third)
        function generateStpGridFromThreePoints(points) {
            if (!Array.isArray(points) || points.length !== 3) return;
            // Get setback and spacing from UI if available
            let setback = 10, spacing = 50;
            try {
                setback = parseFloat(document.getElementById('setbackInput')?.value) || 10;
                spacing = parseFloat(document.getElementById('spacingInput')?.value) || 50;
            } catch {}
            // Convert to meters
            const setbackMeters = setback * 0.3048;
            const spacingMeters = spacing * 0.3048;
            // Baseline: first two points
            const base1 = [points[0].lng, points[0].lat];
            const base2 = [points[1].lng, points[1].lat];
            // Fill direction: third point
            const fillPt = [points[2].lng, points[2].lat];
            // Compute baseline and perpendicular direction
            const baseLine = turf.lineString([base1, base2]);
            const baseLength = turf.length(baseLine, { units: 'meters' });
            const nBasePoints = Math.floor(baseLength / spacingMeters) + 1;
            const baseBearing = turf.bearing(turf.point(base1), turf.point(base2));
            // Determine which side of the baseline the fill point is on
            const perpBearing = (() => {
                // Vector cross product to determine left/right
                const dx = base2[0] - base1[0];
                const dy = base2[1] - base1[1];
                const fx = fillPt[0] - base1[0];
                const fy = fillPt[1] - base1[1];
                const cross = dx * fy - dy * fx;
                // If cross > 0, fill is to the left; else right
                return baseBearing + (cross > 0 ? -90 : 90);
            })();
            // Use buffered parcel if available for containment
            let buffered = null;
            try {
                let geojson = window._lastParcelGeojson;
                if (!geojson) {
                    let raw = sessionStorage.getItem('archaeolab-gps-map-payload-v1') || localStorage.getItem('archaeolab-gps-map-payload-v1');
                    if (raw) geojson = JSON.parse(raw);
                }
                let geom = geojson;
                if (geojson && geojson.type === 'FeatureCollection') {
                    const polyFeature = geojson.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
                    if (polyFeature) geom = polyFeature.geometry;
                } else if (geojson && geojson.type === 'Feature' && geojson.geometry && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
                    geom = geojson.geometry;
                }
                if (geom) {
                    buffered = turf.buffer(geom, -setbackMeters, { units: 'meters' });
                }
            } catch {}
            // Generate grid
            let added = 0;
            let colLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let gridPoints = [];
            let maxOffset = 500;
            try {
                if (buffered) {
                    const bbox = turf.bbox(buffered);
                    const diag = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[3]], { units: 'meters' });
                    maxOffset = diag;
                }
            } catch {}
            let col = 0;
            for (let offset = 0; offset < maxOffset; offset += spacingMeters, col++) {
                for (let i = 0; i < nBasePoints; i++) {
                    const dist = i * spacingMeters;
                    let pt = turf.along(baseLine, dist, { units: 'meters' });
                    pt = turf.destination(pt.geometry.coordinates, offset, perpBearing, { units: 'meters' });
                    const [lon, lat] = pt.geometry.coordinates;
                    // Check if inside buffered parcel if available
                    if (buffered && !turf.booleanPointInPolygon([lon, lat], buffered)) continue;
                    // Label: A1, A2, B1, B2, ...
                    const label = `${colLabels[col % colLabels.length]}${i + 1}`;
                    // Add marker to map
                    window.L.circleMarker([lat, lon], {
                        radius: 7,
                        color: '#e67e22',
                        weight: 2,
                        fillColor: '#fff3e0',
                        fillOpacity: 0.93
                    }).addTo(mapInstance).bindPopup(label);
                    added++;
                    gridPoints.push({ lat, lon, label });
                }
                // Stop if no points were added in this column (fully outside parcel)
                if (gridPoints.length === 0 || (gridPoints.length > 0 && gridPoints.slice(-nBasePoints).filter(pt => pt.label.startsWith(colLabels[col % colLabels.length])).length === 0)) {
                    break;
                }
            }
            window.alert(`Generated ${added} STP grid points.`);
        }
        });
    }
    return true;
}

function switchMapLayer(layerName) {
    if (!mapInstance || !satelliteLayer || !topoLayer) {
        return;
    }

    // Remove both layers to ensure clean state
    if (mapInstance.hasLayer(topoLayer)) {
        mapInstance.removeLayer(topoLayer);
    }
    if (mapInstance.hasLayer(satelliteLayer)) {
        mapInstance.removeLayer(satelliteLayer);
    }

    // Add the selected layer
    if (layerName === "satellite") {
        satelliteLayer.addTo(mapInstance);
    } else {
        topoLayer.addTo(mapInstance);
    }

    // Save preference
    try {
        localStorage.setItem(gpsMapLayerPrefStorageKey, layerName);
    } catch (_error) {
        // ignore
    }
}

function renderMapLayers() {
    if (!ensureMap()) {
        return;
    }

    // Apply the current radio selection to ensure it's in sync
    const satelliteOption = document.getElementById("mapLayerSatellite");
    if (satelliteOption && satelliteOption.checked) {
        switchMapLayer("satellite");
    } else {
        switchMapLayer("topo");
    }

    markerLayer.clearLayers();
    routeLayer.clearLayers();
    activeMarkers = [];

    const bounds = [];
    const lineCoordinates = [];

    activePoints.forEach(function (point, index) {
        const typeStyle = getTypeStyle(point.entryTypeKey);
        const typeLabel = point.entryTypeLabel || typeStyle.label;

        const marker = window.L.circleMarker([point.latitude, point.longitude], {
            radius: 8,
            color: typeStyle.stroke,
            weight: 2,
            fillColor: typeStyle.fill,
            fillOpacity: 0.93
        }).addTo(markerLayer);

        const strataCount = Array.isArray(point.strata) ? point.strata.length : 0;
        const popupHtml = "<strong>" + escapeHtml(point.label || ("Point " + (index + 1))) + "</strong><br>"
            + "<span>" + escapeHtml(typeLabel) + "</span><br>"
            + "<span>" + point.latitude.toFixed(6) + ", " + point.longitude.toFixed(6) + "</span>"
            + (point.savedAt ? "<br><span>Saved " + escapeHtml(formatSavedAt(point.savedAt)) + "</span>" : "")
            + (strataCount > 0 ? "<br><em>" + strataCount + (strataCount === 1 ? " stratum" : " strata") + " &mdash; see details below</em>" : "");

        marker.bindPopup(popupHtml);
        marker.on("click", function () {
            showStpDetail(point);
        });
        activeMarkers.push(marker);
        bounds.push([point.latitude, point.longitude]);
        lineCoordinates.push([point.latitude, point.longitude]);
    });

    const importedPointCount = loadAndRenderImportedGpsPoints(markerLayer, bounds);

    const connectToggle = document.getElementById("connectPointsToggle");
    const connectEnabled = Boolean(connectToggle && connectToggle.checked);

    if (connectEnabled && lineCoordinates.length > 1) {
        window.L.polyline(lineCoordinates, {
            color: "#243f3a",
            weight: 3,
            opacity: 0.75,
            dashArray: "8 6"
        }).addTo(routeLayer);
    }

    if (bounds.length === 1) {
        mapInstance.setView(bounds[0], 17);
    } else if (bounds.length > 1) {
        mapInstance.fitBounds(bounds, { padding: [28, 28] });
    }

    setTimeout(function () {
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
    }, 120);

    // Draw parcel outline overlay after map and layers are ready
    drawParcelOutline(mapInstance);

    const totalPointCount = activePoints.length + importedPointCount;
    const pointSummary = totalPointCount + (totalPointCount === 1 ? " GPS point plotted." : " GPS points plotted.");
    const pathSummary = connectEnabled ? " Connected path on." : " Connected path off.";
    setStatus(pointSummary + pathSummary, false);
}

function showStpDetail(point) {
    const section = document.getElementById("stpDetailSection");
    const panel = document.getElementById("stpDetailPanel");

    if (!section || !panel) {
        return;
    }

    panel.innerHTML = "";

    const heading = document.createElement("p");
    heading.className = "stp-detail-head";
    heading.textContent = "STP " + (point.label || "")
        + (point.siteName ? " \u00b7 " + point.siteName : "")
        + (point.entryTypeLabel ? " (" + point.entryTypeLabel + ")" : "");
    panel.appendChild(heading);

    const strata = Array.isArray(point.strata) ? point.strata : [];

    if (strata.length === 0) {
        const empty = document.createElement("p");
        empty.className = "stp-detail-empty";
        empty.textContent = "No strata data saved for this STP.";
        panel.appendChild(empty);
    } else {
        strata.forEach(function (s) {
            const row = document.createElement("div");
            row.className = "stp-stratum-row";

            function addField(labelText, value) {
                if (!value) {
                    return;
                }

                const cell = document.createElement("div");
                cell.className = "stp-stratum-field";

                const lbl = document.createElement("span");
                lbl.className = "stp-stratum-label";
                lbl.textContent = labelText;

                const val = document.createElement("span");
                val.className = "stp-stratum-value";
                val.textContent = value;

                cell.appendChild(lbl);
                cell.appendChild(val);
                row.appendChild(cell);
            }

            addField("Stratum", s.stratumLabel);
            addField("Depth", s.depth);
            addField("Munsell", s.munsell);
            addField("Soil Type", s.soilType);
            addField("Horizon", s.horizon);
            addField("Artifacts", s.artifactSummary);

            if (s.notes) {
                const notesEl = document.createElement("p");
                notesEl.className = "stp-stratum-notes";
                notesEl.textContent = s.notes;
                row.appendChild(notesEl);
            }

            panel.appendChild(row);
        });
    }

    section.hidden = false;
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ============================================
// IMPORTED GPS POINTS FUNCTIONS
// ============================================

/**
 * Load imported GPS points from IndexedDB and render them on the map
 * @param {L.LayerGroup} markerLayer - Leaflet layer group for markers
 * @param {Array} bounds - Array to accumulate point bounds for map fitting
 */
function loadAndRenderImportedGpsPoints(markerLayer, bounds) {
    const importedPoints = Array.isArray(activeImportedPoints) ? activeImportedPoints : [];

    if (importedPoints.length === 0) {
        return 0;
    }

    importedPoints.forEach(function (point, index) {
        const lat = Number(point.latitude);
        const lon = Number(point.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }

        // Determine marker style based on status
        const isMarked = point.status === "marked" || point.stpIndex >= 0;
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
        const stpLabel = point.linkedStpLabel || (point.stpIndex >= 0 ? ("STP #" + (point.stpIndex + 1)) : "(unmarked)");

        const popupHtml = "<strong>" + escapeHtml(point.label || ("Point " + (index + 1))) + "</strong><br>"
            + "<span>Status: " + (isMarked ? "Marked - " + stpLabel : "Not yet marked") + "</span><br>"
            + "<span>" + lat.toFixed(6) + ", " + lon.toFixed(6) + "</span><br>"
            + "<span>Source: " + escapeHtml(point.source || "imported") + "</span>";

        marker.bindPopup(popupHtml);
        marker.on("click", function () {
            showStpDetail(point);
        });
        marker.addTo(markerLayer);
        activeMarkers.push(marker);

        bounds.push([lat, lon]);
    });

    return importedPoints.length;
}

/**
 * Setup event listeners for real-time updates
 */
function setupGpsEventListeners() {
    if (!window.parent) {
        return;
    }

    try {
        // Listen for point marked event
        if (window.parent.gpsEventBus) {
            window.parent.gpsEventBus.addEventListener("gps:point-marked", function () {
                // Re-render map to show updated marker status
                if (window.renderMapLayers) {
                    window.renderMapLayers();
                }
            });

            window.parent.gpsEventBus.addEventListener("stp:gps-changed", function () {
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
