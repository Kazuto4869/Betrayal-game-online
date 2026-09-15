import { useStore } from '../store.js';

export function GameOverModal() {
  const state = useStore((s) => s.state);
  const seatId = useStore((s) => s.seatId);

  if (!state || state.phase !== 'game_over' || !state.result) return null;

  const result = state.result;
  const isWinner = seatId ? result.winners.includes(seatId) : false;

  return (
    <div className="modal-backdrop">
      <div className={`game-over-modal game-over-modal--${result.outcome}`}>
        <h1 className="game-over-modal__title">
          {result.outcome === 'heroes'
            ? '🏆 HEROES TRIUMPH!'
            : result.outcome === 'traitor'
              ? '💀 TRAITOR VICTORIOUS!'
              : 'GAME OVER'}
        </h1>
        <div className="game-over-modal__subtitle">
          {isWinner ? '🎉 You are Victorious!' : '☠️ Defeat...'}
        </div>
        <p className="game-over-modal__reason">{result.reason}</p>
        <div className="game-over-modal__winners">
          <strong>Winners:</strong>{' '}
          {result.winners
            .map((sid) => state.players[sid]?.name ?? sid)
            .join(', ')}
        </div>
      </div>
    </div>
  );
}
