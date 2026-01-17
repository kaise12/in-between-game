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


/// --- ROOM CLASS (6-Player Logic) ---
class GameRoom {
    constructor(roomId, io, config = {}, hostId) {
        this.roomId = roomId;
        this.io = io;
        this.hostId = hostId;
        this.turnTimer = null;
        
        this.seats = [null, null, null, null, null, null]; 

        this.gameState = {
            deck: new Deck(),
            pot: 0,
            ante: config.ante || 50,
            penalty: config.penalty || 10,
            card1: null,
            card2: null,
            activeSeat: -1, 
            dealerSeat: -1, 
            turnDuration: 15,
            isRoundActive: false 
        };
    }

    addPlayer(socket, userData) {
        if (this.seats.filter(s => s !== null).length >= 6) return false;
        const existingSeat = this.seats.findIndex(s => s && s.id === socket.id);
        if(existingSeat !== -1) return true;
        const seatIndex = this.seats.findIndex(s => s === null);
        
        this.seats[seatIndex] = {
            id: socket.id,
            name: userData.name.substring(0, 10),
            avatar: userData.avatar,
            money: 1000,
            seatIndex: seatIndex 
        };

        socket.join(this.roomId);
        socket.data.roomId = this.roomId;
        socket.data.seatIndex = seatIndex; 

        // Notify everyone ELSE that someone joined
        socket.broadcast.to(this.roomId).emit('notification', {
            msg: `${userData.name} joined the table!`,
            type: 'success'
        });

        socket.emit('welcome', { seatIndex: seatIndex, roomId: this.roomId, hostId: this.hostId });
        this.broadcastState();
        return true;
    }

    removePlayer(socketId) {
        const index = this.seats.findIndex(s => s && s.id === socketId);
        if(index !== -1) {
            const name = this.seats[index].name; 
            
            // 1. Remove the player
            this.seats[index] = null;

            // Notify table
            this.io.to(this.roomId).emit('notification', {
                msg: `${name} left the table.`,
                type: 'error'
            });

            // --- FIX PART 1: HOST MIGRATION ---
            // If the person leaving was the Host, assign a new Host
            if (socketId === this.hostId) {
                // Find the first available player to be the new host
                const newHost = this.seats.find(s => s !== null);
                if (newHost) {
                    this.hostId = newHost.id;
                    this.io.to(this.roomId).emit('notification', {
                        msg: `${newHost.name} is now the Room Host.`,
                        type: 'success'
                    });
                } else {
                    // No players left? (Room will be deleted by disconnect handler anyway)
                    this.hostId = null;
                }
            }
            // ----------------------------------

            // --- FIX PART 2: ACTIVE TURN LOGIC (Existing) ---
            if (this.gameState.isRoundActive && index === this.gameState.activeSeat) {
                clearTimeout(this.turnTimer); 

                const survivors = this.seats.filter(s => s !== null && s.money > 0);
                if (survivors.length < 2) {
                     this.endRound(-1, "Opponent Left"); 
                } else {
                    const nextSeat = this.getNextSeat(this.gameState.activeSeat);
                    this.gameState.activeSeat = nextSeat;
                    setTimeout(() => { this.dealHand(false); }, 1000);
                }
            }

            this.broadcastState();
        }
    }

    broadcastState() {
        this.io.to(this.roomId).emit('update_table', {
            seats: this.seats,
            pot: this.gameState.pot,
            dealer: this.gameState.dealerSeat,
            activeSeat: this.gameState.activeSeat,
            hostId: this.hostId,      
            isRoundActive: this.gameState.isRoundActive
        });
    }

