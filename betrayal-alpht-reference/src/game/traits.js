const { getCharacterDefinition } = require('../data/characters');

function getInitialTraits(characterId) {
  const character = getCharacterDefinition(characterId);

  if (!character) {
    return null;
  }

  return {
    might: character.traits.might[0],
    speed: character.traits.speed[0],
    sanity: character.traits.sanity[0],
    knowledge: character.traits.knowledge[0],
  };
}

module.exports = {
  getInitialTraits,
};
