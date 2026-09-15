const CHARACTERS = [
  { id: 'brandon-jaspers', name: 'Brandon Jaspers' },
  { id: 'darrin-flash-williams', name: 'Darrin「Flash」Williams' },
  { id: 'father-rhinehardt', name: 'Father Rhinehardt' },
  { id: 'heather-granville', name: 'Heather Granville' },
  { id: 'jenny-leclerc', name: 'Jenny LeClerc' },
  { id: 'madame-zostra', name: 'Madame Zostra' },
  { id: 'missy-dubourde', name: 'Missy Dubourde' },
  { id: 'ox-bellows', name: 'Ox Bellows' },
  { id: 'peter-akimoto', name: 'Peter Akimoto' },
  { id: 'professor-longfellow', name: 'Professor Longfellow' },
  { id: 'vivian-lopez', name: 'Vivian Lopez' },
  { id: 'zoe-ingstrom', name: 'Zoe Ingstrom' },
];

const CHARACTER_IDS = CHARACTERS.map((character) => character.id);

const TRAITS_BY_CHARACTER_ID = {
  'brandon-jaspers': {
    might: [2, 3, 3, 4, 5, 6],
    speed: [3, 4, 5, 6, 7, 8],
    sanity: [3, 3, 3, 4, 5, 6],
    knowledge: [1, 3, 3, 4, 5, 6],
  },
  'darrin-flash-williams': {
    might: [2, 3, 4, 5, 5, 6],
    speed: [4, 4, 4, 5, 6, 7],
    sanity: [1, 2, 3, 4, 5, 5],
    knowledge: [2, 3, 3, 4, 5, 5],
  },
  'father-rhinehardt': {
    might: [1, 2, 2, 4, 5, 7],
    speed: [2, 3, 3, 4, 5, 6],
    sanity: [4, 5, 6, 7, 7, 8],
    knowledge: [3, 4, 5, 6, 7, 8],
  },
  'heather-granville': {
    might: [3, 3, 3, 4, 5, 6],
    speed: [3, 4, 5, 6, 7, 8],
    sanity: [3, 3, 3, 4, 5, 6],
    knowledge: [2, 3, 3, 4, 5, 6],
  },
  'jenny-leclerc': {
    might: [3, 4, 4, 4, 4, 5],
    speed: [2, 3, 4, 4, 4, 4],
    sanity: [3, 4, 4, 5, 6, 8],
    knowledge: [2, 3, 3, 4, 5, 6],
  },
  'madame-zostra': {
    might: [2, 3, 3, 4, 5, 6],
    speed: [2, 3, 4, 5, 6, 7],
    sanity: [4, 4, 5, 6, 7, 8],
    knowledge: [1, 3, 4, 4, 5, 6],
  },
  'missy-dubourde': {
    might: [2, 3, 3, 4, 5, 6],
    speed: [3, 4, 5, 6, 7, 8],
    sanity: [3, 4, 5, 6, 7, 7],
    knowledge: [2, 3, 4, 4, 5, 6],
  },
  'ox-bellows': {
    might: [4, 5, 6, 6, 7, 8],
    speed: [2, 2, 2, 3, 4, 5],
    sanity: [2, 2, 3, 4, 5, 5],
    knowledge: [2, 2, 3, 3, 5, 5],
  },
  'peter-akimoto': {
    might: [3, 3, 3, 4, 6, 8],
    speed: [4, 4, 4, 5, 6, 7],
    sanity: [3, 4, 4, 4, 5, 6],
    knowledge: [3, 4, 4, 5, 7, 8],
  },
  'professor-longfellow': {
    might: [1, 2, 3, 4, 5, 6],
    speed: [2, 2, 4, 4, 5, 6],
    sanity: [1, 3, 3, 4, 5, 5],
    knowledge: [4, 5, 5, 5, 5, 6],
  },
  'vivian-lopez': {
    might: [2, 2, 2, 4, 4, 5],
    speed: [3, 4, 4, 5, 6, 6],
    sanity: [3, 4, 4, 5, 6, 7],
    knowledge: [4, 5, 5, 5, 5, 6],
  },
  'zoe-ingstrom': {
    might: [1, 2, 3, 3, 4, 4],
    speed: [4, 4, 4, 4, 5, 6],
    sanity: [3, 4, 5, 5, 5, 5],
    knowledge: [2, 4, 4, 5, 5, 5],
  },
};

const CHARACTER_DEFINITIONS = CHARACTERS.map((character) => ({
  version: 'phase-5-v1',
  ...character,
  traits: TRAITS_BY_CHARACTER_ID[character.id],
}));

function getCharacterDefinition(characterId) {
  const definition = CHARACTER_DEFINITIONS.find((character) => character.id === characterId);

  if (!definition) {
    return null;
  }

  return {
    ...definition,
    traits: Object.fromEntries(
      Object.entries(definition.traits).map(([trait, track]) => [trait, [...track]]),
    ),
  };
}

module.exports = {
  CHARACTERS,
  CHARACTER_IDS,
  CHARACTER_DEFINITIONS,
  getCharacterDefinition,
};
