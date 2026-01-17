// --- SOUND MANAGER ---
class SoundManager {
    constructor() { 
        this.enabled = true; 
        this.ctx = null;
        this.bgm = document.getElementById('bgm'); 
    }
    init() {
        if (!this.ctx) { 
            const AudioContext = window.AudioContext || window.webkitAudioContext; 
            this.ctx = new AudioContext(); 
        }
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const musicToggle = document.getElementById('input-music');
        if(musicToggle && musicToggle.checked) this.playMusic();
    }
    playMusic() {
        if(this.bgm) { this.bgm.volume = 0.2; this.bgm.play().catch(e => console.log("Auto-play blocked")); }
    }
    stopMusic() { if(this.bgm) this.bgm.pause(); }
    
    // SFX
    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playNoise(duration) {
        if (!this.enabled || !this.ctx) return;
        const bufferSize = this.ctx.sampleRate * duration; const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource(); noise.buffer = buffer; const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        noise.connect(gain); gain.connect(this.ctx.destination); noise.start();
    }
    shuffle() { if(this.enabled) for(let i=0; i<5; i++) setTimeout(() => this.playNoise(0.1), i*60); }
    deal() { this.playNoise(0.15); }
    chip() { this.playTone(1200, 'sine', 0.05, 0.05); } 
    pass() { this.playTone(600, 'sawtooth', 0.1, 0.05); }
    win() { this.playTone(523.25, 'triangle', 0.1, 0.1); setTimeout(() => this.playTone(659.25, 'triangle', 0.1, 0.1), 100); setTimeout(() => this.playTone(783.99, 'triangle', 0.4, 0.1), 200); }
    lose() { this.playTone(150, 'sawtooth', 0.3, 0.1); setTimeout(() => this.playTone(100, 'sawtooth', 0.5, 0.1), 200); }
}
const sfx = new SoundManager();

// --- SOCKET CONNECTION ---
const socket = io();

// --- GLOBAL LOBBY CHAT LOGIC ---
let isLobbyOpen = false;
let unreadLobbyMsg = 0;

function toggleLobbyChat() {
    const win = document.getElementById('lobby-chat-window');
    const badge = document.getElementById('lobby-badge');
    
    isLobbyOpen = !isLobbyOpen;
    
    if(isLobbyOpen) {
        win.classList.add('open');
        unreadLobbyMsg = 0; // Reset Badge
        badge.textContent = 0;
        badge.classList.remove('show');
        setTimeout(() => {
            const input = document.getElementById('lobby-input');
            if(input) input.focus();
        }, 300);
    } else {
        win.classList.remove('open');
    }
}

function handleLobbyEnter(e) {
    if(e.key === 'Enter') sendLobbyMessage();
}

function sendLobbyMessage() {
    const input = document.getElementById('lobby-input');
    const msg = input.value.trim();
    if(!msg) return;

    // Get Name: If nickname input is empty, make up a Guest Name
    let name = document.getElementById('input-nickname').value.trim();
    if(!name) {
        if(!sessionStorage.getItem('guestName')) {
            sessionStorage.setItem('guestName', 'Guest ' + Math.floor(Math.random()*1000));
        }
        name = sessionStorage.getItem('guestName');
    }

    socket.emit('req_lobby_chat', { name: name, msg: msg });
    input.value = '';
}

// --- UI HELPERS ---
function toggleSettings(show) { document.getElementById('settings-modal').style.display = show ? 'flex' : 'none'; }
function updateSettingsUI() { sfx.enabled = document.getElementById('input-sound').checked; }
function toggleMusic(isChecked) { if(isChecked) sfx.playMusic(); else sfx.stopMusic(); }

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.style.display = (panel.style.display === 'flex') ? 'none' : 'flex';
}
function sendChat(msg) { socket.emit('req_chat', msg); toggleChat(); }
function sendCustomChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if(msg) { sendChat(msg); input.value = ''; }
}

