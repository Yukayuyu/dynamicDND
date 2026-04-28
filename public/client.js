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

// Mode: 'play' (humans as characters), 'host' (no own character, AI only), 'spectate' (view-only)
let mode = 'play';
let personaCache = [];
let isPaused = false;

// World builder state
let wbContext = {};      // accumulated step results: { name_tone: '...', geography: '...', ... }
let wbStepTexts = {};    // current streaming text per step
let wbCurrentStep = -1;  // index into WORLD_STEPS, -1 = not started
let wbInitDescription = '';  // initial template/custom description

/* ── Screens ── */
const screens = {
  lobby:       document.getElementById('lobby'),
  worldscreen: document.getElementById('worldscreen'),
  charselect:  document.getElementById('charselect'),
  waiting:     document.getElementById('waiting'),
  game:        document.getElementById('game'),
};

/* ── Character creation extras ── */
const PORTRAITS = ['🧝','🧙','🧛','🧜','🧚','🧞','🤺','🦹','🥷','👤','🧓','💀','🐉','😈','🦊','🦉'];
let META = { classes: [], backgrounds: {}, alignments: [] };
let charState = {
  portrait: '🧝',
  abilities: null,            // null = use class defaults
  rolledPool: [],             // numbers waiting to be assigned
  pendingAssign: null,        // index into rolledPool currently selected
  background: null,
  alignment: 'True Neutral',
};

function loadMeta(cb) {
  socket.emit('get_meta', {}, (res) => {
    if (res?.ok) {
      META = {
        classes: res.classes,
        backgrounds: res.backgrounds,
        alignments: res.alignments,
        languages: res.languages || [{ code: 'en', name: 'English', label: 'English' }],
      };
      populateLanguageSelect();
    }
    cb && cb();
  });
}

function populateLanguageSelect() {
  const sels = [document.getElementById('languageSelect'), document.getElementById('languageSelectWait')].filter(Boolean);
  for (const sel of sels) {
    if (sel.options.length) continue;
    (META.languages || []).forEach(l => {
      sel.add(new Option(`${l.label} — ${l.name}`, l.code));
    });
  }
}

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
  mode = 'play';
  pendingRoomId = roomId;
  pendingName   = name;

  // Try reconnect first. If a character with this name exists in this room
  // (because they previously joined and either disconnected or just left the
  // tab), rebind their socket and route to the right screen based on the room's
  // current phase — mid-adventure goes to the game screen with full state
  // restored; lobby/pre-game goes back to the waiting room so the user can
  // still add AI personas, change language, and Start the adventure.
  socket.emit('reconnect_player', { roomId, name }, (rec) => {
    if (rec?.ok) {
      myChar = rec.character;
      currentSnapshot = rec.snapshot || null;
      pendingRoomId = roomId;
      pendingName = name;
      mode = 'play';
      // Make sure META (backgrounds, languages, etc.) is loaded before any
      // screen renders that depends on it.
      loadMeta(() => {
        if (rec.snapshot?.phase === 'adventure') {
          showScreen('game');
        } else {
          document.getElementById('waitRoomId').textContent = roomId;
          showScreen('waiting');
          refreshAiPartyList();
        }
      });
      return;
    }
    // No prior character — fall through to the normal join flow.
    loadMeta(() => {
      socket.emit('peek_room', { roomId }, (res) => {
        const world = res?.world || null;
        if (world) {
          initCharSelect(world);
          document.getElementById('csRoomId').textContent = roomId;
          document.getElementById('csPlayerName').textContent = name;
          showScreen('charselect');
        } else {
          // First in: set currentRoom on the server (via host_room) so subsequent
          // events like set_language and generate_world_step have a target room.
          // host_room only binds the socket; it doesn't create a player character.
          socket.emit('host_room', { roomId }, (hres) => {
            if (hres?.error) { showError(errEl, hres.error); return; }
            document.getElementById('wsRoomId').textContent = roomId;
            document.getElementById('wsNameLabel').textContent = ` — ${name}`;
            updateWsContinueBtn(false);
            showScreen('worldscreen');
          });
        }
      });
    });
  });
});

document.getElementById('hostBtn').addEventListener('click', () => {
  const roomId = document.getElementById('roomId').value.trim();
  const errEl  = document.getElementById('lobbyError');
  if (!roomId) { showError(errEl, 'Room code is required.'); return; }
  mode = 'host';
  pendingRoomId = roomId;
  loadMeta(() => {
    socket.emit('host_room', { roomId }, (res) => {
      if (res?.error) { showError(errEl, res.error); return; }
      const world = res?.snapshot?.world || null;
      document.getElementById('wsRoomId').textContent = roomId;
      document.getElementById('wsNameLabel').textContent = ' — Host';
      updateWsContinueBtn(!!world);
      showScreen('worldscreen');
    });
  });
});

/* ── World screen navigation ── */
document.getElementById('wsBackBtn').addEventListener('click', () => showScreen('lobby'));

document.getElementById('wsSkipBtn').addEventListener('click', () => advanceFromWorldScreen());
document.getElementById('wsContinueBtn').addEventListener('click', () => advanceFromWorldScreen());

function onLanguageChange(e) {
  socket.emit('set_language', { code: e.target.value }, (res) => {
    if (res?.error) appendChat({ type: 'system', text: `Language change failed: ${res.error}` });
  });
}
document.getElementById('languageSelect').addEventListener('change', onLanguageChange);
document.getElementById('languageSelectWait').addEventListener('change', onLanguageChange);

function advanceFromWorldScreen() {
  if (mode === 'host') {
    document.getElementById('waitRoomId').textContent = pendingRoomId;
    showScreen('waiting');
    refreshAiPartyList();
  } else {
    // Pass whatever world we have (might be null if user skipped) to charselect.
    initCharSelect(currentSnapshot?.world || null);
    document.getElementById('csRoomId').textContent = pendingRoomId;
    document.getElementById('csPlayerName').textContent = pendingName;
    showScreen('charselect');
  }
}

function updateWsContinueBtn(worldConfirmed) {
  const btn = document.getElementById('wsContinueBtn');
  if (worldConfirmed) {
    btn.disabled = false;
    btn.textContent = mode === 'host' ? 'Continue to Lobby →' : 'Continue to Character →';
  } else {
    btn.disabled = true;
    btn.textContent = 'Confirm a world to continue (or Skip)';
  }
}

