const { EVENT_CARDS } = require('../data/cards/event');
const { ITEM_CARDS } = require('../data/cards/item');
const { OMEN_CARDS } = require('../data/cards/omen');

const DECK_TYPES = Object.freeze(['event', 'item', 'omen']);
const CARD_BY_ID = new Map(
  [...EVENT_CARDS, ...ITEM_CARDS, ...OMEN_CARDS].map((card) => [card.id, card]),
);

function deckError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDeckType(type) {
  if (!DECK_TYPES.includes(type)) {
    throw deckError('unknown-deck-type', 'Unknown card deck type');
  }
}

function clonePile(cards) {
  return Array.isArray(cards) ? [...cards] : [];
}

function createDeckState({ event, item, omen } = {}) {
  return {
    event: { draw: clonePile(event), discard: [] },
    item: { draw: clonePile(item), discard: [] },
    omen: { draw: clonePile(omen), discard: [] },
  };
}

function cloneDeckState(decks) {
  return Object.fromEntries(DECK_TYPES.map((type) => [type, {
    draw: clonePile(decks?.[type]?.draw),
    discard: clonePile(decks?.[type]?.discard),
  }]));
}

function drawCard(decks, type) {
  assertDeckType(type);
  const draw = decks?.[type]?.draw;
  if (!Array.isArray(draw) || draw.length === 0) {
    throw deckError('empty-deck', 'Card deck is empty');
  }

  const next = cloneDeckState(decks);
  const card = next[type].draw.shift();
  return { card, decks: next };
}

function returnCard(decks, type, cardId) {
  assertDeckType(type);
  const card = CARD_BY_ID.get(cardId);
  if (!card) {
    throw deckError('unknown-card', 'Unknown card');
  }
  if (card.type !== type) {
    throw deckError('wrong-card-pile', 'Card does not belong to this deck');
  }

  const next = cloneDeckState(decks);
  next[type].discard.push(card);
  return next;
}

function getDeckSummary(decks) {
  return Object.fromEntries(DECK_TYPES.map((type) => [type, {
    draw: Array.isArray(decks?.[type]?.draw) ? decks[type].draw.length : 0,
    discard: Array.isArray(decks?.[type]?.discard) ? decks[type].discard.length : 0,
  }]));
}

module.exports = {
  createDeckState,
  drawCard,
  getDeckSummary,
  returnCard,
};
