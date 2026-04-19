/* ── State ── */
const socket = io();
let mySocketId = null;
let myChar = null;
let isMyTurn = false;
let dmStreamEl = null;

/* ── Screens ── */
const screens = {
  lobby:   document.getElementById('lobby'),
  waiting: document.getElementById('waiting'),
  game:    document.getElementById('game'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

/* ── Lobby ── */
document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId    = document.getElementById('roomId').value.trim();
  const name      = document.getElementById('playerName').value.trim();
  const charClass = document.getElementById('charClass').value;
  const errEl     = document.getElementById('lobbyError');

  if (!roomId || !name) { showError(errEl, 'Room code and name are required.'); return; }

  socket.emit('join_room', { roomId, name, charClass }, (res) => {
    if (res.error) { showError(errEl, res.error); return; }
    myChar = res.character;
    document.getElementById('waitRoomId').textContent = roomId;
    showScreen('waiting');
  });
});

/* ── Waiting room ── */
document.getElementById('startBtn').addEventListener('click', () => {
  const setting = document.getElementById('settingInput').value.trim();
  const errEl   = document.getElementById('waitError');
  document.getElementById('startBtn').disabled = true;

  socket.emit('start_game', { setting }, (res) => {
    document.getElementById('startBtn').disabled = false;
    if (res.error) { showError(errEl, res.error); return; }
  });
});

/* ── Action panel ── */
document.getElementById('rollBtn').addEventListener('click', () => {
  const notation = document.getElementById('diceInput').value.trim() || '1d20';
  socket.emit('roll_dice', { notation }, (res) => {
    if (res.error) appendChat({ type: 'system', text: `Dice error: ${res.error}` });
  });
});

document.getElementById('sendBtn').addEventListener('click', sendAction);
document.getElementById('actionInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAction(); }
});

function sendAction() {
  if (!isMyTurn) return;
  const action = document.getElementById('actionInput').value.trim();
  if (!action) return;
  document.getElementById('actionInput').value = '';
  document.getElementById('sendBtn').disabled = true;

  socket.emit('player_action', { action }, (res) => {
    document.getElementById('sendBtn').disabled = false;
    if (res.error) appendChat({ type: 'system', text: `Error: ${res.error}` });
  });
}

/* ── Socket events ── */
socket.on('connect', () => { mySocketId = socket.id; });

socket.on('room_update', (snapshot) => {
  renderPartyCards(snapshot.players);
  renderMyCard(snapshot);
  renderRoomInfo(snapshot);
});

socket.on('chat', (msg) => appendChat(msg));

socket.on('dm_start', () => {
  streamBuffer = '';
  dmStreamEl = createStreamingMsg();
});

socket.on('dm_chunk', ({ chunk }) => {
  if (dmStreamEl) appendChunk(dmStreamEl, chunk);
});

socket.on('dm_end', () => {
  if (dmStreamEl) {
    dmStreamEl.classList.remove('dm-streaming');
    dmStreamEl = null;
  }
});

socket.on('turn_prompt', ({ socketId }) => {
  isMyTurn = socketId === mySocketId;
  document.getElementById('actionArea').classList.toggle('hidden', !isMyTurn);
  document.getElementById('waitingTurn').classList.toggle('hidden', isMyTurn);

  if (!isMyTurn) {
    const room = getCurrentSnapshot();
    const player = room?.players.find(p => p.socketId === socketId);
    document.getElementById('waitingTurn').textContent =
      player ? `Waiting for ${player.name}'s turn...` : 'Waiting for another player...';
  }
});

/* ── Rendering ── */
let currentSnapshot = null;

function getCurrentSnapshot() { return currentSnapshot; }

function renderPartyCards(players) {
  currentSnapshot = { players };

  const container = document.getElementById('partyCards');
  container.innerHTML = '';
  players.forEach(p => container.appendChild(buildCharCard(p)));

  // Keep waiting room party list in sync
  const waitList = document.getElementById('partyList');
  waitList.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'char-card';
    div.innerHTML = `<div class="char-name">${escHtml(p.name)}</div><div class="char-class">${escHtml(p.class)}</div><div class="hp-label">HP ${p.hp}/${p.maxHp}</div>`;
    waitList.appendChild(div);
  });
}