    startRound() {
        // Only start if at least 2 people have money
        const playersWithMoney = this.seats.filter(s => s !== null && s.money > 0);
        if(playersWithMoney.length < 2) return;

        this.gameState.isRoundActive = true; 

        // 1. Ante Up 
        let anteTotal = 0;
        this.seats.forEach(p => {
            if(p && p.money > 0) { 
                const contribution = Math.min(p.money, this.gameState.ante);
                p.money -= contribution;
                anteTotal += contribution;
            }
        });
        
        this.gameState.pot += anteTotal;

        // 2. SET DEALER ROTATION
        // If it's the first game (dealerSeat is -1), pick the Host.
        if (this.gameState.dealerSeat === -1 || this.gameState.dealerSeat === undefined) {
            const hostSeatIndex = this.seats.findIndex(s => s && s.id === this.hostId);
            // If Host is playing, they start. If not, pick first available player.
            this.gameState.dealerSeat = (hostSeatIndex !== -1) ? hostSeatIndex : this.seats.findIndex(s => s !== null && s.money > 0);
        } else {
            // ROTATE: Find next player from the LAST dealer
            this.gameState.dealerSeat = this.getNextSeat(this.gameState.dealerSeat);
        }

        // --- SAFETY CHECK (The Fix) ---
        // Ensure the selected Dealer seat is not null (in case of race conditions or rapid disconnects)
        if (this.seats[this.gameState.dealerSeat] === null) {
            // If the selected seat is empty, force rotate to the next valid one immediately
            this.gameState.dealerSeat = this.getNextSeat(this.gameState.dealerSeat);
        }
        // ------------------------------

        // Set the active turn to the Dealer
        this.gameState.activeSeat = this.gameState.dealerSeat;

        this.broadcastState();
        
        // 3. Deal Hand
        this.dealHand(true); 
    }

    getNextSeat(currentIndex) {
        let next = (currentIndex + 1) % 6;
        let count = 0;
        while((this.seats[next] === null || this.seats[next].money <= 0) && count < 6) {
            next = (next + 1) % 6;
            count++;
        }
        return next;
    }

    dealHand(isNewRound = false) {
        this.gameState.card1 = this.gameState.deck.draw();
        this.gameState.card2 = this.gameState.deck.draw();
        
        this.io.to(this.roomId).emit('new_hand_dealt', {
            pot: this.gameState.pot,
            card1: this.gameState.card1,
            card2: this.gameState.card2,
            activeSeat: this.gameState.activeSeat,
            seats: this.seats,
            isNewRound: isNewRound 
        });
        this.startTurnTimer();
    }

    startTurnTimer() {
        clearTimeout(this.turnTimer); 
        this.io.to(this.roomId).emit('timer_start', { 
            duration: this.gameState.turnDuration, 
            seat: this.gameState.activeSeat 
        });

        this.turnTimer = setTimeout(() => {
            const currentP = this.seats[this.gameState.activeSeat];
            if(currentP) this.handleAction(currentP.id, 'pass', 0);
        }, this.gameState.turnDuration * 1000);
    }

