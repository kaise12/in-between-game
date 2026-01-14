const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// --- CONSTANTS ---
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

// --- GAME LOGIC CLASSES ---
class Card {
    constructor(val, suit, rank) {
        this.value = val; this.suit = suit; this.rank = rank;
        this.color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
    }
}

class Deck {
    constructor() { this.cards = []; this.reset(); }
    reset() {
        this.cards = [];
        for(let s of SUITS) for(let i=0; i<RANKS.length; i++) this.cards.push(new Card(i+1, s, RANKS[i]));
        this.shuffle();
    }
    shuffle() {
        for(let i=this.cards.length-1; i>0; i--) {
            const j = Math.floor(Math.random()*(i+1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
    draw() { if(this.cards.length === 0) this.reset(); return this.cards.pop(); }
}

// --- ROOM CLASS (The Game Instance) ---
class GameRoom {
    constructor(roomId, io, config = {}) { // Accept config
        this.roomId = roomId;
        this.io = io;
        this.players = {};
        this.turnTimer = null;
        
        // USE CUSTOM CONFIG OR DEFAULTS
        this.gameState = {
            deck: new Deck(),
            pot: 0,
            ante: config.ante || 50,       // Custom Ante
            penalty: config.penalty || 10, // Custom Penalty
            card1: null,
            card2: null,
            activePlayer: 'p1', 
            firstPlayer: 'p1',
            turnDuration: 15,
        };
    }

    addPlayer(socket, userData) {
        if (Object.keys(this.players).length >= 2) return false;

        const role = Object.values(this.players).find(p => p.role === 'p1') ? 'p2' : 'p1';
        this.players[socket.id] = {
            id: socket.id,
            role: role,
            name: userData.name.substring(0, 10),
            avatar: userData.avatar,
            money: 1000
        };

        socket.join(this.roomId); // Socket.io Room Logic
        socket.data.roomId = this.roomId; // Tag the socket
        
        socket.emit('welcome', { role: role, roomId: this.roomId });
        this.broadcastPlayerUpdate();

        if (Object.keys(this.players).length === 2) {
            let p1 = Object.values(this.players).find(p => p.role === 'p1');
            let p2 = Object.values(this.players).find(p => p.role === 'p2');
            this.io.to(this.roomId).emit('game_ready', `${p1.name} vs ${p2.name}! Ready.`);
        }
        return true;
    }

    removePlayer(socketId) {
        delete this.players[socketId];
        this.gameState.pot = 0;
        clearTimeout(this.turnTimer);
        this.io.to(this.roomId).emit('reset_game'); // Kick other player to lobby or reset
        this.broadcastPlayerUpdate();
    }

    broadcastPlayerUpdate() {
        let p1 = Object.values(this.players).find(p => p.role === 'p1');
        let p2 = Object.values(this.players).find(p => p.role === 'p2');
        
        this.io.to(this.roomId).emit('update_players', {
            p1: p1 ? { name: p1.name, avatar: p1.avatar, money: p1.money } : null,
            p2: p2 ? { name: p2.name, avatar: p2.avatar, money: p2.money } : null
        });
    }

    startRound() {
        if(Object.keys(this.players).length < 2) return;
        
        let p1 = Object.values(this.players).find(p => p.role === 'p1');
        let p2 = Object.values(this.players).find(p => p.role === 'p2');
        let antePaid = false;

        if(this.gameState.pot === 0) {
            p1.money -= this.gameState.ante;
            p2.money -= this.gameState.ante;
            this.gameState.pot += (this.gameState.ante * 2);
            antePaid = true;
        }

        this.gameState.activePlayer = this.gameState.firstPlayer;
        this.broadcastPlayerUpdate();
        this.dealHand(antePaid);
    }

    dealHand(antePaid) {
        this.gameState.card1 = this.gameState.deck.draw();
        this.gameState.card2 = this.gameState.deck.draw();
        
        let p1 = Object.values(this.players).find(p => p.role === 'p1');
        let p2 = Object.values(this.players).find(p => p.role === 'p2');

        this.io.to(this.roomId).emit('new_hand_dealt', {
            antePaid: antePaid,
            p1Money: p1.money,
            p2Money: p2.money,
            pot: this.gameState.pot,
            card1: this.gameState.card1,
            card2: this.gameState.card2,
            activePlayer: this.gameState.activePlayer
        });

        this.startTurnTimer();
    }

    startTurnTimer() {
        clearTimeout(this.turnTimer); 
        this.io.to(this.roomId).emit('timer_start', this.gameState.turnDuration);

        this.turnTimer = setTimeout(() => {
            let activeSocketId = Object.keys(this.players).find(key => this.players[key].role === this.gameState.activePlayer);
            if(activeSocketId) {
                // We fake a socket call to reuse logic
                this.handleAction(activeSocketId, 'pass', 0);
            }
        }, this.gameState.turnDuration * 1000);
    }

    handleAction(socketId, actionType, betAmount) {
        const player = this.players[socketId];
        if(!player || player.role !== this.gameState.activePlayer) return;

        clearTimeout(this.turnTimer);

        let resultType = 'pass';
        let amount = 0;
        let resultCard = null;

        if(actionType === 'pass') {
            player.money -= this.gameState.penalty;
            this.gameState.pot += this.gameState.penalty;
            resultType = 'pass';
        } else {
            amount = parseInt(betAmount);
            player.money -= amount;
            
            resultCard = this.gameState.deck.draw();
            let low = Math.min(this.gameState.card1.value, this.gameState.card2.value);
            let high = Math.max(this.gameState.card1.value, this.gameState.card2.value);
            let val = resultCard.value;
            let win = (val > low && val < high);

            if(win) {
                player.money += (amount * 2);
                this.gameState.pot -= amount;
                resultType = 'win';
            } else {
                this.gameState.pot += amount;
                resultType = 'lose';
            }
        }

        let p1 = Object.values(this.players).find(p => p.role === 'p1');
        let p2 = Object.values(this.players).find(p => p.role === 'p2');
        
        this.io.to(this.roomId).emit('turn_resolved', {
            who: player.role,
            result: resultType,
            amount: amount,
            cardResult: resultCard,
            p1Money: p1.money, 
            p2Money: p2.money,
            pot: this.gameState.pot
        });

        this.broadcastPlayerUpdate();

        // Bankruptcy
        if(p1.money < this.gameState.ante || p2.money < this.gameState.ante) {
            let winner = (p1.money > p2.money) ? 'p1' : 'p2';
            this.io.to(this.roomId).emit('game_ended', { winner: winner });
            this.gameState.pot = 0; 
            return; 
        }

        // Proceed
        setTimeout(() => {
            if(this.gameState.pot === 0) {
                this.endRound();
                return;
            }
            if(this.gameState.activePlayer === this.gameState.firstPlayer) {
                this.gameState.activePlayer = (this.gameState.firstPlayer === 'p1') ? 'p2' : 'p1';
                this.dealHand(false);
            } else {
                this.endRound();
            }
        }, 3000);
    }

    endRound() {
        this.gameState.firstPlayer = (this.gameState.firstPlayer === 'p1') ? 'p2' : 'p1';
        this.io.to(this.roomId).emit('round_over', { nextStart: this.gameState.firstPlayer });
    }

    resetGame() {
        Object.values(this.players).forEach(p => p.money = 1000);
        this.gameState.pot = 0;
        this.gameState.firstPlayer = 'p1';
        this.io.to(this.roomId).emit('game_reset');
        this.broadcastPlayerUpdate();
        this.io.to(this.roomId).emit('round_over', { nextStart: 'p1' });
    }

    handleChat(socketId, message) {
        const player = this.players[socketId];
        if(!player) return;

        // Broadcast to room: "P1 says: Hello"
        this.io.to(this.roomId).emit('chat_received', {
            role: player.role, // 'p1' or 'p2'
            msg: message.substring(0, 20) // Limit length to prevent spam
        });
    }
}

// --- GLOBAL STATE ---
const rooms = {}; // Map: roomId -> GameRoom

io.on('connection', (socket) => {
    // 1. CREATE ROOM
    socket.on('create_room', (userData) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        // PASS CONFIG HERE
        rooms[roomId] = new GameRoom(roomId, io, userData.config);
        
        rooms[roomId].addPlayer(socket, userData);
        console.log(`Room ${roomId} created with Ante: ${userData.config.ante}, Penalty: ${userData.config.penalty}`);
    });

    // 2. JOIN ROOM
    socket.on('join_room', (data) => {
        // data = { roomId, name, avatar }
        const room = rooms[data.roomId];
        if(room) {
            const success = room.addPlayer(socket, data);
            if(!success) socket.emit('room_full');
        } else {
            socket.emit('error_msg', "Room not found!");
        }
    });

    // 3. DISCONNECT
    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if(roomId && rooms[roomId]) {
            rooms[roomId].removePlayer(socket.id);
            // Optional: Cleanup empty rooms
            if(Object.keys(rooms[roomId].players).length === 0) {
                delete rooms[roomId];
                console.log(`Room ${roomId} deleted.`);
            }
        }
    });

    // 4. GAME ACTIONS (Proxy to specific Room)
    socket.on('req_start_round', () => {
        const r = rooms[socket.data.roomId];
        if(r) r.startRound();
    });

    socket.on('req_action', (data) => {
        const r = rooms[socket.data.roomId];
        if(r) r.handleAction(socket.id, data.action, data.amount);
    });

    socket.on('req_rematch', () => {
        const r = rooms[socket.data.roomId];
        if(r) r.resetGame();
    });

    // 5. CHAT REQUEST
    socket.on('req_chat', (msg) => {
        const r = rooms[socket.data.roomId];
        if(r) {
            console.log(`Chat in room ${socket.data.roomId}: ${msg}`); // Added Log
            r.handleChat(socket.id, msg);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on ${PORT}`); });