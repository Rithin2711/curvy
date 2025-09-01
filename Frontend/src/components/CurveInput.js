import React, { useState, useEffect } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

// PUBLIC_INTERFACE
export default function CurveInput({ initialExpr = '0.5*x', initialMin = -200, initialMax = 200, onSubmit }) {
  /**
   * PUBLIC_INTERFACE
   * Minimal equation input used on the simplified UI. Shows a single text input and min/max fields.
   * Calls onSubmit({ expr, min, max }) when a valid equation is provided.
   */
  const [expr, setExpr] = useState(initialExpr);
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);
  const [error, setError] = useState('');

  useEffect(() => { setExpr(initialExpr); }, [initialExpr]);
  useEffect(() => { setMin(initialMin); }, [initialMin]);
  useEffect(() => { setMax(initialMax); }, [initialMax]);

  const validate = () => {
    if (!isFinite(min) || !isFinite(max) || Number(min) >= Number(max)) {
      return 'Please provide a valid numeric domain where min < max.';
    }
    try {
      const compiled = math.compile(expr);
      compiled.evaluate({ x: Number(min) });
      compiled.evaluate({ x: Number(max) });
      return '';
    } catch (e) {
      return e?.message || 'Invalid expression';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const err = validate();
    setError(err);
    if (!err && typeof onSubmit === 'function') {
      onSubmit({ expr: String(expr), min: Number(min), max: Number(max) });
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
      <label htmlFor="curve-expr" style={{ fontWeight: 600 }}>Enter y = f(x)</label>
      <input
        id="curve-expr"
        type="text"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="e.g., 0.5*x or (x^2)/120 or 40*sin(x/20)"
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="curve-min" style={{ fontSize: 12 }}>min</label>
        <input
          id="curve-min"
          type="number"
          step="1"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          style={{
            width: 110,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        />
        <label htmlFor="curve-max" style={{ fontSize: 12 }}>max</label>
        <input
          id="curve-max"
          type="number"
          step="1"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          style={{
            width: 110,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          type="submit"
          style={{
            marginLeft: 'auto',
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--button-bg)',
            color: 'var(--button-text)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Plot
        </button>
      </div>
      {error && (
        <div role="alert" style={{ color: '#dc3545', fontSize: 13 }}>{error}</div>
      )}
    </form>
  );
}
