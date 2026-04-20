/* ── Constants ── */
const SKILLS = [
  { name: 'Athletics',      stat: 'str' },
  { name: 'Acrobatics',     stat: 'dex' },
  { name: 'Sleight of Hand',stat: 'dex' },
  { name: 'Stealth',        stat: 'dex' },
  { name: 'Arcana',         stat: 'int' },
  { name: 'History',        stat: 'int' },
  { name: 'Investigation',  stat: 'int' },
  { name: 'Nature',         stat: 'int' },
  { name: 'Religion',       stat: 'int' },
  { name: 'Animal Handling',stat: 'wis' },
  { name: 'Insight',        stat: 'wis' },
  { name: 'Medicine',       stat: 'wis' },
  { name: 'Perception',     stat: 'wis' },
  { name: 'Survival',       stat: 'wis' },
  { name: 'Deception',      stat: 'cha' },
  { name: 'Intimidation',   stat: 'cha' },
  { name: 'Performance',    stat: 'cha' },
  { name: 'Persuasion',     stat: 'cha' },
];

/* ── State ── */
const socket = io();
let mySocketId = null;
let myChar = null;
let isMyTurn = false;
let dmStreamEl = null;
let streamBuffer = '';
let currentSnapshot = null;
let diceMode = 'normal'; // 'normal' | 'adv' | 'dis'

/* ── Screens ── */
const screens = {
  lobby:   document.getElementById('lobby'),
  waiting: document.getElementById('waiting'),
  game:    document.getElementById('game'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));
}

/* ── Tab switching ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

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

/* ── Advantage / Disadvantage toggle ── */
document.querySelectorAll('.adv-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.adv-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    diceMode = btn.dataset.mode;
  });
});

/* ── Dice roll ── */
document.getElementById('rollBtn').addEventListener('click', () => {
  const notation = document.getElementById('diceInput').value.trim() || '1d20';
  if (diceMode === 'normal') {
    socket.emit('roll_dice', { notation }, (res) => {
      if (res.error) appendChat({ type: 'system', text: `Dice error: ${res.error}` });
    });
  } else {
    // Roll twice, client picks higher (adv) or lower (dis), then emits a fixed roll
    socket.emit('roll_dice', { notation }, (res1) => {
      if (res1.error) { appendChat({ type: 'system', text: `Dice error: ${res1.error}` }); return; }
      socket.emit('roll_dice', { notation }, (res2) => {
        if (res2.error) { appendChat({ type: 'system', text: `Dice error: ${res2.error}` }); return; }
        const isAdv = diceMode === 'adv';
        const kept  = isAdv
          ? (res1.result.total >= res2.result.total ? res1.result : res2.result)
          : (res1.result.total <= res2.result.total ? res1.result : res2.result);
        const dropped = kept === res1.result ? res2.result : res1.result;
        const modeLabel = isAdv ? 'Advantage' : 'Disadvantage';
        const name = myChar ? myChar.name : 'You';
        appendChat({
          type: 'roll',
          text: `🎲 ${name} rolled ${notation} with **${modeLabel}**: [${kept.rolls.join(', ')}] = **${kept.total}** ~~(dropped: ${dropped.total})~~`,
        });
      });
    });
  }
});

/* ── Action tracker ── */
document.querySelectorAll('.tracker-btn').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('used'));
});

function resetActionTracker() {
  document.querySelectorAll('.tracker-btn').forEach(b => b.classList.remove('used'));
}

/* ── Player action ── */
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

/* ── Long rest ── */
document.getElementById('longRestBtn').addEventListener('click', () => {
  socket.emit('long_rest', {}, () => {});
});

/* ── Short rest ── */
document.getElementById('shortRestBtn').addEventListener('click', () => {
  const hd = myChar?.hitDice ?? 0;
  const die = myChar?.hitDie ?? 8;
  if (hd <= 0) { appendChat({ type: 'system', text: 'No hit dice remaining — take a long rest.' }); return; }
  if (!confirm(`Use a Hit Die (d${die}) for a short rest? ${hd} hit dice remaining.`)) return;
  socket.emit('short_rest', {}, (res) => {
    if (res?.error) appendChat({ type: 'system', text: `Short rest failed: ${res.error}` });
  });
});

