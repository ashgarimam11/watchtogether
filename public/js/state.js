export const state = {
    currentRoom: '',
    localUsername: '',
    deviceId: null,
    isRemoteAction: false,
    player: null,
    hlsInstance: null,
    isHost: false,
    timeOffset: 0,
    latency: 0
};

// =========================================================================
// REMOTE ACTION LOCK
// isRemoteAction is read by every local player-event listener to decide
// "did I cause this, or did a remote sync?" Multiple remote events (pause
// sync, the buffer-ready handshake, drift correction) can overlap in time.
// If each one just did `state.isRemoteAction = true; setTimeout(() => ...
// = false, N)` independently, an earlier timer can fire mid-way through a
// later remote action and prematurely unlock it — letting a local listener
// see the remote-triggered pause/seek as a real user action and rebroadcast
// it, fighting the sync that's still in progress. These two helpers make
// sure only the *latest* lock's timer is ever the one that releases it.
// =========================================================================
let _remoteActionTimer = null;

export function lockRemoteAction(autoReleaseMs = null) {
    state.isRemoteAction = true;
    if (_remoteActionTimer) {
        clearTimeout(_remoteActionTimer);
        _remoteActionTimer = null;
    }
    if (autoReleaseMs != null) {
        _remoteActionTimer = setTimeout(() => {
            state.isRemoteAction = false;
            _remoteActionTimer = null;
        }, autoReleaseMs);
    }
}

export function releaseRemoteAction(delay = 0) {
    if (_remoteActionTimer) {
        clearTimeout(_remoteActionTimer);
        _remoteActionTimer = null;
    }
    if (delay > 0) {
        _remoteActionTimer = setTimeout(() => {
            state.isRemoteAction = false;
            _remoteActionTimer = null;
        }, delay);
    } else {
        state.isRemoteAction = false;
    }
}

export function getToken() {
    return localStorage.getItem('synctube_token') || sessionStorage.getItem('synctube_token');
}

export function setToken(token) {
    if (token) {
        localStorage.setItem('synctube_token', token);
    }
}
