import { state, setToken, getToken, lockRemoteAction, releaseRemoteAction } from './state.js';
import { elements, spawnFloatingReaction, showToast } from './ui.js';
import { initSocket, getSocket } from './api.js';
import { mountYouTubeVideo, mountDirectVideo, mountGhostIframe, parseVideoInput, safePlay, broadcastAction } from './player.js';
import { sendMessage, sendDigitalTouch } from './chat.js';

// =========================================================================
// 0. OS & CAPABILITY DETECTION
// =========================================================================
const userAgent = navigator.userAgent || navigator.vendor || window.opera;
const isIPhone = /iPhone|iPod/.test(userAgent);
if (!isIPhone) { document.body.classList.add('fs-overlay-supported'); }

let deviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
try {
    const stored = localStorage.getItem('synctube_device');
    if (stored) deviceId = stored;
    else localStorage.setItem('synctube_device', deviceId);
} catch(e) {}

state.isSeeking = false;

const socket = initSocket();

let savedName = '';
try { savedName = localStorage.getItem('synctube_username') || ''; } catch (e) {}
if (savedName) elements.modalUser.value = savedName;

try {
    const urlParams = new URLSearchParams(window.location.search);
    const invitedRoom = urlParams.get('room');
    if (invitedRoom) {
        elements.modalRoom.value = invitedRoom;
        elements.modalDesc.innerText = "You've been invited! Enter your alias to knock.";
        elements.modalBtn.innerText = "Knock to Enter";
    }
} catch (e) { console.error(e); }

if (savedName) {
    setTimeout(() => { elements.modalBtn.click(); }, 100);
}

elements.modalBtn.addEventListener('click', () => {
    const userVal = elements.modalUser.value.trim();
    const roomVal = elements.modalRoom.value.trim();
    if (!userVal) return alert("Username is mandatory.");

    state.localUsername = userVal;
    try { localStorage.setItem('synctube_username', state.localUsername); } catch (e) {}
    
    if (roomVal) {
        elements.modalStatus.style.display = 'block';
        elements.modalStatus.innerText = 'Connecting...';
        elements.modalBtn.disabled = true;
        socket.emit('requestJoin', { roomId: roomVal, username: state.localUsername, deviceId: deviceId, token: getToken() });
    } else {
        elements.modalStatus.style.display = 'block';
        elements.modalStatus.innerText = 'Creating room...';
        elements.modalBtn.disabled = true;
        socket.emit('createRoom', { username: state.localUsername, deviceId: deviceId, token: getToken() }, (response) => {
            if (!response || !response.success) {
                elements.modalStatus.innerText = (response && response.error) || 'Could not create room. Please try again.';
                elements.modalBtn.disabled = false;
                return;
            }
        });
    }
});

// =========================================================================
// HTML PLAYER EVENTS (With Buffer Recovery Fix)
// =========================================================================
state.htmlWasBuffering = false;

elements.htmlPlayer.addEventListener('waiting', () => { 
    state.htmlWasBuffering = true; 
});

elements.htmlPlayer.addEventListener('playing', () => {
    if (state.htmlWasBuffering) state.htmlWasBuffering = false;
});

elements.htmlPlayer.addEventListener('play', () => {
    if (state.isRemoteAction || state.isSeeking) return;
    if (state.htmlWasBuffering) return; // Swallow play event if recovering from a buffer
    broadcastAction('play', elements.htmlPlayer.currentTime);
});

elements.htmlPlayer.addEventListener('pause', () => {
    if (state.isRemoteAction || state.isSeeking) return;
    broadcastAction('pause', elements.htmlPlayer.currentTime);
});

elements.htmlPlayer.addEventListener('seeking', () => { state.isSeeking = true; });
elements.htmlPlayer.addEventListener('seeked', () => {
    state.isSeeking = false;
    if (state.isRemoteAction) return;
    broadcastAction(elements.htmlPlayer.paused ? 'pause' : 'play', elements.htmlPlayer.currentTime);
});

