require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { rollDice } = require('./src/dice');
const {
  CLASSES,
  joinRoom,
  leaveRoom,
  startAdventure,
  currentTurnPlayerId,
  advanceTurn,
  applyDamage,
  applyHeal,
  appendHistory,
  getRoom,
  getRoomSnapshot,
} = require('./src/gameState');
const { streamDMResponse, generateOpeningScene } = require('./src/aiDM');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

function buildPartyContext(roomId) {
  const room = getRoom(roomId);
  if (!room) return '';
  const lines = ['Party:'];
  for (const char of room.players.values()) {
    const statLine = Object.entries(char.stats).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' ');
    lines.push(`  - ${char.name} (${char.class}) HP:${char.hp}/${char.maxHp} ${statLine}`);
  }
  return lines.join('\n');
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', ({ roomId, name, charClass }, ack) => {
    const result = joinRoom(roomId, socket.id, name, charClass);
    if (result.error) return ack({ error: result.error });

    currentRoom = roomId;
    socket.join(roomId);

    const snapshot = getRoomSnapshot(roomId);
    io.to(roomId).emit('room_update', snapshot);
    io.to(roomId).emit('chat', {
      type: 'system',
      text: `${name} the ${charClass} has joined the party.`,
    });
    ack({ ok: true, character: result.character, classes: Object.keys(CLASSES) });
  });

  socket.on('start_game', async ({ setting }, ack) => {
    if (!currentRoom) return ack({ error: 'Not in a room' });
    const result = startAdventure(currentRoom);
    if (result.error) return ack({ error: result.error });

    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    io.to(currentRoom).emit('chat', {
      type: 'system',
      text: `Adventure begins! Initiative order: ${result.initiatives.map(i => `${i.name} (${i.init})`).join(', ')}`,
    });

    // Generate opening scene
    try {
      const partyCtx = buildPartyContext(currentRoom);
      const opening = await generateOpeningScene(setting, partyCtx);
      appendHistory(currentRoom, 'assistant', opening);
      io.to(currentRoom).emit('chat', { type: 'dm', text: opening });
      io.to(currentRoom).emit('turn_prompt', { socketId: currentTurnPlayerId(currentRoom) });
      ack({ ok: true });
    } catch (err) {
      ack({ error: err.message });
    }
  });

  socket.on('player_action', async ({ action }, ack) => {
    if (!currentRoom) return ack({ error: 'Not in a room' });
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'adventure') return ack({ error: 'Game not active' });

    const turnId = currentTurnPlayerId(currentRoom);
    if (turnId !== socket.id) return ack({ error: 'Not your turn' });

    const char = room.players.get(socket.id);
    const fullAction = `${char.name}: ${action}`;

    io.to(currentRoom).emit('chat', { type: 'player', name: char.name, text: action });
    appendHistory(currentRoom, 'user', fullAction);

    const partyCtx = buildPartyContext(currentRoom);
    const roomId = currentRoom;

    // Stream DM response chunk by chunk
    io.to(roomId).emit('dm_start');
    try {
      await streamDMResponse(
        room.history,
        partyCtx,
        (chunk) => io.to(roomId).emit('dm_chunk', { chunk }),
        (full) => {
          appendHistory(roomId, 'assistant', full);
          const next = advanceTurn(roomId);
          io.to(roomId).emit('dm_end');
          io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
          io.to(roomId).emit('turn_prompt', { socketId: next });
        }
      );
      ack({ ok: true });
    } catch (err) {
      io.to(roomId).emit('dm_end');
      ack({ error: err.message });
    }
  });

  socket.on('roll_dice', ({ notation }, ack) => {
    if (!currentRoom) return ack({ error: 'Not in a room' });
    const room = getRoom(currentRoom);
    if (!room) return ack({ error: 'Room not found' });
    const char = room.players.get(socket.id);
    const name = char ? char.name : 'Unknown';

    const result = rollDice(notation);
    if (result.error) return ack({ error: result.error });

    const text = `🎲 ${name} rolled ${notation}: [${result.rolls.join(', ')}]${result.modifier ? (result.modifier > 0 ? '+' : '') + result.modifier : ''} = **${result.total}**`;
    io.to(currentRoom).emit('chat', { type: 'roll', text });
    ack({ ok: true, result });
  });

  socket.on('dm_damage', ({ targetName, amount }) => {
    if (!currentRoom) return;
    const char = applyDamage(currentRoom, targetName, amount);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('chat', {
        type: 'system',
        text: `${targetName} takes ${amount} damage! (HP: ${char.hp}/${char.maxHp})`,
      });
    }
  });

  socket.on('dm_heal', ({ targetName, amount }) => {
    if (!currentRoom) return;
    const char = applyHeal(currentRoom, targetName, amount);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('chat', {
        type: 'system',
        text: `${targetName} is healed for ${amount} HP! (HP: ${char.hp}/${char.maxHp})`,
      });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      const char = room?.players.get(socket.id);
      leaveRoom(currentRoom, socket.id);
      if (char) {
        io.to(currentRoom).emit('chat', { type: 'system', text: `${char.name} has left the party.` });
        io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DynamicDND running on http://localhost:${PORT}`));
