async function handleClearAllGpsPoints() {
    const pointIds = Array.from(gpsRegistry.points.keys());

    try {
        await deleteGpsPointsFromDatabase(pointIds);
        renderSavedStps();
        updateGpsMapButtonState();
        alert(`Cleared all ${pointIds.length} GPS points.`);
    } catch (error) {
        console.error("Could not clear GPS points.", error);
        alert("Could not clear GPS points. Try again.");
    }
}

async function handleClearGridPoints() {
    const pointIds = Array.from(gpsRegistry.points.values())
        .filter(function (point) {
            return point.type === "grid";
        })
        .map(function (point) {
            return point.id;
        });

    try {
        await deleteGpsPointsFromDatabase(pointIds);
        renderSavedStps();
        updateGpsMapButtonState();
        alert(`Cleared ${pointIds.length} grid points.`);
    } catch (error) {
        console.error("Could not clear grid points.", error);
        alert("Could not clear grid points. Try again.");
    }
}

// --- SHP Import and Grid Generation ---

// Helper to populate corner dropdowns with all unique boundary vertices
function populateCornerDropdowns(coords) {
    const startSel = document.getElementById('startCornerInput');
    const endSel = document.getElementById('endCornerInput');
    if (!startSel || !endSel) return;
    startSel.innerHTML = '';
    endSel.innerHTML = '';
    coords.forEach((pt, i) => {
        const label = `Corner ${i + 1} (${pt[0].toFixed(6)}, ${pt[1].toFixed(6)})`;
        const opt1 = document.createElement('option');
        opt1.value = i;
        opt1.textContent = label;
        const opt2 = opt1.cloneNode(true);
        startSel.appendChild(opt1);
        endSel.appendChild(opt2);
    });
}
function handleImportShpFiles(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
        alert("No SHP files selected.");
        return;
    }
    // Accept either a single .zip or multiple SHP files
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        window.shp(files[0]).then(function(geojson) {
            if (!geojson || !geojson.features || geojson.features.length === 0) {
                alert("No features found in SHP zip file.");
                return;
            }
            window._lastParcelGeojson = geojson;
            elements.shpGridControls.hidden = false;
            elements.shpGridControls.dataset.parcelLoaded = "1";
            elements.shpGridControls.dataset.parcelGeojson = JSON.stringify(geojson);
            // Extract coordinates and populate corner dropdowns
            let geom = geojson;
            if (geojson.type === 'FeatureCollection') {
                const polyFeature = geojson.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
                if (polyFeature) geom = polyFeature.geometry;
            } else if (geojson.type === 'Feature' && geojson.geometry && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
                geom = geojson.geometry;
            }
            let coords = [];
            if (geom.type === 'Polygon') coords = geom.coordinates;
            else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0];
            if (Array.isArray(coords[0][0])) coords = coords[0];
            populateCornerDropdowns(coords);
            alert("Parcel boundary loaded. Set grid parameters and click Generate STP Grid.");
        }).catch(function(e) {
            alert("Error parsing SHP zip: " + e);
        });
        return;
    }
    // If multiple files, allow user to select all SHP/DBF/SHX/PRJ/CPG at once
    if (files.length > 1) {
        const fileMap = {};
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            fileMap[ext] = file;
        }
        if (!fileMap.shp || !fileMap.dbf) {
            alert("Please select a .zip file or at least .shp and .dbf files (and .shx, .prj, .cpg if available).");
            return;
        }
        window.shp(fileMap).then(function(geojson) {
            if (!geojson || !geojson.features || geojson.features.length === 0) {
                alert("No features found in SHP file.");
                return;
            }
            window._lastParcelGeojson = geojson;
            elements.shpGridControls.hidden = false;
            elements.shpGridControls.dataset.parcelLoaded = "1";
            elements.shpGridControls.dataset.parcelGeojson = JSON.stringify(geojson);
            alert("Parcel boundary loaded. Set grid parameters and click Generate STP Grid.");
        }).catch(function(e) {
            alert("Error parsing SHP: " + e);
        });
        return;
    }
    alert("Please select a .zip file or all SHP/DBF/SHX/PRJ/CPG files at once.");
}

function handleGenerateStpGrid() {
    const setback = parseFloat(elements.setbackInput.value) || 10;
    const spacing = parseFloat(elements.spacingInput.value) || 50;
    if (!elements.shpGridControls.dataset.parcelGeojson) {
        alert("No parcel boundary loaded. Import a SHP or GeoJSON file first.");
        return;
    }
    let geojson = JSON.parse(elements.shpGridControls.dataset.parcelGeojson);
    // Extract Polygon/MultiPolygon geometry from FeatureCollection or Feature if needed
    let geom = geojson;
    if (geojson.type === 'FeatureCollection') {
        const polyFeature = geojson.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
        if (!polyFeature) {
            alert('No Polygon or MultiPolygon found in FeatureCollection.');
            return;
        }
        geom = polyFeature.geometry;
    } else if (geojson.type === 'Feature' && geojson.geometry && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
        geom = geojson.geometry;
    } else if (geojson.type !== 'Polygon' && geojson.type !== 'MultiPolygon') {
        alert('Input is not a Polygon or MultiPolygon.');
        return;
    }
    // Convert setback and spacing from feet to meters for Turf.js
    const setbackMeters = setback * 0.3048;
    const spacingMeters = spacing * 0.3048;
    // Buffer inward for setback
    let buffered = geom;
    try {
        buffered = turf.buffer(geom, -setbackMeters, { units: 'meters' });
    } catch (e) {
        alert("Error buffering parcel for setback: " + e + "\n\nGeoJSON type: " + geom.type);
        return;
    }
    // Get bbox for grid
    let bbox;
    try {
        bbox = turf.bbox(buffered);
    } catch (e) {
        alert("Error computing bbox for grid: " + e);
        return;
    }
    // Find the selected start and end corners
    // Get all boundary vertices
    let coords = [];
    if (buffered.type === 'Feature') coords = buffered.geometry.coordinates;
    else if (buffered.type === 'Polygon') coords = buffered.coordinates;
    else if (buffered.type === 'MultiPolygon') coords = buffered.coordinates[0];
    else if (buffered.type === 'FeatureCollection') coords = buffered.features[0].geometry.coordinates;
    if (Array.isArray(coords[0][0])) coords = coords[0];
    // Use selected indices for base line
    const startIdx = parseInt(document.getElementById('startCornerInput')?.value || '0', 10);
    const endIdx = parseInt(document.getElementById('endCornerInput')?.value || '1', 10);
    const base1 = coords[startIdx];
    const base2 = coords[endIdx];
    if (base2[0] === base1[0] && base2[1] === base1[1]) {
        alert('Start and end corners are the same. Select two different corners.');
        return;
    }
    // Create base line (A) from base1 to base2
    const baseLine = turf.lineString([base1, base2]);
    const baseLength = turf.length(baseLine, { units: 'meters' });
    const nBasePoints = Math.floor(baseLength / spacingMeters) + 1;
    // Direction of base line (bearing)
    const baseBearing = turf.bearing(turf.point(base1), turf.point(base2));
    // Perpendicular bearing for offset lines (90 degrees to right)
    const perpBearing = baseBearing + 90;
    // Generate grid points along base line and parallel offset lines
    let added = 0;
    let colLabels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let gridPoints = [];
    let maxOffset = 0;
    // Estimate max offset needed to cover bbox diagonal
    try {
        const bbox = turf.bbox(buffered);
        const diag = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[3]], { units: 'meters' });
        maxOffset = diag;
    } catch (e) {
        maxOffset = 500; // fallback
    }
    let col = 0;
    for (let offset = 0; offset < maxOffset; offset += spacingMeters, col++) {
        // Offset the base line by 'offset' meters to the right (east)
        let offsetLine = [];
        for (let i = 0; i < nBasePoints; i++) {
            // Interpolate point along base line
            const dist = i * spacingMeters;
            let pt = turf.along(baseLine, dist, { units: 'meters' });
            // Offset perpendicular by 'offset' meters
            pt = turf.destination(pt.geometry.coordinates, offset, perpBearing, { units: 'meters' });
            const [lon, lat] = pt.geometry.coordinates;
            // Check if inside buffered parcel
            if (!turf.booleanPointInPolygon([lon, lat], buffered)) continue;
            // Label: A1, A2, B1, B2, ...
            const label = `${colLabels[col % colLabels.length]}${i + 1}`;
            // Add to registry if not already present (by coordinate)
            let exists = false;
            for (const p of gpsRegistry.points.values()) {
                if (Math.abs(p.lat - lat) < 1e-6 && Math.abs(p.lon - lon) < 1e-6) {
                    exists = true; break;
                }
            }
            if (!exists) {
                const id = `grid-${Date.now()}-${col}-${i}`;
                gpsRegistry.points.set(id, {
                    id, lat, lon, label, type: 'grid', source: 'parcel-shp', status: 'unmarked', stpIndex: null, importedAt: Date.now()
                });
                added++;
                gridPoints.push({ id, lat, lon, label });
            }
        }
        // Stop if no points were added in this column (fully outside parcel)
        if (gridPoints.length === 0 || (gridPoints.length > 0 && gridPoints.slice(-nBasePoints).filter(pt => pt.label.startsWith(colLabels[col % colLabels.length])).length === 0)) {
            break;
        }
    }
    renderSavedStps && renderSavedStps();
    alert(`Generated ${added} STP grid points inside parcel. View on map or in list below.`);
}
const storageKey = "archaeolab-stp-session-v1";
const projectsStorageKey = "archaeolab-projects-v1";
const filterStorageKey = "archaeolab-ui-filters-v1";
const contrastModeStorageKey = "archaeolab-contrast-mode-v1";
const fieldModeStorageKey = "archaeolab-field-mode-v1";
const flowResumeStorageKey = "archaeolab-flow-resume-v1";
const recentCrewMembersStorageKey = "archaeolab-recent-crew-members-v1";
const importQualityModeStorageKey = "archaeolab-import-quality-mode-v1";
const coreDataBackupStorageKey = "archaeolab-stp-core-backup-v1";
const projectsCoreBackupStorageKey = "archaeolab-project-latest-core-backup-v1";
const appDataDatabaseName = "archaeolab-app-data-v1";
const appDataStore = "app-data";
const fileHandlesStore = "file-handles";
const appDataDatabaseVersion = 2;
const appDataSessionEntryKey = "session";
const appDataProjectsEntryKey = "projects";
const appJsonBackupHandleKey = "session-json-backup:app-default";
const gpsMapPayloadStorageKey = "archaeolab-gps-map-payload-v1";
const gpsPointsRegistryStorageKey = "archaeolab-gps-points-registry-v1";
const gpsPointsDatabaseName = "archaeolab-gps-points-v1";
const gpsPointsStore = "points";
const gpsPointsDatabaseVersion = 1;
const sessionBackupFormatVersion = 2;
const maxProjectImageSizeBytes = 4 * 1024 * 1024;
const maxReferencePhotoSizeBytes = 4 * 1024 * 1024;
const maxImageSourceSizeBytes = 20 * 1024 * 1024;
const approximateLocalStorageQuotaBytes = 5 * 1024 * 1024;
const defaultReferencePhotoSrc = "IMG_3376.JPG";
const defaultMapViewerTitle = "Project Map Reference";
const gpsCoordinateDecimalPlaces = 6;
const gpsCoordinateMatchTolerance = 0.000005;
const persistStratumPhotoBlobsInBrowser = true;
const autoJsonBackupOnSaveStp = true;
const importQualityProfiles = {
    balanced: {
        maxDimension: 2600,
        initialQuality: 0.88,
        minQuality: 0.62,
        maxAttempts: 10,
        qualityStep: 0.08,
        oversizeHardThreshold: 1.9,
        oversizeSoftThreshold: 1.25,
        downscaleHardFactor: 0.8,
        downscaleSoftFactor: 0.88,
        downscaleFinalFactor: 0.93
    },
    sharp: {
        maxDimension: 3200,
        initialQuality: 0.94,
        minQuality: 0.72,
        maxAttempts: 14,
        qualityStep: 0.04,
        oversizeHardThreshold: 2.1,
        oversizeSoftThreshold: 1.4,
        downscaleHardFactor: 0.84,
        downscaleSoftFactor: 0.9,
        downscaleFinalFactor: 0.95
    }
};
const supportedProjectImageTypes = ["image/jpeg", "image/png", "image/webp"];
const supportedProjectImageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const validDepthUnits = ["metric", "standard", "engineering-feet"];
const defaultDepthUnit = "engineering-feet";
const validEntryTypes = ["base", "supplemental", "unit-id"];
const validUnitSizePresets = ["2x2", "3x3", "4x4"];
const photoDatabaseName = "archaeolab-stp-photos-v1";
const photoDatabaseStore = "photos";
const photoDatabaseVersion = 1;
const draftPhotoBlobs = new Map();

let photoDatabasePromise;
let appDataDatabasePromise;
let importQualityMode = "sharp";
let pendingSavedPhotoOpenName = "";
let activeMapViewerObjectUrl = "";
let activeReferencePreviewObjectUrl = "";
let referencePhotoPreviewSource = "";
let referencePhotoPreviewTitle = "";
let referencePhotoPreviewHint = "";
let referencePhotoPreviewKind = "";
let referencePhotoPreviewEntryKey = "";
let designatedJsonBackupFileName = "";
let designatedJsonBackupLastSavedAt = "";
let backupDestinationStatusRequestId = 0;
let fieldModeEnabled = true;
const flowModeEnabled = true;
let flowSteps = [];
let activeFlowStepId = "";
let flowValidationMessage = "";
let flowFocusToken = "";
let lastTouchedStratumCard = null;
let activeEditStpIndex = -1;
let sessionSavePendingCount = 0;
let deferredInstallPrompt = null;
let sessionSaveQueue = Promise.resolve();
let projectsSaveQueue = Promise.resolve();
let projectsStoreCache = [];
const dataSafetyState = {
    loadedFromCoreBackup: false,
    lastFullSessionSaveOk: true,
    lastCoreBackupSaveOk: true
};
const projectStorageState = {
    loadedFromCoreBackup: false,
    lastFullProjectsSaveOk: true,
    lastCoreBackupSaveOk: true
};

const dropdownOptions = {
    munsell: [
        "10YR2/1",
        "10YR2/2",
        "10YR3/1",
        "10YR3/2",
        "10YR3/3",
        "10YR3/4",
        "10YR3/6",
        "10YR4/1",
        "10YR4/2",
        "10YR4/3",
        "10YR4/6",
        "10YR5/1",
        "10YR5/2",
        "10YR5/3",
        "10YR5/4",
        "10YR5/6",
        "10YR5/8",
        "10YR6/1",
        "10YR6/2",
        "10YR6/3",
        "10YR6/4",
        "10YR6/6",
        "10YR6/8",
        "10YR7/1",
        "10YR7/2",
        "10YR7/3",
        "10YR7/4",
        "10YR7/6",
        "10YR7/8",
        "10YR8/1",
        "10YR8/2",
        "10YR8/3",
        "10YR8/4",
        "10YR8/6",
        "10YR8/8",
        "2.5Y2.5/1",
        "2.5Y3/1",
        "2.5Y3/2",
        "2.5Y3/3",
        "2.5Y4/1",
        "2.5Y4/2",
        "2.5Y4/3",
        "2.5Y4/4",
        "2.5YR5/1",
        "2.5YR5/2",
        "2.5YR5/3",
        "2.5YR5/4",
        "2.5YR5/6",
        "2.5YR6/1",
        "2.5YR6/2",
        "2.5YR6/3",
        "2.5YR6/4",
        "2.5YR6/6",
        "2.5YR6/8",
        "2.5YR7/1",
        "2.5YR7/2",
        "2.5YR7/3",
        "2.5YR7/4",
        "2.5YR7/6",
        "2.5YR7/8",
        "2.5YR8/1",
        "2.5YR8/2",
        "2.5YR8/3",
        "2.5YR8/4",
        "2.5YR8/6",
        "2.5YR8/8",
        "5YR2.5/1",
        "5YR2.5/2",
        "5YR3/1",
        "5YR3/2",
        "5YR3/3",
        "5YR3/4",
        "5YR3/6",
        "5YR3/8",
        "5YR4/1",
        "5YR4/2",
        "5YR4/3",
        "5YR4/4",
        "5YR4/6",
        "5YR5/1",
        "5YR5/2",
        "5YR5/3",
        "5YR5/4",
        "5YR5/6",
        "5YR5/8",
        "5YR6/1",
        "5YR6/2",
        "5YR6/3",
        "5YR6/4",
        "5YR6/6",
        "5YR6/8",
        "5YR7/1",
        "5YR7/2",
        "5YR7/3",
        "5YR7/4",
        "5YR7/6",
        "5YR7/8",
        "5YR8/1",
        "5YR8/2",
        "5YR8/3",
        "5YR8/4",
        "7.5YR2.5/1",
        "7.5YR2.5/2",
        "7.5YR3/1",
        "7.5YR3/2",
        "7.5YR3/3",
        "7.5YR3/4",
        "7.5YR4/1",
        "7.5YR4/2",
        "7.5YR4/3",
        "7.5YR4/4",
        "7.5YR4/6",
        "7.5YR5/1",
        "7.5YR5/2",
        "7.5YR5/3",
        "7.5YR5/4",
        "7.5YR5/6",
        "7.5YR5/8",
        "7.5YR6/1",
        "7.5YR6/2",
        "7.5YR6/3",
        "7.5YR6/4",
        "7.5YR6/6",
        "7.5YR6/8",
        "7.5YR7/1",
        "7.5YR7/2",
        "7.5YR7/3",
        "7.5YR7/4",
        "7.5YR7/6",
        "7.5YR7/8",
        "7.5YR8/1",
        "7.5YR8/2",
        "7.5YR8/3",
        "7.5YR8/4",
        "Gleyed",
        "Mixed",
        "Mottled",
        "Null",
        "Redox"
    ],
    texture: [
        "Ash",
        "Clay",
        "Clay & sand",
        "Clay loam",
        "Clay silt",
        "Clayey sand loam",
        "Clayey sandy silt",
        "Clayey sandy silt loam",
        "Clayey silt loam",
        "Const Debris",
        "Driveway",
        "Fine loamy sand",
        "Fine sandy clay",
        "Fine sandy clay loam",
        "Fine sandy loam",
        "Fine sandy silt loam",
        "Fine silt",
        "Gravel",
        "Gravelly clay loam",
        "Gravelly loamy sand",
        "Gravelly sand",
        "Gravelly sand loam",
        "Gravelly sandy silt loam",
        "Gravelly silt",
        "Gravelly silt loam",
        "Humus",
        "Impenetrable",
        "Loam",
        "Loamy sand",
        "Overgrowth",
        "Redox",
        "Road Cut",
        "Rubble",
        "Sand",
        "Sandy clay",
        "Sandy clay loam",
        "Sandy loam",
        "Sandy silt",
        "Sandy silt loam",
        "Sandy Silty Clay",
        "Silt",
        "Silt loam",
        "Silty Clay Sand",
        "Silty Loam Sand",
        "Silty Sand",
        "Silty sandy loam",
        "Silty clay",
        "Silty clay loam",
        "Very fine sand",
        "Very fine sandy clay",
        "Very fine sandy clay loam",
        "Very fine sandy loam",
        "Very fine sandy silt",
        "Very fine sandy silt loam",
        "Very fine silt",
        "Very fine silt loam"
    ],
    horizon: [
        "A",
        "A1",
        "A2",
        "A3",
        "A4",
        "Ao",
        "Ao1",
        "Ao2",
        "Ao3",
        "Ap",
        "Ap1",
        "Ap2",
        "Ap3",
        "B",
        "BA",
        "BE",
        "Bt",
        "Bt1",
        "Bt2",
        "Bt3",
        "Bt4",
        "Bw",
        "Bw1",
        "Bw2",
        "Bw3",
        "Bw4",
        "C",
        "C1",
        "C2",
        "C3",
        "C4",
        "E"
    ]
};

const state = {
    siteName: "",
    siteLocation: "",
    crewMembers: "",
    depthUnit: defaultDepthUnit,
    stps: [],
    projectImage: "",
    referencePhoto: ""
};

// GPS Real-Time Event System
// Listen for changes to GPS points and STPs across tabs/workers
const gpsEventBus = new EventTarget();
const GPS_POINT_MARKED = "gps:point-marked";
const GPS_POINT_UNMARKED = "gps:point-unmarked";
const GPS_POINT_UPDATED = "gps:point-updated";
const STP_GPS_CHANGED = "stp:gps-changed";

// GPS Registry State - tracks imported GPS points and their STP associations
const gpsRegistry = {
    points: new Map(), // pointId -> {id, lat, lon, label, type, source, status, stpIndex, importedAt}
    stpToPointMap: new Map(), // stpIndex -> pointId
    pointToStpMap: new Map(), // pointId -> stpIndex
    isLoaded: false
};

let gpsPointsDatabasePromise;
let currentLocationWatchId = null;
let currentLocation = null;

const elements = {};


import { showLoginModal } from "./ui/login.js";
import { setBackend } from "./storage/index.js";
import { localBackend } from "./storage/local.js";
import { cloudBackend } from "./storage/cloud.js";

let currentUser = null;

function handleLogin(provider) {
    currentUser = { provider, name: provider === 'google' ? 'Google User' : 'iCloud User' };
    setBackend(cloudBackend);
    updateLoginUi();
    updateSyncStatusUi('connecting');
    if (provider === 'google' && window.google && window.google.accounts && window.gapi) {
        import('./storage/cloud.js').then(mod => {
            if (mod && mod.ensureDriveToken) {
                mod.ensureDriveToken()
                    .then(() => {
                        updateSyncStatusUi('connected');
                    })
                    .catch(() => {
                        updateSyncStatusUi('error');
                    });
            }
        });
    } else {
        updateSyncStatusUi('connected');
    }
    if (loginModal) loginModal.remove();
}

function handleLogout() {
    currentUser = null;
    setBackend(localBackend);
    updateLoginUi();
    updateSyncStatusUi('disconnected');
    if (loginModal) loginModal.remove();
    // Optionally clear cloud-only state
}
// Update Cloud Sync status indicator and text
function updateSyncStatusUi(state) {
    const indicator = document.getElementById('syncStatusIndicator');
    const text = document.getElementById('syncStatusText');
    if (!indicator || !text) return;
    if (state === 'connected') {
        indicator.className = 'sync-status-indicator green';
        text.textContent = 'Connected';
    } else if (state === 'connecting') {
        indicator.className = 'sync-status-indicator yellow';
        text.textContent = 'Connecting...';
    } else if (state === 'error') {
        indicator.className = 'sync-status-indicator red';
        text.textContent = 'Error';
    } else {
        indicator.className = 'sync-status-indicator red';
        text.textContent = 'Not connected';
    }
    // Show last sync time if available
    const lastSyncTimeEl = document.getElementById('lastSyncTime');
    if (lastSyncTimeEl) {
        if (window.lastSyncTimestamp) {
            const d = new Date(window.lastSyncTimestamp);
            lastSyncTimeEl.textContent = 'Last sync: ' + d.toLocaleString();
        } else {
            lastSyncTimeEl.textContent = '';
        }
    }
}

let loginModal = null;
function updateLoginUi() {
    const loginBtn = document.getElementById('loginUiButton');
    const userLabel = document.getElementById('userUiLabel');
    if (loginBtn) {
        loginBtn.textContent = currentUser ? 'Sign out' : 'Sign in';
        loginBtn.title = currentUser ? 'Sign out of cloud' : 'Sign in to cloud';
    }
    if (userLabel) {
        if (currentUser && currentUser.provider === 'google') {
            userLabel.textContent = `Google: ${currentUser.name || 'User'}`;
            userLabel.style.color = '#e94335';
        } else if (currentUser && currentUser.provider === 'icloud') {
            userLabel.textContent = `iCloud: ${currentUser.name || 'User'}`;
            userLabel.style.color = '#007aff';
        } else {
            userLabel.textContent = 'Not signed in';
            userLabel.style.color = '#fff';
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Add login UI to header if not present
    let loginBtn = document.getElementById('loginUiButton');
    let userLabel = document.getElementById('userUiLabel');
    if (!loginBtn) {
        loginBtn = document.createElement('button');
        loginBtn.id = 'loginUiButton';
        loginBtn.className = 'ghost-button';
        // Removed marginLeft to keep button aligned
        const heroCard = document.querySelector('.hero-card-buttons');
        if (heroCard) heroCard.appendChild(loginBtn);
    }
    if (!userLabel) {
        userLabel = document.createElement('span');
        userLabel.id = 'userUiLabel';
        userLabel.className = 'user-label';
        userLabel.textContent = 'Not signed in';
        const heroCard = document.querySelector('.hero-card-buttons');
        if (heroCard) heroCard.appendChild(userLabel);
    }
    // Always attach the click handler ONCE
    loginBtn.onclick = () => {
        if (currentUser) handleLogout();
        else {
            if (loginModal) loginModal.remove();
            loginModal = showLoginModal({ onLogin: handleLogin, onLogout: handleLogout, user: currentUser });
        }
    };
    // Default to local backend until login
    setBackend(localBackend);
    updateLoginUi();
    // Optionally show login modal on first load
    // loginModal = showLoginModal({ onLogin: handleLogin, onLogout: handleLogout, user: currentUser });
    initializeApp();
});

async function initializeApp() {
    cacheElements();
    loadContrastMode();
    loadImportQualityMode();
    populateDropdownDatalists();
    bindEvents();
    await loadSession();
    await initializeProjectsStore();
    loadFilterState();
    populateSiteFields();
    refreshParentStpOptions();
    updateStpTypeUi();
    renderSavedStps();
    renderProjects();
    renderProjectBanner();
    renderReferencePhoto();
    resetCurrentStp(false);
    updateImageStorageStatus();
    updateDataSafetyStatus();
    registerServiceWorker();
    setupPwaInstallPrompt();
    updateActiveStpBar();
    initializeFlowNavigator();
    showProjectDashboard();
    await updateBackupDestinationStatus();
    // Set up Cloud Sync card actions
    function handleViewBackups() {
        alert('View Backups: This will show backup/restore options. (To be implemented)');
    }
    
    // Placeholder: Sync Settings handler
    function handleSyncSettings() {
        alert('Sync Settings: This will open sync/cloud settings. (To be implemented)');
    }
    const viewBackupsBtn = document.getElementById('viewBackupsButton');
    if (viewBackupsBtn) viewBackupsBtn.onclick = handleViewBackups;
    const syncSettingsBtn = document.getElementById('syncSettingsButton');
    if (syncSettingsBtn) syncSettingsBtn.onclick = handleSyncSettings;
}

function showProjectDashboard() {
    if (elements.projectDashboard) {
        elements.projectDashboard.hidden = false;
    }
    if (elements.fieldWorkspace) {
        elements.fieldWorkspace.hidden = true;
    }
    if (elements.flowNavigator) {
        elements.flowNavigator.hidden = true;
    }
    if (elements.continueSessionButton) {
        elements.continueSessionButton.disabled = state.stps.length === 0;
        elements.continueSessionButton.textContent = state.stps.length === 0
            ? "No Current Session"
            : "Continue Current Session";
    }
}

function showFieldWorkspace() {
    if (elements.projectDashboard) {
        elements.projectDashboard.hidden = true;
    }
    if (elements.fieldWorkspace) {
        elements.fieldWorkspace.hidden = false;
    }
    if (elements.flowNavigator) {
        elements.flowNavigator.hidden = false;
    }
    if (elements.entryForm) {
        elements.entryForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function startNewFieldSession() {
    if (state.stps.length > 0) {
        clearSession().then(showFieldWorkspace);
        return;
    }

    showFieldWorkspace();
}

function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    if (!window.isSecureContext) {
        return;
    }

    function doRegister() {
        navigator.serviceWorker.register("./service-worker.js").catch(function (error) {
            console.warn("Could not register service worker.", error);
        });
    }

    if (document.readyState === "complete") {
        doRegister();
    } else {
        window.addEventListener("load", doRegister);
    }
}

function setupPwaInstallPrompt() {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
    if (isStandalone) return; // already installed

    // Standard install prompt (Chrome Android/Desktop, Edge)
    window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (elements.pwaInstallBanner) {
            elements.pwaInstallBanner.hidden = false;
        }
    });

    window.addEventListener("appinstalled", function () {
        deferredInstallPrompt = null;
        if (elements.pwaInstallBanner) {
            elements.pwaInstallBanner.hidden = true;
        }
    });

    // iOS Safari: no beforeinstallprompt — show manual instructions
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
        if (elements.pwaInstallBanner) {
            elements.pwaInstallBanner.hidden = false;
        }
        if (elements.pwaInstallButton) {
            elements.pwaInstallButton.hidden = true;
        }
        const iosInstructions = document.getElementById("pwaIosInstructions");
        if (iosInstructions) iosInstructions.hidden = false;
    }
}

function handlePwaInstallClick() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function () {
        deferredInstallPrompt = null;
        if (elements.pwaInstallBanner) {
            elements.pwaInstallBanner.hidden = true;
        }
    });
}

function handlePwaInstallDismiss() {
    if (elements.pwaInstallBanner) {
        elements.pwaInstallBanner.hidden = true;
    }
}

function cacheElements() {
        elements.importGeojsonButton = document.getElementById("importGeojsonButton");
        elements.importGeojsonInput = document.getElementById("importGeojsonInput");
    elements.entryForm = document.getElementById("entryForm");
    elements.siteName = document.getElementById("siteName");
    elements.siteLocation = document.getElementById("siteLocation");
    elements.crewMembers = document.getElementById("crewMembers");
    elements.depthUnit = document.getElementById("depthUnit");
    elements.stpEntryType = document.getElementById("stpEntryType");
    elements.unitSizeField = document.getElementById("unitSizeField");
    elements.unitSizePreset = document.getElementById("unitSizePreset");
    elements.unitSizeCustomField = document.getElementById("unitSizeCustomField");
    elements.unitSizeCustom = document.getElementById("unitSizeCustom");
    elements.parentStp = document.getElementById("parentStp");
    elements.gpsLatitude = document.getElementById("gpsLatitude");
    elements.gpsLongitude = document.getElementById("gpsLongitude");
    elements.useCurrentGpsButton = document.getElementById("useCurrentGpsButton");
    elements.gpsStatusMessage = document.getElementById("gpsStatusMessage");
    elements.stpLabel = document.getElementById("stpLabel");
    elements.supDirection = document.getElementById("supDirection");
    elements.strataList = document.getElementById("strataList");
    elements.stratumTemplate = document.getElementById("stratumTemplate");
    elements.sessionStatus = document.getElementById("sessionStatus");
    elements.savedEmptyState = document.getElementById("savedEmptyState");
    elements.savedStpList = document.getElementById("savedStpList");
    elements.addStratumButton = document.getElementById("addStratumButton");
    elements.saveStpButton = document.getElementById("saveStpButton");
    elements.resetCurrentButton = document.getElementById("resetCurrentButton");
    elements.exportXlsxButton = document.getElementById("exportXlsxButton");
    elements.exportCsvButton = document.getElementById("exportCsvButton");
    elements.exportKmlButton = document.getElementById("exportKmlButton");
    elements.viewGpsMapButton = document.getElementById("viewGpsMapButton");
    elements.importCsvButton = document.getElementById("importCsvButton");
    elements.importCsvInput = document.getElementById("importCsvInput");
    elements.importGpsPointsButton = document.getElementById("importGpsPointsButton");
    elements.importShpButton = document.getElementById("importShpButton");
    elements.importShpInput = document.getElementById("importShpInput");
    elements.shpGridControls = document.getElementById("shpGridControls");
    elements.setbackInput = document.getElementById("setbackInput");
    elements.spacingInput = document.getElementById("spacingInput");
    elements.generateGridButton = document.getElementById("generateGridButton");
    elements.clearGridButton = document.getElementById("clearGridButton");
    elements.clearAllStpButton = document.getElementById("clearAllStpButton");
    elements.exportJsonButton = document.getElementById("exportJsonButton");
    elements.importJsonButton = document.getElementById("importJsonButton");
    elements.importJsonInput = document.getElementById("importJsonInput");
    elements.setBackupFileButton = document.getElementById("setBackupFileButton");
    elements.backupDestinationStatus = document.getElementById("backupDestinationStatus");
    elements.clearSessionButton = document.getElementById("clearSessionButton");
    elements.highContrastToggle = document.getElementById("highContrastToggle");
    elements.importQualityToggle = document.getElementById("importQualityToggle");
    elements.dataSafetyStatus = document.getElementById("dataSafetyStatus");
    elements.imageStorageStatus = document.getElementById("imageStorageStatus");
    elements.suggestLabelButton = document.getElementById("suggestLabelButton");
    elements.saveProjectButton = document.getElementById("saveProjectButton");
    elements.projectsEmptyState = document.getElementById("projectsEmptyState");
    elements.projectsList = document.getElementById("projectsList");
    elements.projectSearchInput = document.getElementById("projectSearchInput");
    elements.projectSortSelect = document.getElementById("projectSortSelect");
    elements.savedStpSearchInput = document.getElementById("savedStpSearchInput");
    elements.savedStpTypeFilter = document.getElementById("savedStpTypeFilter");
    elements.savedStpSortSelect = document.getElementById("savedStpSortSelect");
    elements.clearProjectFiltersButton = document.getElementById("clearProjectFiltersButton");
    elements.clearSavedStpFiltersButton = document.getElementById("clearSavedStpFiltersButton");
    elements.projectsFilterSummary = document.getElementById("projectsFilterSummary");
    elements.savedStpFilterSummary = document.getElementById("savedStpFilterSummary");
    elements.projectsHeaderCount = document.getElementById("projectsHeaderCount");
    elements.savedStpHeaderCount = document.getElementById("savedStpHeaderCount");
    elements.projectDashboard = document.getElementById("projectDashboard");
    elements.fieldWorkspace = document.getElementById("fieldWorkspace");
    elements.continueSessionButton = document.getElementById("continueSessionButton");
    elements.newFieldSessionButton = document.getElementById("newFieldSessionButton");
    elements.projectBannerImg = document.getElementById("projectBannerImg");
    elements.projectBannerEmpty = document.getElementById("projectBannerEmpty");
    elements.projectImageInput = document.getElementById("projectImageInput");
    elements.openProjectImageButton = document.getElementById("openProjectImageButton");
    elements.removeProjectImageButton = document.getElementById("removeProjectImageButton");
    elements.projectImageMessage = document.getElementById("projectImageMessage");
    elements.referencePhotoImg = document.getElementById("referencePhotoImg");
    elements.referencePhotoEmpty = document.getElementById("referencePhotoEmpty");
    elements.referencePhotoInput = document.getElementById("referencePhotoInput");
    elements.openReferencePhotoButton = document.getElementById("openReferencePhotoButton");
    elements.clearReferencePhotoButton = document.getElementById("clearReferencePhotoButton");
    elements.closeReferencePhotoPreviewButton = document.getElementById("closeReferencePhotoPreviewButton");
    elements.referencePhotoMessage = document.getElementById("referencePhotoMessage");
    elements.referencePhotoSavedHint = document.getElementById("referencePhotoSavedHint");
    elements.referencePhotoLibrary = document.getElementById("referencePhotoLibrary");
    elements.referencePhotoLibrarySummary = document.getElementById("referencePhotoLibrarySummary");
    elements.referencePhotoLibraryList = document.getElementById("referencePhotoLibraryList");
    elements.mapViewerModal = document.getElementById("mapViewerModal");
    elements.mapViewerTitle = document.getElementById("mapViewerTitle");
    elements.mapViewerImage = document.getElementById("mapViewerImage");
    elements.closeMapViewerButton = document.getElementById("closeMapViewerButton");
    elements.savedPhotoOpenInput = document.getElementById("savedPhotoOpenInput");
    elements.pwaInstallBanner = document.getElementById("pwaInstallBanner");
    elements.pwaInstallButton = document.getElementById("pwaInstallButton");
    elements.activeStpSiteNameEl = document.getElementById("activeStpSiteName");
    elements.activeStpSepEl = document.getElementById("activeStpSep");
    elements.activeStpLblEl = document.getElementById("activeStpLbl");
    elements.activeStpStratumCountEl = document.getElementById("activeStpStratumCount");
    elements.activeStpSaveIndicator = document.getElementById("activeStpSaveIndicator");
    elements.activeStpSaveText = document.getElementById("activeStpSaveText");
    elements.topSaveStpButton = document.getElementById("topSaveStpButton");
    elements.topNewStpButton = document.getElementById("topNewStpButton");
    elements.topNewStratumButton = document.getElementById("topNewStratumButton");
    elements.activeStpPhotoButton = document.getElementById("activeStpPhotoButton");
    elements.activeReferencePhotoButton = document.getElementById("activeReferencePhotoButton");
    elements.jumpToFormButton = document.getElementById("jumpToFormButton");
    elements.quickStratumPhotoButton = document.getElementById("quickStratumPhotoButton");
    elements.quickReferencePhotoButton = document.getElementById("quickReferencePhotoButton");
    elements.wrapUpPanel = document.getElementById("wrapUpPanel");
    elements.wrapUpSummaryText = document.getElementById("wrapUpSummaryText");
    elements.wrapUpXlsxButton = document.getElementById("wrapUpXlsxButton");
    elements.wrapUpCsvButton = document.getElementById("wrapUpCsvButton");
    elements.wrapUpKmlButton = document.getElementById("wrapUpKmlButton");
    elements.wrapUpJsonButton = document.getElementById("wrapUpJsonButton");
    elements.flowNavigator = document.getElementById("flowNavigator");
    elements.flowStepSelect = document.getElementById("flowStepSelect");
    elements.flowPrevButton = document.getElementById("flowPrevButton");
    elements.flowNextButton = document.getElementById("flowNextButton");
    elements.fieldModeToggleButton = document.getElementById("fieldModeToggleButton");
    elements.flowProgressRail = document.getElementById("flowProgressRail");
    elements.flowStepStatus = document.getElementById("flowStepStatus");
}

