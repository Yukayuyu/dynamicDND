/* ── World Builder constants ── */
const TEMPLATES = [
  { id: 'dark-fantasy',    icon: '🗡️', name: 'Dark Fantasy',
    description: 'Grimdark kingdoms crumbling under undead plagues. Gods have gone silent, leaving mortals to survive by any means.' },
  { id: 'high-seas',       icon: '⚓', name: 'High Seas',
    description: 'Endless oceans dotted with pirate fleets, sea monsters, and lost islands hiding ancient treasure.' },
  { id: 'arcane-academy',  icon: '🔮', name: 'Arcane Academy',
    description: 'A grand magic school where students scheme for power, forbidden knowledge is uncovered, and factions collide.' },
  { id: 'post-apocalyptic',icon: '☢️', name: 'Post-Apocalyptic',
    description: 'Civilization fell centuries ago. Mutants, raider clans, and ancient ruins are all that remain.' },
  { id: 'fey-wilds',       icon: '🌿', name: 'Fey Wilds',
    description: 'Eternal twilight, trickster courts, time that flows wrong, beauty hiding lethal danger at every turn.' },
  { id: 'ancient-empires', icon: '🏛️', name: 'Ancient Empires',
    description: 'A sprawling empire at its zenith — marching legions, scheming senators, and gods walking in disguise.' },
];

const WORLD_STEPS = [
  { id: 'name_tone', label: 'Name & Tone',       icon: '📜' },
  { id: 'geography', label: 'Geography',          icon: '🗺️' },
  { id: 'races',     label: 'Playable Races',     icon: '🧝' },
  { id: 'classes',   label: 'Classes',            icon: '⚔️' },
  { id: 'factions',  label: 'Factions & Power',   icon: '🏰' },
  { id: 'threats',   label: 'Threats & Monsters', icon: '🐉' },
];

/* ── Character creation data ── */
const DEFAULT_RACES = [
  { name: 'Human',    icon: '👤', traits: ['+1 to all ability scores', 'Extra skill proficiency', 'Adaptable — bonus feat'] },
  { name: 'Elf',      icon: '🧝', traits: ['+2 DEX', 'Darkvision 60 ft', 'Fey Ancestry — advantage vs charm'] },
  { name: 'Dwarf',    icon: '⛏️', traits: ['+2 CON', 'Darkvision 60 ft', 'Poison resistance'] },
  { name: 'Halfling', icon: '🍀', traits: ['+2 DEX', 'Lucky — reroll 1s on attacks', 'Brave — can\'t be frightened'] },
  { name: 'Tiefling', icon: '😈', traits: ['+2 CHA  +1 INT', 'Darkvision 60 ft', 'Fire resistance + innate spells'] },
  { name: 'Half-Orc', icon: '💪', traits: ['+2 STR  +1 CON', 'Relentless Endurance — survive to 1 HP', 'Savage Attacks'] },
];

const CLASS_DATA = {
  Fighter:   { hitDie: 10, keyStat: 'STR / DEX', flavor: 'Master of weapons and tactics' },
  Wizard:    { hitDie: 6,  keyStat: 'INT',        flavor: 'Arcane power through study and mastery' },
  Rogue:     { hitDie: 8,  keyStat: 'DEX',        flavor: 'Cunning and skill — Sneak Attack damage' },
  Cleric:    { hitDie: 8,  keyStat: 'WIS',        flavor: 'Divine magic: healer, warrior, support' },
  Ranger:    { hitDie: 10, keyStat: 'DEX / WIS',  flavor: 'Wilderness scout and skilled hunter' },
  Barbarian: { hitDie: 12, keyStat: 'STR',        flavor: 'Rage-powered bruiser with massive HP' },
};

/* ── Skills constants ── */
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

// Character select state
let pendingRoomId = '';
let pendingName   = '';
let selectedRace  = null;
let selectedClass = null;

// World builder state
let wbContext = {};      // accumulated step results: { name_tone: '...', geography: '...', ... }
let wbStepTexts = {};    // current streaming text per step
let wbCurrentStep = -1;  // index into WORLD_STEPS, -1 = not started
let wbInitDescription = '';  // initial template/custom description

