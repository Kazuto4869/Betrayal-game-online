const MESSAGE_EVENT = 'message';
const ROOM_STATE = 'room:state';
const ERROR_REJECTED = 'error:rejected';

function createEnvelope(type, requestId, payload) {
  return {
    type,
    requestId: requestId ?? null,
    payload,
  };
}

module.exports = {
  ERROR_REJECTED,
  MESSAGE_EVENT,
  ROOM_STATE,
  createEnvelope,
};
