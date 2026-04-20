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
  addCondition,
  removeCondition,
  addInventoryItem,
  removeInventoryItem,
  useSpellSlot,
  longRest,
  shortRest,
  rollDeathSave,
  setWorld,
  addNpc,
  appendHistory,
  getRoom,
  getRoomSnapshot,
} = require('./src/gameState');
const { streamDMResponse, generateOpeningScene, generateWorldStep } = require('./src/aiDM');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

function buildPartyContext(roomId) {
  const room = getRoom(roomId);
  if (!room) return '';
  const lines = [];
  if (room.world) {
    lines.push('=== WORLD ===');
    if (room.world.name_tone)  lines.push(room.world.name_tone.substring(0, 300));
    if (room.world.geography)  lines.push(`Locations: ${room.world.geography.substring(0, 200)}`);
    if (room.world.threats)    lines.push(`Threats: ${room.world.threats.substring(0, 200)}`);
    lines.push('');
  }
  lines.push('Party:');
  for (const char of room.players.values()) {
    const statLine = Object.entries(char.stats).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' ');
    const conditions = char.conditions.length ? ` [${char.conditions.join(', ')}]` : '';
    lines.push(`  - ${char.name} (${char.class}) HP:${char.hp}/${char.maxHp}${conditions} ${statLine}`);
  }
  if (room.npcs.length) {
    lines.push('Known NPCs:');
    room.npcs.forEach(n => lines.push(`  - ${n.name} (${n.role || 'unknown'}, ${n.disposition || 'neutral'}): ${n.notes || ''}`));
  }
  return lines.join('\n');
}

