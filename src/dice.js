function roll(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDice(notation) {
  // Parses e.g. "2d6+3", "1d20", "d8"
  const match = notation.toLowerCase().match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return { notation, rolls: [], total: 0, error: 'Invalid dice notation' };

  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const modifier = parseInt(match[3] || '0', 10);

  const rolls = Array.from({ length: count }, () => roll(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;

  return { notation, rolls, modifier, total };
}

module.exports = { roll, rollDice };
