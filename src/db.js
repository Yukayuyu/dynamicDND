const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

const upsertRoom = db.prepare(`
  INSERT INTO rooms (id, phase, current_turn, turn_order, initiatives, npcs, history, world, language, updated_at)
  VALUES (@id, @phase, @current_turn, @turn_order, @initiatives, @npcs, @history, @world, @language, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    phase = excluded.phase,
    current_turn = excluded.current_turn,
    turn_order = excluded.turn_order,
    initiatives = excluded.initiatives,
    npcs = excluded.npcs,
    history = excluded.history,
    world = excluded.world,
    language = excluded.language,
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
  INSERT INTO personas (id, name, race, char_class, icon, personality, speech, goals, quirks, created_at)
  VALUES (@id, @name, @race, @char_class, @icon, @personality, @speech, @goals, @quirks, @created_at)
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
    createdAt: r.created_at,
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
    created_at: Math.floor(Date.now() / 1000),
  });
  return rowToPersona(selectPersona.get(p.id));
}
function getPersona(id)    { return rowToPersona(selectPersona.get(id)); }
function listPersonas()    { return selectPersonas.all().map(rowToPersona); }
function deletePersona(id) { removePersona.run(id); }

module.exports = {
  saveRoom, loadRoom, removePlayer, removeRoom, appendLog, getLog,
  savePersona, getPersona, listPersonas, deletePersona,
};
