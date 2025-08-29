import React, { useEffect, useMemo, useRef, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 * GameCanvas renders a canvas where:
 * - The user-entered equation(s) are plotted live across the full visible width.
 * - A ball animates from the left edge to the right edge of the visible graph along y=f(x).
 * - The path is traced with a fading polyline synchronized to ball movement.
 * - When a curve reaches its displayed right edge, it advances to the next curve (sequence).
 * - Stars placed anywhere on the visible curve can be collected by the ball.
 *
 * Fix: Ensure movement continues across the entire valid domain for each curve (no premature stop).
 */
export default function GameCanvas({ expressions = [], paused, onStarStats, onComplete, onCurveFinished, startCoord = null, onStartEvaluated }) {
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

  // Curves, each holds sampled points and effective displayed domain (world units)
  const [curves, setCurves] = useState([]);

  // Current world state of ball (world units: x and y are in cm)
  const [state, setState] = useState({ x: 0, y: 0 });
  
  // Scale constant: 1 unit (1 cm) = 37.8 pixels
  const SCALE_PX_PER_CM = 37.8;

  // Animation state refs
  const activeCurveIdRef = useRef(null);
  const activeOrderIndexRef = useRef(0);
  const sRef = useRef(0); // current x position along curve (in cm)
  // Speed is in cm per second
  const speedWorldPerSecRef = useRef(40); // 40 cm/sec for smooth animation
  const curveProgressRef = useRef(0); // Progress through current curve (0 to 1)
  const animationRef = useRef(0);
  const lastTsRef = useRef(0);

  // Stars data (canvas coordinates)
  const starsRef = useRef([]);
  const collectedRef = useRef([]);

  // Small pop animation state
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

  // Build curves from expressions and reset state on change
  useEffect(() => {
    const w = dimensions.w;
    const h = dimensions.h;

    // mapping: world x/y to pixel:
    // px = x + w/2
    // py = h/2 - y
    const xToPx = (x) => x + w / 2;
    const yToPx = (y) => h / 2 - y;

    // Sample spacing in world units; dense for smooth animation across full width.
    const stepWorld = Math.max(0.5, Math.min(2, w / 600)); // dynamic but bounded

    // Full visible world domain centered around 0
    const visibleMin = -w / 2;
    const visibleMax = w / 2;

    const sorted = [...compiledList].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const byId = new Map((expressions || []).map((e, idx) => [e.id, { src: e, order: e.orderIndex ?? idx }]));
    const allCurves = [];

    sorted.forEach((item) => {
      const pts = [];
      const src = byId.get(item.id)?.src;
      // User domain intersected with visible, falling back to full visible when unspecified
      let domMin = isFinite(src?.min) ? Number(src.min) : visibleMin;
      let domMax = isFinite(src?.max) ? Number(src.max) : visibleMax;
      if (domMin > domMax) [domMin, domMax] = [domMax, domMin];

      const xMin = Math.max(visibleMin, domMin);
      const xMax = Math.min(visibleMax, domMax);

      if (item.compiled && xMax > xMin) {
        // Ensure stable inclusive loop by computing steps count
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

    // Initialize start position:
    // If a startCoord.x is provided and lies within the first valid curve's [min,max], use it.
    // Otherwise, fall back to the left bound of the first valid curve.
    const first = allCurves.find((c) => c.compiled && c.points.length > 0 && isFinite(c.min) && isFinite(c.max));
    let startX = 0, startY = 0;
    if (first) {
      let sx = first.min;
      if (startCoord && isFinite(startCoord.x) && startCoord.x >= first.min && startCoord.x <= first.max) {
        sx = Number(startCoord.x);
      }
      let y0 = 0;
      try { y0 = first.compiled.evaluate({ x: sx }); } catch { y0 = first.points[0]?.y ?? 0; }
      startX = sx;
      startY = isFinite(y0) ? y0 : 0;

      activeCurveIdRef.current = first.id;
      activeOrderIndexRef.current = first.orderIndex ?? 0;
      sRef.current = sx;
      curveProgressRef.current = 0; // Start from beginning of curve
      isIdleAtEndRef.current = false;
    } else {
      activeCurveIdRef.current = null;
      activeOrderIndexRef.current = 0;
      sRef.current = 0;
      curveProgressRef.current = 0;
      isIdleAtEndRef.current = true;
      startX = 0; startY = 0;
    }

    setCurves(allCurves);
    setState({ x: startX, y: startY });

    // Inform parent about evaluated start coordinate if available
    if (typeof onStartEvaluated === 'function') {
      try {
        onStartEvaluated({ x: startX, y: startY });
      } catch {}
    }

    // Reset trace buffer only, preserve stars
    pathRef.current = [{ x: startX, y: startY, t: performance.now() }];
    // Reset star collection state but keep positions
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

  // Movement constrained to curve over full displayed domain
  function constrainedStep(dt) {
    if (isIdleAtEndRef.current) return { ...state };

    const active = getActiveCurve();
    if (!active) return { ...state };

    const minX = Number(active.min);
    const maxX = Number(active.max);
    const speed = speedWorldPerSecRef.current;

    // If paused: hold position and ensure y matches curve
    if (paused) {
      let yHold = state.y;
      try { yHold = active.compiled.evaluate({ x: sRef.current }); } catch {}
      return { x: sRef.current, y: yHold };
    }

    // Update progress through current curve
    curveProgressRef.current += (dt * speed) / Math.abs(maxX - minX);
    
    // Clamp progress to [0, 1]
    curveProgressRef.current = Math.min(1, Math.max(0, curveProgressRef.current));

    // Linear interpolation between min and max x
    const s = minX + (maxX - minX) * curveProgressRef.current;
    
    // When we reach the end of current curve
    if (curveProgressRef.current >= 1) {
      // Evaluate exactly at max_x for clean transition
      let yEnd = state.y;
      try { yEnd = active.compiled.evaluate({ x: maxX }); } catch {}

      // Record end point in path
      const lastPath = pathRef.current[pathRef.current.length - 1];
      if (!lastPath || lastPath.x !== maxX || lastPath.y !== yEnd) {
        pathRef.current.push({ x: maxX, y: yEnd, t: performance.now() });
      }

      const next = findNextCurveAfter(active.orderIndex ?? 0);
      if (next) {
        // Start next curve
        const nx = Number(next.min);
        let ny = 0;
        try { ny = next.compiled.evaluate({ x: nx }); } catch { ny = next.points[0]?.y ?? 0; }

        activeCurveIdRef.current = next.id;
        activeOrderIndexRef.current = next.orderIndex ?? 0;
        curveProgressRef.current = 0; // Reset progress for new curve
        sRef.current = nx;
        isIdleAtEndRef.current = false;

        // Notify parent
        onCurveFinished && onCurveFinished((next.orderIndex ?? 0));

        return { x: nx, y: isFinite(ny) ? ny : 0 };
      } else {
        // No more curves: stop at end
        isIdleAtEndRef.current = true;
        onCurveFinished && onCurveFinished((active.orderIndex ?? 0) + 1);
        return { x: maxX, y: yEnd };
      }
    }

    // Normal movement: evaluate y at interpolated x
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

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = dimensions.w, h = dimensions.h;
    canvas.width = w; canvas.height = h;

    // Keep parameter s within active curve's displayed domain
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
      
      // Draw horizontal grid lines every 5cm
      const yGridCm = 5;
      const yStep = yGridCm * SCALE_PX_PER_CM;
      for (let py = 0; py <= h; py += yStep) {
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
        ctx.stroke();
      }
      
      // Draw vertical grid lines every 5cm
      const xGridCm = 5;
      const xStep = xGridCm * SCALE_PX_PER_CM;
      for (let px = 0; px <= w; px += xStep) {
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }

      // Draw axes
      ctx.strokeStyle = 'rgba(97,218,251,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke();

      // Add axis labels showing cm units
      ctx.font = '10px system-ui';
      ctx.fillStyle = 'rgba(97,218,251,0.6)';
      const centerWorld = canvasToWorld(w, h, w/2, h/2);
      
      // X-axis labels
      for (let x = Math.ceil(centerWorld.x - w/(2*SCALE_PX_PER_CM)); x <= centerWorld.x + w/(2*SCALE_PX_PER_CM); x += xGridCm) {
        if (x === 0) continue; // Skip 0 to avoid cluttering origin
        const {px} = worldToCanvas(w, h, x, 0);
        ctx.fillText(`${x}cm`, px - 14, h/2 + 16);
      }
      
      // Y-axis labels
      for (let y = Math.ceil(centerWorld.y - h/(2*SCALE_PX_PER_CM)); y <= centerWorld.y + h/(2*SCALE_PX_PER_CM); y += yGridCm) {
        if (y === 0) continue; // Skip 0 to avoid cluttering origin
        const {py} = worldToCanvas(w, h, 0, y);
        ctx.fillText(`${y}cm`, w/2 + 8, py + 4);
      }
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
      const ballRadiusPx = 0.4 * SCALE_PX_PER_CM; // 0.4cm radius = ~15.1px
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

    // Constants for physical dimensions
    const STAR_RADIUS_CM = 0.8; // Star radius in cm
    const BALL_RADIUS_CM = 0.4; // Ball radius in cm (reduced from 0.6)

    const checkAndCollectStars = (x, y) => {
      const { px, py } = worldToCanvas(w, h, x, y);
      let newly = 0;
      starsRef.current.forEach((s, i) => {
        if (!collectedRef.current[i]) {
          const d = Math.hypot(px - s.x, py - s.y);
          const collisionRadiusPx = (STAR_RADIUS_CM + BALL_RADIUS_CM) * SCALE_PX_PER_CM; // Star radius + ball radius in pixels
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
      const next = constrainedStep(dt);

      // Trace update
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

      // Only check when moved a little to avoid duplicate triggers on pause
      if (Math.hypot(next.x - prev.x, next.y - prev.y) > 0.01) {
        checkAndCollectStars(next.x, next.y);
      }

      // Update stats when idle at end
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

  // Reset animation time and progress when resuming or changing curve
  useEffect(() => {
    lastTsRef.current = 0;
    if (!paused) {
      const active = getActiveCurve();
      if (active) {
        const minX = Number(active.min);
        const maxX = Number(active.max);
        const currentX = sRef.current;
        
        // Calculate progress based on current position
        curveProgressRef.current = Math.max(0, Math.min(1, 
          (currentX - minX) / Math.max(1e-6, maxX - minX)
        ));
      }
    }
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
    
    // Real-world dimensions (1 unit = 1 cm)
    const starRadiusCm = 0.8; // Star radius in cm
    const starRadiusPx = starRadiusCm * SCALE_PX_PER_CM;
    const ballRadiusCm = 0.4; // Ball radius in cm
    
    // Minimum separation between stars (in pixels)
    // Use 4x star radius to ensure good spacing
    const minDistancePx = 4 * starRadiusPx;
    
    // Safety margin from edges (3x star radius)
    const safetyMarginPx = 3 * starRadiusPx;
    
    // Define placement bounds in pixels (inset from edges)
    const bounds = {
      minX: safetyMarginPx,
      maxX: w - safetyMarginPx,
      minY: safetyMarginPx,
      maxY: h - safetyMarginPx
    };

    const isValidPosition = (x, y) => {
      // Check bounds
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
        return false;
      }
      
      // Check separation from other stars
      for (const star of result) {
        const dx = x - star.x;
        const dy = y - star.y;
        const distance = Math.hypot(dx, dy);
        if (distance < minDistancePx) {
          return false;
        }
      }
      
      // Keep stars away from the horizontal center where ball typically starts
      const centerX = w / 2;
      const centerMargin = (starRadiusCm + ballRadiusCm) * 2 * SCALE_PX_PER_CM;
      if (Math.abs(x - centerX) < centerMargin) {
        return false;
      }
      
      return true;
    };

    const generateStarPosition = () => {
      // Grid-based attempt first for better distribution
      const gridSize = Math.floor(minDistancePx);
      const cols = Math.floor((bounds.maxX - bounds.minX) / gridSize);
      const rows = Math.floor((bounds.maxY - bounds.minY) / gridSize);
      
      // Try grid cells in random order
      const cells = [];
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          cells.push({
            x: bounds.minX + (i + 0.5) * gridSize,
            y: bounds.minY + (j + 0.5) * gridSize
          });
        }
      }
      
      // Shuffle cells
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      
      // Try cells with small random offset
      for (const cell of cells) {
        const offsetX = (Math.random() - 0.5) * gridSize * 0.8;
        const offsetY = (Math.random() - 0.5) * gridSize * 0.8;
        const x = cell.x + offsetX;
        const y = cell.y + offsetY;
        if (isValidPosition(x, y)) {
          return { x, y };
        }
      }
      
      // Fallback to pure random if grid fails
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

    // Always generate exactly 5 stars
    while (result.length < REQUIRED_STARS) {
      const pos = generateStarPosition();
      if (pos) {
        result.push({
          id: id++,
          x: pos.x,
          y: pos.y,
          r: starRadiusPx * 0.4 // Visual radius for drawing (smaller than collision radius)
        });
      } else {
        // If we can't place a star, clear and try again with different random positions
        result.length = 0;
        id = 0;
      }
    }

    return result;
  }

  // Generate stars when canvas size changes or on mount, independent of curves
  useEffect(() => {
    const w = dimensions.w, h = dimensions.h;
    const stars = generateStarsForCurves(w, h);
    starsRef.current = stars;
    collectedRef.current = stars.map(() => false);
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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Graph + Game</div>
      <div ref={containerRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          role="application"
          aria-label="Unified Graph and Game Canvas with Path Trace and Stars"
        />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: The ball now traverses the full visible curve from left edge to right edge for each equation.
      </div>
    </div>
  );
}
