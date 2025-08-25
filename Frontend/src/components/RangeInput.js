import React, { useEffect, useState } from 'react';

/**
 * PUBLIC_INTERFACE
 */
export default function RangeInput({ initialMin = -200, initialMax = 200, onChange }) {
  /**
   * RangeInput renders two compact number fields for domain selection [min, max].
   * It performs basic validation (min < max) and emits numeric values via onChange.
   */
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);
  const [error, setError] = useState('');

  useEffect(() => {
    setMin(initialMin);
  }, [initialMin]);

  useEffect(() => {
    setMax(initialMax);
  }, [initialMax]);

  useEffect(() => {
    if (typeof onChange === 'function') {
      onChange({ min: Number(min), max: Number(max), valid: !error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, error]);

  const validate = (m, M) => {
    if (!isFinite(m) || !isFinite(M)) return 'Range must be finite numbers';
    if (m >= M) return 'Min must be less than Max';
    return '';
  };

  const onMinChange = (e) => {
    const v = e.target.value;
    setMin(v);
    setError(validate(Number(v), Number(max)));
  };
  const onMaxChange = (e) => {
    const v = e.target.value;
    setMax(v);
    setError(validate(Number(min), Number(v)));
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Domain</span>
      <label htmlFor="dom-min" style={{ fontSize: 12 }}>min</label>
      <input
        id="dom-min"
        type="number"
        step="1"
        value={min}
        onChange={onMinChange}
        style={{
          width: 100,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      <label htmlFor="dom-max" style={{ fontSize: 12 }}>max</label>
      <input
        id="dom-max"
        type="number"
        step="1"
        value={max}
        onChange={onMaxChange}
        style={{
          width: 100,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border-color)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      />
      {error && (
        <span role="alert" style={{ color: '#dc3545', fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}
