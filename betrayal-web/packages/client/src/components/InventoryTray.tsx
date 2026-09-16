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

  const currentTile = player.location ? state.board.placed[player.location] : undefined;
  const droppedInRoom = currentTile?.droppedItems ?? [];

  return (
    <div className="inventory-tray">
      {droppedInRoom.length > 0 && (
        <div
          className="room-items-panel"
          style={{
            margin: '8px 0',
            padding: '8px',
            background: 'rgba(59, 130, 246, 0.15)',
            borderRadius: '6px',
            border: '1px solid rgba(59, 130, 246, 0.4)',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 'bold',
              color: '#60a5fa',
              marginBottom: '6px',
            }}
          >
            📍 Vật Phẩm Trên Sàn Phòng ({droppedInRoom.length}):
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {droppedInRoom.map((cardId) => {
              const card = content.cardsById[cardId];
              return (
                <div
                  key={cardId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(0,0,0,0.4)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                    {card?.name ?? cardId}
                  </span>
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!isMyTurn || pending}
                    onClick={() => send({ t: 'PICKUP', seat: seatId, cardIds: [cardId] })}
                  >
                    🖐️ Nhặt (Pick up)
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        <span className="inventory-tray__title">🎒 Inventory ({allCards.length})</span>
      </div>

      {allCards.length === 0 ? (
        <div className="inventory-tray__empty">No items or omens held.</div>
      ) : (
        <div className="inventory-tray__cards">
          {allCards.map(({ id, isOmen }) => {
            const card = content.cardsById[id];
            if (!card) return null;

            const policy =
              card.use?.kind ??
              (card.onUse && card.onUse.length > 0 ? 'once_per_turn' : 'passive');
            const isUsedThisTurn = Boolean(
              policy === 'once_per_turn' && player.usedCardsThisTurn?.includes(id),
            );
            const isNonDroppable = Boolean(card.isCompanion || id === 'omen.bite');

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
                  <span
                    className="tag"
                    style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.85 }}
                  >
                    {policy === 'passive'
                      ? '🛡️ Bị động'
                      : policy === 'consumable'
                        ? '🧪 Tiêu hao'
                        : policy === 'once_per_turn'
                          ? '🔄 1 lần/lượt'
                          : policy === 'repeatable'
                            ? '⚡ Lặp lại'
                            : '📝 Thủ công'}
                  </span>
                </div>
                <div className="inventory-card__text">{card.text}</div>
                <div className="inventory-card__actions">
                  {policy === 'passive' ? (
                    <span className="tag" title="Tự động áp dụng khi sở hữu">
                      🛡️ Tự động áp dụng
                    </span>
                  ) : policy === 'manual' ? (
                    <span className="tag" title="Hiệu ứng áp dụng theo luật bàn">
                      📝 Thủ công
                    </span>
                  ) : isUsedThisTurn ? (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      disabled
                      title="Chỉ dùng được 1 lần mỗi lượt. Sẽ hồi lại vào lượt sau."
                    >
                      ⏳ Đã dùng lượt này
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      disabled={!isMyTurn || pending}
                      title={
                        !isMyTurn
                          ? 'Chỉ dùng được trong lượt của bạn'
                          : pending
                            ? 'Đang chờ máy chủ xử lý'
                            : 'Kích hoạt năng lực của thẻ'
                      }
                      onClick={() => send({ t: 'USE_ITEM', seat: seatId, cardId: id })}
                    >
                      ✨ Dùng (Use)
                    </button>
                  )}
                  {isNonDroppable ? (
                    <span
                      className="tag"
                      title="Không thể thả Bạn đồng hành hoặc Vết cắn"
                    >
                      🔒 Không thể thả
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      disabled={!isMyTurn || pending}
                      title={
                        !isMyTurn
                          ? 'Chỉ thả được trong lượt của bạn'
                          : 'Thả vật phẩm xuống sàn phòng'
                      }
                      onClick={() => send({ t: 'DROP', seat: seatId, cardIds: [id] })}
                    >
                      Thả (Drop)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
