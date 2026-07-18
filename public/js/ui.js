export const elements = {
    modal: document.getElementById('welcomeModal'),
    modalDesc: document.getElementById('modalDesc'),
    modalUser: document.getElementById('modalUsername'),
    modalRoom: document.getElementById('modalRoom'),
    modalBtn: document.getElementById('modalActionBtn'),
    modalStatus: document.getElementById('modalStatus'),
    knockContainer: document.getElementById('knockContainer'),
    navRoom: document.getElementById('navRoomDisplay'),
    memberList: document.getElementById('memberList'),
    memberCountBadge: document.getElementById('memberCountBadge'),
    roomStatus: document.getElementById('roomStatusDisplay'),
    inviteBtn: document.getElementById('inviteBtn'),
    inviteText: document.getElementById('inviteText'),
    videoInput: document.getElementById('videoInput'),
    loadBtn: document.getElementById('loadBtn'),
    queueBtn: document.getElementById('queueBtn'),
    queueList: document.getElementById('queueList'),
    queueEmptyState: document.getElementById('queueEmptyState'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    chatMessages: document.getElementById('chatMessages'),
    chatColumn: document.getElementById('chatColumn'),
    emojiBtn: document.getElementById('emojiBtn'),
    emojiPicker: document.getElementById('emojiPicker'),
    htmlPlayer: document.getElementById('htmlPlayer'),
    ytPlayerContainer: document.getElementById('ytPlayerWrapper'),
    qualitySelector: document.getElementById('qualitySelector'),
    customFsBtn: document.getElementById('customFsBtn'),
    mainLayout: document.getElementById('mainLayout'),
    userCountDisplay: document.getElementById('userCountDisplay'),
    fsUserCountDisplay: document.getElementById('fsUserCountDisplay'),
    fsRoomDisplay: document.getElementById('fsRoomDisplay'), 
    touchBtn: document.getElementById('touchBtn'),
    videoWrapper: document.getElementById('videoWrapper'),
    exitFsBtn: document.getElementById('exitFsBtn'),
    reactionContainer: document.getElementById('reactionContainer'),
    reactionBtns: document.querySelectorAll('.reaction-btn'),
    autoplayOverlay: document.getElementById('autoplayOverlay'),
    ghostIframe: document.getElementById('ghostIframe'),
    // Mobile-only elements
    mediaMenuBtn: document.getElementById('mediaMenuBtn'),
    mediaMenuPanel: document.getElementById('mediaMenuPanel'),
    panelRoomDisplay: document.getElementById('panelRoomDisplay'),
    panelInviteBtn: document.getElementById('panelInviteBtn'),
    panelInviteText: document.getElementById('panelInviteText'),
    customFsBtnMobile: document.getElementById('customFsBtnMobile'),
    mobileUserCountDisplay: document.getElementById('mobileUserCountDisplay')
};

export function spawnFloatingReaction(emoji) {
    if (!elements.reactionContainer) return;
    const el = document.createElement('div');
    el.classList.add('floating-emoji');
    el.innerText = emoji;
    const startX = Math.random() * 80; 
    el.style.left = `${startX}%`;
    elements.reactionContainer.appendChild(el);
    
    const duration = 2000 + Math.random() * 1500; 
    const horizontalDrift = (Math.random() - 0.5) * 80; 
    const floatHeight = 150 + Math.random() * 200; 
    
    const animation = el.animate([
        { transform: `translate(0, 0) scale(0.5)`, opacity: 0 },
        { transform: `translate(${horizontalDrift / 2}px, -${floatHeight / 2}px) scale(1.5)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${horizontalDrift}px, -${floatHeight}px) scale(1)`, opacity: 0 }
    ], { duration: duration, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
    animation.onfinish = () => el.remove();
}

const typingIndicator = document.createElement('div');
typingIndicator.style.fontSize = '12px';
typingIndicator.style.fontStyle = 'italic';
typingIndicator.style.color = '#888';
typingIndicator.style.padding = '0 10px 5px';
typingIndicator.style.display = 'none';

if (elements.chatColumn) {
    const wrapper = elements.chatColumn.querySelector('.chat-input-wrapper');
    if (wrapper) {
        wrapper.insertBefore(typingIndicator, wrapper.querySelector('.chat-input-area'));
    }
}

let typingUsers = new Set();
export function updateTypingIndicator(username, isTyping) {
    if (isTyping) {
        typingUsers.add(username);
    } else {
        typingUsers.delete(username);
    }
    
    if (typingUsers.size > 0) {
        const users = Array.from(typingUsers);
        let text = '';
        if (users.length === 1) text = `${users[0]} is typing...`;
        else if (users.length === 2) text = `${users[0]} and ${users[1]} are typing...`;
        else text = 'Multiple people are typing...';
        
        typingIndicator.textContent = text;
        typingIndicator.style.display = 'block';
    } else {
        typingIndicator.style.display = 'none';
    }
}

export function showToast(message, type = 'info') {
    let toast = document.getElementById('sys-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sys-toast';
        toast.style.position = 'fixed';
        toast.style.top = '10px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '5px';
        toast.style.color = 'white';
        toast.style.zIndex = '9999';
        toast.style.transition = 'opacity 0.5s';
        toast.style.fontWeight = 'bold';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.style.opacity = '1';
    
    if (type === 'error') {
        toast.style.backgroundColor = '#ef4444'; // Red
    } else if (type === 'success') {
        toast.style.backgroundColor = '#10b981'; // Green
    } else {
        toast.style.backgroundColor = '#3b82f6'; // Blue
    }
    
    if (type !== 'error') {
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    }
}

// Generate consistent avatar color from username
function usernameColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 65%, 50%)`;
}

export function renderMemberList(members, localUsername) {
    if (!elements.memberList) return;
    elements.memberList.innerHTML = '';

    if (elements.memberCountBadge) {
        elements.memberCountBadge.textContent = `${members.length} online`;
    }

    members.forEach(memberData => {
        const username = typeof memberData === 'string' ? memberData : memberData.username;
        const isHost = memberData.isHost;
        const isBot = memberData.isBot;

        const isYou = username === localUsername;
        const item = document.createElement('div');
        item.className = 'user-list-item';
        if (isYou) item.classList.add('is-you');

        const color = usernameColor(username);

        let roleHtml = '<span class="user-role partner">Partner</span>';
        if (isBot) {
            roleHtml = '<span class="user-role bot">Bot</span>';
        } else if (isHost) {
            roleHtml = '<span class="user-role host">Host</span>';
        }

        if (isYou) {
            roleHtml += '<span class="user-role you" style="margin-left: 4px;">(You)</span>';
        }

        const sanitizedUsername = window.DOMPurify ? window.DOMPurify.sanitize(username) : username;
        const displayName = isHost ? `${sanitizedUsername} (Host)` : sanitizedUsername;

        item.innerHTML = `
            <div class="user-avatar" style="background: ${color}">
                <span style="color:#fff;font-weight:700;font-size:14px">${username.charAt(0).toUpperCase()}</span>
            </div>
            <div class="user-details">
                <span class="user-name">${displayName}</span>
                ${roleHtml}
            </div>
        `;
        elements.memberList.appendChild(item);
    });
}
