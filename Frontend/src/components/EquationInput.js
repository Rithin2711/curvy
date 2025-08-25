import React, { useEffect, useState } from 'react';
import { create, all } from 'mathjs';

const math = create(all, {});

/**
 * PUBLIC_INTERFACE
 */
export default function EquationInput({ onApply, initialValue = '' }) {
  /**
   * Equation input allows users to enter y=f(x).
   * Accepts mathjs expressions, e.g., 0.5*x, x^2/100, sin(x), 0.002*x^3 - 0.3*x
   * Variables: x
   */
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const validate = (expr) => {
    try {
      const compiled = math.compile(expr);
      // test evaluation
      compiled.evaluate({ x: 0 });
      compiled.evaluate({ x: 10 });
      return '';
    } catch (e) {
      return e?.message || 'Invalid expression';
    }
  };

  const handleApply = () => {
    const err = validate(value);
    setError(err);
    if (!err) onApply(value);
  };

  const presets = [
    { label: 'Linear: 0.5x', expr: '0.5*x' },
    { label: 'Quadratic: x^2/120', expr: '(x^2)/120' },
    { label: 'Sine: 40*sin(x/20)', expr: '40*sin(x/20)' },
    { label: 'Cubic: 0.002x^3-0.3x', expr: '0.002*x^3 - 0.3*x' },
  ];

  return (
    <div className="equation-panel">
      <label htmlFor="equation" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
        Enter equation y = f(x)
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          id="equation"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g., 0.5*x or (x^2)/100 or 40*sin(x/20)"
          style={{
            flex: 1,
            minWidth: 240,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={handleApply}
          className="btn"
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--button-bg)',
            color: 'var(--button-text)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Apply
        </button>
      </div>
      {error && (
        <div role="alert" style={{ color: '#dc3545', marginTop: 6, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button
            key={p.expr}
            onClick={() => {
              setValue(p.expr);
              setError('');
            }}
            style={{
              borderRadius: 20,
              padding: '6px 10px',
              border: '1px solid var(--border-color)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
            }}
            aria-label={`Preset ${p.label}`}
            title={p.expr}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