function bindEvents() {
            if (elements.importGeojsonButton && elements.importGeojsonInput) {
                elements.importGeojsonButton.addEventListener("click", function() {
                    elements.importGeojsonInput.value = "";
                    elements.importGeojsonInput.click();
                });
                elements.importGeojsonInput.addEventListener("change", handleImportGeojsonFile);
            }
        // --- GeoJSON Parcel Import ---
        function handleImportGeojsonFile(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                alert("No GeoJSON file selected.");
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const geojson = JSON.parse(e.target.result);
                    if (!geojson || !geojson.features || geojson.features.length === 0) {
                        alert("No features found in GeoJSON file.");
                        return;
                    }
                    window._lastParcelGeojson = geojson;
                    elements.shpGridControls.hidden = false;
                    elements.shpGridControls.dataset.parcelLoaded = "1";
                    elements.shpGridControls.dataset.parcelGeojson = JSON.stringify(geojson);
                    // Extract coordinates and populate corner dropdowns (same as SHP)
                    let geom = geojson;
                    if (geojson.type === 'FeatureCollection') {
                        const polyFeature = geojson.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
                        if (polyFeature) geom = polyFeature.geometry;
                    } else if (geojson.type === 'Feature' && geojson.geometry && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
                        geom = geojson.geometry;
                    }
                    let coords = [];
                    if (geom.type === 'Polygon') coords = geom.coordinates;
                    else if (geom.type === 'MultiPolygon') coords = geom.coordinates[0];
                    if (Array.isArray(coords[0][0])) coords = coords[0];
                    if (!coords || coords.length < 2) {
                        alert('Could not extract valid boundary coordinates from GeoJSON.');
                    } else {
                        populateCornerDropdowns(coords);
                    }
                    alert("Parcel boundary loaded from GeoJSON. Set grid parameters and click Generate STP Grid.");
                } catch (err) {
                    alert("Error parsing GeoJSON: " + err);
                }
            };
            reader.readAsText(file);
        }
        // SHP import and grid generation
        if (elements.importShpButton && elements.importShpInput) {
            elements.importShpButton.addEventListener("click", function() {
                elements.importShpInput.value = "";
                elements.importShpInput.click();
            });
            elements.importShpInput.addEventListener("change", handleImportShpFiles);
        }
        if (elements.generateGridButton) {
            elements.generateGridButton.addEventListener("click", handleGenerateStpGrid);
        }
        if (elements.clearGridButton) {
            elements.clearGridButton.addEventListener("click", handleClearGridPoints);
        }
        if (elements.clearAllStpButton) {
            elements.clearAllStpButton.addEventListener("click", handleClearAllGpsPoints);
        }
    if (elements.addStratumButton) {
        elements.addStratumButton.addEventListener("click", addStratumFromBarOrAction);
    }

    if (elements.saveStpButton) {
        elements.saveStpButton.addEventListener("click", saveCurrentStp);
    }
    if (elements.resetCurrentButton) {
        elements.resetCurrentButton.addEventListener("click", function () {
            startNewStpFromCurrent();
        });
    }

    if (elements.topSaveStpButton) {
        elements.topSaveStpButton.addEventListener("click", saveCurrentStp);
    }

    if (elements.topNewStpButton) {
        elements.topNewStpButton.addEventListener("click", function () {
            startNewStpFromCurrent();
        });
    }

    if (elements.topNewStratumButton) {
        elements.topNewStratumButton.addEventListener("click", function () {
            addStratumFromBarOrAction();
        });
    }

    elements.exportXlsxButton.addEventListener("click", downloadExcelReadyXlsx);
    elements.exportCsvButton.addEventListener("click", downloadExcelReadyCsv);
    if (elements.exportKmlButton) {
        elements.exportKmlButton.addEventListener("click", downloadKml);
    }
    if (elements.viewGpsMapButton) {
        elements.viewGpsMapButton.addEventListener("click", openGpsPointsMap);
    }
    if (elements.importCsvButton && elements.importCsvInput) {
        elements.importCsvButton.addEventListener("click", requestImportCsvFile);
        elements.importCsvInput.addEventListener("change", handleImportCsvFile);
    }
    if (elements.importGpsPointsButton) {
        elements.importGpsPointsButton.addEventListener("click", requestImportGpsPointsFile);
    }
    elements.exportJsonButton.addEventListener("click", downloadSessionData);
    elements.importJsonButton.addEventListener("click", requestImportSessionFile);
    elements.importJsonInput.addEventListener("change", handleImportSessionFile);
    if (elements.setBackupFileButton) {
        elements.setBackupFileButton.addEventListener("click", handleSetBackupFileClick);
    }
    elements.clearSessionButton.addEventListener("click", clearSession);

    if (elements.wrapUpXlsxButton) {
        elements.wrapUpXlsxButton.addEventListener("click", downloadExcelReadyXlsx);
    }
    if (elements.wrapUpCsvButton) {
        elements.wrapUpCsvButton.addEventListener("click", downloadExcelReadyCsv);
    }
    if (elements.wrapUpKmlButton) {
        elements.wrapUpKmlButton.addEventListener("click", downloadKml);
    }
    if (elements.wrapUpJsonButton) {
        elements.wrapUpJsonButton.addEventListener("click", downloadSessionData);
    }

    if (elements.flowStepSelect) {
        elements.flowStepSelect.addEventListener("change", handleFlowStepSelectionChange);
    }

    if (elements.flowProgressRail) {
        elements.flowProgressRail.addEventListener("click", handleFlowProgressRailClick);
    }

    if (elements.flowPrevButton) {
        elements.flowPrevButton.addEventListener("click", handleFlowStepPrevious);
    }

    if (elements.flowNextButton) {
        elements.flowNextButton.addEventListener("click", handleFlowStepNext);
    }

    if (elements.fieldModeToggleButton) {
        elements.fieldModeToggleButton.addEventListener("click", handleFieldModeToggle);
    }

    if (elements.highContrastToggle) {
        elements.highContrastToggle.addEventListener("click", handleContrastToggle);
    }

    if (elements.importQualityToggle) {
        elements.importQualityToggle.addEventListener("click", handleImportQualityToggle);
    }

    elements.suggestLabelButton.addEventListener("click", suggestFromCurrentInput);
    elements.saveProjectButton.addEventListener("click", saveProjectAndStartNew);
    if (elements.continueSessionButton) {
        elements.continueSessionButton.addEventListener("click", showFieldWorkspace);
    }
    if (elements.newFieldSessionButton) {
        elements.newFieldSessionButton.addEventListener("click", startNewFieldSession);
    }
    elements.projectImageInput.addEventListener("change", handleProjectImageUpload);
    elements.openProjectImageButton.addEventListener("click", openMapViewer);
    elements.removeProjectImageButton.addEventListener("click", removeProjectImage);

    if (elements.openReferencePhotoButton && elements.referencePhotoInput) {
        elements.openReferencePhotoButton.addEventListener("click", openReferencePhotoPicker);
        elements.referencePhotoInput.addEventListener("change", handleReferencePhotoUpload);
    }

    if (elements.clearReferencePhotoButton) {
        elements.clearReferencePhotoButton.addEventListener("click", function () {
            clearReferencePhoto(true);
        });
    }

    if (elements.closeReferencePhotoPreviewButton) {
        elements.closeReferencePhotoPreviewButton.addEventListener("click", function () {
            clearReferencePhotoPreview(true);
        });
    }

    if (elements.referencePhotoLibraryList) {
        elements.referencePhotoLibraryList.addEventListener("click", handleReferencePhotoLibraryClick);
    }

    elements.closeMapViewerButton.addEventListener("click", closeMapViewer);
    elements.mapViewerModal.addEventListener("click", handleMapViewerClick);
    document.addEventListener("keydown", handleMapViewerEscape);

    elements.siteName.addEventListener("input", updateSiteDraft);
    elements.siteLocation.addEventListener("input", updateSiteDraft);
    if (elements.crewMembers) {
        elements.crewMembers.addEventListener("input", updateSiteDraft);
    }
    elements.depthUnit.addEventListener("change", updateSiteDraft);

    if (elements.unitSizePreset) {
        elements.unitSizePreset.addEventListener("change", function () {
            updateUnitSizeUi();
            updateActiveStpBar();
            syncFlowNavigatorState(false);
        });
    }

    if (elements.unitSizeCustom) {
        elements.unitSizeCustom.addEventListener("input", function () {
            syncFlowNavigatorState(false);
        });
    }

    if (elements.useCurrentGpsButton) {
        elements.useCurrentGpsButton.addEventListener("click", handleUseCurrentGps);
    }

    if (elements.pwaInstallButton) {
        elements.pwaInstallButton.addEventListener("click", handlePwaInstallClick);
    }
    const pwaInstallDismiss = document.getElementById("pwaInstallDismiss");
    if (pwaInstallDismiss) {
        pwaInstallDismiss.addEventListener("click", handlePwaInstallDismiss);
    }

    elements.stpEntryType.addEventListener("change", function () {
        updateStpTypeUi();
        refreshPhotoRulesAll();
        updateActiveStpBar();
        syncFlowNavigatorState(false);
    });

    elements.parentStp.addEventListener("change", function () {
        refreshPhotoRulesAll();
        updateActiveStpBar();
        syncFlowNavigatorState(false);
    });

    elements.stpLabel.addEventListener("input", function () {
        refreshPhotoRulesAll();
        updateActiveStpBar();
        syncFlowNavigatorState(false);
    });

    if (elements.jumpToFormButton) {
        elements.jumpToFormButton.addEventListener("click", function () {
            const targetStepId = getCurrentDraftFlowStepId();

            if (flowSteps.length > 0) {
                setActiveFlowStep(targetStepId, false);
            }
            elements.entryForm.scrollIntoView({ behavior: "smooth", block: "start" });

            if (targetStepId === "site") {
                elements.siteName.focus();
            } else {
                elements.stpLabel.focus();
            }
        });
    }

    if (elements.activeStpPhotoButton) {
        elements.activeStpPhotoButton.addEventListener("click", function () {
            openStratumPhotoPicker(getCurrentStratumCard(), true);
        });
    }

    if (elements.activeReferencePhotoButton) {
        elements.activeReferencePhotoButton.addEventListener("click", openReferencePhotoPicker);
    }

    if (elements.quickStratumPhotoButton) {
        elements.quickStratumPhotoButton.addEventListener("click", function () {
            openStratumPhotoPicker(getCurrentStratumCard(), false);
        });
    }

    if (elements.quickReferencePhotoButton) {
        elements.quickReferencePhotoButton.addEventListener("click", openReferencePhotoPicker);
    }

    elements.supDirection.addEventListener("change", function () {
        refreshPhotoRulesAll();
        updateActiveStpBar();
        syncFlowNavigatorState(false);
    });

    document.addEventListener("focusin", handleFlowFocusCapture);
    document.addEventListener("click", handleFlowActionClick);

    elements.projectSearchInput.addEventListener("input", handleProjectFilterInput);
    elements.projectSearchInput.addEventListener("keydown", handleFilterSearchKeydown);
    elements.projectSortSelect.addEventListener("change", handleProjectFilterInput);
    elements.savedStpSearchInput.addEventListener("input", handleSavedStpFilterInput);
    elements.savedStpSearchInput.addEventListener("keydown", handleFilterSearchKeydown);
    elements.savedStpTypeFilter.addEventListener("change", handleSavedStpFilterInput);
    elements.savedStpSortSelect.addEventListener("change", handleSavedStpFilterInput);
    elements.clearProjectFiltersButton.addEventListener("click", clearProjectFilters);
    elements.clearSavedStpFiltersButton.addEventListener("click", clearSavedStpFilters);
    elements.savedStpList.addEventListener("click", handleSavedStpListClick);

    if (elements.savedPhotoOpenInput) {
        elements.savedPhotoOpenInput.addEventListener("change", handleSavedPhotoOpenSelection);
    }

    elements.strataList.addEventListener("click", handleStrataListClick);
    elements.strataList.addEventListener("input", handleStrataListInput);
    elements.strataList.addEventListener("change", handleStrataListChange);
    elements.strataList.addEventListener("focusin", function (event) {
        const card = event.target.closest(".stratum-card");
        if (card) {
            lastTouchedStratumCard = card;
            updateQuickPhotoControls();
        }

        handleFlowFocusCapture(event);
    });
}

function populateDropdownDatalists() {
    populateDatalist("munsellOptions", dropdownOptions.munsell);
    populateDatalist("textureOptions", dropdownOptions.texture);
    populateDatalist("horizonOptions", dropdownOptions.horizon);
}

function populateDatalist(datalistId, values) {
    const datalist = document.getElementById(datalistId);

    if (!datalist) {
        return;
    }

    datalist.innerHTML = "";

    values.forEach(function (value) {
        const option = document.createElement("option");
        option.value = value;
        datalist.appendChild(option);
    });
}

function normalizeTextValue(value) {
    return String(value == null ? "" : value).trim();
}

function generateUniqueId() {
    return "id-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
}

function normalizeDepthUnitValue(value) {
    const normalized = normalizeTextValue(value).toLowerCase();
    return validDepthUnits.includes(normalized) ? normalized : defaultDepthUnit;
}

function normalizeUnitSizeValue(value) {
    const normalized = normalizeTextValue(value);

    if (!normalized) {
        return "";
    }

    const compactMatch = normalized.match(/^(\d+)\s*[xX]\s*(\d+)$/);

    if (compactMatch) {
        return compactMatch[1] + "x" + compactMatch[2];
    }

    return normalized;
}

function loadRecentCrewMembers() {
    try {
        return normalizeTextValue(localStorage.getItem(recentCrewMembersStorageKey));
    } catch (error) {
        console.warn("Could not load recent crew members.", error);
        return "";
    }
}

function persistRecentCrewMembers(value) {
    const normalizedValue = normalizeTextValue(value);

    try {
        if (normalizedValue) {
            localStorage.setItem(recentCrewMembersStorageKey, normalizedValue);
        } else {
            localStorage.removeItem(recentCrewMembersStorageKey);
        }
    } catch (error) {
        console.warn("Could not save recent crew members.", error);
    }
}

function normalizeEntryTypeValue(value) {
    const normalized = normalizeTextValue(value).toLowerCase();
    return validEntryTypes.includes(normalized) ? normalized : "base";
}

function normalizeSupDirectionValue(value) {
    const normalized = normalizeTextValue(value).toUpperCase();
    return ["N", "S", "E", "W"].includes(normalized) ? normalized : "";
}

function normalizeImportedStratum(stratum) {
    const rawStratum = stratum && typeof stratum === "object" ? stratum : {};
    const rawPhotos = Array.isArray(rawStratum.photos) ? rawStratum.photos : [];
    const photos = rawPhotos.map(function (entry) {
        const normalized = normalizePhotoEntry(entry);

        return {
            id: normalized.id,
            name: normalizeTextValue(normalized.name),
            type: normalized.type,
            size: normalized.size
        };
    }).filter(function (entry) {
        return Boolean(entry.id) || Boolean(entry.name);
    });

    const rawPhotoNames = Array.isArray(rawStratum.photoNames) ? rawStratum.photoNames : [];
    const photoNames = rawPhotoNames.map(normalizeTextValue).filter(Boolean);
    const fallbackPhotoNames = photos.map(function (entry) {
        return normalizeTextValue(entry.name);
    }).filter(Boolean);

    return {
        stratumLabel: normalizeTextValue(rawStratum.stratumLabel),
        depth: normalizeTextValue(rawStratum.depth),
        munsell: normalizeTextValue(rawStratum.munsell),
        soilType: normalizeTextValue(rawStratum.soilType),
        horizon: normalizeTextValue(rawStratum.horizon),
        artifactCatalog: normalizeTextValue(rawStratum.artifactCatalog),
        artifactSummary: normalizeTextValue(rawStratum.artifactSummary),
        notes: normalizeTextValue(rawStratum.notes),
        photoNames: photoNames.length > 0 ? photoNames : fallbackPhotoNames,
        photos: photos
    };
}

function normalizeImportedStp(stp, defaults) {
    const rawStp = stp && typeof stp === "object" ? stp : {};
    const entryType = normalizeEntryTypeValue(rawStp.entryType);
    const parentStp = entryType === "supplemental" ? normalizeTextValue(rawStp.parentStp) : "";
    const supDirection = entryType === "supplemental" ? normalizeSupDirectionValue(rawStp.supDirection) : "";

    return {
        siteName: normalizeTextValue(rawStp.siteName || defaults.siteName),
        siteLocation: normalizeTextValue(rawStp.siteLocation || defaults.siteLocation),
        crewMembers: normalizeTextValue(rawStp.crewMembers || defaults.crewMembers),
        depthUnit: normalizeDepthUnitValue(rawStp.depthUnit || defaults.depthUnit),
        stpLabel: normalizeTextValue(rawStp.stpLabel),
        entryType: entryType,
        unitSize: entryType === "unit-id" ? normalizeUnitSizeValue(rawStp.unitSize) : "",
        parentStp: parentStp,
        supDirection: supDirection,
        gpsLatitude: normalizeTextValue(rawStp.gpsLatitude),
        gpsLongitude: normalizeTextValue(rawStp.gpsLongitude),
        savedAt: normalizeTextValue(rawStp.savedAt) || new Date().toISOString(),
        strata: (Array.isArray(rawStp.strata) ? rawStp.strata : []).map(normalizeImportedStratum)
    };
}

function normalizeImportedSession(sessionData) {
    const rawSession = sessionData && typeof sessionData === "object" ? sessionData : {};
    const siteName = normalizeTextValue(rawSession.siteName);
    const siteLocation = normalizeTextValue(rawSession.siteLocation);
    const crewMembers = normalizeTextValue(rawSession.crewMembers);
    const depthUnit = normalizeDepthUnitValue(rawSession.depthUnit);
    const defaults = {
        siteName: siteName,
        siteLocation: siteLocation,
        crewMembers: crewMembers,
        depthUnit: depthUnit
    };

    return {
        siteName: siteName,
        siteLocation: siteLocation,
        crewMembers: crewMembers,
        depthUnit: depthUnit,
        stps: (Array.isArray(rawSession.stps) ? rawSession.stps : []).map(function (stp) {
            return normalizeImportedStp(stp, defaults);
        }),
        projectImage: typeof rawSession.projectImage === "string" ? rawSession.projectImage : "",
        referencePhoto: typeof rawSession.referencePhoto === "string"
            ? rawSession.referencePhoto
            : (typeof rawSession.referenceImage === "string" ? rawSession.referenceImage : "")
    };
}

function normalizeImportedProject(projectData, fallbackId) {
    const rawProject = projectData && typeof projectData === "object" ? projectData : {};
    const siteName = normalizeTextValue(rawProject.siteName);
    const siteLocation = normalizeTextValue(rawProject.siteLocation);
    const crewMembers = normalizeTextValue(rawProject.crewMembers);
    const depthUnit = normalizeDepthUnitValue(rawProject.depthUnit);
    const defaults = {
        siteName: siteName,
        siteLocation: siteLocation,
        crewMembers: crewMembers,
        depthUnit: depthUnit
    };

    return {
        id: normalizeTextValue(rawProject.id) || fallbackId || String(Date.now()),
        name: normalizeTextValue(rawProject.name) || siteName || "Untitled Project",
        savedAt: normalizeTextValue(rawProject.savedAt) || new Date().toISOString(),
        siteName: siteName,
        siteLocation: siteLocation,
        crewMembers: crewMembers,
        depthUnit: depthUnit,
        stps: (Array.isArray(rawProject.stps) ? rawProject.stps : []).map(function (stp) {
            return normalizeImportedStp(stp, defaults);
        }),
        projectImage: typeof rawProject.projectImage === "string" ? rawProject.projectImage : "",
        referencePhoto: typeof rawProject.referencePhoto === "string"
            ? rawProject.referencePhoto
            : (typeof rawProject.referenceImage === "string" ? rawProject.referenceImage : "")
    };
}

function normalizeImportedProjects(projectsData) {
    const seenIds = new Set();

    return (Array.isArray(projectsData) ? projectsData : []).map(function (project, index) {
        const rawProject = project && typeof project === "object" ? project : {};
        const seed = normalizeTextValue(rawProject.savedAt)
            || normalizeTextValue(rawProject.name)
            || normalizeTextValue(rawProject.siteName)
            || String(index + 1);
        const stableFallbackId = "project-"
            + String(index + 1)
            + "-"
            + seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const normalized = normalizeImportedProject(
            project,
            stableFallbackId
        );
        let uniqueId = normalized.id;

        while (seenIds.has(uniqueId)) {
            uniqueId = normalized.id + "-" + String(index + 1);
        }

        seenIds.add(uniqueId);
        normalized.id = uniqueId;
        return normalized;
    });
}

function buildCoreProjectBackupPayload(project) {
    const normalizedProject = normalizeImportedProject(project, "backup-" + String(Date.now()));

    return {
        backupSavedAt: new Date().toISOString(),
        backupMode: "project-core-data-only",
        project: {
            id: normalizedProject.id,
            name: normalizedProject.name,
            savedAt: normalizedProject.savedAt,
            siteName: normalizedProject.siteName,
            siteLocation: normalizedProject.siteLocation,
            crewMembers: normalizedProject.crewMembers,
            depthUnit: normalizedProject.depthUnit,
            stps: normalizedProject.stps,
            projectImage: "",
            referencePhoto: ""
        }
    };
}

function saveLatestProjectCoreBackup(project) {
    if (!project) {
        return false;
    }

    try {
        const payload = buildCoreProjectBackupPayload(project);
        localStorage.setItem(projectsCoreBackupStorageKey, JSON.stringify(payload));
        return true;
    } catch (error) {
        console.warn("Could not save project core backup.", error);
        return false;
    }
}

function loadLatestProjectCoreBackup() {
    const rawBackup = localStorage.getItem(projectsCoreBackupStorageKey);

    if (!rawBackup) {
        return null;
    }

    try {
        const parsedBackup = JSON.parse(rawBackup);
        const backupProject = parsedBackup && typeof parsedBackup === "object"
            ? parsedBackup.project
            : null;

        if (!backupProject || typeof backupProject !== "object") {
            return null;
        }

        const normalized = normalizeImportedProject(backupProject, "backup-" + String(Date.now()));
        normalized.projectImage = "";
        normalized.referencePhoto = "";
        return normalized;
    } catch (error) {
        console.warn("Could not load project core backup.", error);
        return null;
    }
}

function normalizeSearchToken(value) {
    return normalizeTextValue(value).toLowerCase();
}

function setHighlightedText(targetElement, textValue, searchTerm) {
    if (!targetElement) {
        return;
    }

    const sourceText = String(textValue == null ? "" : textValue);
    const normalizedTerm = normalizeSearchToken(searchTerm);
    targetElement.textContent = "";

    if (!normalizedTerm) {
        targetElement.textContent = sourceText || "-";
        return;
    }

    const lowerSource = sourceText.toLowerCase();
    let startIndex = 0;
    let matchIndex = lowerSource.indexOf(normalizedTerm, startIndex);

    if (matchIndex === -1) {
        targetElement.textContent = sourceText || "-";
        return;
    }

    while (matchIndex !== -1) {
        if (matchIndex > startIndex) {
            targetElement.appendChild(document.createTextNode(sourceText.slice(startIndex, matchIndex)));
        }

        const mark = document.createElement("mark");
        mark.className = "filter-match";
        mark.textContent = sourceText.slice(matchIndex, matchIndex + normalizedTerm.length);
        targetElement.appendChild(mark);

        startIndex = matchIndex + normalizedTerm.length;
        matchIndex = lowerSource.indexOf(normalizedTerm, startIndex);
    }

    if (startIndex < sourceText.length) {
        targetElement.appendChild(document.createTextNode(sourceText.slice(startIndex)));
    }
}

function getFilterStateFromInputs() {
    return {
        projectSearch: normalizeTextValue(elements.projectSearchInput ? elements.projectSearchInput.value : ""),
        projectSort: getProjectSortValue(),
        savedStpSearch: normalizeTextValue(elements.savedStpSearchInput ? elements.savedStpSearchInput.value : ""),
        savedStpType: getSavedStpTypeFilterValue(),
        savedStpSort: getSavedStpSortValue()
    };
}

function saveFilterState() {
    try {
        localStorage.setItem(filterStorageKey, JSON.stringify(getFilterStateFromInputs()));
    } catch (error) {
        console.warn("Could not save filter state.", error);
    }
}

function loadFilterState() {
    const rawFilterState = localStorage.getItem(filterStorageKey);

    if (!rawFilterState) {
        return;
    }

    try {
        const parsed = JSON.parse(rawFilterState);

        if (elements.projectSearchInput) {
            elements.projectSearchInput.value = normalizeTextValue(parsed.projectSearch);
        }

        if (elements.savedStpSearchInput) {
            elements.savedStpSearchInput.value = normalizeTextValue(parsed.savedStpSearch);
        }

        if (elements.savedStpTypeFilter) {
            const savedType = normalizeSearchToken(parsed.savedStpType || "all");
            elements.savedStpTypeFilter.value = ["all", "base", "supplemental", "unit-id"].includes(savedType)
                ? savedType
                : "all";
        }

        if (elements.projectSortSelect) {
            const projectSort = normalizeSearchToken(parsed.projectSort || "newest");
            elements.projectSortSelect.value = ["newest", "oldest", "az"].includes(projectSort)
                ? projectSort
                : "newest";
        }

        if (elements.savedStpSortSelect) {
            const savedStpSort = normalizeSearchToken(parsed.savedStpSort || "newest");
            elements.savedStpSortSelect.value = ["newest", "oldest", "az"].includes(savedStpSort)
                ? savedStpSort
                : "newest";
        }
    } catch (error) {
        console.warn("Could not load filter state.", error);
    }
}

function loadContrastMode() {
    let mode = "off";

    try {
        const stored = localStorage.getItem(contrastModeStorageKey);
        if (stored === "light" || stored === "dark") {
            mode = stored;
        } else if (stored === "on") {
            mode = "light"; // backwards compat with old persisted value
        }
    } catch (error) {
        console.warn("Could not load contrast mode preference.", error);
    }

    applyContrastMode(mode, false);
}

function handleContrastToggle() {
    const current = document.body.classList.contains("dark-contrast") ? "dark"
        : document.body.classList.contains("high-contrast") ? "light" : "off";
    const next = current === "off" ? "light" : current === "light" ? "dark" : "off";
    applyContrastMode(next, true);
}

function applyContrastMode(mode, shouldPersist) {
    document.body.classList.toggle("high-contrast", mode === "light");
    document.body.classList.toggle("dark-contrast", mode === "dark");

    if (elements.highContrastToggle) {
        const toggleLabel = mode === "light" ? "Contrast: Light" : mode === "dark" ? "Contrast: Dark" : "Contrast: Off";
        elements.highContrastToggle.textContent = toggleLabel;
        elements.highContrastToggle.setAttribute("aria-pressed", mode !== "off" ? "true" : "false");
        elements.highContrastToggle.setAttribute("aria-label", toggleLabel);
    }

    if (!shouldPersist) {
        return;
    }

    try {
        localStorage.setItem(contrastModeStorageKey, mode);
    } catch (error) {
        console.warn("Could not save contrast mode preference.", error);
    }
}

function normalizeImportQualityMode(mode) {
    return normalizeSearchToken(mode) === "balanced" ? "balanced" : "sharp";
}

function getImportQualityModeLabel(mode) {
    return normalizeImportQualityMode(mode) === "balanced" ? "Balanced" : "Sharp";
}

function loadImportQualityMode() {
    let savedMode = "sharp";

    try {
        savedMode = normalizeImportQualityMode(localStorage.getItem(importQualityModeStorageKey));
    } catch (error) {
        console.warn("Could not load import quality preference.", error);
    }

    applyImportQualityMode(savedMode, false);
}

function handleImportQualityToggle() {
    const nextMode = importQualityMode === "sharp" ? "balanced" : "sharp";
    applyImportQualityMode(nextMode, true);
}

function applyImportQualityMode(mode, shouldPersist) {
    importQualityMode = normalizeImportQualityMode(mode);

    if (elements.importQualityToggle) {
        const isSharpMode = importQualityMode === "sharp";
        const modeLabel = getImportQualityModeLabel(importQualityMode);
        const buttonLabel = "Import Quality: " + modeLabel;
        elements.importQualityToggle.textContent = buttonLabel;
        elements.importQualityToggle.setAttribute("aria-pressed", isSharpMode ? "true" : "false");
        elements.importQualityToggle.setAttribute(
            "aria-label",
            buttonLabel + (isSharpMode ? ". Prioritizes detail." : ". Prioritizes smaller file size.")
        );
    }

    if (!shouldPersist) {
        return;
    }

    try {
        localStorage.setItem(importQualityModeStorageKey, importQualityMode);
    } catch (error) {
        console.warn("Could not save import quality preference.", error);
    }
}

function collectFlowSteps() {
    const steps = [];
    const seenStepIds = new Set();

    Array.from(document.querySelectorAll("[data-flow-step]")).forEach(function (element) {
        const stepId = normalizeSearchToken(element.getAttribute("data-flow-step"));

        if (!stepId || seenStepIds.has(stepId)) {
            return;
        }

        const explicitLabel = normalizeTextValue(element.getAttribute("data-flow-label"));
        const heading = element.querySelector("h2, h3");
        const headingLabel = normalizeTextValue(heading && heading.textContent);

        seenStepIds.add(stepId);
        steps.push({
            id: stepId,
            label: explicitLabel || headingLabel || stepId
        });
    });

    return steps;
}

function getFlowStepElementsById(stepId) {
    if (!stepId) {
        return [];
    }

    return Array.from(document.querySelectorAll('[data-flow-step="' + stepId + '"]'));
}

function getAvailableFlowSteps() {
    return flowSteps.filter(function (step) {
        return getFlowStepElementsById(step.id).some(function (element) {
            return !element.hidden && !element.classList.contains("field-mode-hidden");
        });
    });
}

function getFlowStepLabel(stepId) {
    const matchingStep = flowSteps.find(function (step) {
        return step.id === stepId;
    });

    return matchingStep ? matchingStep.label : stepId;
}

function loadFlowResumeState() {
    try {
        const rawValue = localStorage.getItem(flowResumeStorageKey);

        if (!rawValue) {
            return {
                stepId: "",
                focusToken: ""
            };
        }

        const parsed = JSON.parse(rawValue);
        const parsedStepId = normalizeSearchToken(parsed && parsed.stepId);
        const parsedFocusToken = normalizeTextValue(parsed && parsed.focusToken);

        return {
            stepId: parsedStepId,
            focusToken: parsedFocusToken
        };
    } catch (error) {
        console.warn("Could not load flow resume state.", error);
        return {
            stepId: "",
            focusToken: ""
        };
    }
}

function persistFlowResumeState() {
    try {
        localStorage.setItem(flowResumeStorageKey, JSON.stringify({
            stepId: activeFlowStepId,
            focusToken: flowFocusToken,
            savedAt: new Date().toISOString()
        }));
    } catch (error) {
        console.warn("Could not save flow resume state.", error);
    }
}

function clearFlowResumeState() {
    flowFocusToken = "";

    try {
        localStorage.removeItem(flowResumeStorageKey);
    } catch (error) {
        console.warn("Could not clear flow resume state.", error);
    }
}

function getFlowFocusTokenFromElement(targetElement) {
    if (!(targetElement instanceof HTMLElement)) {
        return "";
    }

    const inputElement = targetElement.closest("input, select, textarea");

    if (!inputElement || !inputElement.closest("[data-flow-step]")) {
        return "";
    }

    if (inputElement.id) {
        return "id:" + inputElement.id;
    }

    const dataField = normalizeTextValue(inputElement.getAttribute("data-field"));

    if (dataField) {
        const card = inputElement.closest(".stratum-card");

        if (card && elements.strataList) {
            const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));
            const cardIndex = cards.indexOf(card);

            if (cardIndex >= 0) {
                return "strata:" + String(cardIndex) + ":" + dataField;
            }
        }

        return "field:" + dataField;
    }

    if (inputElement.matches("[data-photo-name-input]")) {
        const card = inputElement.closest(".stratum-card");

        if (!card || !elements.strataList) {
            return "";
        }

        const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));
        const cardIndex = cards.indexOf(card);
        const photoIndex = Number(inputElement.getAttribute("data-photo-index"));

        if (cardIndex >= 0 && Number.isInteger(photoIndex) && photoIndex >= 0) {
            return "photo-name:" + String(cardIndex) + ":" + String(photoIndex);
        }
    }

    return "";
}

function findFocusableElementFromFlowToken(token) {
    const normalizedToken = normalizeTextValue(token);

    if (!normalizedToken) {
        return null;
    }

    if (normalizedToken.indexOf("id:") === 0) {
        const targetId = normalizeTextValue(normalizedToken.slice(3));
        return targetId ? document.getElementById(targetId) : null;
    }

    if (normalizedToken.indexOf("field:") === 0) {
        const fieldName = normalizeTextValue(normalizedToken.slice(6));
        return fieldName ? document.querySelector('[data-field="' + fieldName + '"]') : null;
    }

    if (normalizedToken.indexOf("strata:") === 0) {
        const parts = normalizedToken.split(":");

        if (parts.length < 3 || !elements.strataList) {
            return null;
        }

        const cardIndex = Number(parts[1]);
        const fieldName = normalizeTextValue(parts[2]);

        if (!Number.isInteger(cardIndex) || cardIndex < 0 || !fieldName) {
            return null;
        }

        const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));
        const card = cards[Math.min(cardIndex, Math.max(0, cards.length - 1))];

        return card
            ? card.querySelector('[data-field="' + fieldName + '"]')
            : null;
    }

    if (normalizedToken.indexOf("photo-name:") === 0) {
        const parts = normalizedToken.split(":");

        if (parts.length < 3 || !elements.strataList) {
            return null;
        }

        const cardIndex = Number(parts[1]);
        const photoIndex = Number(parts[2]);

        if (!Number.isInteger(cardIndex) || cardIndex < 0 || !Number.isInteger(photoIndex) || photoIndex < 0) {
            return null;
        }

        const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));
        const card = cards[Math.min(cardIndex, Math.max(0, cards.length - 1))];

        if (!card) {
            return null;
        }

        return card.querySelector('[data-photo-name-input][data-photo-index="' + String(photoIndex) + '"]');
    }

    return null;
}