/* ── Screens ── */
const screens = {
  lobby:      document.getElementById('lobby'),
  charselect: document.getElementById('charselect'),
  waiting:    document.getElementById('waiting'),
  game:       document.getElementById('game'),
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
  const roomId = document.getElementById('roomId').value.trim();
  const name   = document.getElementById('playerName').value.trim();
  const errEl  = document.getElementById('lobbyError');
  if (!roomId || !name) { showError(errEl, 'Room code and name are required.'); return; }
  pendingRoomId = roomId;
  pendingName   = name;
  socket.emit('peek_room', { roomId }, (res) => {
    initCharSelect(res?.world || null);
    document.getElementById('csRoomId').textContent = roomId;
    document.getElementById('csPlayerName').textContent = name;
    showScreen('charselect');
  });
});

/* ── Character Select ── */
document.getElementById('csBackBtn').addEventListener('click', () => {
  selectedRace = null;
  selectedClass = null;
  showScreen('lobby');
});

document.getElementById('playBtn').addEventListener('click', () => {
  if (!selectedClass) return;
  const errEl = document.getElementById('csError');
  const race = selectedRace || 'Human';
  socket.emit('join_room', { roomId: pendingRoomId, name: pendingName, charClass: selectedClass, race }, (res) => {
    if (res.error) { showError(errEl, res.error); return; }
    myChar = res.character;
    document.getElementById('waitRoomId').textContent = pendingRoomId;
    showScreen('waiting');
  });
});

function initCharSelect(world) {
  selectedRace = null;
  selectedClass = null;
  updatePlayBtn();

  const badge = document.getElementById('csWorldBadge');
  if (world?._name) {
    badge.textContent = `🌍 Playing in: ${world._name}`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const races   = world?.races   ? parseWorldRaces(world.races)     : DEFAULT_RACES;
  const classes = world?.classes ? parseWorldClasses(world.classes)  : Object.keys(CLASS_DATA);
  renderRaceCards(races);
  renderClassCards(classes);
}

function parseWorldRaces(racesText) {
  const races = [];
  const lines = racesText.split('\n');
  for (const line of lines) {
    const m = line.match(/\*\*([^*]+)\*\*:?\s*(.*)/);
    if (m) races.push({ name: m[1].trim(), icon: '🧝', traits: [m[2].trim()].filter(Boolean) });
  }
  return races.length >= 2 ? races : DEFAULT_RACES;
}

function parseWorldClasses(classesText) {
  const all = Object.keys(CLASS_DATA);
  const available = all.filter(c => classesText.toLowerCase().includes(c.toLowerCase()));
  return available.length >= 2 ? available : all;
}

function renderRaceCards(races) {
  const grid = document.getElementById('raceGrid');
  grid.innerHTML = '';
  races.forEach(race => {
    const card = document.createElement('div');
    card.className = 'cs-card race-card';
    const traits = (race.traits || []).slice(0, 3);
    card.innerHTML = `
      <div class="cs-card-icon">${race.icon || '🧝'}</div>
      <div class="cs-card-name">${escHtml(race.name)}</div>
      <ul class="cs-traits">${traits.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.race-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedRace = race.name;
      updatePlayBtn();
      updateCharPreview();
    });
    grid.appendChild(card);
  });
}

function renderClassCards(classes) {
  const grid = document.getElementById('classGrid');
  grid.innerHTML = '';
  classes.forEach(cls => {
    const data = CLASS_DATA[cls];
    if (!data) return;
    const card = document.createElement('div');
    card.className = 'cs-card class-card';
    card.innerHTML = `
      <div class="cs-card-name">${escHtml(cls)}</div>
      <div class="cs-card-die">d${data.hitDie} HP</div>
      <div class="cs-card-stat">${escHtml(data.keyStat)}</div>
      <div class="cs-card-flavor">${escHtml(data.flavor)}</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedClass = cls;
      updatePlayBtn();
      updateCharPreview();
    });
    grid.appendChild(card);
  });
}

function updatePlayBtn() {
  const btn = document.getElementById('playBtn');
  if (selectedClass) {
    btn.disabled = false;
    const race = selectedRace || 'Human';
    btn.textContent = `Play as ${escHtml(pendingName)} the ${race} ${selectedClass} →`;
  } else {
    btn.disabled = true;
    btn.textContent = 'Select a class to continue';
  }
}