document.getElementById('spectateBtn').addEventListener('click', () => {
  const roomId = document.getElementById('roomId').value.trim();
  const errEl  = document.getElementById('lobbyError');
  if (!roomId) { showError(errEl, 'Room code is required.'); return; }
  mode = 'spectate';
  pendingRoomId = roomId;
  socket.emit('spectate_room', { roomId }, (res) => {
    if (res?.error) { showError(errEl, res.error); return; }
    showScreen('game');
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
  const payload = {
    roomId:    pendingRoomId,
    name:      pendingName,
    charClass: selectedClass,
    race,
    portrait:  charState.portrait,
    abilities: charState.abilities,    // null = server uses class defaults
    background: charState.background,
    alignment:  charState.alignment,
  };
  socket.emit('join_room', payload, (res) => {
    if (res.error) { showError(errEl, res.error); return; }
    myChar = res.character;
    document.getElementById('waitRoomId').textContent = pendingRoomId;
    showScreen('waiting');
  });
});

function initCharSelect(world) {
  selectedRace = null;
  selectedClass = null;
  charState = {
    portrait: '🧝', abilities: null, rolledPool: [], pendingAssign: null,
    background: null, alignment: 'True Neutral',
  };
  updatePlayBtn();

  const badge = document.getElementById('csWorldBadge');
  if (world?._name) {
    badge.textContent = `🌍 Playing in: ${world._name}`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Race/class options come from the world's bible if present, else parse the free-text concept,
  // else fall back to defaults.
  let races, classes;
  if (world?.bible) {
    // The bible doesn't directly enumerate races/classes; use concept fields if present, else defaults.
    races   = world.races   ? parseWorldRaces(world.races)    : DEFAULT_RACES;
    classes = world.classes ? parseWorldClasses(world.classes) : Object.keys(CLASS_DATA);
  } else {
    races   = world?.races   ? parseWorldRaces(world.races)     : DEFAULT_RACES;
    classes = world?.classes ? parseWorldClasses(world.classes)  : Object.keys(CLASS_DATA);
  }
  renderRaceCards(races);
  renderClassCards(classes);
  renderPortraitGrid();
  renderAbilityGrid();
  renderBackgroundGrid();
  renderAlignmentGrid();
}

/* ── Portrait picker ── */
function renderPortraitGrid() {
  const grid = document.getElementById('portraitGrid');
  grid.innerHTML = '';
  PORTRAITS.forEach(p => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'portrait-cell' + (p === charState.portrait ? ' selected' : '');
    cell.textContent = p;
    cell.addEventListener('click', () => {
      charState.portrait = p;
      document.getElementById('portraitCustom').value = '';
      renderPortraitGrid();
      updateCharPreview();
    });
    grid.appendChild(cell);
  });
}

document.getElementById('portraitCustom').addEventListener('input', (e) => {
  const v = e.target.value.trim();
  if (v) {
    charState.portrait = v;
    document.querySelectorAll('.portrait-cell').forEach(c => c.classList.remove('selected'));
    updateCharPreview();
  }
});

/* ── Ability score roll + assignment ── */
const ABILITY_KEYS = ['str','dex','con','int','wis','cha'];
const CLASS_DEFAULT_STATS = {
  Fighter:   { str:16, dex:12, con:14, int:10, wis:10, cha:8  },
  Wizard:    { str:8,  dex:14, con:10, int:17, wis:13, cha:11 },
  Rogue:     { str:10, dex:17, con:12, int:12, wis:11, cha:14 },
  Cleric:    { str:12, dex:10, con:14, int:12, wis:17, cha:13 },
  Ranger:    { str:13, dex:16, con:12, int:11, wis:14, cha:10 },
  Barbarian: { str:17, dex:13, con:15, int:8,  wis:10, cha:9  },
};

document.getElementById('rollAbilitiesBtn').addEventListener('click', () => {
  const pool = [];
  for (let i = 0; i < 6; i++) {
    // 4d6 drop lowest
    const dice = [1,2,3,4].map(() => Math.floor(Math.random() * 6) + 1).sort((a,b) => a - b);
    pool.push(dice[1] + dice[2] + dice[3]);
  }
  pool.sort((a,b) => b - a);
  charState.rolledPool = pool;
  charState.pendingAssign = null;
  // Clear current abilities so user must assign all.
  charState.abilities = { str:null, dex:null, con:null, int:null, wis:null, cha:null };
  document.getElementById('rolledPool').classList.remove('hidden');
  document.getElementById('resetAbilitiesBtn').classList.remove('hidden');
  renderAbilityGrid();
  renderRolledChips();
  updateCharPreview();
});

document.getElementById('useDefaultsBtn').addEventListener('click', () => {
  if (!selectedClass) {
    alert('Choose a class first to use its default ability scores.');
    return;
  }
  charState.abilities = { ...CLASS_DEFAULT_STATS[selectedClass] };
  charState.rolledPool = [];
  charState.pendingAssign = null;
  document.getElementById('rolledPool').classList.add('hidden');
  document.getElementById('resetAbilitiesBtn').classList.add('hidden');
  renderAbilityGrid();
  updateCharPreview();
});

document.getElementById('resetAbilitiesBtn').addEventListener('click', () => {
  document.getElementById('rollAbilitiesBtn').click();
});

function renderRolledChips() {
  const host = document.getElementById('rolledChips');
  host.innerHTML = '';
  charState.rolledPool.forEach((val, i) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'roll-chip' + (charState.pendingAssign === i ? ' pending' : '') + (val == null ? ' used' : '');
    chip.textContent = val == null ? '·' : val;
    chip.disabled = val == null;
    chip.addEventListener('click', () => {
      if (val == null) return;
      charState.pendingAssign = (charState.pendingAssign === i ? null : i);
      renderRolledChips();
    });
    host.appendChild(chip);
  });
}

function renderAbilityGrid() {
  const host = document.getElementById('abilityGrid');
  host.innerHTML = '';
  const ab = charState.abilities;
  ABILITY_KEYS.forEach(k => {
    const v = ab ? ab[k] : (selectedClass ? CLASS_DEFAULT_STATS[selectedClass]?.[k] : null);
    const mod = v != null ? Math.floor((v - 10) / 2) : null;
    const modStr = mod != null ? (mod >= 0 ? '+' : '') + mod : '';
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ability-cell' + (v == null ? ' empty' : '');
    cell.dataset.key = k;
    cell.innerHTML = `
      <div class="ab-key">${k.toUpperCase()}</div>
      <div class="ab-val">${v == null ? '?' : v}</div>
      <div class="ab-mod">${modStr}</div>
    `;
    cell.addEventListener('click', () => assignAbility(k));
    host.appendChild(cell);
  });
}

function assignAbility(key) {
  // If a chip is selected, assign it. Otherwise, if this slot has a value, send it back to the pool.
  if (charState.pendingAssign !== null) {
    const idx = charState.pendingAssign;
    const val = charState.rolledPool[idx];
    if (val == null) return;
    if (!charState.abilities) charState.abilities = { str:null, dex:null, con:null, int:null, wis:null, cha:null };
    // If the slot already had a value, return it to the pool.
    const existing = charState.abilities[key];
    if (existing != null) {
      const emptyChip = charState.rolledPool.findIndex(v => v == null);
      if (emptyChip !== -1) charState.rolledPool[emptyChip] = existing;
      else charState.rolledPool.push(existing);
    }
    charState.abilities[key] = val;
    charState.rolledPool[idx] = null;
    charState.pendingAssign = null;
  } else {
    // No chip selected — clear the slot back to the pool.
    if (!charState.abilities) return;
    const existing = charState.abilities[key];
    if (existing == null) return;
    const emptyChip = charState.rolledPool.findIndex(v => v == null);
    if (emptyChip !== -1) charState.rolledPool[emptyChip] = existing;
    else charState.rolledPool.push(existing);
    charState.abilities[key] = null;
  }
  renderAbilityGrid();
  renderRolledChips();
  updatePlayBtn();
  updateCharPreview();
}

function abilitiesComplete() {
  if (!charState.abilities) return true; // null = server uses class defaults
  return ABILITY_KEYS.every(k => charState.abilities[k] != null);
}

/* ── Background picker ── */
function renderBackgroundGrid() {
  const grid = document.getElementById('backgroundGrid');
  grid.innerHTML = '';
  Object.entries(META.backgrounds || {}).forEach(([name, def]) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'bg-cell' + (charState.background === name ? ' selected' : '');
    cell.innerHTML = `
      <div class="bg-name">${escHtml(name)}</div>
      <div class="bg-skills">${(def.skills || []).join(' · ')}</div>
      <div class="bg-flavor">${escHtml(def.flavor || '')}</div>
    `;
    cell.addEventListener('click', () => {
      charState.background = (charState.background === name) ? null : name;
      renderBackgroundGrid();
      updatePlayBtn();
      updateCharPreview();
    });
    grid.appendChild(cell);
  });
}

