const CARD_DATA_VERSION = 'phase-5-v1';

function freezeCard(card) {
  return Object.freeze({
    ...card,
    effect: Object.freeze({ ...card.effect }),
  });
}

const EVENT_CARDS = Object.freeze([
  freezeCard({
    id: 'event-whispers',
    type: 'event',
    name: '低語',
    description: '陰影中的低語使你失去 1 點理智。',
    effect: { kind: 'lose-trait', trait: 'sanity', amount: 1 },
  }),
  freezeCard({
    id: 'event-cold-hall',
    type: 'event',
    name: '寒冷長廊',
    description: '凜冽的寒氣使你失去 1 點速度。',
    effect: { kind: 'lose-trait', trait: 'speed', amount: 1 },
  }),
]);

module.exports = {
  CARD_DATA_VERSION,
  EVENT_CARDS,
};
