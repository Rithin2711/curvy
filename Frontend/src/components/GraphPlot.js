import React, { useMemo, useRef, useEffect } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function GraphPlot({ expression, width = 800, height = 260 }) {
  /**
   * Desmos-style mini plot: axes centered, gridlines, and function y=f(x).
   * Uses physical units where 1 unit = 1 cm.
   * Domain and range are scaled to match the main game canvas.
   */
  
  // Scale constant: 1 unit (1 cm) = 28 pixels (reduced to compact the graph)
  const SCALE_PX_PER_CM = 28;
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
    // Convert dimensions to cm units
    const xMin = -Math.round(width / (2 * SCALE_PX_PER_CM));
    const xMax = Math.round(width / (2 * SCALE_PX_PER_CM));
    const yMin = -Math.round(height / (2 * SCALE_PX_PER_CM));
    const yMax = Math.round(height / (2 * SCALE_PX_PER_CM));

    const xToPx = (x) => ((x - xMin) / (xMax - xMin)) * (width - 2 * pad) + pad;
    const yToPx = (y) => height - ( (y - yMin) / (yMax - yMin) ) * (height - 2 * pad) - pad;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color') || '#e9ecef';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;

    // Grid lines every 5cm
    const gridStepCm = 5;
    for (let x = Math.ceil(xMin / gridStepCm) * gridStepCm; x <= xMax; x += gridStepCm) {
      const px = xToPx(x);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
      
      // Add cm labels
      if (x !== 0) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#61dafb';
        ctx.fillText(`${x}cm`, px - 12, height - 4);
      }
    }
    
    for (let y = Math.ceil(yMin / gridStepCm) * gridStepCm; y <= yMax; y += gridStepCm) {
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
