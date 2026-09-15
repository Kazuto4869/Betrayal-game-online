const CARD_DATA_VERSION = 'phase-5-v1';

function freezeCard(card) {
  return Object.freeze({
    ...card,
    effect: Object.freeze({ ...card.effect }),
  });
}

const ITEM_CARDS = Object.freeze([
  freezeCard({
    id: 'item-lucky-charm',
    type: 'item',
    name: '幸運護符',
    description: '獲得 1 點理智。',
    effect: { kind: 'gain-trait', trait: 'sanity', amount: 1 },
  }),
]);

module.exports = {
  CARD_DATA_VERSION,
  ITEM_CARDS,
};
