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

async function streamDMResponse(history, partyContext, onChunk, onDone) {
  const messages = history.map(h => ({ role: h.role, content: h.content }));

  // Inject current party state as a system-level user note before the last user message
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

async function generateOpeningScene(setting, partyContext) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Begin a new adventure. Setting preference: "${setting || 'classic fantasy'}"\n\n${partyContext}\n\nSet the scene and give the party their first hook.`,
      },
    ],
  });
  return response.content[0].text;
}

module.exports = { streamDMResponse, generateOpeningScene };