// =========================================================================
// SYNC EVENTS
// =========================================================================
socket.on('syncAction', (data) => {
    lockRemoteAction();
    const isDirect = !elements.htmlPlayer.classList.contains('hidden');
    const isYT = !elements.ytPlayerContainer.classList.contains('hidden');
    const { time } = data;

    if (isDirect && Math.abs(elements.htmlPlayer.currentTime - time) > 0.5) {
        elements.htmlPlayer.currentTime = time;
    }
    if (isYT && state.player && typeof state.player.getCurrentTime === 'function') {
        if (Math.abs(state.player.getCurrentTime() - time) > 0.5) {
            state.player.seekTo(time, true);
        }
    }

    if (isDirect) elements.htmlPlayer.pause();
    else if (isYT && state.player && typeof state.player.pauseVideo === 'function') state.player.pauseVideo();

    releaseRemoteAction(500);
});

// =========================================================================
// TWO-PHASE COMMIT BUFFER-READY PROTOCOL
// =========================================================================
let activeBufferCheck = null;

socket.on('prepareToPlay', (data) => {
    lockRemoteAction(8000);

    if (activeBufferCheck) {
        clearInterval(activeBufferCheck);
        activeBufferCheck = null;
    }

    const { time, playId } = data;
    const isDirect = !elements.htmlPlayer.classList.contains('hidden');
    const isYT = !elements.ytPlayerContainer.classList.contains('hidden');

    let reported = false;
    const reportReady = () => {
        if (reported) return;
        reported = true;
        socket.emit('bufferReady', { roomId: state.currentRoom, playId, token: getToken() });
    };

    if (isDirect) {
        elements.htmlPlayer.pause();
        if (Math.abs(elements.htmlPlayer.currentTime - time) > 0.5) {
            elements.htmlPlayer.currentTime = time;
        }

        if (elements.htmlPlayer.readyState >= 3) {
            reportReady();
        } else {
            const onCanPlay = () => { elements.htmlPlayer.removeEventListener('canplay', onCanPlay); reportReady(); };
            elements.htmlPlayer.addEventListener('canplay', onCanPlay);
            setTimeout(() => { elements.htmlPlayer.removeEventListener('canplay', onCanPlay); reportReady(); }, 4000);
        }
    } else if (isYT && state.player && typeof state.player.pauseVideo === 'function') {
        state.player.pauseVideo();
        if (Math.abs(state.player.getCurrentTime() - time) > 0.5) {
            state.player.seekTo(time, true);
        }

        activeBufferCheck = setInterval(() => {
            const playerState = typeof state.player.getPlayerState === 'function' ? state.player.getPlayerState() : null;
            if (window.YT && playerState !== window.YT.PlayerState.BUFFERING) {
                clearInterval(activeBufferCheck);
                activeBufferCheck = null;
                reportReady();
            }
        }, 150);
        setTimeout(() => {
            if (activeBufferCheck) { clearInterval(activeBufferCheck); activeBufferCheck = null; }
            reportReady();
        }, 4000);
    } else {
        reportReady();
    }
});

socket.on('executePlay', () => {
    lockRemoteAction();
    const isDirect = !elements.htmlPlayer.classList.contains('hidden');
    const isYT = !elements.ytPlayerContainer.classList.contains('hidden');

    if (isDirect) safePlay(elements.htmlPlayer);
    else if (isYT && state.player && typeof state.player.playVideo === 'function') state.player.playVideo();

    releaseRemoteAction(800);
});

