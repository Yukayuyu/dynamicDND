const { rollDice } = require('./dice');
const { saveRoom, loadRoom, removePlayer, removeRoom } = require('./db');

const CLASSES = {
  Fighter:   { hp: 12, str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8,  spellSlots: null, hitDie: 10 },
  Wizard:    { hp: 6,  str: 8,  dex: 14, con: 10, int: 17, wis: 13, cha: 11, spellSlots: { 1: 4, 2: 3, 3: 2 }, hitDie: 6 },
  Rogue:     { hp: 8,  str: 10, dex: 17, con: 12, int: 12, wis: 11, cha: 14, spellSlots: null, hitDie: 8 },
  Cleric:    { hp: 8,  str: 12, dex: 10, con: 14, int: 12, wis: 17, cha: 13, spellSlots: { 1: 4, 2: 3, 3: 2 }, hitDie: 8 },
  Ranger:    { hp: 10, str: 13, dex: 16, con: 12, int: 11, wis: 14, cha: 10, spellSlots: { 1: 2 }, hitDie: 10 },
  Barbarian: { hp: 12, str: 17, dex: 13, con: 15, int: 8,  wis: 10, cha: 9,  spellSlots: null, hitDie: 12 },
};

// 5e SRD-style backgrounds — each grants 2 skill proficiencies.
const BACKGROUNDS = {
  Acolyte:        { skills: ['Insight', 'Religion'],          flavor: 'Served in a temple; trained in faith and ritual.' },
  Criminal:       { skills: ['Deception', 'Stealth'],         flavor: 'A life in the underworld taught you to slip notice.' },
  'Folk Hero':    { skills: ['Animal Handling', 'Survival'],  flavor: 'A common-born hero who stood up to tyranny.' },
  Noble:          { skills: ['History', 'Persuasion'],        flavor: 'Born to privilege; expected to lead.' },
  Sage:           { skills: ['Arcana', 'History'],            flavor: 'A scholar who chases forbidden lore.' },
  Soldier:        { skills: ['Athletics', 'Intimidation'],    flavor: 'Veteran of a war you cannot forget.' },
  Outlander:      { skills: ['Athletics', 'Survival'],        flavor: 'Raised at the edges of civilization.' },
  Charlatan:      { skills: ['Deception', 'Sleight of Hand'], flavor: 'You make a living by tricking people.' },
};

const ALIGNMENTS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil',
];

const LANGUAGES = [
  { code: 'en',    name: 'English',                 label: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)',    label: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)',   label: '繁體中文' },
  { code: 'ja',    name: 'Japanese',                label: '日本語' },
  { code: 'ko',    name: 'Korean',                  label: '한국어' },
  { code: 'es',    name: 'Spanish',                 label: 'Español' },
  { code: 'fr',    name: 'French',                  label: 'Français' },
  { code: 'de',    name: 'German',                  label: 'Deutsch' },
  { code: 'pt',    name: 'Portuguese',              label: 'Português' },
  { code: 'it',    name: 'Italian',                 label: 'Italiano' },
  { code: 'ru',    name: 'Russian',                 label: 'Русский' },
];
const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    const saved = loadRoom(roomId);
    if (saved) {
      if (saved.paused === undefined) saved.paused = false;
      if (!saved.language) saved.language = 'en';
      rooms.set(roomId, saved);
    } else {
      rooms.set(roomId, {
        id: roomId,
        players: new Map(),
        history: [],
        phase: 'lobby',
        turnOrder: [],
        currentTurn: 0,
        initiatives: [],
        npcs: [],
        world: null,
        paused: false,
        language: 'en',
      });
    }
  }
  return rooms.get(roomId);
}

function hasHuman(room) {
  for (const c of room.players.values()) if (!c.isAi) return true;
  return false;
}

// Does any character in the room have a *currently actionable* turn?
// AI players: always actionable (their action is server-generated).
// Humans: actionable only if connected.
// Dead/Downed: not actionable.
function hasAnyActor(room) {
  for (const c of room.players.values()) {
    const downed = c.hp <= 0 || (c.conditions || []).includes('Dead');
    if (downed) continue;
    if (c.isAi) return true;
    if (!c.disconnected) return true;
  }
  return false;
}

function persist(roomId) {
  const room = rooms.get(roomId);
  if (room) saveRoom(room);
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
  removeRoom(roomId);
}

