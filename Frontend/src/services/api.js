import axios from 'axios';

// PUBLIC_INTERFACE
export function createApi() {
  /**
   * PUBLIC_INTERFACE
   * This API client wraps calls to the Backend container.
   * Required environment variable:
   * - REACT_APP_BACKEND_URL: Base URL of backend (e.g., http://localhost:8000)
   *
   * Note: Ensure orchestrator sets .env with REACT_APP_BACKEND_URL for deployment.
   */
  // IMPORTANT: Request the orchestrator to set REACT_APP_BACKEND_URL in .env file for deployments.
  const baseURL = process.env.REACT_APP_BACKEND_URL || '';

  const client = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  // PUBLIC_INTERFACE
  async function ensureProfile(username) {
    /** Create or update a user profile */
    if (!username) throw new Error('username required');
    try {
      const res = await client.post('/api/profile', { username });
      return res.data;
    } catch (e) {
      // Fallback: GET
      try {
        const res = await client.get(`/api/profile/${encodeURIComponent(username)}`);
        return res.data;
      } catch (err) {
        throw err;
      }
    }
  }

  // PUBLIC_INTERFACE
  async function submitScore({ username, score, moves }) {
    /** Submit a game score */
    const res = await client.post('/api/scores', { username, score, moves });
    return res.data;
    }

  // PUBLIC_INTERFACE
  async function getLeaderboard() {
    /** Retrieve leaderboard */
    const res = await client.get('/api/leaderboard');
    return res.data;
  }

  return {
    ensureProfile,
    submitScore,
    getLeaderboard,
  };
}
