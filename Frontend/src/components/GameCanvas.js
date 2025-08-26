import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GameCanvas({ expressions = [], paused, onStarStats, onComplete, onCurveFinished }) {
  /**
   * Unified graph + gameplay canvas with sequencing:
   * - Plots y = f(x) for each expression in the provided order.
   * - Ball strictly follows current active curve; when the end of domain is reached,
   *   it automatically advances to the next curve in the sequence.
   * - Stops once the last curve finishes.
   * - Stars: yellow five-point star shapes; greyed with outline when collected.
   * - Path Trace: draws a persistent fading line following the ball's recent trajectory.
   */
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

  // Compile all expressions
  const compiledList = useMemo(() => {
    return (expressions || []).map((e) => {
      try {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: math.compile(e.expr), orderIndex: e.orderIndex ?? 0 };
      } catch {
        return { id: e.id, color: e.color || '#61dafb', expr: e.expr, compiled: null, orderIndex: e.orderIndex ?? 0 };
      }
    });
  }, [expressions]);

  // Curves
  const [curves, setCurves] = useState([]);

  // State
  const [state, setState] = useState({ x: 0, y: 0 });

  // Active and motion refs
  const activeCurveIdRef = useRef(null);
  const activeOrderIndexRef = useRef(0);
  const sRef = useRef(0);
  const dirRef = useRef(1); // +1 forward
  const speedPxPerSecRef = useRef(120);
  const animationRef = useRef(0);
  const lastTsRef = useRef(0);

  // Stars and collection
  const starsRef = useRef([]);
  const collectedRef = useRef([]);

  // Path trace
  const pathRef = useRef([]);
  const PATH_MAX_POINTS = 600;
  const PATH_FADE_MS = 6000;

  // Stop when final curve ends
  const isIdleAtEndRef = useRef(false);

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

  // Build curve samples and reset ball starting position
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    const step = 2; // px per sample in world x

    const xToPx = (x) => x + w / 2;
    const yToPx = (y) => h / 2 - y;

    // Sort by orderIndex to guarantee sequence
    const sorted = [...compiledList].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    const allCurves = [];
    const byId = new Map((expressions || []).map((e, idx) => [e.id, { src: e, order: e.orderIndex ?? idx }]));

    sorted.forEach((item) => {
      const pts = [];
      const src = byId.get(item.id)?.src;
      let xMin = isFinite(src?.min) ? Number(src.min) : -w / 2;
      let xMax = isFinite(src?.max) ? Number(src.max) : w / 2;
      if (xMin > xMax) {
        const t = xMin; xMin = xMax; xMax = t;
      }
      if (item.compiled) {
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
        min: xMin,
        max: xMax,
        compiled: item.compiled,
        orderIndex: item.orderIndex ?? 0,
      });
    });

    // First valid curve by order
    const firstValid = allCurves.find((c) => c.points && c.points.length > 0 && c.compiled);

    let startX = 0;
    let startY = 0;
    if (firstValid) {
      const start = firstValid.points[0];
      startX = start.x;
      startY = start.y;
      activeCurveIdRef.current = firstValid.id;
      activeOrderIndexRef.current = firstValid.orderIndex ?? 0;
      sRef.current = startX;
      dirRef.current = 1;
      isIdleAtEndRef.current = false;
    } else {
      activeCurveIdRef.current = null;
      activeOrderIndexRef.current = 0;
      sRef.current = 0;
      isIdleAtEndRef.current = true;
      startX = 0;
      startY = 0;
    }

    setCurves(allCurves);
    setState({ x: startX, y: startY });

    // Reset path on new curves or resize
    pathRef.current = [{ x: startX, y: startY, t: performance.now() }];

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
    onStarStats && onStarStats({ collected: 0, total: positions.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiledList, dimensions.h, dimensions.w, expressions]);

  // Helpers
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

  function worldToCanvasFactory(w, h) {
    return (x, y) => ({ px: x + w / 2, py: h / 2 - y });
  }

  function getActiveCurve() {
    return curves.find((c) => c.id === activeCurveIdRef.current && c.compiled);
  }

  function findNextCurveAfter(orderIndex) {
    const byOrder = [...curves].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const currIdx = byOrder.findIndex((c) => (c.orderIndex ?? 0) === (orderIndex ?? 0) && c.id === activeCurveIdRef.current);
    for (let i = currIdx + 1; i < byOrder.length; i++) {
      const c = byOrder[i];
      if (c && c.compiled && c.points && c.points.length > 0) return c;
    }
    return null;
  }

  // Constrained motion step with sequencing
  function constrainedStep(dt) {
    if (paused) return { ...state };
    if (isIdleAtEndRef.current) return { ...state };

    const active = getActiveCurve();
    if (!active) return { ...state };

    const minX = Number(active.min);
    const maxX = Number(active.max);
    const speed = speedPxPerSecRef.current;
    let s = sRef.current + dirRef.current * speed * dt;

    // At or beyond end -> advance to next curve or stop
    if (s > maxX) {
      s = maxX;
      sRef.current = s;
      let yEdge = 0;
      try { yEdge = active.compiled.evaluate({ x: s }); } catch { yEdge = state.y; }
      pathRef.current.push({ x: s, y: yEdge, t: performance.now() });

      // Try to advance
      const next = findNextCurveAfter(active.orderIndex ?? 0);
      if (next) {
        // switch active curve and snap to its start
        const start = next.points[0];
        activeCurveIdRef.current = next.id;
        activeOrderIndexRef.current = next.orderIndex ?? 0;
        sRef.current = start.x;
        dirRef.current = 1;
        isIdleAtEndRef.current = false;

        // continue from new curve start
        onCurveFinished && onCurveFinished(activeOrderIndexRef.current);
        return { x: start.x, y: start.y };
      } else {
        // last curve finished -> idle
        isIdleAtEndRef.current = true;
        onCurveFinished && onCurveFinished((active.orderIndex ?? 0) + 1);
        return { x: s, y: yEdge };
      }
    }

    if (s < minX) {
      s = minX;
    }

    // Evaluate y = f(s)
    let yVal = 0;
    try {
      yVal = active.compiled.evaluate({ x: s });
    } catch {
      return { ...state };
    }
    if (!isFinite(yVal)) {
      return { ...state };
    }

    sRef.current = s;
    return { x: s, y: yVal };
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

    const drawAxesAndGrid = () => {
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
    };

    const drawCurves = () => {
      curves.forEach((curve) => {
        if (!curve.points || curve.points.length < 2) return;
        // deemphasize inactive curves
        const isActive = curve.id === activeCurveIdRef.current;
        ctx.strokeStyle = curve.color || '#61dafb';
        ctx.globalAlpha = isActive ? 1 : 0.5;
        ctx.lineWidth = isActive ? 2.5 : 1.5;
        ctx.beginPath();
        curve.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.px, p.py);
          else ctx.lineTo(p.px, p.py);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };

    const drawStars = () => {
      starsRef.current.forEach((s, i) => {
        const collected = collectedRef.current[i];
        drawStar(ctx, s.x, s.y, 5, s.r, s.r * 0.5, '#ffd166', '#ffffff', collected);
      });
    };

    const drawBall = (x, y) => {
      const { px, py } = worldToCanvasFactory(w, h)(x, y);
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
        const label = `${i + 1}. ${labelExpr}  [${domMin}, ${domMax}]${activeMark}`;
        ctx.fillText(label, pad + 24, y + 4);
        y += 18;
      });

      // Ball mark
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

      if (isIdleAtEndRef.current) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Sequence finished. Movement stopped.', pad, y + 20);
      }
    };

    const drawPathTrace = (nowMs) => {
      if (!pathRef.current || pathRef.current.length < 2) return;

      // Purge old points
      const cutoff = nowMs - PATH_FADE_MS;
      while (pathRef.current.length && pathRef.current[0].t < cutoff) {
        pathRef.current.shift();
      }

      // Draw a fading polyline
      ctx.save();
      ctx.lineWidth = 3;
      const baseColor = { r: 124, g: 58, b: 237 };
      for (let i = 1; i < pathRef.current.length; i++) {
        const a = pathRef.current[i - 1];
        const b = pathRef.current[i];
        const age = Math.max(0, Math.min(1, (b.t - cutoff) / PATH_FADE_MS));
        const alpha = 0.15 + 0.55 * age;
        ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha.toFixed(3)})`;
        const { px: ax, py: ay } = worldToCanvasFactory(w, h)(a.x, a.y);
        const { px: bx, py: by } = worldToCanvasFactory(w, h)(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.restore();
    };

    const checkStars = (x, y) => {
      const { px, py } = worldToCanvasFactory(w, h)(x, y);
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
        onStarStats && onStarStats({ collected: c, total: collectedRef.current.length });
        if (c === collectedRef.current.length) {
          onComplete && onComplete(Math.max(0, Math.round(1000 - py)));
        }
      }
    };

    function raf(ts) {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      // Constrained step with sequencing
      const next = constrainedStep(dt);

      // Append to path (world coords) if moved a bit
      const plist = pathRef.current;
      const last = plist[plist.length - 1];
      if (!last || Math.hypot(next.x - last.x, next.y - last.y) > 0.5) {
        plist.push({ x: next.x, y: next.y, t: performance.now() });
        if (plist.length > PATH_MAX_POINTS) {
          plist.splice(0, plist.length - PATH_MAX_POINTS);
        }
      }

      setState(next);

      // Draw
      ctx.clearRect(0, 0, w, h);
      drawAxesAndGrid();
      drawCurves();
      drawStars();
      drawPathTrace(performance.now());
      drawBall(next.x, next.y);
      drawLegend();

      // Stars after draw to use up-to-date position
      checkStars(next.x, next.y);

      animationRef.current = requestAnimationFrame(raf);
    }

    animationRef.current = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, dimensions.h, dimensions.w, expressions, onComplete, onStarStats, paused]);

  // Reset animation timestamp when paused toggles
  useEffect(() => {
    lastTsRef.current = 0;
  }, [paused]);

  // Notify stars on mount
  useEffect(() => {
    onStarStats && onStarStats({
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
          aria-label="Unified Graph and Game Canvas with Path Trace"
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: The ball follows each equation in the given order and continues automatically when a path ends.
      </div>
    </div>
  );
}
