import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GameCanvas({ expressions = [], paused, onStarStats, onComplete }) {
  /**
   * Unified graph + gameplay canvas with multiple curves:
   * - Plots all y = f_i(x) with distinct colors and overlays a single moving ball.
   * - Ball follows the nearest curve segment at its current position (curve-switch allowed).
   * - Stars: yellow five-point star shapes; greyed with outline when collected.
   */
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Compile all expressions
  const compiledList = useMemo(() => {
    return (expressions || []).map((e) => {
      try {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: math.compile(e.expr) };
      } catch {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: null };
      }
    });
  }, [expressions]);

  // Curves: [{id,color,points:[], xToPx, yToPx}]
  const [curves, setCurves] = useState([]);
  const [state, setState] = useState({
    x: 0, // world x position of ball (px)
    y: 0, // world y position of ball (px, positive up)
    vx: 0,
    vy: 0,
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

  // Build curve samples and reset ball at overall topmost among all curves
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    // Default canvas bounds, but per-curve sampling uses provided [min,max]
    const step = 2; // px per sample in world x

    const xToPx = (x) => x + w / 2;
    // World y positive up -> Canvas y positive down; center at h/2:
    const yToPx = (y) => h / 2 - y;

    const allCurves = [];

    compiledList.forEach((item) => {
      const pts = [];
      if (item.compiled) {
        // Get the declared domain for this expression from expressions prop
        const src = (expressions || []).find((e) => e.id === item.id);
        let xMin = isFinite(src?.min) ? Number(src.min) : -w / 2;
        let xMax = isFinite(src?.max) ? Number(src.max) : w / 2;
        if (xMin > xMax) {
          // swap if invalid
          const t = xMin;
          xMin = xMax;
          xMax = t;
        }
        // sample only within the desired domain
        for (let x = xMin; x <= xMax; x += step) {
          try {
            const y = item.compiled.evaluate({ x });
            if (isFinite(y)) {
              pts.push({ x, y, px: xToPx(x), py: yToPx(y) });
            }
          } catch {
            // ignore invalid points
          }
        }
      }
      allCurves.push({
        id: item.id,
        color: item.color,
        expr: item.expr,
        points: pts,
        xToPx,
        yToPx,
        // store domain for runtime clamping
        min: (expressions || []).find((e) => e.id === item.id)?.min,
        max: (expressions || []).find((e) => e.id === item.id)?.max,
      });
    });

    // Find overall highest point (min py => max world y)
    let best = { x: 0, y: 0, py: Number.POSITIVE_INFINITY };
    allCurves.forEach((c) => {
      c.points.forEach((p) => {
        if (p.py < best.py) best = { x: p.x, y: p.y, py: p.py };
      });
    });

    // Default if no valid curves: place at top center
    const startX = isFinite(best.x) ? best.x : 0;
    const startY = isFinite(best.y) ? best.y : (h / 2 - 10);

    setCurves(allCurves);
    setState({ x: startX, y: startY, vx: 0, vy: 0 });

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
  }, [compiledList, dimensions.h, dimensions.w, expressions]);

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
    const snapDist = 16; // px distance to snap ball to nearest curve

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

    function drawCurves() {
      curves.forEach((curve) => {
        if (!curve.points || curve.points.length < 2) return;
        ctx.strokeStyle = curve.color || '#61dafb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        curve.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        });
        ctx.stroke();
      });
    }

    function drawStars() {
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        drawStar(ctx, s.x, s.y, 5, s.r, s.r * 0.5, '#ffd166', '#ffffff', collected);
      });
    }

    function worldToCanvas(x, y) {
      // world x,y with center at (w/2,h/2); y positive up
      return { px: x + w / 2, py: h / 2 - y };
    }

    function drawBall() {
      const { px, py } = worldToCanvas(state.x, state.y);
      ctx.save();
      // Glow
      ctx.shadowColor = '#7ee0ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
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
      ctx.fillText('y = f(x) curves', pad, 18);

      let y = 34;
      curves.forEach((c) => {
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + 18, y);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        const labelExpr = c.expr?.length > 30 ? c.expr.slice(0, 27) + '…' : c.expr || '(invalid)';
        const domMin = isFinite(c.min) ? c.min : '−∞';
        const domMax = isFinite(c.max) ? c.max : '∞';
        const label = `${labelExpr}  [${domMin}, ${domMax}]`;
        ctx.fillText(label, pad + 24, y + 4);
        y += 18;
      });

      // Ball
      ctx.beginPath();
      ctx.fillStyle = '#22d3ee';
      ctx.strokeStyle = '#fff';
      ctx.arc(pad + 6, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Player', pad + 24, y + 4);
      y += 18;

      // Star
      drawStar(ctx, pad + 6, y, 5, 6, 3, '#ffd166', '#fff', false);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Star', pad + 24, y + 4);
    }

    function nearestPointOnCurves(x, y) {
      // Find nearest sampled point across all curves (points already in-domain)
      let best = null;
      curves.forEach((c) => {
        for (let i = 0; i < c.points.length; i++) {
          const p = c.points[i];
          const dx = p.x - x;
          const dy = p.y - y;
          const d2 = dx * dx + dy * dy;
          if (!best || d2 < best.d2) {
            best = { curve: c, index: i, d2, p };
          }
        }
      });
      return best;
    }

    function step(dt) {
      if (paused) return;
      if (curves.length === 0) return;

      // Gravity
      let { x, y, vx, vy } = state;
      vy += g * dt * -1; // world y is positive up; gravity down -> -1

      // Move by velocity first
      x += vx * dt;
      y += vy * dt;

      // Find nearest curve point and project motion along its tangent if within snap distance
      const near = nearestPointOnCurves(x, y);
      if (near && near.d2 <= snapDist * snapDist) {
        const c = near.curve;
        const i0 = Math.max(0, Math.min(c.points.length - 2, near.index));
        const A = c.points[i0];
        const B = c.points[i0 + 1] || A;
        const tx = B.x - A.x;
        const ty = B.y - A.y;
        const len = Math.hypot(tx, ty) || 1;
        const ux = tx / len;
        const uy = ty / len;

        // Snap ball position to nearest point to reduce drift
        x = near.p.x;
        y = near.p.y;

        // Clamp x inside curve domain if provided
        const minX = isFinite(c.min) ? Number(c.min) : -Infinity;
        const maxX = isFinite(c.max) ? Number(c.max) : Infinity;
        if (x < minX + 0.5 * step || x > maxX - 0.5 * step) {
          // Dampen speed near edges to avoid jitter
          vx *= 0.5;
          vy *= 0.5;
        }

        // Project velocity along tangent
        const v_tan = vx * ux + vy * uy;
        // Gravity projection along tangent (gravity down is -y in world)
        const ax = 0, ay = -g;
        const a_tan = ax * ux + ay * uy;

        let speed = v_tan + a_tan * dt;
        speed += (-friction * speed) * dt;
        speed = Math.max(-maxSpeed, Math.min(maxSpeed, speed));

        vx = speed * ux;
        vy = speed * uy;
      }

      // Stars collision in canvas space
      const { px, py } = worldToCanvas(x, y);
      let newly = 0;
      starsRef.current.forEach((s, i) => {
        if (!collectedRef.current[i]) {
          const d = Math.hypot(px - s.x, py - s.y);
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
          onComplete && onComplete(Math.max(0, Math.round(1000 - py)));
        }
      }

      setState({ x, y, vx, vy });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      drawAxesAndGrid();
      drawCurves();
      drawStars();
      drawBall();
      drawLegend();
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
  }, [curves, dimensions.h, dimensions.w, expressions, onComplete, onStarStats, paused, state]);

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
        Tip: The ball follows the nearest y = f(x). Add and tweak multiple equations to collect all stars!
      </div>
    </div>
  );
}