function joinRoom(roomId, socketId, name, charClass, race, extras = {}) {
  const room = getOrCreateRoom(roomId);
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.has(socketId)) return { error: 'Already in room' };

  // Reconnect: if a player with the same name exists (perhaps soft-disconnected),
  // rebind them to the new socketId. Also re-key turnOrder/initiatives so the state
  // stays consistent. Clears the `disconnected` flag.
  for (const [existingKey, char] of room.players) {
    if (!char.isAi && char.name.toLowerCase() === name.toLowerCase()) {
      room.players.delete(existingKey);
      char.disconnected = false;
      char.skipLogged = false;
      room.players.set(socketId, char);
      const oi = room.turnOrder.indexOf(existingKey);
      if (oi !== -1) room.turnOrder[oi] = socketId;
      const ini = room.initiatives.find(i => i.socketId === existingKey);
      if (ini) ini.socketId = socketId;
      persist(roomId);
      return { ok: true, character: char };
    }
  }

  const base = CLASSES[charClass];
  if (!base) return { error: 'Unknown class' };

  // Custom abilities override class defaults; otherwise use the class template.
  const stats = extras.abilities && typeof extras.abilities === 'object'
    ? {
        str: clamp(extras.abilities.str, 3, 20, base.str),
        dex: clamp(extras.abilities.dex, 3, 20, base.dex),
        con: clamp(extras.abilities.con, 3, 20, base.con),
        int: clamp(extras.abilities.int, 3, 20, base.int),
        wis: clamp(extras.abilities.wis, 3, 20, base.wis),
        cha: clamp(extras.abilities.cha, 3, 20, base.cha),
      }
    : { str: base.str, dex: base.dex, con: base.con, int: base.int, wis: base.wis, cha: base.cha };

  // CON-derived HP: max-roll at level 1 + CON modifier (5e RAW).
  const conMod = Math.floor((stats.con - 10) / 2);
  const maxHp = Math.max(1, base.hp + conMod);

  // Background grants 2 skill proficiencies (5e SRD).
  const bgKey = extras.background && BACKGROUNDS[extras.background] ? extras.background : null;
  const proficiencies = bgKey ? [...BACKGROUNDS[bgKey].skills] : [];

  const alignment = ALIGNMENTS.includes(extras.alignment) ? extras.alignment : 'True Neutral';

  const character = {
    name,
    class: charClass,
    race: race || null,
    portrait: typeof extras.portrait === 'string' && extras.portrait.length <= 4 ? extras.portrait : '🧝',
    background: bgKey,
    alignment,
    maxHp,
    hp: maxHp,
    stats,
    proficiencies,
    conditions: [],
    inventory: [],
    spellSlots: base.spellSlots ? { ...base.spellSlots } : null,
    maxSpellSlots: base.spellSlots ? { ...base.spellSlots } : null,
    gold: 10,
    hitDie: base.hitDie,
    hitDice: 1,
    maxHitDice: 1,
    deathSaves: { successes: 0, failures: 0 },
  };

  room.players.set(socketId, character);
  persist(roomId);
  return { ok: true, character };
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const char = room.players.get(socketId);

  // Humans are NEVER hard-removed on socket disconnect — in lobby OR adventure phase.
  // Their character + turn slot are preserved so they can rejoin by entering the same
  // room+name. This prevents "cannot find room" when a player refreshes or briefly
  // loses connection. Cleanup of stale disconnected players is intentionally manual
  // (no TTL in v1 — explicit "leave" action would be added separately if needed).
  if (char && !char.isAi) {
    char.disconnected = true;
    char.skipLogged = false;
    persist(roomId);
    return { softDisconnect: true, char };
  }

  // No character bound to this socket (host-only or spectator). Just exit.
  // Don't delete the room — it likely has a world / AI players / saved state worth keeping.
  return { softDisconnect: false, char: null };
}

// Rebind a previously-disconnected character to a new socket. Returns
// {ok, character} or {error}. Allowed in any room phase.
function reconnectPlayer(roomId, newSocketId, name) {
  const room = rooms.get(roomId) || getOrCreateRoom(roomId);
  if (!room) return { error: 'Room not found' };
  for (const [oldKey, char] of room.players) {
    if (!char.isAi && char.name.toLowerCase() === name.toLowerCase()) {
      // Already bound to this socket? No-op.
      if (oldKey === newSocketId) {
        char.disconnected = false;
        char.skipLogged = false;
        persist(roomId);
        return { ok: true, character: char };
      }
      room.players.delete(oldKey);
      char.disconnected = false;
      char.skipLogged = false;
      room.players.set(newSocketId, char);
      const orderIdx = room.turnOrder.indexOf(oldKey);
      if (orderIdx !== -1) room.turnOrder[orderIdx] = newSocketId;
      const ini = room.initiatives.find(i => i.socketId === oldKey);
      if (ini) ini.socketId = newSocketId;
      persist(roomId);
      return { ok: true, character: char };
    }
  }
  return { error: 'No player by that name in this room' };
}