function focusFlowField(field, shouldReportValidity) {
    if (!(field instanceof HTMLElement)) {
        return false;
    }

    if (field.offsetParent === null && !field.closest("dialog[open]")) {
        return false;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const rect = field.getBoundingClientRect();
    const minTopPadding = 72;
    const minBottomPadding = 36;
    const shouldScroll = rect.top < minTopPadding || rect.bottom > viewportHeight - minBottomPadding;

    if (shouldScroll) {
        field.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    if (typeof field.focus === "function") {
        field.focus();
    }

    if (shouldReportValidity && typeof field.reportValidity === "function") {
        field.reportValidity();
    }

    return true;
}

function focusFirstFieldInFlowStep(stepId) {
    const stepElements = getFlowStepElementsById(stepId);

    for (const stepElement of stepElements) {
        const candidate = stepElement.querySelector("input, select, textarea, button");

        if (candidate instanceof HTMLElement && focusFlowField(candidate, false)) {
            return true;
        }
    }

    return false;
}

function restoreFlowFocusFromResumeToken() {
    const resumeField = findFocusableElementFromFlowToken(flowFocusToken);

    if (!resumeField) {
        focusFirstFieldInFlowStep(activeFlowStepId);
        return;
    }

    window.setTimeout(function () {
        if (!focusFlowField(resumeField, false)) {
            focusFirstFieldInFlowStep(activeFlowStepId);
        }
    }, 0);
}

function handleFlowFocusCapture(event) {
    const focusToken = getFlowFocusTokenFromElement(event && event.target);

    if (!focusToken || focusToken === flowFocusToken) {
        return;
    }

    flowFocusToken = focusToken;
    persistFlowResumeState();
}

function getCurrentEntryFlowValidation() {
    if (!elements.stpLabel || !normalizeTextValue(elements.stpLabel.value)) {
        return {
            complete: false,
            message: "Complete STP Data before moving forward. Add the current STP or Unit label.",
            focusField: elements.stpLabel || null
        };
    }

    const entryType = normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value);

    if (entryType === "supplemental" && !normalizeTextValue(elements.parentStp && elements.parentStp.value)) {
        return {
            complete: false,
            message: "Choose a parent base STP before moving forward with a supplemental entry.",
            focusField: elements.parentStp || null
        };
    }

    if (entryType === "unit-id" && !getUnitSizeValueFromForm()) {
        return {
            complete: false,
            message: "Choose or enter a unit size before moving forward.",
            focusField: normalizeTextValue(elements.unitSizePreset && elements.unitSizePreset.value) === "custom"
                ? elements.unitSizeCustom
                : elements.unitSizePreset
        };
    }

    return {
        complete: true,
        message: "",
        focusField: null
    };
}

function getSiteFlowStepValidation() {
    const requiredFields = [
        {
            field: elements.siteName,
            label: "Site Name"
        },
        {
            field: elements.siteLocation,
            label: "Site Location"
        }
    ];

    for (const requiredField of requiredFields) {
        if (!requiredField.field || !normalizeTextValue(requiredField.field.value)) {
            return {
                complete: false,
                message: "Complete Site Details before moving forward. Add " + requiredField.label + ".",
                focusField: requiredField.field || null
            };
        }
    }

    return {
        complete: true,
        message: "",
        focusField: null
    };
}

function getStrataFlowStepValidation() {
    const entryValidation = getCurrentEntryFlowValidation();

    if (!entryValidation.complete) {
        return entryValidation;
    }

    const cards = getMeaningfulStratumCards();
    const requiredFieldDetails = [
        {
            fieldName: "stratumLabel",
            label: "Stratum Label"
        },
        {
            fieldName: "depth",
            label: "Depth"
        },
        {
            fieldName: "munsell",
            label: "Munsell"
        },
        {
            fieldName: "soilType",
            label: "Soil Type"
        },
        {
            fieldName: "horizon",
            label: "Horizon"
        }
    ];

    if (cards.length === 0) {
        return {
            complete: false,
            message: "Fill at least one stratum before moving forward.",
            focusField: elements.addStratumButton || null
        };
    }

    for (const card of cards) {
        const stratumLabelField = card.querySelector('[data-field="stratumLabel"]');
        const stratumLabel = normalizeTextValue(stratumLabelField && stratumLabelField.value) || "(current stratum)";

        for (const requiredFieldDetail of requiredFieldDetails) {
            const field = card.querySelector('[data-field="' + requiredFieldDetail.fieldName + '"]');

            if (!field || !normalizeTextValue(field.value)) {
                return {
                    complete: false,
                    message: "Complete Stratum "
                        + stratumLabel
                        + " before moving forward. Fill "
                        + requiredFieldDetail.label
                        + ".",
                    focusField: field || stratumLabelField || null
                };
            }

            if (["depth", "munsell", "soilType", "horizon"].includes(requiredFieldDetail.fieldName)
                && card.dataset.guidePending === "true"
                && !getGuideConfirmationState(card)[requiredFieldDetail.fieldName]) {
                return {
                    complete: false,
                    message: "Confirm "
                        + requiredFieldDetail.label
                        + " for guided Stratum "
                        + stratumLabel
                        + " before moving forward.",
                    focusField: field
                };
            }

            if (["munsell", "soilType", "horizon"].includes(requiredFieldDetail.fieldName)) {
                const canonicalValue = getCanonicalOptionValue(requiredFieldDetail.fieldName, field.value);

                const optionKey = requiredFieldDetail.fieldName === "soilType"
                    ? "texture"
                    : requiredFieldDetail.fieldName;

                if (!dropdownOptions[optionKey].includes(canonicalValue)) {
                    return {
                        complete: false,
                        message: "Choose a valid "
                            + requiredFieldDetail.label
                            + " from the available selections for Stratum "
                            + stratumLabel
                            + ".",
                        focusField: field
                    };
                }

            }
        }

        const depthField = card.querySelector('[data-field="depth"]');
        const depthValue = normalizeTextValue(depthField && depthField.value);

        if (!depthValue) {
            return {
                complete: false,
                message: "Enter a valid depth value for Stratum " + stratumLabel + " before moving forward.",
                focusField: depthField
            };
        }
    }

    const invalidPhotoCard = findFirstInvalidPhotoCard();

    if (invalidPhotoCard) {
        return {
            complete: false,
            message: "Fix invalid photo names before moving forward.",
            focusField: invalidPhotoCard.querySelector("[data-photo-name-input]")
                || invalidPhotoCard.querySelector('[data-field="photos"]')
                || null
        };
    }

    return {
        complete: true,
        message: "",
        focusField: null
    };
}

function getSavedFlowStepValidation() {
    if (state.stps.length > 0) {
        return {
            complete: true,
            message: "",
            focusField: null
        };
    }

    return {
        complete: false,
        message: "Save at least one STP before moving to Wrap Up.",
        focusField: null
    };
}

function getFlowStepValidation(stepId) {
    const normalizedStepId = normalizeSearchToken(stepId);

    if (normalizedStepId === "site") {
        return getSiteFlowStepValidation();
    }

    if (normalizedStepId === "strata") {
        return getStrataFlowStepValidation();
    }

    if (normalizedStepId === "saved") {
        return getSavedFlowStepValidation();
    }

    if (normalizedStepId === "wrap") {
        return getSavedFlowStepValidation();
    }

    return {
        complete: true,
        message: "",
        focusField: null
    };
}

function buildFlowCompletionState(availableSteps) {
    const completionState = {};

    availableSteps.forEach(function (step) {
        completionState[step.id] = getFlowStepValidation(step.id).complete;
    });

    return completionState;
}

function renderFlowProgressRail(availableSteps, completionState) {
    if (!elements.flowProgressRail) {
        return;
    }

    elements.flowProgressRail.innerHTML = "";
    elements.flowProgressRail.hidden = availableSteps.length === 0;

    availableSteps.forEach(function (step, index) {
        const isActive = step.id === activeFlowStepId;
        const isComplete = Boolean(completionState[step.id]);
        const button = document.createElement("button");
        const dot = document.createElement("span");
        const label = document.createElement("span");

        button.type = "button";
        button.className = "flow-progress-step";
        button.setAttribute("role", "listitem");
        button.setAttribute("data-flow-step-target", step.id);
        button.setAttribute("aria-label", (isComplete ? "Completed" : "Incomplete") + " step: " + step.label);

        if (isActive) {
            button.classList.add("is-active");
            button.setAttribute("aria-current", "step");
        }

        if (isComplete) {
            button.classList.add("is-complete");
        }

        dot.className = "flow-progress-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.textContent = isComplete ? "\u2713" : String(index + 1);

        label.className = "flow-progress-label";
        label.textContent = step.label;

        button.appendChild(dot);
        button.appendChild(label);
        elements.flowProgressRail.appendChild(button);
    });
}

function getForwardFlowValidationBlock(availableSteps, targetStepId) {
    const normalizedTargetStepId = normalizeSearchToken(targetStepId);
    const currentIndexRaw = availableSteps.findIndex(function (step) {
        return step.id === activeFlowStepId;
    });
    const targetIndex = availableSteps.findIndex(function (step) {
        return step.id === normalizedTargetStepId;
    });
    const currentIndex = currentIndexRaw >= 0 ? currentIndexRaw : 0;

    if (targetIndex <= currentIndex) {
        return null;
    }

    for (let index = currentIndex; index < targetIndex; index += 1) {
        const step = availableSteps[index];
        const validation = getFlowStepValidation(step.id);

        if (!validation.complete) {
            return {
                step: step,
                validation: validation
            };
        }
    }

    return null;
}

function attemptFlowStepNavigation(stepId, shouldScroll) {
    const normalizedStepId = normalizeSearchToken(stepId);

    if (!normalizedStepId) {
        return false;
    }

    const availableSteps = getAvailableFlowSteps();
    const targetStep = availableSteps.find(function (step) {
        return step.id === normalizedStepId;
    });

    if (!targetStep) {
        return false;
    }

    const block = getForwardFlowValidationBlock(availableSteps, normalizedStepId);

    if (block) {
        flowValidationMessage = block.validation.message
            || ("Complete " + block.step.label + " before moving forward.");

        if (activeFlowStepId !== block.step.id) {
            setActiveFlowStep(block.step.id, true);
        } else {
            syncFlowNavigatorState(false);
        }

        focusFlowField(block.validation.focusField, true);
        return false;
    }

    flowValidationMessage = "";
    setActiveFlowStep(normalizedStepId, shouldScroll);
    return true;
}

function updateFieldModeToggleButton() {
    if (!elements.fieldModeToggleButton) {
        return;
    }

    const buttonLabel = fieldModeEnabled ? "Field Mode: On" : "Field Mode: Off";
    elements.fieldModeToggleButton.textContent = buttonLabel;
    elements.fieldModeToggleButton.setAttribute("aria-pressed", fieldModeEnabled ? "true" : "false");
    elements.fieldModeToggleButton.setAttribute("aria-label", buttonLabel);
}

function applyFieldModeSectionVisibility() {
    Array.from(document.querySelectorAll("[data-field-mode-hide]")).forEach(function (element) {
        element.classList.toggle("field-mode-hidden", fieldModeEnabled);
    });
}

function applyFlowStepVisibility() {
    Array.from(document.querySelectorAll("[data-flow-step]")).forEach(function (element) {
        const stepId = normalizeSearchToken(element.getAttribute("data-flow-step"));
        const shouldHide = flowModeEnabled && Boolean(activeFlowStepId) && stepId !== activeFlowStepId;

        element.classList.toggle("flow-step-hidden", shouldHide);
        element.classList.toggle("flow-step-active", !shouldHide && stepId === activeFlowStepId);
    });
}

function focusFlowStepElement() {
    if (!activeFlowStepId) {
        return;
    }

    const targetElement = getFlowStepElementsById(activeFlowStepId).find(function (element) {
        return !element.hidden;
    });

    if (!targetElement) {
        return;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const rect = targetElement.getBoundingClientRect();
    const minTopPadding = 72;
    const minBottomPadding = 36;
    const shouldScroll = rect.top < minTopPadding || rect.bottom > viewportHeight - minBottomPadding;

    if (shouldScroll) {
        targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function syncFlowNavigatorState(shouldScrollToActiveStep) {
    if (!elements.flowStepSelect || !elements.flowStepStatus) {
        return;
    }

    if (flowSteps.length === 0) {
        flowSteps = collectFlowSteps();
    }

    const availableSteps = getAvailableFlowSteps();

    if (availableSteps.length === 0) {
        elements.flowStepSelect.innerHTML = "";
        elements.flowStepSelect.disabled = true;
        if (elements.flowPrevButton) {
            elements.flowPrevButton.disabled = true;
        }
        if (elements.flowNextButton) {
            elements.flowNextButton.disabled = true;
        }
        elements.flowStepStatus.textContent = "No workflow sections are available.";
        updateFieldModeToggleButton();
        applyFlowStepVisibility();
        return;
    }

    if (!availableSteps.some(function (step) {
        return step.id === activeFlowStepId;
    })) {
        activeFlowStepId = availableSteps[0].id;
    }

    elements.flowStepSelect.innerHTML = "";
    availableSteps.forEach(function (step) {
        const option = document.createElement("option");
        option.value = step.id;
        option.textContent = step.label;
        elements.flowStepSelect.appendChild(option);
    });

    elements.flowStepSelect.value = activeFlowStepId;
    elements.flowStepSelect.disabled = availableSteps.length <= 1;

    const currentIndex = availableSteps.findIndex(function (step) {
        return step.id === activeFlowStepId;
    });

    if (elements.flowPrevButton) {
        elements.flowPrevButton.disabled = currentIndex <= 0;
    }

    if (elements.flowNextButton) {
        elements.flowNextButton.disabled = currentIndex >= availableSteps.length - 1;
    }

    const modeText = "Page view on.";
    const fieldModeText = fieldModeEnabled ? "Field mode on." : "Field mode off.";
    const completionState = buildFlowCompletionState(availableSteps);
    renderFlowProgressRail(availableSteps, completionState);

    const baseStatusText = "Step "
        + String(currentIndex + 1)
        + " of "
        + String(availableSteps.length)
        + ": "
        + getFlowStepLabel(activeFlowStepId)
        + ". "
        + modeText
        + " "
        + fieldModeText;
    elements.flowStepStatus.textContent = flowValidationMessage
        ? flowValidationMessage
        : baseStatusText;
    elements.flowStepStatus.classList.toggle("is-warning", Boolean(flowValidationMessage));

    updateFieldModeToggleButton();
    applyFlowStepVisibility();
    if (shouldScrollToActiveStep) {
        focusFlowStepElement();
    }
}

function setActiveFlowStep(stepId, shouldScroll) {
    const normalizedStepId = normalizeSearchToken(stepId);

    if (!normalizedStepId) {
        return;
    }

    activeFlowStepId = normalizedStepId;
    persistFlowResumeState();
    syncFlowNavigatorState(Boolean(shouldScroll));
}

function initializeFlowNavigator() {
    if (!elements.flowStepSelect || !elements.flowStepStatus) {
        return;
    }

    flowSteps = collectFlowSteps();

    if (flowSteps.length === 0) {
        return;
    }

    let storedFieldMode = "on";

    try {
        storedFieldMode = normalizeSearchToken(localStorage.getItem(fieldModeStorageKey) || "on");
    } catch (error) {
        console.warn("Could not load field mode preference.", error);
    }

    fieldModeEnabled = storedFieldMode !== "off";
    applyFieldModeSectionVisibility();

    const resume = loadFlowResumeState();
    const candidateStepId = resume.stepId;
    const candidateStepExists = candidateStepId
        && flowSteps.some(function (step) {
            return step.id === candidateStepId;
        });

    if (candidateStepExists) {
        activeFlowStepId = candidateStepId;
        flowFocusToken = resume.focusToken;
    } else {
        activeFlowStepId = fieldModeEnabled ? "site" : flowSteps[0].id;
        flowFocusToken = "";
    }

    syncFlowNavigatorState(false);

    if (candidateStepExists && flowFocusToken) {
        restoreFlowFocusFromResumeToken();
    }
}

function handleFlowStepSelectionChange() {
    if (!elements.flowStepSelect) {
        return;
    }

    const targetStepId = normalizeSearchToken(elements.flowStepSelect.value);

    if (targetStepId === "saved" || targetStepId === "wrap") {
        flowValidationMessage = "";
        setActiveFlowStep(targetStepId, true);
        return;
    }

    attemptFlowStepNavigation(targetStepId, true);
}

function handleFlowStepPrevious() {
    const availableSteps = getAvailableFlowSteps();

    if (availableSteps.length === 0) {
        return;
    }

    const currentIndex = availableSteps.findIndex(function (step) {
        return step.id === activeFlowStepId;
    });

    if (currentIndex <= 0) {
        return;
    }

    flowValidationMessage = "";
    setActiveFlowStep(availableSteps[currentIndex - 1].id, true);
}

function handleFlowStepNext() {
    const availableSteps = getAvailableFlowSteps();

    if (availableSteps.length === 0) {
        return;
    }

    const currentIndex = availableSteps.findIndex(function (step) {
        return step.id === activeFlowStepId;
    });

    if (currentIndex < 0 || currentIndex >= availableSteps.length - 1) {
        return;
    }

    const nextStepId = availableSteps[currentIndex + 1].id;
    const movingFromStrataToReview = activeFlowStepId === "strata"
        && (nextStepId === "saved" || nextStepId === "wrap");

    if (movingFromStrataToReview && getMeaningfulStratumCards().length === 0) {
        flowValidationMessage = "";
        setActiveFlowStep(nextStepId, true);
        return;
    }

    attemptFlowStepNavigation(nextStepId, true);
}

function handleFlowProgressRailClick(event) {
    const button = event.target.closest("[data-flow-step-target]");

    if (!button) {
        return;
    }

    const targetStepId = normalizeSearchToken(button.getAttribute("data-flow-step-target"));

    if (targetStepId === "saved" || targetStepId === "wrap") {
        flowValidationMessage = "";
        setActiveFlowStep(targetStepId, true);
        return;
    }

    attemptFlowStepNavigation(targetStepId, true);
}

function handleFlowActionClick(event) {
    const button = event.target.closest("[data-flow-step-target]");

    if (!button || elements.flowProgressRail && elements.flowProgressRail.contains(button)) {
        return;
    }

    const targetStepId = normalizeSearchToken(button.getAttribute("data-flow-step-target"));

    if (!targetStepId) {
        return;
    }

    if (targetStepId === "saved" || targetStepId === "wrap") {
        flowValidationMessage = "";
        setActiveFlowStep(targetStepId, true);
        return;
    }

    attemptFlowStepNavigation(targetStepId, true);
}

function applyFieldMode(enabled, shouldPersist, shouldScrollToDefaultStep) {
    fieldModeEnabled = Boolean(enabled);

    if (shouldPersist) {
        try {
            localStorage.setItem(fieldModeStorageKey, fieldModeEnabled ? "on" : "off");
        } catch (error) {
            console.warn("Could not save field mode preference.", error);
        }
    }

    applyFieldModeSectionVisibility();

    if (fieldModeEnabled) {
        activeFlowStepId = "site";
    }

    flowValidationMessage = "";
    syncFlowNavigatorState(Boolean(shouldScrollToDefaultStep));
}

function handleFieldModeToggle() {
    applyFieldMode(!fieldModeEnabled, true, true);
}

function updateProjectFilterSummary(totalCount, matchedCount, searchTerm, sortValue) {
    const hasSearch = Boolean(searchTerm);
    const hasCustomSort = sortValue !== "newest";
    const hasFilters = hasSearch || hasCustomSort;

    if (elements.projectsFilterSummary) {
        if (totalCount === 0) {
            elements.projectsFilterSummary.textContent = "Showing 0 of 0 projects.";
        } else if (hasFilters) {
            const sortSuffix = hasCustomSort ? (" | Sort: " + getSortLabel(sortValue)) : "";
            elements.projectsFilterSummary.textContent = "Showing " + matchedCount + " of " + totalCount + " projects" + sortSuffix + ".";
        } else {
            elements.projectsFilterSummary.textContent = "Showing all " + totalCount + " projects.";
        }
    }

    if (elements.clearProjectFiltersButton) {
        elements.clearProjectFiltersButton.hidden = !hasFilters;
    }
}

function updateSavedStpFilterSummary(totalCount, matchedCount, searchTerm, typeFilter, sortValue) {
    const hasCustomSort = sortValue !== "newest";
    const hasFilters = Boolean(searchTerm) || typeFilter !== "all" || hasCustomSort;

    if (elements.savedStpFilterSummary) {
        if (totalCount === 0) {
            elements.savedStpFilterSummary.textContent = "Showing 0 of 0 STPs.";
        } else if (hasFilters) {
            const typeSuffix = typeFilter !== "all" ? (" | Type: " + getEntryTypeLabel(typeFilter)) : "";
            const sortSuffix = hasCustomSort ? (" | Sort: " + getSortLabel(sortValue)) : "";
            elements.savedStpFilterSummary.textContent = "Showing " + matchedCount + " of " + totalCount + " STPs" + typeSuffix + sortSuffix + ".";
        } else {
            elements.savedStpFilterSummary.textContent = "Showing all " + totalCount + " STPs.";
        }
    }

    if (elements.clearSavedStpFiltersButton) {
        elements.clearSavedStpFiltersButton.hidden = !hasFilters;
    }
}

function handleProjectFilterInput() {
    saveFilterState();
    renderProjects();
}

function handleSavedStpFilterInput() {
    saveFilterState();
    renderSavedStps();
}

function clearProjectFilters() {
    elements.projectSearchInput.value = "";
    elements.projectSortSelect.value = "newest";
    saveFilterState();
    renderProjects();
}

function clearSavedStpFilters() {
    elements.savedStpSearchInput.value = "";
    elements.savedStpTypeFilter.value = "all";
    elements.savedStpSortSelect.value = "newest";
    saveFilterState();
    renderSavedStps();
}

function buildSearchHaystack(values) {
    return values.map(function (value) {
        return normalizeTextValue(value);
    }).join(" ").toLowerCase();
}

function getProjectSearchTerm() {
    return normalizeSearchToken(elements.projectSearchInput ? elements.projectSearchInput.value : "");
}

function getSavedStpSearchTerm() {
    return normalizeSearchToken(elements.savedStpSearchInput ? elements.savedStpSearchInput.value : "");
}

function getSavedStpTypeFilterValue() {
    const typeValue = normalizeSearchToken(elements.savedStpTypeFilter ? elements.savedStpTypeFilter.value : "all");
    return typeValue || "all";
}

function getProjectSortValue() {
    const sortValue = normalizeSearchToken(elements.projectSortSelect ? elements.projectSortSelect.value : "newest");
    return ["newest", "oldest", "az"].includes(sortValue) ? sortValue : "newest";
}

function getSavedStpSortValue() {
    const sortValue = normalizeSearchToken(elements.savedStpSortSelect ? elements.savedStpSortSelect.value : "newest");
    return ["newest", "oldest", "az"].includes(sortValue) ? sortValue : "newest";
}

function getSortLabel(sortValue) {
    if (sortValue === "oldest") {
        return "Oldest";
    }

    if (sortValue === "az") {
        return "A-Z";
    }

    return "Newest";
}

function getSavedTimestampValue(record) {
    const timestamp = Date.parse(normalizeTextValue(record && record.savedAt));
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortProjectsByValue(projects, sortValue) {
    const safeProjects = Array.isArray(projects) ? projects.slice() : [];

    if (sortValue === "oldest") {
        safeProjects.sort(function (a, b) {
            return getSavedTimestampValue(a) - getSavedTimestampValue(b);
        });
        return safeProjects;
    }

    if (sortValue === "az") {
        safeProjects.sort(function (a, b) {
            return normalizeTextValue(a.name).localeCompare(normalizeTextValue(b.name), undefined, { sensitivity: "base" });
        });
        return safeProjects;
    }

    safeProjects.sort(function (a, b) {
        return getSavedTimestampValue(b) - getSavedTimestampValue(a);
    });
    return safeProjects;
}

function sortSavedStpsByValue(stps, sortValue) {
    const safeStps = Array.isArray(stps) ? stps.slice() : [];

    if (sortValue === "oldest") {
        safeStps.sort(function (a, b) {
            return getSavedTimestampValue(a) - getSavedTimestampValue(b);
        });
        return safeStps;
    }

    if (sortValue === "az") {
        safeStps.sort(function (a, b) {
            return normalizeTextValue(a.stpLabel).localeCompare(normalizeTextValue(b.stpLabel), undefined, { sensitivity: "base" });
        });
        return safeStps;
    }

    safeStps.sort(function (a, b) {
        return getSavedTimestampValue(b) - getSavedTimestampValue(a);
    });
    return safeStps;
}

function updateHeaderCount(element, totalCount, matchedCount) {
    if (!element) {
        return;
    }

    if (totalCount === 0) {
        element.textContent = "0";
        return;
    }

    if (matchedCount === totalCount) {
        element.textContent = String(totalCount);
        return;
    }

    element.textContent = matchedCount + "/" + totalCount;
}

function handleFilterSearchKeydown(event) {
    if (event.key !== "Escape") {
        return;
    }

    const target = event.target;

    if (!target || target.tagName !== "INPUT") {
        return;
    }

    if (!target.value) {
        return;
    }

    event.preventDefault();
    target.value = "";

    if (target === elements.projectSearchInput) {
        handleProjectFilterInput();
        return;
    }

    if (target === elements.savedStpSearchInput) {
        handleSavedStpFilterInput();
    }
}

function matchesProjectFilters(project, searchTerm) {
    if (!searchTerm) {
        return true;
    }

    const projectHaystack = buildSearchHaystack([
        project.name,
        project.siteName,
        project.siteLocation,
        project.savedAt
    ]);

    return projectHaystack.includes(searchTerm);
}

function matchesSavedStpFilters(stp, searchTerm, typeFilter) {
    const normalizedType = normalizeEntryTypeValue(stp.entryType || "base");

    if (typeFilter !== "all" && normalizedType !== typeFilter) {
        return false;
    }

    if (!searchTerm) {
        return true;
    }

    const stpHaystack = buildSearchHaystack([
        stp.stpLabel,
        stp.siteName,
        stp.siteLocation,
        stp.crewMembers,
        stp.unitSize,
        stp.parentStp,
        stp.supDirection,
        normalizedType,
        getEntryTypeLabel(normalizedType)
    ]);

    return stpHaystack.includes(searchTerm);
}

function getEntryTypeLabel(entryType) {
    const normalizedType = normalizeEntryTypeValue(entryType || "base");

    if (normalizedType === "supplemental") {
        return "Supplemental STP";
    }

    if (normalizedType === "unit-id") {
        return "Unit";
    }

    return "Base STP";
}

function getEntryRecordLabel(entryType) {
    return normalizeEntryTypeValue(entryType) === "unit-id" ? "Unit" : "STP";
}

function applyNormalizedSessionToState(normalizedSession) {
    state.siteName = normalizedSession.siteName;
    state.siteLocation = normalizedSession.siteLocation;
    state.crewMembers = normalizeTextValue(normalizedSession.crewMembers);
    state.depthUnit = normalizedSession.depthUnit;
    state.stps = normalizedSession.stps;
    state.projectImage = normalizedSession.projectImage;
    state.referencePhoto = normalizedSession.referencePhoto;
}

function buildCoreDataBackupPayloadFromState(sourceState) {
    const safeStps = (Array.isArray(sourceState.stps) ? sourceState.stps : []).map(function (stp) {
        const strata = (Array.isArray(stp && stp.strata) ? stp.strata : []).map(function (stratum) {
            const photoNames = Array.isArray(stratum && stratum.photoNames)
                ? stratum.photoNames.map(normalizeTextValue).filter(Boolean)
                : [];

            return {
                stratumLabel: normalizeTextValue(stratum && stratum.stratumLabel),
                depth: normalizeTextValue(stratum && stratum.depth),
                munsell: normalizeTextValue(stratum && stratum.munsell),
                soilType: normalizeTextValue(stratum && stratum.soilType),
                horizon: normalizeTextValue(stratum && stratum.horizon),
                artifactCatalog: normalizeTextValue(stratum && stratum.artifactCatalog),
                artifactSummary: normalizeTextValue(stratum && stratum.artifactSummary),
                notes: normalizeTextValue(stratum && stratum.notes),
                photoNames: photoNames,
                photos: []
            };
        });

        return {
            siteName: normalizeTextValue(stp && stp.siteName),
            siteLocation: normalizeTextValue(stp && stp.siteLocation),
            crewMembers: normalizeTextValue((stp && stp.crewMembers) || sourceState.crewMembers),
            depthUnit: normalizeDepthUnitValue(stp && stp.depthUnit),
            stpLabel: normalizeTextValue(stp && stp.stpLabel),
            entryType: normalizeEntryTypeValue(stp && stp.entryType),
            unitSize: normalizeUnitSizeValue(stp && stp.unitSize),
            parentStp: normalizeTextValue(stp && stp.parentStp),
            supDirection: normalizeSupDirectionValue(stp && stp.supDirection),
            gpsLatitude: normalizeTextValue(stp && stp.gpsLatitude),
            gpsLongitude: normalizeTextValue(stp && stp.gpsLongitude),
            savedAt: normalizeTextValue(stp && stp.savedAt) || new Date().toISOString(),
            strata: strata
        };
    });

    return {
        siteName: normalizeTextValue(sourceState.siteName),
        siteLocation: normalizeTextValue(sourceState.siteLocation),
        crewMembers: normalizeTextValue(sourceState.crewMembers),
        depthUnit: normalizeDepthUnitValue(sourceState.depthUnit),
        stps: safeStps,
        projectImage: "",
        referencePhoto: "",
        backupSavedAt: new Date().toISOString(),
        backupMode: "core-data-only"
    };
}

function saveCoreDataBackup() {
    try {
        const coreBackupPayload = buildCoreDataBackupPayloadFromState(state);
        localStorage.setItem(coreDataBackupStorageKey, JSON.stringify(coreBackupPayload));
        return true;
    } catch (error) {
        console.warn("Could not save core data backup.", error);
        return false;
    }
}

function loadCoreDataBackup() {
    const rawBackup = localStorage.getItem(coreDataBackupStorageKey);

    if (!rawBackup) {
        return null;
    }

    try {
        return normalizeImportedSession(JSON.parse(rawBackup));
    } catch (error) {
        console.warn("Could not load core data backup.", error);
        return null;
    }
}

function getDataSafetyAlertMessage(contextText) {
    const prefix = contextText ? contextText + " " : "";

    if (!dataSafetyState.lastFullSessionSaveOk && dataSafetyState.lastCoreBackupSaveOk) {
        return prefix + "Browser storage is full for complete session saves. Core field data backup is protected, but large images may not persist. Download a JSON backup now.";
    }

    if (!dataSafetyState.lastCoreBackupSaveOk) {
        return prefix + "Critical: browser storage could not save session or core backup. Download a JSON backup immediately to avoid data loss.";
    }

    return "";
}

function getCurrentStratumCard() {
    if (!elements.strataList) {
        return null;
    }

    if (lastTouchedStratumCard && elements.strataList.contains(lastTouchedStratumCard)) {
        return lastTouchedStratumCard;
    }

    return elements.strataList.querySelector(".stratum-card");
}

function openStratumPhotoPicker(card, shouldScrollIntoView) {
    if (!card) {
        return false;
    }

    if (elements.strataList && elements.strataList.contains(card)) {
        lastTouchedStratumCard = card;
        updateQuickPhotoControls();
    }

    const cameraInput = card.querySelector('[data-field="cameraPhoto"]');

    if (!cameraInput) {
        return false;
    }

    if (shouldScrollIntoView) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    cameraInput.value = "";

    try {
        if (typeof cameraInput.showPicker === "function") {
            cameraInput.showPicker();
        } else {
            cameraInput.click();
        }
    } catch (_error) {
        cameraInput.click();
    }

    return true;
}

function updateQuickPhotoControls() {
    const currentStratumCard = getCurrentStratumCard();
    const currentStratumField = currentStratumCard
        ? currentStratumCard.querySelector('[data-field="stratumLabel"]')
        : null;
    const currentStratumLabel = normalizeTextValue(currentStratumField && currentStratumField.value);
    const hasCurrentPhotoTarget = Boolean(currentStratumCard && currentStratumCard.querySelector('[data-field="cameraPhoto"]'));
    const hasReferencePhotoTarget = Boolean(elements.referencePhotoInput);
    const currentStratumTitle = hasCurrentPhotoTarget
        ? "Take STP photo for current stratum" + (currentStratumLabel ? " S" + currentStratumLabel : "")
        : "No current stratum available";
    const stratumPhotoCount = currentStratumCard ? getCardPhotoEntries(currentStratumCard).length : 0;
    const hasReferencePhoto = Boolean(state.referencePhoto && state.referencePhoto.length > 0);

    if (elements.activeStpPhotoButton) {
        elements.activeStpPhotoButton.disabled = !hasCurrentPhotoTarget;
        const barLabelText = "STP Photo";
        setButtonLabelWithChip(elements.activeStpPhotoButton, barLabelText, stratumPhotoCount > 0 ? stratumPhotoCount + "" : "");
        elements.activeStpPhotoButton.title = currentStratumTitle;
    }

    if (elements.quickStratumPhotoButton) {
        elements.quickStratumPhotoButton.disabled = !hasCurrentPhotoTarget;
        elements.quickStratumPhotoButton.title = currentStratumTitle;
        setButtonChip(elements.quickStratumPhotoButton, stratumPhotoCount > 0 ? stratumPhotoCount + "" : "");
    }

    if (elements.activeReferencePhotoButton) {
        elements.activeReferencePhotoButton.disabled = !hasReferencePhotoTarget;
        elements.activeReferencePhotoButton.title = hasReferencePhotoTarget
            ? "Choose reference photo"
            : "Reference photo control unavailable";
        setButtonChip(elements.activeReferencePhotoButton, hasReferencePhoto ? "\u2713" : "");
    }

    if (elements.quickReferencePhotoButton) {
        elements.quickReferencePhotoButton.disabled = !hasReferencePhotoTarget;
        elements.quickReferencePhotoButton.title = hasReferencePhotoTarget
            ? "Choose reference photo"
            : "Reference photo control unavailable";
        setButtonChip(elements.quickReferencePhotoButton, hasReferencePhoto ? "\u2713" : "");
    }
}

function setButtonLabelWithChip(button, labelText, chipText) {
    const chip = button.querySelector(".photo-chip");
    if (chip) {
        const textNode = button.childNodes[0];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            textNode.textContent = labelText + " ";
        } else {
            button.insertBefore(document.createTextNode(labelText + " "), chip);
        }
        chip.textContent = chipText;
        chip.hidden = !chipText;
    } else {
        button.textContent = labelText;
    }
}

function setButtonChip(button, chipText) {
    const chip = button.querySelector(".photo-chip");
    if (chip) {
        chip.textContent = chipText;
        chip.hidden = !chipText;
    }
}

function isEditingSavedStp() {
    return Number.isInteger(activeEditStpIndex)
        && activeEditStpIndex >= 0
        && activeEditStpIndex < state.stps.length;
}

function setActiveEditStpIndex(nextIndex) {
    if (Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < state.stps.length) {
        activeEditStpIndex = nextIndex;
    } else {
        activeEditStpIndex = -1;
    }

    updateSaveActionLabels();
    updateActiveStpBar();
}

function updateSaveActionLabels() {
    const saveLabel = isEditingSavedStp() ? "Update STP" : "Save STP";

    if (elements.saveStpButton) {
        elements.saveStpButton.textContent = saveLabel;
    }

    if (elements.topSaveStpButton) {
        elements.topSaveStpButton.textContent = saveLabel;
    }
}

function addStratumFromBarOrAction() {
    if (!elements.strataList) {
        return;
    }

    if (flowSteps.length > 0) {
        setActiveFlowStep("strata", false);
    }

    addStratumCard();

    const newCard = elements.strataList.firstElementChild;

    if (!newCard) {
        return;
    }

    lastTouchedStratumCard = newCard;

    const depthField = newCard.querySelector('[data-field="depth"]');
    const fallbackField = newCard.querySelector('[data-field="stratumLabel"]');

    focusFlowField(depthField || fallbackField, false);
}

function setSaveButtonsDisabled(isDisabled) {
    if (elements.saveStpButton) {
        elements.saveStpButton.disabled = isDisabled;
    }

    if (elements.topSaveStpButton) {
        elements.topSaveStpButton.disabled = isDisabled;
    }
}

function updateActiveStpBar() {
    if (!elements.activeStpLblEl) {
        return;
    }

    const siteName = state.siteName || "";
    const entryRecordLabel = getEntryRecordLabel(elements.stpEntryType && elements.stpEntryType.value);
    const rawLabel = elements.stpLabel ? elements.stpLabel.value.trim() : "";
    const label = rawLabel || (entryRecordLabel === "Unit" ? "New Unit" : "New STP");
    const stratumCount = elements.strataList
        ? elements.strataList.querySelectorAll(".stratum-card").length
        : 0;

    if (elements.activeStpSiteNameEl) {
        elements.activeStpSiteNameEl.textContent = siteName;
        elements.activeStpSiteNameEl.hidden = !siteName;
    }

    if (elements.activeStpSepEl) {
        elements.activeStpSepEl.hidden = !siteName;
    }

    elements.activeStpLblEl.textContent = entryRecordLabel + " " + label;

    if (elements.activeStpStratumCountEl) {
        elements.activeStpStratumCountEl.textContent = stratumCount > 0
            ? "\u00b7 " + stratumCount + (stratumCount === 1 ? " stratum" : " strata")
            : "";
    }

    const saveOk = dataSafetyState.lastFullSessionSaveOk && dataSafetyState.lastCoreBackupSaveOk;
    const isSaving = sessionSavePendingCount > 0;

    if (elements.activeStpSaveIndicator) {
        elements.activeStpSaveIndicator.classList.toggle("is-warning", !saveOk && !isSaving);
        elements.activeStpSaveIndicator.classList.toggle("is-saving", isSaving);
        elements.activeStpSaveIndicator.title = isSaving
            ? "Saving session"
            : (saveOk ? "Session saved" : "Save issue \u2014 check storage status");
    }

    if (elements.activeStpSaveText) {
        elements.activeStpSaveText.classList.toggle("is-saving", isSaving);
        elements.activeStpSaveText.classList.toggle("is-warning", !saveOk && !isSaving);
        elements.activeStpSaveText.textContent = isSaving
            ? "Saving..."
            : (saveOk ? "Saved" : "Save issue");
    }

    updateCurrentStratumContextLabels();
    updateQuickPhotoControls();
}

function updateDataSafetyStatus() {
    if (!elements.dataSafetyStatus) {
        return;
    }

    let statusText = "Data safety: Session and project data saved.";
    let isWarning = false;

    const criticalSessionFailure = !dataSafetyState.lastCoreBackupSaveOk;
    const criticalProjectFailure = !projectStorageState.lastCoreBackupSaveOk;

    if (criticalSessionFailure || criticalProjectFailure) {
        statusText = "Data safety warning: Browser storage could not save critical backups. Export JSON immediately.";
        isWarning = true;
    } else {
        const warningParts = [];

        if (dataSafetyState.loadedFromCoreBackup) {
            warningParts.push("Session recovered from core backup (re-add map/reference images if needed).");
        } else if (!dataSafetyState.lastFullSessionSaveOk) {
            warningParts.push("Session images may not persist because full storage is near capacity.");
        }

        if (projectStorageState.loadedFromCoreBackup) {
            warningParts.push("A project was recovered from emergency core backup (without map/reference images).");
        } else if (!projectStorageState.lastFullProjectsSaveOk) {
            warningParts.push("Projects are using emergency backup mode because full storage is full.");
        }

        if (warningParts.length > 0) {
            statusText = "Data safety warning: " + warningParts.join(" ");
            isWarning = true;
        }
    }

    elements.dataSafetyStatus.textContent = statusText;
    elements.dataSafetyStatus.classList.toggle("is-warning", isWarning);
}

function loadLegacySessionFromLocalStorage() {
    const rawSession = localStorage.getItem(storageKey);

    if (!rawSession) {
        return null;
    }

    try {
        return normalizeImportedSession(JSON.parse(rawSession));
    } catch (error) {
        console.warn("Could not load legacy localStorage session.", error);
        return null;
    }
}

function queueSessionSaveToIndexedDb(sessionSnapshot) {
    if (!supportsIndexedDbPersistence()) {
        return;
    }

    const normalizedSnapshot = normalizeImportedSession(sessionSnapshot);
    sessionSavePendingCount += 1;
    updateActiveStpBar();

    sessionSaveQueue = sessionSaveQueue
        .catch(function () {
            return undefined;
        })
        .then(async function () {
            await writeAppDataValue(appDataSessionEntryKey, normalizedSnapshot);

            try {
                localStorage.removeItem(storageKey);
            } catch (cleanupError) {
                console.warn("Could not clear legacy session key.", cleanupError);
            }

            dataSafetyState.lastFullSessionSaveOk = true;
            dataSafetyState.loadedFromCoreBackup = false;
        })
        .catch(function (error) {
            console.warn("Could not save session to IndexedDB.", error);
            dataSafetyState.lastFullSessionSaveOk = false;
        })
        .finally(function () {
            sessionSavePendingCount = Math.max(0, sessionSavePendingCount - 1);
            updateImageStorageStatus();
            updateDataSafetyStatus();
            updateActiveStpBar();
        });
}

function queueSessionDeleteFromIndexedDb() {
    if (!supportsIndexedDbPersistence()) {
        return;
    }

    sessionSaveQueue = sessionSaveQueue
        .catch(function () {
            return undefined;
        })
        .then(async function () {
            await deleteAppDataValue(appDataSessionEntryKey);
        })
        .catch(function (error) {
            console.warn("Could not clear IndexedDB session.", error);
        });
}

async function loadSession() {
    let loadedFromPrimary = false;
    let loadedFromBackup = false;
    let primaryLoadFailed = false;
    let loadedFromLegacyLocalStorage = false;

    if (supportsIndexedDbPersistence()) {
        try {
            const indexedDbSession = await readAppDataValue(appDataSessionEntryKey);

            if (indexedDbSession && typeof indexedDbSession === "object") {
                applyNormalizedSessionToState(normalizeImportedSession(indexedDbSession));
                loadedFromPrimary = true;
            }
        } catch (error) {
            primaryLoadFailed = true;
            console.warn("Could not load saved session from IndexedDB.", error);
        }
    }

    if (!loadedFromPrimary) {
        const legacySession = loadLegacySessionFromLocalStorage();
        if (legacySession) {
            applyNormalizedSessionToState(legacySession);
            loadedFromPrimary = true;
            loadedFromLegacyLocalStorage = true;
        }
    }

    if (!loadedFromPrimary) {
        const backupSession = loadCoreDataBackup();
        if (backupSession) {
            applyNormalizedSessionToState(backupSession);
            loadedFromBackup = true;
        }
    }

    dataSafetyState.loadedFromCoreBackup = loadedFromBackup;
    if (loadedFromBackup) {
        dataSafetyState.lastFullSessionSaveOk = false;
        dataSafetyState.lastCoreBackupSaveOk = true;
        setProjectImageMessage("Recovered core backup. Re-add map image if needed.", false);
        setReferencePhotoMessage("Recovered core backup. Re-add reference photo if needed.", false);
    } else if (primaryLoadFailed && !loadedFromPrimary) {
        dataSafetyState.lastFullSessionSaveOk = false;
        dataSafetyState.lastCoreBackupSaveOk = false;
    } else {
        dataSafetyState.lastFullSessionSaveOk = true;
        dataSafetyState.lastCoreBackupSaveOk = true;
    }

    if (loadedFromLegacyLocalStorage && supportsIndexedDbPersistence()) {
        queueSessionSaveToIndexedDb(state);
    }

    updateImageStorageStatus();
    updateDataSafetyStatus();
    
    // Load GPS points registry
    try {
        await loadGpsPointsFromDatabase();
    } catch (error) {
        console.warn("Could not load GPS points registry:", error);
    }
}

function saveSession() {
    let fullSaveOk = false;

    if (supportsIndexedDbPersistence()) {
        queueSessionSaveToIndexedDb(state);
        fullSaveOk = true;
    } else {
        sessionSavePendingCount += 1;
        updateActiveStpBar();

        try {
            localStorage.setItem(storageKey, JSON.stringify(normalizeImportedSession(state)));
            fullSaveOk = true;
        } catch (error) {
            console.warn("Could not save session.", error);
        } finally {
            sessionSavePendingCount = Math.max(0, sessionSavePendingCount - 1);
        }
    }

    const coreBackupOk = saveCoreDataBackup();
    dataSafetyState.lastFullSessionSaveOk = fullSaveOk;
    dataSafetyState.lastCoreBackupSaveOk = coreBackupOk || fullSaveOk;

    if (fullSaveOk) {
        dataSafetyState.loadedFromCoreBackup = false;
    }

    updateImageStorageStatus();
    updateDataSafetyStatus();
    updateActiveStpBar();
    return fullSaveOk;
}

function populateSiteFields() {
    const preferredCrewMembers = normalizeTextValue(state.crewMembers) || loadRecentCrewMembers();

    state.crewMembers = preferredCrewMembers;
    elements.siteName.value = state.siteName;
    elements.siteLocation.value = state.siteLocation;
    if (elements.crewMembers) {
        elements.crewMembers.value = preferredCrewMembers;
    }
    elements.depthUnit.value = state.depthUnit;
    persistRecentCrewMembers(preferredCrewMembers);
    applyDepthUnitUi();
}

function updateSiteDraft() {
    state.siteName = elements.siteName.value.trim();
    state.siteLocation = elements.siteLocation.value.trim();
    state.crewMembers = elements.crewMembers ? elements.crewMembers.value.trim() : "";
    state.depthUnit = elements.depthUnit.value;
    persistRecentCrewMembers(state.crewMembers);
    applyDepthUnitUi();
    refreshPhotoRulesAll();
    saveSession();
    updateActiveStpBar();
    syncFlowNavigatorState(false);
}

function getSavedStpDisplayLabel(stp) {
    const baseLabel = normalizeTextValue(stp && stp.stpLabel);
    const entryType = normalizeEntryTypeValue(stp && stp.entryType);
    const supDirection = normalizeSupDirectionValue(stp && stp.supDirection);

    if (entryType === "supplemental" && baseLabel && supDirection) {
        return baseLabel + supDirection;
    }

    return baseLabel || "Recent STP";
}

function getStratumNumberValue(value) {
    const parsed = Number(normalizeTextValue(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getCanonicalOptionValue(fieldName, value) {
    const normalizedValue = normalizeTextValue(value);
    const optionKey = fieldName === "soilType" ? "texture" : fieldName;
    const options = dropdownOptions[optionKey];

    if (!normalizedValue || !Array.isArray(options)) {
        return normalizedValue;
    }

    const matchingOption = options.find(function (option) {
        return normalizeTextValue(option).toLowerCase() === normalizedValue.toLowerCase();
    });

    return matchingOption || normalizedValue;
}

function normalizeStratumOptionField(field) {
    if (!field) {
        return "";
    }

    const fieldName = field.getAttribute("data-field");
    const canonicalValue = getCanonicalOptionValue(fieldName, field.value);

    if (field.value !== canonicalValue) {
        field.value = canonicalValue;
    }

    return canonicalValue;
}

function getGuideConfirmationState(card) {
    try {
        const parsed = JSON.parse(card && card.dataset.guideConfirmation || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        return {};
    }
}

function setGuideConfirmationState(card, state) {
    if (card) {
        card.dataset.guideConfirmation = JSON.stringify(state || {});
    }
}

function markGuideFieldConfirmed(card, field) {
    if (!card || !field || !card.dataset.guidePending) {
        return;
    }

    const confirmationState = getGuideConfirmationState(card);
    confirmationState[field.getAttribute("data-field")] = true;
    setGuideConfirmationState(card, confirmationState);
}

function getLastSavedStpSuggestionEntries(card) {
    const lastStp = state.stps.length > 0 ? state.stps[state.stps.length - 1] : null;

    if (!lastStp || !Array.isArray(lastStp.strata) || lastStp.strata.length === 0 || !card) {
        return [];
    }

    const stratumField = card.querySelector('[data-field="stratumLabel"]');
    const currentStratumNumber = getStratumNumberValue(stratumField && stratumField.value) || 1;
    const strataByNumber = new Map();

    lastStp.strata.forEach(function (stratum) {
        const stratumNumber = getStratumNumberValue(stratum && stratum.stratumLabel);

        if (stratumNumber != null && !strataByNumber.has(stratumNumber)) {
            strataByNumber.set(stratumNumber, stratum);
        }
    });

    return [-1, 0, 1].map(function (offset) {
        const targetNumber = currentStratumNumber + offset;

        if (targetNumber < 1) {
            return null;
        }

        const matchedStratum = strataByNumber.get(targetNumber);

        if (!matchedStratum) {
            return null;
        }

        return {
            offset: offset,
            targetNumber: targetNumber,
            stratum: matchedStratum,
            lastStp: lastStp
        };
    }).filter(Boolean);
}

function renderStratumSuggestions(card) {
    if (!card) {
        return;
    }

    const suggestionPanel = card.querySelector("[data-last-stp-suggestions]");
    const suggestionCopy = card.querySelector("[data-last-stp-suggestions-copy]");
    const suggestionList = card.querySelector("[data-last-stp-suggestion-list]");

    if (!suggestionPanel || !suggestionCopy || !suggestionList) {
        return;
    }

    const suggestions = getLastSavedStpSuggestionEntries(card);

    suggestionList.innerHTML = "";

    if (suggestions.length === 0) {
        suggestionCopy.textContent = "";
        suggestionPanel.hidden = true;
        return;
    }

    suggestionCopy.textContent = "Guide from last STP "
        + getSavedStpDisplayLabel(suggestions[0].lastStp)
        + ". Confirm each guided field before moving to the next stratum.";

    suggestions.forEach(function (entry) {
        const button = document.createElement("button");
        const summaryParts = [
            normalizeTextValue(entry.stratum.depth),
            normalizeTextValue(entry.stratum.munsell),
            normalizeTextValue(entry.stratum.soilType),
            normalizeTextValue(entry.stratum.horizon)
        ].filter(Boolean);
        const positionLabel = entry.offset === 0
            ? "Match"
            : (entry.offset < 0 ? "Above" : "Below");

        button.type = "button";
        button.className = "stratum-suggestion-button" + (entry.offset === 0 ? " is-match" : "");
        button.setAttribute("data-apply-last-stp-suggestion", String(entry.targetNumber));
        button.textContent = positionLabel + " · Stratum " + entry.targetNumber
            + (summaryParts.length > 0 ? " · " + summaryParts.join(" · ") : "");
        suggestionList.appendChild(button);
    });

    suggestionPanel.hidden = false;
}

function refreshStratumSuggestionsAll() {
    if (!elements.strataList) {
        return;
    }

    elements.strataList.querySelectorAll(".stratum-card").forEach(function (card) {
        renderStratumSuggestions(card);
    });
}

function applyLastStpSuggestion(card, suggestionNumber) {
    if (!card) {
        return;
    }

    const targetNumber = Number(suggestionNumber);

    if (!Number.isFinite(targetNumber)) {
        return;
    }

    const matchedEntry = getLastSavedStpSuggestionEntries(card).find(function (entry) {
        return entry.targetNumber === targetNumber;
    });

    if (!matchedEntry) {
        return;
    }

    ["depth", "munsell", "soilType", "horizon"].forEach(function (fieldName) {
        const field = card.querySelector('[data-field="' + fieldName + '"]');

        if (field) {
            field.value = fieldName === "depth"
                ? normalizeTextValue(matchedEntry.stratum[fieldName])
                : getCanonicalOptionValue(fieldName, matchedEntry.stratum[fieldName]);
        }
    });

    card.dataset.guidePending = "true";
    setGuideConfirmationState(card, {});

    const depthField = card.querySelector('[data-field="depth"]');

    if (depthField) {
        setDepthFieldValidity(depthField);
    }
}

function addStratumCard(defaults) {
    const template = elements.stratumTemplate.content.cloneNode(true);
    const card = template.querySelector(".stratum-card");

    elements.strataList.prepend(card);

    const newCard = elements.strataList.firstElementChild;
    const fields = newCard.querySelectorAll("[data-field]");

    fields.forEach(function (field) {
        const fieldName = field.getAttribute("data-field");

        if (field.type === "file" || fieldName === "photoRule") {
            return;
        }

        if (defaults && Object.prototype.hasOwnProperty.call(defaults, fieldName)) {
            field.value = defaults[fieldName];
        }
    });

    if (defaults && Array.isArray(defaults.photos)) {
        setCardPhotoEntries(newCard, defaults.photos);
    } else if (defaults && Array.isArray(defaults.photoNames)) {
        setCardPhotoNames(newCard, defaults.photoNames);
    } else {
        setCardPhotoEntries(newCard, []);
    }

    renumberStrata();
    applyDepthUnitUi();
    updatePhotoRuleForCard(newCard);
    updateCurrentStratumContextLabels();
    refreshStratumSuggestionsAll();
    updateActiveStpBar();
}

function renumberStrata() {
    const cards = elements.strataList.querySelectorAll(".stratum-card");

    cards.forEach(function (card, index) {
        const rowNumber = cards.length - index;
        const rowLabel = card.querySelector("[data-row-number]");
        const stratumField = card.querySelector('[data-field="stratumLabel"]');

        if (rowLabel) {
            rowLabel.textContent = rowNumber;
        }

        if (stratumField) {
            stratumField.value = rowNumber;
        }
    });

    refreshPhotoRulesAll();
    updateCurrentStratumContextLabels();
}

function handleStrataListClick(event) {
    const clickedCard = event.target.closest(".stratum-card");

    if (clickedCard) {
        lastTouchedStratumCard = clickedCard;
        updateQuickPhotoControls();
    }

    if (event.target.closest("[data-mark-gps]")) {
        markCurrentGpsPointAndContinue();
        return;
    }

    const cameraButton = event.target.closest("[data-photo-capture]");

    if (cameraButton) {
        const card = cameraButton.closest(".stratum-card");

        openStratumPhotoPicker(card, false);

        return;
    }

    if (event.target.closest("[data-add-stratum]")) {
        addStratumFromBarOrAction();
        return;
    }

    if (event.target.closest("[data-save-stp]")) {
        saveCurrentStp();
        return;
    }

    const removePhotoButton = event.target.closest("[data-photo-remove]");

    if (removePhotoButton) {
        const card = removePhotoButton.closest(".stratum-card");

        if (!card) {
            return;
        }

        const removeIndex = Number(removePhotoButton.getAttribute("data-photo-remove"));
        const entries = getCardPhotoEntries(card);

        if (Number.isNaN(removeIndex) || removeIndex < 0 || removeIndex >= entries.length) {
            return;
        }

        const removedEntries = entries.splice(removeIndex, 1);
        removedEntries.forEach(releaseDraftPhotoEntry);

        setCardPhotoEntries(card, entries);
        validatePhotoNamesForCard(card);
        renderPhotoListForCard(card);
        return;
    }

    const openPhotoButton = event.target.closest("[data-photo-open]");

    if (openPhotoButton) {
        const card = openPhotoButton.closest(".stratum-card");

        if (!card) {
            return;
        }

        const openIndex = Number(openPhotoButton.getAttribute("data-photo-open"));
        const entries = getCardPhotoEntries(card);

        if (Number.isNaN(openIndex) || openIndex < 0 || openIndex >= entries.length) {
            return;
        }

        const targetEntry = entries[openIndex];
        requestSavedPhotoOpen(
            targetEntry.name,
            targetEntry.id,
            targetEntry.pendingId,
            buildCurrentDraftPhotoContextLabel(card)
        );
        return;
    }

    const suggestionButton = event.target.closest("[data-apply-last-stp-suggestion]");

    if (suggestionButton) {
        const card = suggestionButton.closest(".stratum-card");

        if (!card) {
            return;
        }

        applyLastStpSuggestion(card, suggestionButton.getAttribute("data-apply-last-stp-suggestion"));
        return;
    }

    const removeButton = event.target.closest("[data-remove-stratum]");

    if (!removeButton) {
        return;
    }

    const card = removeButton.closest(".stratum-card");

    if (!card) {
        return;
    }

    if (elements.strataList.children.length === 1) {
        alert("Keep at least one stratum card for the current STP.");
        return;
    }

    releaseCardDraftPhotos(card);

    if (lastTouchedStratumCard === card) {
        lastTouchedStratumCard = null;
    }

    card.remove();
    renumberStrata();
    updateActiveStpBar();
}

function handleStrataListInput(event) {
    const field = event.target;

    if (!field) {
        return;
    }

    if (field.matches("[data-photo-name-input]")) {
        const card = field.closest(".stratum-card");

        if (!card) {
            return;
        }

        const photoIndex = Number(field.getAttribute("data-photo-index"));
        const entries = getCardPhotoEntries(card);

        if (Number.isNaN(photoIndex) || photoIndex < 0 || photoIndex >= entries.length) {
            return;
        }

        entries[photoIndex].name = field.value;
        setCardPhotoEntries(card, entries);
        validatePhotoNamesForCard(card);

        const warningElement = card.querySelector("[data-photo-warning]");
        if (warningElement) {
            warningElement.textContent = card.dataset.photoWarning || "";
        }

        return;
    }

    if (!field || !field.matches("[data-field]")) {
        return;
    }

    const fieldName = field.getAttribute("data-field");

    if (["depth", "munsell", "soilType", "horizon"].includes(fieldName)) {
        normalizeStratumOptionField(field);
        markGuideFieldConfirmed(field.closest(".stratum-card"), field);
    }

    if (fieldName === "stratumLabel") {
        const card = field.closest(".stratum-card");
        updatePhotoRuleForCard(card);
        renderStratumSuggestions(card);
        return;
    }

    if (fieldName === "depth") {
        setDepthFieldValidity(field);
    }
}

function handleStrataListChange(event) {
    const field = event.target;

    if (!field) {
        return;
    }

    if (field.matches("[data-photo-name-input]")) {
        const card = field.closest(".stratum-card");

        if (!card) {
            return;
        }

        const photoIndex = Number(field.getAttribute("data-photo-index"));
        const entries = getCardPhotoEntries(card);

        if (Number.isNaN(photoIndex) || photoIndex < 0 || photoIndex >= entries.length) {
            return;
        }

        entries[photoIndex].name = field.value.trim();
        setCardPhotoEntries(card, entries);
        validatePhotoNamesForCard(card);
        renderPhotoListForCard(card);
        return;
    }

    if (!field || !field.matches("[data-field]")) {
        return;
    }

    const fieldName = field.getAttribute("data-field");

    if (["depth", "munsell", "soilType", "horizon"].includes(fieldName)) {
        normalizeStratumOptionField(field);
        markGuideFieldConfirmed(field.closest(".stratum-card"), field);
    }

    if (fieldName !== "photos" && fieldName !== "cameraPhoto") {
        return;
    }

    const card = field.closest(".stratum-card");

    if (!card) {
        return;
    }

    const selectedFiles = Array.from(field.files || []);

    if (selectedFiles.length === 0) {
        return;
    }

    const existingEntries = getCardPhotoEntries(card);
    const stratumLabelField = card.querySelector('[data-field="stratumLabel"]');
    const prefix = card.dataset.photoPrefix || buildPhotoPrefix(stratumLabelField ? stratumLabelField.value : "1");
    const shouldStoreBlobs = shouldPersistStratumPhotoBlobs();
    const photoEntries = selectedFiles.map(function (file, index) {
        const nextEntry = {
            pendingId: "",
            id: "",
            name: buildAutoPhotoName(prefix, existingEntries.length + index + 1, file.name),
            type: file.type || "",
            size: file.size || 0,
            originalName: file.name || ""
        };

        if (shouldStoreBlobs) {
            const draftId = createPhotoDraftId();
            draftPhotoBlobs.set(draftId, file);
            nextEntry.pendingId = draftId;
        }

        return nextEntry;
    });

    setCardPhotoEntries(card, existingEntries.concat(photoEntries));
    validatePhotoNamesForCard(card);
    renderPhotoListForCard(card);
    field.value = "";
}

function handleSavedStpListClick(event) {
    const reopenButton = event.target.closest("[data-reopen-stp-index]");

    if (reopenButton) {
        const stpIndex = Number(reopenButton.getAttribute("data-reopen-stp-index"));

        if (!Number.isInteger(stpIndex) || stpIndex < 0 || stpIndex >= state.stps.length) {
            return;
        }

        reopenSavedStp(stpIndex);
        return;
    }

    const openButton = event.target.closest("[data-open-photo-name]");

    if (!openButton) {
        return;
    }

    const photoName = openButton.getAttribute("data-open-photo-name") || "Photo";
    const photoId = openButton.getAttribute("data-open-photo-id") || "";
    const photoContext = openButton.getAttribute("data-open-photo-context") || "";
    requestSavedPhotoOpen(photoName, photoId, "", photoContext);
}

function requestSavedPhotoOpenFromPicker(photoName, photoContext) {
    if (!elements.savedPhotoOpenInput) {
        alert("Photo opening is not available in this browser.");
        return;
    }

    const normalizedPhotoName = normalizeTextValue(photoName) || "Photo";
    const normalizedPhotoContext = normalizeTextValue(photoContext);

    pendingSavedPhotoOpenName = normalizedPhotoContext
        ? normalizedPhotoName + " - " + normalizedPhotoContext
        : normalizedPhotoName;
    elements.savedPhotoOpenInput.value = "";

    try {
        if (typeof elements.savedPhotoOpenInput.showPicker === "function") {
            elements.savedPhotoOpenInput.showPicker();
        } else {
            elements.savedPhotoOpenInput.click();
        }
    } catch (error) {
        elements.savedPhotoOpenInput.click();
    }
}

function requestSavedPhotoOpen(photoName, photoId, pendingId, photoContext) {
    const normalizedPhotoName = normalizeTextValue(photoName) || "Photo";
    const normalizedPhotoId = normalizeTextValue(photoId);
    const normalizedPendingId = normalizeTextValue(pendingId);
    const normalizedPhotoContext = normalizeTextValue(photoContext);

    if (!normalizedPhotoId && !normalizedPendingId) {
        requestSavedPhotoOpenFromPicker(normalizedPhotoName, normalizedPhotoContext);
        return;
    }

    openPhotoInReferencePanel({
        photoName: normalizedPhotoName,
        photoId: normalizedPhotoId,
        pendingId: normalizedPendingId,
        photoContext: normalizedPhotoContext
    });
}

function handleSavedPhotoOpenSelection() {
    if (!elements.savedPhotoOpenInput) {
        return;
    }

    const file = elements.savedPhotoOpenInput.files[0];

    if (!file) {
        return;
    }

    if (!(file.type || "").toLowerCase().startsWith("image/")) {
        alert("Select an image file to open.");
        elements.savedPhotoOpenInput.value = "";
        return;
    }

    const objectUrl = URL.createObjectURL(file);
    const viewerTitle = pendingSavedPhotoOpenName || file.name || "Photo";
    setReferencePhotoPreview(
        objectUrl,
        viewerTitle,
        "Opened from device storage for reference only. Use Open Reference Photo to save it with the session.",
        "device",
        "",
        true
    );
    setReferencePhotoMessage("Opened " + (file.name || "photo") + " in the Reference Photo frame.", false);

    const referencePanel = getReferencePhotoPanel();
    if (referencePanel) {
        referencePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    elements.savedPhotoOpenInput.value = "";
    pendingSavedPhotoOpenName = "";
}

function sanitizeToken(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getFileExtension(fileName) {
    const match = /\.([A-Za-z0-9]+)$/.exec(String(fileName || ""));

    if (!match) {
        return ".jpg";
    }

    return "." + match[1].toLowerCase();
}

function buildAutoPhotoName(prefix, sequence, fileName) {
    const safeSequence = Number.isFinite(sequence) ? Math.max(1, sequence) : 1;
    const numberToken = String(safeSequence).padStart(2, "0");
    return prefix + "_" + numberToken + getFileExtension(fileName);
}

function getDepthPlaceholderForUnit(unit) {
    const placeholderMap = {
        metric: "20 cm",
        standard: "8 in",
        "engineering-feet": "1.00 ft"
    };

    return placeholderMap[normalizeDepthUnitValue(unit)] || placeholderMap[defaultDepthUnit];
}

function setDepthFieldValidity(field) {
    if (!field) {
        return true;
    }

    const depthValue = normalizeTextValue(field.value);

    if (!depthValue) {
        field.setCustomValidity("Enter a depth value like " + getDepthPlaceholderForUnit(elements.depthUnit && elements.depthUnit.value) + ".");
        return false;
    }

    field.setCustomValidity("");
    return true;
}

function validateAllDepthFields() {
    const depthFields = getMeaningfulStratumCards().map(function (card) {
        return card.querySelector('[data-field="depth"]');
    }).filter(Boolean);
    let firstInvalidField = null;

    depthFields.forEach(function (field) {
        const isValid = setDepthFieldValidity(field);

        if (!isValid && !firstInvalidField) {
            firstInvalidField = field;
        }
    });

    return {
        valid: !firstInvalidField,
        firstInvalidField: firstInvalidField
    };
}

function buildStpUniquenessKey(entryType, stpLabel, supDirection) {
    const normalizedEntryType = normalizeEntryTypeValue(entryType);
    const labelToken = sanitizeToken(stpLabel || "");

    if (!labelToken) {
        return "";
    }

    if (normalizedEntryType === "supplemental") {
        return normalizedEntryType + "|" + labelToken + "|" + normalizeSupDirectionValue(supDirection);
    }

    return normalizedEntryType + "|" + labelToken;
}

function isDuplicateCurrentStpLabel(ignoreIndex) {
    const currentKey = buildStpUniquenessKey(
        elements.stpEntryType.value,
        elements.stpLabel.value,
        elements.supDirection.value
    );

    if (!currentKey) {
        return false;
    }

    const normalizedIgnoreIndex = Number.isInteger(ignoreIndex) ? ignoreIndex : -1;

    return state.stps.some(function (stp, index) {
        if (index === normalizedIgnoreIndex) {
            return false;
        }

        const existingKey = buildStpUniquenessKey(stp.entryType, stp.stpLabel, stp.supDirection);
        return existingKey === currentKey;
    });
}

function getDisplayStpLabelFromForm() {
    const label = elements.stpLabel.value.trim();
    const isSupplemental = elements.stpEntryType.value === "supplemental";
    const supDirection = elements.supDirection.value;

    if (!label) {
        return "STP";
    }

    if (isSupplemental && supDirection) {
        return label + supDirection;
    }

    return label;
}

function getCurrentDraftEntryText() {
    const entryRecordLabel = getEntryRecordLabel(elements.stpEntryType && elements.stpEntryType.value);
    const rawLabel = normalizeTextValue(elements.stpLabel && elements.stpLabel.value);

    if (!rawLabel) {
        return entryRecordLabel;
    }

    return entryRecordLabel + " " + getDisplayStpLabelFromForm();
}

function updateCurrentStratumContextLabels() {
    if (!elements.strataList) {
        return;
    }

    const entryText = getCurrentDraftEntryText();

    elements.strataList.querySelectorAll(".stratum-card").forEach(function (card) {
        const kicker = card.querySelector("[data-stratum-kicker]");
        const titleLabel = card.querySelector("[data-stratum-entry-label]");

        if (kicker) {
            kicker.textContent = entryText;
        }

        if (titleLabel) {
            titleLabel.textContent = "";
        }
    });
}

function getUnitSizeValueFromForm() {
    if (normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value) !== "unit-id") {
        return "";
    }

    const presetValue = normalizeTextValue(elements.unitSizePreset && elements.unitSizePreset.value).toLowerCase();

    if (presetValue && presetValue !== "custom") {
        return normalizeUnitSizeValue(presetValue);
    }

    return normalizeUnitSizeValue(elements.unitSizeCustom && elements.unitSizeCustom.value);
}

function setUnitSizeFormValue(value) {
    if (!elements.unitSizePreset || !elements.unitSizeCustom) {
        return;
    }

    const normalizedValue = normalizeUnitSizeValue(value);

    if (!normalizedValue) {
        elements.unitSizePreset.value = "";
        elements.unitSizeCustom.value = "";
        updateUnitSizeUi();
        return;
    }

    if (validUnitSizePresets.includes(normalizedValue)) {
        elements.unitSizePreset.value = normalizedValue;
        elements.unitSizeCustom.value = "";
    } else {
        elements.unitSizePreset.value = "custom";
        elements.unitSizeCustom.value = normalizedValue;
    }

    updateUnitSizeUi();
}

function updateUnitSizeUi() {
    const isUnitId = normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value) === "unit-id";
    const presetValue = normalizeTextValue(elements.unitSizePreset && elements.unitSizePreset.value).toLowerCase();
    const showCustomField = isUnitId && presetValue === "custom";

    if (elements.unitSizeField) {
        elements.unitSizeField.hidden = !isUnitId;
    }

    if (elements.unitSizePreset) {
        elements.unitSizePreset.disabled = !isUnitId;
        elements.unitSizePreset.required = isUnitId;

        if (!isUnitId) {
            elements.unitSizePreset.value = "";
        }
    }

    if (elements.unitSizeCustomField) {
        elements.unitSizeCustomField.hidden = !showCustomField;
    }

    if (elements.unitSizeCustom) {
        elements.unitSizeCustom.disabled = !showCustomField;
        elements.unitSizeCustom.required = showCustomField;

        if (!isUnitId) {
            elements.unitSizeCustom.value = "";
        }
    }
}

function buildPhotoPrefix(stratumLabel) {
    const siteToken = sanitizeToken(elements.siteName.value) || "SITE";
    const stpToken = sanitizeToken(getDisplayStpLabelFromForm()) || "STP";
    const stratumToken = sanitizeToken(stratumLabel || "1") || "1";

    return siteToken + "_" + stpToken + "_STR" + stratumToken;
}

function updatePhotoRuleForCard(card) {
    if (!card) {
        return;
    }

    const stratumLabelField = card.querySelector('[data-field="stratumLabel"]');
    const photoRuleField = card.querySelector('[data-field="photoRule"]');

    if (!stratumLabelField || !photoRuleField) {
        return;
    }

    const previousPrefix = card.dataset.photoPrefix || "";
    const prefix = buildPhotoPrefix(stratumLabelField.value || "1");
    card.dataset.photoPrefix = prefix;
    photoRuleField.value = prefix + "_01.jpg";

    const existingEntries = getCardPhotoEntries(card);
    if (existingEntries.length > 0 && previousPrefix && previousPrefix !== prefix) {
        const renamedEntries = existingEntries.map(function (entry, index) {
            return normalizePhotoEntry({
                id: entry.id,
                pendingId: entry.pendingId,
                name: buildAutoPhotoName(prefix, index + 1, entry.name),
                type: entry.type,
                size: entry.size,
                originalName: entry.originalName
            });
        });

        setCardPhotoEntries(card, renamedEntries);
    }

    validatePhotoNamesForCard(card);
    renderPhotoListForCard(card);
}

function isStratumCardEmpty(card) {
    if (!card) {
        return true;
    }

    const hasFieldContent = ["depth", "munsell", "soilType", "horizon", "artifactCatalog", "artifactSummary", "notes"]
        .some(function (fieldName) {
            const field = card.querySelector('[data-field="' + fieldName + '"]');
            return Boolean(normalizeTextValue(field && field.value));
        });

    return !hasFieldContent && getCardPhotoEntries(card).length === 0;
}

function getMeaningfulStratumCards() {
    if (!elements.strataList) {
        return [];
    }

    return Array.from(elements.strataList.querySelectorAll(".stratum-card")).filter(function (card) {
        return !isStratumCardEmpty(card);
    });
}

function withEmptyStrataTemporarilyExcluded(callback) {
    const emptyCards = elements.strataList
        ? Array.from(elements.strataList.querySelectorAll(".stratum-card")).filter(isStratumCardEmpty)
        : [];
    const previousStates = [];

    emptyCards.forEach(function (card) {
        card.querySelectorAll("input, select, textarea").forEach(function (field) {
            previousStates.push({
                field: field,
                disabled: field.disabled,
                required: "required" in field ? field.required : null
            });

            field.disabled = true;
            if ("required" in field) {
                field.required = false;
            }
            if (typeof field.setCustomValidity === "function") {
                field.setCustomValidity("");
            }
        });
    });

    try {
        return callback();
    } finally {
        previousStates.forEach(function (entry) {
            entry.field.disabled = entry.disabled;
            if (entry.required !== null) {
                entry.field.required = entry.required;
            }
        });
    }
}

function refreshPhotoRulesAll() {
    elements.strataList.querySelectorAll(".stratum-card").forEach(function (card) {
        updatePhotoRuleForCard(card);
    });
}

function createPhotoDraftId() {
    return "draft-" + String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function createPhotoRecordId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return "photo-" + String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

function shouldPersistStratumPhotoBlobs() {
    return persistStratumPhotoBlobsInBrowser;
}

function supportsIndexedDbPersistence() {
    return "indexedDB" in window;
}

function getAppDataDatabase() {
    if (!supportsIndexedDbPersistence()) {
        return Promise.reject(new Error("IndexedDB is not supported in this browser."));
    }

    if (!appDataDatabasePromise) {
        appDataDatabasePromise = new Promise(function (resolve, reject) {
            const request = window.indexedDB.open(appDataDatabaseName, appDataDatabaseVersion);

            request.onupgradeneeded = function (event) {
                const database = request.result;
                const oldVersion = event.oldVersion;

                if (oldVersion < 1) {
                    database.createObjectStore(appDataStore, { keyPath: "key" });
                }

                if (oldVersion < 2) {
                    database.createObjectStore(fileHandlesStore, { keyPath: "key" });
                }
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error || new Error("Could not open app data storage."));
            };
        });
    }

    return appDataDatabasePromise;
}

async function readAppDataValue(entryKey) {
    const database = await getAppDataDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(appDataStore, "readonly");
        const store = transaction.objectStore(appDataStore);
        const request = store.get(entryKey);

        request.onsuccess = function () {
            const record = request.result;
            resolve(record ? record.value : null);
        };

        request.onerror = function () {
            reject(request.error || new Error("Could not read app data."));
        };
    });
}

async function writeAppDataValue(entryKey, value) {
    const database = await getAppDataDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(appDataStore, "readwrite");
        const store = transaction.objectStore(appDataStore);

        store.put({
            key: entryKey,
            value: value,
            savedAt: new Date().toISOString()
        });

        transaction.oncomplete = function () {
            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not write app data."));
        };

        transaction.onabort = function () {
            reject(transaction.error || new Error("App data write was aborted."));
        };
    });
}

async function deleteAppDataValue(entryKey) {
    const database = await getAppDataDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(appDataStore, "readwrite");
        const store = transaction.objectStore(appDataStore);

        store.delete(entryKey);

        transaction.oncomplete = function () {
            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not delete app data."));
        };

        transaction.onabort = function () {
            reject(transaction.error || new Error("App data delete was aborted."));
        };
    });
}

async function readFileHandle(siteSlug) {
    try {
        const database = await getAppDataDatabase();

        return new Promise(function (resolve) {
            const transaction = database.transaction(fileHandlesStore, "readonly");
            const store = transaction.objectStore(fileHandlesStore);
            const request = store.get(siteSlug);

            request.onsuccess = function () {
                resolve(request.result ? request.result.handle : null);
            };

            request.onerror = function () {
                resolve(null);
            };
        });
    } catch (_err) {
        return null;
    }
}

async function writeFileHandle(siteSlug, handle) {
    try {
        const database = await getAppDataDatabase();

        return new Promise(function (resolve) {
            const transaction = database.transaction(fileHandlesStore, "readwrite");
            const store = transaction.objectStore(fileHandlesStore);

            store.put({ key: siteSlug, handle: handle });

            transaction.oncomplete = function () {
                resolve();
            };

            transaction.onerror = function () {
                resolve();
            };
        });
    } catch (_err) {
        // Non-fatal — next save will re-prompt
    }
}

function getPhotoDatabase() {
    if (!("indexedDB" in window)) {
        return Promise.reject(new Error("IndexedDB is not supported in this browser."));
    }

    if (!photoDatabasePromise) {
        photoDatabasePromise = new Promise(function (resolve, reject) {
            const request = window.indexedDB.open(photoDatabaseName, photoDatabaseVersion);

            request.onupgradeneeded = function () {
                const database = request.result;

                if (!database.objectStoreNames.contains(photoDatabaseStore)) {
                    database.createObjectStore(photoDatabaseStore, { keyPath: "id" });
                }
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error || new Error("Could not open photo storage."));
            };
        });
    }

    return photoDatabasePromise;
}

async function savePhotoBlobToDatabase(photoId, blobValue) {
    const database = await getPhotoDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(photoDatabaseStore, "readwrite");
        const store = transaction.objectStore(photoDatabaseStore);

        store.put({
            id: photoId,
            blob: blobValue,
            savedAt: new Date().toISOString()
        });

        transaction.oncomplete = function () {
            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not save photo blob."));
        };

        transaction.onabort = function () {
            reject(transaction.error || new Error("Photo save was aborted."));
        };
    });
}

