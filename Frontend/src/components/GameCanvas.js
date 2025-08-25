import React, { useEffect, useMemo, useRef, useState } from 'react';
import Matter from 'matter-js';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 */
export default function GameCanvas({ expression, paused, onStarStats, onComplete }) {
  /**
   * Game world:
   * - Width responsive to container; Height 420px default
   * - A ball starts near top center
   * - Stars are static circles; collecting occurs when ball overlaps
   * - Guidance by curve: compute target y=f(x) and apply a small lateral force that tries to move the ball toward curve
   * - Gravity is enabled
   * - Pause/Resume controlled by parent
   */
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const renderRef = useRef(null);
  const runnerRef = useRef(null);
  const ballRef = useRef(null);
  const starBodiesRef = useRef([]);
  const starStatesRef = useRef([]);
  const compiled = useMemo(() => {
    try {
      return math.compile(expression);
    } catch {
      return null;
    }
  }, [expression]);

  const [dimensions, setDimensions] = useState({ w: 800, h: 420 });

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
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initialize Matter world
  useEffect(() => {
    const { Engine, Render, Runner, World, Bodies, Events, Body } = Matter;
    const engine = Engine.create();
    engine.gravity.y = 1; // gravity
    engineRef.current = engine;

    const w = dimensions.w;
    const h = dimensions.h;

    const render = Render.create({
      element: containerRef.current,
      engine,
      options: {
        width: w,
        height: h,
        wireframes: false,
        background: 'transparent',
      },
    });
    renderRef.current = render;

    const runner = Runner.create();
    runnerRef.current = runner;

    // Walls
    const thickness = 40;
    const walls = [
      Bodies.rectangle(w / 2, -thickness / 2, w, thickness, { isStatic: true }), // ceiling
      Bodies.rectangle(w / 2, h + thickness / 2, w, thickness, { isStatic: true }), // floor
      Bodies.rectangle(-thickness / 2, h / 2, thickness, h, { isStatic: true }), // left
      Bodies.rectangle(w + thickness / 2, h / 2, thickness, h, { isStatic: true }), // right
    ];

    // Ball
    const ball = Bodies.circle(w / 2, 40, 12, {
      restitution: 0.05,
      friction: 0.02,
      frictionAir: 0.005,
      render: {
        fillStyle: '#ffcc00',
        strokeStyle: '#ffffff',
        lineWidth: 2,
      },
    });
    ballRef.current = ball;

    // Stars: generate fixed number with some margins
    const starCount = 5;
    const margin = 40;
    const stars = [];
    const starStates = [];
    for (let i = 0; i < starCount; i++) {
      const sx = margin + Math.random() * (w - 2 * margin);
      const sy = margin + 100 + Math.random() * (h - 2 * margin - 100);
      const star = Bodies.circle(sx, sy, 8, {
        isStatic: true,
        isSensor: true, // so ball can overlap
        render: {
          fillStyle: '#61dafb',
          strokeStyle: '#ffffff',
          lineWidth: 1.5,
        },
        label: `star-${i}`,
      });
      stars.push(star);
      starStates.push({ id: i, collected: false });
    }
    starBodiesRef.current = stars;
    starStatesRef.current = starStates;

    World.add(engine.world, [...walls, ball, ...stars]);

    // Collision handling for star collection
    Events.on(engine, 'collisionStart', (event) => {
      for (let pair of event.pairs) {
        const bodies = [pair.bodyA, pair.bodyB];
        bodies.forEach((b) => {
          if (b.label && b.label.startsWith('star-')) {
            const idx = parseInt(b.label.split('-')[1], 10);
            if (!starStatesRef.current[idx].collected) {
              starStatesRef.current[idx].collected = true;
              // visually hide star
              b.render.fillStyle = 'rgba(255,255,255,0.2)';
              b.isSensor = true;
              b.collisionFilter = { group: -1, category: 0, mask: 0 };
              // update stats
              const collected = starStatesRef.current.filter((s) => s.collected).length;
              onStarStats({ collected, total: starStatesRef.current.length });
              if (collected === starStatesRef.current.length) {
                // Completed!
                onComplete && onComplete(1000 - Math.max(0, ball.position.y)); // naive score
              }
            }
          }
        });
      }
    });

    Render.run(render);
    Runner.run(runner, engine);

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      World.clear(engine.world, false);
      Engine.clear(engine);
      if (render.canvas) {
        render.canvas.remove();
      }
      render.textures = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions.w]); // reinit on width change or mount

  // Pause/Resume
  useEffect(() => {
    const runner = runnerRef.current;
    if (!runner) return;
    runner.enabled = !paused;
  }, [paused]);

  // Curve-following guidance
  useEffect(() => {
    const { Events, Body } = Matter;
    const engine = engineRef.current;
    const ball = ballRef.current;
    if (!engine || !ball) return;

    const forceScale = 0.0008; // adjust lateral correction
    const handler = () => {
      // Compute target y=f(x) in game coordinates
      const x = ball.position.x - (dimensions.w / 2); // center x=0 at middle for function input
      let targetY = null;
      if (compiled) {
        try {
          const y = compiled.evaluate({ x });
          if (isFinite(y)) targetY = y;
        } catch {
          targetY = null;
        }
      }
      if (targetY === null) return;

      // Transform function y to canvas coordinates:
      // we map f(x) range roughly into canvas space; assume 1 unit = 1 px for simplicity but centered vertically at mid-height
      const canvasY = dimensions.h / 2 + targetY;

      const dy = canvasY - ball.position.y;
      // vertical attraction toward curve path (mild)
      const vyForce = Math.max(Math.min(dy * 0.0003, 0.02), -0.02);

      // lateral steer toward direction of slope: compute next y at x+1 to get slope
      let slope = 0;
      if (compiled) {
        try {
          const y1 = compiled.evaluate({ x: x + 1 });
          if (isFinite(y1) && isFinite(targetY)) {
            slope = y1 - targetY;
          }
        } catch {
          slope = 0;
        }
      }
      const dir = Math.sign(slope);
      const vxForce = dir * forceScale;

      Body.applyForce(ball, ball.position, { x: vxForce, y: vyForce });
    };

    const unsubscribe = Matter.Events.on(engine, 'beforeUpdate', handler);
    return () => {
      Matter.Events.off(engine, 'beforeUpdate', handler);
    };
  }, [compiled, dimensions.h, dimensions.w]);

  useEffect(() => {
    // initialize HUD stats
    onStarStats({
      collected: starStatesRef.current.filter((s) => s.collected).length,
      total: starStatesRef.current.length || 5,
    });
  }, [onStarStats]);

  return (
    <div className="game-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Game</div>
      <div ref={containerRef} className="game-canvas" role="application" aria-label="Gravity Curve Game Canvas" />
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Tip: Pause to change equation, then resume. Try linear, quadratic, or sine curves!
      </div>
    </div>
  );
}