let _aiSeq = 0;
function addAiPlayer(roomId, persona) {
  const room = getOrCreateRoom(roomId);
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  const charClass = CLASSES[persona.class] ? persona.class : 'Fighter';
  const base = CLASSES[charClass];
  const aiId = `ai_${Date.now().toString(36)}_${(++_aiSeq).toString(36)}`;
  const character = {
    name: persona.name || 'Nameless',
    class: charClass,
    race: persona.race || 'Human',
    maxHp: base.hp,
    hp: base.hp,
    stats: { str: base.str, dex: base.dex, con: base.con, int: base.int, wis: base.wis, cha: base.cha },
    conditions: [],
    inventory: [],
    spellSlots: base.spellSlots ? { ...base.spellSlots } : null,
    maxSpellSlots: base.spellSlots ? { ...base.spellSlots } : null,
    gold: 10,
    hitDie: base.hitDie,
    hitDice: 1,
    maxHitDice: 1,
    deathSaves: { successes: 0, failures: 0 },
    isAi: true,
    persona: {
      id: persona.id || null,
      icon: persona.icon || '🧙',
      personality: persona.personality || '',
      speech: persona.speech || '',
      goals: persona.goals || '',
      quirks: persona.quirks || '',
    },
  };
  room.players.set(aiId, character);
  persist(roomId);
  return { ok: true, aiId, character };
}

function removeAiPlayer(roomId, aiId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(aiId);
  if (!char || !char.isAi) return null;
  room.players.delete(aiId);
  room.turnOrder = room.turnOrder.filter(id => id !== aiId);
  room.initiatives = room.initiatives.filter(i => i.socketId !== aiId);
  removePlayer(roomId, char.name.toLowerCase());
  persist(roomId);
  return char;
}

function setPaused(roomId, paused) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.paused = !!paused;
  persist(roomId);
  return room.paused;
}

function setLanguage(roomId, code) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.language = LANGUAGE_BY_CODE[code] ? code : 'en';
  persist(roomId);
  return room.language;
}

function currentTurnCharacter(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const id = room.turnOrder[room.currentTurn % room.turnOrder.length];
  return room.players.get(id) || null;
}

function startAdventure(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'lobby') return { error: 'Cannot start' };
  if (room.players.size === 0) return { error: 'No players' };

  const initiatives = [];
  for (const [socketId, char] of room.players) {
    const mod = Math.floor((char.stats.dex - 10) / 2);
    const init = rollDice('1d20').total + mod;
    initiatives.push({ socketId, name: char.name, init });
  }
  initiatives.sort((a, b) => b.init - a.init);
  room.initiatives = initiatives;
  room.turnOrder = initiatives.map(i => i.socketId);
  room.currentTurn = 0;
  room.phase = 'adventure';
  persist(roomId);
  return { ok: true, initiatives };
}

function currentTurnPlayerId(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.turnOrder.length === 0) return null;
  return room.turnOrder[room.currentTurn % room.turnOrder.length];
}

function advanceTurn(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.currentTurn = (room.currentTurn + 1) % room.turnOrder.length;
  return room.turnOrder[room.currentTurn];
}

function applyDamage(roomId, targetName, amount) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      const prev = char.hp;
      char.hp = Math.max(0, char.hp - amount);
      if (char.hp === 0) char.deathSaves = char.deathSaves || { successes: 0, failures: 0 };
      persist(roomId);
      return { char, prev };
    }
  }
  return null;
}

function applyHeal(roomId, targetName, amount) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      const prev = char.hp;
      char.hp = Math.min(char.maxHp, char.hp + amount);
      if (char.hp > 0) char.deathSaves = { successes: 0, failures: 0 };
      persist(roomId);
      return { char, prev };
    }
  }
  return null;
}

function addCondition(roomId, targetName, condition) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      if (!char.conditions.includes(condition)) char.conditions.push(condition);
      persist(roomId);
      return char;
    }
  }
  return null;
}

function removeCondition(roomId, targetName, condition) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      char.conditions = char.conditions.filter(c => c !== condition);
      persist(roomId);
      return char;
    }
  }
  return null;
}