async function readPhotoBlobFromDatabase(photoId) {
    if (!photoId || !("indexedDB" in window)) {
        return null;
    }

    const database = await getPhotoDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(photoDatabaseStore, "readonly");
        const store = transaction.objectStore(photoDatabaseStore);
        const request = store.get(photoId);

        request.onsuccess = function () {
            const record = request.result;
            resolve(record && record.blob ? record.blob : null);
        };

        request.onerror = function () {
            reject(request.error || new Error("Could not load photo blob."));
        };
    });
}

async function deletePhotoBlobFromDatabase(photoId) {
    if (!photoId || !("indexedDB" in window)) {
        return;
    }

    const database = await getPhotoDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(photoDatabaseStore, "readwrite");
        const store = transaction.objectStore(photoDatabaseStore);

        store.delete(photoId);

        transaction.oncomplete = function () {
            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not delete photo blob."));
        };

        transaction.onabort = function () {
            reject(transaction.error || new Error("Photo delete was aborted."));
        };
    });
}

async function deletePhotoBlobsFromDatabase(photoIds) {
    const uniqueIds = Array.from(new Set((photoIds || []).filter(Boolean)));

    for (const photoId of uniqueIds) {
        await deletePhotoBlobFromDatabase(photoId);
    }
}

// ============================================
// GPS POINTS DATABASE FUNCTIONS
// ============================================

