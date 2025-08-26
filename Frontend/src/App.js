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
   * - Single equation input with validation
   * - Unified canvas for graph + gameplay rendering a single curve
   * - Pause/Resume/Reset controls and HUD
   * - Leaderboard view
   * It integrates with backend APIs via the services/api module.
   */
  const [theme, setTheme] = useState('light');

  // Single equation state
  const [equation, setEquation] = useState({ id: 1, expr: '0.5*x', color: '#61dafb', min: -200, max: 200 });

  const [paused, setPaused] = useState(true);
  const [resetSeed, setResetSeed] = useState(0);
  const [collected, setCollected] = useState(0);
  const [totalStars, setTotalStars] = useState(5);
  const [moves, setMoves] = useState(0);
  const [username, setUsername] = useState('guest');
  const [leaderboard, setLeaderboard] = useState([]);
  const [statusMsg, setStatusMsg] = useState('');

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
  function applyEquation(payload) {
    /** Apply equation change and count as a move if game is running */
    const { expr, min, max } = payload || {};
    setEquation((prev) => ({
      ...prev,
      expr: typeof expr === 'string' ? expr : prev.expr,
      min: isFinite(min) ? Number(min) : prev.min,
      max: isFinite(max) ? Number(max) : prev.max,
    }));
    setMoves((m) => (!paused ? m + 1 : m));
  }

  const onPauseToggle = () => {
    setPaused((p) => !p);
  };

  const onReset = () => {
    setResetSeed((s) => s + 1);
    setMoves(0);
    setCollected(0);
    setStatusMsg('');
    setPaused(true);
  };

  const onGameComplete = async (score) => {
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

  // PUBLIC_INTERFACE
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

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

              {/* Single equation input */}
              <div className="equation-panel" style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600 }}>Equation y = f(x)</div>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: equation.color,
                        border: '1px solid rgba(0,0,0,0.1)'
                      }}
                      aria-label="Equation color"
                      title={equation.color}
                    />
                    <div style={{ flex: 1 }}>
                      <EquationInput
                        onApply={(payload) => applyEquation(payload)}
                        initialValue={equation.expr}
                        initialMin={equation.min ?? -200}
                        initialMax={equation.max ?? 200}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={onPauseToggle}
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

              <div
                className="panels"
                style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}
              >
                <GameCanvas
                  key={resetSeed}
                  expressions={[equation]} // single equation
                  paused={paused}
                  onStarStats={onStarStats}
                  onComplete={onGameComplete}
                />
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Single-path mode: the ball follows only the current equation and stops at the end of its domain.
                </div>
              </div>
              <div aria-live="polite" style={{ minHeight: 22, color: 'var(--text-secondary)' }}>
                {statusMsg}
              </div>
            </div>

            <Leaderboard items={leaderboard} />
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;
