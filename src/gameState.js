const { rollDice } = require('./dice');

const CLASSES = {
  Fighter:  { hp: 12, str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8  },
  Wizard:   { hp: 6,  str: 8,  dex: 14, con: 10, int: 17, wis: 13, cha: 11 },
  Rogue:    { hp: 8,  str: 10, dex: 17, con: 12, int: 12, wis: 11, cha: 14 },
  Cleric:   { hp: 8,  str: 12, dex: 10, con: 14, int: 12, wis: 17, cha: 13 },
  Ranger:   { hp: 10, str: 13, dex: 16, con: 12, int: 11, wis: 14, cha: 10 },
  Barbarian:{ hp: 12, str: 17, dex: 13, con: 15, int: 8,  wis: 10, cha: 9  },
};

const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      players: new Map(),   // socketId -> character
      history: [],           // { role, content }
      phase: 'lobby',        // lobby | adventure
      turnOrder: [],
      currentTurn: 0,
    });
  }
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  rooms.delete(roomId);
}

function joinRoom(roomId, socketId, name, charClass) {
  const room = getOrCreateRoom(roomId);
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.has(socketId)) return { error: 'Already in room' };

  const base = CLASSES[charClass];
  if (!base) return { error: 'Unknown class' };

  const character = {
    name,
    class: charClass,
    maxHp: base.hp,
    hp: base.hp,
    stats: { str: base.str, dex: base.dex, con: base.con, int: base.int, wis: base.wis, cha: base.cha },
    conditions: [],
    inventory: [],
  };

  room.players.set(socketId, character);
  return { ok: true, character };
}

function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.delete(socketId);
  room.turnOrder = room.turnOrder.filter(id => id !== socketId);
  if (room.players.size === 0) deleteRoom(roomId);
}

function startAdventure(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'lobby') return { error: 'Cannot start' };
  if (room.players.size === 0) return { error: 'No players' };

  // Roll initiative for turn order
  const initiatives = [];
  for (const [socketId, char] of room.players) {
    const mod = Math.floor((char.stats.dex - 10) / 2);
    const init = rollDice('1d20').total + mod;
    initiatives.push({ socketId, name: char.name, init });
  }
  initiatives.sort((a, b) => b.init - a.init);
  room.turnOrder = initiatives.map(i => i.socketId);
  room.currentTurn = 0;
  room.phase = 'adventure';

  return { ok: true, initiatives };
}

function currentTurnPlayerId(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.turnOrder.length === 0) return null;
  return room.turnOrder[room.currentTurn % room.turnOrder.length];
}

function advanceTurn(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.currentTurn = (room.currentTurn + 1) % room.turnOrder.length;
  return room.turnOrder[room.currentTurn];
}

function applyDamage(roomId, targetName, amount) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      char.hp = Math.max(0, char.hp - amount);
      return char;
    }
  }
  return null;
}

function applyHeal(roomId, targetName, amount) {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const char of room.players.values()) {
    if (char.name.toLowerCase() === targetName.toLowerCase()) {
      char.hp = Math.min(char.maxHp, char.hp + amount);
      return char;
    }
  }
  return null;
}

function appendHistory(roomId, role, content) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.history.push({ role, content });
  // Keep last 60 messages for context window management
  if (room.history.length > 60) room.history.splice(0, room.history.length - 60);
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

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
    currentTurnSocketId: currentTurnPlayerId(roomId),
  };
}

module.exports = {
  CLASSES,
  getOrCreateRoom,
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
};
