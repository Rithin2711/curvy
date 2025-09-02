import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 * GameCanvas renders the gameplay canvas. In "minimalMode" it shows only:
 * - Player ball
 * - Stars
 * When an equation is provided, it samples the curve and moves the ball along it.
 * Non-essential visuals (grid, axes, curve strokes, legends, traces) are hidden by default.
 *
 * Props:
 * - expressions: array of {id, expr, min, max, color, orderIndex}
 * - paused: boolean, pauses ball movement
 * - onStarStats: function({collected,total})
 * - onComplete: function(score)
 * - onCurveFinished: function(nextIndex)
 * - startCoord: initial {x} or {x,y} in world units (optional)
 * - onStartEvaluated: callback with evaluated start point when set
 * - minimalMode: boolean to hide extra visuals (default true)
 */
export default function GameCanvas({
  expressions = [],
  paused,
  onStarStats,
  onComplete,
  onCurveFinished,
  startCoord = null,
  onStartEvaluated,
  minimalMode = true,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Compile equations safely
  const compiledList = useMemo(() => {
    return (expressions || []).map((e) => {
      try {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: math.compile(e.expr), orderIndex: e.orderIndex ?? 0 };
      } catch {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: null, orderIndex: e.orderIndex ?? 0 };
      }
    });
  }, [expressions]);

  // Curves: sampled points and cumulative arc-length info
  const [curves, setCurves] = useState([]);

  // Current world state of ball (world units: x and y are in cm)
  const [state, setState] = useState({ x: 0, y: 0 });

  // Scale constant: 1 unit (1 cm) = 20 pixels (further reduced to make visuals more compact)
  const SCALE_PX_PER_CM = 20;

  // Animation state refs
  const activeCurveIdRef = useRef(null);
  const activeOrderIndexRef = useRef(0);

  // Pointer along the active curve's sampled polyline: segment index and distance along that segment
  const segIndexRef = useRef(0);   // integer index of current segment start point
  const segDistRef = useRef(0);    // distance progressed along current segment (in cm)
  const speedWorldPerSecRef = useRef(40); // 40 cm/sec for smooth animation (arc-length speed)
  const curveProgressRef = useRef(0);     // 0..1 progress along active curve
  const animationRef = useRef(0);
  const lastTsRef = useRef(0);

  // Travel direction along the polyline segments:
  // +1 means forward (increasing point index), -1 means backward (decreasing point index)
  const directionRef = useRef(1);

  // Mode for end handling now fixed to 'stop' (no wrap, no reverse)
  const traversalModeRef = useRef('stop');

  // Stars data (canvas coordinates)
  // Stars should be generated once and remain fixed throughout gameplay.
  const starsRef = useRef([]);
  const collectedRef = useRef([]);

  // Small pop animation state (kept for rendering visuals only; no movement)
  const starAnimRef = useRef({ phases: new Map() });

  // Path trace buffer (world coordinates with timestamps)
  const pathRef = useRef([]);
  const PATH_MAX_POINTS = 1200;
  const PATH_FADE_MS = 7000;

  // Whether finished all curves
  const isIdleAtEndRef = useRef(false);

  // Responsive width
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

  // Build curves from expressions and reset state on change (ball path only)
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    // mapping: world x/y to pixel for plotting of curves (legacy, kept for sampling)
    const xToPx = (x) => x + w / 2;
    const yToPx = (y) => h / 2 - y;

    // Sample spacing in world units; dense for smooth animation across full width.
    const stepWorld = Math.max(0.5, Math.min(2, w / 600)); // dynamic but bounded

    // Full visible world domain centered around 0
    const visibleMin = -(w / 2) / 1;
    const visibleMax = (w / 2) / 1;

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
            // ignore invalid point
          }
        }
      }

      // Build cumulative arc lengths along the sampled polyline (world units)
      const cum = [0];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const ds = Math.hypot(dx, dy);
        cum.push(cum[i - 1] + ds);
      }
      const totalLen = cum.length > 0 ? cum[cum.length - 1] : 0;

      allCurves.push({
        id: item.id,
        color: item.color,
        expr: item.expr,
        points: pts,         // in world units
        cumLen: cum,         // cumulative arc-lengths matching points
        totalLen,            // total arc length
        min: xMin,
        max: xMax,
        compiled: item.compiled,
        orderIndex: item.orderIndex ?? 0,
      });
    });

    // Choose first valid curve (if any)
    const first = allCurves.find((c) => c.compiled && c.points.length > 1 && isFinite(c.min) && isFinite(c.max));
    let startX = 0, startY = 0;

    if (first) {
      // Start at first sampled point (left-most)
      startX = first.points[0].x;
      startY = first.points[0].y;

      activeCurveIdRef.current = first.id;
      activeOrderIndexRef.current = first.orderIndex ?? 0;

      segIndexRef.current = 0;
      segDistRef.current = 0;
      curveProgressRef.current = first.totalLen > 0 ? (first.cumLen[segIndexRef.current] / first.totalLen) : 0;
      isIdleAtEndRef.current = false;
      directionRef.current = 1;
    } else {
      // No equation => idle, keep ball centered at origin baseline
      activeCurveIdRef.current = null;
      activeOrderIndexRef.current = 0;
      segIndexRef.current = 0;
      segDistRef.current = 0;
      curveProgressRef.current = 0;
      isIdleAtEndRef.current = true;
      startX = 0;
      startY = 0;
    }

    setCurves(allCurves);
    // Force stationary initial position to the first valid point for determinism
    const stationary = first && first.points.length > 0 ? { x: first.points[0].x, y: first.points[0].y } : { x: startX, y: startY };
    setState(stationary);

    if (typeof onStartEvaluated === 'function') {
      try {
        onStartEvaluated({ x: startX, y: startY });
      } catch {}
    }

    // Reset trace buffer
    pathRef.current = [{ x: startX, y: startY, t: performance.now() }];

    // IMPORTANT: Do NOT reposition or regenerate stars here.
    // Stars remain at their initially assigned canvas coordinates.
    // Only reset collection flags if needed but preserve positions.
    if (starsRef.current.length > 0) {
      collectedRef.current = starsRef.current.map(() => false);
      onStarStats && onStarStats({ collected: 0, total: starsRef.current.length });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledList, dimensions.w, dimensions.h, expressions, startCoord]);

  // Helpers
  const worldToCanvas = (w, h, x, y) => ({
    px: x * SCALE_PX_PER_CM + w / 2,
    py: h / 2 - y * SCALE_PX_PER_CM
  });

  const canvasToWorld = (w, h, px, py) => ({
    x: (px - w / 2) / SCALE_PX_PER_CM,
    y: (h / 2 - py) / SCALE_PX_PER_CM
  });

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

  // Interpolate along sampled points with uniform arc-length speed
  function getPositionOnSegment(active, i, distOnSeg) {
    const safeI = Math.max(0, Math.min(i, active.points.length - 2));
    const p0 = active.points[safeI];
    const p1 = active.points[safeI + 1];
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1e-6;
    const t = Math.max(0, Math.min(1, distOnSeg / segLen));
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      segLen,
      safeI
    };
  }

  // Interpolate along sampled points with uniform arc-length speed and end-stop handling
  function advanceAlongPolyline(dt) {
    /**
     * Stationary mode:
     * The ball remains fixed at its initial evaluated position.
     * Stars are static; no movement is applied.
     */
    const active = getActiveCurve();
    if (active && active.points.length > 0) {
      const p0 = active.points[0];
      return { x: p0.x, y: p0.y };
    }
    return { ...state };
  }

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = dimensions.w, h = dimensions.h;
    canvas.width = w; canvas.height = h;

    const drawBackground = () => {
      if (minimalMode) {
        // Flat dark background
        ctx.fillStyle = '#0f1220';
        ctx.fillRect(0, 0, w, h);
        return;
      }
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#0f1220');
      grad.addColorStop(1, '#111827');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    };

    const drawGridAndAxes = () => {
      if (minimalMode) return; // hidden in minimal mode
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;

      // Draw horizontal/vertical grid lines
      const yGridCm = 5;
      const yStep = yGridCm * SCALE_PX_PER_CM;
      for (let py = 0; py <= h; py += yStep) {
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }

      const xGridCm = 5;
      const xStep = xGridCm * SCALE_PX_PER_CM;
      for (let px = 0; px <= w; px += xStep) {
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }

      // Axes
      ctx.strokeStyle = 'rgba(97,218,251,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();
    };

    const drawCurves = () => {
      if (minimalMode) return; // hidden in minimal mode
      curves.forEach((c) => {
        if (c.points.length < 2) return;
        const isActive = c.id === activeCurveIdRef.current;
        ctx.strokeStyle = c.color || '#61dafb';
        ctx.globalAlpha = isActive ? 1 : 0.5;
        ctx.lineWidth = isActive ? 2.2 : 1.4;
        ctx.beginPath();
        for (let i = 0; i < c.points.length; i++) {
          const p = c.points[i];
          const { px, py } = worldToCanvas(w, h, p.x, p.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };

    const drawPathTrace = (nowMs) => {
      if (minimalMode) return; // hidden in minimal mode
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
      const ballRadiusPx = 0.25 * SCALE_PX_PER_CM; // 0.25cm radius
      ctx.save();
      ctx.shadowColor = '#7ee0ff';
      ctx.shadowBlur = ballRadiusPx;
      ctx.beginPath();
      ctx.arc(px, py, ballRadiusPx, 0, Math.PI * 2);
      ctx.fillStyle = '#22d3ee';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // center dot
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();
    };

    const drawLegend = () => {
      if (minimalMode) return; // hidden in minimal mode
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
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(pad + 18, y);
        ctx.stroke();
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
          const t = Math.max(0, Math.min(1, curveProgressRef.current));
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(`Progress: ${(t * 100).toFixed(0)}%`, pad, y + 20);
        }
      }
    };

    const triggerStarPop = (id) => {
      starAnimRef.current.phases.set(id, { t0: performance.now(), dur: 400 });
    };

    const STAR_RADIUS_CM = 0.8;
    const BALL_RADIUS_CM = 0.25;

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
        const ctx2 = ctx;
        ctx2.save();
        ctx2.translate(s.x, s.y);
        ctx2.scale(scale, scale);
        drawStar(ctx2, 0, 0, 5, s.r * 0.6, s.r * 0.3, 'rgba(255,209,102,0.6)', 'rgba(255,255,255,0.8)', false);
        ctx2.restore();
      }
    };

    const checkAndCollectStars = (x, y) => {
      // Use ball center position (world) projected to canvas pixels
      const { px, py } = worldToCanvas(w, h, x, y);
      let newly = 0;
      const collisionRadiusPx = (STAR_RADIUS_CM + BALL_RADIUS_CM) * SCALE_PX_PER_CM * 1.2;

      starsRef.current.forEach((s, i) => {
        if (!collectedRef.current[i]) {
          const d = Math.hypot(px - s.x, py - s.y);
          if (d <= collisionRadiusPx) {
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
      const next = advanceAlongPolyline(dt);

      // Trace update uses the exact world position along sampled points
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

      // Stars remain static. Collision/collection is disabled in stationary mode.
      // If movement is reintroduced in future, re-enable collision checks below:
      // if (Math.hypot(next.x - prev.x, next.y - prev.y) > 0.01) {
      //   checkAndCollectStars(next.x, next.y);
      // }

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

  // Reset animation timing and compute progress when resuming
  useEffect(() => {
    // In stationary mode, pause/resume has no effect on position or progress.
    lastTsRef.current = 0;
    curveProgressRef.current = 0;
  }, [paused]);

  // PUBLIC_INTERFACE
  function generateStarsForCurves(w, h) {
    /**
     * Generate exactly 5 stars with random placement across the game area while avoiding overlap
     * Stars are placed within visible bounds and maintain minimum separation based on real-world scale
     * Returns array of { id, x, y, r } in CANVAS coordinates
     */
    const REQUIRED_STARS = 5;
    const result = [];
    let id = 0;

    const starRadiusCm = 0.8; // Star radius in cm
    const starRadiusPx = starRadiusCm * SCALE_PX_PER_CM;
    const ballRadiusCm = 0.25; // Ball radius in cm

    const minDistancePx = 4 * starRadiusPx;
    const safetyMarginPx = 3 * starRadiusPx;

    const bounds = {
      minX: safetyMarginPx,
      maxX: w - safetyMarginPx,
      minY: safetyMarginPx,
      maxY: h - safetyMarginPx
    };

    const isValidPosition = (x, y) => {
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
        return false;
      }
      for (const star of result) {
        const dx = x - star.x;
        const dy = y - star.y;
        const distance = Math.hypot(dx, dy);
        if (distance < minDistancePx) {
          return false;
        }
      }
      const centerX = w / 2;
      const centerMargin = (starRadiusCm + ballRadiusCm) * 2 * SCALE_PX_PER_CM;
      if (Math.abs(x - centerX) < centerMargin) {
        return false;
      }
      return true;
    };

    const generateStarPosition = () => {
      const gridSize = Math.floor(minDistancePx);
      const cols = Math.floor((bounds.maxX - bounds.minX) / gridSize);
      const rows = Math.floor((bounds.maxY - bounds.minY) / gridSize);

      const cells = [];
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          cells.push({
            x: bounds.minX + (i + 0.5) * gridSize,
            y: bounds.minY + (j + 0.5) * gridSize
          });
        }
      }
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      for (const cell of cells) {
        const offsetX = (Math.random() - 0.5) * gridSize * 0.8;
        const offsetY = (Math.random() - 0.5) * gridSize * 0.8;
        const x = cell.x + offsetX;
        const y = cell.y + offsetY;
        if (isValidPosition(x, y)) {
          return { x, y };
        }
      }
      const maxTries = 50;
      for (let i = 0; i < maxTries; i++) {
        const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
        if (isValidPosition(x, y)) {
          return { x, y };
        }
      }
      return null;
    };

    while (result.length < REQUIRED_STARS) {
      const pos = generateStarPosition();
      if (pos) {
        result.push({
          id: id++,
          x: pos.x,
          y: pos.y,
          r: starRadiusPx * 0.4
        });
      } else {
        result.length = 0;
        id = 0;
      }
    }

    return result;
  }

  // Generate stars ONCE on initial mount or when canvas size first becomes available.
  // They remain fixed at their initial positions; no updates on curve/resize changes.
  useEffect(() => {
    // If stars already exist, do nothing to keep them stationary.
    if (starsRef.current && starsRef.current.length > 0) {
      return;
    }

    const w = dimensions.w, h = dimensions.h;

    // Use the existing generator to create fixed star positions.
    const stars = generateStarsForCurves(w, h);

    // Assign and initialize collection flags.
    starsRef.current = stars;
    collectedRef.current = stars.map(() => false);

    // Inform HUD.
    onStarStats && onStarStats({ collected: 0, total: stars.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.w, dimensions.h]);

  // Initial star stats on mount
  useEffect(() => {
    onStarStats && onStarStats({
      collected: (collectedRef.current || []).filter(Boolean).length,
      total: (collectedRef.current || []).length || 0,
    });
  }, [onStarStats]);

  return (
    <div className="game-panel">
      {!minimalMode && (
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Graph + Game</div>
      )}
      <div ref={containerRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          role="application"
          aria-label="Game Canvas"
        />
      </div>
      {!minimalMode && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
          Tip: The ball starts at the curve’s minimum x, moves forward to the maximum x with uniform arc-length speed, and then stops at the end.
        </div>
      )}
    </div>
  );
}
