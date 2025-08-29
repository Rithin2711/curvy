import React from 'react';

/**
 * PUBLIC_INTERFACE
 */
export default function Leaderboard({ items = [] }) {
  return (
    <div className="leaderboard-panel">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Leaderboard</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th>Player</th>
            <th>Score</th>
            <th>Moves</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: 12, color: 'var(--text-secondary)' }}>
                No scores yet. Be the first!
              </td>
            </tr>
          )}
          {items.map((row, idx) => (
            <tr key={`${row.username}-${idx}`}>
              <td>{idx + 1}</td>
              <td>{row.username}</td>
              <td>{row.score}</td>
              <td>{row.moves ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