function getGpsPointsDatabase() {
    if (!("indexedDB" in window)) {
        return Promise.reject(new Error("IndexedDB is not supported in this browser."));
    }

    if (!gpsPointsDatabasePromise) {
        gpsPointsDatabasePromise = new Promise(function (resolve, reject) {
            const request = window.indexedDB.open(gpsPointsDatabaseName, gpsPointsDatabaseVersion);

            request.onupgradeneeded = function () {
                const database = request.result;

                if (!database.objectStoreNames.contains(gpsPointsStore)) {
                    const store = database.createObjectStore(gpsPointsStore, { keyPath: "id" });
                    store.createIndex("source", "source", { unique: false });
                    store.createIndex("status", "status", { unique: false });
                    store.createIndex("importedAt", "importedAt", { unique: false });
                }
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error || new Error("Could not open GPS points storage."));
            };
        });
    }

    return gpsPointsDatabasePromise;
}

async function saveGpsPointToDatabase(point) {
    const database = await getGpsPointsDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(gpsPointsStore, "readwrite");
        const store = transaction.objectStore(gpsPointsStore);

        const pointRecord = {
            id: point.id || generateUniqueId(),
            lat: Number(point.lat),
            lon: Number(point.lon),
            label: String(point.label || ""),
            type: String(point.type || "base"),
            source: String(point.source || "imported"),
            status: String(point.status || "unmarked"), // unmarked, marked, visited
            stpIndex: point.stpIndex != null ? Number(point.stpIndex) : -1,
            importedAt: point.importedAt || new Date().toISOString(),
            metadata: point.metadata || {}
        };

        store.put(pointRecord);

        transaction.oncomplete = function () {
            gpsRegistry.points.set(pointRecord.id, pointRecord);
            resolve(pointRecord);
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not save GPS point."));
        };
    });
}

async function loadGpsPointsFromDatabase() {
    const database = await getGpsPointsDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(gpsPointsStore, "readonly");
        const store = transaction.objectStore(gpsPointsStore);
        const request = store.getAll();

        request.onsuccess = function () {
            const points = request.result || [];
            gpsRegistry.points.clear();
            gpsRegistry.stpToPointMap.clear();
            gpsRegistry.pointToStpMap.clear();

            points.forEach(point => {
                gpsRegistry.points.set(point.id, point);
                if (point.stpIndex !== -1) {
                    gpsRegistry.stpToPointMap.set(point.stpIndex, point.id);
                    gpsRegistry.pointToStpMap.set(point.id, point.stpIndex);
                }
            });

            gpsRegistry.isLoaded = true;
            resolve(points);
        };

        request.onerror = function () {
            reject(request.error || new Error("Could not load GPS points."));
        };
    });
}

async function deleteGpsPointFromDatabase(pointId) {
    const database = await getGpsPointsDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(gpsPointsStore, "readwrite");
        const store = transaction.objectStore(gpsPointsStore);

        store.delete(pointId);

        transaction.oncomplete = function () {
            gpsRegistry.points.delete(pointId);
            const stpIndex = gpsRegistry.pointToStpMap.get(pointId);
            if (stpIndex !== undefined) {
                gpsRegistry.stpToPointMap.delete(stpIndex);
                gpsRegistry.pointToStpMap.delete(pointId);
            }
            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not delete GPS point."));
        };
    });
}

async function deleteGpsPointsFromDatabase(pointIds) {
    const uniquePointIds = Array.from(new Set((pointIds || []).filter(Boolean)));

    if (uniquePointIds.length === 0) {
        return;
    }

    const database = await getGpsPointsDatabase();

    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(gpsPointsStore, "readwrite");
        const store = transaction.objectStore(gpsPointsStore);

        uniquePointIds.forEach(function (pointId) {
            store.delete(pointId);
        });

        transaction.oncomplete = function () {
            uniquePointIds.forEach(function (pointId) {
                const stpIndex = gpsRegistry.pointToStpMap.get(pointId);

                gpsRegistry.points.delete(pointId);
                gpsRegistry.pointToStpMap.delete(pointId);

                if (stpIndex !== undefined) {
                    gpsRegistry.stpToPointMap.delete(stpIndex);
                }
            });

            resolve();
        };

        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not delete GPS points."));
        };
    });
}

// Real-time GPS event dispatchers
function dispatchGpsPointMarked(pointId, stpIndex) {
    const point = gpsRegistry.points.get(pointId);
    if (point) {
        const previousLinkedStpIndex = Number.isFinite(Number(point.stpIndex)) ? Number(point.stpIndex) : -1;
        const previousPointIdForStp = gpsRegistry.stpToPointMap.get(stpIndex);

        if (previousLinkedStpIndex >= 0 && previousLinkedStpIndex !== stpIndex) {
            gpsRegistry.stpToPointMap.delete(previousLinkedStpIndex);
        }

        if (previousPointIdForStp && previousPointIdForStp !== pointId) {
            const previousPoint = gpsRegistry.points.get(previousPointIdForStp);
            if (previousPoint) {
                previousPoint.status = "unmarked";
                previousPoint.stpIndex = -1;
                saveGpsPointToDatabase(previousPoint).catch(console.error);
            }
            gpsRegistry.pointToStpMap.delete(previousPointIdForStp);
        }

        point.status = "marked";
        point.stpIndex = stpIndex;
        gpsRegistry.stpToPointMap.set(stpIndex, pointId);
        gpsRegistry.pointToStpMap.set(pointId, stpIndex);
        saveGpsPointToDatabase(point).catch(console.error);
    }

    gpsEventBus.dispatchEvent(new CustomEvent(GPS_POINT_MARKED, {
        detail: { pointId, stpIndex, point }
    }));
}

function dispatchGpsPointUnmarked(pointId) {
    const point = gpsRegistry.points.get(pointId);
    if (point) {
        const stpIndex = point.stpIndex;
        point.status = "unmarked";
        point.stpIndex = -1;
        gpsRegistry.stpToPointMap.delete(stpIndex);
        gpsRegistry.pointToStpMap.delete(pointId);
        saveGpsPointToDatabase(point).catch(console.error);
    }

    gpsEventBus.dispatchEvent(new CustomEvent(GPS_POINT_UNMARKED, {
        detail: { pointId, point }
    }));
}

function dispatchStpGpsChanged(stpIndex, gpsLat, gpsLon) {
    gpsEventBus.dispatchEvent(new CustomEvent(STP_GPS_CHANGED, {
        detail: { stpIndex, gpsLat, gpsLon }
    }));
}

function syncImportedPointLinkForStp(stpIndex, stpRecord) {
    if (!(gpsRegistry && gpsRegistry.points instanceof Map) || gpsRegistry.points.size === 0) {
        return;
    }

    const latitude = parseGpsCoordinate(stpRecord && stpRecord.gpsLatitude, -90, 90);
    const longitude = parseGpsCoordinate(stpRecord && stpRecord.gpsLongitude, -180, 180);

    let matchedPointId = "";

    if (latitude != null && longitude != null) {
        for (const point of gpsRegistry.points.values()) {
            const pointLatitude = parseGpsCoordinate(point && point.lat, -90, 90);
            const pointLongitude = parseGpsCoordinate(point && point.lon, -180, 180);

            if (pointLatitude == null || pointLongitude == null) {
                continue;
            }

            if (coordinatesMatchWithinTolerance(latitude, longitude, pointLatitude, pointLongitude)) {
                matchedPointId = normalizeTextValue(point.id);
                break;
            }
        }
    }

    for (const point of gpsRegistry.points.values()) {
        const pointId = normalizeTextValue(point && point.id);
        if (!pointId) {
            continue;
        }

        if (Number(point.stpIndex) === Number(stpIndex) && pointId !== matchedPointId) {
            dispatchGpsPointUnmarked(pointId);
        }
    }

    if (matchedPointId) {
        dispatchGpsPointMarked(matchedPointId, stpIndex);
    }

    dispatchStpGpsChanged(stpIndex, latitude, longitude);
}

function normalizePhotoEntry(entry) {
    return {
        id: entry && entry.id ? String(entry.id) : "",
        pendingId: entry && entry.pendingId ? String(entry.pendingId) : "",
        name: String(entry && entry.name != null ? entry.name : ""),
        type: entry && entry.type ? String(entry.type) : "",
        size: Number.isFinite(Number(entry && entry.size)) ? Number(entry.size) : 0,
        originalName: entry && entry.originalName ? String(entry.originalName) : ""
    };
}

function getCardPhotoEntries(card) {
    const rawEntries = card.dataset.photoEntries;

    if (rawEntries) {
        try {
            const parsed = JSON.parse(rawEntries);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizePhotoEntry);
            }
        } catch (error) {
            return [];
        }
    }

    const rawNames = card.dataset.photoNames;

    if (!rawNames) {
        return [];
    }

    try {
        const parsedNames = JSON.parse(rawNames);
        if (!Array.isArray(parsedNames)) {
            return [];
        }

        return parsedNames.map(function (name) {
            return normalizePhotoEntry({ name: name });
        });
    } catch (error) {
        return [];
    }
}

function setCardPhotoEntries(card, entries) {
    const safeEntries = Array.isArray(entries)
        ? entries.map(normalizePhotoEntry)
        : [];

    card.dataset.photoEntries = JSON.stringify(safeEntries);
    card.dataset.photoNames = JSON.stringify(safeEntries.map(function (entry) {
        return entry.name;
    }));
}

function getCardPhotoNames(card) {
    return getCardPhotoEntries(card).map(function (entry) {
        return entry.name;
    });
}

function setCardPhotoNames(card, names) {
    const safeNames = Array.isArray(names)
        ? names.map(function (name) {
            return String(name == null ? "" : name);
        })
        : [];

    const existingEntries = getCardPhotoEntries(card);
    const nextEntries = safeNames.map(function (name, index) {
        const existing = existingEntries[index] || {};

        return normalizePhotoEntry({
            id: existing.id || "",
            pendingId: existing.pendingId || "",
            name: name,
            type: existing.type || "",
            size: existing.size || 0,
            originalName: existing.originalName || ""
        });
    });

    setCardPhotoEntries(card, nextEntries);
}

function releaseDraftPhotoEntry(entry) {
    if (!entry || !entry.pendingId) {
        return;
    }

    draftPhotoBlobs.delete(entry.pendingId);
}

function releaseCardDraftPhotos(card) {
    const entries = getCardPhotoEntries(card);
    entries.forEach(releaseDraftPhotoEntry);
}

function releaseCurrentDraftPhotos() {
    elements.strataList.querySelectorAll(".stratum-card").forEach(function (card) {
        releaseCardDraftPhotos(card);
    });
}

async function persistPhotoEntries(entries) {
    const normalizedEntries = Array.isArray(entries)
        ? entries.map(normalizePhotoEntry)
        : [];

    const shouldStoreBlobs = shouldPersistStratumPhotoBlobs();
    const pendingEntries = normalizedEntries.filter(function (entry) {
        return Boolean(entry.pendingId);
    });

    if (pendingEntries.length > 0 && shouldStoreBlobs && !("indexedDB" in window)) {
        throw new Error("Photo storage is not available in this browser.");
    }

    const persistedEntries = [];

    for (const entry of normalizedEntries) {
        if (entry.pendingId) {
            if (!shouldStoreBlobs) {
                releaseDraftPhotoEntry(entry);

                persistedEntries.push(normalizePhotoEntry({
                    id: "",
                    name: entry.name,
                    type: entry.type,
                    size: entry.size,
                    originalName: entry.originalName
                }));

                continue;
            }

            const blobValue = draftPhotoBlobs.get(entry.pendingId);

            if (!blobValue) {
                throw new Error("A selected photo could not be found in memory. Re-add the photo and try again.");
            }

            const photoId = createPhotoRecordId();
            await savePhotoBlobToDatabase(photoId, blobValue);
            draftPhotoBlobs.delete(entry.pendingId);

            persistedEntries.push(normalizePhotoEntry({
                id: photoId,
                name: entry.name,
                type: entry.type || blobValue.type || "",
                size: entry.size || blobValue.size || 0,
                originalName: entry.originalName || ""
            }));

            continue;
        }

        persistedEntries.push(normalizePhotoEntry({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            size: entry.size,
            originalName: entry.originalName
        }));
    }

    return persistedEntries;
}

async function persistCardPhotoEntries(card) {
    const entries = getCardPhotoEntries(card);
    const persistedEntries = await persistPhotoEntries(entries);
    setCardPhotoEntries(card, persistedEntries);
    return persistedEntries;
}

function getStratumPhotoEntries(stratum) {
    if (Array.isArray(stratum.photos)) {
        return stratum.photos.map(normalizePhotoEntry);
    }

    if (Array.isArray(stratum.photoNames)) {
        return stratum.photoNames.map(function (name) {
            return normalizePhotoEntry({ name: name });
        });
    }

    return [];
}

function getStratumPhotoNames(stratum) {
    return getStratumPhotoEntries(stratum).map(function (entry) {
        return entry.name;
    }).filter(Boolean);
}

function collectPhotoIdsFromStps(stps) {
    const photoIds = new Set();

    (stps || []).forEach(function (stp) {
        (stp.strata || []).forEach(function (stratum) {
            getStratumPhotoEntries(stratum).forEach(function (entry) {
                if (entry.id) {
                    photoIds.add(entry.id);
                }
            });
        });
    });

    return Array.from(photoIds);
}

function collectPhotoIdsFromProjects(projects) {
    const photoIds = new Set();

    (projects || []).forEach(function (project) {
        collectPhotoIdsFromStps(project.stps || []).forEach(function (photoId) {
            photoIds.add(photoId);
        });
    });

    return Array.from(photoIds);
}

function buildPhotoMetadataMapFromStps(stps) {
    const photoMetadata = new Map();

    (stps || []).forEach(function (stp) {
        (stp.strata || []).forEach(function (stratum) {
            getStratumPhotoEntries(stratum).forEach(function (entry) {
                const normalizedEntry = normalizePhotoEntry(entry);

                if (!normalizedEntry.id || photoMetadata.has(normalizedEntry.id)) {
                    return;
                }

                photoMetadata.set(normalizedEntry.id, {
                    name: normalizedEntry.name,
                    type: normalizedEntry.type,
                    size: normalizedEntry.size
                });
            });
        });
    });

    return photoMetadata;
}

function normalizePhotoBackupEntry(entry) {
    const rawEntry = entry && typeof entry === "object" ? entry : {};

    return {
        id: normalizeTextValue(rawEntry.id),
        name: normalizeTextValue(rawEntry.name),
        type: normalizeTextValue(rawEntry.type),
        size: Number.isFinite(Number(rawEntry.size)) ? Number(rawEntry.size) : 0,
        dataUrl: typeof rawEntry.dataUrl === "string" ? rawEntry.dataUrl : ""
    };
}

async function buildSessionBackupPayload() {
    const sessionSnapshot = normalizeImportedSession(state);
    const bundledPhotos = [];
    const missingPhotoIds = [];
    const photoMetadata = buildPhotoMetadataMapFromStps(sessionSnapshot.stps);

    for (const [photoId, metadata] of photoMetadata.entries()) {
        try {
            const blobValue = await readPhotoBlobFromDatabase(photoId);

            if (!blobValue) {
                missingPhotoIds.push(photoId);
                continue;
            }

            bundledPhotos.push({
                id: photoId,
                name: metadata.name,
                type: metadata.type || blobValue.type || "",
                size: metadata.size || blobValue.size || 0,
                dataUrl: await readFileAsDataUrl(blobValue)
            });
        } catch (error) {
            console.warn("Could not bundle STP photo for JSON backup.", error);
            missingPhotoIds.push(photoId);
        }
    }

    return {
        exportType: "archaeolab-session-backup",
        formatVersion: sessionBackupFormatVersion,
        exportedAt: new Date().toISOString(),
        session: sessionSnapshot,
        stpPhotos: bundledPhotos,
        missingPhotoIds: missingPhotoIds
    };
}

function extractSessionBackupPayload(parsedData) {
    const rawBackup = parsedData && typeof parsedData === "object" ? parsedData : {};
    const hasBackupEnvelope = rawBackup.exportType === "archaeolab-session-backup"
        && rawBackup.session
        && typeof rawBackup.session === "object";

    if (!hasBackupEnvelope) {
        return {
            sessionData: rawBackup,
            bundledPhotos: [],
            missingPhotoIds: [],
            formatVersion: 1
        };
    }

    return {
        sessionData: rawBackup.session,
        bundledPhotos: (Array.isArray(rawBackup.stpPhotos) ? rawBackup.stpPhotos : [])
            .map(normalizePhotoBackupEntry)
            .filter(function (entry) {
                return Boolean(entry.id) && /^data:/i.test(entry.dataUrl);
            }),
        missingPhotoIds: (Array.isArray(rawBackup.missingPhotoIds) ? rawBackup.missingPhotoIds : [])
            .map(normalizeTextValue)
            .filter(Boolean),
        formatVersion: Number.isFinite(Number(rawBackup.formatVersion)) ? Number(rawBackup.formatVersion) : 1
    };
}

async function restoreBundledPhotoEntries(photoEntries) {
    const normalizedEntries = Array.isArray(photoEntries)
        ? photoEntries.map(normalizePhotoBackupEntry).filter(function (entry) {
            return Boolean(entry.id) && /^data:/i.test(entry.dataUrl);
        })
        : [];
    const restoredPhotoIds = [];
    const failedPhotoIds = [];

    if (normalizedEntries.length === 0) {
        return {
            restoredPhotoIds: restoredPhotoIds,
            failedPhotoIds: failedPhotoIds
        };
    }

    if (!supportsIndexedDbPersistence()) {
        return {
            restoredPhotoIds: restoredPhotoIds,
            failedPhotoIds: normalizedEntries.map(function (entry) {
                return entry.id;
            })
        };
    }

    for (const entry of normalizedEntries) {
        try {
            const blobValue = dataUrlToBlob(entry.dataUrl, entry.type);
            await savePhotoBlobToDatabase(entry.id, blobValue);
            restoredPhotoIds.push(entry.id);
        } catch (error) {
            console.warn("Could not restore STP photo from JSON backup.", error);
            failedPhotoIds.push(entry.id);
        }
    }

    return {
        restoredPhotoIds: restoredPhotoIds,
        failedPhotoIds: failedPhotoIds
    };
}

function stripUnavailableImportedPhotoIds(importedSession, availablePhotoIds) {
    const keepIds = new Set((availablePhotoIds || []).filter(Boolean));

    importedSession.stps = (importedSession.stps || []).map(function (stp) {
        return Object.assign({}, stp, {
            strata: (stp.strata || []).map(function (stratum) {
                const filteredPhotos = getStratumPhotoEntries(stratum).map(function (entry) {
                    const normalizedEntry = normalizePhotoEntry(entry);

                    return {
                        id: keepIds.has(normalizedEntry.id) ? normalizedEntry.id : "",
                        name: normalizedEntry.name,
                        type: normalizedEntry.type,
                        size: normalizedEntry.size
                    };
                });

                return Object.assign({}, stratum, {
                    photoNames: filteredPhotos.map(function (entry) {
                        return entry.name;
                    }).filter(Boolean),
                    photos: filteredPhotos
                });
            })
        });
    });

    return importedSession;
}

async function cleanupDeletedPhotoIds(candidatePhotoIds, projectsSnapshot) {
    const candidates = Array.from(new Set((candidatePhotoIds || []).filter(Boolean)));

    if (candidates.length === 0) {
        return;
    }

    const keepIds = new Set();

    collectPhotoIdsFromStps(state.stps).forEach(function (photoId) {
        keepIds.add(photoId);
    });

    const projects = Array.isArray(projectsSnapshot) ? projectsSnapshot : loadProjectsStore();
    collectPhotoIdsFromProjects(projects).forEach(function (photoId) {
        keepIds.add(photoId);
    });

    const deletableIds = candidates.filter(function (photoId) {
        return !keepIds.has(photoId);
    });

    await deletePhotoBlobsFromDatabase(deletableIds);
}

function setPhotoWarning(card, text) {
    card.dataset.photoWarning = text || "";
}

function validatePhotoNamesForCard(card) {
    const names = getCardPhotoNames(card);

    if (names.length === 0) {
        card.dataset.photosValid = "true";
        setPhotoWarning(card, "");
        return true;
    }

    const prefix = card.dataset.photoPrefix || "";
    const namePattern = new RegExp("^" + escapeRegExp(prefix) + "_\\d+\\.[A-Za-z0-9]+$", "i");
    const invalidNames = names.filter(function (name) {
        return !namePattern.test(name);
    });

    if (invalidNames.length > 0) {
        card.dataset.photosValid = "false";
        setPhotoWarning(card, "Rename photos to match: " + prefix + "_01.jpg (first invalid: " + invalidNames[0] + ")");
        return false;
    }

    card.dataset.photosValid = "true";
    setPhotoWarning(card, "");
    return true;
}

function renderPhotoListForCard(card) {
    const listElement = card.querySelector("[data-photo-list]");
    const warningElement = card.querySelector("[data-photo-warning]");

    if (!listElement || !warningElement) {
        return;
    }

    const names = getCardPhotoNames(card);
    listElement.innerHTML = "";

    if (names.length === 0) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "No files selected.";
        listElement.appendChild(emptyItem);
    } else {
        names.forEach(function (name, index) {
            const item = document.createElement("li");
            item.className = "photo-item";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.className = "photo-name-input";
            nameInput.value = name;
            nameInput.setAttribute("data-photo-name-input", "true");
            nameInput.setAttribute("data-photo-index", String(index));
            nameInput.setAttribute("aria-label", "Photo name " + String(index + 1));

            const actions = document.createElement("div");
            actions.className = "photo-item-actions";

            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.className = "photo-open-button";
            openButton.setAttribute("data-photo-open", String(index));
            openButton.textContent = "Open";

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "photo-remove-button";
            removeButton.setAttribute("data-photo-remove", String(index));
            removeButton.textContent = "Delete";

            actions.appendChild(openButton);
            actions.appendChild(removeButton);
            item.appendChild(nameInput);
            item.appendChild(actions);
            listElement.appendChild(item);
        });
    }

    warningElement.textContent = card.dataset.photoWarning || "";
    renderReferencePhotoLibrary();
    updateQuickPhotoControls();
}

function findFirstInvalidPhotoCard() {
    const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));

    return cards.find(function (card) {
        return card.dataset.photosValid === "false";
    });
}

function getBaseStpLabels() {
    const labels = new Set();

    state.stps.forEach(function (stp) {
        const type = stp.entryType || "base";
        if (type === "base" && stp.stpLabel) {
            labels.add(stp.stpLabel);
        }
    });

    return Array.from(labels).sort();
}

function refreshParentStpOptions() {
    const currentValue = elements.parentStp.value;
    const baseLabels = getBaseStpLabels();

    elements.parentStp.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Select base STP";
    elements.parentStp.appendChild(defaultOption);

    baseLabels.forEach(function (label) {
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        elements.parentStp.appendChild(option);
    });

    if (baseLabels.includes(currentValue)) {
        elements.parentStp.value = currentValue;
    } else {
        elements.parentStp.value = "";
    }
}

function updateStpTypeUi() {
    const isSupplemental = elements.stpEntryType.value === "supplemental";
    const isUnitId = elements.stpEntryType.value === "unit-id";

    elements.parentStp.disabled = !isSupplemental;
    elements.parentStp.required = isSupplemental;
    elements.supDirection.disabled = !isSupplemental;
    elements.supDirection.required = isSupplemental;

    if (!isSupplemental) {
        elements.parentStp.value = "";
        elements.supDirection.value = "";
    }

    if (!isUnitId) {
        setUnitSizeFormValue("");
    } else {
        updateUnitSizeUi();
    }
}

function setGpsStatusMessage(text, isError, accuracyClass) {
    if (!elements.gpsStatusMessage) {
        return;
    }

    elements.gpsStatusMessage.textContent = text || "";
    elements.gpsStatusMessage.classList.toggle("is-error", Boolean(isError));
    elements.gpsStatusMessage.classList.toggle("is-good", accuracyClass === "is-good");
    elements.gpsStatusMessage.classList.toggle("is-warn", accuracyClass === "is-warn");
    elements.gpsStatusMessage.classList.toggle("is-poor", accuracyClass === "is-poor");
}

async function markCurrentGpsPointAndContinue() {
    const latitude = parseGpsCoordinate(elements.gpsLatitude && elements.gpsLatitude.value, -90, 90);
    const longitude = parseGpsCoordinate(elements.gpsLongitude && elements.gpsLongitude.value, -180, 180);

    if (latitude == null || longitude == null) {
        setGpsStatusMessage("Enter or capture valid latitude and longitude before marking this point.", true);
        if (latitude == null && elements.gpsLatitude) {
            elements.gpsLatitude.focus();
        } else if (elements.gpsLongitude) {
            elements.gpsLongitude.focus();
        }
        return;
    }

    const label = normalizeTextValue(elements.stpLabel && elements.stpLabel.value)
        || ("STP " + String(state.stps.length + 1));
    const stpIndex = isEditingSavedStp() ? activeEditStpIndex : -1;
    let point = null;

    for (const candidate of gpsRegistry.points.values()) {
        const candidateLatitude = parseGpsCoordinate(candidate && candidate.lat, -90, 90);
        const candidateLongitude = parseGpsCoordinate(candidate && candidate.lon, -180, 180);

        if (candidateLatitude != null
            && candidateLongitude != null
            && coordinatesMatchWithinTolerance(latitude, longitude, candidateLatitude, candidateLongitude)) {
            point = candidate;
            break;
        }
    }

    if (!point) {
        point = {
            id: "stp-point-" + String(Date.now()),
            lat: latitude,
            lon: longitude,
            label: label,
            type: normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value),
            source: "stp-entry",
            status: "marked",
            stpIndex: stpIndex,
            importedAt: new Date().toISOString(),
            metadata: {
                siteName: normalizeTextValue(state.siteName),
                siteLocation: normalizeTextValue(state.siteLocation)
            }
        };
    } else {
        point.label = label;
        point.type = normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value);
        point.source = "stp-entry";
        point.status = "marked";
        point.stpIndex = stpIndex;
    }

    try {
        await saveGpsPointToDatabase(point);

        if (stpIndex >= 0) {
            dispatchGpsPointMarked(point.id, stpIndex);
        }

        updateGpsMapButtonState();
        setGpsStatusMessage("GPS point marked for mapping.", false, "is-good");
    } catch (error) {
        console.error("Could not save marked GPS point.", error);
        setGpsStatusMessage("Could not save this GPS point. Try again or export a backup.", true);
    }
}

function getGpsErrorMessage(error) {
    if (!error || typeof error.code !== "number") {
        return "Could not read phone GPS location.";
    }

    if (error.code === error.PERMISSION_DENIED) {
        return "Location permission denied. Allow location access and try again.";
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
        return "Location is unavailable right now. Move to open sky and try again.";
    }

    if (error.code === error.TIMEOUT) {
        return "Location request timed out. Try again.";
    }

    return "Could not read phone GPS location.";
}

function handleUseCurrentGps() {
    if (!("geolocation" in navigator)) {
        setGpsStatusMessage("Phone GPS is not supported in this browser.", true);
        return;
    }

    if (!window.isSecureContext) {
        setGpsStatusMessage("GPS requires a secure connection (HTTPS).", true);
        return;
    }

    if (elements.useCurrentGpsButton) {
        elements.useCurrentGpsButton.disabled = true;
    }

    setGpsStatusMessage("Getting current GPS location from phone...", false);

    navigator.geolocation.getCurrentPosition(
        function (position) {
            const latitude = Number(position && position.coords ? position.coords.latitude : NaN);
            const longitude = Number(position && position.coords ? position.coords.longitude : NaN);

            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                setGpsStatusMessage("Phone GPS returned invalid coordinates.", true);
            } else {
                elements.gpsLatitude.value = latitude.toFixed(gpsCoordinateDecimalPlaces);
                elements.gpsLongitude.value = longitude.toFixed(gpsCoordinateDecimalPlaces);

                const accuracyMeters = Number(position.coords && position.coords.accuracy);
                let accuracyText = "";
                let accuracyClass = null;

                if (Number.isFinite(accuracyMeters)) {
                    const roundedAccuracy = Math.round(accuracyMeters);
                    accuracyText = " (accuracy +/- " + roundedAccuracy + " m)";
                    accuracyClass = roundedAccuracy <= 10 ? "is-good" : roundedAccuracy <= 25 ? "is-warn" : "is-poor";
                }

                setGpsStatusMessage("GPS coordinates updated from phone location" + accuracyText + ".", false, accuracyClass);
            }

            if (elements.useCurrentGpsButton) {
                elements.useCurrentGpsButton.disabled = false;
            }
        },
        function (error) {
            setGpsStatusMessage(getGpsErrorMessage(error), true);

            if (elements.useCurrentGpsButton) {
                elements.useCurrentGpsButton.disabled = false;
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 10000
        }
    );
}

function getCurrentDraftFlowStepId() {
    const hasSiteDetails = Boolean(
        normalizeTextValue(elements.siteName && elements.siteName.value)
        && normalizeTextValue(elements.siteLocation && elements.siteLocation.value)
    );

    return hasSiteDetails ? "strata" : "site";
}

function focusPrimaryDraftField() {
    const targetStepId = getCurrentDraftFlowStepId();
    const targetField = targetStepId === "site"
        ? elements.siteName
        : elements.stpLabel;

    if (flowSteps.length > 0) {
        setActiveFlowStep(targetStepId, false);
    }

    if (targetField) {
        targetField.focus();
    }
}

function resetCurrentStp(shouldFocus) {
    if (referencePhotoPreviewKind === "draft") {
        clearReferencePhotoPreview(false);
    }

    releaseCurrentDraftPhotos();
    lastTouchedStratumCard = null;
    setActiveEditStpIndex(-1);
    elements.strataList.innerHTML = "";
    addStratumCard();

    elements.stpEntryType.value = "base";
    elements.gpsLatitude.value = "";
    elements.gpsLongitude.value = "";
    setGpsStatusMessage("", false);

    updateStpTypeUi();
    refreshParentStpOptions();

    if (state.stps.length > 0) {
        const lastLabel = state.stps[state.stps.length - 1].stpLabel;
        elements.stpLabel.value = suggestNextStpLabel(lastLabel);
    } else {
        elements.stpLabel.value = "";
    }

    refreshPhotoRulesAll();

    if (shouldFocus) {
        focusPrimaryDraftField();
    }
    updateActiveStpBar();
}

function handlePostStpSaveFlowAdvance() {
    if (!fieldModeEnabled) {
        return;
    }

    setActiveFlowStep("strata", true);

    const firstDepthField = elements.strataList
        ? elements.strataList.querySelector('[data-field="depth"]')
        : null;

    if (firstDepthField) {
        firstDepthField.focus();
    }
}

function hasCurrentDraftData() {
    const hasHeaderData = Boolean(
        normalizeTextValue(elements.gpsLatitude && elements.gpsLatitude.value)
        || normalizeTextValue(elements.gpsLongitude && elements.gpsLongitude.value)
        || normalizeTextValue(elements.parentStp && elements.parentStp.value)
        || normalizeTextValue(elements.supDirection && elements.supDirection.value)
        || normalizeEntryTypeValue(elements.stpEntryType && elements.stpEntryType.value) !== "base"
    );

    if (hasHeaderData) {
        return true;
    }

    const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));

    return cards.some(function (card) {
        const hasFieldContent = ["depth", "munsell", "soilType", "horizon", "artifactCatalog", "artifactSummary", "notes"]
            .some(function (fieldName) {
                const field = card.querySelector('[data-field="' + fieldName + '"]');
                return Boolean(normalizeTextValue(field && field.value));
            });

        return hasFieldContent || getCardPhotoEntries(card).length > 0;
    });
}

function startNewStpFromCurrent() {
    const isEditing = isEditingSavedStp();

    if (hasCurrentDraftData()) {
        const warning = isEditing
            ? "You are editing a saved STP. Start a new STP and discard unsaved edits?"
            : "Start a new STP and clear the current draft?";

        if (!confirm(warning)) {
            return;
        }
    }

    resetCurrentStp(true);
}

function populateCurrentStrataFromSavedStp(stp) {
    const sourceStrata = Array.isArray(stp && stp.strata) ? stp.strata : [];
    const hasSourceStrata = sourceStrata.length > 0;

    releaseCurrentDraftPhotos();
    lastTouchedStratumCard = null;
    elements.strataList.innerHTML = "";

    const cardCount = hasSourceStrata ? sourceStrata.length : 1;

    for (let index = 0; index < cardCount; index += 1) {
        addStratumCard();
    }

    if (!hasSourceStrata) {
        return;
    }

    const cards = Array.from(elements.strataList.querySelectorAll(".stratum-card"));

    cards.forEach(function (card) {
        const stratumLabelField = card.querySelector('[data-field="stratumLabel"]');
        const cardLabelNumber = getStratumNumberValue(stratumLabelField && stratumLabelField.value);
        const matchedStratum = sourceStrata.find(function (stratum) {
            return getStratumNumberValue(stratum && stratum.stratumLabel) === cardLabelNumber;
        });

        if (!matchedStratum) {
            return;
        }

        ["depth", "munsell", "soilType", "horizon", "artifactCatalog", "artifactSummary", "notes"].forEach(function (fieldName) {
            const field = card.querySelector('[data-field="' + fieldName + '"]');
            if (field) {
                field.value = normalizeTextValue(matchedStratum[fieldName]);
            }
        });

        setCardPhotoEntries(card, getStratumPhotoEntries(matchedStratum));
        validatePhotoNamesForCard(card);
        renderPhotoListForCard(card);
    });
}

function reopenSavedStp(stpIndex) {
    const normalizedIndex = Number(stpIndex);

    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= state.stps.length) {
        return;
    }

    if (hasCurrentDraftData()) {
        const warning = isEditingSavedStp()
            ? "Open another saved STP and discard unsaved edits in this draft?"
            : "Open this saved STP and replace the current draft?";

        if (!confirm(warning)) {
            return;
        }
    }

    const stp = state.stps[normalizedIndex];

    state.siteName = normalizeTextValue(stp.siteName || state.siteName);
    state.siteLocation = normalizeTextValue(stp.siteLocation || state.siteLocation);
    state.crewMembers = normalizeTextValue(stp.crewMembers || state.crewMembers);
    state.depthUnit = normalizeDepthUnitValue(stp.depthUnit || state.depthUnit);

    populateSiteFields();
    refreshParentStpOptions();

    elements.stpEntryType.value = normalizeEntryTypeValue(stp.entryType);
    updateStpTypeUi();
    refreshParentStpOptions();

    if (elements.stpEntryType.value === "supplemental") {
        elements.parentStp.value = normalizeTextValue(stp.parentStp);
        elements.supDirection.value = normalizeSupDirectionValue(stp.supDirection);
    }

    setUnitSizeFormValue(stp.unitSize);

    elements.stpLabel.value = normalizeTextValue(stp.stpLabel);
    elements.gpsLatitude.value = normalizeTextValue(stp.gpsLatitude);
    elements.gpsLongitude.value = normalizeTextValue(stp.gpsLongitude);
    setGpsStatusMessage("Re-opened saved STP for editing.", false);

    refreshPhotoRulesAll();
    populateCurrentStrataFromSavedStp(stp);
    refreshPhotoRulesAll();
    refreshStratumSuggestionsAll();
    setActiveEditStpIndex(normalizedIndex);
    setActiveFlowStep("strata", false);

    elements.entryForm.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.stpLabel.focus();
}

