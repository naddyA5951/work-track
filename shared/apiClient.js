/**
 * @quietpulse/shared — Cross-Platform REST API Client
 * Works in React Native, Electron, and Web browsers using standard `fetch`.
 */

export class QuietPulseApiClient {
  /**
   * @param {object} config
   * @param {string} [config.baseUrl] - Base API URL (defaults to '' for relative proxy or http://localhost:8000)
   * @param {function} [config.getToken] - Returns current JWT access token string
   */
  constructor({ baseUrl = '', getToken = () => null } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
  }

  async request(path, { method = 'GET', body = null, headers = {} } = {}) {
    const token = this.getToken ? await this.getToken() : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (token) {
      reqHeaders.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : null,
    });

    if (response.status === 204) {
      return null;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const detail = (data && (data.detail || data.message)) || `HTTP ${response.status}`;
      const error = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      error.status = response.status;
      throw error;
    }

    return data;
  }

  // Auth
  register({ email, password, display_name }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: { email, password, display_name },
    });
  }

  login({ email, password }) {
    return this.request('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  }

  // Habits CRUD
  getHabits(includeArchived = false) {
    return this.request(`/habits?include_archived=${includeArchived}`);
  }

  createHabit(habitPayload) {
    return this.request('/habits', {
      method: 'POST',
      body: habitPayload,
    });
  }

  updateHabit(habitId, updatePayload) {
    return this.request(`/habits/${habitId}`, {
      method: 'PUT',
      body: updatePayload,
    });
  }

  deleteHabit(habitId) {
    return this.request(`/habits/${habitId}`, {
      method: 'DELETE',
    });
  }

  checkHabit(habitId, { log_date, completed, note, updated_at } = {}) {
    return this.request(`/habits/${habitId}/check`, {
      method: 'POST',
      body: { log_date, completed, note, updated_at },
    });
  }

  // Focus Sessions
  startSession(payload) {
    return this.request('/sessions/start', {
      method: 'POST',
      body: payload,
    });
  }

  endSession(payload) {
    return this.request('/sessions/end', {
      method: 'POST',
      body: payload,
    });
  }

  getSessionStats() {
    return this.request('/sessions/stats');
  }

  // Streaks
  getStreakStats(dateStr) {
    const query = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
    return this.request(`/stats/streaks${query}`);
  }

  // Batch Offline Sync
  syncBatch({ last_synced_at, changes }) {
    return this.request('/sync', {
      method: 'POST',
      body: { last_synced_at, changes },
    });
  }
}
