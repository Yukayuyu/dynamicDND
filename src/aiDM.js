const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* Language injection — appended to every system prompt so the model writes
 * narration, dialogue, and bible text in the requested language. JSON keys
 * (used by the bible) stay machine-readable English regardless. */
const LANGUAGE_NAMES = {
  en: 'English', 'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)',
  ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ru: 'Russian',
};
function langInstruction(code) {
  const name = LANGUAGE_NAMES[code] || 'English';
  if (name === 'English') return '';
  return `\n\nIMPORTANT: Respond entirely in ${name}. All narration, NPC dialogue, place names, item names, and prose must be in ${name}. Keep proper nouns natural for ${name} readers (transliterate or translate as appropriate). Markdown formatting like **bold** is fine.`;
}

const SYSTEM_PROMPT = `You are an experienced, creative, and fair Dungeon Master for a 5th-edition-inspired D&D adventure. Your role:

- Narrate vivid, immersive scenes and NPC dialogue in second-person ("You see...", "The goblin snarls...")
- React dynamically to player actions and dice rolls provided in the conversation
- Keep track of the world, NPCs, and consequences of player decisions
- When combat happens, describe outcomes dramatically but consistently with dice results
- If a player rolls high, reward success. If low, add interesting complications (never just flat failure)
- Introduce memorable NPCs, locations, mysteries, and moral dilemmas
- Keep pacing tight; end each narration with a clear prompt for what happens next or what the party sees
- Use **bold** for important names/items, *italics* for emphasis
- Occasionally interject with short DM notes like "[Perception DC 15]" or "[Roll for Initiative]" to cue players
- NEVER directly control player characters — only narrate the world around them

When a player action requires a dice roll, wait for the roll result (provided in the next message) before narrating the outcome.

Current party stats are provided in each message. Use them for context.`;

const WORLD_SYSTEM = `You are a creative worldbuilding assistant for tabletop RPG campaigns.
Be specific, evocative, and concise. Use vivid details that will excite players.
Format your responses cleanly — use short paragraphs or bullet lists where appropriate.`;

const WORLD_STEP_PROMPTS = {
  name_tone: (ctx, desc) =>
    `Generate a unique D&D campaign world. Give it a name and describe its overall tone, atmosphere, and feel in 3-4 evocative sentences. Start with the world name on the first line.${desc ? `\n\nBase it on this concept: "${desc}"` : ''}`,

  geography: (ctx) =>
    `For the D&D world described as: "${(ctx.name_tone || 'a fantasy world').substring(0, 200)}"

Describe 3-4 key locations or regions that adventurers might explore. For each, include the name, terrain/climate, and one thing that makes it memorable or dangerous.`,

  races: (ctx) =>
    `For this D&D world: "${(ctx.name_tone || 'a fantasy world').substring(0, 150)}"

List 4-6 playable races that exist here. For each race, write one sentence describing a distinctive trait, cultural tendency, or physical feature that sets them apart. Format each as:
**Race Name**: description`,

  classes: (ctx) =>
    `For this D&D world: "${(ctx.name_tone || 'a fantasy world').substring(0, 150)}"

From these standard D&D classes: Fighter, Wizard, Rogue, Cleric, Ranger, Barbarian — list which ones exist and give a brief in-world explanation for each. If a class doesn't fit, explain why it's absent or rare.`,

  factions: (ctx) =>
    `For this D&D world: "${(ctx.name_tone || 'a fantasy world').substring(0, 150)}"

Describe 2-3 major factions or power groups that shape this world. For each: name, a one-sentence purpose/goal, and how adventurers might interact with them (ally, enemy, client, rival).`,

  threats: (ctx) =>
    `For this D&D world: "${(ctx.name_tone || 'a fantasy world').substring(0, 150)}"

Describe 4-6 specific threats, monster types, or dangers that adventurers will regularly face. For each threat, give its name and a sentence about what makes it dangerous or interesting in this world's context.`,
};

async function streamDMResponse(history, partyContext, onChunk, onDone, opts = {}) {
  const messages = history.map(h => ({ role: h.role, content: h.content }));

  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    const partyNote = `[PARTY STATUS]\n${partyContext}\n\n[PLAYER ACTION]\n${messages[messages.length - 1].content}`;
    messages[messages.length - 1] = { role: 'user', content: partyNote };
  }

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT + langInstruction(opts.language),
    messages,
  });

  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      full += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }

  onDone(full);
  return full;
}