async function saveCurrentStp() {
    updateSiteDraft();

    const editingIndex = isEditingSavedStp() ? activeEditStpIndex : -1;
    const isEditing = editingIndex >= 0;

    const formIsValid = withEmptyStrataTemporarilyExcluded(function () {
        const depthValidation = validateAllDepthFields();

        if (!depthValidation.valid) {
            if (depthValidation.firstInvalidField) {
                depthValidation.firstInvalidField.focus();
            }

            elements.entryForm.reportValidity();
            return false;
        }

        return elements.entryForm.reportValidity();
    });

    if (!formIsValid) {
        return;
    }

    if (elements.stpEntryType.value === "supplemental" && !elements.parentStp.value) {
        alert("Choose a parent base STP for supplemental entries.");
        elements.parentStp.focus();
        return;
    }

    if (isDuplicateCurrentStpLabel(editingIndex)) {
        if (elements.stpEntryType.value === "supplemental") {
            alert("This supplemental STP label and Sup direction already exists. Use a different label or direction.");
        } else {
            alert("This STP label already exists for the selected entry type. Use a different label.");
        }

        elements.stpLabel.focus();
        return;
    }

    const invalidPhotoCard = findFirstInvalidPhotoCard();
    if (invalidPhotoCard) {
        alert("One or more photo names do not match the naming rule. Edit or delete invalid names before saving.");
        const photoNameInput = invalidPhotoCard.querySelector("[data-photo-name-input]");
        if (photoNameInput) {
            photoNameInput.focus();
        }
        return;
    }

    setSaveButtonsDisabled(true);

    try {
        const currentStp = await collectCurrentStp();

        if (isEditing && editingIndex < state.stps.length) {
            state.stps.splice(editingIndex, 1, currentStp);
        } else {
            state.stps.push(currentStp);
        }

        const savedStpIndex = isEditing && editingIndex < state.stps.length
            ? editingIndex
            : (state.stps.length - 1);
        syncImportedPointLinkForStp(savedStpIndex, currentStp);

        const fullSessionSaved = saveSession();
        if (!fullSessionSaved) {
            const saveWarning = getDataSafetyAlertMessage(isEditing ? "STP update saved." : "STP saved.");
            if (saveWarning) {
                alert(saveWarning);
            }
        }

        refreshParentStpOptions();
        renderSavedStps();
        await saveAutoJsonBackupAfterStpSave();
        resetCurrentStp(true);
        handlePostStpSaveFlowAdvance();
    } catch (error) {
        console.warn("Could not save STP photos.", error);

        if (!confirm("Photos could not be saved for this STP. Save STP data without photos?")) {
            alert("Photos were not saved. Re-upload photos and try again.");
            return;
        }

        const fallbackStp = collectCurrentStpWithoutPhotoPersistence();

        if (isEditing && editingIndex < state.stps.length) {
            state.stps.splice(editingIndex, 1, fallbackStp);
        } else {
            state.stps.push(fallbackStp);
        }

        const savedFallbackStpIndex = isEditing && editingIndex < state.stps.length
            ? editingIndex
            : (state.stps.length - 1);
        syncImportedPointLinkForStp(savedFallbackStpIndex, fallbackStp);

        const fullSessionSaved = saveSession();

        if (!fullSessionSaved) {
            const saveWarning = getDataSafetyAlertMessage(isEditing ? "STP update core data saved without photos." : "STP core data saved without photos.");
            if (saveWarning) {
                alert(saveWarning);
            }
        }

        refreshParentStpOptions();
        renderSavedStps();
        await saveAutoJsonBackupAfterStpSave();
        resetCurrentStp(true);
        alert("STP data saved without photos. Re-add photos later if needed.");
        handlePostStpSaveFlowAdvance();
    } finally {
        setSaveButtonsDisabled(false);
    }
}

async function collectCurrentStp() {
    const strata = [];
    const cards = getMeaningfulStratumCards();

    for (const card of cards) {
        const persistedPhotoEntries = await persistCardPhotoEntries(card);
        const photoNames = persistedPhotoEntries.map(function (entry) {
            return entry.name;
        }).filter(Boolean);

        const savedPhotos = persistedPhotoEntries.map(function (entry) {
            return {
                id: entry.id,
                name: entry.name,
                type: entry.type,
                size: entry.size
            };
        });

        strata.push({
            stratumLabel: card.querySelector('[data-field="stratumLabel"]').value,
            depth: card.querySelector('[data-field="depth"]').value.trim(),
            munsell: card.querySelector('[data-field="munsell"]').value.trim(),
            soilType: card.querySelector('[data-field="soilType"]').value.trim(),
            horizon: card.querySelector('[data-field="horizon"]').value.trim(),
            artifactCatalog: card.querySelector('[data-field="artifactCatalog"]').value.trim(),
            artifactSummary: card.querySelector('[data-field="artifactSummary"]').value.trim(),
            notes: card.querySelector('[data-field="notes"]').value.trim(),
            photoNames: photoNames,
            photos: savedPhotos
        });
    }

    strata.sort(function (a, b) {
        return Number(a.stratumLabel) - Number(b.stratumLabel);
    });

    return {
        siteName: state.siteName,
        siteLocation: state.siteLocation,
        crewMembers: state.crewMembers,
        depthUnit: state.depthUnit,
        stpLabel: elements.stpLabel.value.trim(),
        entryType: elements.stpEntryType.value,
        unitSize: getUnitSizeValueFromForm(),
        parentStp: elements.parentStp.value,
        supDirection: elements.supDirection.value,
        gpsLatitude: elements.gpsLatitude.value.trim(),
        gpsLongitude: elements.gpsLongitude.value.trim(),
        savedAt: new Date().toISOString(),
        strata: strata
    };
}

function collectCurrentStpWithoutPhotoPersistence() {
    const strata = [];
    const cards = getMeaningfulStratumCards();

    cards.forEach(function (card) {
        const photoNames = getCardPhotoEntries(card).map(function (entry) {
            return entry.name;
        }).filter(Boolean);

        strata.push({
            stratumLabel: card.querySelector('[data-field="stratumLabel"]').value,
            depth: card.querySelector('[data-field="depth"]').value.trim(),
            munsell: card.querySelector('[data-field="munsell"]').value.trim(),
            soilType: card.querySelector('[data-field="soilType"]').value.trim(),
            horizon: card.querySelector('[data-field="horizon"]').value.trim(),
            artifactCatalog: card.querySelector('[data-field="artifactCatalog"]').value.trim(),
            artifactSummary: card.querySelector('[data-field="artifactSummary"]').value.trim(),
            notes: card.querySelector('[data-field="notes"]').value.trim(),
            photoNames: photoNames,
            photos: []
        });
    });

    strata.sort(function (a, b) {
        return Number(a.stratumLabel) - Number(b.stratumLabel);
    });

    return {
        siteName: state.siteName,
        siteLocation: state.siteLocation,
        crewMembers: state.crewMembers,
        depthUnit: state.depthUnit,
        stpLabel: elements.stpLabel.value.trim(),
        entryType: elements.stpEntryType.value,
        unitSize: getUnitSizeValueFromForm(),
        parentStp: elements.parentStp.value,
        supDirection: elements.supDirection.value,
        gpsLatitude: elements.gpsLatitude.value.trim(),
        gpsLongitude: elements.gpsLongitude.value.trim(),
        savedAt: new Date().toISOString(),
        strata: strata
    };
}

function renderSavedStps() {
    elements.savedStpList.innerHTML = "";
    const searchTerm = getSavedStpSearchTerm();
    const typeFilter = getSavedStpTypeFilterValue();
    const sortValue = getSavedStpSortValue();
    const hasActiveFilters = Boolean(searchTerm) || typeFilter !== "all" || sortValue !== "newest";
    updateHeaderCount(elements.savedStpHeaderCount, state.stps.length, state.stps.length);
    updateGpsMapButtonState();
    updateWrapUpSummary();
    syncFlowNavigatorState(false);

    if (state.stps.length === 0) {
        updateSavedStpFilterSummary(0, 0, searchTerm, typeFilter, sortValue);
        elements.savedEmptyState.hidden = false;
        elements.savedEmptyState.textContent = "No STPs saved yet.";
        elements.sessionStatus.textContent = "0 STPs saved";
        return;
    }

    elements.sessionStatus.textContent = state.stps.length + (state.stps.length === 1 ? " STP saved" : " STPs saved");
    const filteredStps = state.stps.filter(function (stp) {
        return matchesSavedStpFilters(stp, searchTerm, typeFilter);
    });
    const sortedStps = sortSavedStpsByValue(filteredStps, sortValue);
    updateHeaderCount(elements.savedStpHeaderCount, state.stps.length, sortedStps.length);
    updateSavedStpFilterSummary(state.stps.length, sortedStps.length, searchTerm, typeFilter, sortValue);

    if (sortedStps.length === 0) {
        elements.savedEmptyState.hidden = false;
        elements.savedEmptyState.textContent = hasActiveFilters
            ? "No saved STPs match the current search/filter."
            : "No STPs saved yet.";
        return;
    }

    elements.savedEmptyState.hidden = true;
    elements.savedEmptyState.textContent = "No STPs saved yet.";

    sortedStps.forEach(function (stp) {
        const card = document.createElement("article");
        card.className = "saved-stp";

        const stpIndex = state.stps.indexOf(stp);
        const entryRecordLabel = getEntryRecordLabel(stp.entryType);
        const titleRow = document.createElement("div");
        titleRow.className = "saved-stp-title-row";

        const title = document.createElement("h3");
        title.className = "saved-stp-title";
        setHighlightedText(title, entryRecordLabel + " " + stp.stpLabel, searchTerm);
        titleRow.appendChild(title);

        const titleActions = document.createElement("div");
        titleActions.className = "saved-stp-title-actions";

        const reopenButton = document.createElement("button");
        reopenButton.type = "button";
        reopenButton.className = "saved-stp-reopen-button";
        reopenButton.setAttribute("data-reopen-stp-index", String(stpIndex));
        reopenButton.textContent = stpIndex === activeEditStpIndex ? "Editing" : "Re-open";
        reopenButton.disabled = stpIndex === activeEditStpIndex;
        titleActions.appendChild(reopenButton);

        titleRow.appendChild(titleActions);
        card.appendChild(titleRow);

        const stpInfo = document.createElement("div");
        stpInfo.className = "saved-stp-info";

        function addStpField(label, value) {
            if (!value) return;
            const cell = document.createElement("div");
            cell.className = "ssd-cell";
            const lbl = document.createElement("span");
            lbl.className = "ssd-label";
            lbl.textContent = label;
            const val = document.createElement("span");
            val.className = "ssd-value";
            val.textContent = value;
            cell.appendChild(lbl);
            cell.appendChild(val);
            stpInfo.appendChild(cell);
        }

        addStpField("Site", stp.siteName);
        addStpField("Location", stp.siteLocation);
        addStpField("Crew", stp.crewMembers);
        addStpField("Type", getEntryTypeLabel(stp.entryType));
        addStpField("Unit Size", stp.unitSize);
        if (stp.parentStp) { addStpField("Parent STP", stp.parentStp); }
        if (stp.supDirection) { addStpField("Sup Direction", stp.supDirection); }
        if (stp.gpsLatitude || stp.gpsLongitude) {
            addStpField("GPS", (stp.gpsLatitude || "-") + ", " + (stp.gpsLongitude || "-"));
        }
        addStpField("Depth Unit", stp.depthUnit || defaultDepthUnit);
        card.appendChild(stpInfo);

        const strataContainer = document.createElement("div");
        strataContainer.className = "saved-strata-list";

        const sortedStrata = stp.strata.slice().sort(function (a, b) {
            return Number(a.stratumLabel) - Number(b.stratumLabel);
        });

        sortedStrata.forEach(function (stratum) {
            const item = document.createElement("div");
            item.className = "saved-stratum-item";

            const itemHead = document.createElement("div");
            itemHead.className = "saved-stratum-item-head";
            itemHead.textContent = "Stratum " + (stratum.stratumLabel || "-");
            item.appendChild(itemHead);

            const dataGrid = document.createElement("div");
            dataGrid.className = "saved-stratum-data";

            function addField(label, value) {
                if (!value) return;
                const cell = document.createElement("div");
                cell.className = "ssd-cell";
                const lbl = document.createElement("span");
                lbl.className = "ssd-label";
                lbl.textContent = label;
                const val = document.createElement("span");
                val.className = "ssd-value";
                val.textContent = value;
                cell.appendChild(lbl);
                cell.appendChild(val);
                dataGrid.appendChild(cell);
            }

            addField("Depth", stratum.depth);
            addField("Munsell", stratum.munsell);
            addField("Soil Type", stratum.soilType);
            addField("Horizon", stratum.horizon);
            addField("Artifact Catalog", stratum.artifactCatalog);
            addField("Artifact Summary", stratum.artifactSummary);
            addField("Notes", stratum.notes);

            item.appendChild(dataGrid);

            const photoEntries = getStratumPhotoEntries(stratum);
            if (photoEntries.length > 0) {
                const photosRow = document.createElement("div");
                photosRow.className = "saved-stratum-photos";
                const photosLabel = document.createElement("span");
                photosLabel.className = "ssd-label";
                photosLabel.textContent = "Photos";
                const photoLinks = document.createElement("div");
                photoLinks.className = "saved-photo-links";

                photoEntries.forEach(function (photoEntry) {
                    const openButton = document.createElement("button");
                    const photoName = normalizeTextValue(photoEntry && photoEntry.name) || "Photo";
                    const photoId = normalizeTextValue(photoEntry && photoEntry.id);
                    const photoContext = buildSavedPhotoContextLabel(stp, stratum);

                    openButton.type = "button";
                    openButton.className = "saved-photo-open-button";
                    openButton.setAttribute("data-open-photo-name", photoName);
                    openButton.setAttribute("data-open-photo-context", photoContext);

                    if (photoId) {
                        openButton.setAttribute("data-open-photo-id", photoId);
                    }

                    openButton.textContent = photoName;
                    photoLinks.appendChild(openButton);
                });

                photosRow.appendChild(photosLabel);
                photosRow.appendChild(photoLinks);
                item.appendChild(photosRow);
            }

            strataContainer.appendChild(item);
        });

        card.appendChild(strataContainer);
        elements.savedStpList.appendChild(card);
    });

    renderReferencePhotoLibrary();
}

function suggestFromCurrentInput() {
    const currentLabel = elements.stpLabel.value.trim();
    const baseLabel = currentLabel || (state.stps.length > 0 ? state.stps[state.stps.length - 1].stpLabel : "");
    const suggestion = suggestNextStpLabel(baseLabel);

    if (!suggestion) {
        alert("Try entering a label like A1, A2, or B3 first.");
        return;
    }

    elements.stpLabel.value = suggestion;
    refreshPhotoRulesAll();
    updateActiveStpBar();
}

function suggestNextStpLabel(label) {
    const parts = /^([A-Za-z]+)(\d+)$/.exec(label || "");

    if (!parts) {
        return "";
    }

    const prefix = parts[1].toUpperCase();
    const currentNumber = Number(parts[2]);

    if (Number.isNaN(currentNumber)) {
        return "";
    }

    return prefix + String(currentNumber + 1);
}

function applyDepthUnitUi() {
    const unit = elements.depthUnit.value;

    elements.strataList.querySelectorAll('[data-field="depth"]').forEach(function (field) {
        field.placeholder = getDepthPlaceholderForUnit(unit);
    });
}

function parseStpLabel(stpLabel) {
    const match = /^([A-Za-z]+)\s*(\d+)$/.exec((stpLabel || "").trim());

    if (!match) {
        return {
            transect: "",
            unit: ""
        };
    }

    return {
        transect: match[1].toUpperCase(),
        unit: match[2]
    };
}

function parseMunsellValue(munsellText) {
    const cleanText = (munsellText || "").trim();

    if (!cleanText) {
        return {
            munsell1: "",
            munsell2: "",
            munsell3: "",
            munsellCombined: ""
        };
    }

    const compactText = cleanText
        .replace(/\s*\/\s*/g, "/")
        .replace(/\s+/g, "");

    const compactMatch = /^([0-9.]*[A-Za-z]+)([0-9.]+\/)([0-9.]+)$/.exec(compactText);

    if (compactMatch) {
        const munsell1 = compactMatch[1].toUpperCase();
        const munsell2 = compactMatch[2];
        const munsell3 = compactMatch[3];

        return {
            munsell1: munsell1,
            munsell2: munsell2,
            munsell3: munsell3,
            munsellCombined: munsell1 + munsell2 + munsell3
        };
    }

    return {
        munsell1: cleanText,
        munsell2: "",
        munsell3: "",
        munsellCombined: cleanText
    };
}

function getExportStpLabel(stp) {
    const type = stp.entryType || "base";

    if (type === "supplemental" && stp.parentStp) {
        return stp.parentStp;
    }

    return stp.stpLabel || "";
}

function getMunsellPartsForExport(stratum) {
    const m1 = (stratum.munsell1 || "").trim();
    const m2 = (stratum.munsell2 || "").trim();
    const m3 = (stratum.munsell3 || "").trim();
    const combined = (stratum.munsell || "").trim();

    if (m1 || m2 || m3) {
        return {
            munsell1: m1,
            munsell2: m2,
            munsell3: m3,
            munsellCombined: combined || (m1 + m2 + m3)
        };
    }

    return parseMunsellValue(combined);
}

function buildFlatExportRows() {
    const rows = [];

    state.stps.forEach(function (stp) {
        const exportStp = getExportStpLabel(stp);
        const stpParts = parseStpLabel(exportStp);
        const sortedStrata = stp.strata.slice().sort(function (a, b) {
            return Number(a.stratumLabel) - Number(b.stratumLabel);
        });

        sortedStrata.forEach(function (stratum) {
            const photoNames = getStratumPhotoNames(stratum).join("; ");

            rows.push({
                "Sup": stp.supDirection || "",
                "Transect": stpParts.transect,
                "Unit": stpParts.unit,
                "STP": exportStp,
                "Stratum": stratum.stratumLabel,
                "Depth": stratum.depth,
                "Munsell": stratum.munsell,
                "Texture": stratum.soilType,
                "Horizon": stratum.horizon,
                "Notes/Inclusions": stratum.notes,
                "Artifact Catalog": stratum.artifactCatalog || "",
                "Artifact Summary": stratum.artifactSummary || "",
                "Photo Names": photoNames,
                "Site Name": stp.siteName,
                "Site Location": stp.siteLocation,
                "Crew Members": stp.crewMembers || "",
                "Depth Unit": stp.depthUnit || defaultDepthUnit,
                "STP Entry Type": stp.entryType || "base",
                "Unit Size": stp.unitSize || "",
                "Parent STP": stp.parentStp || "",
                "Recorded STP Label": stp.stpLabel || "",
                "GPS Latitude": stp.gpsLatitude || "",
                "GPS Longitude": stp.gpsLongitude || ""
            });
        });
    });

    return rows;
}

function getExportHeaders() {
    return [
        "Sup",
        "Transect",
        "Unit",
        "STP",
        "Stratum",
        "Depth",
        "Munsell",
        "Texture",
        "Horizon",
        "Notes/Inclusions",
        "Artifact Catalog",
        "Artifact Summary",
        "Photo Names",
        "Site Name",
        "Site Location",
        "Crew Members",
        "Depth Unit",
        "STP Entry Type",
        "Unit Size",
        "Parent STP",
        "Recorded STP Label",
        "GPS Latitude",
        "GPS Longitude"
    ];
}

function buildFilenameBase() {
    const base = (state.siteName || "crew-chief-export")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return base || "crew-chief-export";
}

function escapeKmlText(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function buildKmlPlacemark(name, latitude, longitude, description) {
    return [
        "<Placemark>",
        "<name>" + escapeKmlText(name) + "</name>",
        "<description><![CDATA[" + String(description || "").replace(/]]>/g, "]]><![CDATA[>") + "]]></description>",
        "<Point><coordinates>" + longitude + "," + latitude + ",0</coordinates></Point>",
        "</Placemark>"
    ].join("");
}

function downloadKml() {
    const placemarks = [];
    const stpPlacemarks = [];
    const gpsPlacemarks = [];

    state.stps.forEach(function (stp) {
        const latitude = parseGpsCoordinate(stp && stp.gpsLatitude, -90, 90);
        const longitude = parseGpsCoordinate(stp && stp.gpsLongitude, -180, 180);

        if (latitude == null || longitude == null) {
            return;
        }

        const label = getExportStpLabel(stp) || stp.stpLabel || "STP";
        const description = [
            "Site: " + escapeKmlText(stp.siteName),
            "Location: " + escapeKmlText(stp.siteLocation),
            "Entry Type: " + escapeKmlText(stp.entryType || "base"),
            "Strata: " + escapeKmlText(stp.strata ? stp.strata.length : 0)
        ].join("&#10;");

        stpPlacemarks.push(buildKmlPlacemark(label, latitude, longitude, description));
    });

    if (gpsRegistry && gpsRegistry.points instanceof Map) {
        gpsRegistry.points.forEach(function (point) {
            const latitude = parseGpsCoordinate(point && point.lat, -90, 90);
            const longitude = parseGpsCoordinate(point && point.lon, -180, 180);

            if (latitude == null || longitude == null) {
                return;
            }

            const description = [
                "Type: " + escapeKmlText(point.type || "GPS point"),
                "Source: " + escapeKmlText(point.source),
                "Status: " + escapeKmlText(point.status),
                "Point ID: " + escapeKmlText(point.id)
            ].join("&#10;");

            gpsPlacemarks.push(buildKmlPlacemark(point.label || point.id || "GPS Point", latitude, longitude, description));
        });
    }

    if (stpPlacemarks.length === 0 && gpsPlacemarks.length === 0) {
        alert("Save or mark at least one GPS point before downloading KML.");
        return;
    }

    placemarks.push("<Folder><name>STPs</name>" + stpPlacemarks.join("") + "</Folder>");
    placemarks.push("<Folder><name>GPS Points</name>" + gpsPlacemarks.join("") + "</Folder>");

    const kmlText = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        "<Document>",
        "<name>" + escapeKmlText(state.siteName || "Crew Chief GPS Export") + "</name>",
        placemarks.join(""),
        "</Document>",
        "</kml>"
    ].join("");

    const fileBlob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = (buildFilenameBase() || "crew-chief-export") + ".kml";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
}

function downloadExcelReadyXlsx() {
    if (state.stps.length === 0) {
        alert("Save at least one STP before downloading the Excel-ready export.");
        return;
    }

    if (typeof XLSX === "undefined") {
        alert("XLSX export library was not loaded. Downloading CSV instead.");
        downloadExcelReadyCsv();
        return;
    }

    const exportRows = buildFlatExportRows();
    const headers = getExportHeaders();
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "STPs_Export");

    const filenameBase = buildFilenameBase() || "archaeolab-stp-export";
    XLSX.writeFile(workbook, filenameBase + ".xlsx");
}

function escapeCsvValue(value) {
    const stringValue = String(value == null ? "" : value);

    if (/[",\n]/.test(stringValue)) {
        return '"' + stringValue.replace(/"/g, '""') + '"';
    }

    return stringValue;
}

function buildExcelReadyCsvText() {
    const exportRows = buildFlatExportRows();
    const headers = getExportHeaders();
    const csvLines = [headers.join(",")];

    exportRows.forEach(function (row) {
        const line = headers.map(function (header) {
            return escapeCsvValue(row[header]);
        }).join(",");

        csvLines.push(line);
    });

    return csvLines.join("\n");
}

function triggerCsvDownload(csvText, filename) {
    const fileBlob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
}

function triggerJsonDownload(jsonText, filename) {
    const fileBlob = new Blob([jsonText], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
}

function supportsDesignatedBackupFile() {
    return typeof window.showSaveFilePicker === "function" && supportsIndexedDbPersistence();
}

function buildSessionBackupFilenameBase() {
    const base = (state.siteName || "crew-chief-session")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return base || "crew-chief-session";
}

function buildJsonBackupHandleLegacyKey(siteSlug) {
    return "session-json-backup:" + siteSlug;
}

function buildJsonBackupHandleKey() {
    return appJsonBackupHandleKey;
}

function formatBackupSavedAt(value) {
    if (!value) {
        return "";
    }

    try {
        const dateValue = new Date(value);
        if (Number.isNaN(dateValue.getTime())) {
            return "";
        }

        return dateValue.toLocaleString();
    } catch (_error) {
        return "";
    }
}

function setBackupDestinationStatusMessage(text, isWarning) {
    if (!elements.backupDestinationStatus) {
        return;
    }

    elements.backupDestinationStatus.textContent = text;
    elements.backupDestinationStatus.classList.toggle("is-warning", Boolean(isWarning));
}

async function readStoredDesignatedJsonBackupHandle(siteSlug) {
    const primaryHandleKey = buildJsonBackupHandleKey();
    let fileHandle = await readFileHandle(primaryHandleKey);

    if (fileHandle) {
        return {
            fileHandle: fileHandle,
            storageKey: primaryHandleKey
        };
    }

    const legacyHandleKey = buildJsonBackupHandleLegacyKey(siteSlug);

    if (legacyHandleKey !== primaryHandleKey) {
        fileHandle = await readFileHandle(legacyHandleKey);

        if (fileHandle) {
            await writeFileHandle(primaryHandleKey, fileHandle);
            return {
                fileHandle: fileHandle,
                storageKey: legacyHandleKey
            };
        }
    }

    return {
        fileHandle: null,
        storageKey: ""
    };
}

async function updateBackupDestinationStatus(options) {
    if (!elements.backupDestinationStatus) {
        return;
    }

    if (elements.setBackupFileButton) {
        elements.setBackupFileButton.hidden = !supportsDesignatedBackupFile();
    }

    if (!supportsDesignatedBackupFile()) {
        setBackupDestinationStatusMessage(
            "Persistent app backup file is not supported in this browser. JSON backups download through the browser instead.",
            true
        );
        return;
    }

    const requestId = backupDestinationStatusRequestId + 1;
    backupDestinationStatusRequestId = requestId;

    const siteSlug = buildFilenameBase() || "archaeolab-stp-export";
    const storedHandle = await readStoredDesignatedJsonBackupHandle(siteSlug);

    if (requestId !== backupDestinationStatusRequestId) {
        return;
    }

    const normalizedOptions = options && typeof options === "object" ? options : {};
    const fileName = normalizeTextValue(normalizedOptions.fileName)
        || normalizeTextValue(storedHandle.fileHandle && storedHandle.fileHandle.name)
        || designatedJsonBackupFileName;

    if (normalizedOptions.savedAt) {
        designatedJsonBackupLastSavedAt = normalizedOptions.savedAt;
    }

    if (!fileName) {
        designatedJsonBackupFileName = "";
        setBackupDestinationStatusMessage(
            "App backup file not set. Use Set App Backup File so JSON backups always save to the same place.",
            true
        );
        return;
    }

    designatedJsonBackupFileName = fileName;
    const savedAtText = formatBackupSavedAt(designatedJsonBackupLastSavedAt);
    const summarySuffix = savedAtText ? " Last JSON save: " + savedAtText + "." : "";

    setBackupDestinationStatusMessage(
        "App backup file: "
            + designatedJsonBackupFileName
            + "."
            + summarySuffix
            + " Use Import JSON Backup + Photos to load this file directly.",
        false
    );
}

async function handleSetBackupFileClick() {
    if (!supportsDesignatedBackupFile()) {
        alert("This browser does not support choosing a persistent app backup file. Use Download JSON Backup + Photos.");
        return;
    }

    const siteSlug = buildFilenameBase() || "archaeolab-stp-export";
    const suggestedName = (buildSessionBackupFilenameBase() || "archaeolab-stp-session") + ".json";

    try {
        const fileHandle = await resolveDesignatedJsonBackupHandle(siteSlug, suggestedName, true, true);

        if (!fileHandle) {
            return;
        }

        designatedJsonBackupFileName = normalizeTextValue(fileHandle.name) || suggestedName;
        await updateBackupDestinationStatus({
            fileName: designatedJsonBackupFileName
        });
        setReferencePhotoMessage(
            "App backup file set to " + designatedJsonBackupFileName + ". JSON backups now save there.",
            false
        );
    } catch (error) {
        if (error && error.name === "AbortError") {
            return;
        }

        console.warn("Could not set app backup file.", error);
        alert("Could not set app backup file.");
    }
}

async function resolveDesignatedJsonBackupHandle(siteSlug, suggestedName, shouldPromptIfMissing, forcePrompt) {
    if (!supportsDesignatedBackupFile()) {
        return null;
    }

    const handleKey = buildJsonBackupHandleKey();
    const shouldForcePrompt = Boolean(forcePrompt);
    let fileHandle = null;

    if (!shouldForcePrompt) {
        const storedHandle = await readStoredDesignatedJsonBackupHandle(siteSlug);
        fileHandle = storedHandle.fileHandle;
    }

    if (fileHandle) {
        const permission = await fileHandle.queryPermission({ mode: "readwrite" });

        if (permission === "prompt") {
            const result = await fileHandle.requestPermission({ mode: "readwrite" });
            if (result !== "granted") {
                fileHandle = null;
            }
        } else if (permission === "denied") {
            fileHandle = null;
        }
    }

    if (!fileHandle && shouldPromptIfMissing) {
        fileHandle = await window.showSaveFilePicker({
            suggestedName: suggestedName,
            types: [{ description: "JSON backup", accept: { "application/json": [".json"] } }],
            excludeAcceptAllOption: true
        });
        await writeFileHandle(handleKey, fileHandle);
    }

    return fileHandle;
}

async function saveJsonBackupToPreferredDestination(backupPayload, options) {
    const allowDownloadFallback = !options || options.allowDownloadFallback !== false;
    const shouldPromptIfMissing = !options || options.shouldPromptIfMissing !== false;
    const siteSlug = buildFilenameBase() || "archaeolab-stp-export";
    const filenameBase = buildSessionBackupFilenameBase() || "archaeolab-stp-session";
    const suggestedName = filenameBase + ".json";
    const jsonText = JSON.stringify(backupPayload, null, 2);
    const supportsDesignatedFile = typeof window.showSaveFilePicker === "function" && supportsIndexedDbPersistence();

    if (supportsDesignatedFile) {
        try {
            const fileHandle = await resolveDesignatedJsonBackupHandle(siteSlug, suggestedName, shouldPromptIfMissing);

            if (fileHandle) {
                const writable = await fileHandle.createWritable();
                await writable.write(jsonText);
                await writable.close();

                const savedAt = new Date().toISOString();
                designatedJsonBackupFileName = normalizeTextValue(fileHandle.name) || suggestedName;
                designatedJsonBackupLastSavedAt = savedAt;
                await updateBackupDestinationStatus({
                    fileName: designatedJsonBackupFileName,
                    savedAt: savedAt
                });

                return {
                    savedToDesignatedFile: true,
                    downloaded: false,
                    cancelled: false,
                    unavailable: false,
                    fileName: designatedJsonBackupFileName
                };
            }
        } catch (error) {
            if (error && error.name === "AbortError") {
                return {
                    savedToDesignatedFile: false,
                    downloaded: false,
                    cancelled: true,
                    unavailable: false,
                    fileName: ""
                };
            }

            console.warn("Could not write JSON backup to designated file.", error);
        }
    }

    if (allowDownloadFallback) {
        triggerJsonDownload(jsonText, suggestedName);
        return {
            savedToDesignatedFile: false,
            downloaded: true,
            cancelled: false,
            unavailable: !supportsDesignatedFile,
            fileName: suggestedName
        };
    }

    return {
        savedToDesignatedFile: false,
        downloaded: false,
        cancelled: false,
        unavailable: !supportsDesignatedFile,
        fileName: ""
    };
}

async function saveAutoJsonBackupAfterStpSave() {
    if (!autoJsonBackupOnSaveStp || state.stps.length === 0) {
        return;
    }

    try {
        const backupPayload = await buildSessionBackupPayload();
        const backupResult = await saveJsonBackupToPreferredDestination(backupPayload, {
            allowDownloadFallback: false,
            shouldPromptIfMissing: true
        });
        const missingPhotoCount = backupPayload.missingPhotoIds.length;

        if (backupResult.savedToDesignatedFile) {
            const destinationFile = backupResult.fileName || "the designated app backup file";
            setReferencePhotoMessage(
                missingPhotoCount > 0
                    ? "Auto JSON backup updated in "
                        + destinationFile
                        + ", but "
                        + String(missingPhotoCount)
                        + " photo(s) were already missing from app storage and were not included."
                    : "Auto JSON backup updated in " + destinationFile + ".",
                missingPhotoCount > 0
            );
            return;
        }

        if (backupResult.cancelled) {
            setReferencePhotoMessage(
                "Auto JSON backup was skipped. Choose a file when prompted to enable between-STP backups.",
                true
            );
            return;
        }

        if (backupResult.unavailable) {
            setReferencePhotoMessage(
                "Auto JSON backup requires browser file-save support. Use Download JSON Backup + Photos manually.",
                true
            );
        }
    } catch (error) {
        console.warn("Could not complete auto JSON backup.", error);
        setReferencePhotoMessage("Auto JSON backup failed. Use Download JSON Backup + Photos.", true);
    }
}

function downloadExcelReadyCsv() {
    if (state.stps.length === 0) {
        alert("Save at least one STP before downloading CSV.");
        return;
    }

    const filenameBase = buildFilenameBase() || "archaeolab-stp-export";
    const csvText = buildExcelReadyCsvText();
    triggerCsvDownload(csvText, filenameBase + ".csv");
}

async function downloadSessionData() {
    if (state.stps.length === 0) {
        alert("Save at least one STP before downloading the session backup.");
        return;
    }

    try {
        const backupPayload = await buildSessionBackupPayload();
        const backupResult = await saveJsonBackupToPreferredDestination(backupPayload, {
            allowDownloadFallback: true,
            shouldPromptIfMissing: true
        });
        const bundledPhotoCount = backupPayload.stpPhotos.length;
        const missingPhotoCount = backupPayload.missingPhotoIds.length;

        if (backupResult.cancelled) {
            return;
        }

        const destinationText = backupResult.savedToDesignatedFile
            ? "to " + (backupResult.fileName || "the designated app backup file")
            : "as a download (" + (backupResult.fileName || "session backup") + ")";

        setReferencePhotoMessage(
            missingPhotoCount > 0
                ? "JSON backup saved "
                    + destinationText
                    + ". Bundled "
                    + String(bundledPhotoCount)
                    + " saved STP photo(s); "
                    + String(missingPhotoCount)
                    + " photo(s) were not available in app storage and were not included."
                : "JSON backup saved "
                    + destinationText
                    + ". Bundled "
                    + String(bundledPhotoCount)
                    + " saved STP photo(s).",
            missingPhotoCount > 0
        );
    } catch (error) {
        console.warn("Could not download JSON backup.", error);
        alert("Could not download JSON backup.");
    }
}

function requestImportCsvFile() {
    if (!elements.importCsvInput) {
        return;
    }

    elements.importCsvInput.value = "";
    elements.importCsvInput.click();
}

function parseCsvTextRows(rawText) {
    const rows = [];
    const text = String(rawText || "");
    let currentRow = [];
    let currentValue = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (character === '"') {
            const nextCharacter = text[index + 1];

            if (inQuotes && nextCharacter === '"') {
                currentValue += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }

            continue;
        }

        if (character === "," && !inQuotes) {
            currentRow.push(currentValue);
            currentValue = "";
            continue;
        }

        if ((character === "\n" || character === "\r") && !inQuotes) {
            if (character === "\r" && text[index + 1] === "\n") {
                index += 1;
            }

            currentRow.push(currentValue);
            rows.push(currentRow);
            currentRow = [];
            currentValue = "";
            continue;
        }

        currentValue += character;
    }

    if (currentValue || currentRow.length > 0) {
        currentRow.push(currentValue);
        rows.push(currentRow);
    }

    return rows.filter(function (row) {
        return row.some(function (cellValue) {
            return normalizeTextValue(cellValue) !== "";
        });
    });
}

function parseCsvObjectsFallback(rawText) {
    const parsedRows = parseCsvTextRows(rawText);

    if (parsedRows.length < 2) {
        return [];
    }

    const headers = parsedRows[0].map(function (headerValue, index) {
        const normalizedHeader = String(headerValue == null ? "" : headerValue)
            .replace(/^\uFEFF/, "")
            .trim();

        return normalizedHeader || ("Column " + String(index + 1));
    });

    return parsedRows.slice(1).map(function (rowValues) {
        const row = {};

        headers.forEach(function (header, columnIndex) {
            row[header] = columnIndex < rowValues.length ? rowValues[columnIndex] : "";
        });

        return row;
    }).filter(function (row) {
        return Object.keys(row).some(function (header) {
            return normalizeTextValue(row[header]) !== "";
        });
    });
}

function parseCsvBackupRows(rawText) {
    const text = String(rawText || "");

    if (!normalizeTextValue(text)) {
        return [];
    }

    if (typeof XLSX !== "undefined") {
        try {
            const workbook = XLSX.read(text, { type: "string" });
            const firstSheetName = workbook.SheetNames[0];

            if (firstSheetName) {
                const worksheet = workbook.Sheets[firstSheetName];
                const parsedRows = XLSX.utils.sheet_to_json(worksheet, {
                    defval: "",
                    raw: false
                });

                if (Array.isArray(parsedRows) && parsedRows.length > 0) {
                    return parsedRows;
                }
            }
        } catch (error) {
            console.warn("Could not parse CSV with XLSX. Falling back to manual parser.", error);
        }
    }

    return parseCsvObjectsFallback(text);
}

function getCsvRowValue(row, candidateHeaders) {
    const source = row && typeof row === "object" ? row : {};

    for (const header of candidateHeaders) {
        if (!Object.prototype.hasOwnProperty.call(source, header)) {
            continue;
        }

        const value = normalizeTextValue(source[header]);

        if (value) {
            return value;
        }
    }

    return "";
}

function splitCsvPhotoNames(value) {
    const rawValue = normalizeTextValue(value);

    if (!rawValue) {
        return [];
    }

    return rawValue.split(";").map(function (name) {
        return normalizeTextValue(name);
    }).filter(Boolean);
}

function buildSessionFromCsvRows(csvRows) {
    const rows = Array.isArray(csvRows) ? csvRows : [];
    const stpMap = new Map();
    let sessionSiteName = "";
    let sessionSiteLocation = "";
    let sessionCrewMembers = "";
    let sessionDepthUnit = defaultDepthUnit;

    rows.forEach(function (row, rowIndex) {
        const siteName = getCsvRowValue(row, ["Site Name", "Site"]);
        const siteLocation = getCsvRowValue(row, ["Site Location", "Location"]);
        const crewMembers = getCsvRowValue(row, ["Crew Members", "Crew"]);
        const depthUnitToken = getCsvRowValue(row, ["Depth Unit"]);
        const depthUnit = normalizeDepthUnitValue(depthUnitToken || sessionDepthUnit);
        const entryType = normalizeEntryTypeValue(getCsvRowValue(row, ["STP Entry Type", "Entry Type"]) || "base");
        const unitSize = entryType === "unit-id"
            ? normalizeUnitSizeValue(getCsvRowValue(row, ["Unit Size"]))
            : "";
        const parentStp = entryType === "supplemental"
            ? getCsvRowValue(row, ["Parent STP"])
            : "";
        const supDirection = entryType === "supplemental"
            ? normalizeSupDirectionValue(getCsvRowValue(row, ["Sup", "Supplemental Direction"]))
            : "";
        const stpLabel = getCsvRowValue(row, ["Recorded STP Label", "STP", "Unit"]);

        if (!stpLabel) {
            return;
        }

        const gpsLatitude = getCsvRowValue(row, ["GPS Latitude", "Latitude"]);
        const gpsLongitude = getCsvRowValue(row, ["GPS Longitude", "Longitude"]);

        if (!sessionSiteName && siteName) {
            sessionSiteName = siteName;
        }

        if (!sessionSiteLocation && siteLocation) {
            sessionSiteLocation = siteLocation;
        }

        if (!sessionCrewMembers && crewMembers) {
            sessionCrewMembers = crewMembers;
        }

        if (depthUnitToken) {
            sessionDepthUnit = depthUnit;
        }

        const resolvedSiteName = siteName || sessionSiteName;
        const resolvedSiteLocation = siteLocation || sessionSiteLocation;
        const resolvedCrewMembers = crewMembers || sessionCrewMembers;

        const stpKey = [
            resolvedSiteName,
            resolvedSiteLocation,
            resolvedCrewMembers,
            depthUnit,
            entryType,
            unitSize,
            parentStp,
            supDirection,
            stpLabel,
            gpsLatitude,
            gpsLongitude
        ].join("||");

        if (!stpMap.has(stpKey)) {
            stpMap.set(stpKey, {
                siteName: resolvedSiteName,
                siteLocation: resolvedSiteLocation,
                crewMembers: resolvedCrewMembers,
                depthUnit: depthUnit,
                stpLabel: stpLabel,
                entryType: entryType,
                unitSize: unitSize,
                parentStp: parentStp,
                supDirection: supDirection,
                gpsLatitude: gpsLatitude,
                gpsLongitude: gpsLongitude,
                savedAt: new Date(Date.now() + rowIndex).toISOString(),
                strata: []
            });
        }

        const targetStp = stpMap.get(stpKey);
        const stratumLabel = getCsvRowValue(row, ["Stratum", "Stratum Label"]) || String(targetStp.strata.length + 1);

        targetStp.strata.push(normalizeImportedStratum({
            stratumLabel: stratumLabel,
            depth: getCsvRowValue(row, ["Depth"]),
            munsell: getCsvRowValue(row, ["Munsell"]),
            soilType: getCsvRowValue(row, ["Texture", "Soil Type"]),
            horizon: getCsvRowValue(row, ["Horizon"]),
            artifactCatalog: getCsvRowValue(row, ["Artifact Catalog"]),
            artifactSummary: getCsvRowValue(row, ["Artifact Summary"]),
            notes: getCsvRowValue(row, ["Notes/Inclusions", "Notes"]),
            photoNames: splitCsvPhotoNames(getCsvRowValue(row, ["Photo Names"])),
            photos: []
        }));
    });

    const importedStps = Array.from(stpMap.values()).map(function (stp) {
        stp.strata.sort(function (a, b) {
            const aNumber = Number(a.stratumLabel);
            const bNumber = Number(b.stratumLabel);

            if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
                return aNumber - bNumber;
            }

            return normalizeTextValue(a.stratumLabel).localeCompare(
                normalizeTextValue(b.stratumLabel),
                undefined,
                {
                    numeric: true,
                    sensitivity: "base"
                }
            );
        });

        return stp;
    });

    if (importedStps.length === 0) {
        return null;
    }

    return normalizeImportedSession({
        siteName: sessionSiteName || importedStps[0].siteName,
        siteLocation: sessionSiteLocation || importedStps[0].siteLocation,
        crewMembers: sessionCrewMembers || importedStps[0].crewMembers,
        depthUnit: sessionDepthUnit || defaultDepthUnit,
        stps: importedStps,
        projectImage: "",
        referencePhoto: ""
    });
}

function handleImportCsvFile() {
    if (!elements.importCsvInput) {
        return;
    }

    const file = elements.importCsvInput.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.addEventListener("load", async function () {
        try {
            const rawText = String(reader.result || "");
            const csvRows = parseCsvBackupRows(rawText);
            const importedSession = buildSessionFromCsvRows(csvRows);

            if (!importedSession || importedSession.stps.length === 0) {
                throw new Error("No valid STP records were found in CSV backup.");
            }

            if (!confirm("Import this CSV backup and replace the current session?")) {
                return;
            }

            const removedPhotoIds = collectPhotoIdsFromStps(state.stps);

            state.siteName = importedSession.siteName;
            state.siteLocation = importedSession.siteLocation;
            state.depthUnit = importedSession.depthUnit;
            state.stps = importedSession.stps;
            state.projectImage = importedSession.projectImage;
            state.referencePhoto = importedSession.referencePhoto;

            if (!saveSession()) {
                const importWarning = getDataSafetyAlertMessage("CSV backup loaded.");
                if (importWarning) {
                    alert(importWarning);
                }

                if (!dataSafetyState.lastCoreBackupSaveOk) {
                    return;
                }
            }

            populateSiteFields();
            refreshParentStpOptions();
            renderSavedStps();
            renderProjectBanner();
            renderReferencePhoto();
            resetCurrentStp(false);
            setProjectImageMessage("Imported CSV backup: " + file.name, false);
            setReferencePhotoMessage("", false);

            try {
                await cleanupDeletedPhotoIds(removedPhotoIds);
            } catch (cleanupError) {
                console.warn("Could not clean up replaced session photos.", cleanupError);
            }
        } catch (error) {
            console.warn("Could not import CSV backup.", error);
            alert("Could not import CSV backup. Confirm the file matches the Crew Chief CSV export format.");
        } finally {
            elements.importCsvInput.value = "";
        }
    });

    reader.addEventListener("error", function () {
        elements.importCsvInput.value = "";
        alert("The selected CSV file could not be read.");
    });

    reader.readAsText(file);
}

// ============================================
// GPS POINTS IMPORT FUNCTIONS
// ============================================

function requestImportGpsPointsFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.geojson,.json";
    input.addEventListener("change", function () {
        const file = input.files[0];
        if (file) {
            handleImportGpsPointsFile(file);
        }
    });
    input.click();
}