function renderMyCard(snapshot) {
  const me = snapshot.players.find(p => p.socketId === mySocketId);
  if (!me) return;
  const container = document.getElementById('myCard');
  container.innerHTML = '';
  container.appendChild(buildCharCard(me, true));
}

function renderRoomInfo(snapshot) {
  const current = snapshot.players.find(p => p.socketId === snapshot.currentTurnSocketId);
  document.getElementById('roomInfo').innerHTML =
    `<strong>Phase:</strong> ${snapshot.phase}<br>` +
    `<strong>Players:</strong> ${snapshot.players.length}<br>` +
    (current ? `<strong>Current turn:</strong> ${current.name}` : '');
}

function buildCharCard(char, detailed = false) {
  const el = document.createElement('div');
  el.className = 'char-card';
  if (char.socketId === currentSnapshot?.players.find(
    p => p.socketId === (document.getElementById('roomInfo').innerHTML.match(/Current turn.*?<\/strong> (.+?)<br>/)?.[1])
  )?.socketId) el.classList.add('active-turn');
  if (char.hp === 0) el.classList.add('dead');

  const hpPct = Math.max(0, Math.min(100, (char.hp / char.maxHp) * 100));
  const hpClass = hpPct > 50 ? '' : hpPct > 20 ? 'low' : 'critical';

  let statsHtml = '';
  if (detailed && char.stats) {
    const entries = Object.entries(char.stats);
    statsHtml = `<div class="stat-grid">${entries.map(([k, v]) =>
      `<div class="stat-cell"><div class="stat-key">${k}</div><div class="stat-val">${v}</div></div>`
    ).join('')}</div>`;
  }

  el.innerHTML = `
    <div class="char-name">${escHtml(char.name)}</div>
    <div class="char-class">${escHtml(char.class)}</div>
    <div class="hp-bar-wrap"><div class="hp-bar ${hpClass}" style="width:${hpPct}%"></div></div>
    <div class="hp-label">HP ${char.hp}/${char.maxHp}</div>
    ${statsHtml}
  `;
  return el;
}

function appendChat(msg) {
  const log = document.getElementById('chatLog');

  if (msg.type === 'dm') {
    const el = document.createElement('div');
    el.className = 'msg msg-dm';
    el.innerHTML = `<div class="msg-header">🐉 Dungeon Master</div><div class="msg-text">${renderMarkdown(msg.text)}</div>`;
    log.appendChild(el);
  } else if (msg.type === 'player') {
    const el = document.createElement('div');
    el.className = 'msg msg-player';
    el.innerHTML = `<div class="msg-header">⚔️ ${escHtml(msg.name)}</div><div class="msg-text">${escHtml(msg.text)}</div>`;
    log.appendChild(el);
  } else if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.innerHTML = `<span class="msg-text">${escHtml(msg.text)}</span>`;
    log.appendChild(el);
  } else if (msg.type === 'roll') {
    const el = document.createElement('div');
    el.className = 'msg msg-roll';
    el.innerHTML = `<span class="msg-text">${renderMarkdown(msg.text)}</span>`;
    log.appendChild(el);
  }

  // Transition to game view only from the waiting room (not from lobby)
  if (screens.waiting.classList.contains('active')) {
    showScreen('game');
  }
  log.scrollTop = log.scrollHeight;
}

function createStreamingMsg() {
  const log = document.getElementById('chatLog');
  const el = document.createElement('div');
  el.className = 'msg msg-dm dm-streaming';
  el.innerHTML = `<div class="msg-header">🐉 Dungeon Master</div><div class="msg-text"></div>`;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

let streamBuffer = '';

function appendChunk(el, chunk) {
  streamBuffer += chunk;
  el.querySelector('.msg-text').innerHTML = renderMarkdown(streamBuffer);
  const log = document.getElementById('chatLog');
  log.scrollTop = log.scrollHeight;
}


/* ── Markdown mini-renderer ── */
function renderMarkdown(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
