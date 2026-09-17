import { useEffect, useCallback } from 'react';
import { useStore } from '../store.js';

export function HauntBriefingModal() {
  const state = useStore((s) => s.state);
  const seatId = useStore((s) => s.seatId);
  const send = useStore((s) => s.send);
  const isBriefingOpen = useStore((s) => s.isBriefingOpen);
  const closeBriefing = useStore((s) => s.closeBriefing);
  const activeCardDraw = useStore((s) => s.activeCardDraw);
  const activeRoll = useStore((s) => s.activeRoll);

  const haunt = state?.haunt;
  const briefing = haunt?.briefing;

  const isAcknowledged = !!(seatId && haunt?.acknowledged.includes(seatId));
  const isVisible =
    state?.phase === 'haunt' &&
    !!briefing &&
    !activeCardDraw &&
    !activeRoll &&
    (!isAcknowledged || isBriefingOpen);

  const handleClose = useCallback(() => {
    if (!isAcknowledged && seatId) {
      send({ t: 'ACK_HAUNT_BRIEFING', seat: seatId });
    }
    closeBriefing();
  }, [isAcknowledged, seatId, send, closeBriefing]);

  useEffect(() => {
    if (!isVisible || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isVisible, handleClose]);

  if (!isVisible || !briefing) {
    return null;
  }

  const isTraitor = briefing.role === 'traitor';
  const side = briefing.side;

  return (
    <div
      className="modal-backdrop haunt-briefing-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="haunt-briefing-title"
    >
      <div
        className={`card modal haunt-briefing-modal ${
          isTraitor ? 'haunt-briefing-modal--traitor' : 'haunt-briefing-modal--hero'
        }`}
      >
        <header className="haunt-briefing-modal__header">
          <div className="haunt-briefing-modal__badge">
            {isTraitor ? "💀 TRAITOR'S TOME" : '🛡️ SECRETS OF SURVIVAL'}
          </div>
          <h2 id="haunt-briefing-title" className="haunt-briefing-modal__title">
            Haunt #{briefing.hauntId}: {briefing.title}
          </h2>
          <div className="haunt-briefing-modal__goal">
            <strong>Your Goal:</strong> {side.goal}
          </div>
        </header>

        <div className="haunt-briefing-modal__body">
          {side.intro && (
            <section className="haunt-briefing-section haunt-briefing-section--intro">
              <p>{side.intro}</p>
            </section>
          )}

          {side.rightNow && side.rightNow.length > 0 && (
            <section className="haunt-briefing-section">
              <h4>Do This Right Now</h4>
              <ul>
                {side.rightNow.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {side.whatYouKnow && side.whatYouKnow.length > 0 && (
            <section className="haunt-briefing-section">
              <h4>What You Know</h4>
              <ul>
                {side.whatYouKnow.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {side.winWhen && (
            <section className="haunt-briefing-section">
              <h4>You Win When...</h4>
              {Array.isArray(side.winWhen) ? (
                <ul>
                  {(side.winWhen as string[]).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>{side.winWhen}</p>
              )}
            </section>
          )}

          {side.rules && side.rules.length > 0 && (
            <section className="haunt-briefing-section">
              <h4>Special Haunt Rules</h4>
              <ul>
                {side.rules.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {side.specialAttackRules && side.specialAttackRules.length > 0 && (
            <section className="haunt-briefing-section">
              <h4>Special Attack Rules</h4>
              <ul>
                {side.specialAttackRules.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {side.ifYouWin && (
            <section className="haunt-briefing-section">
              <h4>If You Win</h4>
              {Array.isArray(side.ifYouWin) ? (
                <ul>
                  {(side.ifYouWin as string[]).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>{side.ifYouWin}</p>
              )}
            </section>
          )}

          {side.additionalSections &&
            side.additionalSections.map((sec, i) => (
              <section key={i} className="haunt-briefing-section">
                <h4>{sec.title}</h4>
                {sec.text && <p>{sec.text}</p>}
                {sec.bullets && sec.bullets.length > 0 && (
                  <ul>
                    {sec.bullets.map((bullet, j) => (
                      <li key={j}>{bullet}</li>
                    ))}
                  </ul>
                )}
                {sec.steps && sec.steps.length > 0 && (
                  <ol>
                    {sec.steps.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
        </div>

        <footer className="haunt-briefing-modal__footer">
          <button
            type="button"
            className={`btn ${isAcknowledged ? 'btn--ghost' : 'btn--primary'} btn--large`}
            onClick={handleClose}
          >
            {isAcknowledged ? 'Close Briefing' : 'Ready / Close Briefing'}
          </button>
        </footer>
      </div>
    </div>
  );
}