async function handleImportGpsPointsFile(file) {
    try {
        let points = [];
        
        if (file.name.endsWith(".geojson") || file.name.endsWith(".json")) {
            points = await parseGeoJsonFile(file);
        } else if (file.name.endsWith(".csv")) {
            points = await parseGpsPointsFromCsv(file);
        } else {
            throw new Error("Unsupported file format. Use CSV or GeoJSON.");
        }

        if (!points || points.length === 0) {
            alert("No GPS points found in file.");
            return;
        }

        const source = file.name;
        let importCount = 0;

        for (const point of points) {
            point.source = source;
            point.status = "unmarked";
            point.stpIndex = -1;
            point.importedAt = new Date().toISOString();
            
            try {
                await saveGpsPointToDatabase(point);
                importCount++;
            } catch (error) {
                console.warn("Could not save GPS point:", point, error);
            }
        }

        alert(`Imported ${importCount} GPS points from ${source}`);
        updateGpsMapButtonState();
        
        // Trigger map refresh if map window is open
        broadcastGpsPointsUpdated();
    } catch (error) {
        console.error("Error importing GPS points:", error);
        alert(`Could not import GPS points: ${error.message}`);
    }
}

async function parseGpsPointsFromCsv(file) {
    const text = await file.text();
    const rows = parseCsvTextRows(text);
    
    if (rows.length < 2) {
        throw new Error("CSV file is empty or invalid.");
    }

    const points = [];
    const headers = rows[0].map(h => normalizeTextValue(h).toLowerCase());
    
    // Expected columns: latitude, longitude, label, type (optional: base|supplemental|unit-id)
    const latIndex = headers.findIndex(h => h.includes("lat"));
    const lonIndex = headers.findIndex(h => h.includes("lon"));
    const labelIndex = headers.findIndex(h => h.includes("label") || h.includes("name"));
    const typeIndex = headers.findIndex(h => h.includes("type"));

    if (latIndex === -1 || lonIndex === -1) {
        throw new Error("CSV must contain 'latitude' and 'longitude' columns.");
    }

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const lat = parseFloat(row[latIndex]);
        const lon = parseFloat(row[lonIndex]);
        const label = labelIndex >= 0 ? row[labelIndex].trim() : `Point ${i}`;
        const type = typeIndex >= 0 ? row[typeIndex].trim() : "base";

        if (!isNaN(lat) && !isNaN(lon)) {
            points.push({
                id: generateUniqueId(),
                lat: Number(lat.toFixed(gpsCoordinateDecimalPlaces)),
                lon: Number(lon.toFixed(gpsCoordinateDecimalPlaces)),
                label: String(label),
                type: validEntryTypes.includes(type) ? type : "base",
                status: "unmarked",
                stpIndex: -1
            });
        }
    }

    return points;
}

async function parseGeoJsonFile(file) {
    const text = await file.text();
    const geoJson = JSON.parse(text);
    const points = [];

    if (geoJson.type === "FeatureCollection" && Array.isArray(geoJson.features)) {
        geoJson.features.forEach((feature, index) => {
            const coords = feature.geometry?.coordinates;
            if (coords && coords.length >= 2) {
                const props = feature.properties || {};
                points.push({
                    id: generateUniqueId(),
                    lat: Number(coords[1].toFixed(gpsCoordinateDecimalPlaces)),
                    lon: Number(coords[0].toFixed(gpsCoordinateDecimalPlaces)),
                    label: String(props.name || props.label || `Point ${index + 1}`),
                    type: validEntryTypes.includes(props.type) ? props.type : "base",
                    status: "unmarked",
                    stpIndex: -1,
                    metadata: props
                });
            }
        });
    } else if (geoJson.type === "Feature") {
        const coords = geoJson.geometry?.coordinates;
        if (coords && coords.length >= 2) {
            const props = geoJson.properties || {};
            points.push({
                id: generateUniqueId(),
                lat: Number(coords[1].toFixed(gpsCoordinateDecimalPlaces)),
                lon: Number(coords[0].toFixed(gpsCoordinateDecimalPlaces)),
                label: String(props.name || props.label || "Point 1"),
                type: validEntryTypes.includes(props.type) ? props.type : "base",
                status: "unmarked",
                stpIndex: -1,
                metadata: props
            });
        }
    }

    return points;
}

// Broadcast GPS points update to map iframe if open
function broadcastGpsPointsUpdated() {
    if (activeMapViewerObjectUrl) {
        try {
            const event = new CustomEvent("gps-points-updated", {
                detail: { timestamp: Date.now() }
            });
            window.dispatchEvent(event);
        } catch (error) {
            console.warn("Could not broadcast GPS points update:", error);
        }
    }
}

// ============================================
// CURRENT LOCATION TRACKING
// ============================================

function startCurrentLocationTracking() {
    if (!("geolocation" in navigator) || currentLocationWatchId !== null) {
        return;
    }

    try {
        currentLocationWatchId = navigator.geolocation.watchPosition(
            function (position) {
                currentLocation = {
                    lat: Number(position.coords.latitude.toFixed(gpsCoordinateDecimalPlaces)),
                    lon: Number(position.coords.longitude.toFixed(gpsCoordinateDecimalPlaces)),
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                };

                // Broadcast to map viewer
                gpsEventBus.dispatchEvent(new CustomEvent("location-updated", {
                    detail: currentLocation
                }));
            },
            function (error) {
                console.warn("Current location tracking error:", error);
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 5000
            }
        );
    } catch (error) {
        console.warn("Could not start location tracking:", error);
    }
}

function stopCurrentLocationTracking() {
    if (currentLocationWatchId !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(currentLocationWatchId);
        currentLocationWatchId = null;
        currentLocation = null;
    }
}

function getCurrentLocation() {
    return currentLocation ? { ...currentLocation } : null;
}

async function importSessionBackupFromText(rawText, sourceLabel) {
    const parsedData = JSON.parse(String(rawText || ""));
    const backupPayload = extractSessionBackupPayload(parsedData);
    let importedSession = normalizeImportedSession(backupPayload.sessionData);
    const bundledPhotoCount = backupPayload.bundledPhotos.length;
    let photoImportMessage = "";
    let photoImportIsError = false;

    if (!confirm(
        bundledPhotoCount > 0
            ? "Import this JSON backup and replace the current session? "
                + String(bundledPhotoCount)
                + " STP photo file(s) will also be restored."
            : "Import this JSON backup and replace the current session?"
    )) {
        return {
            imported: false,
            cancelled: true
        };
    }

    if (bundledPhotoCount > 0) {
        const restoreResult = await restoreBundledPhotoEntries(backupPayload.bundledPhotos);

        if (restoreResult.failedPhotoIds.length > 0) {
            stripUnavailableImportedPhotoIds(importedSession, restoreResult.restoredPhotoIds);
            photoImportIsError = true;
        }

        photoImportMessage = restoreResult.failedPhotoIds.length > 0
            ? "Restored "
                + String(restoreResult.restoredPhotoIds.length)
                + " STP photo(s); "
                + String(restoreResult.failedPhotoIds.length)
                + " could not be restored."
            : "Restored " + String(restoreResult.restoredPhotoIds.length) + " STP photo(s).";
    } else {
        const referencedPhotoCount = collectPhotoIdsFromStps(importedSession.stps).length;

        if (referencedPhotoCount > 0) {
            photoImportMessage = "Legacy JSON backup: STP photo labels imported, but this older backup does not include the actual STP photo files.";
        }
    }

    if (backupPayload.missingPhotoIds.length > 0) {
        photoImportMessage += (photoImportMessage ? " " : "")
            + "Backup file was created with "
            + String(backupPayload.missingPhotoIds.length)
            + " STP photo(s) already missing from app storage.";
        photoImportIsError = true;
    }

    const removedPhotoIds = collectPhotoIdsFromStps(state.stps);

    state.siteName = importedSession.siteName;
    state.siteLocation = importedSession.siteLocation;
    state.depthUnit = importedSession.depthUnit;
    state.stps = importedSession.stps;
    state.projectImage = importedSession.projectImage;
    state.referencePhoto = importedSession.referencePhoto;

    if (!saveSession()) {
        const importWarning = getDataSafetyAlertMessage("Imported session loaded.");
        if (importWarning) {
            alert(importWarning);
        }

        if (!dataSafetyState.lastCoreBackupSaveOk) {
            return {
                imported: false,
                cancelled: false
            };
        }
    }

    populateSiteFields();
    refreshParentStpOptions();
    renderSavedStps();
    renderProjectBanner();
    renderReferencePhoto();
    resetCurrentStp(false);
    setProjectImageMessage("Imported session backup: " + (sourceLabel || "selected file"), false);
    setReferencePhotoMessage(photoImportMessage, photoImportIsError);

    try {
        await cleanupDeletedPhotoIds(removedPhotoIds);
    } catch (cleanupError) {
        console.warn("Could not clean up replaced session photos.", cleanupError);
    }

    return {
        imported: true,
        cancelled: false
    };
}

async function tryImportSessionFromDesignatedBackupFile() {
    if (!supportsDesignatedBackupFile()) {
        return {
            handled: false,
            imported: false
        };
    }

    const siteSlug = buildFilenameBase() || "archaeolab-stp-export";
    const storedHandle = await readStoredDesignatedJsonBackupHandle(siteSlug);
    const fileHandle = storedHandle.fileHandle;

    if (!fileHandle) {
        return {
            handled: false,
            imported: false
        };
    }

    try {
        if (typeof fileHandle.queryPermission === "function") {
            let permission = await fileHandle.queryPermission({ mode: "read" });

            if (permission === "prompt" && typeof fileHandle.requestPermission === "function") {
                permission = await fileHandle.requestPermission({ mode: "read" });
            }

            if (permission === "denied") {
                return {
                    handled: false,
                    imported: false
                };
            }
        }

        const backupFile = await fileHandle.getFile();
        const sourceLabel = normalizeTextValue(backupFile && backupFile.name)
            || designatedJsonBackupFileName
            || "designated app backup file";
        const importResult = await importSessionBackupFromText(await backupFile.text(), sourceLabel);

        if (importResult.imported) {
            designatedJsonBackupFileName = sourceLabel;
            await updateBackupDestinationStatus({
                fileName: sourceLabel
            });
        }

        return {
            handled: true,
            imported: importResult.imported
        };
    } catch (error) {
        console.warn("Could not import from designated app backup file.", error);
        return {
            handled: false,
            imported: false
        };
    }
}

async function requestImportSessionFile() {
    const designatedImport = await tryImportSessionFromDesignatedBackupFile();

    if (designatedImport.handled) {
        return;
    }

    if (!elements.importJsonInput) {
        return;
    }

    elements.importJsonInput.value = "";
    elements.importJsonInput.click();
}

function handleImportSessionFile() {
    const file = elements.importJsonInput.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.addEventListener("load", async function () {
        try {
            const rawText = String(reader.result || "");
            await importSessionBackupFromText(rawText, file.name || "selected file");
        } catch (error) {
            console.warn("Could not import JSON backup.", error);
            alert("Could not import JSON backup. Confirm the file is a valid session export.");
        } finally {
            elements.importJsonInput.value = "";
        }
    });

    reader.addEventListener("error", function () {
        elements.importJsonInput.value = "";
        alert("The selected JSON file could not be read.");
    });

    reader.readAsText(file);
}

async function clearSession() {
    if (!confirm("Clear the saved STP session and start over?")) {
        return;
    }

    const removedPhotoIds = collectPhotoIdsFromStps(state.stps);

    state.siteName = "";
    state.siteLocation = "";
    state.crewMembers = loadRecentCrewMembers();
    state.depthUnit = defaultDepthUnit;
    state.stps = [];
    state.projectImage = "";
    state.referencePhoto = "";

    localStorage.removeItem(storageKey);
    localStorage.removeItem(coreDataBackupStorageKey);
    queueSessionDeleteFromIndexedDb();
    dataSafetyState.loadedFromCoreBackup = false;
    dataSafetyState.lastFullSessionSaveOk = true;
    dataSafetyState.lastCoreBackupSaveOk = true;
    populateSiteFields();
    refreshParentStpOptions();
    renderSavedStps();
    renderProjectBanner();
    renderReferencePhoto();
    setProjectImageMessage("", false);
    setReferencePhotoMessage("", false);
    elements.projectImageInput.value = "";
    resetCurrentStp(true);
    updateDataSafetyStatus();

    try {
        await cleanupDeletedPhotoIds(removedPhotoIds);
    } catch (error) {
        console.warn("Could not remove deleted session photos.", error);
    }
}

function loadLegacyProjectsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(projectsStorageKey);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);
        return normalizeImportedProjects(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
        console.warn("Could not load legacy localStorage projects.", error);
        return [];
    }
}

function queueProjectsSaveToIndexedDb(projects, latestProjectForBackup) {
    if (!supportsIndexedDbPersistence()) {
        return;
    }

    const normalizedProjects = normalizeImportedProjects(projects);
    const fallbackProject = latestProjectForBackup
        ? normalizeImportedProject(latestProjectForBackup, "backup-" + String(Date.now()))
        : (normalizedProjects[normalizedProjects.length - 1] || null);

    projectsSaveQueue = projectsSaveQueue
        .catch(function () {
            return undefined;
        })
        .then(async function () {
            await writeAppDataValue(appDataProjectsEntryKey, normalizedProjects);
            projectStorageState.loadedFromCoreBackup = false;
            projectStorageState.lastFullProjectsSaveOk = true;
            projectStorageState.lastCoreBackupSaveOk = true;

            try {
                localStorage.removeItem(projectsStorageKey);
            } catch (cleanupError) {
                console.warn("Could not clear legacy projects key.", cleanupError);
            }

            try {
                localStorage.removeItem(projectsCoreBackupStorageKey);
            } catch (cleanupError) {
                console.warn("Could not clear project emergency backup key.", cleanupError);
            }
        })
        .catch(function (error) {
            console.warn("Could not save projects to IndexedDB.", error);

            const backupSaved = saveLatestProjectCoreBackup(fallbackProject);
            projectStorageState.loadedFromCoreBackup = backupSaved;
            projectStorageState.lastFullProjectsSaveOk = false;
            projectStorageState.lastCoreBackupSaveOk = backupSaved;

            if (backupSaved) {
                alert("Full project storage is full. The latest project was saved in emergency core backup mode without map/reference images.");
            } else {
                alert("Project could not be saved. Browser storage is full and emergency backup also failed. Export JSON immediately.");
            }
        })
        .finally(function () {
            updateDataSafetyStatus();
            updateImageStorageStatus();
        });
}

async function initializeProjectsStore() {
    let primaryProjects = [];
    let primaryLoadFailed = false;
    let loadedFromIndexedDb = false;
    let loadedFromLegacyLocalStorage = false;

    if (supportsIndexedDbPersistence()) {
        try {
            const indexedDbProjects = await readAppDataValue(appDataProjectsEntryKey);

            if (Array.isArray(indexedDbProjects)) {
                primaryProjects = normalizeImportedProjects(indexedDbProjects);
                loadedFromIndexedDb = true;
            }
        } catch (error) {
            primaryLoadFailed = true;
            console.warn("Could not load projects from IndexedDB.", error);
        }
    }

    if (!loadedFromIndexedDb) {
        primaryProjects = loadLegacyProjectsFromLocalStorage();
        loadedFromLegacyLocalStorage = primaryProjects.length > 0;
    }

    const emergencyProject = loadLatestProjectCoreBackup();
    const mergedProjects = primaryProjects.slice();
    let loadedFromEmergencyBackup = false;

    if (emergencyProject) {
        const existingIndex = mergedProjects.findIndex(function (project) {
            return project.id === emergencyProject.id;
        });

        if (existingIndex === -1) {
            mergedProjects.push(emergencyProject);
            loadedFromEmergencyBackup = true;
        } else {
            const existingSavedAt = Date.parse(mergedProjects[existingIndex].savedAt || "") || 0;
            const backupSavedAt = Date.parse(emergencyProject.savedAt || "") || 0;

            if (backupSavedAt > existingSavedAt) {
                const existingProject = mergedProjects[existingIndex];
                mergedProjects[existingIndex] = {
                    id: emergencyProject.id,
                    name: emergencyProject.name,
                    savedAt: emergencyProject.savedAt,
                    siteName: emergencyProject.siteName,
                    siteLocation: emergencyProject.siteLocation,
                    depthUnit: emergencyProject.depthUnit,
                    stps: emergencyProject.stps,
                    projectImage: existingProject.projectImage || "",
                    referencePhoto: existingProject.referencePhoto || ""
                };
                loadedFromEmergencyBackup = true;
            }
        }
    }

    projectsStoreCache = mergedProjects;
    projectStorageState.loadedFromCoreBackup = loadedFromEmergencyBackup;

    if (primaryLoadFailed && !loadedFromLegacyLocalStorage) {
        projectStorageState.lastFullProjectsSaveOk = false;
        projectStorageState.lastCoreBackupSaveOk = Boolean(emergencyProject);
    } else {
        projectStorageState.lastFullProjectsSaveOk = !loadedFromEmergencyBackup;
        projectStorageState.lastCoreBackupSaveOk = true;
    }

    if (loadedFromLegacyLocalStorage && supportsIndexedDbPersistence()) {
        queueProjectsSaveToIndexedDb(mergedProjects, mergedProjects[mergedProjects.length - 1] || null);
    }

    updateDataSafetyStatus();
    updateImageStorageStatus();
}

function loadProjectsStore() {
    return projectsStoreCache.slice();
}

function saveProjectsStore(projects, latestProjectForBackup) {
    const normalizedProjects = normalizeImportedProjects(projects);
    projectsStoreCache = normalizedProjects;

    if (supportsIndexedDbPersistence()) {
        queueProjectsSaveToIndexedDb(normalizedProjects, latestProjectForBackup);
        projectStorageState.loadedFromCoreBackup = false;
        projectStorageState.lastFullProjectsSaveOk = true;
        projectStorageState.lastCoreBackupSaveOk = true;
        updateDataSafetyStatus();
        updateImageStorageStatus();
        return true;
    }

    try {
        localStorage.setItem(projectsStorageKey, JSON.stringify(normalizedProjects));
        projectStorageState.loadedFromCoreBackup = false;
        projectStorageState.lastFullProjectsSaveOk = true;
        projectStorageState.lastCoreBackupSaveOk = true;

        try {
            localStorage.removeItem(projectsCoreBackupStorageKey);
        } catch (cleanupError) {
            console.warn("Could not clear project emergency backup key.", cleanupError);
        }

        updateDataSafetyStatus();
        updateImageStorageStatus();
        return true;
    } catch (error) {
        console.warn("Could not save projects.", error);
    }

    const fallbackProject = latestProjectForBackup
        ? normalizeImportedProject(latestProjectForBackup, "backup-" + String(Date.now()))
        : (normalizedProjects[normalizedProjects.length - 1] || null);
    const backupSaved = saveLatestProjectCoreBackup(fallbackProject);

    projectStorageState.loadedFromCoreBackup = backupSaved;
    projectStorageState.lastFullProjectsSaveOk = false;
    projectStorageState.lastCoreBackupSaveOk = backupSaved;
    updateDataSafetyStatus();
    updateImageStorageStatus();

    if (backupSaved) {
        alert("Full project storage is full. The latest project was saved in emergency core backup mode without map/reference images.");
        return true;
    }

    alert("Project could not be saved. Browser storage is full and emergency backup also failed. Export JSON immediately.");
    return false;
}

function saveProjectAndStartNew() {
    if (state.stps.length === 0) {
        alert("Save at least one STP before saving a project.");
        return;
    }

    const defaultName = normalizeTextValue(state.siteName) || "Untitled Project";
    const projectName = prompt("Enter a project name. Press OK to use the suggested site name:", defaultName);

    if (projectName === null) {
        return;
    }

    const projects = loadProjectsStore();
    const newProject = {
        id: String(Date.now()),
        name: projectName.trim() || defaultName,
        savedAt: new Date().toISOString(),
        siteName: state.siteName,
        siteLocation: state.siteLocation,
        crewMembers: state.crewMembers,
        depthUnit: state.depthUnit,
        stps: state.stps,
        projectImage: state.projectImage,
        referencePhoto: state.referencePhoto
    };
    projects.push(newProject);

    if (!saveProjectsStore(projects, newProject)) {
        return;
    }

    renderProjects();

    state.siteName = "";
    state.siteLocation = "";
    state.crewMembers = loadRecentCrewMembers();
    state.depthUnit = defaultDepthUnit;
    state.stps = [];
    state.projectImage = "";
    state.referencePhoto = "";

    localStorage.removeItem(storageKey);
    localStorage.removeItem(coreDataBackupStorageKey);
    queueSessionDeleteFromIndexedDb();
    dataSafetyState.loadedFromCoreBackup = false;
    dataSafetyState.lastFullSessionSaveOk = true;
    dataSafetyState.lastCoreBackupSaveOk = true;
    populateSiteFields();
    refreshParentStpOptions();
    renderSavedStps();
    renderProjectBanner();
    renderReferencePhoto();
    setProjectImageMessage("", false);
    setReferencePhotoMessage("", false);
    elements.projectImageInput.value = "";
    resetCurrentStp(true);
    updateDataSafetyStatus();
    showProjectDashboard();
}

async function loadProject(projectId) {
    if (!confirm("Loading this project will replace the current session. Continue?")) {
        return;
    }

    const previousSessionPhotoIds = collectPhotoIdsFromStps(state.stps);

    const projects = loadProjectsStore();
    const project = projects.find(function (p) {
        return p.id === projectId;
    });

    if (!project) {
        alert("Project not found.");
        return;
    }

    state.siteName = project.siteName || "";
    state.siteLocation = project.siteLocation || "";
    state.crewMembers = normalizeTextValue(project.crewMembers);
    state.depthUnit = project.depthUnit || defaultDepthUnit;
    state.stps = Array.isArray(project.stps) ? project.stps : [];
    state.projectImage = project.projectImage || "";
    state.referencePhoto = project.referencePhoto || project.referenceImage || "";

    if (!saveSession()) {
        const loadWarning = getDataSafetyAlertMessage("Project loaded.");
        if (loadWarning) {
            alert(loadWarning);
        }

        if (!dataSafetyState.lastCoreBackupSaveOk) {
            return;
        }
    }

    populateSiteFields();
    refreshParentStpOptions();
    renderSavedStps();
    renderProjectBanner();
    renderReferencePhoto();
    setProjectImageMessage("", false);
    setReferencePhotoMessage("", false);
    elements.projectImageInput.value = "";
    resetCurrentStp(false);
    showFieldWorkspace();

    try {
        await cleanupDeletedPhotoIds(previousSessionPhotoIds, projects);
    } catch (error) {
        console.warn("Could not clean up replaced session photos.", error);
    }
}

async function deleteProject(projectId) {
    if (!confirm("Delete this saved project? This cannot be undone.")) {
        return;
    }

    const existingProjects = loadProjectsStore();
    const removedProject = existingProjects.find(function (project) {
        return project.id === projectId;
    });

    const projects = existingProjects.filter(function (p) {
        return p.id !== projectId;
    });

    if (!saveProjectsStore(projects)) {
        return;
    }

    renderProjects();

    const removedPhotoIds = removedProject ? collectPhotoIdsFromStps(removedProject.stps || []) : [];

    try {
        await cleanupDeletedPhotoIds(removedPhotoIds, projects);
    } catch (error) {
        console.warn("Could not clean up deleted project photos.", error);
    }
}

function renderProjects() {
    const projects = loadProjectsStore();
    const searchTerm = getProjectSearchTerm();
    const sortValue = getProjectSortValue();
    const filteredProjects = projects.filter(function (project) {
        return matchesProjectFilters(project, searchTerm);
    });
    const sortedProjects = sortProjectsByValue(filteredProjects, sortValue);
    updateHeaderCount(elements.projectsHeaderCount, projects.length, sortedProjects.length);
    updateProjectFilterSummary(projects.length, sortedProjects.length, searchTerm, sortValue);
    elements.projectsList.innerHTML = "";

    if (projects.length === 0) {
        elements.projectsEmptyState.hidden = false;
        elements.projectsEmptyState.textContent = "No saved projects yet.";
        return;
    }

    if (sortedProjects.length === 0) {
        elements.projectsEmptyState.hidden = false;
        elements.projectsEmptyState.textContent = "No projects match your search.";
        return;
    }

    elements.projectsEmptyState.hidden = true;
    elements.projectsEmptyState.textContent = "No saved projects yet.";

    sortedProjects.forEach(function (project) {
        const card = document.createElement("article");
        card.className = "saved-stp";

        const head = document.createElement("div");
        head.className = "saved-stp-head";

        const titleWrap = document.createElement("div");
        const title = document.createElement("h3");
        setHighlightedText(title, project.name, searchTerm);

        const meta = document.createElement("p");
        meta.className = "saved-stp-meta";
        const stpCount = Array.isArray(project.stps) ? project.stps.length : 0;
        const savedDate = project.savedAt ? new Date(project.savedAt).toLocaleDateString() : "";
        const metaParts = [
            project.siteName,
            project.siteLocation,
            stpCount + (stpCount === 1 ? " STP" : " STPs"),
            savedDate
        ].filter(Boolean);
        setHighlightedText(meta, metaParts.join(" | "), searchTerm);

        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "section-actions";

        const loadBtn = document.createElement("button");
        loadBtn.type = "button";
        loadBtn.className = "secondary-button";
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", function () {
            loadProject(project.id);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ghost-button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", function () {
            deleteProject(project.id);
        });

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);
        head.appendChild(titleWrap);
        head.appendChild(actions);
        card.appendChild(head);
        elements.projectsList.appendChild(card);
    });
}

function isSupportedProjectImage(file) {
    const fileType = (file.type || "").toLowerCase();
    if (fileType.startsWith("image/")) {
        return true;
    }

    if (supportedProjectImageTypes.includes(fileType)) {
        return true;
    }

    const fileName = (file.name || "").toLowerCase();
    return supportedProjectImageExtensions.some(function (extension) {
        return fileName.endsWith(extension);
    });
}

function bytesToMegabytesText(value) {
    return (value / (1024 * 1024)).toFixed(1);
}

function estimateStoredImageBytes(value) {
    if (typeof value !== "string" || !value.startsWith("data:")) {
        return 0;
    }

    return estimateDataUrlBytes(value);
}

function estimateSerializedValueBytes(value) {
    try {
        const serializedValue = JSON.stringify(value);
        return typeof serializedValue === "string" ? serializedValue.length * 2 : 0;
    } catch (error) {
        console.warn("Could not estimate serialized value size.", error);
        return 0;
    }
}

function getApproxLocalStorageSnapshot() {
    const quotaBytes = approximateLocalStorageQuotaBytes;
    let usedBytes = 0;

    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key) {
                continue;
            }

            const value = localStorage.getItem(key) || "";
            usedBytes += (key.length + value.length) * 2;
        }
    } catch (error) {
        console.warn("Could not estimate browser storage usage.", error);
    }

    return {
        quotaBytes: quotaBytes,
        usedBytes: usedBytes,
        availableBytes: Math.max(0, quotaBytes - usedBytes)
    };
}

function getImageStorageBreakdown() {
    const snapshot = getApproxLocalStorageSnapshot();

    return {
        mapBytes: estimateStoredImageBytes(state.projectImage),
        referenceBytes: estimateStoredImageBytes(state.referencePhoto),
        projectsBytes: estimateSerializedValueBytes(projectsStoreCache),
        availableBytes: snapshot.availableBytes,
        quotaBytes: snapshot.quotaBytes
    };
}

function getApproxImageSpaceLeftText() {
    const storage = getImageStorageBreakdown();
    return "Approx local storage free: " + bytesToMegabytesText(storage.availableBytes) + " MB.";
}

function updateImageStorageStatus() {
    if (!elements.imageStorageStatus) {
        return;
    }

    const storage = getImageStorageBreakdown();
    elements.imageStorageStatus.textContent =
        "Map "
        + bytesToMegabytesText(storage.mapBytes)
        + " MB | Reference "
        + bytesToMegabytesText(storage.referenceBytes)
        + " MB | Saved projects (est.) "
        + bytesToMegabytesText(storage.projectsBytes)
        + " MB | Approx local free "
        + bytesToMegabytesText(storage.availableBytes)
        + " MB";
}

function estimateDataUrlBytes(dataUrl) {
    if (typeof dataUrl !== "string") {
        return 0;
    }

    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex < 0) {
        return dataUrl.length;
    }

    const base64Payload = dataUrl.slice(commaIndex + 1);
    const padding = base64Payload.endsWith("==") ? 2 : (base64Payload.endsWith("=") ? 1 : 0);
    return Math.max(0, Math.floor((base64Payload.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.addEventListener("load", function () {
            resolve(String(reader.result || ""));
        });
        reader.addEventListener("error", function () {
            reject(new Error("File read failed."));
        });
        reader.readAsDataURL(file);
    });
}

function dataUrlToBlob(dataUrl, fallbackType) {
    const normalizedDataUrl = String(dataUrl || "");
    const dataUrlMatch = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(normalizedDataUrl);

    if (!dataUrlMatch) {
        throw new Error("Invalid data URL.");
    }

    const mimeType = dataUrlMatch[1] || fallbackType || "application/octet-stream";
    const isBase64 = Boolean(dataUrlMatch[2]);
    const payload = dataUrlMatch[3] || "";
    const byteString = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(byteString.length);

    for (let index = 0; index < byteString.length; index += 1) {
        bytes[index] = byteString.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
        const image = new Image();
        image.addEventListener("load", function () {
            resolve(image);
        });
        image.addEventListener("error", function () {
            reject(new Error("Image decode failed."));
        });
        image.src = dataUrl;
    });
}

function getOptimizedImageMimeType(sourceMimeType) {
    const normalizedType = (sourceMimeType || "").toLowerCase();
    if (normalizedType === "image/webp" || normalizedType === "image/png") {
        return "image/webp";
    }

    return "image/jpeg";
}

function getImportQualityProfile(mode) {
    const normalizedMode = normalizeImportQualityMode(mode);
    return importQualityProfiles[normalizedMode] || importQualityProfiles.sharp;
}

async function optimizeImageDataUrlToFit(sourceDataUrl, sourceMimeType, maxBytes, qualityProfile) {
    const sourceBytes = estimateDataUrlBytes(sourceDataUrl);
    if (sourceBytes <= maxBytes) {
        return {
            dataUrl: sourceDataUrl,
            outputBytes: sourceBytes,
            wasResized: false
        };
    }

    const image = await loadImageFromDataUrl(sourceDataUrl);
    const exportMimeType = getOptimizedImageMimeType(sourceMimeType);
    const profile = qualityProfile || importQualityProfiles.sharp;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const sourceMaxDimension = Math.max(sourceWidth, sourceHeight) || 1;
    const startScale = Math.min(1, profile.maxDimension / sourceMaxDimension);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas not supported.");
    }

    let bestDataUrl = sourceDataUrl;
    let bestBytes = sourceBytes;
    let scale = startScale;
    let quality = profile.initialQuality;

    for (let attempt = 0; attempt < profile.maxAttempts; attempt += 1) {
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));

        canvas.width = width;
        canvas.height = height;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        if (exportMimeType === "image/jpeg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
        } else {
            context.clearRect(0, 0, width, height);
        }

        context.drawImage(image, 0, 0, width, height);

        const candidateDataUrl = canvas.toDataURL(exportMimeType, quality);
        const candidateBytes = estimateDataUrlBytes(candidateDataUrl);

        if (candidateBytes < bestBytes) {
            bestBytes = candidateBytes;
            bestDataUrl = candidateDataUrl;
        }

        if (candidateBytes <= maxBytes) {
            return {
                dataUrl: candidateDataUrl,
                outputBytes: candidateBytes,
                wasResized: true
            };
        }

        const oversizeRatio = candidateBytes / maxBytes;

        if (oversizeRatio > profile.oversizeHardThreshold) {
            scale = scale * profile.downscaleHardFactor;
        } else if (oversizeRatio > profile.oversizeSoftThreshold) {
            scale = scale * profile.downscaleSoftFactor;
        } else if (quality > profile.minQuality) {
            quality = Math.max(profile.minQuality, quality - profile.qualityStep);
        } else {
            scale = scale * profile.downscaleFinalFactor;
        }

        if (scale < 0.2) {
            break;
        }
    }

    return {
        dataUrl: bestDataUrl,
        outputBytes: bestBytes,
        wasResized: bestBytes < sourceBytes
    };
}

