const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function streamDMResponse(history, partyContext, onChunk, onDone) {
  const messages = history.map(h => ({ role: h.role, content: h.content }));

  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    const partyNote = `[PARTY STATUS]\n${partyContext}\n\n[PLAYER ACTION]\n${messages[messages.length - 1].content}`;
    messages[messages.length - 1] = { role: 'user', content: partyNote };
  }

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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

async function generateOpeningScene(setting, partyContext, world) {
  const worldNote = world && world.name_tone
    ? `\nWorld context: ${world.name_tone.substring(0, 300)}${world.geography ? `\nKey locations: ${world.geography.substring(0, 200)}` : ''}`
    : '';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Begin a new adventure. Setting preference: "${setting || 'classic fantasy'}"${worldNote}\n\n${partyContext}\n\nSet the scene and give the party their first hook.`,
      },
    ],
  });
  return response.content[0].text;
}

async function generateWorldStep(step, worldContext, description, onChunk, onDone) {
  const promptFn = WORLD_STEP_PROMPTS[step];
  if (!promptFn) throw new Error(`Unknown world step: ${step}`);

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
    system: WORLD_SYSTEM,
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

module.exports = { streamDMResponse, generateOpeningScene, generateWorldStep };
