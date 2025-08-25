import React, { useMemo, useRef, useEffect } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GraphPlot({ expression, width = 800, height = 260 }) {
  /**
   * Desmos-style mini plot: axes centered, gridlines, and function y=f(x).
   * Domain: x in [-200,200], Range: y in [-120,120].
   */
  const canvasRef = useRef(null);

  const compiled = useMemo(() => {
    try {
      return math.compile(expression);
    } catch {
      return null;
    }
  }, [expression]);

  const pts = useMemo(() => {
    const samples = [];
    const xMin = -200;
    const xMax = 200;
    const step = 1;
    for (let x = xMin; x <= xMax; x += step) {
      let y = NaN;
      if (compiled) {
        try {
          y = compiled.evaluate({ x });
        } catch {
          y = NaN;
        }
      }
      if (isFinite(y)) samples.push({ x, y });
    }
    return samples;
  }, [compiled]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');

    // Desmos-style axes setup
    const pad = 10;
    const xMin = -200, xMax = 200;
    const yMin = -120, yMax = 120;

    const xToPx = (x) => ((x - xMin) / (xMax - xMin)) * (width - 2 * pad) + pad;
    const yToPx = (y) => height - ( (y - yMin) / (yMax - yMin) ) * (height - 2 * pad) - pad;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color') || '#e9ecef';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;

    const gridStepX = 50;
    for (let x = Math.ceil(xMin / gridStepX) * gridStepX; x <= xMax; x += gridStepX) {
      const px = xToPx(x);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    const gridStepY = 40;
    for (let y = Math.ceil(yMin / gridStepY) * gridStepY; y <= yMax; y += gridStepY) {
      const py = yToPx(y);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Axes
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#61dafb';
    ctx.lineWidth = 1.5;
    // x-axis (y=0)
    ctx.beginPath();
    ctx.moveTo(0, yToPx(0));
    ctx.lineTo(width, yToPx(0));
    ctx.stroke();
    // y-axis (x=0)
    ctx.beginPath();
    ctx.moveTo(xToPx(0), 0);
    ctx.lineTo(xToPx(0), height);
    ctx.stroke();

    // Function polyline
    ctx.strokeStyle = '#61dafb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of pts) {
      const px = xToPx(p.x);
      const py = yToPx(p.y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Label
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary') || '#000';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`y = ${expression}`, 12, 18);
  }, [expression, height, pts, width]);

  return (
    <div className="graph-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Graph Preview</div>
      <canvas ref={canvasRef} className="graph-canvas" />
    </div>
  );
}
