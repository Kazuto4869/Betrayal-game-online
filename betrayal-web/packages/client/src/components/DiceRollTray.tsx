import { useEffect } from 'react';
import { useStore } from '../store.js';

export function DiceRollTray() {
  const activeRoll = useStore((s) => s.activeRoll);
  const dismissRoll = useStore((s) => s.dismissRoll);

  useEffect(() => {
    if (!activeRoll) return;
    const timer = setTimeout(() => {
      dismissRoll();
    }, 6000);
    return () => clearTimeout(timer);
  }, [activeRoll, dismissRoll]);

  if (!activeRoll) return null;

  const isHaunt = Boolean(activeRoll.hauntRoll);

  return (
    <div className="dice-tray" role="alert" aria-live="assertive">
      <div className="dice-tray__header">
        <span className="dice-tray__reason">
          {isHaunt ? '🎲 HAUNT ROLL' : `🎲 ${activeRoll.reason.toUpperCase()}`}
        </span>
        <button
          type="button"
          className="dice-tray__close"
          onClick={dismissRoll}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="dice-tray__dice">
        {activeRoll.dice.map((pips, i) => (
          <div key={i} className={`dice-tray__die dice-tray__die--${pips}`}>
            {pips === 0 ? '·' : pips === 1 ? '●' : '●●'}
          </div>
        ))}
      </div>

      <div className="dice-tray__total">
        Total: <strong>{activeRoll.total}</strong>
      </div>

      {activeRoll.hauntRoll && (
        <div
          className={`dice-tray__haunt-result ${
            activeRoll.hauntRoll.triggered
              ? 'dice-tray__haunt-result--triggered'
              : 'dice-tray__haunt-result--safe'
          }`}
        >
          {activeRoll.hauntRoll.triggered
            ? `⚡ THE HAUNT BEGINS! (Rolled ${activeRoll.total} < ${activeRoll.hauntRoll.needed} Omens)`
            : `🛡️ The house holds steady. (Rolled ${activeRoll.total} ≥ ${activeRoll.hauntRoll.needed} Omens)`}
        </div>
      )}
    </div>
  );
}