async function generateOpeningScene(setting, partyContext, world, opts = {}) {
  let worldNote = '';
  if (world?.bible) {
    worldNote = `\nCampaign bible (authoritative — use these names and respect these rules):\n${bibleDigest(world.bible)}`;
  } else if (world?.name_tone) {
    worldNote = `\nWorld context: ${world.name_tone.substring(0, 300)}${world.geography ? `\nKey locations: ${world.geography.substring(0, 200)}` : ''}`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: SYSTEM_PROMPT + langInstruction(opts.language),
    messages: [
      {
        role: 'user',
        content: `Begin a new adventure. Setting preference: "${setting || 'classic fantasy'}"${worldNote}\n\nOpen at one of the bible's named locations if a bible is provided.\n\n${partyContext}\n\nSet the scene and give the party their first hook.`,
      },
    ],
  });
  return response.content[0].text;
}

async function generateWorldStep(step, worldContext, description, onChunk, onDone, opts = {}) {
  const promptFn = WORLD_STEP_PROMPTS[step];
  if (!promptFn) throw new Error(`Unknown world step: ${step}`);

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
    system: WORLD_SYSTEM + langInstruction(opts.language),
    messages: [{ role: 'user', content: promptFn(worldContext, description) }],
  });

  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      full += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }

  onDone(full);
  return full;
}

const AGENT_SYSTEM = `You are role-playing as a single D&D player character at a shared table. Rules you MUST follow:

- Speak and act ONLY as your own character. Never narrate the DM, other player characters, NPCs, or the world's reactions.
- Output 1–2 short sentences total. You may include a brief spoken line in quotes plus one concrete action.
- Stay fully in-character — match the persona's personality, speech style, goals, and quirks.
- Propose what you ATTEMPT; do not decide whether you succeed. Do not roll dice or declare damage. The DM resolves outcomes.
- No stage directions about other characters. No out-of-character meta commentary. No emojis.
- If the situation is combat, pick a clear tactical action (attack, cast, move, dodge, help). If social, pick a clear social move (persuade, lie, intimidate, listen).`;

function personaBlock(persona) {
  const bits = [
    `Name: ${persona.name}`,
    `Race/Class: ${persona.race || 'Human'} ${persona.class || 'Fighter'}`,
  ];
  if (persona.personality) bits.push(`Personality: ${persona.personality}`);
  if (persona.speech)      bits.push(`Speech style: ${persona.speech}`);
  if (persona.goals)       bits.push(`Goals: ${persona.goals}`);
  if (persona.quirks)      bits.push(`Quirks: ${persona.quirks}`);
  return bits.join('\n');
}

function recentNarrativeSnippet(history, limit = 6) {
  // Last few history entries (role + content), trimmed to keep the prompt tight.
  const tail = history.slice(-limit);
  return tail.map(h => {
    const who = h.role === 'assistant' ? 'DM' : 'Party';
    return `${who}: ${String(h.content).substring(0, 500)}`;
  }).join('\n\n');
}

async function generateAiPlayerAction({ persona, partyContext, world, history, language }) {
  const worldNote = world && world.name_tone
    ? `World: ${String(world.name_tone).substring(0, 250)}`
    : '';
  const prompt = [
    `You are this character:\n${personaBlock(persona)}`,
    worldNote,
    `Current party & situation:\n${partyContext}`,
    `Recent narrative:\n${recentNarrativeSnippet(history)}`,
    `It is now your turn. Respond with your character's action in 1–2 short sentences. Do not write "DM:" or speak for anyone else.`,
  ].filter(Boolean).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 160,
    system: AGENT_SYSTEM + langInstruction(language),
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content?.[0]?.text || '';
  return text.replace(/^DM:.*$/gim, '').trim();
}

/* ═════════ World Bible (prep phase) ═════════
 * One Sonnet call produces a structured JSON bible from the confirmed concept.
 * The bible becomes the canonical source of truth at play time so the DM
 * stops drifting on names/rules. */

const BIBLE_SYSTEM = `You are a senior tabletop RPG campaign writer.
You produce a structured CAMPAIGN BIBLE from a world concept. Be specific, concrete, and internally consistent.
Never invent anything that contradicts the provided concept.
Return ONE JSON object and nothing else — no prose before or after, no markdown fence.`;

