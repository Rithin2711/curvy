import React, { useEffect, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, LineElement, LinearScale, PointElement, Tooltip, Legend, CategoryScale } from 'chart.js';
import { create, all } from 'mathjs';

Chart.register(LineElement, LinearScale, PointElement, Tooltip, Legend, CategoryScale);
const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 */
export default function GraphPlot({ expression }) {
  /**
   * Renders a small plot of y=f(x) for x in [-200, 200] to provide visual feedback.
   */
  const compiled = useMemo(() => {
    try {
      return math.compile(expression);
    } catch {
      return null;
    }
  }, [expression]);

  const data = useMemo(() => {
    const xs = [];
    const ys = [];
    for (let x = -200; x <= 200; x += 5) {
      xs.push(x);
      let y = NaN;
      if (compiled) {
        try {
          y = compiled.evaluate({ x });
        } catch {
          y = NaN;
        }
      }
      ys.push(isFinite(y) ? y : NaN);
    }
    return {
      labels: xs,
      datasets: [
        {
          label: `y = ${expression}`,
          data: ys,
          borderColor: '#61dafb',
          backgroundColor: 'rgba(97,218,251,0.2)',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    };
  }, [compiled, expression]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          display: true,
          title: { display: true, text: 'x' },
          ticks: { color: 'var(--text-primary)' },
          grid: { color: 'var(--border-color)' },
        },
        y: {
          display: true,
          title: { display: true, text: 'y' },
          ticks: { color: 'var(--text-primary)' },
          grid: { color: 'var(--border-color)' },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: 'var(--text-primary)',
          },
        },
        tooltip: {},
      },
    }),
    []
  );

  return (
    <div className="graph-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Graph Preview</div>
      <div className="graph-canvas">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
