const { rollTraitCheck } = require('./dice');
const { cloneGameState } = require('./gameState');
const { getInitialTraits } = require('./traits');

const COMBAT_TRAIT = 'might';
const COMBAT_DICE_COUNT = 2;

function combatError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getPlayerTraits(player) {
  return player?.private?.traits || getInitialTraits(player?.characterId);
}

function isCombatEligible(player) {
  const traits = getPlayerTraits(player);
  return Number.isFinite(traits?.[COMBAT_TRAIT]) && traits[COMBAT_TRAIT] > 0;
}

function getLegalCombatTargets(state, attackerPlayerNumber) {
  const attacker = state.players?.find(
    (player) => player.playerNumber === attackerPlayerNumber,
  );
  const attackerTileId = state.map?.playerPositions?.[attackerPlayerNumber];
  if (!attackerTileId || !isCombatEligible(attacker)) {
    return [];
  }

  const targets = new Set();
  for (const player of state.players) {
    if (player.playerNumber !== attackerPlayerNumber
      && state.map.playerPositions[player.playerNumber] === attackerTileId
      && isCombatEligible(player)) {
      targets.add(player.playerNumber);
    }
  }
  return [...targets];
}

function getItemCombatBonus(player) {
  const cards = Array.isArray(player?.private?.cards) ? player.private.cards : [];
  return cards.reduce((total, card) => {
    if (card?.type !== 'item') {
      return total;
    }

    const effect = card.effect;
    if (effect?.kind === 'combat-bonus'
      && effect.trait === COMBAT_TRAIT
      && Number.isFinite(effect.amount)
      && effect.amount > 0) {
      return total + effect.amount;
    }
    return total;
  }, 0);
}

function resolveCombat(state, attackerPlayerNumber, targetPlayerNumber, randomInt) {
  if (!getLegalCombatTargets(state, attackerPlayerNumber).includes(targetPlayerNumber)) {
    throw combatError('invalid-target', '戰鬥目標無效');
  }

  const next = cloneGameState(state);
  const attacker = next.players.find(
    (player) => player.playerNumber === attackerPlayerNumber,
  );
  const defender = next.players.find(
    (player) => player.playerNumber === targetPlayerNumber,
  );
  const attackerTraits = getPlayerTraits(attacker);
  const defenderTraits = getPlayerTraits(defender);
  const attackerRoll = rollTraitCheck({
    might: attackerTraits.might,
    itemBonus: getItemCombatBonus(attacker),
  }, COMBAT_DICE_COUNT, randomInt);
  const defenderRoll = rollTraitCheck({
    might: defenderTraits.might,
    itemBonus: getItemCombatBonus(defender),
  }, COMBAT_DICE_COUNT, randomInt);
  const damage = Math.max(0, attackerRoll.total - defenderRoll.total);

  defender.private = defender.private || {};
  defender.private.traits = {
    ...defenderTraits,
    might: Math.max(0, defenderTraits.might - damage),
  };

  const result = {
    attackerPlayerNumber,
    targetPlayerNumber,
    attackerTotal: attackerRoll.total,
    defenderTotal: defenderRoll.total,
    damage,
  };
  next.combat.latestResult = result;
  next.latestPublicLog = {
    type: 'combat-resolved',
    summary: `玩家 ${attackerPlayerNumber} 對玩家 ${targetPlayerNumber} 造成 ${damage} 點傷害`,
  };
  return { state: next, result };
}

module.exports = {
  getLegalCombatTargets,
  resolveCombat,
};
