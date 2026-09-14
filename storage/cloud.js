// storage/cloud.js
// Cloud storage backend (Google Drive, iCloud, or custom API)

// Google Drive integration scaffold
// TODO: Add Google API client script to index.html if not present
// TODO: Handle OAuth2 sign-in and token management
// TODO: Save/load files to user's Google Drive (AppData or user folder)


// GIS OAuth2 token client
let gisTokenClient = null;
let driveAccessToken = null;
let gapiLoaded = false;

function loadGapiClient() {
    return new Promise((resolve, reject) => {
        if (gapiLoaded && window.gapi && window.gapi.client) return resolve();
        if (window.gapi && window.gapi.client) {
            gapiLoaded = true;
            return resolve();
        }
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.onload = () => {
            gapiLoaded = true;
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function ensureDriveToken() {
    // If already have a valid token, return
    if (driveAccessToken) return driveAccessToken;

    // Initialize GIS token client if not already
    if (!gisTokenClient) {
            // Load client_id from environment or injected config
            const clientId = (window.ENV && window.ENV.GOOGLE_CLIENT_ID) || (typeof GOOGLE_CLIENT_ID !== 'undefined' ? GOOGLE_CLIENT_ID : undefined) || 'REPLACE_ME_IN_ENV';
            gisTokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file',
            callback: (tokenResponse) => {
                driveAccessToken = tokenResponse.access_token;
            },
        });
    }

    // Request access token interactively
    return new Promise((resolve, reject) => {
        gisTokenClient.callback = (tokenResponse) => {
            if (tokenResponse.error) {
                reject(tokenResponse);
            } else {
                driveAccessToken = tokenResponse.access_token;
                resolve(driveAccessToken);
            }
        };
        gisTokenClient.requestAccessToken({ prompt: 'consent' });
    });
}


// Helper to generate a Drive file name with site name and date
function makeDriveFileName(key, value) {
    let site = (value && value.siteName) ? value.siteName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'archaeolab';
    let date = new Date().toISOString().slice(0, 10);
    return `${site}_${key}_${date}.json`;
}

// Helper to find a file by name in Drive (AppData folder)
async function findDriveFileId(fileName) {
    const res = await window.gapi.client.drive.files.list({
        spaces: 'appDataFolder',
        q: `name = '${fileName}' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1
    });
    return res.result.files && res.result.files.length > 0 ? res.result.files[0].id : null;
}

function loadGapiDriveApi() {
    return new Promise((resolve, reject) => {
        window.gapi.load('client', async () => {
            try {
                await window.gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

export const cloudBackend = {
    async save(key, value) {
        await loadGapiClient();
        await loadGapiDriveApi();
        const token = await ensureDriveToken();
        window.gapi.client.setToken({ access_token: token });

        const fileName = makeDriveFileName(key, value);
        const fileContent = JSON.stringify(value, null, 2);
        const fileId = await findDriveFileId(fileName);
        const metadata = {
            name: fileName,
            parents: ['appDataFolder']
        };
        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelim = `\r\n--${boundary}--`;
        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            fileContent +
            delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            closeDelim;
        if (fileId) {
            // Update existing file
            await window.gapi.client.request({
                path: `/upload/drive/v3/files/${fileId}`,
                method: 'PATCH',
                params: { uploadType: 'media' },
                body: fileContent,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            // Create new file
            await window.gapi.client.request({
                path: '/upload/drive/v3/files',
                method: 'POST',
                params: { uploadType: 'multipart' },
                headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
                body: multipartRequestBody
            });
        }
        return true;
    },
    async load(key, valueForSiteName) {
        await loadGapiClient();
        await loadGapiDriveApi();
        const token = await ensureDriveToken();
        window.gapi.client.setToken({ access_token: token });

        // valueForSiteName is optional, but if provided, use its siteName for file lookup
        const fileName = makeDriveFileName(key, valueForSiteName);
        const fileId = await findDriveFileId(fileName);
        if (!fileId) return null;
        const res = await window.gapi.client.drive.files.get({
            fileId,
            alt: 'media'
        });
        return res.body ? JSON.parse(res.body) : null;
    },
    async sync() {
        // TODO: Implement two-way sync if needed
        return Promise.resolve();
    }
};