/* ── Death save roll ── */
document.getElementById('rollDeathSaveBtn').addEventListener('click', () => {
  socket.emit('roll_death_save', {}, (res) => {
    if (res?.error) appendChat({ type: 'system', text: `Death save error: ${res.error}` });
  });
});

/* ── Inventory ── */
document.getElementById('addItemBtn').addEventListener('click', () => {
  document.getElementById('addItemForm').classList.toggle('hidden');
  document.getElementById('newItemInput').focus();
});

document.getElementById('confirmAddItem').addEventListener('click', () => {
  const item = document.getElementById('newItemInput').value.trim();
  if (!item) return;
  socket.emit('add_item', { item }, (res) => {
    if (!res?.error) {
      document.getElementById('newItemInput').value = '';
      document.getElementById('addItemForm').classList.add('hidden');
    }
  });
});

/* ── NPC form ── */
document.getElementById('addNpcBtn').addEventListener('click', () => {
  document.getElementById('addNpcForm').classList.toggle('hidden');
});

document.getElementById('confirmAddNpc').addEventListener('click', () => {
  const name        = document.getElementById('npcName').value.trim();
  const role        = document.getElementById('npcRole').value.trim();
  const disposition = document.getElementById('npcDisposition').value;
  const notes       = document.getElementById('npcNotes').value.trim();
  if (!name) return;
  socket.emit('add_npc', { npc: { name, role, disposition, notes } }, () => {
    document.getElementById('npcName').value = '';
    document.getElementById('npcRole').value = '';
    document.getElementById('npcNotes').value = '';
    document.getElementById('addNpcForm').classList.add('hidden');
  });
});

/* ── Socket events ── */
socket.on('connect', () => { mySocketId = socket.id; });

socket.on('room_update', (snapshot) => {
  currentSnapshot = snapshot;
  renderPartyCards(snapshot.players, snapshot.currentTurnSocketId);
  renderMyCard(snapshot);
  renderRoomInfo(snapshot);
  renderInitiativeStrip(snapshot);
  renderInventory(snapshot);
  renderNpcList(snapshot.npcs || []);
});

socket.on('chat', (msg) => appendChat(msg));

socket.on('dm_start', () => {
  streamBuffer = '';
  dmStreamEl = createStreamingMsg();
  document.getElementById('typingIndicator').classList.remove('hidden');
});

socket.on('dm_chunk', ({ chunk }) => {
  if (dmStreamEl) appendChunk(dmStreamEl, chunk);
});

socket.on('dm_end', ({ sceneImg } = {}) => {
  document.getElementById('typingIndicator').classList.add('hidden');
  if (dmStreamEl) {
    dmStreamEl.classList.remove('dm-streaming');
    if (sceneImg) attachSceneImg(dmStreamEl, sceneImg);
    dmStreamEl = null;
  }
});

socket.on('hp_change', ({ name, prev, current, type }) => {
  document.querySelectorAll('.char-card').forEach(card => {
    if (card.dataset.name === name) {
      card.classList.remove('flash-damage', 'flash-heal');
      void card.offsetWidth;
      card.classList.add(type === 'damage' ? 'flash-damage' : 'flash-heal');
    }
  });
});

socket.on('turn_prompt', ({ socketId }) => {
  isMyTurn = socketId === mySocketId;
  resetActionTracker();

  const me = currentSnapshot?.players.find(p => p.socketId === mySocketId);
  const atZeroHp = me && me.hp === 0;
  const resolved = me && (me.conditions?.includes('Stable') || me.conditions?.includes('Dead'));

  if (isMyTurn) {
    if (atZeroHp && !resolved) {
      // Show death save UI, hide normal action input
      document.getElementById('deathSaveAction').classList.remove('hidden');
      document.getElementById('actionInput').closest('.action-row').classList.add('hidden');
    } else {
      document.getElementById('deathSaveAction').classList.add('hidden');
      document.getElementById('actionInput').closest('.action-row').classList.remove('hidden');
    }
    document.getElementById('actionArea').classList.remove('hidden');
    document.getElementById('waitingTurn').classList.add('hidden');
  } else {
    document.getElementById('deathSaveAction').classList.add('hidden');
    document.getElementById('actionInput').closest('.action-row').classList.remove('hidden');
    document.getElementById('actionArea').classList.add('hidden');
    document.getElementById('waitingTurn').classList.remove('hidden');
    const player = currentSnapshot?.players.find(p => p.socketId === socketId);
    document.getElementById('waitingTurn').textContent =
      player ? `Waiting for ${player.name}'s turn...` : 'Waiting for another player...';
  }
});