socket.on('syncCorrection', (serverState) => {
    if (state.isRemoteAction || state.isSeeking) return; 
    
    const isDirect = !elements.htmlPlayer.classList.contains('hidden');
    const isYT = !elements.ytPlayerContainer.classList.contains('hidden');

    if (!isDirect && !isYT) return;

    if (isDirect && elements.htmlPlayer.readyState < 3) return; 
    if (isYT && state.player && typeof state.player.getPlayerState === 'function') {
        if (window.YT && state.player.getPlayerState() === window.YT.PlayerState.BUFFERING) return;
    }

    let myTime = isDirect ? elements.htmlPlayer.currentTime : (state.player && typeof state.player.getCurrentTime === 'function' ? state.player.getCurrentTime() : 0);
    let expectedTime = serverState.time;
    if (serverState.state === 'playing') expectedTime += (state.latency / 1000);
    
    let drift = expectedTime - myTime;
    const hardThreshold = 2.5;
    const softThreshold = 1.0;

    if (Math.abs(drift) > hardThreshold) {
        if (isDirect) {
            // BUG FIX: If behind, speed up aggressively (1.5x) instead of hard seek to prevent stutter
            if (drift > 0) {
                elements.htmlPlayer.playbackRate = 1.5;
            } else {
                // If ahead, we have to seek back
                lockRemoteAction();
                const wasMuted = elements.htmlPlayer.muted;
                elements.htmlPlayer.muted = true;
                elements.htmlPlayer.currentTime = expectedTime;
                setTimeout(() => { if (!wasMuted) elements.htmlPlayer.muted = false; }, 500);
                releaseRemoteAction(500);
            }
        } else if (isYT && state.player && typeof state.player.seekTo === 'function') {
            lockRemoteAction();
            state.player.seekTo(expectedTime, true);
            releaseRemoteAction(800);
        }
    } else if (Math.abs(drift) > softThreshold && serverState.state === 'playing') {
        if (isDirect) {
            elements.htmlPlayer.playbackRate = drift > 0 ? 1.1 : 0.9;
        } else if (isYT && state.player) {
            const wasMuted = state.player.isMuted();
            state.player.mute();
            state.player.seekTo(expectedTime, true);
            setTimeout(() => { if (!wasMuted) state.player.unMute(); }, 400);
        }
    } else {
        if (isDirect && elements.htmlPlayer.playbackRate !== 1.0) elements.htmlPlayer.playbackRate = 1.0;
    }
});

if (elements.autoplayOverlay) {
    elements.autoplayOverlay.addEventListener('click', () => {
        elements.videoWrapper.classList.remove('autoplay-blocked');
        elements.htmlPlayer.play();
        if (state.player && typeof state.player.playVideo === 'function') state.player.playVideo();
    });
}

elements.htmlPlayer.addEventListener('error', () => {
    const currentSrc = elements.htmlPlayer.getAttribute('src');
    if (!currentSrc || currentSrc === '' || elements.htmlPlayer.classList.contains('hidden')) return;
    const err = elements.htmlPlayer.error;
    if (err) {
        let msg = "Unknown Error";
        if (err.code === 1) msg = "Download Aborted";
        if (err.code === 2) msg = "Network Error (CORS Blocked by Server)";
        if (err.code === 3) msg = "Media Decode Error";
        if (err.code === 4) msg = "Format Not Supported (Masked URL or HTML wrapper)";
        console.error("Video Error:", msg);
        alert(`Direct Engine Failed: ${msg}.\n\nTry forcing the engine:\n1. Type "hls:" before the link for masked streams.\n2. Type "embed:" for HTML websites.`);
    }
});

elements.loadBtn.addEventListener('click', () => {
    const videoId = parseVideoInput(elements.videoInput.value);
    if (videoId) {
        socket.emit('loadVideo', { roomId: state.currentRoom, videoId, token: getToken() });
        elements.videoInput.value = ''; 
    } else { alert('Invalid link format.'); }
});

elements.queueBtn.addEventListener('click', () => {
    const videoId = parseVideoInput(elements.videoInput.value);
    if (videoId) {
        socket.emit('queueVideo', { roomId: state.currentRoom, videoId, title: 'YouTube Video', token: getToken() });
        elements.videoInput.value = ''; 
    } else { alert('Invalid link format.'); }
});

elements.videoInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') elements.loadBtn.click(); });

