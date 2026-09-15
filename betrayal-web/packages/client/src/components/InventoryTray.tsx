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

  // Monsters in the same room for attack
  const monstersInRoom =
    state.phase === 'haunt' && isMyTurn && !player.hasAttackedThisTurn && player.location
      ? Object.values(state.monsters ?? {}).filter(
          (m) => !m.isDead && m.location === player.location,
        )
      : [];

  // Tokens in the same room for interaction
  const tokensInRoom =
    isMyTurn && player.location
      ? (state.tokens ?? []).filter(
          (t) => t.location === player.location && !t.flags['completed'],
        )
      : [];

  return (
    <div className="inventory-tray">
      {(opponentsInRoom.length > 0 || monstersInRoom.length > 0) && (
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
            {monstersInRoom.map((monster) => (
              <button
                key={monster.id}
                type="button"
                className="btn btn--danger btn--small"
                disabled={pending}
                onClick={() =>
                  send({
                    t: 'ATTACK',
                    seat: seatId,
                    target: { kind: 'monster', monsterId: monster.id },
                    trait: 'might',
                  })
                }
              >
                Attack 👾 {monster.def} {monster.flags['stunned'] ? '(Stunned)' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {tokensInRoom.length > 0 && (
        <div
          className="token-panel"
          style={{
            margin: '8px 0',
            padding: '8px',
            background: 'rgba(168, 85, 247, 0.1)',
            borderRadius: '6px',
            border: '1px solid rgba(168, 85, 247, 0.3)',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 'bold',
              color: '#c084fc',
              marginBottom: '6px',
            }}
          >
            🪙 Room Objectives & Tokens:
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {tokensInRoom.map((token) => (
              <button
                key={token.id}
                type="button"
                className="btn btn--small btn--primary"
                disabled={pending}
                onClick={() =>
                  send({
                    t: 'ROOM_ACTION',
                    seat: seatId,
                    actionId: 'interact_token',
                  })
                }
              >
                Interact with {token.token}
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

            const isUsable = Boolean(card.onUse && card.onUse.length > 0);

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
                  <span className="inventory-card__name">
                    {card.isWeapon ? `⚔️ ${card.name}` : card.name}
                  </span>
                </div>
                <div className="inventory-card__text">{card.text}</div>
                <div className="inventory-card__actions">
                  {isUsable ? (
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      disabled={!isMyTurn || pending}
                      onClick={() =>
                        send({ t: 'USE_ITEM', seat: seatId, cardId: id })
                      }
                    >
                      ✨ Dùng (Use)
                    </button>
                  ) : card.isWeapon ? (
                    <span className="tag" title="Tự động áp dụng khi tấn công">
                      ⚔️ Vũ khí
                    </span>
                  ) : (
                    <span className="tag" title="Hiệu ứng vĩnh viễn/bị động">
                      🛡️ Bị động
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    disabled={!isMyTurn || pending}
                    onClick={() =>
                      send({ t: 'DROP', seat: seatId, cardIds: [id] })
                    }
                  >
                    Thả (Drop)
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
