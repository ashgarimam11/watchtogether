import { state, getToken } from './state.js';
import { elements, spawnFloatingReaction } from './ui.js';
import { getSocket } from './api.js';

export let typingTimeout = null;
export let isTyping = false;

if (elements.chatInput) {
    elements.chatInput.addEventListener('input', () => {
        const socket = getSocket();
        if (!socket || !state.currentRoom) return;

        if (elements.chatInput.value.trim() === '') {
            if (isTyping) {
                socket.emit('stopTyping', { roomId: state.currentRoom, token: getToken() });
                isTyping = false;
            }
            if (typingTimeout) clearTimeout(typingTimeout);
            return;
        }

        if (!isTyping) {
            isTyping = true;
            socket.emit('typing', { roomId: state.currentRoom, token: getToken() });
        }

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (isTyping) {
                socket.emit('stopTyping', { roomId: state.currentRoom, token: getToken() });
                isTyping = false;
            }
        }, 3000);
    });
}

export function sendMessage() {
    const msg = elements.chatInput.value.trim();
    if (msg && state.currentRoom) {
        const socket = getSocket();
        if (socket) {
            socket.emit('chatMessage', { 
                roomId: state.currentRoom, 
                message: msg, 
                token: getToken() 
            });
            if (isTyping) {
                socket.emit('stopTyping', { roomId: state.currentRoom, token: getToken() });
                isTyping = false;
                if (typingTimeout) clearTimeout(typingTimeout);
            }
        }
        elements.chatInput.value = '';
    }
}

export function sendDigitalTouch() {
    spawnFloatingReaction('💖');
    const socket = getSocket();
    if (socket && state.currentRoom) {
        socket.emit('sendReaction', { roomId: state.currentRoom, emoji: '💖', token: getToken() });
        socket.emit('digitalTouch', { roomId: state.currentRoom, token: getToken() });
    }
}
