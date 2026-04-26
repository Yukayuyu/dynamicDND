require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { rollDice } = require('./src/dice');
const {
  CLASSES,
  BACKGROUNDS,
  ALIGNMENTS,
  LANGUAGES,
  setLanguage,
  getOrCreateRoom,
  joinRoom,
  leaveRoom,
  startAdventure,
  currentTurnPlayerId,
  currentTurnCharacter,
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
  addAiPlayer,
  removeAiPlayer,
  setPaused,
  setBible,
  reconnectPlayer,
} = require('./src/gameState');
const { streamDMResponse, generateOpeningScene, generateWorldStep, generateAiPlayerAction, prepareBible, bibleDigest } = require('./src/aiDM');
const { appendLog, getLog, savePersona, getPersona, listPersonas, deletePersona } = require('./src/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Emit a chat message AND persist it to the session log
function chatLog(roomId, msg) {
  io.to(roomId).emit('chat', msg);
  const actor =
    msg.type === 'player' ? (msg.name || 'Player') :
    msg.type === 'dm'     ? 'DM' : 'System';
  appendLog(roomId, msg.type, actor, msg.text || '');
}

function buildPartyContext(roomId) {
  const room = getRoom(roomId);
  if (!room) return '';
  const lines = [];
  if (room.world) {
    lines.push('=== WORLD ===');
    // Prefer the structured campaign bible when available — it is canonical.
    // Fall back to the free-text concept fields otherwise.
    if (room.world.bible) {
      lines.push('Campaign Bible (authoritative — use these names and respect these rules):');
      lines.push(bibleDigest(room.world.bible));
    } else {
      if (room.world.name_tone) lines.push(room.world.name_tone.substring(0, 300));
      if (room.world.geography) lines.push(`Locations: ${room.world.geography.substring(0, 200)}`);
      if (room.world.threats)   lines.push(`Threats: ${room.world.threats.substring(0, 200)}`);
    }
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

/* ─────────── Shared turn pipeline ─────────── */
// Runs one action-through-DM cycle for either a human or an AI actor.
function runTurn(roomId, actorName, actionText) {
  const room = getRoom(roomId);
  if (!room || room.phase !== 'adventure') return Promise.resolve();

  const fullAction = `${actorName}: ${actionText}`;
  chatLog(roomId, { type: 'player', name: actorName, text: actionText });
  appendHistory(roomId, 'user', fullAction);

  const partyCtx = buildPartyContext(roomId);
  io.to(roomId).emit('dm_start');

  return new Promise((resolve) => {
    let fullText = '';
    streamDMResponse(
      room.history,
      partyCtx,
      (chunk) => { fullText += chunk; io.to(roomId).emit('dm_chunk', { chunk }); },
      (full) => {
        appendHistory(roomId, 'assistant', full);
        appendLog(roomId, 'dm', 'DM', full);
        const next = advanceTurn(roomId);
        const sceneImg = `https://image.pollinations.ai/prompt/${extractScenePrompt(full)}?width=800&height=300&nologo=true&seed=${Date.now()}`;
        io.to(roomId).emit('dm_end', { sceneImg });
        io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
        io.to(roomId).emit('turn_prompt', { socketId: next });
        resolve();
        scheduleNextTurnIfAi(roomId);
      },
      { language: room.language }
    ).catch((err) => {
      io.to(roomId).emit('dm_end', {});
      chatLog(roomId, { type: 'system', text: `DM error: ${err.message}` });
      resolve();
    });
  });
}

// Drives the turn loop: auto-runs AI turns, auto-skips disconnected humans
// or dead/downed characters. Connected humans wait for their player_action.
function scheduleNextTurn(roomId) {
  const room = getRoom(roomId);
  if (!room || room.phase !== 'adventure' || room.paused) return;
  const curChar = currentTurnCharacter(roomId);
  if (!curChar) return;

  // Dead/downed: skip
  if (curChar.hp <= 0 || (curChar.conditions || []).includes('Dead')) {
    setTimeout(() => {
      advanceTurn(roomId);
      io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
      io.to(roomId).emit('turn_prompt', { socketId: currentTurnPlayerId(roomId) });
      scheduleNextTurn(roomId);
    }, 400);
    return;
  }

  // Disconnected human: auto-skip after a brief wait, with a system note.
  if (!curChar.isAi && curChar.disconnected) {
    chatLog(roomId, { type: 'system', text: `${curChar.name} is offline — skipping their turn.` });
    setTimeout(() => {
      advanceTurn(roomId);
      io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
      io.to(roomId).emit('turn_prompt', { socketId: currentTurnPlayerId(roomId) });
      scheduleNextTurn(roomId);
    }, 1500);
    return;
  }

  // AI: queue an action
  if (curChar.isAi) {
    const curId = currentTurnPlayerId(roomId);
    setTimeout(() => runAiTurn(roomId, curId), 1800);
    return;
  }

  // Connected human: wait for player_action.
}

// Backwards-compat alias for any earlier callers in this file.
const scheduleNextTurnIfAi = scheduleNextTurn;

async function runAiTurn(roomId, aiId) {
  const room = getRoom(roomId);
  if (!room || room.phase !== 'adventure' || room.paused) return;
  if (currentTurnPlayerId(roomId) !== aiId) return; // turn already moved on
  const char = room.players.get(aiId);
  if (!char || !char.isAi) return;

  try {
    const partyCtx = buildPartyContext(roomId);
    io.to(roomId).emit('ai_thinking', { socketId: aiId, name: char.name });
    const actionText = await generateAiPlayerAction({
      persona: {
        name: char.name,
        race: char.race,
        class: char.class,
        personality: char.persona?.personality,
        speech: char.persona?.speech,
        goals: char.persona?.goals,
        quirks: char.persona?.quirks,
      },
      partyContext: partyCtx,
      world: room.world,
      history: room.history,
      language: room.language,
    });
    io.to(roomId).emit('ai_thinking_done', { socketId: aiId });

    if (!actionText) {
      chatLog(roomId, { type: 'system', text: `${char.name} hesitates and yields the turn.` });
      advanceTurn(roomId);
      io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
      io.to(roomId).emit('turn_prompt', { socketId: currentTurnPlayerId(roomId) });
      scheduleNextTurnIfAi(roomId);
      return;
    }
    await runTurn(roomId, char.name, actionText);
  } catch (err) {
    io.to(roomId).emit('ai_thinking_done', { socketId: aiId });
    chatLog(roomId, { type: 'system', text: `${char.name} falters (AI error: ${err.message}).` });
    advanceTurn(roomId);
    io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
    io.to(roomId).emit('turn_prompt', { socketId: currentTurnPlayerId(roomId) });
    scheduleNextTurnIfAi(roomId);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('peek_room', ({ roomId }, ack) => {
    const room = getRoom(roomId);
    ack({ world: room?.world || null });
  });

  socket.on('join_room', ({ roomId, name, charClass, race, abilities, background, alignment, portrait }, ack) => {
    const result = joinRoom(roomId, socket.id, name, charClass, race, { abilities, background, alignment, portrait });
    if (result.error) return ack({ error: result.error });

    currentRoom = roomId;
    socket.join(roomId);

    const snapshot = getRoomSnapshot(roomId);
    io.to(roomId).emit('room_update', snapshot);
    const joinText = `${name} the ${race ? race + ' ' : ''}${charClass} has joined the party.`;
    chatLog(roomId, { type: 'system', text: joinText });
    ack({ ok: true, character: result.character, classes: Object.keys(CLASSES) });
  });

  socket.on('get_meta', (_, ack) => {
    ack && ack({
      ok: true,
      classes: Object.keys(CLASSES),
      backgrounds: BACKGROUNDS,
      alignments: ALIGNMENTS,
      languages: LANGUAGES,
    });
  });

  socket.on('set_language', ({ code }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const lang = setLanguage(currentRoom, code);
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    ack && ack({ ok: true, language: lang });
  });

  socket.on('start_game', async ({ setting }, ack) => {
    if (!currentRoom) return ack({ error: 'Not in a room' });
    const result = startAdventure(currentRoom);
    if (result.error) return ack({ error: result.error });

    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    const initText = `Adventure begins! Initiative order: ${result.initiatives.map(i => `${i.name} (${i.init})`).join(' → ')}`;
    chatLog(currentRoom, { type: 'system', text: initText });

    try {
      const partyCtx = buildPartyContext(currentRoom);
      const opening = await generateOpeningScene(setting, partyCtx, getRoom(currentRoom)?.world, { language: getRoom(currentRoom)?.language });
      appendHistory(currentRoom, 'assistant', opening);
      appendLog(currentRoom, 'dm', 'DM', opening);
      const sceneImg = `https://image.pollinations.ai/prompt/${extractScenePrompt(opening)}?width=800&height=300&nologo=true&seed=${Date.now()}`;
      io.to(currentRoom).emit('chat', { type: 'dm', text: opening, sceneImg });
      io.to(currentRoom).emit('turn_prompt', { socketId: currentTurnPlayerId(currentRoom) });
      ack({ ok: true });
      // If the first actor is an AI, kick off the loop.
      scheduleNextTurnIfAi(currentRoom);
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
    try {
      await runTurn(currentRoom, char.name, action);
      ack({ ok: true });
    } catch (err) {
      ack({ error: err.message });
    }
  });

  /* ─────── Hosting / spectating (no-player-character entry) ─────── */
  socket.on('host_room', ({ roomId }, ack) => {
    if (!roomId) return ack && ack({ error: 'roomId required' });
    currentRoom = roomId;
    socket.join(roomId);
    // Ensure the room exists in memory (loads from DB if present).
    getOrCreateRoom(roomId);
    ack && ack({ ok: true, snapshot: getRoomSnapshot(roomId) });
  });

  socket.on('spectate_room', ({ roomId }, ack) => {
    if (!roomId) return ack && ack({ error: 'roomId required' });
    const room = getOrCreateRoom(roomId);
    if (!room) return ack && ack({ error: 'Room not found' });
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room_update', getRoomSnapshot(roomId));
    const entries = getLog(roomId);
    socket.emit('log_replay', { entries: entries.slice(-80) });
    ack && ack({ ok: true });
  });

  // Mid-game reconnect: rebind a previously-disconnected character to this socket.
  socket.on('reconnect_player', ({ roomId, name }, ack) => {
    if (!roomId || !name) return ack && ack({ error: 'roomId and name required' });
    const res = reconnectPlayer(roomId, socket.id, name);
    if (res.error) return ack && ack({ error: res.error });
    currentRoom = roomId;
    socket.join(roomId);
    io.to(roomId).emit('room_update', getRoomSnapshot(roomId));
    chatLog(roomId, { type: 'system', text: `${res.character.name} has reconnected.` });
    const entries = getLog(roomId);
    socket.emit('log_replay', { entries: entries.slice(-80) });
    socket.emit('turn_prompt', { socketId: currentTurnPlayerId(roomId) });
    // If the loop was waiting on this player (or stalled on a disconnected slot), resume it.
    scheduleNextTurn(roomId);
    ack && ack({ ok: true, character: res.character, snapshot: getRoomSnapshot(roomId) });
  });

  /* ─────── Persona library ─────── */
  socket.on('list_personas', (_, ack) => {
    ack && ack({ ok: true, personas: listPersonas() });
  });

  socket.on('create_persona', ({ persona }, ack) => {
    if (!persona || !persona.name) return ack && ack({ error: 'Name required' });
    const id = persona.id || `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const saved = savePersona({ ...persona, id });
    ack && ack({ ok: true, persona: saved });
  });

  socket.on('delete_persona', ({ id }, ack) => {
    if (!id) return ack && ack({ error: 'id required' });
    deletePersona(id);
    ack && ack({ ok: true });
  });

  /* ─────── AI players in a room ─────── */
  socket.on('add_ai_player', ({ personaId }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const persona = getPersona(personaId);
    if (!persona) return ack && ack({ error: 'Persona not found' });
    const res = addAiPlayer(currentRoom, persona);
    if (res.error) return ack && ack({ error: res.error });
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, { type: 'system', text: `${res.character.name} (AI ${res.character.race} ${res.character.class}) joins the party.` });
    ack && ack({ ok: true, aiId: res.aiId });
  });

  socket.on('remove_ai_player', ({ aiId }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = removeAiPlayer(currentRoom, aiId);
    if (!char) return ack && ack({ error: 'AI not found' });
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, { type: 'system', text: `${char.name} departs the party.` });
    ack && ack({ ok: true });
  });

  /* ─────── Watch-mode pause / resume ─────── */
  socket.on('pause_watch', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    setPaused(currentRoom, true);
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, { type: 'system', text: '⏸️ Watch mode paused.' });
    ack && ack({ ok: true });
  });

  socket.on('resume_watch', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    setPaused(currentRoom, false);
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, { type: 'system', text: '▶️ Watch mode resumed.' });
    scheduleNextTurnIfAi(currentRoom);
    ack && ack({ ok: true });
  });

  socket.on('step_ai_turn', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    scheduleNextTurnIfAi(currentRoom);
    ack && ack({ ok: true });
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
    chatLog(currentRoom, { type: 'roll', text });
    ack({ ok: true, result });
  });

  socket.on('dm_damage', ({ targetName, amount }) => {
    if (!currentRoom) return;
    const res = applyDamage(currentRoom, targetName, amount);
    if (res) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('hp_change', { name: targetName, prev: res.prev, current: res.char.hp, type: 'damage' });
      chatLog(currentRoom, { type: 'system', text: `${targetName} takes ${amount} damage! (HP: ${res.char.hp}/${res.char.maxHp})` });
    }
  });

  socket.on('dm_heal', ({ targetName, amount }) => {
    if (!currentRoom) return;
    const res = applyHeal(currentRoom, targetName, amount);
    if (res) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      io.to(currentRoom).emit('hp_change', { name: targetName, prev: res.prev, current: res.char.hp, type: 'heal' });
      chatLog(currentRoom, { type: 'system', text: `${targetName} healed for ${amount} HP! (HP: ${res.char.hp}/${res.char.maxHp})` });
    }
  });

  socket.on('add_condition', ({ targetName, condition }) => {
    if (!currentRoom) return;
    const char = addCondition(currentRoom, targetName, condition);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      chatLog(currentRoom, { type: 'system', text: `${targetName} is now ${condition}.` });
    }
  });

  socket.on('remove_condition', ({ targetName, condition }) => {
    if (!currentRoom) return;
    const char = removeCondition(currentRoom, targetName, condition);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      chatLog(currentRoom, { type: 'system', text: `${targetName} is no longer ${condition}.` });
    }
  });

  socket.on('add_item', ({ item }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = addInventoryItem(currentRoom, socket.id, item);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      appendLog(currentRoom, 'system', char.name, `${char.name} added "${item}" to inventory.`);
      ack && ack({ ok: true });
    }
  });

  socket.on('remove_item', ({ index }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const room = getRoom(currentRoom);
    const char = room?.players.get(socket.id);
    const item = char?.inventory[index];
    const updated = removeInventoryItem(currentRoom, socket.id, index);
    if (updated) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      if (item) appendLog(currentRoom, 'system', updated.name, `${updated.name} removed "${item}" from inventory.`);
      ack && ack({ ok: true });
    }
  });

  socket.on('use_spell_slot', ({ level }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = useSpellSlot(currentRoom, socket.id, level);
    if (!char) return ack && ack({ error: 'No spell slots at that level' });
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    appendLog(currentRoom, 'system', char.name, `${char.name} used a level ${level} spell slot. (${char.spellSlots[level]} remaining)`);
    ack && ack({ ok: true });
  });

  socket.on('long_rest', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const char = longRest(currentRoom, socket.id);
    if (char) {
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      chatLog(currentRoom, { type: 'system', text: `${char.name} takes a long rest. HP and spell slots fully restored.` });
      ack && ack({ ok: true });
    }
  });

  socket.on('short_rest', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const res = shortRest(currentRoom, socket.id);
    if (!res || res.error) return ack && ack({ error: res?.error || 'Cannot take short rest' });
    const conStr = res.conMod > 0 ? `+${res.conMod}` : res.conMod < 0 ? `${res.conMod}` : '';
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, {
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
    else if (res.outcome === 'dead')   text = `💀 ${res.char.name} has **died**... (3 failures)`;
    else text = `🎲 ${res.char.name} death save: **${res.roll}** (${res.roll >= 10 ? '✓ success' : '✗ failure'}) — ${res.deathSaves.successes} success / ${res.deathSaves.failures} fail`;
    io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
    chatLog(currentRoom, { type: 'system', text });
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
      appendLog(currentRoom, 'system', 'System', `NPC tracked: ${npc.name} (${npc.role || 'unknown'}, ${npc.disposition || 'neutral'})${npc.notes ? ' — ' + npc.notes : ''}`);
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
        { language: getRoom(roomId)?.language },
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
    appendLog(currentRoom, 'system', 'System', `World confirmed: ${world._name || 'Unknown World'}`);
    ack && ack({ ok: true });
  });

  socket.on('prepare_bible', async (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const room = getRoom(currentRoom);
    if (!room || !room.world) return ack && ack({ error: 'Confirm a world first' });
    const roomId = currentRoom;
    io.to(roomId).emit('bible_start');
    try {
      const bible = await prepareBible(
        room.world,
        (len) => io.to(roomId).emit('bible_progress', { bytes: len }),
        { language: room.language },
      );
      setBible(roomId, bible);
      io.to(roomId).emit('bible_done', { bible });
      appendLog(roomId, 'system', 'System', `Campaign bible prepared: ${bible.locations.length} locations, ${bible.factions.length} factions.`);
      ack && ack({ ok: true, bible });
    } catch (err) {
      io.to(roomId).emit('bible_done', { error: err.message });
      ack && ack({ error: err.message });
    }
  });

  socket.on('update_bible', ({ bible }, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    if (!bible || typeof bible !== 'object') return ack && ack({ error: 'Invalid bible' });
    setBible(currentRoom, bible);
    io.to(currentRoom).emit('bible_done', { bible });
    ack && ack({ ok: true });
  });

  socket.on('get_log', (_, ack) => {
    if (!currentRoom) return ack && ack({ error: 'Not in a room' });
    const entries = getLog(currentRoom);
    ack && ack({ ok: true, entries });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    const char = room?.players.get(socket.id);
    const result = leaveRoom(currentRoom, socket.id);
    if (char) {
      const msg = result?.softDisconnect
        ? `${char.name} disconnected — they may rejoin with the same name.`
        : `${char.name} has left the party.`;
      chatLog(currentRoom, { type: 'system', text: msg });
      io.to(currentRoom).emit('room_update', getRoomSnapshot(currentRoom));
      // If a soft-disconnect happened during the disconnected player's turn,
      // the loop must auto-skip them now.
      if (result?.softDisconnect) scheduleNextTurn(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DynamicDND running on http://localhost:${PORT}`));
