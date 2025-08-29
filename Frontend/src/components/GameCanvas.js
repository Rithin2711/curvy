import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 * GameCanvas renders the interactive playfield. Core guarantees implemented here:
 * 1) The ball's motion is strictly constrained to y = f(x) (user-entered equation).
 * 2) The ball visually follows the drawn curve path (trace + ball projected on curve).
 * 3) Stars are placed and collected via collision detection with the ball.
 * 4) The finish/sequence cannot be considered successful until all stars are collected.
 * 5) When a curve domain finishes, the game switches to the next curve in sequence.
 *
 * Implementation detail:
 * - We use "world" coordinates (x,y) equal to math-space units. Canvas mapping:
 *   px = x + w/2, py = h/2 - y
 * - Movement advances along x (world) while y = f(x) at each frame; no free Matter.js body used
 *   so the motion is always glued to the curve.
 */
export default function GameCanvas({ expressions = [], paused, onStarStats, onComplete, onCurveFinished }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Compile equations safely (mathjs)
  const compiledList = useMemo(() => {
    return (expressions || []).map((e) => {
      try {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: math.compile(e.expr), orderIndex: e.orderIndex ?? 0 };
      } catch {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: null, orderIndex: e.orderIndex ?? 0 };
      }
    });
  }, [expressions]);

  // Curves, each holds sampled points and effective displayed domain (world units)
  const [curves, setCurves] = useState([]);

  // Current world state of ball (world x,y are math space)
  const [state, setState] = useState({ x: 0, y: 0 });

  // Refs for animation and game state
  const activeCurveIdRef = useRef(null);
  const activeOrderIndexRef = useRef(0);
  const sRef = useRef(0); // parameter = x along current curve
  const speedWorldPerSecRef = useRef(140); // x-units per second
  const animationRef = useRef(0);
  const lastTsRef = useRef(0);

  // Stars info (canvas coordinates)
  const starsRef = useRef([]);
  const collectedRef = useRef([]);

  // Star pop animation phases
  const starAnimRef = useRef({ phases: new Map() });

  // Path trace buffer (world coordinates)
  const pathRef = useRef([]);
  const PATH_MAX_POINTS = 1200;
  const PATH_FADE_MS = 7000;

  // Sequence end idle flag
  const isIdleAtEndRef = useRef(false);

  // Responsive width listener
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
    el && ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build curves & reset game state when expressions or dimensions change
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    const xToPx = (x) => x + w / 2;
    const yToPx = (y) => h / 2 - y;

    // Dense sampling across the intersection of [visibleMin, visibleMax] and user [min,max]
    const stepWorld = Math.max(0.5, Math.min(2, w / 600));
    const visibleMin = -w / 2;
    const visibleMax = w / 2;

    const sorted = [...compiledList].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const byId = new Map((expressions || []).map((e, idx) => [e.id, { src: e, order: e.orderIndex ?? idx }]));
    const allCurves = [];

    sorted.forEach((item) => {
      const pts = [];
      const src = byId.get(item.id)?.src;
      let domMin = isFinite(src?.min) ? Number(src.min) : visibleMin;
      let domMax = isFinite(src?.max) ? Number(src.max) : visibleMax;
      if (domMin > domMax) [domMin, domMax] = [domMax, domMin];

      const xMin = Math.max(visibleMin, domMin);
      const xMax = Math.min(visibleMax, domMax);

      if (item.compiled && xMax > xMin) {
        const steps = Math.max(1, Math.ceil((xMax - xMin) / stepWorld));
        for (let i = 0; i <= steps; i++) {
          const x = i === steps ? xMax : (xMin + i * ((xMax - xMin) / steps));
          try {
            const y = item.compiled.evaluate({ x });
            if (isFinite(y)) {
              pts.push({ x, y, px: xToPx(x), py: yToPx(y) });
            }
          } catch {
            // skip invalid sample
          }
        }
      }

      allCurves.push({
        id: item.id,
        color: item.color,
        expr: item.expr,
        points: pts,
        min: xMin,
        max: xMax,
        compiled: item.compiled,
        orderIndex: item.orderIndex ?? 0,
      });
    });

    // Start at the left bound of first valid curve
    const first = allCurves.find((c) => c.compiled && c.points.length > 0 && isFinite(c.min) && isFinite(c.max));
    let startX = 0, startY = 0;
    if (first) {
      const startXw = first.min;
      let y0 = 0;
      try { y0 = first.compiled.evaluate({ x: startXw }); } catch { y0 = first.points[0]?.y ?? 0; }
      startX = startXw;
      startY = isFinite(y0) ? y0 : 0;

      activeCurveIdRef.current = first.id;
      activeOrderIndexRef.current = first.orderIndex ?? 0;
      sRef.current = startXw;
      isIdleAtEndRef.current = false;
    } else {
      activeCurveIdRef.current = null;
      activeOrderIndexRef.current = 0;
      sRef.current = 0;
      isIdleAtEndRef.current = true;
      startX = 0; startY = 0;
    }

    setCurves(allCurves);
    setState({ x: startX, y: startY });

    // Reset trace and stars
    pathRef.current = [{ x: startX, y: startY, t: performance.now() }];
    starsRef.current = [];
    collectedRef.current = [];
    onStarStats && onStarStats({ collected: 0, total: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledList, dimensions.w, dimensions.h, expressions]);

  /** Helpers */
  const worldToCanvas = (w, h, x, y) => ({ px: x + w / 2, py: h / 2 - y });

  function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, fill, stroke, collected) {
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
  }

  function getActiveCurve() {
    return curves.find((c) => c.id === activeCurveIdRef.current && c.compiled);
  }

  function findNextCurveAfter(orderIndex) {
    const byOrder = [...curves].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const currIndex = byOrder.findIndex((c) => (c.orderIndex ?? 0) === (orderIndex ?? 0) && c.id === activeCurveIdRef.current);
    for (let i = currIndex + 1; i < byOrder.length; i++) {
      const c = byOrder[i];
      if (c && c.compiled && c.points.length > 0 && isFinite(c.min) && isFinite(c.max)) return c;
    }
    return null;
  }

  /**
   * Move strictly along the current curve domain.
   * If paused, we hold x and re-evaluate y=f(x) every frame so the ball stays on the curve visually.
   */
  function constrainedStep(dt) {
    if (isIdleAtEndRef.current) return { ...state };

    const active = getActiveCurve();
    if (!active) return { ...state };

    const minX = Number(active.min);
    const maxX = Number(active.max);
    const speed = speedWorldPerSecRef.current;

    if (paused) {
      let yHold = state.y;
      try { yHold = active.compiled.evaluate({ x: sRef.current }); } catch {}
      return { x: sRef.current, y: yHold };
    }

    // Advance x forward; clamp at the boundary to avoid drifting beyond domain
    let s = sRef.current + speed * dt;
    if (s > maxX) s = maxX;
    if (s < minX) s = minX;

    // If we hit the right boundary, transition to next curve
    if (s >= maxX) {
      sRef.current = s;
      let yEdge = state.y;
      try { yEdge = active.compiled.evaluate({ x: s }); } catch {}

      // Keep the last boundary sample in the trace
      const lastPath = pathRef.current[pathRef.current.length - 1];
      if (!lastPath || lastPath.x !== s || lastPath.y !== yEdge) {
        pathRef.current.push({ x: s, y: yEdge, t: performance.now() });
      }

      const next = findNextCurveAfter(active.orderIndex ?? 0);
      if (next) {
        const nx = Number(next.min);
        let ny = 0;
        try { ny = next.compiled.evaluate({ x: nx }); } catch { ny = next.points[0]?.y ?? 0; }

        activeCurveIdRef.current = next.id;
        activeOrderIndexRef.current = next.orderIndex ?? 0;
        sRef.current = nx;
        isIdleAtEndRef.current = false;

        // Inform parent: finished active curve, moved to next order index
        onCurveFinished && onCurveFinished((next.orderIndex ?? 0));

        return { x: nx, y: isFinite(ny) ? ny : 0 };
      } else {
        // No more curves: stop movement. Don't auto-win unless stars are all collected (handled elsewhere).
        isIdleAtEndRef.current = true;
        onCurveFinished && onCurveFinished((active.orderIndex ?? 0) + 1);
        return { x: s, y: yEdge };
      }
    }

    // Normal movement within domain
    let yVal = state.y;
    try {
      yVal = active.compiled.evaluate({ x: s });
    } catch {
      return { ...state };
    }
    if (!isFinite(yVal)) return { ...state };

    sRef.current = s;
    return { x: s, y: yVal };
  }

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = dimensions.w, h = dimensions.h;
    canvas.width = w; canvas.height = h;

    // Ensure sRef lies in current domain after resizes or changes
    const active = getActiveCurve && getActiveCurve();
    if (active) {
      const minX = Number(active.min);
      const maxX = Number(active.max);
      if (sRef.current < minX) sRef.current = minX;
      if (sRef.current > maxX) sRef.current = maxX;
    }

    const drawBackground = () => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0f1220');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    };

    const drawGridAndAxes = () => {
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
        if (c.points.length < 2) return;
        const isActive = c.id === activeCurveIdRef.current;
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.globalAlpha = isActive ? 1 : 0.5;
        ctx.lineWidth = isActive ? 2.2 : 1.4;
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

    const drawPathTrace = (nowMs) => {
      if (!pathRef.current || pathRef.current.length < 2) return;
      const cutoff = nowMs - PATH_FADE_MS;
      while (pathRef.current.length && pathRef.current[0].t < cutoff) pathRef.current.shift();

      ctx.save();
      ctx.lineWidth = 3;
      const base = { r: 124, g: 58, b: 237 };
      for (let i = 1; i < pathRef.current.length; i++) {
        const a = pathRef.current[i - 1];
        const b = pathRef.current[i];
        const age = Math.max(0, Math.min(1, (b.t - cutoff) / PATH_FADE_MS));
        const alpha = 0.15 + 0.55 * age;
        ctx.strokeStyle = `rgba(${base.r}, ${base.g}, ${base.b}, ${alpha.toFixed(3)})`;
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
      ctx.fillText('y = f(x) (sequence)', pad, 18);

      let y = 34;
      const ordered = [...curves].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      ordered.forEach((c, i) => {
        const isActive = c.id === activeCurveIdRef.current;
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.lineWidth = isActive ? 2.5 : 1.5;
        ctx.globalAlpha = isActive ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + 18, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#cbd5e1';
        const labelExpr = c.expr?.length > 30 ? c.expr.slice(0, 27) + '…' : c.expr || '(invalid)';
        const domMin = isFinite(c.min) ? c.min : '−∞';
        const domMax = isFinite(c.max) ? c.max : '∞';
        const activeMark = isActive ? ' •' : '';
        ctx.fillText(`${i + 1}. ${labelExpr} [${domMin}, ${domMax}]${activeMark}`, pad + 24, y + 4);
        y += 18;
      });

      // Ball marker
      ctx.beginPath(); ctx.fillStyle = '#22d3ee'; ctx.strokeStyle = '#fff';
      ctx.arc(pad + 6, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cbd5e1'; ctx.fillText('Player', pad + 24, y + 4);
      y += 18;

      // Star marker
      drawStar(ctx, pad + 6, y, 5, 6, 3, '#ffd166', '#fff', false);
      ctx.fillStyle = '#cbd5e1'; ctx.fillText('Star', pad + 24, y + 4);

      if (isIdleAtEndRef.current) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Sequence finished. Movement stopped.', pad, y + 20);
      } else {
        const active = getActiveCurve && getActiveCurve();
        if (active) {
          const minX = Number(active.min);
          const maxX = Number(active.max);
          const t = Math.min(1, Math.max(0, (sRef.current - minX) / Math.max(1e-6, (maxX - minX))));
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(`Progress: ${(t * 100).toFixed(0)}%`, pad, y + 20);
        }
      }
    };

    const triggerStarPop = (id) => {
      starAnimRef.current.phases.set(id, { t0: performance.now(), dur: 400 });
    };

    const drawStars = (nowTs) => {
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        if (!collected) {
          const pulse = 0.5 + 0.5 * Math.sin(nowTs / 200);
          const rOuter = s.r * (1 + 0.05 * Math.sin(nowTs / 300));
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

      for (const [id, phase] of Array.from(starAnimRef.current.phases.entries())) {
        const s = starsRef.current.find(st => st.id === id);
        if (!s) { starAnimRef.current.phases.delete(id); continue; }
        const t = (nowTs - phase.t0) / phase.dur;
        if (t >= 1) { starAnimRef.current.phases.delete(id); continue; }
        const scale = 1 + 0.6 * Math.sin(Math.PI * t);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.scale(scale, scale);
        drawStar(ctx, 0, 0, 5, s.r * 0.6, s.r * 0.3, 'rgba(255,209,102,0.6)', 'rgba(255,255,255,0.8)', false);
        ctx.restore();
      }
    };

    /**
     * Enforce star collection via collision detection between the moving ball and star sprites.
     * When all stars are collected, we can notify onComplete (success). If not all are collected,
     * finishing the sequence will not trigger success.
     */
    const checkAndCollectStars = (x, y) => {
      const { px, py } = worldToCanvas(w, h, x, y);
      let newly = 0;
      starsRef.current.forEach((s, i) => {
        if (!collectedRef.current[i]) {
          const d = Math.hypot(px - s.x, py - s.y);
          if (d <= s.r + 12) {
            collectedRef.current[i] = true;
            newly++;
            triggerStarPop(s.id);
          }
        }
      });
      if (newly > 0) {
        const c = collectedRef.current.filter(Boolean).length;
        onStarStats && onStarStats({ collected: c, total: collectedRef.current.length });
        if (c === collectedRef.current.length) {
          // All collected: only now allow finish to be considered success.
          setTimeout(() => {
            onComplete && onComplete(Math.max(0, Math.round(1000 - py)));
          }, 300);
        }
      }
    };

    function raf(ts) {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const prev = { ...state };
      const next = constrainedStep(dt);

      // Update trace buffer
      const plist = pathRef.current;
      const last = plist[plist.length - 1];
      if (!last || Math.hypot(next.x - last.x, next.y - last.y) > 0.25) {
        plist.push({ x: next.x, y: next.y, t: performance.now() });
        if (plist.length > PATH_MAX_POINTS) plist.splice(0, plist.length - PATH_MAX_POINTS);
      }

      setState(next);

      // Draw frame
      ctx.clearRect(0, 0, w, h);
      drawBackground();
      drawGridAndAxes();
      drawCurves();
      const now = performance.now();
      drawStars(now);
      drawPathTrace(now);
      drawBall(next.x, next.y);
      drawLegend();

      // Only check collisions on actual movement to avoid repeated triggers when paused
      if (Math.hypot(next.x - prev.x, next.y - prev.y) > 0.01) {
        checkAndCollectStars(next.x, next.y);
      }

      // If sequence ended without all stars, do nothing (no success). Keep showing state via legend.
      if (isIdleAtEndRef.current) {
        const total = (collectedRef.current || []).length;
        const got = (collectedRef.current || []).filter(Boolean).length;
        onStarStats && onStarStats({ collected: got, total });
      }

      animationRef.current = requestAnimationFrame(raf);
    }

    animationRef.current = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(animationRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, dimensions.w, dimensions.h, expressions, onComplete, onStarStats, paused]);

  // When resuming, nudge time and clamp s in the current domain so the ball continues smoothly on-curve.
  useEffect(() => {
    lastTsRef.current = 0;
    if (!paused) {
      const active = getActiveCurve();
      if (active) {
        const tiny = 0.001;
        const speed = speedWorldPerSecRef.current;
        let s = sRef.current + speed * tiny;
        const minX = Number(active.min);
        const maxX = Number(active.max);
        if (s < minX) s = minX;
        if (s > maxX) s = maxX;
        sRef.current = s;
      }
    }
  }, [paused]);

  // PUBLIC_INTERFACE
  function generateStarsForCurves(w, h, curvesIn) {
    /**
     * Place stars along or slightly offset from the visible curves.
     * Ensures distribution across the full displayed domain [-w/2, w/2].
     * Returns array of { id, x, y, r } in CANVAS coordinates.
     */
    const result = [];
    let id = 0;
    const offset = 16;
    const targetCount = 5;
    const usableCurves = (curvesIn || []).filter(c => c.points && c.points.length > 10 && isFinite(c.min) && isFinite(c.max));
    if (usableCurves.length === 0) return result;

    const perCurve = Math.max(1, Math.ceil(targetCount / usableCurves.length));
    usableCurves.forEach((c) => {
      const n = Math.min(perCurve, Math.max(1, Math.floor(c.points.length / 40)));
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const idx = Math.min(c.points.length - 1, Math.max(0, Math.floor(t * c.points.length)));
        const p = c.points[idx];
        const p0 = c.points[Math.max(0, idx - 1)];
        const p1 = c.points[Math.min(c.points.length - 1, idx + 1)];
        const dx = p1.px - p0.px;
        const dy = p1.py - p0.py;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len; // normal x
        const ny = dx / len;  // normal y
        const dir = (k % 2 === 0) ? 1 : -1;
        const cx = p.px + dir * offset * nx;
        const cy = p.py + dir * offset * ny;
        result.push({ id: id++, x: cx, y: cy, r: 12 });
      }
    });

    while (result.length < targetCount && usableCurves[0]) {
      const c = usableCurves[0];
      const idx = Math.min(c.points.length - 1, Math.floor(Math.random() * c.points.length));
      const p = c.points[idx];
      result.push({ id: id++, x: p.px, y: p.py, r: 12 });
    }

    return result.slice(0, targetCount);
  }

  // Regenerate stars when curves or canvas size change
  useEffect(() => {
    if (!curves || curves.length === 0) return;
    const w = dimensions.w, h = dimensions.h;
    const stars = generateStarsForCurves(w, h, curves);
    if (stars.length > 0) {
      starsRef.current = stars;
      collectedRef.current = stars.map(() => false);
      onStarStats && onStarStats({ collected: 0, total: stars.length });
    } else {
      starsRef.current = [];
      collectedRef.current = [];
      onStarStats && onStarStats({ collected: 0, total: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, dimensions.w, dimensions.h]);

  // Initial star stats on mount
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
          aria-label="Game Canvas — Ball constrained to equation path; star collection enforced."
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: The ball traverses each curve from its left to right domain bound. Success only triggers after all stars are collected.
      </div>
    </div>
  );
}
