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

/**
 * Curated 31-day rotating library of daily motivational quotes focused on
 * habit compounding, uninterrupted deep work, and disciplined calm.
 */
export const DAILY_MOTIVATIONAL_QUOTES = [
  {
    id: 'q-01',
    quote: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
    author: 'Will Durant',
    theme: 'Habit Compounding',
  },
  {
    id: 'q-02',
    quote: 'You do not rise to the level of your goals. You fall to the level of your systems.',
    author: 'James Clear',
    theme: 'Daily Systems',
  },
  {
    id: 'q-03',
    quote: 'Three hours of uninterrupted deep focus produces more lasting value than a week of fragmented attention.',
    author: 'Cal Newport',
    theme: 'Deep Work',
  },
  {
    id: 'q-04',
    quote: 'Concentrate every minute like a Roman on doing what is in front of you with precise and genuine seriousness.',
    author: 'Marcus Aurelius',
    theme: 'Present Focus',
  },
  {
    id: 'q-05',
    quote: 'Small disciplines repeated with consistency every day lead to great achievements gained slowly over time.',
    author: 'John C. Maxwell',
    theme: 'Consistency',
  },
  {
    id: 'q-06',
    quote: 'If you want to make a permanent change, stop focusing on the size of your goals and start focusing on the quality of your daily ritual.',
    author: 'T. Harv Eker',
    theme: 'Daily Ritual',
  },
  {
    id: 'q-07',
    quote: 'The successful warrior is the average person, with laser-like focus.',
    author: 'Bruce Lee',
    theme: 'Single-Pointed Attention',
  },
  {
    id: 'q-08',
    quote: 'First forget inspiration. Habit is more dependable. Habit will sustain you whether you are inspired or not.',
    author: 'Octavia Butler',
    theme: 'Relentless Craft',
  },
  {
    id: 'q-09',
    quote: 'How we spend our days is, of course, how we spend our lives.',
    author: 'Annie Dillard',
    theme: 'Intentional Living',
  },
  {
    id: 'q-10',
    quote: 'Step by step and the thing is done.',
    author: 'Miyamoto Musashi',
    theme: 'Mastery',
  },
  {
    id: 'q-11',
    quote: 'Almost everything will work again if you unplug it for a few minutes, including you.',
    author: 'Anne Lamott',
    theme: 'Quiet Sanctuary',
  },
  {
    id: 'q-12',
    quote: 'Protect your attention as your scarcest asset; what you give your focus to shapes who you become.',
    author: 'Epictetus',
    theme: 'Guarded Attention',
  },
  {
    id: 'q-13',
    quote: 'Every action you take is a vote for the type of person you wish to become.',
    author: 'James Clear',
    theme: 'Identity Habits',
  },
  {
    id: 'q-14',
    quote: 'Simplicity boils down to two steps: identify the essential, and eliminate the rest.',
    author: 'Leo Babauta',
    theme: 'Minimalist Focus',
  },
  {
    id: 'q-15',
    quote: 'A river cuts through rock not because of its power, but because of its persistence.',
    author: 'Jim Watkins',
    theme: 'Streak Momentum',
  },
  {
    id: 'q-16',
    quote: 'In an age of constant distraction, the ability to sit quietly with one problem is a superpower.',
    author: 'Naval Ravikant',
    theme: 'Deep Work',
  },
  {
    id: 'q-17',
    quote: 'Do not wait; the time will never be just right. Start where you stand, and work with whatever tools you have.',
    author: 'George Herbert',
    theme: 'Immediate Action',
  },
  {
    id: 'q-18',
    quote: 'Discipline is choosing between what you want now and what you want most.',
    author: 'Abraham Lincoln',
    theme: 'Long-Term Vision',
  },
  {
    id: 'q-19',
    quote: 'Calmness of mind is one of the beautiful jewels of wisdom. It is the result of long and patient effort in self-control.',
    author: 'James Allen',
    theme: 'Mindful Calm',
  },
  {
    id: 'q-20',
    quote: 'Success is nothing more than a few simple disciplines, practiced every day.',
    author: 'Jim Rohn',
    theme: 'Daily Discipline',
  },
  {
    id: 'q-21',
    quote: 'Nothing is less productive than to make more efficient what should not be done at all.',
    author: 'Peter Drucker',
    theme: 'Priority Selection',
  },
];

/**
 * Deterministically returns the quote of the day for a given 'YYYY-MM-DD' local date string,
 * plus an optional manual browse offset so users can also cycle through quotes on demand.
 */
export function getDailyMotivationalQuote(isoDateStr = toLocalISODate(), offset = 0) {
  const d = parseLocalISODate(isoDateStr);
  const startOfYear = new Date(d.getFullYear(), 0, 0);
  const diffMs = d.getTime() - startOfYear.getTime();
  const dayOfYear = Math.max(1, Math.floor(diffMs / 86400000));
  const totalQuotes = DAILY_MOTIVATIONAL_QUOTES.length;
  const idx = ((dayOfYear - 1 + offset) % totalQuotes + totalQuotes) % totalQuotes;
  return {
    ...DAILY_MOTIVATIONAL_QUOTES[idx],
    dayOfYear,
    date: isoDateStr,
    index: idx + 1,
    totalQuotes,
  };
}

