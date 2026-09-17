export { reduce, type ReduceResult, type ReduceOptions } from './reduce.js';
export { createInitialState, makeSeatId, type CreateStateOptions } from './setup.js';
export { checkInvariants, assertInvariants, InvariantError } from './invariants.js';
export { redactFor, isRedacted } from './redact.js';
export {
  canStart,
  getHostSeat,
  getLegalActions,
  isCharacterTaken,
  isLegalAction,
  isRoomActionEligible,
  nextSeatInOrder,
  takenColours,
  traitValue,
} from './selectors.js';
export {
  makeRng,
  next,
  nextInt,
  rollDie,
  rollDice,
  shuffle,
  type DieFace,
} from './rng.js';
export {
  gainTrait,
  loseTrait,
  setTrait,
  healTrait,
  killExplorer,
  type TraitOperationResult,
} from './traits.js';
export {
  beginTurnFor,
  findPath,
  getConnections,
  getCrossingBarrier,
  getDogConnections,
  getDogPath,
  getDogReachableRooms,
  getMonsterConnections,
  getMonsterLeaveCost,
  getMonsterReachable,
  getReachable,
  getStepDirection,
  rotateDir,
  type CrossingBarrier,
} from './movement.js';
export {
  playGame,
  replay,
  startedGame,
  type PlayGameOptions,
  type PlayGameResult,
} from './testing.js';
