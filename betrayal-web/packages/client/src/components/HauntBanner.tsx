import { useState } from 'react';
import { useStore } from '../store.js';

export function HauntBanner() {
  const state = useStore((s) => s.state);
  const content = useStore((s) => s.content);
  const seatId = useStore((s) => s.seatId);
  const [expanded, setExpanded] = useState(false);

  if (!state || state.phase !== 'haunt' || !state.haunt || !content) {
    return null;
  }

  const haunt = content.hauntsById[state.haunt.hauntId];
  if (!haunt) return null;

  const isTraitor = seatId ? state.players[seatId]?.isTraitor ?? false : false;
  const traitorPlayer = state.haunt.traitorSeat
    ? state.players[state.haunt.traitorSeat]
    : null;

  const side = isTraitor ? haunt.traitor : haunt.heroes;

  return (
    <div className={`haunt-banner ${isTraitor ? 'haunt-banner--traitor' : 'haunt-banner--hero'}`}>
      <div className="haunt-banner__header">
        <div className="haunt-banner__title-group">
          <span className="haunt-banner__badge">
            {isTraitor ? '💀 TRAITOR' : '🛡️ HERO'}
          </span>
          <h3 className="haunt-banner__title">
            Haunt #{haunt.id}: {haunt.name}
          </h3>
          <span className="haunt-banner__traitor-info">
            {traitorPlayer ? `Traitor: ${traitorPlayer.name}` : 'No Traitor'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide Objectives' : 'View Objectives'}
        </button>
      </div>

      {expanded && (
        <div className="haunt-banner__details">
          <div className="haunt-banner__goal">
            <strong>Your Goal:</strong> {side.goal}
          </div>
          {side.rules && side.rules.length > 0 && (
            <ul className="haunt-banner__rules">
              {side.rules.map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