    handleAction(socketId, actionType, betAmount) {
        const playerIndex = this.seats.findIndex(s => s && s.id === socketId);
        if(playerIndex === -1 || playerIndex !== this.gameState.activeSeat) return;

        const player = this.seats[playerIndex];
        clearTimeout(this.turnTimer);

        let resultType = 'pass';
        let amount = 0;
        let resultCard = null;

        if(actionType === 'pass') {
            const deduction = Math.min(player.money, this.gameState.penalty);
            player.money -= deduction;
            this.gameState.pot += deduction;
            amount = deduction; 
        } else {
            amount = Math.min(parseInt(betAmount), player.money);
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

        this.io.to(this.roomId).emit('turn_resolved', {
            seatIndex: playerIndex,
            result: resultType,
            amount: amount,
            cardResult: resultCard,
            seats: this.seats,
            pot: this.gameState.pot
        });

        const survivors = this.seats.filter(s => s !== null && s.money > 0);
        
        if(this.gameState.pot <= 0) {
             this.endRound(playerIndex, "Pot Empty");
             return;
        }

        if(survivors.length === 1) {
            survivors[0].money += this.gameState.pot;
            this.gameState.pot = 0;
            this.endRound(survivors[0].seatIndex, "Last Man Standing");
            return;
        }
        
        if(survivors.length === 0) {
            this.endRound(-1, "House Wins");
            return;
        }

        if (player.money <= 0) {
            this.io.to(player.id).emit('you_are_bankrupt');
            this.seats[playerIndex] = null; 
            this.broadcastState(); 
        }

        const nextSeat = this.getNextSeat(this.gameState.activeSeat);
        setTimeout(() => {
            this.gameState.activeSeat = nextSeat;
            this.dealHand(false); 
        }, 3000);
    }
    
    endRound(winnerIndex, reason) {
        this.io.to(this.roomId).emit('game_ended', { 
            winnerSeat: winnerIndex,
            reason: reason 
        });
        for(let i=0; i<this.seats.length; i++) {
            if(this.seats[i] && this.seats[i].money <= 0) {
                this.io.to(this.seats[i].id).emit('you_are_bankrupt');
                this.seats[i] = null; 
            }
        }
        this.gameState.pot = 0; 
        this.gameState.activeSeat = -1;
        this.gameState.isRoundActive = false; 
        this.gameState.card1 = null;
        this.gameState.card2 = null;
        this.broadcastState(); 
    }

    handleChat(socketId, msg) {
        const player = this.seats.find(s => s && s.id === socketId);
        if(player) {
            this.io.to(this.roomId).emit('chat_received', {
                seatIndex: player.seatIndex,
                msg: msg.substring(0, 20)
            });
        }
    }

    resetGame() {
        this.seats.forEach(p => { if(p) p.money = 1000; });
        this.gameState.pot = 0;
        this.gameState.activeSeat = -1;
        this.gameState.isRoundActive = false; 
        this.broadcastState();
        this.io.to(this.roomId).emit('game_reset');
    }
}

// --- GLOBAL STATE ---
const rooms = {}; 

io.on('connection', (socket) => {
    
    // 1. Join Lobby & Broadcast Count
    socket.join('lobby');
    io.emit('update_user_count', io.engine.clientsCount);

    // 2. Lobby Chat
    socket.on('req_lobby_chat', (data) => {
        io.to('lobby').emit('lobby_chat_received', {
            name: data.name,
            msg: data.msg
        });
    });

    socket.on('create_room', (userData) => {
        socket.leave('lobby'); // Leave global lobby
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = new GameRoom(roomId, io, userData.config, socket.id);
        rooms[roomId].addPlayer(socket, userData);
        console.log(`Room ${roomId} created by Host ${socket.id}`);
    });

    socket.on('join_room', (data) => {
        socket.leave('lobby'); // Leave global lobby
        const room = rooms[data.roomId];
        if(room) {
            const success = room.addPlayer(socket, data);
            if(!success) socket.emit('room_full');
        } else {
            socket.emit('error_msg', "Room not found!");
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if(roomId && rooms[roomId]) {
            rooms[roomId].removePlayer(socket.id);
            if(rooms[roomId] && rooms[roomId].seats.every(s => s === null)) {
                delete rooms[roomId];
            }
        }
        io.emit('update_user_count', io.engine.clientsCount);
    });

    socket.on('req_start_round', () => {
        const r = rooms[socket.data.roomId];
        if(r) {
            if (socket.id !== r.hostId) return; 
            r.startRound();
        }
    });

    socket.on('req_action', (data) => {
        const r = rooms[socket.data.roomId];
        if(r) r.handleAction(socket.id, data.action, data.amount);
    });

    socket.on('req_rematch', () => {
        const r = rooms[socket.data.roomId];
        if(r) r.resetGame();
    });

    socket.on('req_chat', (msg) => {
        const r = rooms[socket.data.roomId];
        if(r) r.handleChat(socket.id, msg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on ${PORT}`); });