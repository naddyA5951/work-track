/**
 * @quietpulse/shared — Offline-First Sync & Last-Write-Wins (LWW) Conflict Engine
 *
 * Works with any storage adapter implementing `getItem(key)` and `setItem(key, val)`
 * (e.g., `AsyncStorage` on React Native, `localStorage` on Electron/Web).
 */

/**
 * Merges incoming server records with local records using Last-Write-Wins (LWW)
 * based on ISO UTC `updated_at` timestamps.
 *
 * Tricky part:
 * - For `habit_logs`, records represent a unique `(habit_id, log_date)` tuple. Two devices
 *   might check off the same habit on the same day while offline, generating two different
 *   UUIDs for `(habit_id, log_date)`. We deduplicate by composite key `(habit_id, log_date)`
 *   as well as `id`, keeping whichever record has the newer `updated_at` timestamp.
 */
export function mergeRecordsLWW(localList = [], remoteList = [], compositeKeyFn = null) {
  const byId = new Map();
  const byComposite = new Map();
  let conflictsResolved = 0;

  const insertOrMerge = (record, isRemote = false) => {
    const compKey = compositeKeyFn ? compositeKeyFn(record) : null;
    const existingIdRecord = byId.get(record.id);
    const existingCompRecord = compKey ? byComposite.get(compKey) : null;
    const existing = existingIdRecord || existingCompRecord;

    if (!existing) {
      byId.set(record.id, record);
      if (compKey) byComposite.set(compKey, record);
      return;
    }

    if (isRemote && existing.id !== record.id) {
      conflictsResolved += 1;
    }

    const existingTime = new Date(existing.updated_at || 0).getTime();
    const incomingTime = new Date(record.updated_at || 0).getTime();

    if (incomingTime >= existingTime) {
      if (existing.id !== record.id) {
        byId.delete(existing.id);
      }
      byId.set(record.id, record);
      if (compKey) byComposite.set(compKey, record);
    } else if (isRemote) {
      conflictsResolved += 1;
    }
  };

  for (const item of localList) {
    insertOrMerge(item, false);
  }
  for (const item of remoteList) {
    insertOrMerge(item, true);
  }

  return {
    merged: Array.from(byId.values()),
    conflictsResolved,
  };
}

export class OfflineSyncEngine {
  constructor({ apiClient, storage, storageKey = 'quietpulse_offline_state_v1' }) {
    this.apiClient = apiClient;
    this.storage = storage;
    this.storageKey = storageKey;
  }

  async loadState() {
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveState(state) {
    await this.storage.setItem(this.storageKey, JSON.stringify(state));
  }

  /**
   * Executes a bidirectional batch sync against `POST /sync` and reconciles local state
   * using deterministic Last-Write-Wins (LWW).
   */
  async synchronize(currentState) {
    const dirtyHabits = currentState.habits.filter((h) => h._dirty);
    const dirtyLogs = currentState.habitLogs.filter((l) => l._dirty);
    const dirtySessions = currentState.focusSessions.filter((s) => s._dirty);

    const stripDirty = ({ _dirty, ...rest }) => rest;

    const payload = {
      last_synced_at: currentState.lastSyncedAt || null,
      changes: {
        habits: dirtyHabits.map(stripDirty),
        habit_logs: dirtyLogs.map(stripDirty),
        focus_sessions: dirtySessions.map(stripDirty),
      },
    };

    const response = await this.apiClient.syncBatch(payload);

    const serverHabits = (response.changes && response.changes.habits) || [];
    const serverLogs = (response.changes && response.changes.habit_logs) || [];
    const serverSessions = (response.changes && response.changes.focus_sessions) || [];

    const cleanLocalHabits = currentState.habits.map(stripDirty);
    const cleanLocalLogs = currentState.habitLogs.map(stripDirty);
    const cleanLocalSessions = currentState.focusSessions.map(stripDirty);

    const mergedHabits = mergeRecordsLWW(cleanLocalHabits, serverHabits);
    const mergedLogs = mergeRecordsLWW(
      cleanLocalLogs,
      serverLogs,
      (l) => `${l.habit_id}::${l.log_date}`
    );
    const mergedSessions = mergeRecordsLWW(cleanLocalSessions, serverSessions);

    const nextState = {
      ...currentState,
      habits: mergedHabits.merged,
      habitLogs: mergedLogs.merged,
      focusSessions: mergedSessions.merged,
      lastSyncedAt: response.server_time || new Date().toISOString(),
      lastSyncStats: {
        appliedByServer: response.applied_counts,
        conflictsResolved:
          (response.conflicts_resolved || 0) +
          mergedHabits.conflictsResolved +
          mergedLogs.conflictsResolved +
          mergedSessions.conflictsResolved,
        syncedAt: new Date().toISOString(),
      },
    };

    await this.saveState(nextState);
    return nextState;
  }
}
