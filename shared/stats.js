/**
 * @quietpulse/shared — Streak, Completion Rate & Focus Session Analytics Engine
 * Pure functions shared across React Native, Electron, and Web.
 */

import { toLocalISODate, parseLocalISODate, getISOWeekday } from './models.js';

/**
 * Checks if a habit is scheduled on a given Date object or 'YYYY-MM-DD' string.
 */
export function isHabitScheduledOnDate(habit, dateInput) {
  if (!habit || habit.deleted_at || habit.archived) return false;
  const d = typeof dateInput === 'string' ? parseLocalISODate(dateInput) : dateInput;
  if (habit.frequency_type === 'daily') return true;
  if (habit.frequency_type === 'weekdays') {
    const isoDay = getISOWeekday(d);
    const days = Array.isArray(habit.target_days) ? habit.target_days : [0, 1, 2, 3, 4, 5, 6];
    return days.includes(isoDay);
  }
  // For 'weekly_count', any day of the week is eligible
  return true;
}

/**
 * Calculates current streak, longest streak, 7-day completion %, and 30-day completion %
 * for a single habit given its logs.
 *
 * Tricky part:
 * - Rest days (weekdays not in `habit.target_days`) are skipped without breaking a streak.
 * - If today is a scheduled day and not yet checked off, the streak accumulated up through
 *   yesterday remains intact until the day ends.
 */
export function computeHabitStats(habit, allLogs, referenceDateStr = toLocalISODate()) {
  const habitLogs = allLogs.filter(
    (l) => l.habit_id === habit.id && !l.deleted_at && l.completed
  );
  const completedSet = new Set(habitLogs.map((l) => l.log_date));
  const refDate = parseLocalISODate(referenceDateStr);

  // 1. Current Streak (scan backward up to 365 days)
  let currentStreak = 0;
  for (let i = 0; i < 365; i++) {
    const cursor = new Date(refDate);
    cursor.setDate(refDate.getDate() - i);
    const iso = toLocalISODate(cursor);
    const scheduled = isHabitScheduledOnDate(habit, cursor);

    if (completedSet.has(iso)) {
      currentStreak += 1;
    } else if (scheduled) {
      if (i === 0) {
        // Today hasn't been checked yet; keep scanning yesterday
        continue;
      } else {
        break;
      }
    }
  }

  // 2. Longest Streak (scan last 180 days chronologically)
  let longestStreak = currentStreak;
  let running = 0;
  for (let i = 180; i >= 0; i--) {
    const cursor = new Date(refDate);
    cursor.setDate(refDate.getDate() - i);
    const iso = toLocalISODate(cursor);
    const scheduled = isHabitScheduledOnDate(habit, cursor);

    if (completedSet.has(iso)) {
      running += 1;
      if (running > longestStreak) longestStreak = running;
    } else if (scheduled && i > 0) {
      running = 0;
    }
  }

  // 3. Window completion percentage helper
  function computeWindowRate(daysWindow) {
    let scheduledCount = 0;
    let completedCount = 0;
    for (let i = 0; i < daysWindow; i++) {
      const cursor = new Date(refDate);
      cursor.setDate(refDate.getDate() - i);
      const iso = toLocalISODate(cursor);
      if (isHabitScheduledOnDate(habit, cursor)) {
        scheduledCount += 1;
        if (completedSet.has(iso)) {
          completedCount += 1;
        }
      }
    }
    if (scheduledCount === 0) return 100;
    return Math.min(100, Math.round((completedCount / scheduledCount) * 100));
  }

  return {
    habitId: habit.id,
    currentStreak,
    longestStreak,
    completionRate7d: computeWindowRate(7),
    completionRate30d: computeWindowRate(30),
    completedToday: completedSet.has(referenceDateStr),
    completedDates: Array.from(completedSet),
  };
}

/**
 * Generates daily completion series for charts over `daysCount` days (e.g. 7 for weekly, 30 for monthly).
 */
export function buildCompletionSeries(habits, allLogs, daysCount = 7, referenceDateStr = toLocalISODate()) {
  const activeHabits = habits.filter((h) => !h.deleted_at && !h.archived);
  const refDate = parseLocalISODate(referenceDateStr);
  const series = [];

  for (let offset = daysCount - 1; offset >= 0; offset--) {
    const d = new Date(refDate);
    d.setDate(refDate.getDate() - offset);
    const iso = toLocalISODate(d);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let scheduled = 0;
    let completed = 0;

    for (const h of activeHabits) {
      if (isHabitScheduledOnDate(h, d)) {
        scheduled += 1;
        const isDone = allLogs.some(
          (l) => l.habit_id === h.id && l.log_date === iso && l.completed && !l.deleted_at
        );
        if (isDone) completed += 1;
      }
    }

    const percentage = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;
    series.push({
      date: iso,
      dayLabel,
      shortDate,
      completed,
      scheduled,
      percentage,
    });
  }

  return series;
}

/**
 * Computes Focus Session statistics (today minutes, 7-day minutes, total minutes,
 * per-day breakdown, and per-habit breakdown).
 */
export function computeFocusStats(sessions, habits = [], referenceDateStr = toLocalISODate()) {
  const validSessions = sessions.filter((s) => !s.deleted_at);
  const refDate = parseLocalISODate(referenceDateStr);
  const sevenDaysAgo = new Date(refDate);
  sevenDaysAgo.setDate(refDate.getDate() - 6);
  const sevenDaysAgoIso = toLocalISODate(sevenDaysAgo);

  let todaySec = 0;
  let weekSec = 0;
  let totalSec = 0;
  let completedCount = 0;
  let cancelledCount = 0;

  const dailyMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(refDate.getDate() - i);
    const iso = toLocalISODate(d);
    dailyMap[iso] = {
      date: iso,
      dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
      minutes: 0,
      sessionsCount: 0,
    };
  }

  const byHabitMap = {};

  for (const s of validSessions) {
    const sessionLocalDate = toLocalISODate(new Date(s.started_at));
    if (s.status === 'completed') {
      completedCount += 1;
      const sec = Number(s.actual_duration_sec || 0);
      totalSec += sec;
      if (sessionLocalDate === referenceDateStr) {
        todaySec += sec;
      }
      if (sessionLocalDate >= sevenDaysAgoIso && sessionLocalDate <= referenceDateStr) {
        weekSec += sec;
      }
      if (dailyMap[sessionLocalDate]) {
        dailyMap[sessionLocalDate].minutes += Math.round(sec / 60);
        dailyMap[sessionLocalDate].sessionsCount += 1;
      }
      const key = s.habit_id || 'unlinked';
      byHabitMap[key] = (byHabitMap[key] || 0) + Math.round(sec / 60);
    } else if (s.status === 'cancelled') {
      cancelledCount += 1;
    }
  }

  const habitBreakdown = Object.entries(byHabitMap).map(([habitId, minutes]) => {
    const found = habits.find((h) => h.id === habitId);
    return {
      habitId,
      habitName: found ? found.name : 'General Deep Work',
      color: found ? found.color : '#6366F1',
      minutes,
    };
  });

  const finishedTotal = completedCount + cancelledCount;
  const completionRate =
    finishedTotal > 0 ? Math.round((completedCount / finishedTotal) * 100) : 100;

  return {
    todayFocusMinutes: Math.round(todaySec / 60),
    weekFocusMinutes: Math.round(weekSec / 60),
    totalFocusMinutes: Math.round(totalSec / 60),
    completedSessionsCount: completedCount,
    cancelledSessionsCount: cancelledCount,
    completionRatePercent: completionRate,
    dailyBreakdown: Object.values(dailyMap),
    habitBreakdown,
  };
}
