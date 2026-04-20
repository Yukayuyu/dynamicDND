const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'campaigns.db'));

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

const upsertRoom = db.prepare(`
  INSERT INTO rooms (id, phase, current_turn, turn_order, initiatives, npcs, history, world, updated_at)
  VALUES (@id, @phase, @current_turn, @turn_order, @initiatives, @npcs, @history, @world, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    phase = excluded.phase,
    current_turn = excluded.current_turn,
    turn_order = excluded.turn_order,
    initiatives = excluded.initiatives,
    npcs = excluded.npcs,
    history = excluded.history,
    world = excluded.world,
    updated_at = excluded.updated_at
`);

const upsertPlayer = db.prepare(`
  INSERT INTO players (room_id, player_key, data)
  VALUES (@room_id, @player_key, @data)
  ON CONFLICT(room_id, player_key) DO UPDATE SET data = excluded.data
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
    updated_at: Math.floor(Date.now() / 1000),
  });
  for (const [, char] of playerMap) {
    upsertPlayer.run({
      room_id: room.id,
      player_key: char.name.toLowerCase(),
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

module.exports = { saveRoom, loadRoom, removePlayer, removeRoom };
