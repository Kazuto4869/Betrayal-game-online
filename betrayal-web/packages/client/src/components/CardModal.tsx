import { useState, useEffect } from 'react';
import { useStore } from '../store.js';

export function CardModal() {
  const activeCardDraw = useStore((s) => s.activeCardDraw);
  const activeRoll = useStore((s) => s.activeRoll);
  const content = useStore((s) => s.content);
  const dismissCardDraw = useStore((s) => s.dismissCardDraw);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [activeCardDraw?.cardId]);

  if (!activeCardDraw || !content) return null;

  const card = content.cardsById[activeCardDraw.cardId];
  if (!card) return null;

  const deckColorClass =
    card.deck === 'omen'
      ? 'card-modal__badge--omen'
      : card.deck === 'item'
        ? 'card-modal__badge--item'
        : 'card-modal__badge--event';

  const deckTitle =
    card.deck === 'omen'
      ? '🔮 ĐIỀM BÁO (OMEN)'
      : card.deck === 'item'
        ? '🎒 VẬT PHẨM (ITEM)'
        : '⚡ BIẾN CỐ (EVENT)';

  let actionButtonLabel = '✅ Đã Đọc Xong (Xác Nhận)';
  if (activeRoll) {
    actionButtonLabel =
      activeRoll.hauntRoll || activeRoll.reason === 'haunt_roll'
        ? '🔮 Tiếp Tục: Gieo Xúc Xắc Ám Ảnh (Haunt Roll)'
        : `🎲 Tiếp Tục: Gieo Xúc Xắc Kiểm Tra (${activeRoll.reason.toUpperCase()})`;
  } else if (card.deck === 'item' || card.deck === 'omen') {
    actionButtonLabel = '🎒 Nhận Thẻ Vào Túi Đồ (Xác Nhận)';
  }

  return (
    <div className="modal-backdrop modal-backdrop--card">
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        {!revealed ? (
          <div className="card-modal__unrevealed">
            <div className={`card-modal__badge ${deckColorClass}`}>
              {deckTitle}
            </div>
            <div className="card-modal__back-art">
              <span className="card-modal__back-glyph">
                {card.deck === 'omen' ? '🔮' : card.deck === 'item' ? '🗝️' : '⚡'}
              </span>
            </div>
            <h2 className="card-modal__title">
              Khám Phá Lá Bài {card.deck.toUpperCase()}
            </h2>
            <p className="card-modal__intro">
              Một năng lượng kỳ bí bao trùm căn phòng. Hãy lật thẻ bài để xem số phận của bạn!
            </p>
            <div className="card-modal__actions">
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={() => setRevealed(true)}
              >
                🎴 BẤM ĐỂ LẬT THẺ BÀI
              </button>
            </div>
          </div>
        ) : (
          <div className="card-modal__revealed">
            <div className={`card-modal__badge ${deckColorClass}`}>
              {deckTitle}
            </div>
            <h2 className="card-modal__title">{card.name}</h2>
            <div className="card-modal__tags">
              {card.isWeapon && <span className="card-modal__tag">⚔️ Vũ Khí (Weapon)</span>}
              {card.isCompanion && <span className="card-modal__tag">🐕 Bạn Đồng Hành (Companion)</span>}
            </div>
            <div className="card-modal__text">{card.text}</div>
            {card.flavor && (
              <div className="card-modal__flavor">“{card.flavor}”</div>
            )}
            <div className="card-modal__actions">
              <button
                type="button"
                className="btn btn--primary btn--large"
                onClick={dismissCardDraw}
              >
                {actionButtonLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