function updateCharPreview() {
  if (!selectedClass) { document.getElementById('charPreview').classList.add('hidden'); return; }
  const CLASSES_STATS = {
    Fighter:   { hp: 12, str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    Wizard:    { hp: 6,  str: 8,  dex: 14, con: 10, int: 17, wis: 13, cha: 11 },
    Rogue:     { hp: 8,  str: 10, dex: 17, con: 12, int: 12, wis: 11, cha: 14 },
    Cleric:    { hp: 8,  str: 12, dex: 10, con: 14, int: 12, wis: 17, cha: 13 },
    Ranger:    { hp: 10, str: 13, dex: 16, con: 12, int: 11, wis: 14, cha: 10 },
    Barbarian: { hp: 12, str: 17, dex: 13, con: 15, int: 8,  wis: 10, cha: 9  },
  };
  const s = CLASSES_STATS[selectedClass];
  if (!s) return;
  const statMod = v => { const m = Math.floor((v - 10) / 2); return (m >= 0 ? '+' : '') + m; };
  const spellNote = { Wizard: '4/3/2 spell slots', Cleric: '4/3/2 spell slots', Ranger: '2 spell slots' };
  const preview = document.getElementById('charPreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-title">${escHtml(selectedRace || 'Human')} ${escHtml(selectedClass)}</div>
    <div class="preview-hp">❤️ ${s.hp} HP (d${CLASS_DATA[selectedClass].hitDie})</div>
    <div class="preview-stats">
      ${Object.entries(s).filter(([k]) => k !== 'hp').map(([k, v]) =>
        `<span class="preview-stat"><b>${k.toUpperCase()}</b> ${v} <em>(${statMod(v)})</em></span>`
      ).join('')}
    </div>
    ${spellNote[selectedClass] ? `<div class="preview-slots">✨ ${spellNote[selectedClass]}</div>` : ''}
  `;
}

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

/* ── Session Log ── */
document.getElementById('logBtn').addEventListener('click', () => {
  socket.emit('get_log', {}, (res) => {
    if (res?.error) return;
    renderLog(res.entries || []);
    document.getElementById('logOverlay').classList.remove('hidden');
  });
});

document.getElementById('closeLogBtn').addEventListener('click', () => {
  document.getElementById('logOverlay').classList.add('hidden');
});

function renderLog(entries) {
  const container = document.getElementById('logEntries');
  container.innerHTML = '';
  if (!entries.length) {
    container.innerHTML = '<div class="log-empty">No events recorded yet.</div>';
    return;
  }
  const sessionStart = entries[0]?.ts || 0;
  entries.forEach(e => {
    const row = document.createElement('div');
    row.className = `log-entry log-${e.type}`;
    const elapsed = e.ts - sessionStart;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const time = `${mm}:${ss}`;
    const icon = { dm: '🐉', player: '⚔️', roll: '🎲', system: '⚙️' }[e.type] || '•';
    row.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-icon">${icon}</span>
      <span class="log-actor">${escHtml(e.actor)}</span>
      <span class="log-text">${renderMarkdown(e.text)}</span>
    `;
    container.appendChild(row);
  });
  container.scrollTop = container.scrollHeight;
}

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

