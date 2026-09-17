import { useState } from 'react';
import { useStore } from '../store.js';

export function HauntBanner() {
  const state = useStore((s) => s.state);
  const content = useStore((s) => s.content);
  const seatId = useStore((s) => s.seatId);
  const openBriefing = useStore((s) => s.openBriefing);
  const activeCardDraw = useStore((s) => s.activeCardDraw);
  const activeRoll = useStore((s) => s.activeRoll);
  const [expanded, setExpanded] = useState(false);

  if (
    !state ||
    state.phase !== 'haunt' ||
    !state.haunt ||
    !content ||
    activeCardDraw ||
    activeRoll
  ) {
    return null;
  }

  const haunt = content.hauntsById[state.haunt.hauntId];
  const hauntTitle =
    state.haunt.briefing?.title ?? haunt?.name ?? `Haunt #${state.haunt.hauntId}`;
  const isTraitor = seatId ? (state.players[seatId]?.isTraitor ?? false) : false;
  const traitorPlayer = state.haunt.traitorSeat
    ? state.players[state.haunt.traitorSeat]
    : null;

  const side = state.haunt.briefing?.side;

  const livingParticipants = state.turnOrder.filter(
    (s) => !state.players[s]?.isDead && !state.players[s]?.removed,
  );
  const ackCount = state.haunt.acknowledged.length;
  const totalCount = livingParticipants.length;
  const allReady = ackCount >= totalCount;

  return (
    <div
      className={`haunt-banner ${isTraitor ? 'haunt-banner--traitor' : 'haunt-banner--hero'}`}
    >
      <div className="haunt-banner__header">
        <div className="haunt-banner__title-group">
          <span className="haunt-banner__badge">
            {isTraitor ? '💀 TRAITOR' : '🛡️ HERO'}
          </span>
          <h3 className="haunt-banner__title">
            Haunt #{state.haunt.hauntId}: {hauntTitle}
          </h3>
          <span className="haunt-banner__traitor-info">
            {traitorPlayer ? `Traitor: ${traitorPlayer.name}` : 'No Traitor'}
          </span>
        </div>
        <div className="haunt-banner__actions">
          {side && (
            <button
              type="button"
              className="btn btn--secondary btn--small haunt-banner__book-btn"
              onClick={openBriefing}
            >
              {isTraitor ? "📖 Traitor's Tome" : '📖 Survival Book'}
            </button>
          )}
          {side && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide Summary' : 'View Summary'}
            </button>
          )}
        </div>
      </div>

      {!allReady && (
        <div className="haunt-banner__readiness">
          <span className="haunt-banner__readiness-status">
            ⏳ Waiting for all players to read briefing... ({ackCount}/{totalCount} Ready)
          </span>
        </div>
      )}

      {expanded && side && (
        <div className="haunt-banner__details">
          <div className="haunt-banner__goal">
            <strong>Your Goal:</strong> {side.goal}
          </div>
          {side.rules && side.rules.length > 0 && (
            <ul className="haunt-banner__rules">
              {side.rules.slice(0, 3).map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