socket.on('death_save_result', ({ socketId }) => {
  // Re-render my card to update death save pips
  if (socketId === mySocketId && currentSnapshot) {
    const me = currentSnapshot.players.find(p => p.socketId === mySocketId);
    if (me) renderDeathSavePanel(me);
  }
});

/* ── Initiative strip ── */
function renderInitiativeStrip(snapshot) {
  if (!snapshot.initiatives || snapshot.initiatives.length === 0) return;
  const strip = document.getElementById('initiativeStrip');
  const slots = document.getElementById('initSlots');
  strip.classList.remove('hidden');
  slots.innerHTML = '';

  snapshot.initiatives.forEach((item, idx) => {
    if (idx > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'init-arrow';
      arrow.textContent = '›';
      slots.appendChild(arrow);
    }
    const slot = document.createElement('div');
    slot.className = 'init-slot';
    if (item.socketId === snapshot.currentTurnSocketId) slot.classList.add('active-turn');
    slot.innerHTML = `${escHtml(item.name)}<span class="init-roll">${item.init}</span>`;
    slots.appendChild(slot);
  });
}

/* ── Party cards ── */
function renderPartyCards(players, currentTurnSocketId) {
  const container = document.getElementById('partyCards');
  container.innerHTML = '';
  players.forEach(p => container.appendChild(buildCharCard(p, false, currentTurnSocketId)));

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
  myChar = me;

  const container = document.getElementById('myCard');
  container.innerHTML = '';
  container.appendChild(buildCharCard(me, true, snapshot.currentTurnSocketId));

  renderSpellSlots(me);
  renderConditionsPanel(me);
  renderDeathSavePanel(me);
  renderSkillsPanel(me);

  const longRestBtn = document.getElementById('longRestBtn');
  const shortRestBtn = document.getElementById('shortRestBtn');
  if (snapshot.phase === 'adventure') {
    longRestBtn.classList.remove('hidden');
    shortRestBtn.classList.remove('hidden');
  } else {
    longRestBtn.classList.add('hidden');
    shortRestBtn.classList.add('hidden');
  }

  document.getElementById('goldDisplay').textContent = `💰 ${me.gold || 0} gp`;
}

function renderSpellSlots(char) {
  const panel = document.getElementById('spellSlots');
  if (!char.spellSlots) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  panel.innerHTML = '<h4>Spell Slots</h4>';
  for (const [level, remaining] of Object.entries(char.spellSlots)) {
    const max = char.maxSpellSlots[level];
    const row = document.createElement('div');
    row.className = 'spell-level-row';
    const pips = Array.from({ length: max }, (_, i) => {
      const pip = document.createElement('div');
      pip.className = `spell-pip${i >= remaining ? ' used' : ''}`;
      pip.title = `Use level ${level} slot`;
      pip.addEventListener('click', () => {
        if (i < remaining) socket.emit('use_spell_slot', { level: parseInt(level) });
      });
      return pip.outerHTML;
    }).join('');
    row.innerHTML = `<span class="spell-level-label">Lv ${level}</span><div class="spell-pips">${pips}</div>`;
    panel.appendChild(row);
  }
}

function renderConditionsPanel(char) {
  const panel = document.getElementById('conditionsPanel');
  if (!char.conditions || char.conditions.length === 0) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  panel.innerHTML = '<h4>Conditions</h4>';
  char.conditions.forEach(c => {
    const item = document.createElement('div');
    item.className = 'condition-item';
    item.innerHTML = `<span>${escHtml(c)}</span><button class="condition-remove" title="Remove">✕</button>`;
    item.querySelector('.condition-remove').addEventListener('click', () => {
      socket.emit('remove_condition', { targetName: char.name, condition: c });
    });
    panel.appendChild(item);
  });
}

