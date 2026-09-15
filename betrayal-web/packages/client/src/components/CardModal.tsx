import { useStore } from '../store.js';

export function CardModal() {
  const activeCardDraw = useStore((s) => s.activeCardDraw);
  const content = useStore((s) => s.content);
  const dismissCardDraw = useStore((s) => s.dismissCardDraw);

  if (!activeCardDraw || !content) return null;

  const card = content.cardsById[activeCardDraw.cardId];
  if (!card) return null;

  const deckColorClass =
    card.deck === 'omen'
      ? 'card-modal__badge--omen'
      : card.deck === 'item'
        ? 'card-modal__badge--item'
        : 'card-modal__badge--event';

  const deckIcon =
    card.deck === 'omen' ? '🔮 OMEN' : card.deck === 'item' ? '🎒 ITEM' : '⚡ EVENT';

  return (
    <div className="modal-backdrop" onClick={dismissCardDraw}>
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        <div className={`card-modal__badge ${deckColorClass}`}>
          {deckIcon}
        </div>
        <h2 className="card-modal__title">{card.name}</h2>
        {card.isWeapon && <span className="card-modal__tag">⚔️ Weapon</span>}
        {card.isCompanion && <span className="card-modal__tag">🐕 Companion</span>}
        <div className="card-modal__text">{card.text}</div>
        {card.flavor && (
          <div className="card-modal__flavor">“{card.flavor}”</div>
        )}
        <div className="card-modal__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={dismissCardDraw}
          >
            {card.deck === 'item' || card.deck === 'omen' ? 'Take Card' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