function extractScenePrompt(text) {
  const clean = text.replace(/\*+/g, '').replace(/\[.*?\]/g, '').replace(/\n/g, ' ').trim().substring(0, 150);
  return encodeURIComponent(`fantasy RPG scene, ${clean}, dark fantasy oil painting, dramatic lighting, highly detailed`);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('peek_room', ({ roomId }, ack) => {
    const room = getRoom(roomId);
    ack({ world: room?.world || null });
  });

  socket.on('join_room', ({ roomId, name, charClass, race }, ack) => {
    const result = joinRoom(roomId, socket.id, name, charClass, race);
    if (result.error) return ack({ error: result.error });

    currentRoom = roomId;
    socket.join(roomId);

    const snapshot = getRoomSnapshot(roomId);
    io.to(roomId).emit('room_update', snapshot);
    io.to(roomId).emit('chat', { type: 'system', text: `${name} the ${charClass} has joined the party.` });
    ack({ ok: true, character: result.character, classes: Object.keys(CLASSES) });
  });

  socket.on('start_game', async ({ setting }, ack) => {
    if (!currentRoom) return ack({ error: 'Not in a room' });
    const result = startAdventure(currentRoom);
    if (result.error) return ack({ error: result.error });

    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    io.to(currentRoom).emit('chat', {
      type: 'system',
      text: `Adventure begins! Initiative: ${result.initiatives.map(i => `${i.name} (${i.init})`).join(' → ')}`,
    });

    try {
      const partyCtx = buildPartyContext(currentRoom);
      const opening = await generateOpeningScene(setting, partyCtx, getRoom(currentRoom)?.world);
      appendHistory(currentRoom, 'assistant', opening);
      const sceneImg = `https://image.pollinations.ai/prompt/${extractScenePrompt(opening)}?width=800&height=300&nologo=true&seed=${Date.now()}`;
      io.to(currentRoom).emit('chat', { type: 'dm', text: opening, sceneImg });
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
    if (currentTurnPlayerId(currentRoom) !== socket.id) return ack({ error: 'Not your turn' });

    const char = room.players.get(socket.id);
    const fullAction = `${char.name}: ${action}`;
    io.to(currentRoom).emit('chat', { type: 'player', name: char.name, text: action });
    appendHistory(currentRoom, 'user', fullAction);

    const partyCtx = buildPartyContext(currentRoom);
    const roomId = currentRoom;

    io.to(roomId).emit('dm_start');
    try {
      let fullText = '';
      await streamDMResponse(
        room.history,
        partyCtx,
        (chunk) => { fullText += chunk; io.to(roomId).emit('dm_chunk', { chunk }); },
        (full) => {
          appendHistory(roomId, 'assistant', full);
          const next = advanceTurn(roomId);
          const sceneImg = `https://image.pollinations.ai/prompt/${extractScenePrompt(full)}?width=800&height=300&nologo=true&seed=${Date.now()}`;
          io.to(roomId).emit('dm_end', { sceneImg });
          io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
          io.to(roomId).emit('turn_prompt', { socketId: next });
        }
      );
      ack({ ok: true });
    } catch (err) {
      io.to(roomId).emit('dm_end', {});
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
    const res = applyDamage(currentRoom, targetName, amount);
    if (res) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('hp_change', { name: targetName, prev: res.prev, current: res.char.hp, type: 'damage' });
      io.to(currentRoom).emit('chat', { type: 'system', text: `${targetName} takes ${amount} damage! (HP: ${res.char.hp}/${res.char.maxHp})` });
    }
  });

  socket.on('dm_heal', ({ targetName, amount }) => {
    if (!currentRoom) return;
    const res = applyHeal(currentRoom, targetName, amount);
    if (res) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('hp_change', { name: targetName, prev: res.prev, current: res.char.hp, type: 'heal' });
      io.to(currentRoom).emit('chat', { type: 'system', text: `${targetName} healed for ${amount} HP! (HP: ${res.char.hp}/${res.char.maxHp})` });
    }
  });

  socket.on('add_condition', ({ targetName, condition }) => {
    if (!currentRoom) return;
    const char = addCondition(currentRoom, targetName, condition);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('chat', { type: 'system', text: `${targetName} is now ${condition}.` });
    }
  });

  socket.on('remove_condition', ({ targetName, condition }) => {
    if (!currentRoom) return;
    const char = removeCondition(currentRoom, targetName, condition);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('chat', { type: 'system', text: `${targetName} is no longer ${condition}.` });
    }
  });

  socket.on('add_item', ({ item }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = addInventoryItem(currentRoom, socket.id, item);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      ack && ack({ ok: true });
    }
  });

  socket.on('remove_item', ({ index }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = removeInventoryItem(currentRoom, socket.id, index);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      ack && ack({ ok: true });
    }
  });

  socket.on('use_spell_slot', ({ level }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = useSpellSlot(currentRoom, socket.id, level);
    if (!char) return ack && ack({ error: 'No spell slots at that level' });
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    ack && ack({ ok: true });
  });

  socket.on('long_rest', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = longRest(currentRoom, socket.id);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('chat', { type: 'system', text: `${char.name} takes a long rest. HP and spell slots restored.` });
      ack && ack({ ok: true });
    }
  });

  socket.on('short_rest', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const res = shortRest(currentRoom, socket.id);
    if (!res || res.error) return ack && ack({ error: res?.error || 'Cannot take short rest' });
    const conStr = res.conMod > 0 ? `+${res.conMod}` : res.conMod < 0 ? `${res.conMod}` : '';
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    io.to(currentRoom).emit('chat', {
      type: 'system',
      text: `${res.char.name} takes a short rest, rolling 1d${res.hitDie}${conStr}: **+${res.heal} HP** (${res.prev} → ${res.char.hp}). Hit dice remaining: ${res.char.hitDice}/${res.char.maxHitDice}`,
    });
    ack && ack({ ok: true });
  });

  socket.on('roll_death_save', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const res = rollDeathSave(currentRoom, socket.id);
    if (!res) return ack && ack({ error: 'Cannot roll death save' });
    let text;
    if (res.outcome === 'miraculous') text = `💫 ${res.char.name} rolled a **20** on their death save — miraculous recovery! Back at 1 HP.`;
    else if (res.outcome === 'stable') text = `✨ ${res.char.name} has **stabilized**! (3 successes)`;
    else if (res.outcome === 'dead') text = `💀 ${res.char.name} has **died**... (3 failures)`;
    else text = `🎲 ${res.char.name} death save: **${res.roll}** (${res.roll >= 10 ? '✓ success' : '✗ failure'}) — ${res.deathSaves.successes} success / ${res.deathSaves.failures} fail`;
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    io.to(currentRoom).emit('chat', { type: 'system', text });
    io.to(currentRoom).emit('death_save_result', {
      socketId: socket.id,
      roll: res.roll,
      outcome: res.outcome,
      deathSaves: res.deathSaves,
    });
    ack && ack({ ok: true });
  });

  socket.on('add_npc', ({ npc }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const npcs = addNpc(currentRoom, npc);
    if (npcs) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      ack && ack({ ok: true });
    }
  });

  socket.on('generate_world_step', async ({ step, worldContext, description }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const roomId = currentRoom;
    io.to(roomId).emit('world_step_start', { step });
    try {
      await generateWorldStep(
        step,
        worldContext || {},
        description || '',
        (chunk) => io.to(roomId).emit('world_step_chunk', { step, chunk }),
        (full)  => io.to(roomId).emit('world_step_done',  { step, text: full }),
      );
      ack && ack({ ok: true });
    } catch (err) {
      io.to(roomId).emit('world_step_done', { step, text: '', error: err.message });
      ack && ack({ error: err.message });
    }
  });

  socket.on('set_world', ({ world }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    setWorld(currentRoom, world);
    io.to(currentRoom).emit('world_update', { world });
    ack && ack({ ok: true });
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
