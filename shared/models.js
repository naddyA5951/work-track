/**
 * @quietpulse/shared — Data Models, Presets & Date Utilities
 * Plain JavaScript (ES Module) shared across React Native (Mobile), Electron (Windows), and Web.
 */

export const HABIT_COLORS = [
  { id: 'emerald', hex: '#10B981', label: 'Emerald' },
  { id: 'indigo', hex: '#6366F1', label: 'Indigo' },
  { id: 'amber', hex: '#F59E0B', label: 'Amber' },
  { id: 'cyan', hex: '#06B6D4', label: 'Cyan' },
  { id: 'rose', hex: '#F43F5E', label: 'Rose' },
  { id: 'violet', hex: '#8B5CF6', label: 'Violet' },
];

export const HABIT_ICONS = [
  'code',
  'book-open',
  'activity',
  'moon',
  'zap',
  'flame',
  'coffee',
  'brain',
  'dumbbell',
  'pen-tool',
];

export const FOCUS_PRESETS_MINUTES = [25, 50, 90];

export const WEEKDAYS = [
  { index: 0, short: 'M', name: 'Monday' },
  { index: 1, short: 'T', name: 'Tuesday' },
  { index: 2, short: 'W', name: 'Wednesday' },
  { index: 3, short: 'T', name: 'Thursday' },
  { index: 4, short: 'F', name: 'Friday' },
  { index: 5, short: 'S', name: 'Saturday' },
  { index: 6, short: 'S', name: 'Sunday' },
];

/**
 * Generates an RFC4122 v4 UUID in any JS runtime (React Native Hermes, Node, Chromium).
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Formats a Date object (or current local date) as 'YYYY-MM-DD' in local calendar time.
 * Tricky part: Using `.toISOString().slice(0, 10)` shifts the date into UTC, which causes
 * evening check-offs in Americas or early morning check-offs in Asia to log on the wrong day.
 */
export function toLocalISODate(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a 'YYYY-MM-DD' string into a local Date at noon to avoid DST midnight shifts.
 */
export function parseLocalISODate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Converts JS Date.getDay() (0=Sun..6=Sat) to ISO weekday index (0=Mon..6=Sun)
 * matching Python's `date.weekday()`.
 */
export function getISOWeekday(dateObj) {
  const jsDay = dateObj.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Factory for creating a normalized Habit record on the client.
 */
export function createHabitModel(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || generateUUID(),
    user_id: partial.user_id || 'local-user',
    name: (partial.name || 'Untitled Habit').trim(),
    description: partial.description || '',
    icon: partial.icon || 'code',
    color: partial.color || '#10B981',
    frequency_type: partial.frequency_type || 'daily', // 'daily' | 'weekdays' | 'weekly_count'
    target_days: Array.isArray(partial.target_days)
      ? partial.target_days
      : [0, 1, 2, 3, 4, 5, 6],
    weekly_target_count: Number(partial.weekly_target_count || 7),
    default_focus_minutes: Number(partial.default_focus_minutes || 25),
    archived: Boolean(partial.archived),
    created_at: partial.created_at || now,
    updated_at: partial.updated_at || now,
    deleted_at: partial.deleted_at || null,
  };
}

/**
 * Factory for creating a normalized HabitLog (daily check-off) record.
 */
export function createHabitLogModel(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || generateUUID(),
    habit_id: partial.habit_id,
    user_id: partial.user_id || 'local-user',
    log_date: partial.log_date || toLocalISODate(),
    completed: partial.completed !== undefined ? Boolean(partial.completed) : true,
    note: partial.note || '',
    created_at: partial.created_at || now,
    updated_at: partial.updated_at || now,
    deleted_at: partial.deleted_at || null,
  };
}

/**
 * Factory for creating a normalized FocusSession record.
 */
export function createFocusSessionModel(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || generateUUID(),
    user_id: partial.user_id || 'local-user',
    habit_id: partial.habit_id || null,
    planned_duration_sec: Number(partial.planned_duration_sec || 1500),
    actual_duration_sec: Number(partial.actual_duration_sec || 0),
    status: partial.status || 'in_progress', // 'in_progress' | 'completed' | 'cancelled'
    started_at: partial.started_at || now,
    ended_at: partial.ended_at || null,
    dnd_requested: partial.dnd_requested !== undefined ? Boolean(partial.dnd_requested) : true,
    dnd_applied_mode: partial.dnd_applied_mode || 'native_os',
    previous_dnd_state: partial.previous_dnd_state || 'INTERRUPTION_FILTER_ALL',
    updated_at: partial.updated_at || now,
    deleted_at: partial.deleted_at || null,
  };
}
