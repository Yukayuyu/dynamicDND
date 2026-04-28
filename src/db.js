const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Use DATABASE_PATH env var if set (e.g. Railway volume at /data),
// otherwise fall back to the project root for local dev.
const dbDir = process.env.DATABASE_PATH || path.join(__dirname, '..');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'campaigns.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    phase TEXT NOT NULL DEFAULT 'lobby',
    current_turn INTEGER NOT NULL DEFAULT 0,
    turn_order TEXT NOT NULL DEFAULT '[]',
    initiatives TEXT NOT NULL DEFAULT '[]',
    npcs TEXT NOT NULL DEFAULT '[]',
    history TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS players (
    room_id TEXT NOT NULL,
    player_key TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (room_id, player_key)
  );
`);

// Migrate: add world column if it doesn't exist yet
try { db.exec(`ALTER TABLE rooms ADD COLUMN world TEXT`); } catch (_) {}
// Migrate: add language column (default 'en')
try { db.exec(`ALTER TABLE rooms ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`); } catch (_) {}

// Session log — persistent record of every game event (separate from AI history)
db.exec(`
  CREATE TABLE IF NOT EXISTS room_logs (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    ts    INTEGER NOT NULL DEFAULT (unixepoch()),
    type  TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'System',
    text  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_room_logs ON room_logs(room_id, id);
`);

// Persona library — reusable AI character definitions
db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    race        TEXT NOT NULL DEFAULT 'Human',
    char_class  TEXT NOT NULL DEFAULT 'Fighter',
    icon        TEXT NOT NULL DEFAULT '🧙',
    personality TEXT NOT NULL DEFAULT '',
    speech      TEXT NOT NULL DEFAULT '',
    goals       TEXT NOT NULL DEFAULT '',
    quirks      TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Users (lightweight: username + PIN). OAuth can be layered on later.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pin_hash    TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);
// Migrations: add owner_id to rooms and personas (NULL = unowned).
try { db.exec(`ALTER TABLE rooms ADD COLUMN owner_id TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE personas ADD COLUMN owner_id TEXT`); } catch (_) {}

const upsertRoom = db.prepare(`
  INSERT INTO rooms (id, phase, current_turn, turn_order, initiatives, npcs, history, world, language, owner_id, updated_at)
  VALUES (@id, @phase, @current_turn, @turn_order, @initiatives, @npcs, @history, @world, @language, @owner_id, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    phase = excluded.phase,
    current_turn = excluded.current_turn,
    turn_order = excluded.turn_order,
    initiatives = excluded.initiatives,
    npcs = excluded.npcs,
    history = excluded.history,
    world = excluded.world,
    language = excluded.language,
    owner_id = COALESCE(rooms.owner_id, excluded.owner_id),
    updated_at = excluded.updated_at
`);

const upsertPlayer = db.prepare(`
  INSERT INTO players (room_id, player_key, data)
  VALUES (@room_id, @player_key, @data)
  ON CONFLICT(room_id, player_key) DO UPDATE SET data = excluded.data
`);

const insertLog = db.prepare(`
  INSERT INTO room_logs (room_id, ts, type, actor, text)
  VALUES (@room_id, @ts, @type, @actor, @text)
`);
const selectLog = db.prepare(`
  SELECT id, ts, type, actor, text FROM room_logs WHERE room_id = ? ORDER BY id ASC
`);

const deletePlayer = db.prepare(`DELETE FROM players WHERE room_id = @room_id AND player_key = @player_key`);
const getRoom = db.prepare(`SELECT * FROM rooms WHERE id = ?`);
const getPlayers = db.prepare(`SELECT * FROM players WHERE room_id = ?`);
const deleteRoom = db.prepare(`DELETE FROM rooms WHERE id = ?`);
const deleteRoomPlayers = db.prepare(`DELETE FROM players WHERE room_id = ?`);

function saveRoom(room) {
  const playerMap = room.players;
  upsertRoom.run({
    id: room.id,
    phase: room.phase,
    current_turn: room.currentTurn,
    turn_order: JSON.stringify(room.turnOrder),
    initiatives: JSON.stringify(room.initiatives),
    npcs: JSON.stringify(room.npcs),
    history: JSON.stringify(room.history),
    world: room.world ? JSON.stringify(room.world) : null,
    language: room.language || 'en',
    owner_id: room.ownerId || null,
    updated_at: Math.floor(Date.now() / 1000),
  });
  for (const [mapKey, char] of playerMap) {
    // AI players: preserve their ai_<id> key so turnOrder stays consistent across restarts.
    // Humans: key by name (lowercase) so reconnect-by-name still works.
    const player_key = char.isAi ? String(mapKey) : char.name.toLowerCase();
    upsertPlayer.run({
      room_id: room.id,
      player_key,
      data: JSON.stringify(char),
    });
  }
}

function loadRoom(roomId) {
  const row = getRoom.get(roomId);
  if (!row) return null;
  const playerRows = getPlayers.all(roomId);
  return {
    id: row.id,
    phase: row.phase,
    currentTurn: row.current_turn,
    turnOrder: JSON.parse(row.turn_order),
    initiatives: JSON.parse(row.initiatives),
    npcs: JSON.parse(row.npcs),
    history: JSON.parse(row.history),
    world: row.world ? JSON.parse(row.world) : null,
    language: row.language || 'en',
    ownerId: row.owner_id || null,
    players: new Map(playerRows.map(r => [r.player_key, JSON.parse(r.data)])),
  };
}

function removePlayer(roomId, playerKey) {
  deletePlayer.run({ room_id: roomId, player_key: playerKey });
}

function removeRoom(roomId) {
  deleteRoom.run(roomId);
  deleteRoomPlayers.run(roomId);
}

function appendLog(roomId, type, actor, text) {
  try {
    insertLog.run({
      room_id: roomId,
      ts: Math.floor(Date.now() / 1000),
      type,
      actor: actor || 'System',
      text: String(text || ''),
    });
  } catch (_) {}
}

function getLog(roomId) {
  return selectLog.all(roomId);
}

/* ─────────── Persona library ─────────── */
const insertPersona = db.prepare(`
  INSERT INTO personas (id, name, race, char_class, icon, personality, speech, goals, quirks, owner_id, created_at)
  VALUES (@id, @name, @race, @char_class, @icon, @personality, @speech, @goals, @quirks, @owner_id, @created_at)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    race = excluded.race,
    char_class = excluded.char_class,
    icon = excluded.icon,
    personality = excluded.personality,
    speech = excluded.speech,
    goals = excluded.goals,
    quirks = excluded.quirks
`);
const selectPersona = db.prepare(`SELECT * FROM personas WHERE id = ?`);
const selectPersonas = db.prepare(`SELECT * FROM personas ORDER BY created_at DESC`);
const removePersona = db.prepare(`DELETE FROM personas WHERE id = ?`);

function rowToPersona(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, race: r.race, class: r.char_class, icon: r.icon,
    personality: r.personality, speech: r.speech, goals: r.goals, quirks: r.quirks,
    ownerId: r.owner_id || null, createdAt: r.created_at,
  };
}

function savePersona(p) {
  insertPersona.run({
    id: p.id,
    name: p.name,
    race: p.race || 'Human',
    char_class: p.class || 'Fighter',
    icon: p.icon || '🧙',
    personality: p.personality || '',
    speech: p.speech || '',
    goals: p.goals || '',
    quirks: p.quirks || '',
    owner_id: p.ownerId || null,
    created_at: Math.floor(Date.now() / 1000),
  });
  return rowToPersona(selectPersona.get(p.id));
}
function getPersona(id)    { return rowToPersona(selectPersona.get(id)); }
function listPersonas(ownerId) {
  if (ownerId) {
    return db.prepare(`SELECT * FROM personas WHERE owner_id = ? OR owner_id IS NULL ORDER BY created_at DESC`).all(ownerId).map(rowToPersona);
  }
  return selectPersonas.all().map(rowToPersona);
}
function deletePersona(id) { removePersona.run(id); }

/* ─────────── Auth (username + PIN) ─────────── */
const insertUser    = db.prepare(`INSERT INTO users (id, username, pin_hash, created_at) VALUES (?, ?, ?, ?)`);
const selectUserByName = db.prepare(`SELECT * FROM users WHERE username = ?`);
const selectUserById   = db.prepare(`SELECT * FROM users WHERE id = ?`);
const insertSession    = db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`);
const selectSession    = db.prepare(`SELECT * FROM sessions WHERE token = ?`);
const deleteSession    = db.prepare(`DELETE FROM sessions WHERE token = ?`);
const cleanupSessions  = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pin), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createUser(username, pin) {
  if (!username || username.length < 2 || username.length > 24) {
    return { error: 'Username must be 2–24 characters.' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { error: 'Username can only contain letters, digits, underscore, and hyphen.' };
  }
  if (!pin || !/^\d{4,6}$/.test(String(pin))) {
    return { error: 'PIN must be 4–6 digits.' };
  }
  if (selectUserByName.get(username)) {
    return { error: 'That username is taken.' };
  }
  const id = `u_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  insertUser.run(id, username, hashPin(pin), Math.floor(Date.now() / 1000));
  return { ok: true, user: { id, username } };
}

function authenticate(username, pin) {
  const row = selectUserByName.get(username);
  if (!row) return { error: 'No such user.' };
  if (!verifyPin(pin, row.pin_hash)) return { error: 'Wrong PIN.' };
  return { ok: true, user: { id: row.id, username: row.username } };
}

const SESSION_TTL_S = 30 * 24 * 60 * 60;
function startSession(userId) {
  cleanupSessions.run(Math.floor(Date.now() / 1000));
  const token = crypto.randomBytes(32).toString('hex');
  insertSession.run(token, userId, Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return token;
}
function resumeSession(token) {
  if (!token) return null;
  const row = selectSession.get(token);
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    deleteSession.run(token);
    return null;
  }
  const user = selectUserById.get(row.user_id);
  return user ? { id: user.id, username: user.username } : null;
}
function endSession(token) { if (token) deleteSession.run(token); }

/* ─────────── My Library queries ─────────── */
const selectMyRooms = db.prepare(`
  SELECT id, phase, world, language, updated_at
  FROM rooms
  WHERE owner_id = ?
  ORDER BY updated_at DESC
  LIMIT 50
`);

function listMyRooms(ownerId) {
  if (!ownerId) return [];
  return selectMyRooms.all(ownerId).map(r => {
    let worldName = null;
    let hasBible = false;
    if (r.world) {
      try {
        const w = JSON.parse(r.world);
        worldName = w._name || null;
        hasBible = !!w.bible;
      } catch (_) {}
    }
    return {
      id: r.id,
      phase: r.phase,
      worldName,
      hasBible,
      language: r.language || 'en',
      updatedAt: r.updated_at,
    };
  });
}

// "My worlds" = the most recent confirmed-world per owned room. Worlds today
// live inline on rooms.world; this surface lets users reuse a world from any
// of their past rooms.
function listMyWorlds(ownerId) {
  if (!ownerId) return [];
  return selectMyRooms.all(ownerId).map(r => {
    if (!r.world) return null;
    try {
      const w = JSON.parse(r.world);
      if (!w._name && !w.name_tone) return null;
      return {
        roomId: r.id,
        name: w._name || 'Untitled World',
        hasBible: !!w.bible,
        updatedAt: r.updated_at,
        world: w,
      };
    } catch (_) { return null; }
  }).filter(Boolean);
}

module.exports = {
  saveRoom, loadRoom, removePlayer, removeRoom, appendLog, getLog,
  savePersona, getPersona, listPersonas, deletePersona,
  createUser, authenticate, startSession, resumeSession, endSession,
  listMyRooms, listMyWorlds,
};
