import { useStore } from '../store.js';

export function MonsterPhasePanel() {
  const state = useStore((s) => s.state);
  const seatId = useStore((s) => s.seatId);
  const content = useStore((s) => s.content);
  const send = useStore((s) => s.send);
  const pending = useStore((s) => s.pendingSeq !== null);

  if (!state || !state.monsterTurn || !content) {
    return null;
  }

  const { monsterTurn, monsters = {}, players } = state;
  const isController = monsterTurn.controllingSeat === seatId;
  const controllingPlayer = monsterTurn.controllingSeat
    ? players[monsterTurn.controllingSeat]
    : null;
  const controllingName =
    controllingPlayer?.name ?? monsterTurn.controllingSeat ?? 'Traitor';

  const livingMonsters = Object.values(monsters).filter((m) => !m.isDead);
  const activeMonster = monsterTurn.activeMonsterId
    ? monsters[monsterTurn.activeMonsterId]
    : null;

  const getRoomName = (loc: string | null): string => {
    if (!loc) return 'Unknown';
    const tile = state.board.placed[loc];
    return tile ? (content.tilesById[tile.tileId]?.name ?? loc) : loc;
  };

  // Living heroes in the same room as the active monster (for MONSTER_ATTACK)
  const heroesInActiveRoom =
    activeMonster && activeMonster.location
      ? Object.values(players).filter(
          (p) =>
            !p.isDead &&
            !p.removed &&
            !p.isTraitor &&
            p.location === activeMonster.location,
        )
      : [];

  return (
    <div
      className="monster-phase-panel"
      data-testid="monster-phase-panel"
      style={{
        margin: '8px 0',
        padding: '12px',
        background: 'rgba(127, 29, 29, 0.25)',
        borderRadius: '8px',
        border: '1px solid rgba(239, 68, 68, 0.4)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>👹</span>
          <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#fca5a5' }}>
            MONSTER PHASE
          </span>
        </div>
        <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
          {isController ? '👑 You control monsters' : `Commanded by ${controllingName}`}
        </span>
      </div>

      {/* Non-controlling explorer view */}
      {!isController && (
        <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4' }}>
          {activeMonster ? (
            <div>
              Active monster: <strong>{activeMonster.def}</strong> in{' '}
              {getRoomName(activeMonster.location)}. Moves left: {monsterTurn.movesLeft}.
            </div>
          ) : (
            <div>Traitor is selecting the next monster to activate...</div>
          )}
        </div>
      )}

      {/* Controller view */}
      {isController && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* If no active monster selected */}
          {!activeMonster && (
            <>
              <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                Select a monster to roll its Speed and take its turn:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {livingMonsters.map((m) => {
                  const hasActed = monsterTurn.actedMonsterIds.includes(m.id);
                  const isStunned = Boolean(m.flags['stunned']);
                  const roomName = getRoomName(m.location);

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <div>
                        <strong style={{ color: '#fecaca', fontSize: '13px' }}>
                          {m.def}
                        </strong>
                        <span
                          style={{
                            fontSize: '12px',
                            color: '#94a3b8',
                            marginLeft: '6px',
                          }}
                        >
                          📍 {roomName}
                        </span>
                        {isStunned && (
                          <span
                            className="tag"
                            style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              background: '#eab308',
                            }}
                          >
                            💤 Choáng (Stunned)
                          </span>
                        )}
                        {hasActed && (
                          <span
                            className="tag"
                            style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              background: '#22c55e',
                            }}
                          >
                            ✅ Đã đi lượt này
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={pending || hasActed}
                        onClick={() =>
                          send({
                            t: 'START_MONSTER',
                            seat: seatId,
                            monsterId: m.id,
                          })
                        }
                      >
                        {isStunned ? 'Thức dậy (Wake up)' : 'Kích hoạt (Start Turn)'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}
              >
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  data-testid="end-monster-phase-btn"
                  disabled={pending}
                  onClick={() => send({ t: 'END_MONSTER_PHASE', seat: seatId })}
                >
                  Kết Thúc Monster Phase (End Phase)
                </button>
              </div>
            </>
          )}

          {/* Active Monster Turn */}
          {activeMonster && (
            <div
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid rgba(239, 68, 68, 0.5)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <div>
                  <span
                    style={{ fontSize: '14px', fontWeight: 'bold', color: '#f87171' }}
                  >
                    👾 {activeMonster.def}
                  </span>
                  <span style={{ fontSize: '12px', color: '#cbd5e1', marginLeft: '8px' }}>
                    📍 {getRoomName(activeMonster.location)}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#fde047' }}>
                  🎲 Speed Roll: {monsterTurn.rolledSpeed ?? '0'} | 👟 Moves:{' '}
                  {monsterTurn.movesLeft}
                </div>
              </div>

              {/* Combat options */}
              {heroesInActiveRoom.length > 0 && !monsterTurn.hasAttacked && (
                <div
                  style={{
                    margin: '8px 0',
                    padding: '6px',
                    background: 'rgba(220, 38, 38, 0.2)',
                    borderRadius: '4px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: '#fca5a5',
                      marginBottom: '4px',
                    }}
                  >
                    ⚔️ Tấn công Anh Hùng trong phòng:
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {heroesInActiveRoom.map((h) => (
                      <button
                        key={h.seatId}
                        type="button"
                        className="btn btn--danger btn--small"
                        data-testid="monster-attack-btn"
                        disabled={pending}
                        onClick={() =>
                          send({
                            t: 'MONSTER_ATTACK',
                            seat: seatId,
                            monsterId: activeMonster.id,
                            target: { kind: 'seat', seatId: h.seatId },
                          })
                        }
                      >
                        Tấn công {h.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {monsterTurn.hasAttacked && (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    fontStyle: 'italic',
                    marginBottom: '6px',
                  }}
                >
                  Quái vật này đã tấn công trong lượt này.
                </div>
              )}

              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}
              >
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  data-testid="end-monster-turn-btn"
                  disabled={pending}
                  onClick={() =>
                    send({
                      t: 'END_MONSTER_TURN',
                      seat: seatId,
                      monsterId: activeMonster.id,
                    })
                  }
                >
                  Hoàn Tất Quái Vật Này (End Turn)
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