function renderDeathSavePanel(char) {
  const panel = document.getElementById('deathSavePanel');
  if (!panel) return;
  if (char.hp > 0) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const ds = char.deathSaves || { successes: 0, failures: 0 };
  const sucPips = Array.from({ length: 3 }, (_, i) =>
    `<div class="ds-pip success${i < ds.successes ? ' filled' : ''}"></div>`
  ).join('');
  const failPips = Array.from({ length: 3 }, (_, i) =>
    `<div class="ds-pip failure${i < ds.failures ? ' filled' : ''}"></div>`
  ).join('');
  panel.innerHTML = `
    <h4>💀 Death Saves</h4>
    <div class="ds-row"><span>Success</span><div class="ds-pips">${sucPips}</div></div>
    <div class="ds-row"><span>Failure</span><div class="ds-pips">${failPips}</div></div>
  `;
}

function renderSkillsPanel(char) {
  const list = document.getElementById('skillsList');
  if (!list || !char?.stats) return;
  list.innerHTML = '';
  SKILLS.forEach(skill => {
    const val = char.stats[skill.stat] || 10;
    const mod = Math.floor((val - 10) / 2);
    const modStr = (mod >= 0 ? '+' : '') + mod;
    const notation = mod >= 0 ? `1d20+${mod}` : `1d20${mod}`;
    const div = document.createElement('div');
    div.className = 'skill-row';
    div.title = `Roll ${skill.name} (${skill.stat.toUpperCase()})`;
    div.innerHTML = `
      <span class="skill-name">${escHtml(skill.name)}</span>
      <span class="skill-stat">${skill.stat.toUpperCase()}</span>
      <span class="skill-mod">${modStr}</span>
    `;
    div.addEventListener('click', () => {
      const name = char.name;
      socket.emit('roll_dice', { notation }, (res) => {
        if (res.error) { appendChat({ type: 'system', text: `Dice error: ${res.error}` }); return; }
        const modPart = mod !== 0 ? (mod > 0 ? `+${mod}` : `${mod}`) : '';
        appendChat({ type: 'roll', text: `🎲 ${name} rolled ${skill.name}: [${res.result.rolls.join(', ')}]${modPart} = **${res.result.total}**` });
      });
    });
    list.appendChild(div);
  });
}

function renderInventory(snapshot) {
  const me = snapshot.players.find(p => p.socketId === mySocketId);
  if (!me) return;
  const list = document.getElementById('inventoryList');
  list.innerHTML = '';
  (me.inventory || []).forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'inventory-item';
    div.innerHTML = `<span>${escHtml(item)}</span><button class="inv-remove" data-idx="${idx}">✕</button>`;
    div.querySelector('.inv-remove').addEventListener('click', () => {
      socket.emit('remove_item', { index: idx });
    });
    list.appendChild(div);
  });
}