function buildBiblePrompt(concept) {
  const c = concept || {};
  return `World concept to expand into a playable bible:

NAME & TONE:
${(c.name_tone || '').substring(0, 600)}

GEOGRAPHY (free text):
${(c.geography || '').substring(0, 500)}

FACTIONS (free text):
${(c.factions || '').substring(0, 500)}

THREATS (free text):
${(c.threats || '').substring(0, 500)}

Produce a single JSON object matching EXACTLY this schema (all fields required; arrays must be populated):

{
  "locations": [
    {
      "id": "loc_<short_slug>",
      "name": "string",
      "region": "string (broader region or null)",
      "terrain": "string (1 phrase — desert, port, forest...)",
      "description": "2–3 sentence evocative description of the place",
      "ambience": "1 sentence about sight/sound/smell",
      "danger": "1 sentence: why this place is dangerous or interesting",
      "notable": ["bullet 1","bullet 2","bullet 3"]
    }
  ],
  "factions": [
    {
      "id": "fac_<short_slug>",
      "name": "string",
      "purpose": "1 sentence mission",
      "methods": "1 sentence how they operate",
      "base_location_id": "loc_... or null",
      "relationships": { "other_fac_id": "ally|rival|enemy|neutral|unknown" },
      "notable": "1 sentence about their public reputation"
    }
  ],
  "calendar": {
    "current_era": "short name of the current age",
    "recent_events": [
      { "when": "e.g. '5 years ago'", "text": "1 sentence event the whole world knows" }
    ]
  },
  "ground_rules": [
    "1 sentence rule, taboo, or hard limit of this world (e.g. 'The gods do not answer prayers for the dead.')"
  ]
}

Requirements:
- 5 locations, 3 factions, 4 recent_events, 5 ground_rules.
- Location ids are unique slug_case; faction ids are unique slug_case.
- Every faction's base_location_id must match a location id you produced, or be null.
- Faction relationships reference only ids you produced.
- Keep names consistent with the tone.
- No emojis. No markdown. JSON only.`;
}

function stripJsonFence(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fence ? fence[1] : text).trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return raw;
  return raw.slice(first, last + 1);
}

function validateBible(b) {
  if (!b || typeof b !== 'object') throw new Error('Bible: not an object');
  if (!Array.isArray(b.locations) || !b.locations.length) throw new Error('Bible: locations[] required');
  if (!Array.isArray(b.factions)) b.factions = [];
  if (!b.calendar || typeof b.calendar !== 'object') b.calendar = { current_era: 'the present age', recent_events: [] };
  if (!Array.isArray(b.calendar.recent_events)) b.calendar.recent_events = [];
  if (!Array.isArray(b.ground_rules)) b.ground_rules = [];
  const locIds = new Set(b.locations.map(l => l.id));
  const facIds = new Set(b.factions.map(f => f.id));
  for (const f of b.factions) {
    if (f.base_location_id && !locIds.has(f.base_location_id)) f.base_location_id = null;
    if (f.relationships && typeof f.relationships === 'object') {
      for (const key of Object.keys(f.relationships)) {
        if (!facIds.has(key)) delete f.relationships[key];
      }
    } else {
      f.relationships = {};
    }
  }
  return b;
}

async function prepareBible(concept, onProgress, opts = {}) {
  // For non-English bibles, the JSON KEYS stay English (machine-readable),
  // but the VALUES (names, descriptions, rules) should be in the requested
  // language. Faction/location ids stay slug_case English so they're stable
  // for code references. The bible prompt already requires English ids.
  const lang = LANGUAGE_NAMES[opts.language] || 'English';
  const langSuffix = lang === 'English'
    ? ''
    : `\n\nIMPORTANT: All string VALUES (location names, descriptions, faction names, ground rules, event text, etc.) must be written in ${lang}. JSON keys and the slug-case "id" fields MUST stay English (e.g., "loc_old_port"). Do not output a markdown fence — JSON only.`;
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 3500,
    system: BIBLE_SYSTEM + langSuffix,
    messages: [{ role: 'user', content: buildBiblePrompt(concept) }],
  });

  let raw = '';
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      raw += chunk.delta.text;
      if (onProgress) onProgress(raw.length);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (err) {
    throw new Error(`Bible: JSON parse failed (${err.message})`);
  }
  return validateBible(parsed);
}

/* Compact digest — cheap context injected into every DM turn so the AI
 * references canonical names/rules instead of inventing them. */
function bibleDigest(bible) {
  if (!bible) return '';
  const lines = [];
  if (bible.calendar?.current_era) lines.push(`Era: ${bible.calendar.current_era}`);
  if (bible.calendar?.recent_events?.length) {
    lines.push('Recent world events:');
    bible.calendar.recent_events.slice(0, 4).forEach(e => {
      lines.push(`  - (${e.when || '—'}) ${e.text}`);
    });
  }
  if (bible.locations?.length) {
    lines.push('Locations in scope (use these names exactly):');
    bible.locations.forEach(l => {
      lines.push(`  - ${l.name} [${l.id}] — ${l.terrain || ''}${l.region ? ' / ' + l.region : ''}`);
    });
  }
  if (bible.factions?.length) {
    lines.push('Factions (use these names exactly):');
    bible.factions.forEach(f => {
      lines.push(`  - ${f.name} [${f.id}] — ${f.purpose || ''}`);
    });
  }
  if (bible.ground_rules?.length) {
    lines.push('Hard rules of this world (do not violate):');
    bible.ground_rules.forEach(r => lines.push(`  - ${r}`));
  }
  return lines.join('\n');
}

module.exports = {
  streamDMResponse,
  generateOpeningScene,
  generateWorldStep,
  generateAiPlayerAction,
  prepareBible,
  bibleDigest,
};