let selectedAvatar = '😎';
function selectAvatar(el) {
    document.querySelectorAll('.avatar-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    selectedAvatar = el.textContent;
}

// --- LOBBY FUNCTIONS ---
function createRoom() {
    const name = document.getElementById('input-nickname').value.trim();
    if(!name) { alert("Enter nickname!"); return; }
    toggleCreateModal(true);
}
function toggleCreateModal(show) { document.getElementById('create-modal').style.display = show ? 'flex' : 'none'; }
function confirmCreateRoom() {
    const name = document.getElementById('input-nickname').value.trim();
    const ante = parseInt(document.getElementById('input-ante').value);
    const penalty = parseInt(document.getElementById('input-penalty').value);
    sfx.init();
    socket.emit('create_room', { name: name, avatar: selectedAvatar, config: { ante: ante, penalty: penalty } });
    toggleCreateModal(false);
}
function joinRoom() {
    const name = document.getElementById('input-nickname').value.trim();
    const code = document.getElementById('input-room-code').value.trim().toUpperCase();
    if(!name || !code) { alert("Enter nickname and code!"); return; }
    sfx.init();
    socket.emit('join_room', { roomId: code, name: name, avatar: selectedAvatar });
}
function fireConfetti() {
    const colors = ['#f1c40f', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'];
    for(let i=0; i<100; i++) {
        const c = document.createElement('div'); c.classList.add('confetti');
        c.style.backgroundColor = colors[Math.floor(Math.random()*colors.length)];
        c.style.left = Math.random()*100 + '%';
        c.style.animationDuration = (Math.random()*1 + 1.5)+'s'; 
        c.style.animationDelay = Math.random()*0.5+'s';
        document.body.appendChild(c);
        setTimeout(()=>c.remove(), 3000);
    }
}
function spectateGame() {
    document.getElementById('bankrupt-modal').style.display = 'none';
    document.getElementById('panel-deal').style.display = 'none';
    document.getElementById('panel-bet').style.display = 'none';
    const msg = document.getElementById('msg-main');
    msg.textContent = "SPECTATING MODE";
    msg.style.color = "#3498db";
}
function confirmLeave() {
    if(confirm("Are you sure you want to leave the table?")) {
        location.reload();
    }
}
function showNotification(msg, type = 'info') {
    const container = document.getElementById('notification-area');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; 
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}


// --- MAIN GAME CLASS (6-PLAYER) ---
class Game {
    constructor() {
        this.mySeatIndex = 0; 
        this.isMyTurn = false;
        
        // UI Refs
        this.uiMsg = document.getElementById('msg-main');
        this.uiPot = document.getElementById('pot-val');
        this.panelDeal = document.getElementById('panel-deal');
        this.panelBet = document.getElementById('panel-bet');
        this.slider = document.getElementById('bet-slider');
        this.betDisplay = document.getElementById('bet-val');
        
        this.slider.addEventListener('input', (e) => { this.betDisplay.textContent = e.target.value; });
        this.setupSocketListeners();
    }

    stopTimer() {
        const bar = document.getElementById('timer-bar');
        if(bar) {
            bar.classList.remove('timer-active', 'urgent');
            bar.style.width = '0%';
            bar.style.animationDuration = '0s'; 
        }
    }

    getVisualSeat(serverIndex) {
        if(serverIndex === null || serverIndex === undefined) return -1;
        return (serverIndex - this.mySeatIndex + 6) % 6;
    }

    updateActiveSeat(activeSeatIndex) {
        document.querySelectorAll('.seat').forEach(el => el.classList.remove('active'));
        if(activeSeatIndex >= 0) {
            const visualPos = this.getVisualSeat(activeSeatIndex);
            const seatEl = document.getElementById(`seat-${visualPos}`);
            if(seatEl) seatEl.classList.add('active');
        }
    }

    showFloatingText(serverSeatIndex, amount) {
        const visualPos = this.getVisualSeat(serverSeatIndex);
        const seatEl = document.getElementById(`seat-${visualPos}`);
        if(!seatEl) return;
        const floatEl = document.createElement('div');
        floatEl.className = amount >= 0 ? 'floating-text gain' : 'floating-text loss';
        floatEl.textContent = amount >= 0 ? `+${amount}` : `${amount}`;
        const rect = seatEl.getBoundingClientRect();
        floatEl.style.left = (rect.left + 20) + 'px';
        floatEl.style.top = (rect.top) + 'px';
        document.body.appendChild(floatEl);
        setTimeout(() => floatEl.remove(), 1500); 
    }

    setupSocketListeners() {
        // --- LOBBY CHAT LISTENER ---
        socket.on('lobby_chat_received', (data) => {
            const chatBox = document.getElementById('lobby-messages');
            if(!chatBox) return;
            const div = document.createElement('div');
            div.className = 'lobby-msg';
            div.innerHTML = `<strong>${data.name}:</strong> ${data.msg}`;
            chatBox.appendChild(div);
            chatBox.scrollTop = chatBox.scrollHeight;

            // Badge Logic
            if(!isLobbyOpen) {
                unreadLobbyMsg++;
                const badge = document.getElementById('lobby-badge');
                if(badge) {
                    badge.textContent = unreadLobbyMsg;
                    badge.classList.add('show');
                    sfx.chip(); // Play sound notification
                }
            }
        });

        socket.on('welcome', (data) => {
            this.mySeatIndex = data.seatIndex; 
            if(data.roomId) document.getElementById('disp-room-id').textContent = data.roomId;
            const landing = document.getElementById('landing-page');
            const gameWrap = document.getElementById('game-wrapper');
            landing.style.transform = 'translateY(-100%)';
            // Hide Lobby Chat UI when game starts
            document.getElementById('lobby-chat-fab').style.display = 'none';
            document.getElementById('lobby-chat-window').style.display = 'none';
            
            setTimeout(() => { landing.style.display = 'none'; gameWrap.style.display = 'block'; gameWrap.style.opacity = '1'; }, 500);
        });

        socket.on('update_user_count', (count) => {
            const el = document.getElementById('online-count');
            if(el) {
                el.style.transform = "scale(1.5)";
                el.style.color = "#fff";
                setTimeout(() => {
                    el.style.transform = "scale(1)";
                    el.style.color = "rgba(255, 255, 255, 0.8)";
                }, 200);
                el.textContent = count;
            }
        });

        socket.on('notification', (data) => {
            showNotification(data.msg, data.type);
        });

        socket.on('you_are_bankrupt', () => {
            const modal = document.getElementById('bankrupt-modal');
            document.getElementById('game-over-modal').style.display = 'none';
            modal.style.display = 'flex';
            this.mySeatIndex = -1; 
        });

        socket.on('error_msg', (msg) => { alert(msg); });

        socket.on('timer_start', (data) => {
            const bar = document.getElementById('timer-bar');
            bar.classList.remove('timer-active', 'urgent');
            void bar.offsetWidth; 
            bar.style.animationDuration = `${data.duration}s`;
            if (data.seat === this.mySeatIndex) {
                bar.classList.add('urgent');
            }
            bar.classList.add('timer-active');
        });

        socket.on('update_table', (data) => {
            this.uiPot.innerText = data.pot;
            if (socket.id && data.hostId && socket.id === data.hostId && !data.isRoundActive) {
                this.panelDeal.style.display = 'block'; // Shows button for NEW host
            } else {
                this.panelDeal.style.display = 'none';
            }
            for(let i=0; i<6; i++) {
                const seatData = data.seats[i];
                const visualPos = this.getVisualSeat(i); 
                const seatEl = document.getElementById(`seat-${visualPos}`);
                seatEl.className = `seat seat-${visualPos}`;
                if(seatData) {
                    seatEl.querySelector('.seat-avatar').textContent = seatData.avatar;
                    seatEl.querySelector('.seat-name').textContent = seatData.name;
                    if (seatData.money <= 0) {
                        seatEl.classList.add('bankrupt');
                        seatEl.querySelector('.seat-money').textContent = "BROKE"; 
                    } else {
                        seatEl.querySelector('.seat-money').textContent = seatData.money;
                    }
                } else {
                    seatEl.classList.add('empty');
                    seatEl.querySelector('.seat-avatar').textContent = '?';
                    seatEl.querySelector('.seat-name').textContent = 'Empty';
                    seatEl.querySelector('.seat-money').textContent = '---';
                }
            }

            // --- NEW: UPDATE DEALER MARKER ---
                // 1. Hide all "D" buttons first
                document.querySelectorAll('.dealer-marker').forEach(el => el.style.display = 'none');

                // 2. Show "D" for the current dealer
                if (data.dealer !== undefined && data.dealer !== -1) {
                    const dealerVisualPos = this.getVisualSeat(data.dealer);
                    const dealerBtn = document.querySelector(`#seat-${dealerVisualPos} .dealer-marker`);
                    
                    // Only show if the seat is not empty
                    if(dealerBtn && data.seats[data.dealer]) {
                        dealerBtn.style.display = 'flex';
                    }
                }

                this.updateActiveSeat(data.activeSeat);
        });

        socket.on('new_hand_dealt', async (data) => {
            for(let i=0; i<6; i++) {
                const s = data.seats[i];
                if(s) {
                    const vPos = this.getVisualSeat(i);
                    const moneyEl = document.querySelector(`#seat-${vPos} .seat-money`);
                    if(moneyEl) moneyEl.textContent = s.money;
                }
            }
            if (data.isNewRound) { 
                data.seats.forEach((s, i) => {
                    if(s && s.money > 0) {
                        this.animateChip(`seat-${this.getVisualSeat(i)}`, 'pot-val');
                        this.showFloatingText(i, -50); 
                    }
                });
            }
            this.uiPot.innerText = data.pot;
            this.panelDeal.style.display = 'none';
            document.querySelectorAll('.table-card-slot').forEach(el => el.innerHTML = '');
            sfx.deal();
            await this.animateCardFly('slot-1', data.card1);
            await this.animateCardFly('slot-2', data.card2);
            this.updateActiveSeat(data.activeSeat);
            if (data.seats[this.mySeatIndex]) {
                 this.checkTurn(data.activeSeat, data.seats[this.mySeatIndex].money, data.pot);
            }
        });

        socket.on('turn_resolved', async (data) => {
            this.stopTimer(); 
            this.uiPot.innerText = data.pot;
            this.panelBet.style.display = 'none';
            const visualPos = this.getVisualSeat(data.seatIndex);
            const playerData = data.seats[data.seatIndex] || { name: "Player", money: 0 };
            const name = (data.seatIndex === this.mySeatIndex) ? "You" : playerData.name;

            if(data.result === 'pass') {
                this.uiMsg.textContent = `${name} Passed`;
                await this.animateChip(`seat-${visualPos}`, 'pot-val');
                this.showFloatingText(data.seatIndex, -data.amount); 
            } else {
                this.uiMsg.textContent = `${name} Bets ${data.amount}`;
                await this.animateChip(`seat-${visualPos}`, 'pot-val');
                this.showFloatingText(data.seatIndex, -data.amount);
                if(data.cardResult) await this.animateCardFly('slot-result', data.cardResult);
                if(data.result === 'win') {
                    this.uiMsg.textContent = `${name} WON!`; this.uiMsg.style.color = "var(--success)";
                    sfx.win();
                    await this.animateChip('pot-val', `seat-${visualPos}`);
                    this.showFloatingText(data.seatIndex, +(data.amount * 2)); 
                } else {
                    this.uiMsg.textContent = `${name} LOST!`; this.uiMsg.style.color = "var(--danger)";
                    sfx.lose();
                }
            }
            const moneyEl = document.querySelector(`#seat-${visualPos} .seat-money`);
            if(moneyEl) moneyEl.textContent = playerData.money;
        });

        socket.on('game_ended', (data) => {
            this.stopTimer(); 
            this.panelBet.style.display = 'none';
            this.updateActiveSeat(-1); 
            if(data.winnerSeat === this.mySeatIndex) {
                this.uiMsg.textContent = "VICTORY! +POT"; 
                this.uiMsg.style.color = "var(--success)";
                sfx.win();
                fireConfetti(); 
            } else {
                this.uiMsg.textContent = "ROUND OVER"; 
                this.uiMsg.style.color = "white";
            }
            setTimeout(() => {
                this.uiMsg.textContent = "Waiting for players...";
                this.uiMsg.style.color = "white";
                this.uiMsg.style.opacity = "0.7"; 
            }, 3000);
        });

        socket.on('game_reset', () => { location.reload(); });

        socket.on('chat_received', (data) => {
            const vPos = this.getVisualSeat(data.seatIndex);
            const bubble = document.getElementById(`bubble-${vPos}`);
            if(bubble) {
                bubble.textContent = data.msg;
                bubble.classList.add('show');
                sfx.chip();
                setTimeout(() => { bubble.classList.remove('show'); }, 3000);
            }
        });
    }

    checkTurn(activeSeatIndex, myMoney, pot) {
        if(activeSeatIndex === this.mySeatIndex) {
            this.isMyTurn = true;
            this.uiMsg.textContent = "Your Turn"; 
            this.uiMsg.style.color = "var(--gold)";
            
            // 1. RESET BUTTON STATE (Re-enable)
            const btnPass = document.getElementById('btn-pass-action');
            const btnBet = document.querySelector('.btn-bet');
            
            if(btnPass) {
                btnPass.disabled = false;
                btnPass.style.opacity = "1";
                btnPass.style.cursor = "pointer";
            }
            if(btnBet) {
                btnBet.disabled = false;
                btnBet.style.opacity = "1";
                btnBet.style.cursor = "pointer";
                btnBet.textContent = "PLACE BET"; // Reset text
            }

            this.panelBet.style.display = 'block';
            
            const maxBet = Math.min(myMoney, pot);
            this.slider.max = maxBet; 
            this.slider.value = 5; 
            this.betDisplay.textContent = 5;
        } else {
            // ... (rest of your existing else block) ...
            this.isMyTurn = false;
            const activeVPos = this.getVisualSeat(activeSeatIndex);
            const nameEl = document.querySelector(`#seat-${activeVPos} .seat-name`);
            const name = nameEl ? nameEl.textContent : "Opponent";
            this.uiMsg.textContent = `${name}'s Turn`; 
            this.uiMsg.style.color = "white";
            this.panelBet.style.display = 'none';
        }
    }

    startRound() { socket.emit('req_start_round'); }

    playerAction(isBetting) {
        if(!this.isMyTurn) return;

        // 1. SELECT BUTTONS
        const btnPass = document.getElementById('btn-pass-action');
        const btnBet = document.querySelector('.btn-bet'); // Needs querySelector as it has no ID

        // 2. DISABLE THEM IMMEDIATELY (Visual Feedback & Protection)
        if(btnPass) {
            btnPass.disabled = true;
            btnPass.style.opacity = "0.5";
            btnPass.style.cursor = "not-allowed";
        }
        if(btnBet) {
            btnBet.disabled = true;
            btnBet.style.opacity = "0.5";
            btnBet.style.cursor = "not-allowed";
            btnBet.textContent = "Processing..."; // UX: Let them know it worked
        }

        // 3. SEND TO SERVER
        if(!isBetting) {
            socket.emit('req_action', { action: 'pass' });
        } else {
            socket.emit('req_action', { action: 'bet', amount: this.slider.value });
        }
        
        // Note: We don't need to re-enable them here. 
        // The server will send 'turn_resolved', which hides the entire panel anyway.
    }

    setAllIn() {
        this.slider.value = this.slider.max;
        this.betDisplay.textContent = this.slider.value;
        sfx.chip(); 
    }

    requestRematch() { socket.emit('req_rematch'); }

    animateCardFly(targetId, cardData) {
        return new Promise(resolve => {
            const deckEl = document.querySelector('.deck-stack'); 
            const deckRect = deckEl ? deckEl.getBoundingClientRect() : { top: 0, left: 0 };
            const targetEl = document.getElementById(targetId);
            const targetRect = targetEl.getBoundingClientRect();
            const flyer = document.createElement('div');
            flyer.className = 'flying-card';
            flyer.style.left = deckRect.left + 'px'; flyer.style.top = deckRect.top + 'px';
            document.body.appendChild(flyer);
            flyer.getBoundingClientRect(); 
            flyer.style.left = targetRect.left + 'px'; flyer.style.top = targetRect.top + 'px';
            flyer.style.transform = 'rotate(360deg)';
            setTimeout(() => {
                flyer.remove();
                targetEl.innerHTML = `<div class="card ${cardData.color}"><div class="card-corner top">${cardData.rank}<span>${cardData.suit}</span></div><div class="card-center">${cardData.suit}</div><div class="card-corner bottom">${cardData.rank}<span>${cardData.suit}</span></div></div>`;
                resolve();
            }, 500);
        });
    }

    animateChip(fromId, toId) { 
        return new Promise(resolve => {
            let fromEl = document.getElementById(fromId);
            let toEl = document.getElementById(toId);
            if(toId === 'pot-val' || toId === 'pot-display-area') {
                 const potText = document.getElementById('pot-val');
                 if(potText) toEl = potText.parentElement; 
            }
            if(!fromEl) fromEl = document.querySelector(`.${fromId}`);
            if(!toEl) toEl = document.querySelector(`.${toId}`);
            if(!fromEl || !toEl) { resolve(); return; }
            sfx.chip(); 
            const fromRect = fromEl.getBoundingClientRect();
            const toRect = toEl.getBoundingClientRect();
            const chip = document.createElement('div');
            chip.className = 'flying-chip';
            chip.style.left = (fromRect.left + fromRect.width/2 - 15) + 'px';
            chip.style.top = (fromRect.top + fromRect.height/2 - 15) + 'px';
            document.body.appendChild(chip);
            chip.getBoundingClientRect(); 
            chip.style.left = (toRect.left + toRect.width/2 - 15) + 'px';
            chip.style.top = (toRect.top + toRect.height/2 - 15) + 'px';
            setTimeout(() => { chip.remove(); resolve(); }, 600);
        });
    }
}
const game = new Game();