async function createCompatibleImagePayload(file, maxBytes, qualityMode) {
    const sourceDataUrl = await readFileAsDataUrl(file);
    const sourceBytes = estimateDataUrlBytes(sourceDataUrl);
    const normalizedQualityMode = normalizeImportQualityMode(qualityMode || importQualityMode);
    const optimized = await optimizeImageDataUrlToFit(
        sourceDataUrl,
        file.type,
        maxBytes,
        getImportQualityProfile(normalizedQualityMode)
    );

    return {
        dataUrl: optimized.dataUrl,
        sourceBytes: sourceBytes,
        outputBytes: optimized.outputBytes,
        wasResized: optimized.wasResized,
        qualityMode: normalizedQualityMode
    };
}

function getStorageFallbackByteTargets(maxBytes) {
    const minimumTargetBytes = 220 * 1024;
    const fallbackFactors = [0.8, 0.65, 0.52, 0.4, 0.32, 0.24, 0.18, 0.14, 0.1];
    const targets = [];

    fallbackFactors.forEach(function (factor) {
        const nextTarget = Math.max(minimumTargetBytes, Math.floor(maxBytes * factor));
        if (nextTarget >= maxBytes) {
            return;
        }

        if (targets.length > 0 && nextTarget >= targets[targets.length - 1]) {
            return;
        }

        targets.push(nextTarget);
    });

    return targets;
}

async function persistImageWithStorageFallback(options) {
    const file = options.file;
    const maxBytes = options.maxBytes;
    const qualityMode = options.qualityMode;
    const previousDataUrl = String(options.previousDataUrl || "");
    const setImageState = options.setImageState;

    let payload = options.initialPayload;
    let usedStorageFallback = false;
    const fallbackTargets = getStorageFallbackByteTargets(maxBytes);

    for (let attemptIndex = 0; attemptIndex <= fallbackTargets.length; attemptIndex += 1) {
        setImageState(payload.dataUrl);

        if (saveSession()) {
            return {
                saved: true,
                payload: payload,
                usedStorageFallback: usedStorageFallback
            };
        }

        if (attemptIndex === fallbackTargets.length) {
            break;
        }

        usedStorageFallback = true;

        try {
            payload = await createCompatibleImagePayload(file, fallbackTargets[attemptIndex], qualityMode);
        } catch (error) {
            break;
        }
    }

    setImageState(previousDataUrl);

    return {
        saved: false,
        payload: options.initialPayload,
        usedStorageFallback: usedStorageFallback
    };
}

function setReferencePhotoMessage(text, isError) {
    if (!elements.referencePhotoMessage) {
        return;
    }

    elements.referencePhotoMessage.textContent = text || "";
    elements.referencePhotoMessage.classList.toggle("is-error", Boolean(isError));
}

function getReferencePhotoPanel() {
    return elements.referencePhotoImg
        ? elements.referencePhotoImg.closest(".entry-photo-panel")
        : null;
}

function releaseReferencePhotoPreview() {
    if (activeReferencePreviewObjectUrl) {
        URL.revokeObjectURL(activeReferencePreviewObjectUrl);
        activeReferencePreviewObjectUrl = "";
    }

    referencePhotoPreviewSource = "";
    referencePhotoPreviewTitle = "";
    referencePhotoPreviewHint = "";
    referencePhotoPreviewKind = "";
    referencePhotoPreviewEntryKey = "";
}

function clearReferencePhotoPreview(showMessage) {
    const hadPreview = Boolean(referencePhotoPreviewSource);

    if (!hadPreview) {
        return false;
    }

    releaseReferencePhotoPreview();
    renderReferencePhoto();

    if (showMessage) {
        setReferencePhotoMessage(
            state.referencePhoto
                ? "Returned to the saved reference photo."
                : "Closed STP photo preview. Showing the stock reference image.",
            false
        );
    }

    return true;
}

function setReferencePhotoPreview(imageSource, titleText, hintText, previewKind, previewEntryKey, shouldRevokeOnClear) {
    releaseReferencePhotoPreview();
    referencePhotoPreviewSource = imageSource || "";
    referencePhotoPreviewTitle = titleText || "STP Photo";
    referencePhotoPreviewHint = hintText || "";
    referencePhotoPreviewKind = previewKind || "";
    referencePhotoPreviewEntryKey = previewEntryKey || "";

    if (shouldRevokeOnClear && imageSource) {
        activeReferencePreviewObjectUrl = imageSource;
    }

    renderReferencePhoto();
}

function getReferencePhotoDisplayState() {
    if (referencePhotoPreviewSource) {
        return {
            source: referencePhotoPreviewSource,
            alt: referencePhotoPreviewTitle || "STP photo reference",
            hint: referencePhotoPreviewHint || "Viewing STP photo in the reference frame.",
            previewActive: true
        };
    }

    if (state.referencePhoto) {
        return {
            source: state.referencePhoto,
            alt: "Reference photo beside the STP data entry area",
            hint: "Saved with session and project.",
            previewActive: false
        };
    }

    return {
        source: defaultReferencePhotoSrc,
        alt: "Reference photo beside the STP data entry area",
        hint: "",
        previewActive: false
    };
}

function getStpDisplayLabel(entryType, stpLabel, supDirection) {
    const normalizedLabel = normalizeTextValue(stpLabel);

    if (!normalizedLabel) {
        return "STP";
    }

    if (normalizeEntryTypeValue(entryType) === "supplemental") {
        const normalizedSupDirection = normalizeSupDirectionValue(supDirection);

        if (normalizedSupDirection) {
            return normalizedLabel + normalizedSupDirection;
        }
    }

    return normalizedLabel;
}

function buildCurrentDraftPhotoContextLabel(card) {
    const stpDisplayLabel = getStpDisplayLabel(
        elements.stpEntryType && elements.stpEntryType.value,
        elements.stpLabel && elements.stpLabel.value,
        elements.supDirection && elements.supDirection.value
    );
    const stratumField = card ? card.querySelector('[data-field="stratumLabel"]') : null;
    const stratumLabel = normalizeTextValue(stratumField && stratumField.value);
    const stpContext = stpDisplayLabel === "STP" ? "Current draft STP" : "Current draft STP " + stpDisplayLabel;

    return stratumLabel ? stpContext + " \u00b7 Stratum " + stratumLabel : stpContext;
}

function buildSavedPhotoContextLabel(stp, stratum) {
    const stpDisplayLabel = getStpDisplayLabel(stp && stp.entryType, stp && stp.stpLabel, stp && stp.supDirection);
    const stratumLabel = normalizeTextValue(stratum && stratum.stratumLabel);
    const stpContext = stpDisplayLabel === "STP" ? "Saved STP" : "Saved STP " + stpDisplayLabel;

    return stratumLabel ? stpContext + " \u00b7 Stratum " + stratumLabel : stpContext;
}

async function openPhotoInReferencePanel(options) {
    const normalizedPhotoName = normalizeTextValue(options && options.photoName) || "Photo";
    const normalizedPhotoId = normalizeTextValue(options && options.photoId);
    const normalizedPendingId = normalizeTextValue(options && options.pendingId);
    const normalizedPhotoContext = normalizeTextValue(options && options.photoContext);
    let blobValue = null;
    let previewHint = "";
    let previewKind = "";
    let previewEntryKey = "";

    if (normalizedPendingId) {
        blobValue = draftPhotoBlobs.get(normalizedPendingId) || null;
        previewHint = "Current draft photo in app memory. Save STP to keep it in app photo storage.";
        previewKind = "draft";
        previewEntryKey = "draft:" + normalizedPendingId;
    } else if (normalizedPhotoId) {
        try {
            blobValue = await readPhotoBlobFromDatabase(normalizedPhotoId);
        } catch (error) {
            console.warn("Could not load saved photo from app storage.", error);
            blobValue = null;
        }

        previewHint = "Saved STP photo stored in app photo storage.";
        previewKind = "saved";
        previewEntryKey = "saved:" + normalizedPhotoId;
    }

    if (!blobValue) {
        setReferencePhotoMessage(
            normalizedPhotoId
                ? "This STP lists the photo, but the file is not currently available in app photo storage."
                : "This draft photo is no longer available in app memory. Capture it again if needed.",
            true
        );
        return false;
    }

    const objectUrl = URL.createObjectURL(blobValue);
    const titleText = normalizedPhotoContext
        ? normalizedPhotoName + " - " + normalizedPhotoContext
        : normalizedPhotoName;

    setReferencePhotoPreview(objectUrl, titleText, previewHint, previewKind, previewEntryKey, true);
    setReferencePhotoMessage("Opened " + normalizedPhotoName + " in the Reference Photo frame.", false);

    const referencePanel = getReferencePhotoPanel();
    if (referencePanel) {
        referencePanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    return true;
}

function buildReferencePhotoLibraryItems() {
    const items = [];
    const seenKeys = new Set();

    function addItem(item) {
        if (!item || !item.key || seenKeys.has(item.key)) {
            return;
        }

        seenKeys.add(item.key);
        items.push(item);
    }

    if (elements.strataList) {
        Array.from(elements.strataList.querySelectorAll(".stratum-card")).forEach(function (card) {
            const contextLabel = buildCurrentDraftPhotoContextLabel(card);

            getCardPhotoEntries(card).forEach(function (entry, index) {
                const normalizedEntry = normalizePhotoEntry(entry);
                const photoName = normalizeTextValue(normalizedEntry.name) || "Photo " + String(index + 1);
                const itemKey = normalizedEntry.pendingId
                    ? "draft:" + normalizedEntry.pendingId
                    : (normalizedEntry.id
                        ? "saved:" + normalizedEntry.id
                        : "draft-label:" + contextLabel + ":" + photoName + ":" + String(index));

                addItem({
                    key: itemKey,
                    name: photoName,
                    photoId: normalizedEntry.id,
                    pendingId: normalizedEntry.pendingId,
                    contextLabel: contextLabel,
                    storageLabel: normalizedEntry.pendingId
                        ? "Current draft"
                        : (normalizedEntry.id ? "Saved in app" : "Label only"),
                    canOpen: Boolean(normalizedEntry.pendingId || normalizedEntry.id),
                    isDraft: Boolean(normalizedEntry.pendingId),
                    isMissing: !normalizedEntry.pendingId && !normalizedEntry.id
                });
            });
        });
    }

    state.stps.forEach(function (stp, stpIndex) {
        if (isEditingSavedStp() && stpIndex === activeEditStpIndex) {
            return;
        }

        (stp.strata || []).forEach(function (stratum) {
            const contextLabel = buildSavedPhotoContextLabel(stp, stratum);

            getStratumPhotoEntries(stratum).forEach(function (entry, index) {
                const normalizedEntry = normalizePhotoEntry(entry);
                const photoName = normalizeTextValue(normalizedEntry.name) || "Photo " + String(index + 1);
                const itemKey = normalizedEntry.id
                    ? "saved:" + normalizedEntry.id
                    : "saved-label:" + contextLabel + ":" + photoName + ":" + String(index);

                addItem({
                    key: itemKey,
                    name: photoName,
                    photoId: normalizedEntry.id,
                    pendingId: "",
                    contextLabel: contextLabel,
                    storageLabel: normalizedEntry.id ? "Saved in app" : "Label only",
                    canOpen: Boolean(normalizedEntry.id),
                    isDraft: false,
                    isMissing: !normalizedEntry.id
                });
            });
        });
    });

    return items;
}

function renderReferencePhotoLibrary() {
    if (!elements.referencePhotoLibrarySummary || !elements.referencePhotoLibraryList) {
        return;
    }

    const items = buildReferencePhotoLibraryItems();
    const openableCount = items.filter(function (item) {
        return item.canOpen;
    }).length;
    const labelOnlyCount = items.length - openableCount;

    if (referencePhotoPreviewKind !== "device" && referencePhotoPreviewEntryKey) {
        const previewStillExists = items.some(function (item) {
            return item.key === referencePhotoPreviewEntryKey;
        });

        if (!previewStillExists) {
            clearReferencePhotoPreview(false);
        }
    }

    if (items.length === 0) {
        elements.referencePhotoLibrarySummary.textContent = "STP Photos In App";
    } else if (openableCount > 0) {
        elements.referencePhotoLibrarySummary.textContent = "STP Photos In App (" + openableCount + ")";
    } else {
        elements.referencePhotoLibrarySummary.textContent = "STP Photos In App (labels only)";
    }

    elements.referencePhotoLibraryList.innerHTML = "";

    if (items.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "entry-photo-library-empty";
        emptyState.textContent = "No STP photos are in the app yet. Draft photos appear after capture. Saved STP photos appear here after Save STP.";
        elements.referencePhotoLibraryList.appendChild(emptyState);
        return;
    }

    items.forEach(function (item) {
        const row = document.createElement("div");
        row.className = "entry-photo-library-item";

        const copy = document.createElement("div");
        copy.className = "entry-photo-library-copy";

        const name = document.createElement("p");
        name.className = "entry-photo-library-name";
        name.textContent = item.name;

        const meta = document.createElement("p");
        meta.className = "entry-photo-library-meta";
        meta.textContent = item.contextLabel;

        const badge = document.createElement("span");
        badge.className = "entry-photo-library-badge";
        if (item.isDraft) {
            badge.classList.add("is-draft");
        }
        if (item.isMissing) {
            badge.classList.add("is-missing");
        }
        badge.textContent = item.storageLabel;

        copy.appendChild(name);
        copy.appendChild(meta);
        copy.appendChild(badge);

        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "saved-photo-open-button entry-photo-library-open";
        openButton.setAttribute("data-reference-photo-open", "true");
        openButton.setAttribute("data-reference-photo-name", item.name);
        openButton.setAttribute("data-reference-photo-context", item.contextLabel);

        if (item.photoId) {
            openButton.setAttribute("data-reference-photo-id", item.photoId);
        }

        if (item.pendingId) {
            openButton.setAttribute("data-reference-photo-pending-id", item.pendingId);
        }

        openButton.disabled = !item.canOpen;
        openButton.textContent = item.canOpen ? "Open" : "Not In App";

        row.appendChild(copy);
        row.appendChild(openButton);
        elements.referencePhotoLibraryList.appendChild(row);
    });

    if (labelOnlyCount > 0 && items.length > openableCount) {
        const note = document.createElement("p");
        note.className = "entry-photo-library-empty";
        note.textContent = "Some older STP entries only kept the photo label. New photos now save into app storage and can open here directly.";
        elements.referencePhotoLibraryList.appendChild(note);
    }
}

function handleReferencePhotoLibraryClick(event) {
    const openButton = event.target.closest("[data-reference-photo-open]");

    if (!openButton) {
        return;
    }

    openPhotoInReferencePanel({
        photoName: openButton.getAttribute("data-reference-photo-name") || "Photo",
        photoId: openButton.getAttribute("data-reference-photo-id") || "",
        pendingId: openButton.getAttribute("data-reference-photo-pending-id") || "",
        photoContext: openButton.getAttribute("data-reference-photo-context") || ""
    });
}

function renderReferencePhoto() {
    const displayState = getReferencePhotoDisplayState();
    const hasSavedReferencePhoto = Boolean(state.referencePhoto);

    if (elements.referencePhotoImg) {
        elements.referencePhotoImg.hidden = false;
        elements.referencePhotoImg.src = displayState.source;
        elements.referencePhotoImg.alt = displayState.alt;
    }

    if (elements.referencePhotoEmpty) {
        elements.referencePhotoEmpty.hidden = true;
    }

    if (elements.clearReferencePhotoButton) {
        elements.clearReferencePhotoButton.hidden = !hasSavedReferencePhoto;
        elements.clearReferencePhotoButton.textContent = displayState.previewActive ? "Clear Saved Reference" : "Clear";
    }

    if (elements.closeReferencePhotoPreviewButton) {
        elements.closeReferencePhotoPreviewButton.hidden = !displayState.previewActive;
        elements.closeReferencePhotoPreviewButton.textContent = hasSavedReferencePhoto
            ? "Back to Reference"
            : "Close Preview";
    }

    if (elements.referencePhotoSavedHint) {
        elements.referencePhotoSavedHint.hidden = !displayState.hint;
        elements.referencePhotoSavedHint.textContent = displayState.hint || "Saved with session and project.";
    }

    updateImageStorageStatus();
    updateQuickPhotoControls();
}

function clearReferencePhoto(showMessage) {
    clearReferencePhotoPreview(false);

    const previousPhoto = state.referencePhoto;
    state.referencePhoto = "";

    if (!saveSession()) {
        state.referencePhoto = previousPhoto;
        renderReferencePhoto();
        setReferencePhotoMessage(
            "Reference photo could not be updated in browser storage. " + getApproxImageSpaceLeftText(),
            true
        );
        return;
    }

    if (elements.referencePhotoInput) {
        elements.referencePhotoInput.value = "";
    }

    renderReferencePhoto();
    setReferencePhotoMessage(
        showMessage ? "Reference photo removed. Showing stock reference image. " + getApproxImageSpaceLeftText() : "",
        false
    );
}

function openReferencePhotoPicker() {
    if (!elements.referencePhotoInput) {
        return;
    }

    elements.referencePhotoInput.value = "";

    try {
        if (typeof elements.referencePhotoInput.showPicker === "function") {
            elements.referencePhotoInput.showPicker();
        } else {
            elements.referencePhotoInput.click();
        }
    } catch (error) {
        elements.referencePhotoInput.click();
    }
}

async function handleReferencePhotoUpload() {
    if (!elements.referencePhotoInput) {
        return;
    }

    const file = elements.referencePhotoInput.files[0];

    if (!file) {
        return;
    }

    if (!(file.type || "").toLowerCase().startsWith("image/")) {
        setReferencePhotoMessage("Unsupported file type. Select an image file.", true);
        elements.referencePhotoInput.value = "";
        return;
    }

    if (file.size > maxImageSourceSizeBytes) {
        setReferencePhotoMessage("Reference photo is too large to process. Use an image under 20 MB.", true);
        elements.referencePhotoInput.value = "";
        return;
    }

    const activeQualityMode = importQualityMode;
    const modeLabel = getImportQualityModeLabel(activeQualityMode);
    setReferencePhotoMessage("Optimizing reference photo for compatibility (" + modeLabel + " mode)...", false);

    let imagePayload;
    try {
        imagePayload = await createCompatibleImagePayload(file, maxReferencePhotoSizeBytes, activeQualityMode);
    } catch (error) {
        setReferencePhotoMessage("Reference photo could not be read. Try a different image.", true);
        elements.referencePhotoInput.value = "";
        return;
    }

    if (imagePayload.outputBytes > maxReferencePhotoSizeBytes) {
        setReferencePhotoMessage(
            "Reference photo is still too large after resizing. Try a smaller image. " + getApproxImageSpaceLeftText(),
            true
        );
        elements.referencePhotoInput.value = "";
        return;
    }

    const previousPhoto = state.referencePhoto;
    const persistence = await persistImageWithStorageFallback({
        file: file,
        maxBytes: maxReferencePhotoSizeBytes,
        qualityMode: activeQualityMode,
        previousDataUrl: previousPhoto,
        initialPayload: imagePayload,
        setImageState: function (dataUrl) {
            state.referencePhoto = dataUrl;
        }
    });

    if (!persistence.saved) {
        state.referencePhoto = previousPhoto;
        renderReferencePhoto();
        setReferencePhotoMessage(
            "Reference photo could not be saved. Use a smaller image or clear older photos. " + getApproxImageSpaceLeftText(),
            true
        );
        elements.referencePhotoInput.value = "";
        return;
    }

    imagePayload = persistence.payload;

    clearReferencePhotoPreview(false);
    renderReferencePhoto();
    if (imagePayload.wasResized) {
        setReferencePhotoMessage(
            "Reference photo loaded and resized: "
                + (file.name || "image")
                + " ("
                + bytesToMegabytesText(imagePayload.sourceBytes)
                + " MB -> "
                + bytesToMegabytesText(imagePayload.outputBytes)
                + " MB, "
                + getImportQualityModeLabel(imagePayload.qualityMode)
                + " mode)."
                + (persistence.usedStorageFallback ? " Reduced further to fit browser storage." : "")
                + " "
                + getApproxImageSpaceLeftText(),
            false
        );
        return;
    }

    setReferencePhotoMessage(
        "Reference photo loaded: "
            + (file.name || "image")
            + " ("
            + bytesToMegabytesText(imagePayload.outputBytes)
            + " MB, "
            + getImportQualityModeLabel(imagePayload.qualityMode)
            + " mode)."
            + (persistence.usedStorageFallback ? " Reduced further to fit browser storage." : "")
            + " "
            + getApproxImageSpaceLeftText(),
        false
    );
}

function setProjectImageMessage(text, isError) {
    if (!elements.projectImageMessage) {
        return;
    }

    elements.projectImageMessage.textContent = text || "";
    elements.projectImageMessage.classList.toggle("is-error", Boolean(isError));
}

function handleMapViewerClick(event) {
    if (event.target === elements.mapViewerModal) {
        closeMapViewer();
    }
}

function handleMapViewerEscape(event) {
    if (event.key === "Escape") {
        closeMapViewer();
    }
}

function parseGpsCoordinate(value, min, max) {
    const parsedValue = Number(normalizeTextValue(value));

    if (!Number.isFinite(parsedValue)) {
        return null;
    }

    if (parsedValue < min || parsedValue > max) {
        return null;
    }

    return parsedValue;
}

function getSavedGpsPointsForMap() {
    const gpsPoints = [];

    state.stps.forEach(function (stp, index) {
        const latitude = parseGpsCoordinate(stp.gpsLatitude, -90, 90);
        const longitude = parseGpsCoordinate(stp.gpsLongitude, -180, 180);

        if (latitude == null || longitude == null) {
            return;
        }

        const baseLabel = normalizeTextValue(stp.stpLabel) || ("STP " + (index + 1));
        const supDirection = normalizeTextValue(stp.supDirection);
        const entryTypeKey = normalizeEntryTypeValue(stp.entryType);

        gpsPoints.push({
            label: supDirection ? (baseLabel + supDirection) : baseLabel,
            entryTypeKey: entryTypeKey,
            entryTypeLabel: getEntryTypeLabel(entryTypeKey),
            latitude: latitude,
            longitude: longitude,
            savedAt: normalizeTextValue(stp.savedAt),
            siteName: normalizeTextValue(stp.siteName || state.siteName),
            siteLocation: normalizeTextValue(stp.siteLocation || state.siteLocation),
            strata: Array.isArray(stp.strata) ? stp.strata.map(function (s) {
                return {
                    stratumLabel: normalizeTextValue(s.stratumLabel),
                    depth: normalizeTextValue(s.depth),
                    munsell: normalizeTextValue(s.munsell),
                    soilType: normalizeTextValue(s.soilType),
                    horizon: normalizeTextValue(s.horizon),
                    artifactSummary: normalizeTextValue(s.artifactSummary),
                    notes: normalizeTextValue(s.notes)
                };
            }) : []
        });
    });

    return gpsPoints;
}

function coordinatesMatchWithinTolerance(latitudeA, longitudeA, latitudeB, longitudeB) {
    return Math.abs(Number(latitudeA) - Number(latitudeB)) <= gpsCoordinateMatchTolerance
        && Math.abs(Number(longitudeA) - Number(longitudeB)) <= gpsCoordinateMatchTolerance;
}

function findSavedStpIndexByCoordinates(latitude, longitude) {
    for (let index = 0; index < state.stps.length; index += 1) {
        const stp = state.stps[index];
        const stpLatitude = parseGpsCoordinate(stp && stp.gpsLatitude, -90, 90);
        const stpLongitude = parseGpsCoordinate(stp && stp.gpsLongitude, -180, 180);

        if (stpLatitude == null || stpLongitude == null) {
            continue;
        }

        if (coordinatesMatchWithinTolerance(latitude, longitude, stpLatitude, stpLongitude)) {
            return index;
        }
    }

    return -1;
}

function getImportedGpsPointsForMap() {
    if (!gpsRegistry || !(gpsRegistry.points instanceof Map) || gpsRegistry.points.size === 0) {
        return [];
    }

    const importedPoints = [];

    Array.from(gpsRegistry.points.values()).forEach(function (point, index) {
        const latitude = parseGpsCoordinate(point && point.lat, -90, 90);
        const longitude = parseGpsCoordinate(point && point.lon, -180, 180);

        if (latitude == null || longitude == null) {
            return;
        }

        const entryTypeKey = normalizeEntryTypeValue(point && point.type);
        const storedStpIndex = Number.isFinite(Number(point && point.stpIndex)) ? Number(point.stpIndex) : -1;
        const matchedStpIndex = findSavedStpIndexByCoordinates(latitude, longitude);
        const stpIndex = matchedStpIndex >= 0 ? matchedStpIndex : storedStpIndex;
        const statusValue = normalizeTextValue(point && point.status).toLowerCase();
        const status = stpIndex >= 0 ? "marked" : (statusValue || "unmarked");
        let linkedStpLabel = "";

        if (stpIndex >= 0 && stpIndex < state.stps.length) {
            const linkedStp = state.stps[stpIndex];
            const baseLabel = normalizeTextValue(linkedStp && linkedStp.stpLabel) || ("STP " + (stpIndex + 1));
            const supDirection = normalizeTextValue(linkedStp && linkedStp.supDirection);
            linkedStpLabel = supDirection ? (baseLabel + supDirection) : baseLabel;
        }

        importedPoints.push({
            id: normalizeTextValue(point && point.id) || ("imported-" + (index + 1)),
            label: normalizeTextValue(point && point.label) || ("Imported Point " + (index + 1)),
            entryTypeKey: entryTypeKey,
            entryTypeLabel: getEntryTypeLabel(entryTypeKey),
            latitude: latitude,
            longitude: longitude,
            source: normalizeTextValue(point && point.source),
            status: status,
            stpIndex: stpIndex,
            linkedStpLabel: linkedStpLabel,
            importedAt: normalizeTextValue(point && point.importedAt)
        });
    });

    return importedPoints;
}

function updateGpsMapButtonState() {
    if (!elements.viewGpsMapButton) {
        return;
    }

    const savedPointCount = getSavedGpsPointsForMap().length;
    const importedPointCount = getImportedGpsPointsForMap().length;
    const pointCount = savedPointCount + importedPointCount;

    elements.viewGpsMapButton.disabled = pointCount === 0;
    elements.viewGpsMapButton.title = pointCount === 0
        ? "Import GPS points or save at least one STP with valid GPS coordinates to open the map."
        : "Open map with "
            + pointCount
            + (pointCount === 1 ? " plotted GPS point" : " plotted GPS points")
            + " ("
            + savedPointCount
            + " saved STP"
            + (savedPointCount === 1 ? "" : "s")
            + ", "
            + importedPointCount
            + " imported).";
}

function updateWrapUpSummary() {
    if (!elements.wrapUpPanel) {
        return;
    }

    const stpCount = state.stps.length;
    elements.wrapUpPanel.hidden = stpCount === 0;

    if (stpCount === 0) {
        return;
    }

    const stratumCount = state.stps.reduce(function (sum, stp) {
        return sum + (Array.isArray(stp.strata) ? stp.strata.length : 0);
    }, 0);

    const sitePart = state.siteName ? state.siteName + (state.siteLocation ? " \u2014 " + state.siteLocation : "") : "";
    const countPart = stpCount + (stpCount === 1 ? " STP" : " STPs") + ", " + stratumCount + (stratumCount === 1 ? " stratum" : " strata") + " recorded.";

    if (elements.wrapUpSummaryText) {
        elements.wrapUpSummaryText.textContent = (sitePart ? sitePart + ". " : "") + countPart;
    }
}

function shouldOpenGpsMapInSameTab() {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    return isStandalone || isIos;
}

function buildGpsMapUrl(payload) {
    const fallbackUrl = "./gps-map.html";

    try {
        const encodedPayload = encodeURIComponent(JSON.stringify(payload));

        if (!encodedPayload || encodedPayload.length > 180000) {
            return fallbackUrl;
        }

        return fallbackUrl + "#payload=" + encodedPayload;
    } catch (_error) {
        return fallbackUrl;
    }
}

function openGpsPointsMap() {
    const gpsPoints = getSavedGpsPointsForMap();
    const importedGpsPoints = getImportedGpsPointsForMap();
    const dedupedSavedGpsPoints = gpsPoints.filter(function (savedPoint) {
        return !importedGpsPoints.some(function (importedPoint) {
            return coordinatesMatchWithinTolerance(
                savedPoint.latitude,
                savedPoint.longitude,
                importedPoint.latitude,
                importedPoint.longitude
            );
        });
    });
    const totalPoints = dedupedSavedGpsPoints.length + importedGpsPoints.length;

    if (totalPoints === 0) {
        alert("Import GPS points or save at least one STP with valid GPS coordinates before opening the map.");
        return;
    }

    const pageTitle = (state.siteName || "Project") + " GPS Points Map";
    const payload = {
        title: pageTitle,
        points: dedupedSavedGpsPoints,
        importedPoints: importedGpsPoints,
        savedAt: new Date().toISOString()
    };

    try {
        sessionStorage.setItem(gpsMapPayloadStorageKey, JSON.stringify(payload));
    } catch (_error) {
        // Fallback to localStorage below if sessionStorage is unavailable.
    }

    try {
        localStorage.setItem(gpsMapPayloadStorageKey, JSON.stringify(payload));
    } catch (_error) {
        // Non-fatal: map page may still receive payload from sessionStorage.
    }

    const mapUrl = buildGpsMapUrl(payload);

    if (shouldOpenGpsMapInSameTab()) {
        window.location.href = mapUrl;
        return;
    }

    const mapWindow = window.open(mapUrl, "_blank");

    if (!mapWindow) {
        // Popup likely blocked: continue in the same tab so the user still gets the map.
        window.location.href = mapUrl;
    }
}

function openImageInModal(imageSource, titleText, shouldRevokeOnClose) {
    if (!elements.mapViewerModal || !elements.mapViewerImage || !elements.closeMapViewerButton) {
        return;
    }

    if (activeMapViewerObjectUrl) {
        URL.revokeObjectURL(activeMapViewerObjectUrl);
        activeMapViewerObjectUrl = "";
    }

    if (shouldRevokeOnClose) {
        activeMapViewerObjectUrl = imageSource;
    }

    if (elements.mapViewerTitle) {
        elements.mapViewerTitle.textContent = titleText || defaultMapViewerTitle;
    }

    elements.mapViewerImage.alt = titleText || defaultMapViewerTitle;
    elements.mapViewerImage.src = imageSource;
    elements.mapViewerModal.hidden = false;
    elements.mapViewerModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    elements.closeMapViewerButton.focus();
}

function openMapViewer() {
    if (!state.projectImage) {
        return;
    }

    const mapWindow = window.open("", "_blank");
    const pageTitle = (state.siteName || "Project") + " Map Reference";

    if (!mapWindow) {
        setProjectImageMessage("Popup blocked. Allow popups to open the map in a new page.", true);
        openImageInModal(state.projectImage, pageTitle, false);
        return;
    }

    const viewerMarkup = [
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
        "<title>" + pageTitle + "</title>",
        "<style>",
        "body{margin:0;min-height:100vh;background:#181d1b;color:#f3efe7;font-family:Trebuchet MS,Gill Sans,sans-serif;display:grid;grid-template-rows:auto 1fr}",
        ".top{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#232b28}",
        ".title{margin:0;font-size:0.95rem;opacity:0.9}",
        "button{border:none;border-radius:999px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer;background:#6f4e37;color:#fff}",
        ".wrap{display:grid;place-items:center;padding:10px}",
        "img{max-width:100%;max-height:calc(100vh - 72px);object-fit:contain;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:#121614}",
        "</style>",
        "</head>",
        "<body>",
        "<div class=\"top\"><p class=\"title\">" + pageTitle + "</p><button type=\"button\" onclick=\"window.close()\">Close</button></div>",
        "<div class=\"wrap\"><img id=\"mapReferenceImage\" alt=\"Project map reference\"></div>",
        "</body>",
        "</html>"
    ].join("");

    mapWindow.document.open();
    mapWindow.document.write(viewerMarkup);
    mapWindow.document.close();

    const mapImage = mapWindow.document.getElementById("mapReferenceImage");
    if (mapImage) {
        mapImage.src = state.projectImage;
    }

    setProjectImageMessage("Opened map in a new page.", false);
}

function closeMapViewer() {
    if (elements.mapViewerModal.hidden) {
        return;
    }

    if (activeMapViewerObjectUrl) {
        URL.revokeObjectURL(activeMapViewerObjectUrl);
        activeMapViewerObjectUrl = "";
    }

    elements.mapViewerModal.hidden = true;
    elements.mapViewerModal.setAttribute("aria-hidden", "true");
    elements.mapViewerImage.src = "";
    elements.mapViewerImage.alt = defaultMapViewerTitle;

    if (elements.mapViewerTitle) {
        elements.mapViewerTitle.textContent = defaultMapViewerTitle;
    }

    document.body.style.overflow = "";
}

async function handleProjectImageUpload() {
    const file = elements.projectImageInput.files[0];

    if (!file) {
        return;
    }

    if (!isSupportedProjectImage(file)) {
        setProjectImageMessage("Unsupported file type. Select an image file.", true);
        elements.projectImageInput.value = "";
        return;
    }

    if (file.size > maxImageSourceSizeBytes) {
        setProjectImageMessage("Image is too large to process. Use an image under 20 MB.", true);
        elements.projectImageInput.value = "";
        return;
    }

    const activeQualityMode = importQualityMode;
    const modeLabel = getImportQualityModeLabel(activeQualityMode);
    setProjectImageMessage("Optimizing map image for compatibility (" + modeLabel + " mode)...", false);

    let imagePayload;
    try {
        imagePayload = await createCompatibleImagePayload(file, maxProjectImageSizeBytes, activeQualityMode);
    } catch (error) {
        setProjectImageMessage("Image could not be read. Try a different file.", true);
        elements.projectImageInput.value = "";
        return;
    }

    if (imagePayload.outputBytes > maxProjectImageSizeBytes) {
        setProjectImageMessage("Image is still too large after resizing. Try a smaller file. " + getApproxImageSpaceLeftText(), true);
        elements.projectImageInput.value = "";
        return;
    }

    const previousImage = state.projectImage;
    const persistence = await persistImageWithStorageFallback({
        file: file,
        maxBytes: maxProjectImageSizeBytes,
        qualityMode: activeQualityMode,
        previousDataUrl: previousImage,
        initialPayload: imagePayload,
        setImageState: function (dataUrl) {
            state.projectImage = dataUrl;
        }
    });

    if (!persistence.saved) {
        state.projectImage = previousImage;
        renderProjectBanner();
        setProjectImageMessage(
            "Image could not be saved. Use a smaller file or clear older photos. " + getApproxImageSpaceLeftText(),
            true
        );
        elements.projectImageInput.value = "";
        return;
    }

    imagePayload = persistence.payload;

    renderProjectBanner();
    if (imagePayload.wasResized) {
        setProjectImageMessage(
            "Map image loaded and resized: "
                + file.name
                + " ("
                + bytesToMegabytesText(imagePayload.sourceBytes)
                + " MB -> "
                + bytesToMegabytesText(imagePayload.outputBytes)
                + " MB, "
                + getImportQualityModeLabel(imagePayload.qualityMode)
                + " mode)."
                + (persistence.usedStorageFallback ? " Reduced further to fit browser storage." : "")
                + " "
                + getApproxImageSpaceLeftText()
                + " Use View Map Full Screen to expand it.",
            false
        );
        return;
    }

    setProjectImageMessage(
        "Map image loaded: "
            + file.name
            + " ("
            + bytesToMegabytesText(imagePayload.outputBytes)
            + " MB, "
            + getImportQualityModeLabel(imagePayload.qualityMode)
            + " mode)."
            + (persistence.usedStorageFallback ? " Reduced further to fit browser storage." : "")
            + " "
            + getApproxImageSpaceLeftText()
            + " Use View Map Full Screen to expand it.",
        false
    );
}

function removeProjectImage() {
    state.projectImage = "";
    elements.projectImageInput.value = "";
    saveSession();
    renderProjectBanner();
    closeMapViewer();
    setProjectImageMessage("Map image removed.", false);
}

function renderProjectBanner() {
    const hasImage = Boolean(state.projectImage);
    elements.projectBannerImg.hidden = !hasImage;
    elements.projectBannerEmpty.hidden = hasImage;
    elements.openProjectImageButton.hidden = !hasImage;
    elements.removeProjectImageButton.hidden = !hasImage;

    if (hasImage) {
        elements.projectBannerImg.src = state.projectImage;
    } else {
        elements.projectBannerImg.src = "";
        closeMapViewer();
    }

    updateImageStorageStatus();
}

