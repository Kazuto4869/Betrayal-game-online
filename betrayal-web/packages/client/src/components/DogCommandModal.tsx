import { useState } from 'react';
import { getDogReachableRooms } from '@bahoth/engine';
import type { CardId, PlacedId } from '@bahoth/shared';
import { useStore } from '../store.js';

interface DogCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DogCommandModal({ isOpen, onClose }: DogCommandModalProps) {
  const state = useStore((s) => s.state);
  const seatId = useStore((s) => s.seatId);
  const content = useStore((s) => s.content);
  const send = useStore((s) => s.send);
  const pending = useStore((s) => s.pendingSeq !== null);

  const player = state && seatId ? state.players[seatId] : null;
  const playerLoc = player?.location;

  const reachableDestinations: PlacedId[] =
    state && playerLoc && content ? getDogReachableRooms(state, playerLoc, content) : [];

  const [selectedDest, setSelectedDest] = useState<PlacedId | ''>(
    reachableDestinations.length > 0 ? (reachableDestinations[0] ?? '') : '',
  );
  const [commandMode, setCommandMode] = useState<'scout' | 'carry' | 'fetch'>('scout');
  const [carryCardId, setCarryCardId] = useState<CardId | ''>('');
  const [fetchCardId, setFetchCardId] = useState<CardId | ''>('');

  if (!isOpen || !state || !seatId || !content || !player || !playerLoc) {
    return null;
  }

  // Droppable items held by the player
  const droppableItems = player.items.filter((id) => {
    const card = content.cardsById[id];
    return card && !card.isCompanion && id !== 'omen.bite';
  });

  // Dropped items in the selected destination room
  const targetTile = selectedDest ? state.board.placed[selectedDest] : null;
  const targetDropped = (targetTile?.droppedItems ?? []).filter((id) => {
    const card = content.cardsById[id];
    return card && !card.isCompanion && id !== 'omen.bite';
  });

  const handleSendDog = () => {
    if (!selectedDest) return;
    const actionPayload: {
      t: 'COMMAND_DOG';
      seat: string;
      destination: PlacedId;
      carryCardId?: CardId;
      fetchCardId?: CardId;
    } = {
      t: 'COMMAND_DOG',
      seat: seatId,
      destination: selectedDest,
    };

    if (commandMode === 'carry' && carryCardId) {
      actionPayload.carryCardId = carryCardId;
    } else if (commandMode === 'fetch' && fetchCardId) {
      actionPayload.fetchCardId = fetchCardId;
    }

    send(actionPayload);
    onClose();
  };

  const isSubmitDisabled =
    pending ||
    !selectedDest ||
    (commandMode === 'carry' && !carryCardId) ||
    (commandMode === 'fetch' && (!fetchCardId || targetDropped.length === 0));

  return (
    <div
      className="modal-backdrop dog-command-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dog-modal-title"
    >
      <div
        className="card modal dog-command-modal"
        style={{ maxWidth: '520px', width: '90%' }}
      >
        <header style={{ marginBottom: '12px' }}>
          <h2
            id="dog-modal-title"
            style={{
              margin: 0,
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>🐶</span> Điều Khiển Chó (Dog Companion)
          </h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0' }}>
            Chó có thể di chuyển tối đa 6 ô qua cửa và cầu thang 2 chiều. Có thể mang 1
            vật phẩm đến phòng khác hoặc nhặt 1 vật phẩm mang về cho bạn (1 lần/lượt).
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Destination Selector */}
          <div>
            <label
              htmlFor="dog-dest-select"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 'bold',
                marginBottom: '4px',
              }}
            >
              Chọn điểm đến (Phòng trong vòng 6 bước):
            </label>
            <select
              id="dog-dest-select"
              data-testid="dog-dest-select"
              value={selectedDest}
              onChange={(e) => {
                setSelectedDest(e.target.value);
                setFetchCardId('');
              }}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #475569',
              }}
            >
              {reachableDestinations.map((placedId) => {
                const tile = state.board.placed[placedId];
                const def = tile ? content.tilesById[tile.tileId] : null;
                const droppedCount = tile?.droppedItems?.length ?? 0;
                return (
                  <option key={placedId} value={placedId}>
                    {def?.name ?? placedId} ({tile?.floor}){' '}
                    {droppedCount > 0 ? `— 📦 ${droppedCount} vật phẩm` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Mode Selector */}
          <div>
            <span
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 'bold',
                marginBottom: '6px',
              }}
            >
              Mục đích sai Chó:
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`btn btn--small ${commandMode === 'scout' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setCommandMode('scout')}
              >
                🐾 Thăm phòng
              </button>
              <button
                type="button"
                className={`btn btn--small ${commandMode === 'carry' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setCommandMode('carry')}
              >
                🚚 Mang vật phẩm đến
              </button>
              <button
                type="button"
                className={`btn btn--small ${commandMode === 'fetch' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setCommandMode('fetch')}
              >
                📦 Nhặt vật phẩm về
              </button>
            </div>
          </div>

          {/* Carry Mode Details */}
          {commandMode === 'carry' && (
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <label
                htmlFor="dog-carry-select"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                }}
              >
                Chọn vật phẩm để Chó mang đi:
              </label>
              {droppableItems.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Bạn không có vật phẩm nào có thể cho Chó mang đi.
                </div>
              ) : (
                <select
                  id="dog-carry-select"
                  data-testid="dog-carry-select"
                  value={carryCardId}
                  onChange={(e) => setCarryCardId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '4px',
                    background: '#0f172a',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                  }}
                >
                  <option value="">-- Chọn vật phẩm mang đi --</option>
                  {droppableItems.map((id) => {
                    const card = content.cardsById[id];
                    return (
                      <option key={id} value={id}>
                        {card?.name ?? id}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          )}

          {/* Fetch Mode Details */}
          {commandMode === 'fetch' && (
            <div
              style={{
                background: 'rgba(168, 85, 247, 0.1)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(168, 85, 247, 0.3)',
              }}
            >
              <label
                htmlFor="dog-fetch-select"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  marginBottom: '4px',
                }}
              >
                Chọn vật phẩm dưới sàn phòng đích để Chó nhặt về:
              </label>
              {targetDropped.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#f87171' }}>
                  Phòng đích không có vật phẩm nào rơi trên sàn!
                </div>
              ) : (
                <select
                  id="dog-fetch-select"
                  data-testid="dog-fetch-select"
                  value={fetchCardId}
                  onChange={(e) => setFetchCardId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '4px',
                    background: '#0f172a',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                  }}
                >
                  <option value="">-- Chọn vật phẩm nhặt về --</option>
                  {targetDropped.map((id) => {
                    const card = content.cardsById[id];
                    return (
                      <option key={id} value={id}>
                        {card?.name ?? id}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          )}
        </div>

        <footer
          style={{
            marginTop: '16px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
          }}
        >
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Hủy (Cancel)
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="dog-confirm-btn"
            disabled={isSubmitDisabled}
            onClick={handleSendDog}
          >
            🐶 Phái Chó Đi (Send Dog)
          </button>
        </footer>
      </div>
    </div>
  );
}
