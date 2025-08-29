import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import EquationInput from './components/EquationInput';

import GameCanvas from './components/GameCanvas';
import Leaderboard from './components/Leaderboard';
import { createApi } from './services/api';

// PUBLIC_INTERFACE
function App() {
  /**
   * This is the main Gravity Curve app. It renders:
   * - Theme toggle
   * - Multiple equation inputs (sequence)
   * - Unified canvas for graph + gameplay rendering curves followed in sequence
   * - Pause/Resume/Reset controls and HUD
   * - Leaderboard view
   * It integrates with backend APIs via the services/api module.
   */
  const [theme, setTheme] = useState('light');

  // Multi-curve state: an ordered list of equations with domains and colors
  const [equations, setEquations] = useState([
    { id: 1, expr: '0.5*x', color: '#61dafb', min: -200, max: 200 },
  ]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [paused, setPaused] = useState(true);
  const [resetSeed, setResetSeed] = useState(0);
  const [collected, setCollected] = useState(0);
  const [totalStars, setTotalStars] = useState(5);
  const [moves, setMoves] = useState(0);
  const [username, setUsername] = useState('guest');
  const [leaderboard, setLeaderboard] = useState([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [showEndModal, setShowEndModal] = useState(false);
  const [endResult, setEndResult] = useState({ success: false, collected: 0, total: 0 });

  // New: input/plot gating + random start coordinate
  const [plotReady, setPlotReady] = useState(false);
  const [startCoord, setStartCoord] = useState(null); // {x,y} in world units; displayed above canvas

  const api = useMemo(() => createApi(), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // load leaderboard at start
  useEffect(() => {
    let mounted = true;
    api
      .getLeaderboard()
      .then((data) => mounted && setLeaderboard(data || []))
      .catch(() => mounted && setStatusMsg('Failed to load leaderboard'));
    return () => {
      mounted = false;
    };
  }, [api]);

  // PUBLIC_INTERFACE
  function applyEquationAt(index, payload) {
    /** Apply equation change for a specific index and count as a move if game is running */
    const { expr, min, max } = payload || {};
    setEquations((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        expr: typeof expr === 'string' ? expr : next[index].expr,
        min: isFinite(min) ? Number(min) : next[index].min,
        max: isFinite(max) ? Number(max) : next[index].max,
      };
      return next;
    });
    setMoves((m) => (!paused ? m + 1 : m));

    // After applying an equation, re-check if we have all inputs needed to plot
    setPlotReady(checkPlotInputs([...equations].map((e, i) => i === index ? {
      ...e,
      expr: typeof expr === 'string' ? expr : e.expr,
      min: isFinite(min) ? Number(min) : e.min,
      max: isFinite(max) ? Number(max) : e.max,
    } : e)));
  }

  const addEquation = () => {
    setEquations((prev) => {
      const id = prev.length ? Math.max(...prev.map((p) => p.id || 0)) + 1 : 1;
      const palette = ['#61dafb', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#f97316'];
      const color = palette[(id - 1) % palette.length];
      return [
        ...prev,
        { id, expr: '0.5*x', color, min: -200, max: 200 },
      ];
    });
  };

  const removeEquation = (id) => {
    setEquations((prev) => prev.filter((e) => e.id !== id));
    setActiveIndex((idx) => Math.min(idx, Math.max(0, equations.length - 2)));
  };

  const moveEquation = (from, to) => {
    if (to < 0 || to >= equations.length) return;
    setEquations((prev) => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
    setActiveIndex((idx) => (idx === from ? to : idx));
  };

  const onPauseToggle = () => {
    setPaused((p) => !p);
  };

  const onReset = () => {
    setResetSeed((s) => s + 1);
    setMoves(0);
    setCollected(0);
    setStatusMsg('');
    setPaused(true);
    setActiveIndex(0);
    setShowEndModal(false);
    setEndResult({ success: false, collected: 0, total: 0 });
    // Preserve equations but require user to re-apply/confirm before plotting
    setPlotReady(false);
    // Generate a new random start coordinate; GameCanvas will fall back if not valid until plot
    setStartCoord(null); // will regenerate when user plots again
  };

  const onGameComplete = async (score) => {
    // Trigger only if user collected all stars; this is also set by onCurveFinished when sequence ends
    const success = collected >= totalStars && totalStars > 0;
    if (success) {
      setShowEndModal(true);
      setEndResult({ success: true, collected, total: totalStars });
    }
    setStatusMsg('Level complete! Submitting score...');
    try {
      await api.submitScore({ username, score, moves });
      const lb = await api.getLeaderboard();
      setLeaderboard(lb || []);
      setStatusMsg('Score submitted!');
    } catch (e) {
      setStatusMsg('Could not submit score.');
    }
  };

  const onStarStats = (stats) => {
    setCollected(stats.collected);
    setTotalStars(stats.total);
  };

  // Called by GameCanvas when it finishes a curve domain; advance to next
  const onCurveFinished = (nextIndex) => {
    setActiveIndex(nextIndex);
    // If sequence finished (nextIndex >= equations length) show final result
    if (nextIndex >= equations.length) {
      const success = collected >= totalStars && totalStars > 0;
      setShowEndModal(true);
      setEndResult({ success, collected, total: totalStars });
      if (!success) {
        setStatusMsg('Level failed: not all stars were collected.');
      } else {
        setStatusMsg('Level complete! Submitting score...');
      }
    }
  };

  // PUBLIC_INTERFACE
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Helper to validate required inputs for plotting
  function checkPlotInputs(eqList) {
    const hasAll = (eqList || []).every((e) => {
      const hasExpr = typeof e.expr === 'string' && e.expr.trim().length > 0;
      const hasRange = isFinite(e.min) && isFinite(e.max) && Number(e.min) < Number(e.max);
      return hasExpr && hasRange;
    });
    return hasAll && (eqList || []).length > 0;
  }

  // Prepare to plot: validate inputs and set random start
  function onPlot() {
    const ok = checkPlotInputs(equations);
    if (!ok) {
      setStatusMsg('Please enter an equation and valid min/max range for all equations before plotting.');
      setPlotReady(false);
      return;
    }
    // Create a random starting point in world units which will be used by GameCanvas.
    // We select based on the first equation's [min, max] domain for clarity.
    const first = equations[0];
    const min = Number(first.min), max = Number(first.max);
    const rx = min + Math.random() * (max - min);
    // y is unknown to App; GameCanvas computes y based on the active curve. We store only x here.
    setStartCoord({ x: rx }); // y will be computed and displayed by GameCanvas if needed
    setPlotReady(true);
    setPaused(true); // start in paused state until user presses Start/Resume
    setStatusMsg(`Random starting x selected at ${rx.toFixed(2)}. Press Start to begin.`);
    // bump seed to force canvas rebuild with new startCoord
    setResetSeed((s) => s + 1);
  }

  // Derive expressions with order based on current ordering
  const orderedExpressions = equations.map((e, idx) => ({ ...e, orderIndex: idx }));

  return (
    <div className="App">
      <header className="App-header" style={{ alignItems: 'stretch' }}>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
        </button>

        <div className="container" style={{ maxWidth: 1200, width: '100%', padding: 16 }}>
          <h1 className="title" style={{ margin: 0 }}>Gravity Curve</h1>
          <p className="subtitle" style={{ marginTop: 4 }}>
            Guide the falling ball along y = f(x) to collect all stars.
          </p>

          <div
            className="game-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr',
              gap: 16,
            }}
          >
            <div
              className="controls"
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: '1fr',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label htmlFor="username" style={{ fontSize: 14 }}>Username</label>
                <input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your name"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  className="btn"
                  onClick={() => {
                    api.ensureProfile(username).then(() => {
                      setStatusMsg('Profile ready');
                    }).catch(() => setStatusMsg('Profile error'));
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--button-bg)',
                    color: 'var(--button-text)',
                    cursor: 'pointer',
                  }}
                >
                  Save Profile
                </button>
              </div>

              {/* Multiple equations input list */}
              <div className="equation-panel" style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600 }}>Equation sequence (y = f(x))</div>
                  <button
                    onClick={addEquation}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    aria-label="Add equation"
                  >
                    + Add
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {equations.map((eq, idx) => (
                    <div key={eq.id} style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 2,
                            background: eq.color,
                            border: '1px solid rgba(0,0,0,0.1)'
                          }}
                          aria-label={`Equation ${idx + 1} color`}
                          title={eq.color}
                        />
                        <div style={{ fontWeight: 600, fontSize: 12 }}>
                          #{idx + 1} {idx === activeIndex ? '(active)' : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                          <button
                            onClick={() => moveEquation(idx, idx - 1)}
                            disabled={idx === 0}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border-color)',
                              background: 'transparent',
                              cursor: idx === 0 ? 'not-allowed' : 'pointer',
                              fontSize: 12
                            }}
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveEquation(idx, idx + 1)}
                            disabled={idx === equations.length - 1}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border-color)',
                              background: 'transparent',
                              cursor: idx === equations.length - 1 ? 'not-allowed' : 'pointer',
                              fontSize: 12
                            }}
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeEquation(eq.id)}
                            disabled={equations.length <= 1}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 6,
                              border: '1px solid var(--border-color)',
                              background: 'transparent',
                              cursor: equations.length <= 1 ? 'not-allowed' : 'pointer',
                              fontSize: 12,
                              color: '#dc3545'
                            }}
                            aria-label="Remove equation"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <EquationInput
                          onApply={(payload) => applyEquationAt(idx, payload)}
                          initialValue={eq.expr}
                          initialMin={eq.min ?? -200}
                          initialMax={eq.max ?? 200}
                        />
                      </div>
                      <div style={{ height: 1, background: 'var(--border-color)' }} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={onPlot}
                  className="btn"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#0d6efd',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Plot Curve(s)
                </button>
                <button
                  onClick={onPauseToggle}
                  className="btn"
                  aria-pressed={paused}
                  disabled={!plotReady}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: plotReady ? (paused ? '#28a745' : '#ffc107') : '#94a3b8',
                    color: '#fff',
                    cursor: plotReady ? 'pointer' : 'not-allowed',
                  }}
                >
                  {paused ? 'Start / Resume' : 'Pause'}
                </button>
                <button
                  onClick={onReset}
                  className="btn"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#dc3545',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Reset
                </button>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span>Moves: <strong>{moves}</strong></span>
                  <span>Stars: <strong>{collected}</strong> / {totalStars}</span>
                </div>
              </div>

              {/* Display chosen random start coordinate above the canvas */}
              {plotReady && startCoord && (
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Random starting coordinate: x = {Number(startCoord.x).toFixed(2)}
                  {isFinite(startCoord.y) ? `, y = ${Number(startCoord.y).toFixed(2)}` : ' (y computed from curve)'}
                </div>
              )}

              <div
                className="panels"
                style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}
              >
                <GameCanvas
                  key={resetSeed}
                  expressions={orderedExpressions}
                  paused={paused || !plotReady}
                  onStarStats={onStarStats}
                  onComplete={onGameComplete}
                  onCurveFinished={onCurveFinished}
                  startCoord={plotReady ? startCoord : null}
                  onStartEvaluated={(pt) => {
                    // Store evaluated y for display
                    if (pt && isFinite(pt.x) && isFinite(pt.y)) {
                      setStartCoord({ x: pt.x, y: pt.y });
                    }
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Sequencing mode: the ball follows each equation in order. When a path ends, it automatically continues to the next. Stops after the last curve.
                </div>
              </div>
              <div aria-live="polite" style={{ minHeight: 22, color: 'var(--text-secondary)' }}>
                {statusMsg}
              </div>

              {showEndModal && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="end-modal-title"
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                  }}
                >
                  <div
                    style={{
                      width: 'min(480px, 92vw)',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 12,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                      padding: 16
                    }}
                  >
                    <div id="end-modal-title" style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
                      {endResult.success ? 'Great job! ⭐ All stars collected' : 'Level failed'}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
                      Stars collected: <strong>{endResult.collected}</strong> / {endResult.total}
                    </div>
                    {!endResult.success && (
                      <div style={{ color: '#dc3545', fontSize: 13, marginBottom: 12 }}>
                        You missed some stars. Try adjusting your equations and attempt again.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {!endResult.success && (
                        <button
                          onClick={() => {
                            setShowEndModal(false);
                          }}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          Close
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowEndModal(false);
                          onReset();
                        }}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: 'none',
                          background: endResult.success ? '#198754' : '#0d6efd',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        {endResult.success ? 'Play Again' : 'Retry'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Leaderboard items={leaderboard} />
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;
