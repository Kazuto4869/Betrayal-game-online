const { cloneGameState } = require('./gameState');
const { drawCard, returnCard } = require('./decks');
const { rollDice } = require('./dice');
const { getInitialTraits } = require('./traits');
const { triggerMummyWalks } = require('./haunt/traitorAssignment');
const { MUMMY_WALKS } = require('../data/haunts/haunt-1-mummy-walks');

const CARD_TYPES = new Set(['event', 'item', 'omen']);

function cardResolutionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getCardTypeForTile(tile) {
  const icons = Array.isArray(tile?.icons) ? tile.icons : [];
  return ['event', 'item', 'omen'].find((type) => icons.includes(type)) || null;
}

function hasDrawableCard(state, cardType) {
  return CARD_TYPES.has(cardType)
    && Array.isArray(state.decks?.[cardType]?.draw)
    && state.decks[cardType].draw.length > 0;
}

function getLegalCardActions(state, playerNumber) {
  const pending = state.turn?.pendingInteraction;
  if (state.turn?.phase !== 'EXPLORATION'
    || state.turn?.activePlayerNumber !== playerNumber
    || pending?.playerNumber !== playerNumber) {
    return [];
  }

  if (pending.type === 'card-draw' && hasDrawableCard(state, pending.cardType)) {
    return [{ type: 'game:draw-card', cardType: pending.cardType }];
  }
  if (pending.type === 'haunt-roll') {
    return [{ type: 'game:resolve-haunt-roll' }];
  }
  return [];
}

function applyDeterministicEffect(player, effect) {
  if (!effect || (effect.kind !== 'gain-trait' && effect.kind !== 'lose-trait')) {
    return;
  }
  if (!Number.isInteger(effect.amount) || effect.amount < 0 || typeof effect.trait !== 'string') {
    return;
  }

  const traits = player.private.traits || getInitialTraits(player.characterId);
  if (!traits || !Number.isFinite(traits[effect.trait])) {
    return;
  }

  const direction = effect.kind === 'gain-trait' ? 1 : -1;
  player.private.traits = {
    ...traits,
    [effect.trait]: Math.max(0, traits[effect.trait] + (direction * effect.amount)),
  };
}

function publicCardEvent(card) {
  return {
    type: 'card-drawn',
    cardType: card.type,
    title: card.name,
  };
}

function resolveDrawnCard(state, playerNumber, cardType, randomInt) {
  if (!CARD_TYPES.has(cardType)) {
    throw cardResolutionError('unknown-deck-type', '未知的卡牌牌堆類型');
  }
  if (!hasDrawableCard(state, cardType)) {
    throw cardResolutionError('empty-deck', '卡牌牌堆已無可抽取的卡牌');
  }

  const next = cloneGameState(state);
  const player = next.players.find((entry) => entry.playerNumber === playerNumber);
  if (!player) {
    throw cardResolutionError('invalid-player', '找不到抽牌玩家');
  }

  const drawn = drawCard(next.decks, cardType);
  const card = drawn.card;
  next.decks = drawn.decks;
  player.private = player.private || {};

  if (card.type === 'event' || card.type === 'item') {
    applyDeterministicEffect(player, card.effect);
  }

  if (card.type === 'event') {
    next.decks = returnCard(next.decks, card.type, card.id);
  } else {
    player.private.cards = [...(Array.isArray(player.private.cards) ? player.private.cards : []), card];
  }

  if (card.type === 'omen') {
    next.turn.pendingInteraction = {
      type: 'haunt-roll',
      playerNumber,
      cardId: card.id,
    };
  } else {
    next.turn.pendingInteraction = null;
  }

  const event = publicCardEvent(card);
  next.latestPublicLog = {
    type: event.type,
    summary: `${card.type}: ${card.name}`,
  };
  void randomInt;
  return { state: next, event };
}

function resolveHauntRoll(state, playerNumber, randomInt) {
  const pending = state.turn?.pendingInteraction;
  if (pending?.type !== 'haunt-roll' || pending.playerNumber !== playerNumber) {
    throw cardResolutionError('no-pending-haunt-roll', '沒有可結算的 Haunt Roll');
  }

  const next = cloneGameState(state);
  next.haunt.lastRoll = rollDice(1, randomInt);
  next.turn.pendingInteraction = null;
  let resolvedState = next;
  let eventType = 'haunt-roll-resolved';
  if (next.haunt.lastRoll.total >= MUMMY_WALKS.omenThreshold) {
    resolvedState = triggerMummyWalks(next, randomInt);
    eventType = 'haunt-triggered';
  }
  resolvedState.latestPublicLog = {
    type: eventType,
    summary: 'Haunt Roll 已結算',
  };
  return {
    state: resolvedState,
    event: { type: eventType },
  };
}

module.exports = {
  getCardTypeForTile,
  getLegalCardActions,
  hasDrawableCard,
  resolveDrawnCard,
  resolveHauntRoll,
};
