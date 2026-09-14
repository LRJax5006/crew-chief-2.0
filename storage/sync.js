// storage/sync.js
// Handles sync between local and cloud backends

import { localBackend } from './local.js';
import { cloudBackend } from './cloud.js';

export const syncBackend = {
    save(key, value) {
        // Save to both local and cloud
        return Promise.all([
            localBackend.save(key, value),
            cloudBackend.save(key, value).catch(() => {}) // Ignore cloud errors for now
        ]);
    },
    load(key) {
        // Prefer local, fallback to cloud
        return localBackend.load(key).then(val => {
            if (val !== null) return val;
            return cloudBackend.load(key).catch(() => null);
        });
    },
    sync() {
        // TODO: Implement two-way sync/merge
        return Promise.resolve();
    }
};
