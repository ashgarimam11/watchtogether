const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const yts = require('yt-search');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

class RoomStore {
    constructor() {
        this.rooms = new Map();
    }
    getRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                videoId: null,
                videoTime: 0,
                playbackState: 'paused',
                lastUpdatedAt: Date.now(),
                queue: [],
                members: new Map(),
                pendingPlay: null // { id, time, readySet } — active buffer-ready handshake, if any
            });
        }
        return this.rooms.get(roomId);
    }
}
const roomStore = new RoomStore();

function joinRoomSocket(socket, roomId, deviceId, username) {
    const room = roomStore.getRoom(roomId);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.deviceId = deviceId;
    socket.username = username;

    const existingMember = room.members.get(deviceId);
    if (existingMember) {
        existingMember.online = true;
        existingMember.username = username;
    } else {
        room.members.set(deviceId, { username, isHost: room.members.size === 0, online: true });
    }
    return room;
}

function generateRoomId() {
    let roomId;
    do {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (roomStore.rooms.has(roomId));
    return roomId;
}

// =========================================================================
// TWO-PHASE COMMIT BUFFER-READY PROTOCOL
// Instead of guessing a fixed delay and hoping everyone's buffered by then,
// we ask everyone to prepare + report readiness, then fire play in unison.
// This is what actually prevents the "position snap" when someone's stream
// stalls: nobody starts playing until they've confirmed they can.
// =========================================================================
const PREPARE_TO_PLAY_TIMEOUT_MS = 5000; // failsafe: don't let one bad connection block the room forever

function cancelPendingPlay(room) {
    if (room.pendingPlay) {
        clearTimeout(room.pendingPlay.timeoutHandle);
        room.pendingPlay = null;
    }
}

function initiatePlay(roomId, time) {
    const room = roomStore.getRoom(roomId);
    cancelPendingPlay(room);

    const playId = uuidv4();
    room.videoTime = time;

    room.pendingPlay = {
        id: playId,
        time,
        readySet: new Set(),
        timeoutHandle: setTimeout(() => executePlay(roomId, playId), PREPARE_TO_PLAY_TIMEOUT_MS)
    };

    io.to(roomId).emit('prepareToPlay', { time, playId });
}

function executePlay(roomId, playId) {
    const room = roomStore.getRoom(roomId);
    if (!room.pendingPlay || room.pendingPlay.id !== playId) return; // stale/already cancelled
    clearTimeout(room.pendingPlay.timeoutHandle);
    room.pendingPlay = null;

    room.playbackState = 'playing';
    room.lastUpdatedAt = Date.now();
    io.to(roomId).emit('executePlay', { time: room.videoTime });
}

function checkPendingPlayReady(roomId) {
    const room = roomStore.getRoom(roomId);
    if (!room.pendingPlay) return;
    const onlineCount = Array.from(room.members.values()).filter(m => m.online).length;
    if (onlineCount === 0 || room.pendingPlay.readySet.size >= onlineCount) {
        executePlay(roomId, room.pendingPlay.id);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('ping', (data) => {
        socket.emit('pong', { t1: data.t1, t2: Date.now() });
    });

    socket.on('requestJoin', (data) => {
        const { roomId, username, deviceId: clientDeviceId } = data || {};
        if (!roomId || !username) return;
        const deviceId = clientDeviceId || uuidv4();

        joinRoomSocket(socket, roomId, deviceId, username);

        socket.emit('joined', { deviceId, roomId, room: getRoomState(roomId) });
        io.to(roomId).emit('roomUpdate', getRoomState(roomId));
    });

    socket.on('createRoom', (data, ack) => {
        const { username, deviceId: clientDeviceId } = data || {};
        if (!username) {
            if (ack) ack({ success: false, error: 'Username is required.' });
            return;
        }

        const roomId = generateRoomId();
        const deviceId = clientDeviceId || uuidv4();
        const token = uuidv4();

        joinRoomSocket(socket, roomId, deviceId, username);

        if (ack) ack({ success: true, roomId, token, deviceId });
        socket.emit('joined', { deviceId, roomId, room: getRoomState(roomId) });
        io.to(roomId).emit('roomUpdate', getRoomState(roomId));
    });

    socket.on('videoAction', (data) => {
        if (!socket.roomId) return;
        const room = roomStore.getRoom(socket.roomId);

        if (data.action === 'play') {
            initiatePlay(socket.roomId, data.time);
        } else {
            cancelPendingPlay(room); // a pause cancels any in-flight prepare cycle
            room.playbackState = 'paused';
            room.videoTime = data.time;
            room.lastUpdatedAt = Date.now();
            io.to(socket.roomId).emit('syncAction', { action: 'pause', time: data.time });
        }
    });

    socket.on('bufferReady', (data) => {
        if (!socket.roomId) return;
        const room = roomStore.getRoom(socket.roomId);
        if (!room.pendingPlay || room.pendingPlay.id !== data.playId) return; // stale ack
        room.pendingPlay.readySet.add(socket.deviceId);
        checkPendingPlayReady(socket.roomId);
    });

    socket.on('loadVideo', (data) => {
        if (!socket.roomId) return;
        const room = roomStore.getRoom(socket.roomId);
        cancelPendingPlay(room);
        room.videoId = data.videoId;
        room.videoTime = 0;
        room.playbackState = 'playing';
        room.lastUpdatedAt = Date.now();
        io.to(socket.roomId).emit('roomUpdate', getRoomState(socket.roomId));
    });

    socket.on('chatMessage', async (data) => {
        if (!socket.roomId) return;
        
        io.to(socket.roomId).emit('newMessage', {
            username: socket.username,
            message: data.message,
            sender: socket.deviceId
        });

        const msg = data.message.trim();
        const room = roomStore.getRoom(socket.roomId);

        if (msg.startsWith('@play ')) {
            const query = msg.substring(6).trim();
            if (query) {
                try {
                    const r = await yts(query);
                    const videos = r.videos.slice(0, 1);
                    if (videos.length > 0) {
                        const video = videos[0];
                        cancelPendingPlay(room);
                        room.videoId = video.videoId;
                        room.videoTime = 0;
                        room.playbackState = 'playing';
                        room.lastUpdatedAt = Date.now();
                        
                        io.to(socket.roomId).emit('roomUpdate', getRoomState(socket.roomId));
                        io.to(socket.roomId).emit('newMessage', {
                            username: 'MusicBot',
                            message: `🎵 Now playing: ${video.title}`,
                            sender: 'bot'
                        });
                    } else {
                        io.to(socket.roomId).emit('newMessage', { username: 'MusicBot', message: `❌ No results found for "${query}"`, sender: 'bot' });
                    }
                } catch (e) {
                    console.error('YT Search Error:', e);
                }
            }
        }
        
        if (msg.startsWith('@queue ')) {
            const query = msg.substring(7).trim();
            if (query) {
                try {
                    const r = await yts(query);
                    const videos = r.videos.slice(0, 1);
                    if (videos.length > 0) {
                        const video = videos[0];
                        room.queue.push({ videoId: video.videoId, title: video.title });
                        
                        io.to(socket.roomId).emit('queueUpdated', room.queue);
                        io.to(socket.roomId).emit('newMessage', {
                            username: 'MusicBot',
                            message: `➕ Queued: ${video.title}`,
                            sender: 'bot'
                        });
                    } else {
                        io.to(socket.roomId).emit('newMessage', { username: 'MusicBot', message: `❌ No results found for "${query}"`, sender: 'bot' });
                    }
                } catch (e) {
                    console.error('YT Search Error:', e);
                }
            }
        }
    });

    socket.on('queueVideo', (data) => {
        if (!socket.roomId) return;
        const room = roomStore.getRoom(socket.roomId);
        room.queue.push({ videoId: data.videoId, title: data.title });
        io.to(socket.roomId).emit('queueUpdated', room.queue);
    });

    socket.on('buffering', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('memberBuffering', { username: socket.username });
    });

    socket.on('typing', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('userTyping', { username: socket.username });
    });

    socket.on('stopTyping', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('userStopTyping', { username: socket.username });
    });

    socket.on('sendReaction', (data) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('receiveReaction', { emoji: data.emoji, username: socket.username });
    });

    socket.on('digitalTouch', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('receiveTouch', { username: socket.username });
    });

    socket.on('disconnect', () => {
        if (socket.roomId) {
            const room = roomStore.getRoom(socket.roomId);
            if (room.members.has(socket.deviceId)) {
                room.members.get(socket.deviceId).online = false;
                io.to(socket.roomId).emit('roomUpdate', getRoomState(socket.roomId));
                checkPendingPlayReady(socket.roomId); // don't let a departed member block the room forever
            }
        }
    });
});

function getRoomState(roomId) {
    const room = roomStore.getRoom(roomId);
    return {
        videoId: room.videoId,
        videoTime: room.videoTime,
        playbackState: room.playbackState,
        lastUpdatedAt: room.lastUpdatedAt,
        members: Array.from(room.members.entries()).map(([id, m]) => ({ deviceId: id, ...m }))
    };
}

const SYNC_BROADCAST_INTERVAL_MS = 4000;
setInterval(() => {
    for (const [roomId, room] of roomStore.rooms.entries()) {
        if (!room.videoId) continue;
        if (room.pendingPlay) continue; // don't fight an in-progress handshake

        const hasOnlineMember = Array.from(room.members.values()).some(m => m.online);
        if (!hasOnlineMember) continue;

        let currentTime = room.videoTime;
        if (room.playbackState === 'playing') {
            currentTime += (Date.now() - room.lastUpdatedAt) / 1000;
        }

        io.to(roomId).emit('syncCorrection', {
            time: currentTime,
            state: room.playbackState
        });
    }
}, SYNC_BROADCAST_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});