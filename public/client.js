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
        if(musicToggle && musicToggle.checked) {
            this.playMusic();
        }
    }

    playMusic() {
        if(this.bgm) {
            this.bgm.volume = 0.2; 
            this.bgm.play().catch(e => console.log("Browser blocked auto-play until click"));
        }
    }

    stopMusic() {
        if(this.bgm) this.bgm.pause();
    }

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

// --- GLOBAL UI FUNCTIONS ---
function toggleSettings(show) { document.getElementById('settings-modal').style.display = show ? 'flex' : 'none'; }
function updateSettingsUI() { sfx.enabled = document.getElementById('input-sound').checked; }
function toggleMusic(isChecked) { if(isChecked) sfx.playMusic(); else sfx.stopMusic(); }

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.style.display = (panel.style.display === 'flex') ? 'none' : 'flex';
}

function sendChat(msg) {
    socket.emit('req_chat', msg);
    toggleChat(); 
}

function sendCustomChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if(msg) {
        sendChat(msg);
        input.value = '';
    }
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
    if(!name) { alert("Enter a nickname first!"); return; }
    toggleCreateModal(true);
}

function toggleCreateModal(show) {
    document.getElementById('create-modal').style.display = show ? 'flex' : 'none';
}

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
    if(!name) { alert("Enter a nickname first!"); return; }
    if(!code) { alert("Enter a Room Code!"); return; }
    sfx.init();
    socket.emit('join_room', { roomId: code, name: name, avatar: selectedAvatar });
}

