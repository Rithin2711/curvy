import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GameCanvas({ expression, paused, onStarStats, onComplete }) {
  /**
   * Desmos-style gameplay:
   * - We sample y=f(x) in world-space x in [-W/2, W/2], map to canvas.
   * - Ball starts at the topmost point (smallest canvas y) on the curve.
   * - Ball slides along the curve only. Gravity projects along tangent for motion.
   * - Stars are fixed at static canvas coordinates below the top, and collected
   *   when the ball's current curve point is within radius.
   */
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Simulation state
  const compiled = useMemo(() => {
    try {
      return math.compile(expression);
    } catch {
      return null;
    }
  }, [expression]);

  const [curve, setCurve] = useState({ points: [], xToPx: () => 0, yToPx: () => 0 });
  const [state, setState] = useState({
    idx: 0,    // current index along curve polyline
    dir: 1,    // 1 forward, -1 backward (should go towards increasing y generally)
    speed: 0,  // scalar speed along curve (px/s)
  });
  const starsRef = useRef([]);
  const collectedRef = useRef([]);
  const animationRef = useRef(0);
  const lastTsRef = useRef(0);

  // responsive width
  useEffect(() => {
    const el = containerRef.current;
    const calc = () => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width));
      setDimensions({ w, h: 420 });
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build curve samples and reset ball at topmost point
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    const xMin = -w / 2;
    const xMax = w / 2;
    const samples = [];
    const step = 2; // px per sample in world x

    const xToPx = (x) => x + w / 2;
    // World y positive up -> Canvas y positive down; center at h/2:
    const yToPx = (y) => h / 2 - y;

    if (compiled) {
      for (let x = xMin; x <= xMax; x += step) {
        try {
          const y = compiled.evaluate({ x });
          if (isFinite(y)) {
            samples.push({ x, y, px: xToPx(x), py: yToPx(y) });
          }
        } catch {
          // skip
        }
      }
    }

    // Find topmost point (minimum canvas py)
    let startIdx = 0;
    let minPy = Number.POSITIVE_INFINITY;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].py < minPy) {
        minPy = samples[i].py;
        startIdx = i;
      }
    }

    setCurve({ points: samples, xToPx, yToPx });
    setState({ idx: startIdx, dir: 1, speed: 0 });

    // Stars: fixed canvas coordinates below (deterministic)
    const starR = 10;
    const positions = [
      { x: w * 0.25, y: h * 0.35 },
      { x: w * 0.50, y: h * 0.45 },
      { x: w * 0.75, y: h * 0.55 },
      { x: w * 0.35, y: h * 0.65 },
      { x: w * 0.65, y: h * 0.75 },
    ];
    starsRef.current = positions.map((p, i) => ({ ...p, r: starR, id: i }));
    collectedRef.current = new Array(positions.length).fill(false);
    onStarStats({ collected: 0, total: positions.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled, dimensions.h, dimensions.w, expression]);

  // Physics step: slide along curve
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = dimensions.w;
    const h = dimensions.h;

    canvas.width = w;
    canvas.height = h;

    const g = 800; // px/s^2 gravity (downwards +y in canvas)
    const maxSpeed = 500; // px/s
    const friction = 0.08; // proportional damping along tangent

    function draw() {
      // Clear
      ctx.clearRect(0, 0, w, h);

      // Background gradient (subtle)
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#111');
      grad.addColorStop(1, '#333');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Grid-like feel (optional faint)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let y = 0; y <= h; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let x = 0; x <= w; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Draw curve
      ctx.strokeStyle = '#61dafb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      curve.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.px, p.py);
        else ctx.lineTo(p.px, p.py);
      });
      ctx.stroke();

      // Draw stars
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = collected ? 'rgba(255,255,255,0.15)' : '#ffd166';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });

      // Draw ball
      const p = curve.points[state.idx];
      if (p) {
        ctx.beginPath();
        ctx.arc(p.px, p.py, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#ffcc00';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
    }

    function step(dt) {
      if (paused) return;

      if (curve.points.length < 2) return;
      let { idx, dir, speed } = state;

      // Local tangent using adjacent sample
      const i0 = Math.max(0, Math.min(curve.points.length - 2, idx));
      const i1 = i0 + 1;
      const A = curve.points[i0];
      const B = curve.points[i1];
      if (!A || !B) return;

      const tx = B.px - A.px;
      const ty = B.py - A.py;
      const len = Math.hypot(tx, ty) || 1;
      const ux = tx / len;
      const uy = ty / len;

      // Gravity vector in canvas: (0, +g). Project onto tangent to get acceleration along path:
      const ax = 0, ay = g;
      const a_tan = ax * ux + ay * uy; // scalar acceleration along tangent direction
      // Adjust speed; apply simple friction
      speed += a_tan * dt;
      const sign = Math.sign(speed) || 1;
      const frictionForce = -friction * speed;
      speed += frictionForce * dt;
      // clamp
      if (speed > maxSpeed) speed = maxSpeed;
      if (speed < -maxSpeed) speed = -maxSpeed;

      // Advance along the polyline by distance = |speed| * dt
      let travel = Math.abs(speed * dt);
      let currentIdx = i0;
      let remaining = travel;
      let forward = speed >= 0 ? 1 : -1;

      let curPoint = curve.points[currentIdx];
      while (remaining > 0 && currentIdx >= 0 && currentIdx < curve.points.length - 1) {
        const P = curve.points[currentIdx];
        const Q = curve.points[currentIdx + 1];
        const segLen = Math.hypot(Q.px - P.px, Q.py - P.py);
        if (segLen <= remaining) {
          remaining -= segLen;
          currentIdx += forward;
          curPoint = curve.points[Math.max(0, Math.min(curve.points.length - 1, currentIdx))];
          // Bounds: stop at end
          if (currentIdx <= 0 || currentIdx >= curve.points.length - 1) {
            speed = 0;
            break;
          }
        } else {
          // stay within this segment, progress fractionally
          const frac = remaining / segLen;
          // For rendering we keep discrete idx; approximate by moving to nearer vertex
          if (frac > 0.5 && currentIdx + forward >= 0 && currentIdx + forward < curve.points.length) {
            currentIdx += forward;
          }
          remaining = 0;
        }
      }

      // Ensure movement direction follows increasing canvas y overall (downwards)
      // If we are at the topmost area, speed will initially be ~0 and then accelerate
      idx = Math.max(0, Math.min(curve.points.length - 1, currentIdx));
      dir = forward;

      // Check star collisions
      const cp = curve.points[idx];
      if (cp) {
        const bx = cp.px, by = cp.py;
        let newly = 0;
        starsRef.current.forEach((s, i) => {
          if (!collectedRef.current[i]) {
            const d = Math.hypot(bx - s.x, by - s.y);
            if (d <= s.r + 12) {
              collectedRef.current[i] = true;
              newly += 1;
            }
          }
        });
        if (newly > 0) {
          const c = collectedRef.current.filter(Boolean).length;
          onStarStats({ collected: c, total: collectedRef.current.length });
          if (c === collectedRef.current.length) {
            onComplete && onComplete(Math.round(1000 - (by || 0)));
          }
        }
      }

      setState({ idx, dir, speed });
    }

    function raf(ts) {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      step(dt);
      draw();
      animationRef.current = requestAnimationFrame(raf);
    }

    animationRef.current = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [curve.points, dimensions.h, dimensions.w, onComplete, onStarStats, paused, state]);

  // Redraw stars/curve when pause toggles too (to avoid stale frame)
  useEffect(() => {
    lastTsRef.current = 0;
  }, [paused]);

  // initialize HUD stats (in case)
  useEffect(() => {
    onStarStats({
      collected: (collectedRef.current || []).filter(Boolean).length,
      total: (collectedRef.current || []).length || 5,
    });
  }, [onStarStats]);

  return (
    <div className="game-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Game</div>
      <div ref={containerRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          role="application"
          aria-label="Gravity Curve Game Canvas"
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: The ball starts at the topmost point of y = f(x) and slides along the curve. Adjust the equation to collect all stars!
      </div>
    </div>
  );
}
