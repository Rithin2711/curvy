import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import EquationInput from './components/EquationInput';
import CurveInput from './components/CurveInput';

import GameCanvas from './components/GameCanvas';
import Leaderboard from './components/Leaderboard';
import { createApi } from './services/api';

// PUBLIC_INTERFACE
function App() {
  /**
   * This is the main Gravity Curve app. It renders:
   * - Theme toggle
   * - (Gated) equation inputs appear only after user clicks "Start plotting"
   * - Unified canvas for graph + gameplay
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

  // Game flow state
  const [plotReady, setPlotReady] = useState(false);
  const [startCoord, setStartCoord] = useState(null); // {x,y} in world units; displayed above canvas
  const [showInputUI, setShowInputUI] = useState(false); // controls visibility of equation inputs
  const [plotButtonEnabled, setPlotButtonEnabled] = useState(true); // minimal flow: enabled by default
  const [gameStarted, setGameStarted] = useState(false); // controls if ball movement has started

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
    setStatusMsg('Click "Start plotting" to begin a new game!');
    setPaused(true);
    setActiveIndex(0);
    setShowEndModal(false);
    setEndResult({ success: false, collected: 0, total: 0 });

    // Reset all game flow states
    setPlotReady(false);
    setShowInputUI(false);
    setPlotButtonEnabled(true);
    setGameStarted(false);
    setStartCoord(null); // will regenerate when user plots again

    // Reset equations to initial state
    setEquations([
      { id: 1, expr: '0.5*x', color: '#61dafb', min: -200, max: 200 },
    ]);
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
    setPaused(true); // Keep paused until Start is clicked
    setShowInputUI(false); // Hide input UI after plotting
    setGameStarted(false); // Reset game started state
    setPlotButtonEnabled(false); // Disable plot button after successful plot
    setStatusMsg(`Curve plotted! Click Start to begin from x = ${rx.toFixed(2)}.`);
    
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
              {/* Minimal equation input always visible */}
              <div className="equation-panel" style={{ display: 'grid', gap: 10 }}>
                <CurveInput
                  initialExpr={equations[0]?.expr || '0.5*x'}
                  initialMin={equations[0]?.min ?? -200}
                  initialMax={equations[0]?.max ?? 200}
                  onSubmit={({ expr, min, max }) => {
                    // Update the equation and prepare plot, but keep ball stationary (paused)
                    setEquations([{ id: 1, expr, color: '#61dafb', min, max }]);
                    setPlotReady(true);
                    setPaused(true); // keep stationary until user presses Start/Resume
                    setGameStarted(false);
                    setStatusMsg('Curve set. Click Start to begin.');
                    // reset/reseed canvas so the ball position updates to the curve start but remains stationary
                    setResetSeed((s) => s + 1);
                  }}
                />
              </div>

              {/* Minimal HUD: moves & stars and reset */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={() => setPaused((p) => !p)}
                  className="btn"
                  aria-pressed={paused}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: paused ? '#28a745' : '#ffc107',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  {paused ? 'Resume' : 'Pause'}
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

              <div
                className="panels"
                style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}
              >
                <GameCanvas
                  key={resetSeed}
                  expressions={plotReady ? orderedExpressions : []}
                  paused={paused || !plotReady}
                  onStarStats={onStarStats}
                  onComplete={onGameComplete}
                  onCurveFinished={onCurveFinished}
                  startCoord={plotReady ? startCoord : null}
                  onStartEvaluated={(pt) => {
                    if (pt && isFinite(pt.x) && isFinite(pt.y)) {
                      setStartCoord({ x: pt.x, y: pt.y });
                    }
                  }}
                  minimalMode={true}
                />
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
                        You missed some stars. Try again with another curve.
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

            {/* Keep leaderboard if desired, but it's not required by this subtask */}
            {/* <Leaderboard items={leaderboard} /> */}
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;