/* ── Alignment 3x3 ── */
function renderAlignmentGrid() {
  const grid = document.getElementById('alignmentGrid');
  grid.innerHTML = '';
  (META.alignments || []).forEach(name => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'align-cell' + (charState.alignment === name ? ' selected' : '');
    cell.textContent = name;
    cell.addEventListener('click', () => {
      charState.alignment = name;
      renderAlignmentGrid();
      updateCharPreview();
    });
    grid.appendChild(cell);
  });
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
  const ready = selectedClass && abilitiesComplete();
  if (ready) {
    btn.disabled = false;
    const race = selectedRace || 'Human';
    btn.textContent = `Play as ${escHtml(pendingName)} the ${race} ${selectedClass} →`;
  } else {
    btn.disabled = true;
    if (!selectedClass)         btn.textContent = 'Select a class to continue';
    else if (!abilitiesComplete()) btn.textContent = 'Assign all 6 ability scores';
    else                        btn.textContent = 'Select race & class to continue';
  }
}

function updateCharPreview() {
  if (!selectedClass) { document.getElementById('charPreview').classList.add('hidden'); return; }
  // Effective stats: assigned > class default
  const s = (charState.abilities && abilitiesComplete())
    ? charState.abilities
    : CLASS_DEFAULT_STATS[selectedClass];
  const baseHp = { Fighter:12, Wizard:6, Rogue:8, Cleric:8, Ranger:10, Barbarian:12 }[selectedClass];
  const conMod = Math.floor(((s.con || 10) - 10) / 2);
  const hp = Math.max(1, baseHp + conMod);
  const statMod = v => { const m = Math.floor((v - 10) / 2); return (m >= 0 ? '+' : '') + m; };
  const spellNote = { Wizard: '4/3/2 spell slots', Cleric: '4/3/2 spell slots', Ranger: '2 spell slots' };
  const bg = charState.background ? META.backgrounds[charState.background] : null;
  const preview = document.getElementById('charPreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="preview-portrait">${escHtml(charState.portrait)}</div>
    <div class="preview-body">
      <div class="preview-title">${escHtml(selectedRace || 'Human')} ${escHtml(selectedClass)} · <span class="preview-align">${escHtml(charState.alignment)}</span></div>
      <div class="preview-hp">❤️ ${hp} HP (d${CLASS_DATA[selectedClass].hitDie}, CON ${statMod(s.con)})</div>
      <div class="preview-stats">
        ${ABILITY_KEYS.map(k =>
          `<span class="preview-stat"><b>${k.toUpperCase()}</b> ${s[k]} <em>(${statMod(s[k])})</em></span>`
        ).join('')}
      </div>
      ${spellNote[selectedClass] ? `<div class="preview-slots">✨ ${spellNote[selectedClass]}</div>` : ''}
      ${bg ? `<div class="preview-bg">📖 <b>${escHtml(charState.background)}</b> — gains <em>${bg.skills.join(' & ')}</em></div>` : ''}
    </div>
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

/* ── Auth (username + PIN) ──
 * Token stored in localStorage; auto-resume on page load. The lobby reflects
 * signed-in state with a chip + library button. Personas + rooms get tagged
 * with the user's id server-side; the library UI lists them. */
const TOKEN_KEY = 'dynamicdnd_token';
let authUser = null;          // { id, username } | null
let authToken = null;         // string | null

function getStoredToken() { try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; } }
function setStoredToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} }

function paintAuthBar() {
  const signedOut = document.getElementById('authSignedOut');
  const signedIn  = document.getElementById('authSignedIn');
  if (authUser) {
    document.getElementById('authUsername').textContent = authUser.username;
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
  }
}

function tryAutoResume() {
  const token = getStoredToken();
  if (!token) { paintAuthBar(); return; }
  socket.emit('auth_resume', { token }, (res) => {
    if (res?.ok) {
      authUser = res.user;
      authToken = token;
    } else {
      setStoredToken(null);
    }
    paintAuthBar();
  });
}

