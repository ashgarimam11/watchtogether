import { state, getToken } from './state.js';
import { elements } from './ui.js';
import { getSocket } from './api.js';

// =========================================================================
// YT PLAYER INITIALIZATION
// =========================================================================
function createYTPlayer() {
    if (state.player) return;
    state.player = new YT.Player('player', {
        height: '100%', width: '100%', videoId: '',
        playerVars: { 'playsinline': 1, 'rel': 0, 'modestbranding': 1, 'fs': 1 },
        events: {
            'onStateChange': (event) => {
                if (!state.player) return;

                // If the player is buffering, let the server know so others 
                // see the "buffering" toast, but don't broadcast a play/pause yet.
                if (event.data === YT.PlayerState.BUFFERING) {
                    if (!state.isRemoteAction) {
                        const socket = getSocket();
                        if (socket && state.currentRoom) {
                            socket.emit('buffering', { roomId: state.currentRoom, token: getToken() });
                        }
                    }
                    return;
                }

                // Don't broadcast local actions if this state change was triggered by a remote sync
                if (state.isRemoteAction) return;

                const time = state.player.getCurrentTime();
                
                // By directly broadcasting PLAYING and PAUSED, a timeline seek 
                // (which fires BUFFERING -> PLAYING) successfully broadcasts the new time.
                if (event.data === YT.PlayerState.PLAYING) {
                    broadcastAction('play', time);
                } else if (event.data === YT.PlayerState.PAUSED) {
                    broadcastAction('pause', time);
                }
            },
            'onReady': () => {
                console.log('[SyncTube] YT Player ready');
            }
        }
    });
}

if (window.YT && window.YT.Player) {
    createYTPlayer();
} else {
    window.onYouTubeIframeAPIReady = createYTPlayer;
}

// =========================================================================
// HTML5 PLAYER BUFFERING REPORT
// =========================================================================
if (elements.htmlPlayer) {
    elements.htmlPlayer.addEventListener('waiting', () => {
        if (state.isRemoteAction) return; // Don't spam buffering if we triggered the pause/seek
        const socket = getSocket();
        if (socket && state.currentRoom) {
            socket.emit('buffering', {
                roomId: state.currentRoom,
                token: getToken()
            });
        }
    });
}

// =========================================================================
// BROADCAST & SAFE PLAY
// =========================================================================
export function broadcastAction(action, time) {
    if (state.isRemoteAction) return;
    const socket = getSocket();
    if (socket && state.currentRoom) {
        socket.emit('videoAction', {
            roomId: state.currentRoom,
            action,
            time,
            token: getToken()
        });
    }
}

export function safePlay(videoElement) {
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.warn("Mobile OS Blocked Autoplay.", error);
            elements.videoWrapper.classList.add('autoplay-blocked');
        });
    }
}

