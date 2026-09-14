// ui/status.js
// Status and error indicator component stub
// Expects: status, error, sync state

export function showStatus({ status, error, syncState }) {
    // Placeholder: Replace with real status UI
    const statusDiv = document.createElement('div');
    statusDiv.className = 'status-indicator';
    statusDiv.textContent = error ? `Error: ${error}` : status || syncState || '';
    return statusDiv;
}
