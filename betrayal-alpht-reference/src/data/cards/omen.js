const CARD_DATA_VERSION = 'phase-5-v1';

function freezeCard(card) {
  return Object.freeze({
    ...card,
    effect: Object.freeze({ ...card.effect }),
  });
}

const OMEN_CARDS = Object.freeze([
  freezeCard({
    id: 'omen-bloodstone',
    type: 'omen',
    name: '血石',
    description: '放置預兆記號並檢查是否觸發作祟。',
    effect: { kind: 'place-omen', omen: 'bloodstone' },
  }),
]);

module.exports = {
  CARD_DATA_VERSION,
  OMEN_CARDS,
};
