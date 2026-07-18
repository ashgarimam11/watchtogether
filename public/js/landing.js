document.addEventListener('DOMContentLoaded', () => {
    const aliasInput = document.getElementById('aliasInput');
    const roomInput = document.getElementById('roomInput');
    
    const nextBtn = document.getElementById('nextBtn');
    const createBtn = document.getElementById('createBtn');
    const showJoinBtn = document.getElementById('showJoinBtn');
    const joinBtn = document.getElementById('joinBtn');
    const backToChoice = document.getElementById('backToChoice');
    
    const stepAlias = document.getElementById('stepAlias');
    const stepChoice = document.getElementById('stepChoice');
    const stepJoin = document.getElementById('stepJoin');
    
    const displayName = document.getElementById('displayName');
    const aliasError = document.getElementById('aliasError');
    const joinError = document.getElementById('joinError');

    let currentAlias = '';
    try { currentAlias = localStorage.getItem('synctube_username') || ''; } catch(e) {}
    
    // Check URL parameters for a room invite link
    const urlParams = new URLSearchParams(window.location.search);
    const inviteRoomId = urlParams.get('room');

    function showStep(stepElement) {
        document.querySelectorAll('.flow-step').forEach(el => el.classList.remove('active'));
        stepElement.classList.add('active');
    }

    function init() {
        if (currentAlias) {
            aliasInput.value = currentAlias;
            displayName.innerText = currentAlias;
            if (inviteRoomId) {
                roomInput.value = inviteRoomId;
                showStep(stepJoin);
            } else {
                showStep(stepChoice);
            }
        }
    }

    nextBtn.addEventListener('click', () => {
        const name = aliasInput.value.trim();
        if (!name) {
            aliasError.style.display = 'block';
            return;
        }
        aliasError.style.display = 'none';
        currentAlias = name;
        try { localStorage.setItem('synctube_username', currentAlias); } catch(e) {}
        displayName.innerText = currentAlias;
        
        if (inviteRoomId) {
            roomInput.value = inviteRoomId;
            showStep(stepJoin);
        } else {
            showStep(stepChoice);
        }
    });

    aliasInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') nextBtn.click();
    });

    createBtn.addEventListener('click', () => {
        createBtn.innerText = 'Starting...';
        window.location.href = 'watch.html';
    });

    showJoinBtn.addEventListener('click', () => {
        showStep(stepJoin);
        setTimeout(() => roomInput.focus(), 100);
    });

    joinBtn.addEventListener('click', () => {
        const room = roomInput.value.trim();
        if (!room) {
            joinError.style.display = 'block';
            return;
        }
        joinBtn.innerText = 'Entering...';
        window.location.href = `watch.html?room=${room}`;
    });

    roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });

    backToChoice.addEventListener('click', () => {
        showStep(stepChoice);
    });

    init();
});
