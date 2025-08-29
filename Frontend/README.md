# Gravity Curve Frontend (React)

This is the complete React-based client for Gravity Curve. It includes:
- Mathematical equation editor (math.js syntax)
- Real-time graph plotting and unified gameplay canvas (HTML5 Canvas)
- Start/Pause/Resume/Reset controls
- Ball and star objects with collection logic and path tracing
- Score submission and Leaderboard integration with Backend API
- Light/Dark theme toggle and responsive layout

## Quick Start

1. Install dependencies:
   - `npm install`

2. Configure Backend URL:
   - Copy `.env.example` to `.env`
   - Set `REACT_APP_BACKEND_URL` to your Backend FastAPI URL (e.g., `http://localhost:8000`)

3. Run the app:
   - `npm start`
   - Open http://localhost:3000 in your browser

4. Run tests:
   - `npm test`

## Gameplay

- Enter an equation y = f(x) (examples: `0.5*x`, `(x^2)/120`, `40*sin(x/20)`, `0.002*x^3 - 0.3*x`).
- Set a domain [min, max] for each equation segment. Multiple equations are followed in sequence from left to right over the visible domain.
- Use Start/Resume to move the ball, Pause to adjust equations, Reset to start over.
- Collect all stars to complete the level. Your moves count increments when changing equations during play.
- Submit your score automatically when all stars are collected; leaderboard updates from the backend.

## Environment Variables

Create a `.env` file with:
```
REACT_APP_BACKEND_URL=http://localhost:8000
```
The frontend uses this to call the backend:
- POST `/api/profile` to ensure/update a profile
- POST `/api/scores` to submit a score
- GET `/api/leaderboard` to fetch leaderboard

## Tech

- React 18
- math.js for expression parsing/evaluation
- HTML5 Canvas for rendering
- axios for API requests

## Notes

- Public facing functions/components are documented and marked with PUBLIC_INTERFACE comments in source files.
- The canvas renders axes, curves, ball, moving path trace with fade, and stars with small animations.
- The ball traverses the full displayed domain for each curve to avoid premature stops.