// =========================================================================
// INVITE BUTTONS (Desktop & Mobile)
// =========================================================================
async function copyInviteLink(triggerBtnTextEl, closePanelEl = null) {
    if (!state.currentRoom) {
        showToast('Room not initialized yet', 'error');
        return;
    }
    const inviteLink = `${window.location.origin}/watch.html?room=${state.currentRoom}`;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(inviteLink);
        } else {
            throw new Error("Clipboard API not available");
        }
        triggerBtnTextEl.innerText = 'Copied!';
        setTimeout(() => triggerBtnTextEl.innerText = 'Invite', 2000);
    } catch (err) {
        const tempInput = document.createElement('input');
        tempInput.value = inviteLink;
        document.body.appendChild(tempInput);
        tempInput.select();
        try {
            document.execCommand('copy');
            triggerBtnTextEl.innerText = 'Copied!';
            setTimeout(() => triggerBtnTextEl.innerText = 'Invite', 2000);
        } catch (e2) {
            prompt("Copy this link:", inviteLink);
        }
        document.body.removeChild(tempInput);
    }

    if (closePanelEl) {
        setTimeout(() => {
            closePanelEl.classList.remove('open');
        }, 1500);
    }
}

if (elements.inviteBtn) {
    elements.inviteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        copyInviteLink(elements.inviteText);
    });
}

if (elements.panelInviteBtn) {
    elements.panelInviteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        copyInviteLink(elements.panelInviteText, elements.mediaMenuPanel);
    });
}

// ─── MOBILE MENU (☰) ───
if (elements.mediaMenuBtn && elements.mediaMenuPanel) {
    elements.mediaMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.mediaMenuPanel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!elements.mediaMenuPanel.contains(e.target) && !elements.mediaMenuBtn.contains(e.target)) {
            elements.mediaMenuPanel.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') elements.mediaMenuPanel.classList.remove('open');
    });
}

if (elements.reactionBtns) {
    elements.reactionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.innerText;
            spawnFloatingReaction(emoji); 
            if (state.currentRoom) socket.emit('sendReaction', { roomId: state.currentRoom, emoji: emoji, token: getToken() });
        });
    });
}
socket.on('receiveReaction', (data) => { spawnFloatingReaction(data.emoji); });

socket.on('memberBuffering', (data) => {
    showToast(`${data.username} is buffering…`, 'info');
});

socket.on('queueUpdated', (queue) => {
    state.queue = queue;
    renderQueue();
});