function renderNpcList(npcs) {
  const list = document.getElementById('npcList');
  list.innerHTML = '';
  npcs.forEach(npc => {
    const card = document.createElement('div');
    card.className = 'npc-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:4px">
        <span class="npc-name">${escHtml(npc.name)}</span>
        <span class="npc-disposition ${npc.disposition}">${npc.disposition}</span>
      </div>
      ${npc.role ? `<div class="npc-role">${escHtml(npc.role)}</div>` : ''}
      ${npc.notes ? `<div class="npc-notes">${escHtml(npc.notes)}</div>` : ''}
    `;
    list.appendChild(card);
  });
}

function renderRoomInfo(snapshot) {
  const current = snapshot.players.find(p => p.socketId === snapshot.currentTurnSocketId);
  document.getElementById('roomInfo').innerHTML =
    `<strong>Phase:</strong> ${snapshot.phase}<br>` +
    `<strong>Players:</strong> ${snapshot.players.length}` +
    (current ? `<br><strong>Turn:</strong> ${escHtml(current.name)}` : '');
}

/* ── Character card builder ── */
function buildCharCard(char, detailed = false, currentTurnSocketId = null) {
  const el = document.createElement('div');
  el.className = 'char-card';
  el.dataset.name = char.name;
  if (char.socketId === currentTurnSocketId) el.classList.add('active-turn');
  if (char.hp === 0) el.classList.add('dead');

  const hpPct = Math.max(0, Math.min(100, (char.hp / char.maxHp) * 100));
  const hpClass = hpPct > 50 ? '' : hpPct > 20 ? ' low' : ' critical';

  const conditionBadges = (char.conditions || []).map(c =>
    `<span class="condition-badge">${escHtml(c)}</span>`
  ).join('');

  let statsHtml = '';
  if (detailed && char.stats) {
    const statMod = v => { const m = Math.floor((v - 10) / 2); return (m >= 0 ? '+' : '') + m; };
    statsHtml = `<div class="stat-grid">${Object.entries(char.stats).map(([k, v]) =>
      `<div class="stat-cell" data-stat="${k}" data-val="${v}" title="Roll ${k.toUpperCase()} check">
        <div class="stat-key">${k}</div>
        <div class="stat-val">${v}</div>
        <div class="stat-mod">${statMod(v)}</div>
      </div>`
    ).join('')}</div>`;
  }

  el.innerHTML = `
    <div class="char-name">${escHtml(char.name)}</div>
    <div class="char-class">${escHtml(char.class)}</div>
    <div class="hp-bar-wrap"><div class="hp-bar${hpClass}" style="width:${hpPct}%"></div></div>
    <div class="hp-label">HP ${char.hp}/${char.maxHp}</div>
    ${conditionBadges ? `<div class="conditions-row">${conditionBadges}</div>` : ''}
    ${statsHtml}
  `;

  if (detailed) {
    el.querySelectorAll('.stat-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const stat = cell.dataset.stat;
        const val  = parseInt(cell.dataset.val);
        const mod  = Math.floor((val - 10) / 2);
        const notation = mod >= 0 ? `1d20+${mod}` : `1d20${mod}`;
        socket.emit('roll_dice', { notation }, (res) => {
          if (res.error) { appendChat({ type: 'system', text: `Dice error: ${res.error}` }); return; }
          const modPart = mod !== 0 ? (mod > 0 ? `+${mod}` : `${mod}`) : '';
          appendChat({ type: 'roll', text: `🎲 ${char.name} rolled ${stat.toUpperCase()} check: [${res.result.rolls.join(', ')}]${modPart} = **${res.result.total}**` });
        });
      });
    });
  }

  return el;
}

/* ── Chat ── */
function appendChat(msg) {
  const log = document.getElementById('chatLog');

  if (msg.type === 'dm') {
    const el = document.createElement('div');
    el.className = 'msg msg-dm';
    if (msg.sceneImg) {
      const loader = document.createElement('div');
      loader.className = 'scene-img-loading';
      el.appendChild(loader);
      const img = new Image();
      img.src = msg.sceneImg;
      img.className = 'scene-img';
      img.onload = () => { loader.replaceWith(img); };
      img.onerror = () => { loader.remove(); };
    }
    const body = document.createElement('div');
    body.innerHTML = `<div class="msg-header">🐉 Dungeon Master</div><div class="msg-text">${renderMarkdown(msg.text)}</div>`;
    el.appendChild(body);
    log.appendChild(el);
  } else if (msg.type === 'player') {
    const el = document.createElement('div');
    el.className = 'msg msg-player';
    el.innerHTML = `<div class="msg-header">⚔️ ${escHtml(msg.name)}</div><div class="msg-text">${escHtml(msg.text)}</div>`;
    log.appendChild(el);
  } else if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.innerHTML = `<span class="msg-text">${renderMarkdown(msg.text)}</span>`;
    log.appendChild(el);
  } else if (msg.type === 'roll') {
    const el = document.createElement('div');
    el.className = 'msg msg-roll';
    el.innerHTML = `<span class="msg-text">${renderMarkdown(msg.text)}</span>`;
    log.appendChild(el);
  }

  if (screens.waiting.classList.contains('active')) showScreen('game');
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

function appendChunk(el, chunk) {
  streamBuffer += chunk;
  el.querySelector('.msg-text').innerHTML = renderMarkdown(streamBuffer);
  document.getElementById('chatLog').scrollTop = document.getElementById('chatLog').scrollHeight;
}

function attachSceneImg(el, src) {
  const loader = document.createElement('div');
  loader.className = 'scene-img-loading';
  el.insertBefore(loader, el.firstChild);
  const img = new Image();
  img.src = src;
  img.className = 'scene-img';
  img.onload  = () => loader.replaceWith(img);
  img.onerror = () => loader.remove();
}

/* ── Markdown mini-renderer ── */
function renderMarkdown(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
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
