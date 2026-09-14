// storage/local.js
// Local storage backend (localStorage, IndexedDB, etc.)

export const localBackend = {
    save(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
        return Promise.resolve();
    },
    load(key) {
        const val = localStorage.getItem(key);
        return Promise.resolve(val ? JSON.parse(val) : null);
    },
    sync() {
        // No-op for local
        return Promise.resolve();
    }
};