document.getElementById('openAuthBtn').addEventListener('click', () => {
  document.getElementById('authModal').classList.remove('hidden');
  document.getElementById('authError').classList.add('hidden');
  document.getElementById('authUsernameInput').focus();
});
document.getElementById('closeAuthBtn').addEventListener('click', () => {
  document.getElementById('authModal').classList.add('hidden');
});
document.getElementById('authModal').addEventListener('click', (e) => {
  if (e.target.id === 'authModal') document.getElementById('authModal').classList.add('hidden');
});

let authMode = 'login';
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    authMode = btn.dataset.authtab; // 'login' | 'signup'
    document.getElementById('authSubmitBtn').textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
    document.getElementById('authError').classList.add('hidden');
  });
});

document.getElementById('authSubmitBtn').addEventListener('click', () => {
  const username = document.getElementById('authUsernameInput').value.trim();
  const pin      = document.getElementById('authPinInput').value.trim();
  const errEl    = document.getElementById('authError');
  if (!username || !pin) { showError(errEl, 'Username and PIN are required.'); return; }
  const event = authMode === 'signup' ? 'auth_signup' : 'auth_login';
  socket.emit(event, { username, pin }, (res) => {
    if (res?.error) { showError(errEl, res.error); return; }
    authUser  = res.user;
    authToken = res.token;
    setStoredToken(authToken);
    paintAuthBar();
    document.getElementById('authModal').classList.add('hidden');
    document.getElementById('authPinInput').value = '';
  });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  socket.emit('auth_logout', { token: authToken }, () => {
    authUser  = null;
    authToken = null;
    setStoredToken(null);
    paintAuthBar();
  });
});

/* ── My Library ── */
document.getElementById('openLibraryBtn').addEventListener('click', () => {
  if (!authUser) return;
  document.getElementById('libraryModal').classList.remove('hidden');
  refreshLibraryRooms();
  refreshLibraryWorlds();
});
document.getElementById('closeLibraryBtn').addEventListener('click', () => {
  document.getElementById('libraryModal').classList.add('hidden');
});
document.getElementById('libraryModal').addEventListener('click', (e) => {
  if (e.target.id === 'libraryModal') document.getElementById('libraryModal').classList.add('hidden');
});
document.querySelectorAll('.lib-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lib-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.libtab;
    document.getElementById('libRooms').classList.toggle('hidden', tab !== 'rooms');
    document.getElementById('libWorlds').classList.toggle('hidden', tab !== 'worlds');
  });
});

function fmtElapsed(sec) {
  const d = Math.floor((Date.now() / 1000) - sec);
  if (d < 60)        return `${d}s ago`;
  if (d < 60 * 60)   return `${Math.floor(d / 60)}m ago`;
  if (d < 60 * 60 * 24) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function refreshLibraryRooms() {
  socket.emit('list_my_rooms', {}, (res) => {
    const list = document.getElementById('libRoomsList');
    const empty = document.getElementById('libRoomsEmpty');
    list.innerHTML = '';
    if (!res?.ok || !res.rooms?.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    res.rooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'library-card';
      card.innerHTML = `
        <div class="lib-card-head">
          <strong>🎲 ${escHtml(r.id)}</strong>
          <span class="lib-tag lib-tag-phase ${escHtml(r.phase)}">${escHtml(r.phase)}</span>
          ${r.hasBible ? '<span class="lib-tag">📚 Bible</span>' : ''}
        </div>
        <div class="lib-meta">${r.worldName ? `🌍 ${escHtml(r.worldName)}` : '<em>No world</em>'} · ${fmtElapsed(r.updatedAt)}</div>
        <div class="lib-actions">
          <button class="btn-primary btn-sm" data-action="resume" data-room="${escHtml(r.id)}">Resume →</button>
        </div>
      `;
      list.appendChild(card);
    });
  });
}
document.getElementById('libRoomsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="resume"]');
  if (!btn) return;
  const roomId = btn.dataset.room;
  document.getElementById('roomId').value = roomId;
  document.getElementById('libraryModal').classList.add('hidden');
  // Pre-fill the name input if we know it; otherwise let the user fill it.
  // Then trigger Enter as Player.
  const name = document.getElementById('playerName').value.trim();
  if (!name) { showError(document.getElementById('lobbyError'), 'Enter your name to resume this room.'); return; }
  document.getElementById('joinBtn').click();
});

function refreshLibraryWorlds() {
  socket.emit('list_my_worlds', {}, (res) => {
    const list = document.getElementById('libWorldsList');
    const empty = document.getElementById('libWorldsEmpty');
    list.innerHTML = '';
    if (!res?.ok || !res.worlds?.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    res.worlds.forEach(w => {
      const card = document.createElement('div');
      card.className = 'library-card';
      card.innerHTML = `
        <div class="lib-card-head">
          <strong>🌍 ${escHtml(w.name)}</strong>
          ${w.hasBible ? '<span class="lib-tag">📚 Bible</span>' : ''}
        </div>
        <div class="lib-meta">From room <code>${escHtml(w.roomId)}</code> · ${fmtElapsed(w.updatedAt)}</div>
        <div class="lib-actions">
          <button class="btn-primary btn-sm" data-action="clone" data-source="${escHtml(w.roomId)}">Use in new room →</button>
        </div>
      `;
      list.appendChild(card);
    });
  });
}
document.getElementById('libWorldsList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="clone"]');
  if (!btn) return;
  const sourceRoomId = btn.dataset.source;
  const newRoomId = prompt('New room code for this world:', '');
  if (!newRoomId) return;
  socket.emit('clone_world_to_new_room', { sourceRoomId, newRoomId: newRoomId.trim() }, (res) => {
    if (res?.error) { alert(res.error); return; }
    document.getElementById('roomId').value = newRoomId.trim();
    document.getElementById('libraryModal').classList.add('hidden');
    const name = document.getElementById('playerName').value.trim();
    if (!name) { showError(document.getElementById('lobbyError'), 'Enter your name, then click Enter as Player to use this world.'); return; }
    document.getElementById('joinBtn').click();
  });
});

/* ── Campaign Bible (world prep) ── */
let currentBible = null;

function showBiblePanel() {
  document.getElementById('biblePanel').classList.remove('hidden');
}
function hideBiblePanel() {
  document.getElementById('biblePanel').classList.add('hidden');
}

