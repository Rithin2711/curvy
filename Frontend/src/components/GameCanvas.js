import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GameCanvas({ expression, paused, onStarStats, onComplete }) {
  /**
   * Unified graph + gameplay canvas:
   * - Plots y = f(x) and overlays the moving player ball and stationary stars.
   * - Single canvas ensures no duplication of the graph.
   * - Player ball: cyan filled circle with white outline and glow.
   * - Stars: yellow five-point star shapes; greyed with outline when collected.
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
          // skip invalid points
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
    setState({ idx: startIdx, speed: 0 });

    // Stars: deterministic positions relative to canvas size
    const starR = 12;
    const positions = [
      { x: w * 0.22, y: h * 0.35 },
      { x: w * 0.50, y: h * 0.46 },
      { x: w * 0.78, y: h * 0.58 },
      { x: w * 0.34, y: h * 0.68 },
      { x: w * 0.66, y: h * 0.78 },
    ];
    starsRef.current = positions.map((p, i) => ({ ...p, r: starR, id: i }));
    collectedRef.current = new Array(positions.length).fill(false);
    onStarStats({ collected: 0, total: positions.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled, dimensions.h, dimensions.w, expression]);

  // Helper to draw a five-pointed star
  function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, fill, stroke, collected) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();

    ctx.fillStyle = collected ? 'rgba(255, 255, 255, 0.2)' : fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = collected ? 'transparent' : '#FFEB99';
    ctx.shadowBlur = collected ? 0 : 6;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Physics/Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = dimensions.w;
    const h = dimensions.h;

    canvas.width = w;
    canvas.height = h;

    const g = 800; // px/s^2 gravity (downwards +y in canvas)
    const maxSpeed = 550; // px/s
    const friction = 0.08; // proportional damping along tangent

    function drawAxesAndGrid() {
      // Background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0f1220');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Grid
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

      // Axes (centered)
      ctx.strokeStyle = 'rgba(97,218,251,0.6)';
      ctx.lineWidth = 1.5;
      // x-axis
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      // y-axis
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
    }

    function drawCurve() {
      if (curve.points.length < 2) return;
      ctx.strokeStyle = '#61dafb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      curve.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.px, p.py);
        else ctx.lineTo(p.px, p.py);
      });
      ctx.stroke();
    }

    function drawStars() {
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        drawStar(ctx, s.x, s.y, 5, s.r, s.r * 0.5, '#ffd166', '#ffffff', collected);
      });
    }

    function drawBall() {
      const p = curve.points[state.idx];
      if (!p) return;
      ctx.save();
      // Glow
      ctx.shadowColor = '#7ee0ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.px, p.py, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#22d3ee'; // cyan
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    function drawLegend() {
      const pad = 10;
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = '#cbd5e1';
      const label = `y = ${expression}`;
      ctx.fillText(label, pad, 18);

      // Legend icons
      // Curve
      ctx.strokeStyle = '#61dafb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, 30);
      ctx.lineTo(pad + 18, 30);
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Curve', pad + 24, 34);

      // Ball
      ctx.beginPath();
      ctx.fillStyle = '#22d3ee';
      ctx.strokeStyle = '#fff';
      ctx.arc(pad + 6, 48, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Player', pad + 24, 52);

      // Star
      drawStar(ctx, pad + 6, 68, 5, 6, 3, '#ffd166', '#fff', false);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Star', pad + 24, 72);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      drawAxesAndGrid();
      drawCurve();
      drawStars();
      drawBall();
      drawLegend();
    }

    function step(dt) {
      if (paused) return;
      if (curve.points.length < 2) return;
      let { idx, speed } = state;

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

      // Gravity projection onto tangent (canvas gravity is +y)
      const ax = 0, ay = g;
      const a_tan = ax * ux + ay * uy;
      // Integrate speed with friction
      speed += a_tan * dt;
      const frictionForce = -friction * speed;
      speed += frictionForce * dt;
      // Clamp
      speed = Math.max(-maxSpeed, Math.min(maxSpeed, speed));

      // Move along polyline
      let travel = Math.abs(speed * dt);
      let currentIdx = i0;
      const forward = speed >= 0 ? 1 : -1;

      while (travel > 0 && currentIdx >= 0 && currentIdx < curve.points.length - 1) {
        const P = curve.points[currentIdx];
        const Q = curve.points[currentIdx + 1];
        const segLen = Math.hypot(Q.px - P.px, Q.py - P.py);
        if (segLen <= travel) {
          travel -= segLen;
          currentIdx += forward;
          if (currentIdx <= 0 || currentIdx >= curve.points.length - 1) {
            speed = 0;
            break;
          }
        } else {
          // partial progress: snap if over halfway to reduce jitter
          const frac = travel / segLen;
          if (frac > 0.5 && currentIdx + forward >= 0 && currentIdx + forward < curve.points.length) {
            currentIdx += forward;
          }
          travel = 0;
        }
      }

      idx = Math.max(0, Math.min(curve.points.length - 1, currentIdx));

      // Collisions with stars
      const cp = curve.points[idx];
      if (cp) {
        const bx = cp.px, by = cp.py;
        let newly = 0;
        starsRef.current.forEach((s, i) => {
          if (!collectedRef.current[i]) {
            const d = Math.hypot(bx - s.x, by - s.y);
            if (d <= s.r + 12) {
              collectedRef.current[i] = true;
              newly++;
            }
          }
        });
        if (newly > 0) {
          const c = collectedRef.current.filter(Boolean).length;
          onStarStats({ collected: c, total: collectedRef.current.length });
          if (c === collectedRef.current.length) {
            onComplete && onComplete(Math.max(0, Math.round(1000 - by)));
          }
        }
      }

      setState({ idx, speed });
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
  }, [curve.points, dimensions.h, dimensions.w, expression, onComplete, onStarStats, paused, state]);

  useEffect(() => {
    lastTsRef.current = 0;
  }, [paused]);

  useEffect(() => {
    onStarStats({
      collected: (collectedRef.current || []).filter(Boolean).length,
      total: (collectedRef.current || []).length || 5,
    });
  }, [onStarStats]);

  return (
    <div className="game-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Graph + Game</div>
      <div ref={containerRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          role="application"
          aria-label="Unified Graph and Game Canvas"
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: The ball starts at the highest point of y = f(x) and slides along. Adjust the equation to collect all stars!
      </div>
    </div>
  );
}