/* ── World Builder ── */
function initWorldBuilder() {
  const grid = document.getElementById('templateGrid');
  if (!grid || grid.children.length > 0) return;
  TEMPLATES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.dataset.id = t.id;
    card.dataset.desc = t.description;
    card.innerHTML = `<div class="tmpl-icon">${t.icon}</div><div class="tmpl-name">${escHtml(t.name)}</div><div class="tmpl-desc">${escHtml(t.description)}</div>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      document.getElementById('worldDescription').classList.add('hidden');
    });
    grid.appendChild(card);
  });
  // Custom card
  const custom = document.createElement('div');
  custom.className = 'template-card template-custom';
  custom.dataset.id = 'custom';
  custom.innerHTML = `<div class="tmpl-icon">✏️</div><div class="tmpl-name">Custom</div><div class="tmpl-desc">Describe your own world</div>`;
  custom.addEventListener('click', () => {
    document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
    custom.classList.add('selected');
    document.getElementById('worldDescription').classList.remove('hidden');
    document.getElementById('worldDescription').focus();
  });
  grid.appendChild(custom);
}

document.getElementById('toggleWorldBuilder').addEventListener('click', () => {
  const panel = document.getElementById('worldBuilderPanel');
  const isHidden = panel.classList.toggle('hidden');
  if (!isHidden) initWorldBuilder();
});

document.getElementById('changeWorldBtn').addEventListener('click', () => {
  document.getElementById('worldDisplay').classList.add('hidden');
  document.getElementById('toggleWorldBuilder').classList.remove('hidden');
  document.getElementById('worldBuilderPanel').classList.remove('hidden');
  wbReset();
  initWorldBuilder();
});

document.getElementById('generateWorldBtn').addEventListener('click', () => {
  const sel = document.querySelector('.template-card.selected');
  if (!sel) { alert('Please select a template or custom.'); return; }
  if (sel.dataset.id === 'custom') {
    wbInitDescription = document.getElementById('worldDescription').value.trim();
    if (!wbInitDescription) { alert('Please describe your world.'); return; }
  } else {
    wbInitDescription = sel.dataset.desc;
  }
  wbContext = {};
  wbStepTexts = {};
  wbCurrentStep = 0;
  document.getElementById('wbPhase1').classList.add('hidden');
  document.getElementById('wbPhase2').classList.remove('hidden');
  wbRenderSteps();
  wbRunStep(0);
});

document.getElementById('stepCards').addEventListener('click', (e) => {
  const accept = e.target.closest('[data-accept]');
  const regen  = e.target.closest('[data-regen]');
  if (accept) wbAcceptStep(accept.dataset.accept);
  if (regen)  wbRegenStep(regen.dataset.regen);
});

document.getElementById('confirmWorldBtn').addEventListener('click', () => {
  const worldName = wbExtractName(wbContext.name_tone || '');
  socket.emit('set_world', { world: { ...wbContext, _name: worldName } }, () => {});
  document.getElementById('worldBuilderPanel').classList.add('hidden');
  document.getElementById('toggleWorldBuilder').classList.add('hidden');
});

document.getElementById('restartWorldBtn').addEventListener('click', () => {
  wbReset();
  document.getElementById('wbPhase3').classList.add('hidden');
  document.getElementById('wbPhase1').classList.remove('hidden');
  initWorldBuilder();
});

function wbReset() {
  wbContext = {};
  wbStepTexts = {};
  wbCurrentStep = -1;
  document.querySelectorAll('.wb-phase').forEach(p => p.classList.add('hidden'));
  document.getElementById('wbPhase1').classList.remove('hidden');
  document.getElementById('templateGrid').innerHTML = '';
  document.getElementById('worldDescription').classList.add('hidden');
}

function wbExtractName(text) {
  const first = text.split('\n')[0].replace(/\*+/g, '').trim();
  return first.substring(0, 40) || 'Unknown World';
}

function wbRenderSteps() {
  const container = document.getElementById('stepCards');
  container.innerHTML = '';
  WORLD_STEPS.forEach((step, idx) => {
    const card = document.createElement('div');
    card.id = `wb-step-${step.id}`;
    const isDone   = idx < wbCurrentStep;
    const isActive = idx === wbCurrentStep;
    card.className = `step-card ${isDone ? 'done' : isActive ? 'active' : 'locked'}`;
    card.innerHTML = `
      <div class="step-head">
        <span class="step-num">${step.icon} ${idx + 1}/6</span>
        <span class="step-label">${step.label}</span>
        ${isDone ? '<span class="step-check">✓</span>' : ''}
      </div>
      ${isDone ? `<div class="step-body">${renderMarkdown(wbContext[step.id] || '')}</div>` : ''}
      ${isActive ? `<div id="wb-text-${step.id}" class="step-body streaming"></div>
        <div id="wb-acts-${step.id}" class="step-actions hidden">
          <button class="btn-primary btn-sm" data-accept="${step.id}">✓ Accept</button>
          <button class="btn-secondary btn-sm" data-regen="${step.id}">↺ Regenerate</button>
        </div>` : ''}
      ${!isDone && !isActive ? '<div class="step-body muted">Waiting...</div>' : ''}
    `;
    container.appendChild(card);
  });
  container.scrollTop = container.scrollHeight;
}

function wbRunStep(idx) {
  wbCurrentStep = idx;
  wbStepTexts[WORLD_STEPS[idx].id] = '';
  wbRenderSteps();
  socket.emit('generate_world_step', {
    step: WORLD_STEPS[idx].id,
    worldContext: { ...wbContext },
    description: idx === 0 ? wbInitDescription : '',
  }, () => {});
}

function wbAcceptStep(stepId) {
  wbContext[stepId] = wbStepTexts[stepId] || '';
  const idx = WORLD_STEPS.findIndex(s => s.id === stepId);
  if (idx + 1 < WORLD_STEPS.length) {
    wbRunStep(idx + 1);
  } else {
    wbCurrentStep = WORLD_STEPS.length;
    wbRenderSteps();
    wbShowConfirm();
  }
}

function wbRegenStep(stepId) {
  wbStepTexts[stepId] = '';
  const idx = WORLD_STEPS.findIndex(s => s.id === stepId);
  wbRunStep(idx);
}

function wbShowConfirm() {
  document.getElementById('wbPhase2').classList.add('hidden');
  document.getElementById('wbPhase3').classList.remove('hidden');
  const summary = document.getElementById('worldSummary');
  const name = wbExtractName(wbContext.name_tone || '');
  summary.innerHTML = `<div class="world-name-display">🌍 ${escHtml(name)}</div>` +
    WORLD_STEPS.map(s => wbContext[s.id]
      ? `<div class="summary-block"><strong>${s.icon} ${s.label}</strong><div class="summary-text">${renderMarkdown(wbContext[s.id])}</div></div>`
      : ''
    ).join('');
}

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
  // Sync world display for players who joined after world was set
  if (snapshot.world) {
    const name = snapshot.world._name || wbExtractName(snapshot.world.name_tone || '') || 'World';
    document.getElementById('worldNameBadge').textContent = name;
    document.getElementById('worldDisplay').classList.remove('hidden');
    document.getElementById('toggleWorldBuilder').classList.add('hidden');
  }
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

socket.on('world_step_chunk', ({ step, chunk }) => {
  wbStepTexts[step] = (wbStepTexts[step] || '') + chunk;
  const el = document.getElementById(`wb-text-${step}`);
  if (el) el.innerHTML = renderMarkdown(wbStepTexts[step]);
  const container = document.getElementById('stepCards');
  if (container) container.scrollTop = container.scrollHeight;
});

socket.on('world_step_done', ({ step, text }) => {
  wbStepTexts[step] = text;
  const el = document.getElementById(`wb-text-${step}`);
  if (el) { el.innerHTML = renderMarkdown(text); el.classList.remove('streaming'); }
  const acts = document.getElementById(`wb-acts-${step}`);
  if (acts) acts.classList.remove('hidden');
});

socket.on('world_update', ({ world }) => {
  if (!world) return;
  const name = world._name || wbExtractName(world.name_tone || '') || 'World';
  document.getElementById('worldNameBadge').textContent = name;
  document.getElementById('worldDisplay').classList.remove('hidden');
  document.getElementById('toggleWorldBuilder').classList.add('hidden');
  document.getElementById('worldBuilderPanel').classList.add('hidden');
  if (currentSnapshot) renderRoomInfo({ ...currentSnapshot, world });
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
  const worldName = snapshot.world?._name || (snapshot.world?.name_tone ? wbExtractName(snapshot.world.name_tone) : null);
  document.getElementById('roomInfo').innerHTML =
    `<strong>Phase:</strong> ${snapshot.phase}<br>` +
    `<strong>Players:</strong> ${snapshot.players.length}` +
    (worldName ? `<br><strong>World:</strong> ${escHtml(worldName)}` : '') +
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
    <div class="char-class">${char.race ? `${escHtml(char.race)} ` : ''}${escHtml(char.class)}</div>
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
