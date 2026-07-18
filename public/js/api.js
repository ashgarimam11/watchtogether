import { state, setToken, getToken, lockRemoteAction, releaseRemoteAction } from './state.js';
import { elements, updateTypingIndicator, showToast, renderMemberList } from './ui.js';
import { mountGhostIframe, mountDirectVideo, mountYouTubeVideo } from './player.js';

let socketInstance = null;
let socketWrapper = null;
let serverTimeOffset = 0;
let currentVideoId = null;
const callbacks = {};
let pingInterval = null;

export function trueNTP() {
    return Date.now() + serverTimeOffset;
}

function trigger(event, data) {
    if (callbacks[event]) callbacks[event].forEach(cb => cb(data));
}

export function initSocket() {
    if (socketInstance) return socketWrapper;
    
    socketInstance = window.io();

    socketInstance.on('connect', () => {
        showToast('Connected to Server', 'success');
        
        if (pingInterval) clearInterval(pingInterval);
        const syncTime = () => {
            socketInstance.emit('ping', { t1: Date.now() });
        };
        syncTime();
        pingInterval = setInterval(syncTime, 5000);

        if (state.currentRoom) {
            socketInstance.emit('requestJoin', {
                roomId: state.currentRoom,
                username: state.localUsername,
                deviceId: state.deviceId
            });
        }
    });

    socketInstance.on('pong', (data) => {
        const t3 = Date.now();
        const latency = t3 - data.t1;
        state.latency = latency;
        serverTimeOffset = data.t2 + (latency / 2) - t3;
    });

    socketInstance.on('joined', (data) => {
        state.deviceId = data.deviceId;
        if (data.roomId) state.currentRoom = data.roomId; // Fix race condition
        initRoomUI();
    });

    socketInstance.on('roomUpdate', (roomData) => {
        if (!roomData) return;
        
        if (roomData.videoId && roomData.videoId !== currentVideoId) {
            currentVideoId = roomData.videoId;
            lockRemoteAction();
            if (roomData.videoId.startsWith('embed:')) {
                mountGhostIframe(roomData.videoId.substring(6));
            } else if (roomData.videoId.startsWith('hls:')) {
                mountDirectVideo(roomData.videoId.substring(4), roomData.videoTime || 0, roomData.playbackState, true);
            } else if (roomData.videoId.startsWith('http')) {
                mountDirectVideo(roomData.videoId, roomData.videoTime || 0, roomData.playbackState, false);
            } else {
                mountYouTubeVideo(roomData.videoId, roomData.videoTime || 0, roomData.playbackState);
            }
            releaseRemoteAction(1500);
        }

        if (roomData.members) {
            const memberArr = roomData.members.filter(m => m.online);
            renderMemberList(memberArr, state.localUsername);
            if (elements.userCountDisplay) elements.userCountDisplay.innerText = memberArr.length;
            if (elements.mobileUserCountDisplay) elements.mobileUserCountDisplay.innerText = memberArr.length;
        }
    });

    socketInstance.on('syncAction', (actionData) => {
        trigger('syncAction', {
            action: actionData.action,
            time: actionData.time,
            targetExecuteTime: actionData.targetExecuteTime
        });
    });

    socketInstance.on('newMessage', (actionData) => {
        trigger('newMessage', {
            username: actionData.username,
            message: actionData.message,
            sender: actionData.sender
        });
    });

    socketInstance.on('userTyping', (data) => updateTypingIndicator(data.username, true));
    socketInstance.on('userStopTyping', (data) => updateTypingIndicator(data.username, false));

    socketWrapper = {
        emit: (event, data, ack) => {
            if (event === 'createRoom') {
                socketInstance.emit('createRoom', data, (res) => {
                    if (res && res.success) {
                        state.currentRoom = res.roomId; // Instantly set state
                        state.isHost = true;
                        if (res.token) setToken(res.token);
                    }
                    if (ack) ack(res);
                });
                return;
            }
            if (event === 'requestJoin') {
                state.currentRoom = data.roomId;
                state.localUsername = data.username;
                if (socketInstance.connected) {
                    socketInstance.emit('requestJoin', {
                        roomId: data.roomId,
                        username: data.username,
                        deviceId: data.deviceId,
                        token: data.token
                    });
                }
            } else {
                socketInstance.emit(event, data, ack);
            }
        },
        on: (event, callback) => {
            if (event === 'syncAction' || event === 'newMessage') {
                if (!callbacks[event]) callbacks[event] = [];
                callbacks[event].push(callback);
            } else {
                if (socketInstance) {
                    socketInstance.on(event, callback);
                }
            }
        }
    };

    return socketWrapper;
}

export function getSocket() {
    if (!socketInstance) return initSocket();
    return socketWrapper;
}

export function getNtpTime() {
    return Date.now() + serverTimeOffset;
}

export function initRoomUI() {
    if (!state.currentRoom) return;
    const shortHash = state.currentRoom.substring(0, 6).toUpperCase();
    if (elements.navRoom) elements.navRoom.innerText = `Room: ${shortHash}`;
    if (elements.fsRoomDisplay) elements.fsRoomDisplay.innerText = shortHash;
    if (elements.panelRoomDisplay) elements.panelRoomDisplay.innerText = shortHash;
    if (elements.roomStatus) elements.roomStatus.innerText = `Connected via WebSockets`;
    if (elements.modal) elements.modal.classList.add('hidden');
    window.history.replaceState({}, '', `?room=${state.currentRoom}`);
}