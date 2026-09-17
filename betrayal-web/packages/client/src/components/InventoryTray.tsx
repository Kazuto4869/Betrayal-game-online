import { useState } from 'react';
import { getLegalActions } from '@bahoth/engine';
import { useStore } from '../store.js';
import { DogCommandModal } from './DogCommandModal.js';

export function InventoryTray() {
  const state = useStore((s) => s.state);
  const content = useStore((s) => s.content);
  const seatId = useStore((s) => s.seatId);
  const send = useStore((s) => s.send);
  const pending = useStore((s) => s.pendingSeq !== null);
  const selectedTileId = useStore((s) => s.selectedTileId);
  const selectTile = useStore((s) => s.selectTile);
  const [isDogModalOpen, setIsDogModalOpen] = useState(false);

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

  const activeTileId = selectedTileId ?? player.location;
  const activeTile = activeTileId ? state.board.placed[activeTileId] : undefined;
  const activeTileDef = activeTile ? content.tilesById[activeTile.tileId] : undefined;

  const currentTile = player.location ? state.board.placed[player.location] : undefined;
  const currentTileDef = currentTile ? content.tilesById[currentTile.tileId] : undefined;
  const droppedInRoom = currentTile?.droppedItems ?? [];

  // Legal room actions (including token interaction) determined by engine authority
  const legalActions = getLegalActions(state, seatId, content);
  const legalRoomActions = legalActions.filter(
    (a): a is Extract<typeof a, { t: 'ROOM_ACTION' }> => a.t === 'ROOM_ACTION',
  );

  return (
    <div className="inventory-tray">
      {activeTileDef && (
        <div
          className="room-info-panel"
          data-testid="room-info-panel"
          style={{
            margin: '8px 0',
            padding: '8px',
            background: 'rgba(30, 41, 59, 0.5)',
            borderRadius: '6px',
            border: '1px solid rgba(148, 163, 184, 0.2)',
          }}
        >
          <div
            className="room-info-panel__header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: activeTileDef.ruleText ? '6px' : '0',
            }}
          >
            <span
              className="room-info-panel__title"
              style={{ fontWeight: 'bold', fontSize: '13px', color: '#e2e8f0' }}
            >
              📍 {activeTileDef.name}
              {selectedTileId && selectedTileId !== player.location && ' (Inspecting)'}
            </span>
            {selectedTileId && selectedTileId !== player.location && (
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => selectTile(null)}
              >
                Current Room
              </button>
            )}
          </div>
          {activeTileDef.ruleText && (
            <div
              className="room-info-panel__rule-text"
              data-testid="room-rule-text"
              style={{
                fontSize: '12px',
                fontStyle: 'italic',
                color: '#cbd5e1',
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '6px 8px',
                borderRadius: '4px',
                lineHeight: '1.4',
              }}
            >
              {activeTileDef.ruleText}
            </div>
          )}
        </div>
      )}
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

      {legalRoomActions.length > 0 && (
        <div
          className="token-panel room-actions-panel"
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
            🏛️ Room Actions & Objectives:
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {legalRoomActions.map((ra) => {
              let label = ra.actionId;
              if (ra.actionId === 'interact_token') {
                const token = (state.tokens ?? []).find(
                  (t) => t.location === player.location && !t.flags['completed'],
                );
                label = token ? `Interact with ${token.token}` : 'Interact with Token';
              } else {
                const actionDef = currentTileDef?.actions?.find(
                  (a) => a.id === ra.actionId,
                );
                label = actionDef?.name ?? ra.actionId;
              }
              return (
                <button
                  key={ra.actionId}
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={pending}
                  onClick={() =>
                    send({
                      t: 'ROOM_ACTION',
                      seat: seatId,
                      actionId: ra.actionId,
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
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
                  {id === 'omen.dog' &&
                    (player.flags['dog_used_this_turn'] ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        disabled
                        title="Chó đã di chuyển/vận chuyển đồ trong lượt này."
                      >
                        ⏳ Chó đã đi lượt này
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        data-testid="command-dog-btn"
                        disabled={!isMyTurn || pending}
                        title={
                          !isMyTurn
                            ? 'Chỉ sai Chó trong lượt của bạn'
                            : 'Sai Chó đi thám thính, mang đồ hoặc nhặt đồ'
                        }
                        onClick={() => setIsDogModalOpen(true)}
                      >
                        🐶 Sai Chó (Command)
                      </button>
                    ))}
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
      <DogCommandModal isOpen={isDogModalOpen} onClose={() => setIsDogModalOpen(false)} />
    </div>
  );
}