// =========================================================================
// MOUNT: DIRECT VIDEO (HTML5 player)
// =========================================================================
export function mountDirectVideo(url, time = 0, videoState = 'playing', forceHls = false) {
    elements.videoWrapper.classList.add('video-active');

    if (elements.ghostIframe) { elements.ghostIframe.src = ''; elements.ghostIframe.classList.add('hidden'); }
    if (elements.ytPlayerContainer) { elements.ytPlayerContainer.classList.add('hidden'); }
    if (state.player && typeof state.player.pauseVideo === 'function') {
        try { state.player.pauseVideo(); } catch(e) {}
    }

    elements.htmlPlayer.classList.remove('hidden');
    if (state.hlsInstance) { state.hlsInstance.destroy(); state.hlsInstance = null; }

    if (window.Hls && window.Hls.isSupported() && (forceHls || url.includes('.m3u8'))) {
        state.hlsInstance = new window.Hls();
        state.hlsInstance.loadSource(url);
        state.hlsInstance.attachMedia(elements.htmlPlayer);
        state.hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
            elements.qualitySelector.classList.remove('hidden');
            elements.qualitySelector.innerHTML = '<option value="-1">Auto Quality</option>';
            data.levels.forEach((level, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${level.height}p`;
                elements.qualitySelector.appendChild(opt);
            });

            if (time > 0) state.hlsInstance.startLoad(time);
            else state.hlsInstance.startLoad(0);

            if (videoState !== 'paused') safePlay(elements.htmlPlayer);
        });
    } else {
        elements.qualitySelector.classList.add('hidden');
        elements.htmlPlayer.src = url;

        const onLoadedMetadata = () => {
            if (time > 0) {
                try { elements.htmlPlayer.currentTime = time; } catch(e) {}
            }
            if (videoState !== 'paused') safePlay(elements.htmlPlayer);
            elements.htmlPlayer.removeEventListener('loadedmetadata', onLoadedMetadata);
        };
        elements.htmlPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
    }
}

// =========================================================================
// MOUNT: YOUTUBE
// =========================================================================
export function mountYouTubeVideo(videoId, time = 0, videoState = 'playing') {
    elements.videoWrapper.classList.add('video-active');

    if (elements.htmlPlayer) { elements.htmlPlayer.pause(); elements.htmlPlayer.src = ''; }
    elements.htmlPlayer.classList.add('hidden');
    if (elements.ghostIframe) { elements.ghostIframe.src = ''; elements.ghostIframe.classList.add('hidden'); }
    elements.qualitySelector.classList.add('hidden');
    elements.ytPlayerContainer.classList.remove('hidden');

    if (state.player && typeof state.player.loadVideoById === 'function') {
        state.player.loadVideoById({ videoId: videoId, startSeconds: time });
        if (videoState === 'paused') {
            setTimeout(() => { try { state.player.pauseVideo(); } catch(e){} }, 800);
        }
    } else {
        let retries = 0;
        const waitForPlayer = setInterval(() => {
            retries++;
            if (state.player && typeof state.player.loadVideoById === 'function') {
                clearInterval(waitForPlayer);
                state.player.loadVideoById({ videoId: videoId, startSeconds: time });
                if (videoState === 'paused') {
                    setTimeout(() => { try { state.player.pauseVideo(); } catch(e){} }, 800);
                }
            } else if (retries > 20) {
                clearInterval(waitForPlayer);
                console.error('[SyncTube] YT Player failed to initialize after 10s');
            }
        }, 500);
    }
}

// =========================================================================
// MOUNT: GHOST IFRAME
// =========================================================================
export function mountGhostIframe(url) {
    elements.videoWrapper.classList.add('video-active');

    if (elements.htmlPlayer) { elements.htmlPlayer.pause(); elements.htmlPlayer.removeAttribute('src'); elements.htmlPlayer.load(); }
    elements.htmlPlayer.classList.add('hidden');
    elements.qualitySelector.classList.add('hidden');
    if (elements.ytPlayerContainer) { elements.ytPlayerContainer.classList.add('hidden'); }
    if (state.player && typeof state.player.pauseVideo === 'function') {
        try { state.player.pauseVideo(); } catch(e) {}
    }

    if (state.hlsInstance) {
        state.hlsInstance.destroy();
        state.hlsInstance = null;
    }

    if (elements.ghostIframe) {
        elements.ghostIframe.classList.remove('hidden');
        elements.ghostIframe.src = url;
    }
}

// =========================================================================
// URL PARSER
// =========================================================================
export function parseVideoInput(url) {
    const trimmed = url.trim();
    if (!trimmed) return null;

    if (trimmed.toLowerCase().startsWith('embed:')) return 'embed:' + trimmed.substring(6).trim();
    if (trimmed.toLowerCase().startsWith('hls:')) return 'hls:' + trimmed.substring(4).trim();

    const ytRegExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = trimmed.match(ytRegExp);
    if (match && match[2].length === 11) return match[2];

    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;

    return null;
}