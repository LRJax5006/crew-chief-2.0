// storage/index.js
// Main entry for storage abstraction
// Exposes: save, load, sync, setBackend, getBackend

let backend = null;

export function setBackend(b) { backend = b; }
export function getBackend() { return backend; }

export function save(key, value) {
    if (!backend) throw new Error('No storage backend set');
    return backend.save(key, value);
}

export function load(key) {
    if (!backend) throw new Error('No storage backend set');
    return backend.load(key);
}

export function sync() {
    if (!backend || !backend.sync) return Promise.resolve();
    return backend.sync();
}