function setBibleButtons(hasBible) {
  document.getElementById('prepareBibleBtn').classList.toggle('hidden', hasBible);
  document.getElementById('openBibleBtn').classList.toggle('hidden', !hasBible);
  document.getElementById('regenBibleBtn').classList.toggle('hidden', !hasBible);
}

document.getElementById('prepareBibleBtn').addEventListener('click', () => {
  showBiblePanel();
  document.getElementById('bibleStatus').textContent = 'Preparing...';
  document.getElementById('bibleProgress').classList.remove('hidden');
  document.getElementById('bibleContent').classList.add('hidden');
  document.getElementById('bibleError').classList.add('hidden');
  socket.emit('prepare_bible', {}, (res) => {
    if (res?.error) {
      const err = document.getElementById('bibleError');
      err.textContent = res.error;
      err.classList.remove('hidden');
      document.getElementById('bibleProgress').classList.add('hidden');
    }
  });
});

document.getElementById('openBibleBtn').addEventListener('click', () => {
  showBiblePanel();
  if (currentBible) renderBible(currentBible);
});

document.getElementById('closeBibleBtn').addEventListener('click', hideBiblePanel);

document.getElementById('regenBibleBtn').addEventListener('click', () => {
  if (!confirm('Regenerate the bible? This replaces the current one.')) return;
  currentBible = null;
  document.getElementById('prepareBibleBtn').click();
});

socket.on('bible_start', () => {
  document.getElementById('bibleStatus').textContent = 'Generating...';
  document.getElementById('bibleProgress').classList.remove('hidden');
  document.getElementById('bibleContent').classList.add('hidden');
});

socket.on('bible_progress', ({ bytes }) => {
  document.getElementById('bibleProgress').textContent = `Writing bible... (${bytes} chars)`;
});

socket.on('bible_done', ({ bible, error }) => {
  document.getElementById('bibleProgress').classList.add('hidden');
  if (error) {
    const err = document.getElementById('bibleError');
    err.textContent = error;
    err.classList.remove('hidden');
    document.getElementById('bibleStatus').textContent = 'Failed';
    return;
  }
  currentBible = bible;
  document.getElementById('bibleStatus').textContent = `${bible.locations.length} locations · ${bible.factions.length} factions · ${bible.ground_rules.length} rules`;
  renderBible(bible);
  setBibleButtons(true);
});

function renderBible(bible) {
  const host = document.getElementById('bibleContent');
  host.classList.remove('hidden');
  host.innerHTML = `
    <section class="bible-section">
      <h5>🗺 Locations</h5>
      <div id="bibleLocations" class="bible-cards"></div>
    </section>
    <section class="bible-section">
      <h5>🏰 Factions</h5>
      <div id="bibleFactions" class="bible-cards"></div>
    </section>
    <section class="bible-section">
      <h5>📅 Calendar</h5>
      <div id="bibleCalendar"></div>
    </section>
    <section class="bible-section">
      <h5>⚖️ Ground Rules</h5>
      <ul id="bibleRules" class="bible-rules"></ul>
    </section>
  `;
  renderBibleLocations(bible);
  renderBibleFactions(bible);
  renderBibleCalendar(bible);
  renderBibleRules(bible);
}

function saveBible() {
  socket.emit('update_bible', { bible: currentBible }, () => {});
}

function renderBibleLocations(bible) {
  const host = document.getElementById('bibleLocations');
  host.innerHTML = '';
  bible.locations.forEach((loc, idx) => {
    const card = document.createElement('div');
    card.className = 'bible-card';
    card.innerHTML = `
      <div class="bible-card-head">
        <strong class="bcard-name" data-path="locations.${idx}.name">${escHtml(loc.name)}</strong>
        <span class="bcard-meta">${escHtml(loc.terrain || '')}${loc.region ? ` · ${escHtml(loc.region)}` : ''}</span>
        <button class="bcard-edit" data-section="location" data-idx="${idx}">✎ Edit</button>
      </div>
      <div class="bcard-body">
        <p><em>${escHtml(loc.description || '')}</em></p>
        ${loc.ambience ? `<p><b>Ambience:</b> ${escHtml(loc.ambience)}</p>` : ''}
        ${loc.danger ? `<p><b>Danger:</b> ${escHtml(loc.danger)}</p>` : ''}
        ${(loc.notable || []).length ? `<ul>${loc.notable.map(n => `<li>${escHtml(n)}</li>`).join('')}</ul>` : ''}
      </div>
    `;
    card.querySelector('.bcard-edit').addEventListener('click', () => editLocation(idx));
    host.appendChild(card);
  });
}

function editLocation(idx) {
  const loc = currentBible.locations[idx];
  const card = document.querySelectorAll('#bibleLocations .bible-card')[idx];
  card.innerHTML = `
    <div class="bcard-edit-form">
      <label>Name <input id="locEditName" value="${escHtml(loc.name)}" /></label>
      <label>Terrain <input id="locEditTerrain" value="${escHtml(loc.terrain || '')}" /></label>
      <label>Region <input id="locEditRegion" value="${escHtml(loc.region || '')}" /></label>
      <label>Description <textarea id="locEditDesc" rows="3">${escHtml(loc.description || '')}</textarea></label>
      <label>Ambience <input id="locEditAmb" value="${escHtml(loc.ambience || '')}" /></label>
      <label>Danger <input id="locEditDanger" value="${escHtml(loc.danger || '')}" /></label>
      <label>Notable (one per line) <textarea id="locEditNotable" rows="3">${escHtml((loc.notable || []).join('\n'))}</textarea></label>
      <div class="bcard-actions">
        <button class="btn-primary btn-sm" id="locEditSave">Save</button>
        <button class="btn-secondary btn-sm" id="locEditCancel">Cancel</button>
      </div>
    </div>
  `;
  card.querySelector('#locEditSave').addEventListener('click', () => {
    loc.name     = card.querySelector('#locEditName').value.trim() || loc.name;
    loc.terrain  = card.querySelector('#locEditTerrain').value.trim();
    loc.region   = card.querySelector('#locEditRegion').value.trim();
    loc.description = card.querySelector('#locEditDesc').value.trim();
    loc.ambience = card.querySelector('#locEditAmb').value.trim();
    loc.danger   = card.querySelector('#locEditDanger').value.trim();
    loc.notable  = card.querySelector('#locEditNotable').value.split('\n').map(s => s.trim()).filter(Boolean);
    saveBible();
    renderBibleLocations(currentBible);
  });
  card.querySelector('#locEditCancel').addEventListener('click', () => renderBibleLocations(currentBible));
}

