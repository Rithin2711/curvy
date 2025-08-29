import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 * GameCanvas renders the interactive playfield with:
 * - Fixed start point at the left bound of the first valid curve.
 * - Multi-equation sequencing; the ball traverses each curve left->right.
 * - Random stars (yellow/gold) rendered clearly; collected on touch.
 * - Start/Pause/Resume via external "paused" prop.
 * - Visual feedback: grid/axes, all curves, ball, path trail, star status, legend.
 *
 * World coordinates: y = f(x), canvas mapping: px = x + w/2, py = h/2 - y.
 */
export default function GameCanvas({
  expressions = [],
  paused = true,
  onStarStats,
  onComplete,
  onCurveFinished,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Compile equations; preserve order and color metadata
  const compiledList = useMemo(() => {
    return (expressions || []).map((e, idx) => {
      let compiled = null;
      try { compiled = math.compile(e.expr); } catch { compiled = null; }
      return {
        id: e.id ?? idx,
        expr: e.expr,
        color: e.color || '#61dafb',
        compiled,
        orderIndex: e.orderIndex ?? idx,
        min: isFinite(e.min) ? Number(e.min) : undefined,
        max: isFinite(e.max) ? Number(e.max) : undefined,
      };
    });
  }, [expressions]);

  // Curves sampled as polylines
  const [curves, setCurves] = useState([]);

  // Ball state (world coords)
  const [state, setState] = useState({ x: 0, y: 0 });

  // Gameplay refs
  const activeCurveIdRef = useRef(null);
  const sRef = useRef(0); // x parameter
  const speedRef = useRef(140); // units/sec
  const idleEndRef = useRef(false);
  const lastTsRef = useRef(0);
  const animRef = useRef(0);

  // Stars in canvas coordinates
  const starsRef = useRef([]);
  const collectedRef = useRef([]);
  const starPopPhasesRef = useRef(new Map());

  // Path trail
  const pathRef = useRef([]);
  const PATH_MAX_POINTS = 1500;
  const PATH_FADE_MS = 7000;

  // Responsive sizing
  useEffect(() => {
    const calc = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      setDimensions({ w, h: 420 });
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Build curve polylines from expressions; reset ball to fixed start
  useEffect(() => {
    const { w, h } = dimensions;
    const xToPx = (x) => x + w / 2;
    const yToPx = (y) => h / 2 - y;
    const visibleMin = -w / 2;
    const visibleMax = w / 2;
    const stepWorld = Math.max(0.5, Math.min(2, w / 600));

    const ordered = [...compiledList].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    const built = ordered.map((item, idx) => {
      const domMin = isFinite(item.min) ? Math.max(visibleMin, item.min) : visibleMin;
      const domMax = isFinite(item.max) ? Math.min(visibleMax, item.max) : visibleMax;
      const [xmin, xmax] = domMin <= domMax ? [domMin, domMax] : [domMax, domMin];

      const pts = [];
      if (item.compiled && xmax > xmin) {
        const steps = Math.max(2, Math.ceil((xmax - xmin) / stepWorld));
        for (let i = 0; i <= steps; i++) {
          const x = i === steps ? xmax : xmin + (i * (xmax - xmin)) / steps;
          try {
            const y = item.compiled.evaluate({ x });
            if (isFinite(y)) pts.push({ x, y, px: xToPx(x), py: yToPx(y) });
          } catch {
            // skip invalid sample
          }
        }
      }
      return {
        id: item.id ?? idx,
        expr: item.expr,
        color: item.color || '#61dafb',
        compiled: item.compiled,
        orderIndex: item.orderIndex ?? idx,
        min: xmin,
        max: xmax,
        points: pts,
      };
    });

    // Fixed start: left bound of first valid curve
    const first = built.find((c) => c.compiled && c.points.length > 0 && isFinite(c.min) && isFinite(c.max));
    let startX = 0, startY = 0;
    if (first) {
      const sx = first.min;
      let sy = 0;
      try { sy = first.compiled.evaluate({ x: sx }); } catch { sy = first.points[0]?.y ?? 0; }
      startX = sx;
      startY = isFinite(sy) ? sy : 0;
      activeCurveIdRef.current = first.id;
      sRef.current = sx;
      idleEndRef.current = false;
    } else {
      activeCurveIdRef.current = null;
      sRef.current = 0;
      idleEndRef.current = true;
    }

    setCurves(built);
    setState({ x: startX, y: startY });
    pathRef.current = [{ x: startX, y: startY, t: performance.now() }];

    // Reset stars/stats
    starsRef.current = [];
    collectedRef.current = [];
    onStarStats && onStarStats({ collected: 0, total: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledList, dimensions.w, dimensions.h]);

  // Helpers
  const worldToCanvas = (w, h, x, y) => ({ px: x + w / 2, py: h / 2 - y });
  const getActiveCurve = () => curves.find((c) => c.id === activeCurveIdRef.current && c.compiled);
  const orderedCurves = () => [...curves].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const findNextCurve = (currentId) => {
    const list = orderedCurves();
    const idx = list.findIndex((c) => c.id === currentId);
    for (let i = idx + 1; i < list.length; i++) {
      const c = list[i];
      if (c.compiled && c.points?.length > 0 && isFinite(c.min) && isFinite(c.max)) return c;
    }
    return null;
  };

  // Movement step along current curve, switch at end
  const stepOnCurve = (dt) => {
    if (idleEndRef.current) return { ...state };
    const active = getActiveCurve();
    if (!active) return { ...state };

    const minX = Number(active.min);
    const maxX = Number(active.max);

    if (paused) {
      // lock to curve at current x
      let yHold = state.y;
      try { yHold = active.compiled.evaluate({ x: sRef.current }); } catch {}
      return { x: sRef.current, y: yHold };
    }

    const speed = speedRef.current;
    let s = sRef.current + speed * dt;
    if (s >= maxX) s = maxX;
    if (s < minX) s = minX;

    // Reached end of this curve
    if (s >= maxX) {
      sRef.current = s;
      let yEdge = state.y;
      try { yEdge = active.compiled.evaluate({ x: s }); } catch {}
      const nxt = findNextCurve(active.id);
      if (nxt) {
        const nx = Number(nxt.min);
        let ny = 0;
        try { ny = nxt.compiled.evaluate({ x: nx }); } catch { ny = nxt.points[0]?.y ?? 0; }
        activeCurveIdRef.current = nxt.id;
        sRef.current = nx;
        onCurveFinished && onCurveFinished(orderedCurves().findIndex(c => c.id === nxt.id));
        return { x: nx, y: isFinite(ny) ? ny : 0 };
      }
      // No next curve; stop animating but do not complete until all stars are collected
      idleEndRef.current = true;
      onCurveFinished && onCurveFinished(orderedCurves().length);
      return { x: s, y: yEdge };
    }

    // Evaluate position along current curve
    let yVal = state.y;
    try { yVal = active.compiled.evaluate({ x: s }); } catch { return { ...state }; }
    if (!isFinite(yVal)) return { ...state };
    sRef.current = s;
    return { x: s, y: yVal };
  };

  // Drawing helpers
  const drawStar = (ctx, cx, cy, spikes, outerRadius, innerRadius, fill, stroke, collected) => {
    let rot = Math.PI / 2 * 3;
    let x = cx, y = cy;
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
    ctx.fillStyle = collected ? 'rgba(255,255,255,0.2)' : fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = collected ? 'transparent' : '#FFEB99';
    ctx.shadowBlur = collected ? 0 : 6;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // Animation loop and rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { w, h } = dimensions;
    canvas.width = w;
    canvas.height = h;

    // Clamp s to active curve domain
    const active = getActiveCurve && getActiveCurve();
    if (active) {
      sRef.current = Math.min(active.max, Math.max(active.min, sRef.current));
    }

    const drawBackground = () => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0f1220');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    };

    const drawGridAxes = () => {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let y = 0; y <= h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let x = 0; x <= w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

      ctx.strokeStyle = 'rgba(97,218,251,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
    };

    const drawCurves = () => {
      curves.forEach((c) => {
        if (!c.points || c.points.length < 2) return;
        const isActive = c.id === activeCurveIdRef.current;
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.globalAlpha = isActive ? 1 : 0.55;
        ctx.lineWidth = isActive ? 2.4 : 1.6;
        ctx.beginPath();
        for (let i = 0; i < c.points.length; i++) {
          const p = c.points[i];
          if (i === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };

    const drawTrail = (now) => {
      if (!pathRef.current || pathRef.current.length < 2) return;
      const cutoff = now - PATH_FADE_MS;
      while (pathRef.current.length && pathRef.current[0].t < cutoff) pathRef.current.shift();
      ctx.save();
      ctx.lineWidth = 3;
      for (let i = 1; i < pathRef.current.length; i++) {
        const a = pathRef.current[i - 1];
        const b = pathRef.current[i];
        const age = Math.max(0, Math.min(1, (b.t - cutoff) / PATH_FADE_MS));
        const alpha = 0.15 + 0.55 * age;
        ctx.strokeStyle = `rgba(124,58,237,${alpha.toFixed(3)})`;
        const { px: ax, py: ay } = worldToCanvas(w, h, a.x, a.y);
        const { px: bx, py: by } = worldToCanvas(w, h, b.x, b.y);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.restore();
    };

    const drawBall = (x, y) => {
      const { px, py } = worldToCanvas(w, h, x, y);
      ctx.save();
      ctx.shadowColor = '#7ee0ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#22d3ee';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const drawLegend = () => {
      const pad = 10;
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Sequence: y = f(x)', pad, 18);

      let yy = 34;
      orderedCurves().forEach((c, i) => {
        const isActive = c.id === activeCurveIdRef.current;
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.lineWidth = isActive ? 2.6 : 1.6;
        ctx.globalAlpha = isActive ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(pad + 18, yy); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#cbd5e1';
        const label = c.expr?.length > 30 ? c.expr.slice(0, 27) + '…' : (c.expr || '(invalid)');
        const dmin = isFinite(c.min) ? c.min : '−∞';
        const dmax = isFinite(c.max) ? c.max : '∞';
        ctx.fillText(`${i + 1}. ${label} [${dmin}, ${dmax}]${isActive ? ' •' : ''}`, pad + 24, yy + 4);
        yy += 18;
      });

      drawStar(ctx, pad + 6, yy, 5, 6, 3, '#ffd166', '#fff', false);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Star', pad + 24, yy + 4);
      yy += 18;

      ctx.beginPath(); ctx.fillStyle = '#22d3ee'; ctx.strokeStyle = '#fff';
      ctx.arc(pad + 6, yy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cbd5e1'; ctx.fillText('Ball', pad + 24, yy + 4);

      if (idleEndRef.current) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Sequence finished. Waiting for all stars to be collected.', pad, yy + 20);
      } else if (getActiveCurve()) {
        const c = getActiveCurve();
        const t = Math.min(1, Math.max(0, (sRef.current - c.min) / Math.max(1e-6, c.max - c.min)));
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`Progress: ${(t * 100).toFixed(0)}%`, pad, yy + 20);
      }
    };

    const drawStars = (now) => {
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        if (!collected) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 240);
          const rOuter = s.r * (1 + 0.06 * Math.sin(now / 320));
          const prevShadow = { color: ctx.shadowColor, blur: ctx.shadowBlur };
          ctx.shadowColor = '#ffd166';
          ctx.shadowBlur = 8 + 6 * pulse;
          drawStar(ctx, s.x, s.y, 5, rOuter, rOuter * 0.5, '#ffd166', '#ffffff', false);
          ctx.shadowColor = prevShadow.color;
          ctx.shadowBlur = prevShadow.blur;
        } else {
          drawStar(ctx, s.x, s.y, 5, s.r, s.r * 0.5, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.25)', true);
        }
      });

      // pop animation
      for (const [id, phase] of Array.from(starPopPhasesRef.current.entries())) {
        const s = starsRef.current.find(st => st.id === id);
        if (!s) { starPopPhasesRef.current.delete(id); continue; }
        const dur = 420;
        const t = (now - phase) / dur;
        if (t >= 1) { starPopPhasesRef.current.delete(id); continue; }
        const scale = 1 + 0.6 * Math.sin(Math.PI * t);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.scale(scale, scale);
        drawStar(ctx, 0, 0, 5, s.r * 0.6, s.r * 0.3, 'rgba(255,209,102,0.6)', 'rgba(255,255,255,0.8)', false);
        ctx.restore();
      }
    };

    const checkCollisions = (x, y) => {
      const { px, py } = worldToCanvas(w, h, x, y);
      let newly = 0;
      starsRef.current.forEach((s, i) => {
        if (!collectedRef.current[i]) {
          const d = Math.hypot(px - s.x, py - s.y);
          if (d <= s.r + 12) {
            collectedRef.current[i] = true;
            newly++;
            starPopPhasesRef.current.set(s.id, performance.now());
          }
        }
      });
      if (newly > 0) {
        const got = collectedRef.current.filter(Boolean).length;
        const total = collectedRef.current.length;
        onStarStats && onStarStats({ collected: got, total });
        if (got === total && total > 0) {
          // All stars collected; finish after a short delay
          setTimeout(() => {
            onComplete && onComplete(1000); // arbitrary score emit
          }, 300);
        }
      }
    };

    const frame = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const prev = { ...state };
      const next = stepOnCurve(dt);

      const trace = pathRef.current;
      const lastP = trace[trace.length - 1];
      if (!lastP || Math.hypot(next.x - lastP.x, next.y - lastP.y) > 0.2) {
        trace.push({ x: next.x, y: next.y, t: performance.now() });
        if (trace.length > PATH_MAX_POINTS) trace.splice(0, trace.length - PATH_MAX_POINTS);
      }

      setState(next);

      ctx.clearRect(0, 0, w, h);
      drawBackground();
      drawGridAxes();
      drawCurves();
      const now = performance.now();
      drawStars(now);
      drawTrail(now);
      drawBall(next.x, next.y);
      drawLegend();

      if (Math.hypot(next.x - prev.x, next.y - prev.y) > 0.01) {
        checkCollisions(next.x, next.y);
      }

      if (idleEndRef.current) {
        const total = (collectedRef.current || []).length;
        const got = (collectedRef.current || []).filter(Boolean).length;
        onStarStats && onStarStats({ collected: got, total });
      }

      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, dimensions.w, dimensions.h, paused, onStarStats, onComplete]);

  // Smooth resume: nudge forward and clamp within domain
  useEffect(() => {
    lastTsRef.current = 0;
    if (!paused) {
      const c = getActiveCurve && getActiveCurve();
      if (c) {
        const eps = 0.001;
        sRef.current = Math.min(c.max, Math.max(c.min, sRef.current + eps * speedRef.current));
      }
    }
  }, [paused]);

  // PUBLIC_INTERFACE
  function generateStarsForCurves(w, h, curvesIn) {
    /**
     * Place stars near curve points with small normal offsets.
     * Return: [{ id, x, y, r }] in canvas coordinates.
     */
    const result = [];
    const TARGET = 5;
    const usable = (curvesIn || []).filter(c => c.points?.length > 8 && isFinite(c.min) && isFinite(c.max));
    if (!usable.length) return result;

    let id = 0;
    const offset = 16;
    const perCurve = Math.max(1, Math.ceil(TARGET / usable.length));
    usable.forEach((c) => {
      const n = Math.min(perCurve, Math.max(1, Math.floor(c.points.length / 40)));
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const idx = Math.min(c.points.length - 1, Math.max(1, Math.floor(t * c.points.length)));
        const p = c.points[idx];
        const p0 = c.points[Math.max(0, idx - 1)];
        const p1 = c.points[Math.min(c.points.length - 1, idx + 1)];
        const dx = p1.px - p0.px;
        const dy = p1.py - p0.py;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const dir = (k % 2 === 0) ? 1 : -1;
        result.push({ id: id++, x: p.px + dir * offset * nx, y: p.py + dir * offset * ny, r: 12 });
      }
    });
    while (result.length < TARGET && usable[0]) {
      const c = usable[0];
      const idx = Math.floor(Math.random() * c.points.length);
      const p = c.points[idx];
      result.push({ id: id++, x: p.px, y: p.py, r: 12 });
    }
    return result.slice(0, TARGET);
  }

  // Generate stars when curves change
  useEffect(() => {
    if (!curves || !curves.length) return;
    const { w, h } = dimensions;
    const stars = generateStarsForCurves(w, h, curves);
    starsRef.current = stars;
    collectedRef.current = stars.map(() => false);
    onStarStats && onStarStats({ collected: 0, total: stars.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, dimensions.w, dimensions.h]);

  // Initial stats emit once
  useEffect(() => {
    onStarStats && onStarStats({
      collected: (collectedRef.current || []).filter(Boolean).length,
      total: (collectedRef.current || []).length || 0,
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
          aria-label="Game Canvas: multi-curve path, star collection enforced."
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Start to traverse curves in order. Game finishes only after all stars are collected.
      </div>
    </div>
  );
}
