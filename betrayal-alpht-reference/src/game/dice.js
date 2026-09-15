function randomIntFromMathRandom(maximum) {
  return Math.floor(Math.random() * maximum);
}

function rollDice(count, randomInt = randomIntFromMathRandom) {
  if (!Number.isInteger(count) || count < 0 || count > 2) {
    throw new RangeError('骰子數量必須是 0、1 或 2。');
  }

  const dice = Array.from({ length: count }, () => {
    const value = randomInt(3);

    if (!Number.isInteger(value) || value < 0 || value > 2) {
      throw new RangeError('骰面必須是 0、1 或 2。');
    }

    return value;
  });

  return {
    dice,
    total: dice.reduce((total, value) => total + value, 0),
  };
}

function rollTraitCheck(traitValues, diceCount, randomInt) {
  const dice = rollDice(diceCount, randomInt);
  const base = Object.values(traitValues).reduce((total, value) => total + value, 0);

  return {
    base,
    dice,
    total: base + dice.total,
  };
}

module.exports = {
  rollDice,
  rollTraitCheck,
};
