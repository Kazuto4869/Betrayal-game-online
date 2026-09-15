import { useStore } from '../store.js';

export function InventoryTray() {
  const state = useStore((s) => s.state);
  const content = useStore((s) => s.content);
  const seatId = useStore((s) => s.seatId);
  const send = useStore((s) => s.send);
  const pending = useStore((s) => s.pendingSeq !== null);

  if (!state || !seatId || !content) return null;
  const player = state.players[seatId];
  if (!player) return null;

  const isMyTurn = state.activeSeat === seatId;
  const allCards = [
    ...player.items.map((id) => ({ id, isOmen: false })),
    ...player.omens.map((id) => ({ id, isOmen: true })),
  ];

  // Living opponents in the same room for attack
  const opponentsInRoom =
    state.phase === 'haunt' && isMyTurn && !player.hasAttackedThisTurn && player.location
      ? Object.values(state.players).filter(
          (other) =>
            other.seatId !== seatId &&
            !other.isDead &&
            !other.removed &&
            other.location === player.location,
        )
      : [];

  return (
    <div className="inventory-tray">
      {opponentsInRoom.length > 0 && (
        <div className="combat-panel">
          <div className="combat-panel__header">⚔️ Combat Opportunities:</div>
          <div className="combat-panel__targets">
            {opponentsInRoom.map((target) => (
              <button
                key={target.seatId}
                type="button"
                className="btn btn--danger btn--small"
                disabled={pending}
                onClick={() =>
                  send({
                    t: 'ATTACK',
                    seat: seatId,
                    target: { kind: 'seat', seatId: target.seatId },
                    trait: 'might',
                  })
                }
              >
                Attack {target.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="inventory-tray__header">
        <span className="inventory-tray__title">
          🎒 Inventory ({allCards.length})
        </span>
      </div>

      {allCards.length === 0 ? (
        <div className="inventory-tray__empty">No items or omens held.</div>
      ) : (
        <div className="inventory-tray__cards">
          {allCards.map(({ id, isOmen }) => {
            const card = content.cardsById[id];
            if (!card) return null;

            return (
              <div
                key={id}
                className={`inventory-card ${
                  isOmen ? 'inventory-card--omen' : 'inventory-card--item'
                }`}
              >
                <div className="inventory-card__top">
                  <span className="inventory-card__badge">
                    {isOmen ? '🔮 Omen' : '🎒 Item'}
                  </span>
                  <span className="inventory-card__name">{card.name}</span>
                </div>
                <div className="inventory-card__text">{card.text}</div>
                <div className="inventory-card__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!isMyTurn || pending}
                    onClick={() =>
                      send({ t: 'USE_ITEM', seat: seatId, cardId: id })
                    }
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    disabled={!isMyTurn || pending}
                    onClick={() =>
                      send({ t: 'DROP', seat: seatId, cardIds: [id] })
                    }
                  >
                    Drop
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