function renderBibleFactions(bible) {
  const host = document.getElementById('bibleFactions');
  host.innerHTML = '';
  const locById = Object.fromEntries(bible.locations.map(l => [l.id, l]));
  const facById = Object.fromEntries(bible.factions.map(f => [f.id, f]));
  bible.factions.forEach((fac, idx) => {
    const card = document.createElement('div');
    card.className = 'bible-card';
    const base = fac.base_location_id && locById[fac.base_location_id];
    const rels = Object.entries(fac.relationships || {}).map(([id, kind]) =>
      facById[id] ? `<span class="rel rel-${escHtml(kind)}">${escHtml(facById[id].name)}: ${escHtml(kind)}</span>` : ''
    ).filter(Boolean).join(' ');
    card.innerHTML = `
      <div class="bible-card-head">
        <strong>${escHtml(fac.name)}</strong>
        ${base ? `<span class="bcard-meta">base: ${escHtml(base.name)}</span>` : ''}
        <button class="bcard-edit" data-section="faction" data-idx="${idx}">✎ Edit</button>
      </div>
      <div class="bcard-body">
        ${fac.purpose ? `<p><b>Purpose:</b> ${escHtml(fac.purpose)}</p>` : ''}
        ${fac.methods ? `<p><b>Methods:</b> ${escHtml(fac.methods)}</p>` : ''}
        ${fac.notable ? `<p><em>${escHtml(fac.notable)}</em></p>` : ''}
        ${rels ? `<div class="bcard-rels">${rels}</div>` : ''}
      </div>
    `;
    card.querySelector('.bcard-edit').addEventListener('click', () => editFaction(idx));
    host.appendChild(card);
  });
}

function editFaction(idx) {
  const fac = currentBible.factions[idx];
  const card = document.querySelectorAll('#bibleFactions .bible-card')[idx];
  card.innerHTML = `
    <div class="bcard-edit-form">
      <label>Name <input id="facEditName" value="${escHtml(fac.name)}" /></label>
      <label>Purpose <input id="facEditPurpose" value="${escHtml(fac.purpose || '')}" /></label>
      <label>Methods <input id="facEditMethods" value="${escHtml(fac.methods || '')}" /></label>
      <label>Notable <input id="facEditNotable" value="${escHtml(fac.notable || '')}" /></label>
      <div class="bcard-actions">
        <button class="btn-primary btn-sm" id="facEditSave">Save</button>
        <button class="btn-secondary btn-sm" id="facEditCancel">Cancel</button>
      </div>
    </div>
  `;
  card.querySelector('#facEditSave').addEventListener('click', () => {
    fac.name     = card.querySelector('#facEditName').value.trim() || fac.name;
    fac.purpose  = card.querySelector('#facEditPurpose').value.trim();
    fac.methods  = card.querySelector('#facEditMethods').value.trim();
    fac.notable  = card.querySelector('#facEditNotable').value.trim();
    saveBible();
    renderBibleFactions(currentBible);
  });
  card.querySelector('#facEditCancel').addEventListener('click', () => renderBibleFactions(currentBible));
}

function renderBibleCalendar(bible) {
  const host = document.getElementById('bibleCalendar');
  const cal = bible.calendar || { current_era: '', recent_events: [] };
  host.innerHTML = `
    <div class="calendar-era"><b>Era:</b> <span id="calEraText">${escHtml(cal.current_era || '—')}</span>
      <button class="btn-secondary btn-sm" id="calEditBtn">✎</button>
    </div>
    <ul class="calendar-events">
      ${(cal.recent_events || []).map((e, i) => `
        <li><b>${escHtml(e.when || '')}</b> — ${escHtml(e.text || '')}
          <button class="cal-ev-edit" data-idx="${i}">✎</button>
          <button class="cal-ev-del"  data-idx="${i}">✕</button>
        </li>`).join('')}
    </ul>
    <button class="btn-secondary btn-sm" id="calAddEventBtn">+ Add Event</button>
  `;
  host.querySelector('#calEditBtn').addEventListener('click', () => {
    const v = prompt('Current era:', cal.current_era || '');
    if (v !== null) { cal.current_era = v.trim(); saveBible(); renderBibleCalendar(currentBible); }
  });
  host.querySelectorAll('.cal-ev-edit').forEach(btn => btn.addEventListener('click', () => {
    const i = parseInt(btn.dataset.idx);
    const ev = cal.recent_events[i];
    const when = prompt('When:', ev.when || '');
    if (when === null) return;
    const text = prompt('Event:', ev.text || '');
    if (text === null) return;
    ev.when = when.trim(); ev.text = text.trim();
    saveBible(); renderBibleCalendar(currentBible);
  }));
  host.querySelectorAll('.cal-ev-del').forEach(btn => btn.addEventListener('click', () => {
    cal.recent_events.splice(parseInt(btn.dataset.idx), 1);
    saveBible(); renderBibleCalendar(currentBible);
  }));
  host.querySelector('#calAddEventBtn').addEventListener('click', () => {
    const when = prompt('When:'); if (when === null) return;
    const text = prompt('Event:'); if (text === null) return;
    cal.recent_events.push({ when: when.trim(), text: text.trim() });
    saveBible(); renderBibleCalendar(currentBible);
  });
}

