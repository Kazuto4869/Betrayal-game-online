const HAUNT_DATA_VERSION = 'phase-6-v1';

const MUMMY_WALKS = Object.freeze({
  version: HAUNT_DATA_VERSION,
  id: 'the-mummy-walks',
  omenThreshold: 1,
  mummy: Object.freeze({
    startTileId: 'entrance',
    movement: 2,
  }),
  objectives: Object.freeze({
    traitor: 'mummy-custody',
    survivor: 'escape-mummy',
  }),
  victory: Object.freeze({
    survivor: 'all-survivors-escape',
    traitor: 'mummy-captures-survivor',
  }),
});

module.exports = {
  HAUNT_DATA_VERSION,
  MUMMY_WALKS,
};