// --- CONFETTI EFFECT ---
function fireConfetti() {
    const colors = ['#f1c40f', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'];
    for(let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        const bg = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 100;
        const animDuration = Math.random() * 3 + 2; 
        const delay = Math.random() * 2; 
        confetti.style.backgroundColor = bg;
        confetti.style.left = left + '%';
        confetti.style.animationDuration = animDuration + 's';
        confetti.style.animationDelay = delay + 's';
        document.body.appendChild(confetti);
        setTimeout(() => { confetti.remove(); }, (animDuration + delay) * 1000);
    }
}

// --- CLIENT GAME CLASS ---
class Game {
    constructor() {
        this.myRole = null;
        this.isMyTurn = false;
        
        // UI References
        this.uiMsg = document.getElementById('msg-main');
        this.uiSub = document.getElementById('msg-sub');
        this.uiP1Name = document.getElementById('p1-name');
        this.uiP2Name = document.getElementById('p2-name');
        this.uiP1Bank = document.getElementById('p1-bank');
        this.uiP2Bank = document.getElementById('p2-bank');
        this.uiPot = document.getElementById('pot-val');
        this.panelDeal = document.getElementById('panel-deal');
        this.panelBet = document.getElementById('panel-bet');
        this.slider = document.getElementById('bet-slider');
        this.betDisplay = document.getElementById('bet-val');
        this.timerBar = document.getElementById('timer-bar');

        this.slider.addEventListener('input', (e) => { this.betDisplay.textContent = e.target.value; });
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        socket.on('welcome', (data) => {
            this.myRole = data.role;
            if(data.roomId) document.getElementById('disp-room-id').textContent = data.roomId;
            const landing = document.getElementById('landing-page');
            const gameWrap = document.getElementById('game-wrapper');
            landing.style.transform = 'translateY(-100%)';
            setTimeout(() => { landing.style.display = 'none'; gameWrap.style.display = 'flex'; gameWrap.offsetHeight; gameWrap.style.opacity = '1'; }, 500);
        });

        socket.on('error_msg', (msg) => { alert(msg); });

        socket.on('update_players', (playersData) => {
            if(playersData.p1) {
                this.uiP1Name.textContent = `${playersData.p1.avatar} ${playersData.p1.name}`;
                this.uiP1Bank.textContent = playersData.p1.money;
            } else { this.uiP1Name.textContent = "Waiting..."; }

            if(playersData.p2) {
                this.uiP2Name.textContent = `${playersData.p2.avatar} ${playersData.p2.name}`;
                this.uiP2Bank.textContent = playersData.p2.money;
            } else { this.uiP2Name.textContent = "Waiting..."; }
        });

        socket.on('game_ended', (data) => {
            const modal = document.getElementById('game-over-modal');
            const title = document.getElementById('go-title');
            const sub = document.getElementById('go-sub');
            this.stopTimerAnim();
            this.panelBet.style.display = 'none';
            this.panelDeal.style.display = 'none';
            modal.style.display = 'flex';
            
            if(data.winner === this.myRole) {
                title.textContent = "VICTORY!"; title.style.color = "var(--success)";
                sub.textContent = "You took all the money!";
                sfx.win();
                fireConfetti();
            } else {
                title.textContent = "BANKRUPT"; title.style.color = "var(--danger)";
                sub.textContent = "You ran out of cash.";
                sfx.lose();
            }
        });

        socket.on('game_reset', () => {
            document.getElementById('game-over-modal').style.display = 'none';
            this.uiMsg.textContent = "New Game Started!";
        });

        socket.on('game_ready', (msg) => {
            this.uiSub.textContent = msg;
            if(this.myRole === 'p1') this.panelDeal.style.display = 'block';
        });

        socket.on('timer_start', (duration) => { this.startTimerAnim(duration); });

        socket.on('new_hand_dealt', async (data) => {
            this.updateDisplay(data);
            this.panelDeal.style.display = 'none';
            document.querySelectorAll('.card-slot').forEach(el => el.innerHTML = '');

            if(data.antePaid) {
                await this.animateChip('p1-score-box', 'pot-display-area'); 
                await this.animateChip('p2-score-box', 'pot-display-area');
            }
            sfx.deal();
            await this.animateCardFly('slot-1', data.card1);
            await this.animateCardFly('slot-2', data.card2);

            if(data.activePlayer === this.myRole) {
                this.isMyTurn = true;
                this.uiMsg.textContent = "Your Turn"; this.uiMsg.style.color = "var(--gold)";
                this.panelBet.style.display = 'block';
                const myMoney = this.myRole === 'p1' ? data.p1Money : data.p2Money;
                const maxBet = Math.min(myMoney, data.pot);
                this.slider.max = maxBet; this.slider.value = 5; this.betDisplay.textContent = 5;
            } else {
                this.isMyTurn = false;
                this.uiMsg.textContent = `${data.activePlayer.toUpperCase()}'s Turn`; this.uiMsg.style.color = "white";
                this.panelBet.style.display = 'none';
            }
        });

        socket.on('turn_resolved', async (data) => {
            this.stopTimerAnim();
            this.panelBet.style.display = 'none';
            let name = data.who === this.myRole ? "You" : data.who.toUpperCase();
            
            if(data.result === 'pass') {
                this.uiMsg.textContent = `${name} Passed`;
                await this.animateChip(data.who === 'p1' ? 'p1-score-box' : 'p2-score-box', 'pot-display-area');
            } else {
                this.uiMsg.textContent = `${name} Bets ${data.amount}`;
                if(data.cardResult) await this.animateCardFly('slot-result', data.cardResult);
                if(data.result === 'win') {
                    this.uiMsg.textContent = `${name} WON!`; this.uiMsg.style.color = "var(--success)";
                    sfx.win();
                    await this.animateChip('pot-display-area', data.who === 'p1' ? 'p1-score-box' : 'p2-score-box');
                } else {
                    this.uiMsg.textContent = `${name} LOST!`; this.uiMsg.style.color = "var(--danger)";
                    sfx.lose();
                }
            }
            this.updateDisplay(data);
        });

        socket.on('round_over', (data) => {
            this.stopTimerAnim();
            this.uiMsg.textContent = "Round Over"; this.uiMsg.style.color = "white";
            if(data.nextStart === this.myRole) {
                this.uiSub.textContent = "You start next round";
                this.panelDeal.style.display = 'block';
            } else {
                this.uiSub.textContent = `Waiting for ${data.nextStart.toUpperCase()} to start...`;
            }
        });
        
        socket.on('reset_game', () => { location.reload(); });

        socket.on('chat_received', (data) => {
            let bubbleId = (data.role === 'p1') ? 'p1-bubble' : 'p2-bubble';
            const bubble = document.getElementById(bubbleId);
            bubble.textContent = data.msg;
            bubble.classList.add('show');
            sfx.chip();
            setTimeout(() => { bubble.classList.remove('show'); }, 3000);
        });
    }

    startTimerAnim(duration) {
        this.timerBar.style.transition = 'none';
        this.timerBar.style.width = '100%';
        this.timerBar.style.background = '#f1c40f'; 
        void this.timerBar.offsetHeight; 
        this.timerBar.style.transition = `width ${duration}s linear`;
        this.timerBar.style.width = '0%';
    }

    stopTimerAnim() {
        const currentWidth = getComputedStyle(this.timerBar).width;
        this.timerBar.style.transition = 'none';
        this.timerBar.style.width = currentWidth;
    }

    startRound() { socket.emit('req_start_round'); }

    playerAction(isBetting) {
        if(!this.isMyTurn) return;
        if(!isBetting) socket.emit('req_action', { action: 'pass' });
        else socket.emit('req_action', { action: 'bet', amount: this.slider.value });
    }

    setAllIn() {
        this.slider.value = this.slider.max;
        this.betDisplay.textContent = this.slider.value;
        sfx.chip(); 
    }

    requestRematch() { socket.emit('req_rematch'); }

    updateDisplay(data) {
        this.uiP1Bank.innerText = data.p1Money;
        this.uiP2Bank.innerText = data.p2Money;
        this.uiPot.innerText = data.pot;
    }

    animateCardFly(targetId, cardData) {
        return new Promise(resolve => {
            const deckRect = document.getElementById('deck-anchor').getBoundingClientRect();
            const targetEl = document.getElementById(targetId);
            const targetRect = targetEl.getBoundingClientRect();
            const flyer = document.createElement('div');
            flyer.className = 'flying-card';
            flyer.style.left = deckRect.left + 'px'; flyer.style.top = deckRect.top + 'px';
            document.body.appendChild(flyer);
            flyer.getBoundingClientRect();
            flyer.style.left = targetRect.left + 'px'; flyer.style.top = targetRect.top + 'px';
            flyer.style.width = targetRect.width + 'px'; flyer.style.height = targetRect.height + 'px';
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
            const fromEl = document.getElementById(fromId);
            const toEl = document.getElementById(toId);
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