function renderBibleRules(bible) {
  const host = document.getElementById('bibleRules');
  host.innerHTML = '';
  (bible.ground_rules || []).forEach((rule, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escHtml(rule)}</span>
      <button class="rule-edit" data-idx="${i}">✎</button>
      <button class="rule-del"  data-idx="${i}">✕</button>`;
    li.querySelector('.rule-edit').addEventListener('click', () => {
      const v = prompt('Rule:', rule);
      if (v !== null) { bible.ground_rules[i] = v.trim(); saveBible(); renderBibleRules(currentBible); }
    });
    li.querySelector('.rule-del').addEventListener('click', () => {
      bible.ground_rules.splice(i, 1);
      saveBible(); renderBibleRules(currentBible);
    });
    host.appendChild(li);
  });
  const addLi = document.createElement('li');
  addLi.className = 'rule-add-li';
  addLi.innerHTML = `<button class="btn-secondary btn-sm" id="addRuleBtn">+ Add Rule</button>`;
  addLi.querySelector('#addRuleBtn').addEventListener('click', () => {
    const v = prompt('New rule:');
    if (v) { bible.ground_rules.push(v.trim()); saveBible(); renderBibleRules(currentBible); }
  });
  host.appendChild(addLi);
}

/* ── Persona modal + AI party ── */
const DEFAULT_PERSONA_RACES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Tiefling', 'Half-Orc'];
const DEFAULT_PERSONA_CLASSES = ['Fighter', 'Wizard', 'Rogue', 'Cleric', 'Ranger', 'Barbarian'];

function fillPersonaFormOptions() {
  const raceSel = document.getElementById('pRace');
  const clsSel  = document.getElementById('pClass');
  if (raceSel && !raceSel.options.length) {
    DEFAULT_PERSONA_RACES.forEach(r => raceSel.add(new Option(r, r)));
  }
  if (clsSel && !clsSel.options.length) {
    DEFAULT_PERSONA_CLASSES.forEach(c => clsSel.add(new Option(c, c)));
  }
}

function openPersonaModal() {
  fillPersonaFormOptions();
  document.getElementById('personaModal').classList.remove('hidden');
  refreshPersonaList();
}
function closePersonaModal() {
  document.getElementById('personaModal').classList.add('hidden');
}

document.getElementById('addAiBtn').addEventListener('click', openPersonaModal);
document.getElementById('closePersonaModal').addEventListener('click', closePersonaModal);
document.getElementById('personaModal').addEventListener('click', (e) => {
  if (e.target.id === 'personaModal') closePersonaModal();
});

document.querySelectorAll('.pm-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pm-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.pmtab;
    document.getElementById('pmLibrary').classList.toggle('hidden', tab !== 'library');
    document.getElementById('pmCreate').classList.toggle('hidden', tab !== 'create');
  });
});

function refreshPersonaList() {
  socket.emit('list_personas', {}, (res) => {
    personaCache = res?.personas || [];
    const list = document.getElementById('personaList');
    const empty = document.getElementById('personaEmpty');
    list.innerHTML = '';
    if (!personaCache.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    personaCache.forEach(p => {
      const card = document.createElement('div');
      card.className = 'persona-card';
      card.innerHTML = `
        <div class="persona-top">
          <span class="persona-icon">${escHtml(p.icon || '🧙')}</span>
          <div>
            <div class="persona-name">${escHtml(p.name)}</div>
            <div class="persona-rc">${escHtml(p.race)} ${escHtml(p.class)}</div>
          </div>
          <button class="persona-del" data-id="${escHtml(p.id)}" title="Delete">🗑</button>
        </div>
        ${p.personality ? `<div class="persona-line"><b>Personality:</b> ${escHtml(p.personality)}</div>` : ''}
        ${p.speech      ? `<div class="persona-line"><b>Speech:</b> ${escHtml(p.speech)}</div>` : ''}
        ${p.goals       ? `<div class="persona-line"><b>Goals:</b> ${escHtml(p.goals)}</div>` : ''}
        ${p.quirks      ? `<div class="persona-line"><b>Quirks:</b> ${escHtml(p.quirks)}</div>` : ''}
        <button class="btn-primary btn-sm persona-add" data-id="${escHtml(p.id)}">+ Add to Party</button>
      `;
      list.appendChild(card);
    });
  });
}

document.getElementById('personaList').addEventListener('click', (e) => {
  const addBtn = e.target.closest('.persona-add');
  const delBtn = e.target.closest('.persona-del');
  if (addBtn) {
    socket.emit('add_ai_player', { personaId: addBtn.dataset.id }, (res) => {
      if (res?.error) alert(res.error);
      else { closePersonaModal(); refreshAiPartyList(); }
    });
  } else if (delBtn) {
    if (!confirm('Delete this persona from your library?')) return;
    socket.emit('delete_persona', { id: delBtn.dataset.id }, () => refreshPersonaList());
  }
});

document.getElementById('savePersonaBtn').addEventListener('click', () => {
  const persona = {
    name:        document.getElementById('pName').value.trim(),
    icon:        document.getElementById('pIcon').value.trim() || '🧙',
    race:        document.getElementById('pRace').value,
    class:       document.getElementById('pClass').value,
    personality: document.getElementById('pPersonality').value.trim(),
    speech:      document.getElementById('pSpeech').value.trim(),
    goals:       document.getElementById('pGoals').value.trim(),
    quirks:      document.getElementById('pQuirks').value.trim(),
  };
  const errEl = document.getElementById('pmError');
  if (!persona.name) { showError(errEl, 'Name is required.'); return; }
  socket.emit('create_persona', { persona }, (res) => {
    if (res?.error) { showError(errEl, res.error); return; }
    ['pName','pPersonality','pSpeech','pGoals','pQuirks'].forEach(id => { document.getElementById(id).value = ''; });
    document.querySelector('.pm-tab[data-pmtab="library"]').click();
    refreshPersonaList();
  });
});

function refreshAiPartyList() {
  const listEl = document.getElementById('aiPartyList');
  if (!listEl) return;
  const aiMembers = (currentSnapshot?.players || []).filter(p => p.isAi);
  if (!aiMembers.length) {
    listEl.innerHTML = '<div class="ai-empty">No AI personas yet. Add some to watch them play!</div>';
    return;
  }
  listEl.innerHTML = '';
  aiMembers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'ai-party-row';
    row.innerHTML = `
      <span class="ai-chip">${escHtml(p.persona?.icon || '🤖')}</span>
      <span class="ai-chip-name">${escHtml(p.name)}</span>
      <span class="ai-chip-rc">${escHtml(p.race || '')} ${escHtml(p.class || '')}</span>
      <button class="ai-remove" data-id="${escHtml(p.socketId)}" title="Remove">✕</button>
    `;
    row.querySelector('.ai-remove').addEventListener('click', () => {
      socket.emit('remove_ai_player', { aiId: p.socketId }, () => refreshAiPartyList());
    });
    listEl.appendChild(row);
  });
}

/* ── Pause / resume AI turns ── */
document.getElementById('pauseBtn').addEventListener('click', () => {
  if (isPaused) socket.emit('resume_watch', {}, () => {});
  else          socket.emit('pause_watch',  {}, () => {});
});

function updatePauseBtn(snapshot) {
  const btn = document.getElementById('pauseBtn');
  const hasAi = (snapshot.players || []).some(p => p.isAi);
  if (hasAi && snapshot.phase === 'adventure') btn.classList.remove('hidden');
  else btn.classList.add('hidden');
  isPaused = !!snapshot.paused;
  btn.textContent = isPaused ? '▶ Resume' : '⏸ Pause AI';
}

/* ── Socket events ── */
socket.on('connect', () => {
  mySocketId = socket.id;
  // After every (re)connect, attempt to resume the saved session so the lobby
  // chip stays accurate. Anonymous users are unaffected.
  tryAutoResume();
});

socket.on('room_update', (snapshot) => {
  currentSnapshot = snapshot;
  renderPartyCards(snapshot.players, snapshot.currentTurnSocketId);
  renderMyCard(snapshot);
  renderRoomInfo(snapshot);
  renderInitiativeStrip(snapshot);
  renderInventory(snapshot);
  renderNpcList(snapshot.npcs || []);
  refreshAiPartyList();
  updatePauseBtn(snapshot);
  // Sync language picker(s) with the room's current language.
  if (snapshot.language) {
    for (const id of ['languageSelect', 'languageSelectWait']) {
      const sel = document.getElementById(id);
      if (sel && sel.value !== snapshot.language) sel.value = snapshot.language;
    }
  }
  // Sync world display for players who joined after world was set
  if (snapshot.world) {
    const name = snapshot.world._name || wbExtractName(snapshot.world.name_tone || '') || 'World';
    document.getElementById('worldNameBadge').textContent = name;
    document.getElementById('worldDisplay').classList.remove('hidden');
    document.getElementById('toggleWorldBuilder').classList.add('hidden');
    updateWaitWorldBadge(snapshot.world);
    updateWsContinueBtn(true);
    if (snapshot.world.bible) {
      currentBible = snapshot.world.bible;
      setBibleButtons(true);
    } else {
      setBibleButtons(false);
    }
  }
});

socket.on('chat', (msg) => appendChat(msg));

socket.on('dm_start', () => {
  streamBuffer = '';
  dmStreamEl = createStreamingMsg();
  const ind = document.getElementById('typingIndicator');
  const lbl = ind.querySelector('.typing-label');
  if (lbl) lbl.textContent = 'Dungeon Master is narrating...';
  ind.classList.remove('hidden');
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
  updateWsContinueBtn(true);
  updateWaitWorldBadge(world);
  if (currentSnapshot) renderRoomInfo({ ...currentSnapshot, world });
});

function updateWaitWorldBadge(world) {
  const el = document.getElementById('waitWorldBadge');
  if (!el) return;
  if (!world) { el.classList.add('hidden'); return; }
  const name = world._name || wbExtractName(world.name_tone || '') || 'World';
  el.textContent = `🌍 Playing in: ${name}`;
  el.classList.remove('hidden');
}

socket.on('ai_thinking', ({ name }) => {
  const ind = document.getElementById('typingIndicator');
  const lbl = ind.querySelector('.typing-label');
  if (lbl) lbl.textContent = `${name} is deciding...`;
  ind.classList.remove('hidden');
});

socket.on('ai_thinking_done', () => {
  const ind = document.getElementById('typingIndicator');
  const lbl = ind.querySelector('.typing-label');
  if (lbl) lbl.textContent = 'Dungeon Master is narrating...';
  // Don't hide here — DM narration will immediately take over. dm_end hides it.
});

socket.on('log_replay', ({ entries }) => {
  (entries || []).forEach(e => {
    if (e.type === 'dm')       appendChat({ type: 'dm', text: e.text });
    else if (e.type === 'player') appendChat({ type: 'player', name: e.actor, text: e.text });
    else if (e.type === 'roll')   appendChat({ type: 'roll', text: e.text });
    else                          appendChat({ type: 'system', text: e.text });
  });
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
  // 5e proficiency bonus at level 1 = +2.
  const profBonus = 2;
  const profs = new Set(char.proficiencies || []);
  SKILLS.forEach(skill => {
    const val = char.stats[skill.stat] || 10;
    const baseMod = Math.floor((val - 10) / 2);
    const isProficient = profs.has(skill.name);
    const mod = baseMod + (isProficient ? profBonus : 0);
    const modStr = (mod >= 0 ? '+' : '') + mod;
    const notation = mod >= 0 ? `1d20+${mod}` : `1d20${mod}`;
    const div = document.createElement('div');
    div.className = 'skill-row' + (isProficient ? ' proficient' : '');
    div.title = `Roll ${skill.name} (${skill.stat.toUpperCase()})${isProficient ? ' [proficient +' + profBonus + ']' : ''}`;
    div.innerHTML = `
      <span class="skill-prof">${isProficient ? '●' : '○'}</span>
      <span class="skill-name">${escHtml(skill.name)}</span>
      <span class="skill-stat">${skill.stat.toUpperCase()}</span>
      <span class="skill-mod">${modStr}</span>
    `;
    div.addEventListener('click', () => {
      const name = char.name;
      socket.emit('roll_dice', { notation }, (res) => {
        if (res.error) { appendChat({ type: 'system', text: `Dice error: ${res.error}` }); return; }
        const modPart = mod !== 0 ? (mod > 0 ? `+${mod}` : `${mod}`) : '';
        const profTag = isProficient ? ' (prof)' : '';
        appendChat({ type: 'roll', text: `🎲 ${name} rolled ${skill.name}${profTag}: [${res.result.rolls.join(', ')}]${modPart} = **${res.result.total}**` });
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

  const aiBadge = char.isAi ? `<span class="ai-badge" title="AI-controlled">🤖 AI</span>` : '';
  const portrait = char.portrait || (char.isAi ? (char.persona?.icon || '🤖') : '🧝');
  const bgLine = char.background ? `<div class="char-bg">📖 ${escHtml(char.background)}${char.alignment ? ` · ${escHtml(char.alignment)}` : ''}</div>` : (char.alignment ? `<div class="char-bg">${escHtml(char.alignment)}</div>` : '');
  el.innerHTML = `
    <div class="char-head-row">
      <span class="char-portrait">${escHtml(portrait)}</span>
      <div class="char-head-text">
        <div class="char-name">${escHtml(char.name)} ${aiBadge}</div>
        <div class="char-class">${char.race ? `${escHtml(char.race)} ` : ''}${escHtml(char.class)}</div>
      </div>
    </div>
    ${bgLine}
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