function addInventoryItem(roomId, socketId, item) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char) return null;
  char.inventory.push(item);
  persist(roomId);
  return char;
}

function removeInventoryItem(roomId, socketId, index) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char || index < 0 || index >= char.inventory.length) return null;
  char.inventory.splice(index, 1);
  persist(roomId);
  return char;
}

function useSpellSlot(roomId, socketId, level) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char || !char.spellSlots || !char.spellSlots[level]) return null;
  char.spellSlots[level]--;
  persist(roomId);
  return char;
}

function longRest(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char) return null;
  char.hp = char.maxHp;
  if (char.maxSpellSlots) char.spellSlots = { ...char.maxSpellSlots };
  char.conditions = [];
  char.hitDice = char.maxHitDice || 1;
  char.deathSaves = { successes: 0, failures: 0 };
  persist(roomId);
  return char;
}

function shortRest(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char) return null;
  const hitDice = char.hitDice || 0;
  if (hitDice <= 0) return { error: 'No hit dice remaining' };
  const hitDie = char.hitDie || 8;
  const conMod = Math.floor(((char.stats?.con || 10) - 10) / 2);
  const roll = rollDice(`1d${hitDie}`).total;
  const heal = Math.max(1, roll + conMod);
  const prev = char.hp;
  char.hp = Math.min(char.maxHp, char.hp + heal);
  char.hitDice = hitDice - 1;
  persist(roomId);
  return { char, prev, roll, heal, hitDie, conMod };
}

function rollDeathSave(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const char = room.players.get(socketId);
  if (!char || char.hp > 0) return null;

  char.deathSaves = char.deathSaves || { successes: 0, failures: 0 };
  const roll = rollDice('1d20').total;
  let outcome = null;

  if (roll === 20) {
    char.hp = 1;
    char.deathSaves = { successes: 0, failures: 0 };
    char.conditions = char.conditions.filter(c => c !== 'Stable' && c !== 'Dead');
    outcome = 'miraculous';
  } else if (roll === 1) {
    char.deathSaves.failures = Math.min(3, char.deathSaves.failures + 2);
    if (char.deathSaves.failures >= 3) {
      outcome = 'dead';
      if (!char.conditions.includes('Dead')) char.conditions.push('Dead');
    }
  } else if (roll >= 10) {
    char.deathSaves.successes = Math.min(3, char.deathSaves.successes + 1);
    if (char.deathSaves.successes >= 3) {
      outcome = 'stable';
      char.deathSaves = { successes: 0, failures: 0 };
      if (!char.conditions.includes('Stable')) char.conditions.push('Stable');
    }
  } else {
    char.deathSaves.failures = Math.min(3, char.deathSaves.failures + 1);
    if (char.deathSaves.failures >= 3) {
      outcome = 'dead';
      if (!char.conditions.includes('Dead')) char.conditions.push('Dead');
    }
  }

  persist(roomId);
  return { char, roll, outcome, deathSaves: { ...char.deathSaves } };
}

function setWorld(roomId, worldData) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.world = worldData;
  persist(roomId);
  return worldData;
}

function setBible(roomId, bible) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (!room.world) room.world = {};
  room.world.bible = bible;
  persist(roomId);
  return bible;
}

function addNpc(roomId, npc) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.npcs.push({ id: Date.now(), ...npc });
  persist(roomId);
  return room.npcs;
}

function appendHistory(roomId, role, content) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.history.push({ role, content });
  if (room.history.length > 60) room.history.splice(0, room.history.length - 60);
  persist(roomId);
}

function getRoom(roomId) { return rooms.get(roomId) || null; }

function getRoomSnapshot(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const players = [];
  for (const [socketId, char] of room.players) {
    players.push({ socketId, ...char });
  }
  return {
    id: room.id,
    phase: room.phase,
    players,
    initiatives: room.initiatives,
    currentTurnSocketId: currentTurnPlayerId(roomId),
    npcs: room.npcs,
    world: room.world || null,
    paused: !!room.paused,
    language: room.language || 'en',
  };
}

module.exports = {
  CLASSES,
  BACKGROUNDS,
  ALIGNMENTS,
  LANGUAGES,
  LANGUAGE_BY_CODE,
  setLanguage,
  getOrCreateRoom,
  persist,
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
  setBible,
  addNpc,
  appendHistory,
  getRoom,
  getRoomSnapshot,
  addAiPlayer,
  removeAiPlayer,
  setPaused,
  hasHuman,
  hasAnyActor,
  reconnectPlayer,
};
