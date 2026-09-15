import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

export function DiceRollTray() {
  const activeRoll = useStore((s) => s.activeRoll);
  const activeCardDraw = useStore((s) => s.activeCardDraw);
  const dismissRoll = useStore((s) => s.dismissRoll);
  const [isRolling, setIsRolling] = useState(true);
  const [displayDice, setDisplayDice] = useState<number[]>([]);

  useEffect(() => {
    if (!activeRoll || activeCardDraw) {
      setIsRolling(true);
      return;
    }

    setIsRolling(true);
    const count = activeRoll.dice.length > 0 ? activeRoll.dice.length : 6;

    // Fast rolling animation cycle
    const interval = setInterval(() => {
      setDisplayDice(Array.from({ length: count }, () => Math.floor(Math.random() * 3)));
    }, 70);

    // Settle after 1.2s
    const timer = setTimeout(() => {
      clearInterval(interval);
      setDisplayDice(activeRoll.dice);
      setIsRolling(false);
    }, 1200);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [activeRoll, activeCardDraw]);

  if (!activeRoll || activeCardDraw) return null;

  const isHaunt = Boolean(activeRoll.hauntRoll) || activeRoll.reason === 'haunt_roll';

  return (
    <div className="modal-backdrop modal-backdrop--dice">
      <div className="dice-tray dice-tray--modal" role="alert" aria-live="assertive">
        <div className="dice-tray__header">
          <span className="dice-tray__reason">
            {isHaunt ? '🔮 HAUNT ROLL (ĐỔ XÚC XẮC ÁM ẢNH)' : `🎲 ${activeRoll.reason.toUpperCase()}`}
          </span>
        </div>

        <div className="dice-tray__status">
          {isRolling ? '🎲 Đang gieo xúc xắc...' : '✨ Kết quả gieo xúc xắc:'}
        </div>

        <div className="dice-tray__dice">
          {(isRolling ? displayDice : activeRoll.dice).map((pips, i) => (
            <div
              key={i}
              className={`dice-tray__die dice-tray__die--${pips} ${
                isRolling ? 'dice-tray__die--rolling' : ''
              }`}
            >
              {pips === 0 ? '·' : pips === 1 ? '●' : '●●'}
            </div>
          ))}
        </div>

        {!isRolling && (
          <div className="dice-tray__result-box">
            <div className="dice-tray__total">
              Tổng điểm xúc xắc: <strong>{activeRoll.total}</strong>
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
                  ? `⚡ ÁM ẢNH BẮT ĐẦU! (Điểm ${activeRoll.total} < ${activeRoll.hauntRoll.needed} lá Omen)`
                  : `🛡️ Ngôi nhà vẫn an toàn! (Điểm ${activeRoll.total} ≥ ${activeRoll.hauntRoll.needed} lá Omen)`}
              </div>
            )}

            <div className="dice-tray__actions">
              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={dismissRoll}
              >
                ✅ Xác Nhận / Tiếp Tục
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
