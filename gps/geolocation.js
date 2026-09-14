// gps/geolocation.js
// Handles browser/device geolocation, error handling, batching

let watchId = null;

export function getCurrentPosition(opts = {}) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject('Geolocation not supported');
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
    });
}

export function watchPosition(onSuccess, onError, opts = {}) {
    if (!navigator.geolocation) {
        onError && onError('Geolocation not supported');
        return null;
    }
    watchId = navigator.geolocation.watchPosition(onSuccess, onError, opts);
    return watchId;
}

export function stopWatch() {
    if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}