function renderQueue() {
    elements.queueList.innerHTML = '';
    if (!state.queue || state.queue.length === 0) {
        elements.queueList.appendChild(elements.queueEmptyState);
        elements.queueEmptyState.style.display = 'block';
    } else {
        elements.queueEmptyState.style.display = 'none';
        state.queue.forEach((item, index) => {
            const el = document.createElement('div');
            el.className = 'queue-item';
            el.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                    <div style="flex-shrink: 0; width: 80px; height: 45px; border-radius: 4px; overflow: hidden; background: #222;">
                        <img src="https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg" style="width: 100%; height: 100%; object-fit: cover;" alt="Thumbnail">
                    </div>
                    <div style="flex-grow: 1; min-width: 0;">
                        <div class="queue-item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.9em; margin-bottom: 2px;">
                            ${index + 1}. ${item.title || item.videoId}
                        </div>
                        <div style="font-size: 0.75em; color: #a3a3a3;">
                            Added by ${item.addedBy || 'User'}
                        </div>
                    </div>
                </div>
                <div class="queue-item-actions">
                    <button class="btn btn-secondary btn-icon play-now-btn" title="Play Now">
                        <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                    </button>
                </div>
            `;
            
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                socket.emit('loadVideo', { roomId: state.currentRoom, videoId: item.videoId, token: getToken() });
            });
            
            elements.queueList.appendChild(el);
        });
        setTimeout(() => { elements.queueList.scrollTop = elements.queueList.scrollHeight; }, 50);
    }
}
window.renderQueue = renderQueue;

elements.sendBtn.addEventListener('click', sendMessage);
elements.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
const fsChatInput = document.getElementById('fsChatInput');
if (fsChatInput) {
    fsChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (elements.chatInput) {
                elements.chatInput.value = fsChatInput.value;
                sendMessage();
                fsChatInput.value = '';
                fsChatInput.blur();
            }
        }
    });
}
elements.sendBtn.addEventListener('touchstart', (e) => { e.preventDefault(); sendMessage(); }, { passive: false });
elements.sendBtn.addEventListener('mousedown', (e) => e.preventDefault());

elements.touchBtn.addEventListener('click', sendDigitalTouch);
elements.touchBtn.addEventListener('touchstart', (e) => { e.preventDefault(); sendDigitalTouch(); }, { passive: false });
elements.touchBtn.addEventListener('mousedown', (e) => e.preventDefault());

socket.on('newMessage', (data) => {
    const msgElement = document.createElement('div');
    msgElement.classList.add('chat-message');
    const cleanText = window.DOMPurify.sanitize(data.message);
    
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
    const extractedEmojis = cleanText.match(emojiRegex);
    if (extractedEmojis) {
        extractedEmojis.slice(0, 4).forEach((emoji, index) => {
            setTimeout(() => spawnFloatingReaction(emoji), index * 150);
        });
    }

    let hash = 0;
    for (let i = 0; i < data.username.length; i++) { hash = data.username.charCodeAt(i) + ((hash << 5) - hash); }
    const color = `hsl(${Math.abs(hash) % 360}, 75%, 45%)`;

    msgElement.innerHTML = `
        <div class="chat-avatar" style="background-color: ${color}">${data.username.charAt(0).toUpperCase()}</div>
        <div class="chat-content">
            <span class="chat-author">${data.username}</span>
            <span class="chat-text">${cleanText}</span>
        </div>
    `;
    elements.chatMessages.appendChild(msgElement);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    if (document.body.classList.contains('is-fullscreen')) {
        elements.chatColumn.classList.add('chat-peek');
        clearTimeout(window.chatFadeTimer);
        window.chatFadeTimer = setTimeout(() => { elements.chatColumn.classList.remove('chat-peek'); }, 4000); 
    }
});

socket.on('receiveTouch', () => {
    elements.videoWrapper.classList.remove('glow-active');
    void elements.videoWrapper.offsetWidth; 
    elements.videoWrapper.classList.add('glow-active');
    if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
    setTimeout(() => { elements.videoWrapper.classList.remove('glow-active'); }, 2500);
});

elements.emojiBtn.addEventListener('click', () => elements.emojiPicker.classList.toggle('hidden'));
elements.emojiPicker.addEventListener('emoji-click', event => {
    elements.chatInput.value += event.detail.unicode;
    elements.emojiPicker.classList.add('hidden'); 
    elements.chatInput.focus();
});

// FULLSCREEN BUTTON
function toggleFullscreen() {
    const elem = elements.mainLayout || document.documentElement;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('is-fullscreen');
    const isHtmlPlayerActive = !elements.htmlPlayer.classList.contains('hidden');
    const activePlayer = isHtmlPlayerActive ? elements.htmlPlayer : elements.ghostIframe;

    if (!isFs) {
        let fsPromise = null;
        if (elem.requestFullscreen) fsPromise = elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) fsPromise = elem.webkitRequestFullscreen();

        if (fsPromise) {
            fsPromise.catch(err => {
                console.warn("Native FS failed, using CSS fallback", err);
                document.body.classList.add('is-fullscreen');
            });
        } else if (activePlayer && activePlayer.webkitEnterFullscreen) {
            activePlayer.webkitEnterFullscreen();
        } else {
            document.body.classList.add('is-fullscreen');
        }
    } else {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
            document.body.classList.remove('is-fullscreen');
        }
    }
}

if (elements.customFsBtn) elements.customFsBtn.addEventListener('click', toggleFullscreen);
if (elements.customFsBtnMobile) elements.customFsBtnMobile.addEventListener('click', toggleFullscreen);

if (elements.exitFsBtn) {
    elements.exitFsBtn.addEventListener('click', () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
            document.body.classList.remove('is-fullscreen');
        }
    });
}

function handleFsChange() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        document.body.classList.add('is-fullscreen');
    } else { 
        document.body.classList.remove('is-fullscreen'); 
        setTimeout(() => {
            if (window.innerWidth > 1024) { elements.mainLayout.style.height = ''; }
            window.dispatchEvent(new Event('resize')); 
        }, 100);
    }
    applyResizerState(); // Instantly apply or remove the 65% split depending on FS state
}
document.addEventListener('fullscreenchange', handleFsChange);
document.addEventListener('webkitfullscreenchange', handleFsChange);

if (elements.qualitySelector) {
    elements.qualitySelector.addEventListener('change', (e) => {
        if (state.hlsInstance) state.hlsInstance.currentLevel = parseInt(e.target.value);
    });
}

// DYNAMIC PHANTOM SHIELD (For Mobile Keyboard Dismiss)
const phantomShield = document.createElement('div');
phantomShield.className = 'phantom-shield';
elements.videoWrapper.appendChild(phantomShield);

phantomShield.addEventListener('click', () => elements.chatInput.blur());
phantomShield.addEventListener('touchstart', (e) => {
    e.preventDefault();
    elements.chatInput.blur();
}, { passive: false });

let chatTouchStartY = 0;
elements.chatMessages.addEventListener('touchstart', (e) => {
    chatTouchStartY = e.touches[0].clientY;
}, { passive: true });

elements.chatMessages.addEventListener('touchmove', (e) => {
    if (!document.body.classList.contains('keyboard-active')) return;
    const currentY = e.touches[0].clientY;
    if (currentY > chatTouchStartY + 50) { 
        elements.chatInput.blur();
    }
}, { passive: true });

let isRotating = false;
window.addEventListener('orientationchange', () => {
    isRotating = true;
    document.body.classList.remove('tablet-landscape', 'splitview-tablet');
    setTimeout(() => { 
        isRotating = false; 
        checkTabletUIState();
        applyResizerState();
    }, 800);
});

// =========================================================================
// TABLET UI STATE & BUG FIXES
// =========================================================================

// BUG 3 FIX: Detect iPad Split View & Large Tablets (up to 1366px)
function checkTabletUIState() {
    const isTabletScreen = window.screen.width >= 768;
    const isNarrowWindow = window.innerWidth <= 768;
    const isLandscapeTablet = isTabletScreen && window.innerWidth > 768 && window.innerWidth <= 1366 && window.matchMedia("(orientation: landscape)").matches;

    document.body.classList.remove('tablet-landscape', 'splitview-tablet');

    if (isTabletScreen && isNarrowWindow) {
        document.body.classList.add('splitview-tablet');
    } else if (isLandscapeTablet) {
        document.body.classList.add('tablet-landscape');
    }
}
checkTabletUIState();
window.addEventListener('resize', checkTabletUIState);

// BUG 2 FIX: Auto-hide Tablet HUD to prevent native control clutter
let hudHideTimer;
function showTabletHUD() {
    if (!document.body.classList.contains('tablet-landscape')) return;
    elements.videoWrapper.classList.remove('ui-hidden');
    clearTimeout(hudHideTimer);
    hudHideTimer = setTimeout(() => {
        elements.videoWrapper.classList.add('ui-hidden');
    }, 3000);
}

if (elements.videoWrapper) {
    elements.videoWrapper.addEventListener('touchstart', () => {
        if (document.body.classList.contains('tablet-landscape')) {
            showTabletHUD();
        }
    }, { passive: true });
    setTimeout(showTabletHUD, 1000);
}

// BUG 1 FIX: Floating Composer Width Match
const chatComposerArea = document.querySelector('.chat-composer-area');

elements.chatInput.addEventListener('focus', () => {
    const isTabletLandscape = document.body.classList.contains('tablet-landscape');
    
    if (!isTabletLandscape) {
        document.body.classList.add('keyboard-active');
        if (window.innerWidth <= 1024) {
            setTimeout(() => elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight, 150);
        }
    } else {
        // Dynamically set the floating composer width to match the sidebar width
        const sidebarWidth = elements.chatColumn.offsetWidth;
        if (chatComposerArea) chatComposerArea.style.width = `${sidebarWidth}px`;
        document.body.classList.add('keyboard-active');
    }
});

elements.chatInput.addEventListener('blur', () => {
    document.body.classList.remove('keyboard-active');
    
    // Clear the inline width so it returns to normal flex sizing
    const isTabletLandscape = document.body.classList.contains('tablet-landscape');
    if (isTabletLandscape && chatComposerArea) {
        chatComposerArea.style.width = '';
    }
    
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
});

if (window.visualViewport) {
    let resizeTimeout;
    let lastViewportHeight = window.visualViewport.height;

    window.visualViewport.addEventListener('resize', () => {
        const isTabletLandscape = document.body.classList.contains('tablet-landscape');
        // On Tablet Landscape, we use the floating composer, so we DO NOT shrink the layout.
        if (isTabletLandscape) {
            return; 
        }

        if (document.fullscreenElement || document.webkitFullscreenElement || document.body.classList.contains('is-fullscreen')) {
            elements.mainLayout.style.height = '100dvh'; return;
        }
        
        const currentHeight = window.visualViewport.height;
        const heightDelta = currentHeight - lastViewportHeight;
        lastViewportHeight = currentHeight;

        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (window.innerWidth <= 1024) {
                if (document.body.classList.contains('keyboard-active') && !isRotating && heightDelta > 150) {
                    elements.chatInput.blur();
                }

                elements.mainLayout.style.height = `${window.visualViewport.height}px`;
                elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
            } else { 
                elements.mainLayout.style.height = ''; 
            }
        }, 100);
    });
    
    if (window.innerWidth <= 1024) {
        const isTabletLandscapeInit = document.body.classList.contains('tablet-landscape');
        if (!isTabletLandscapeInit) {
            elements.mainLayout.style.height = `${window.visualViewport.height}px`;
        }
    }
}

// =========================================================================
// DRAGGABLE SPLIT VIEW (Tablet Landscape Feature)
// =========================================================================
const resizer = document.getElementById('resizer');
if (resizer) {
    let isResizing = false;

    const startResize = (e) => {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.userSelect = 'none';
        e.preventDefault();
    };

    const doResize = (e) => {
        if (!isResizing) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const layoutWidth = elements.mainLayout.offsetWidth;
        let newWidth = (clientX / layoutWidth) * 100;
        
        // Clamp between 40% and 80%
        newWidth = Math.max(40, Math.min(80, newWidth));
        elements.videoWrapper.style.flexBasis = `${newWidth}%`;
        
        // BUG 1 FIX: If keyboard is open while resizing, update composer width live
        if (document.body.classList.contains('keyboard-active') && document.body.classList.contains('tablet-landscape')) {
            const sidebarWidth = elements.chatColumn.offsetWidth;
            if (chatComposerArea) chatComposerArea.style.width = `${sidebarWidth}px`;
        }
    };

    const stopResize = () => {
        if (!isResizing) return;
        isResizing = false;
        resizer.classList.remove('active');
        document.body.style.userSelect = '';
        
        // BUG 4 FIX: Save state to memory
        const currentWidth = elements.videoWrapper.style.flexBasis;
        if (currentWidth) {
            localStorage.setItem('synctube_resizer_width', currentWidth);
        }
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: false });

    document.addEventListener('mousemove', doResize);
    document.addEventListener('touchmove', doResize, { passive: false });

    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);
}

// BUG 4 FIX: Apply Resizer Memory State
function applyResizerState() {
    // Only apply the 65% split if we are in tablet landscape AND NOT in fullscreen
    if (document.body.classList.contains('tablet-landscape') && !document.body.classList.contains('is-fullscreen')) {
        const savedWidth = localStorage.getItem('synctube_resizer_width');
        if (savedWidth) {
            elements.videoWrapper.style.flexBasis = savedWidth;
        } else {
            elements.videoWrapper.style.flexBasis = '65%'; // Default
        }
    } else {
        // Clear it for portrait/mobile/fullscreen so it fills 100% correctly
        elements.videoWrapper.style.flexBasis = '';
    }
}
applyResizerState();

document.addEventListener('visibilitychange', async () => {
    const isDirectStream = !elements.htmlPlayer.classList.contains('hidden');
    if (document.hidden && isDirectStream && !elements.htmlPlayer.paused) {
        if (document.pictureInPictureEnabled && !elements.htmlPlayer.disablePictureInPicture) {
            try { await elements.htmlPlayer.requestPictureInPicture(); } catch (err) { }
        }
    } else if (!document.hidden && document.pictureInPictureElement) {
        try { await document.exitPictureInPicture(); } catch (err) { }
    }
});