/**
 * QuietPulse Live Backend Server (`server.ts`)
 * Provides the full REST API contract (/api/auth/*, /api/habits/*, /api/sessions/*,
 * /api/stats/streaks, /api/sync) with deterministic Last-Write-Wins (LWW) conflict
 * resolution, pre-seeded realistic habits & 30-day logs, and a monorepo file inspector endpoint
 * for the AI Studio live preview on Port 3000.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

const app = express();
app.use(express.json({ limit: '5mb' }));

const DATA_FILE = path.resolve(process.cwd(), '.quietpulse_store.json');

interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

interface HabitRecord {
  id: string;
  user_id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  frequency_type: 'daily' | 'weekdays' | 'weekly_count';
  target_days: number[];
  weekly_target_count: number;
  default_focus_minutes: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface HabitLogRecord {
  id: string;
  habit_id: string;
  user_id: string;
  log_date: string;
  completed: boolean;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FocusSessionRecord {
  id: string;
  user_id: string;
  habit_id: string | null;
  planned_duration_sec: number;
  actual_duration_sec: number;
  status: 'in_progress' | 'completed' | 'cancelled';
  started_at: string;
  ended_at: string | null;
  dnd_requested: boolean;
  dnd_applied_mode: string;
  previous_dnd_state: string | null;
  updated_at: string;
  deleted_at: string | null;
}

interface DatabaseStore {
  users: UserRecord[];
  habits: HabitRecord[];
  habit_logs: HabitLogRecord[];
  focus_sessions: FocusSessionRecord[];
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(`qp_salt_${pw}`).digest('hex');
}

function toLocalISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getISOWeekday(d: Date): number {
  const jsDay = d.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function createSeedDatabase(): DatabaseStore {
  const now = new Date();
  const nowIso = now.toISOString();
  const userId = 'user-demo-alex-001';

  const users: UserRecord[] = [
    {
      id: userId,
      email: 'alex@quietpulse.app',
      password_hash: hashPassword('password123'),
      display_name: 'Alex Rivera',
      created_at: new Date(now.getTime() - 35 * 86400000).toISOString(),
    },
  ];

  const habits: HabitRecord[] = [
    {
      id: 'habit-deep-code-001',
      user_id: userId,
      name: 'Deep Architecture & Systems Work',
      description: '90 minutes of uninterrupted software architecture with OS Do Not Disturb active.',
      icon: 'code',
      color: '#6366F1',
      frequency_type: 'weekdays',
      target_days: [0, 1, 2, 3, 4],
      weekly_target_count: 5,
      default_focus_minutes: 50,
      archived: false,
      created_at: new Date(now.getTime() - 30 * 86400000).toISOString(),
      updated_at: nowIso,
      deleted_at: null,
    },
    {
      id: 'habit-mindful-read-002',
      user_id: userId,
      name: 'Technical & Philosophy Reading',
      description: 'Read 25 pages of technical monographs or primary literature without phone alerts.',
      icon: 'book-open',
      color: '#10B981',
      frequency_type: 'daily',
      target_days: [0, 1, 2, 3, 4, 5, 6],
      weekly_target_count: 7,
      default_focus_minutes: 25,
      archived: false,
      created_at: new Date(now.getTime() - 30 * 86400000).toISOString(),
      updated_at: nowIso,
      deleted_at: null,
    },
    {
      id: 'habit-zone2-cardio-003',
      user_id: userId,
      name: 'Zone 2 Aerobic Conditioning',
      description: '45 minutes of steady-state endurance running or ergometer rowing.',
      icon: 'activity',
      color: '#F59E0B',
      frequency_type: 'weekdays',
      target_days: [0, 2, 4, 5],
      weekly_target_count: 4,
      default_focus_minutes: 50,
      archived: false,
      created_at: new Date(now.getTime() - 30 * 86400000).toISOString(),
      updated_at: nowIso,
      deleted_at: null,
    },
    {
      id: 'habit-evening-journal-004',
      user_id: userId,
      name: 'Evening Shutdown & Priority Plan',
      description: 'Review today’s completed sessions, lock in tomorrow’s top 3 priorities, silence devices.',
      icon: 'moon',
      color: '#06B6D4',
      frequency_type: 'daily',
      target_days: [0, 1, 2, 3, 4, 5, 6],
      weekly_target_count: 7,
      default_focus_minutes: 25,
      archived: false,
      created_at: new Date(now.getTime() - 30 * 86400000).toISOString(),
      updated_at: nowIso,
      deleted_at: null,
    },
  ];

  const habit_logs: HabitLogRecord[] = [];
  for (const h of habits) {
    for (let offset = 28; offset >= 0; offset--) {
      const d = new Date(now);
      d.setDate(now.getDate() - offset);
      const isoDate = toLocalISODate(d);
      const weekday = getISOWeekday(d);
      if (!h.target_days.includes(weekday)) continue;

      let completed = false;
      if (offset === 0) {
        completed = h.id === 'habit-deep-code-001' || h.id === 'habit-mindful-read-002';
      } else if (offset <= 7) {
        completed = h.id !== 'habit-evening-journal-004' || offset % 2 === 0;
      } else {
        completed = (offset + h.name.length) % 4 !== 0;
      }

      if (completed) {
        const logTs = new Date(d.getTime()).toISOString();
        habit_logs.push({
          id: crypto.randomUUID(),
          habit_id: h.id,
          user_id: userId,
          log_date: isoDate,
          completed: true,
          note: 'Completed on schedule',
          created_at: logTs,
          updated_at: logTs,
          deleted_at: null,
        });
      }
    }
  }

  const focus_sessions: FocusSessionRecord[] = [];
  const dndModes = ['native_os', 'shortcut_bridge', 'native_os', 'in_app_fullscreen'];
  for (let offset = 6; offset >= 0; offset--) {
    const start = new Date(now);
    start.setDate(now.getDate() - offset);
    start.setHours(9, 30, 0, 0);
    const durMin = offset % 2 === 0 ? 50 : 25;
    const end = new Date(start.getTime() + durMin * 60000);

    focus_sessions.push({
      id: `session-seed-${offset}`,
      user_id: userId,
      habit_id: offset % 2 === 0 ? 'habit-deep-code-001' : 'habit-mindful-read-002',
      planned_duration_sec: durMin * 60,
      actual_duration_sec: durMin * 60,
      status: 'completed',
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      dnd_requested: true,
      dnd_applied_mode: dndModes[offset % dndModes.length],
      previous_dnd_state: 'INTERRUPTION_FILTER_ALL',
      updated_at: end.toISOString(),
      deleted_at: null,
    });
  }

  return { users, habits, habit_logs, focus_sessions };
}

function loadDb(): DatabaseStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // fallback to seed
  }
  const seeded = createSeedDatabase();
  saveDb(seeded);
  return seeded;
}

function saveDb(store: DatabaseStore) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // ignore write errors in read-only sandboxes
  }
}

let db = loadDb();

function getUserFromHeader(req: express.Request): UserRecord {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    const matched = db.users.find((u) => token.includes(u.id));
    if (matched) return matched;
  }
  return db.users[0];
}

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------
app.post(['/api/auth/register', '/auth/register'], (req, res) => {
  const { email, password, display_name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ detail: 'Email and password are required.' });
  }
  const normalized = String(email).trim().toLowerCase();
  const existing = db.users.find((u) => u.email === normalized);
  if (existing) {
    return res.status(409).json({ detail: 'An account with this email already exists.' });
  }

  const newUser: UserRecord = {
    id: crypto.randomUUID(),
    email: normalized,
    password_hash: hashPassword(password),
    display_name: display_name || normalized.split('@')[0],
    created_at: new Date().toISOString(),
  };
  db.users.push(newUser);
  saveDb(db);

  const token = `qp_jwt_${newUser.id}_${Date.now()}`;
  return res.status(201).json({
    access_token: token,
    token_type: 'bearer',
    user: {
      id: newUser.id,
      email: newUser.email,
      display_name: newUser.display_name,
      created_at: newUser.created_at,
    },
  });
});

app.post(['/api/auth/login', '/auth/login'], (req, res) => {
  const { email, password } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === normalized);
  if (!user || user.password_hash !== hashPassword(password || '')) {
    return res.status(401).json({ detail: 'Invalid email or password.' });
  }

  const token = `qp_jwt_${user.id}_${Date.now()}`;
  return res.json({
    access_token: token,
    token_type: 'bearer',
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      created_at: user.created_at,
    },
  });
});

// ---------------------------------------------------------------------------
// HABITS CRUD & CHECK-OFF ROUTES
// ---------------------------------------------------------------------------
app.get(['/api/habits', '/habits'], (req, res) => {
  const user = getUserFromHeader(req);
  const habits = db.habits.filter((h) => h.user_id === user.id && !h.deleted_at);
  return res.json(habits);
});

app.post(['/api/habits', '/habits'], (req, res) => {
  const user = getUserFromHeader(req);
  const body = req.body || {};
  const now = body.updated_at || new Date().toISOString();

  const habit: HabitRecord = {
    id: body.id || crypto.randomUUID(),
    user_id: user.id,
    name: String(body.name || 'New Habit').trim(),
    description: body.description || '',
    icon: body.icon || 'code',
    color: body.color || '#10B981',
    frequency_type: body.frequency_type || 'daily',
    target_days: Array.isArray(body.target_days) ? body.target_days : [0, 1, 2, 3, 4, 5, 6],
    weekly_target_count: Number(body.weekly_target_count || 7),
    default_focus_minutes: Number(body.default_focus_minutes || 25),
    archived: Boolean(body.archived),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  db.habits.push(habit);
  saveDb(db);
  return res.status(201).json(habit);
});

app.put(['/api/habits/:id', '/habits/:id'], (req, res) => {
  const user = getUserFromHeader(req);
  const idx = db.habits.findIndex((h) => h.id === req.params.id && h.user_id === user.id);
  if (idx < 0) return res.status(404).json({ detail: 'Habit not found' });

  const body = req.body || {};
  db.habits[idx] = {
    ...db.habits[idx],
    ...body,
    id: db.habits[idx].id,
    user_id: user.id,
    updated_at: body.updated_at || new Date().toISOString(),
  };
  saveDb(db);
  return res.json(db.habits[idx]);
});

app.delete(['/api/habits/:id', '/habits/:id'], (req, res) => {
  const user = getUserFromHeader(req);
  const idx = db.habits.findIndex((h) => h.id === req.params.id && h.user_id === user.id);
  if (idx < 0) return res.status(404).json({ detail: 'Habit not found' });

  const now = new Date().toISOString();
  db.habits[idx].deleted_at = now;
  db.habits[idx].updated_at = now;
  saveDb(db);
  return res.status(204).send();
});

app.post(['/api/habits/:id/check', '/habits/:id/check'], (req, res) => {
  const user = getUserFromHeader(req);
  const habitId = req.params.id;
  const { log_date, completed, note, updated_at } = req.body || {};
  const targetDate = log_date || toLocalISODate();
  const now = updated_at || new Date().toISOString();

  const existingIdx = db.habit_logs.findIndex(
    (l) => l.habit_id === habitId && l.log_date === targetDate && l.user_id === user.id
  );

  if (existingIdx >= 0) {
    const current = db.habit_logs[existingIdx];
    current.completed = completed !== undefined ? Boolean(completed) : !current.completed;
    if (note !== undefined) current.note = note;
    current.deleted_at = null;
    current.updated_at = now;
    saveDb(db);
    return res.json(current);
  }

  const newLog: HabitLogRecord = {
    id: crypto.randomUUID(),
    habit_id: habitId,
    user_id: user.id,
    log_date: targetDate,
    completed: completed !== undefined ? Boolean(completed) : true,
    note: note || '',
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  db.habit_logs.push(newLog);
  saveDb(db);
  return res.json(newLog);
});

// ---------------------------------------------------------------------------
// FOCUS SESSIONS ROUTES
// ---------------------------------------------------------------------------
app.post(['/api/sessions/start', '/sessions/start'], (req, res) => {
  const user = getUserFromHeader(req);
  const body = req.body || {};
  const now = body.started_at || new Date().toISOString();

  const session: FocusSessionRecord = {
    id: body.id || crypto.randomUUID(),
    user_id: user.id,
    habit_id: body.habit_id || null,
    planned_duration_sec: Number(body.planned_duration_sec || 1500),
    actual_duration_sec: 0,
    status: 'in_progress',
    started_at: now,
    ended_at: null,
    dnd_requested: body.dnd_requested !== undefined ? Boolean(body.dnd_requested) : true,
    dnd_applied_mode: body.dnd_applied_mode || 'native_os',
    previous_dnd_state: body.previous_dnd_state || 'INTERRUPTION_FILTER_ALL',
    updated_at: now,
    deleted_at: null,
  };
  db.focus_sessions.unshift(session);
  saveDb(db);
  return res.status(201).json(session);
});

app.post(['/api/sessions/end', '/sessions/end'], (req, res) => {
  const user = getUserFromHeader(req);
  const { session_id, status, actual_duration_sec, ended_at, auto_check_habit, log_date } =
    req.body || {};
  const now = ended_at || new Date().toISOString();

  const idx = db.focus_sessions.findIndex((s) => s.id === session_id && s.user_id === user.id);
  if (idx < 0) return res.status(404).json({ detail: 'Focus session not found' });

  const session = db.focus_sessions[idx];
  session.status = status || 'completed';
  session.actual_duration_sec = Number(actual_duration_sec ?? session.planned_duration_sec);
  session.ended_at = now;
  session.updated_at = now;

  if (session.status === 'completed' && auto_check_habit && session.habit_id) {
    const targetDate = log_date || toLocalISODate();
    const logIdx = db.habit_logs.findIndex(
      (l) => l.habit_id === session.habit_id && l.log_date === targetDate && l.user_id === user.id
    );
    if (logIdx >= 0) {
      db.habit_logs[logIdx].completed = true;
      db.habit_logs[logIdx].deleted_at = null;
      db.habit_logs[logIdx].updated_at = now;
    } else {
      db.habit_logs.push({
        id: crypto.randomUUID(),
        habit_id: session.habit_id,
        user_id: user.id,
        log_date: targetDate,
        completed: true,
        note: `Completed via ${Math.round(session.actual_duration_sec / 60)}m focus session`,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
    }
  }

  saveDb(db);
  return res.json(session);
});

app.get(['/api/sessions/stats', '/sessions/stats'], (req, res) => {
  const user = getUserFromHeader(req);
  const sessions = db.focus_sessions.filter((s) => s.user_id === user.id && !s.deleted_at);
  return res.json({ sessions });
});

app.get(['/api/stats/streaks', '/stats/streaks'], (req, res) => {
  const user = getUserFromHeader(req);
  const habits = db.habits.filter((h) => h.user_id === user.id && !h.deleted_at);
  const logs = db.habit_logs.filter((l) => l.user_id === user.id && !l.deleted_at);
  return res.json({ habits, habit_logs: logs });
});

// ---------------------------------------------------------------------------
// OFFLINE-FIRST BATCH SYNC (LAST-WRITE-WINS)
// ---------------------------------------------------------------------------
app.post(['/api/sync', '/sync'], (req, res) => {
  const user = getUserFromHeader(req);
  const { last_synced_at, changes = {} } = req.body || {};
  const incomingHabits: HabitRecord[] = changes.habits || [];
  const incomingLogs: HabitLogRecord[] = changes.habit_logs || [];
  const incomingSessions: FocusSessionRecord[] = changes.focus_sessions || [];

  const applied = { habits: 0, habit_logs: 0, focus_sessions: 0 };
  let conflictsResolved = 0;

  // 1. Habits LWW
  for (const item of incomingHabits) {
    const incomingTs = new Date(item.updated_at || Date.now()).getTime();
    const idx = db.habits.findIndex((h) => h.id === item.id && h.user_id === user.id);
    if (idx < 0) {
      db.habits.push({ ...item, user_id: user.id, deleted_at: item.deleted_at || null });
      applied.habits += 1;
    } else {
      const existingTs = new Date(db.habits[idx].updated_at || 0).getTime();
      if (incomingTs >= existingTs) {
        db.habits[idx] = { ...db.habits[idx], ...item, user_id: user.id };
        applied.habits += 1;
      } else {
        conflictsResolved += 1;
      }
    }
  }

  // 2. Habit Logs LWW (matched by (habit_id, log_date) or id)
  for (const logItem of incomingLogs) {
    const incomingTs = new Date(logItem.updated_at || Date.now()).getTime();
    const idx = db.habit_logs.findIndex(
      (l) =>
        l.user_id === user.id &&
        ((l.habit_id === logItem.habit_id && l.log_date === logItem.log_date) || l.id === logItem.id)
    );
    if (idx < 0) {
      db.habit_logs.push({ ...logItem, user_id: user.id, deleted_at: logItem.deleted_at || null });
      applied.habit_logs += 1;
    } else {
      const existingTs = new Date(db.habit_logs[idx].updated_at || 0).getTime();
      if (incomingTs >= existingTs) {
        db.habit_logs[idx] = { ...db.habit_logs[idx], ...logItem, user_id: user.id };
        applied.habit_logs += 1;
      } else {
        conflictsResolved += 1;
      }
    }
  }

  // 3. Focus Sessions LWW
  for (const sessItem of incomingSessions) {
    const incomingTs = new Date(sessItem.updated_at || Date.now()).getTime();
    const idx = db.focus_sessions.findIndex((s) => s.id === sessItem.id && s.user_id === user.id);
    if (idx < 0) {
      db.focus_sessions.unshift({
        ...sessItem,
        user_id: user.id,
        deleted_at: sessItem.deleted_at || null,
      });
      applied.focus_sessions += 1;
    } else {
      const existingTs = new Date(db.focus_sessions[idx].updated_at || 0).getTime();
      if (incomingTs >= existingTs) {
        db.focus_sessions[idx] = { ...db.focus_sessions[idx], ...sessItem, user_id: user.id };
        applied.focus_sessions += 1;
      } else {
        conflictsResolved += 1;
      }
    }
  }

  saveDb(db);

  const sinceMs = last_synced_at ? new Date(last_synced_at).getTime() : 0;
  const deltaHabits = db.habits.filter(
    (h) => h.user_id === user.id && new Date(h.updated_at).getTime() >= sinceMs
  );
  const deltaLogs = db.habit_logs.filter(
    (l) => l.user_id === user.id && new Date(l.updated_at).getTime() >= sinceMs
  );
  const deltaSessions = db.focus_sessions.filter(
    (s) => s.user_id === user.id && new Date(s.updated_at).getTime() >= sinceMs
  );

  return res.json({
    server_time: new Date().toISOString(),
    applied_counts: applied,
    conflicts_resolved: conflictsResolved,
    changes: {
      habits: deltaHabits,
      habit_logs: deltaLogs,
      focus_sessions: deltaSessions,
    },
  });
});

// Reset / Reseed Demo Endpoint
app.post('/api/seed/reset', (_req, res) => {
  db = createSeedDatabase();
  saveDb(db);
  return res.json({
    ok: true,
    habits: db.habits,
    habit_logs: db.habit_logs,
    focus_sessions: db.focus_sessions,
  });
});

// Monorepo Deliverables Inspector Endpoint (serves real workspace source files for live inspection)
const MONOREPO_FILES = [
  { path: 'backend/main.py', package: 'backend', label: 'FastAPI Server & LWW Sync' },
  { path: 'backend/models.py', package: 'backend', label: 'SQLAlchemy ORM Schema' },
  { path: 'backend/schemas.py', package: 'backend', label: 'Pydantic v2 Models' },
  { path: 'backend/auth.py', package: 'backend', label: 'JWT & Password Auth' },
  { path: 'backend/database.py', package: 'backend', label: 'Postgres / SQLite Engine' },
  { path: 'backend/seed.py', package: 'backend', label: 'Database Seed Script' },
  { path: 'backend/requirements.txt', package: 'backend', label: 'Python Dependencies' },
  { path: 'shared/models.js', package: 'shared', label: 'Shared Models & Date Utils' },
  { path: 'shared/stats.js', package: 'shared', label: 'Shared Streak & Chart Math' },
  { path: 'shared/apiClient.js', package: 'shared', label: 'Shared REST Client' },
  { path: 'shared/syncEngine.js', package: 'shared', label: 'Offline LWW Sync Engine' },
  { path: 'mobile/App.js', package: 'mobile', label: 'React Native App (Android/iOS)' },
  { path: 'mobile/src/dnd/DndManager.js', package: 'mobile', label: 'Mobile DND Controller' },
  {
    path: 'mobile/android/app/src/main/java/com/quietpulse/dnd/DndModule.java',
    package: 'mobile',
    label: 'Android Native DndModule.java',
  },
  {
    path: 'mobile/ios/QuietPulseFocusFilter/QuietPulseFocusExtension.swift',
    package: 'mobile',
    label: 'iOS Focus Filter AppIntent',
  },
  { path: 'mobile/package.json', package: 'mobile', label: 'Mobile package.json' },
  { path: 'desktop/main.js', package: 'desktop', label: 'Electron Main Process' },
  { path: 'desktop/preload.js', package: 'desktop', label: 'Electron Preload Bridge' },
  {
    path: 'desktop/scripts/windows-dnd-helper.ps1',
    package: 'desktop',
    label: 'Windows PowerShell DND Helper',
  },
  {
    path: 'desktop/scripts/windows_dnd_helper.py',
    package: 'desktop',
    label: 'Windows Python WNF/Reg Helper',
  },
  { path: 'desktop/package.json', package: 'desktop', label: 'Desktop & NSIS .exe Config' },
  { path: 'twa-manifest.json', package: 'mobile', label: 'Chrome TWA Android APK Manifest' },
  {
    path: 'public/.well-known/assetlinks.json',
    package: 'mobile',
    label: 'Android Digital Asset Links (TWA)',
  },
  {
    path: 'src/components/ZenFocusScene3D.tsx',
    package: 'shared',
    label: 'Three.js 3D Zen Chronometer Scene',
  },
  { path: 'README.md', package: 'docs', label: 'Setup & Build Guide' },
];

app.get('/api/monorepo/files', (_req, res) => {
  const loaded = MONOREPO_FILES.map((item) => {
    const abs = path.resolve(process.cwd(), item.path);
    let content = '';
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      content = '// File not found';
    }
    return { ...item, content };
  });
  return res.json({ files: loaded });
});

// Direct Download 1: Self-Contained Android APK Builder Script (Bubblewrap TWA + React Native DndModule)
app.get('/api/apk/download-apk-builder', (req, res) => {
  const hostUrl = `${req.protocol}://${req.get('host')}`;
  let twaManifest = '{}';
  let dndModuleJava = '';
  try {
    twaManifest = fs.readFileSync(path.resolve(process.cwd(), 'twa-manifest.json'), 'utf-8');
    dndModuleJava = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'mobile/android/app/src/main/java/com/quietpulse/dnd/DndModule.java'
      ),
      'utf-8'
    );
  } catch {
    // fallback if missing
  }

  const scriptContent = `#!/usr/bin/env bash
# ==============================================================================
# QuietPulse Android APK Automated Builder (Chrome TWA WebAPK + Native DndModule)
# Generated from Live App: ${hostUrl}
# ==============================================================================
set -e

echo "Creating QuietPulse Android APK build workspace..."
mkdir -p quietpulse-android-apk
cd quietpulse-android-apk

cat << 'EOF_TWA' > twa-manifest.json
${twaManifest}
EOF_TWA

mkdir -p native-dnd-module
cat << 'EOF_JAVA' > native-dnd-module/DndModule.java
${dndModuleJava}
EOF_JAVA

echo ""
echo "=============================================================================="
echo "QuietPulse TWA Manifest & Native Android DND Module extracted!"
echo "To compile the installable Android .APK (app-release-signed.apk) via Chrome TWA:"
echo "  1. Ensure Node.js 18+, JDK 17, and Android SDK are installed."
echo "  2. Run: npx @bubblewrap/cli build"
echo "  3. Install to your connected Android phone: adb install app-release-signed.apk"
echo "=============================================================================="
`;

  res.setHeader('Content-Type', 'application/x-sh; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="build-quietpulse-android-apk.sh"');
  return res.send(scriptContent);
});

// Direct Download 2: Portable Standalone WebAPK Launcher HTML File
app.get('/api/apk/download-webapk-html', (req, res) => {
  const hostUrl =
    process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const htmlContent = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0B0F17" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>QuietPulse — Standalone Android APK Launcher</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0F17;
      color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    .card {
      max-width: 460px;
      width: 100%;
      background: #111827;
      border: 1px solid #1E293B;
      border-radius: 16px;
      padding: 32px 24px;
    }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { font-size: 13px; color: #94A3B8; line-height: 1.6; margin-bottom: 20px; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      margin-bottom: 12px;
    }
    .btn-primary { background: #10B981; color: #ffffff; }
    .btn-secondary { background: #4F46E5; color: #ffffff; }
    code { font-family: monospace; color: #34D399; }
  </style>
</head>
<body>
  <div class="card">
    <h1>QuietPulse Android WebAPK</h1>
    <p>Tap below to launch QuietPulse in a top-level Chrome window. In Chrome (Android or Desktop), tap the <strong>Install App</strong> icon in the address bar or menu (⋮ &rarr; <strong>Install app</strong>) to install the standalone APK.</p>
    <a class="btn btn-primary" href="${hostUrl}" target="_blank" rel="noopener noreferrer">
      Launch QuietPulse Standalone App
    </a>
    <a class="btn btn-secondary" href="intent://${hostUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end">
      Open Directly in Android Chrome (Intent)
    </a>
    <p style="margin-top: 12px; margin-bottom: 0;">Live App URL: <code>${hostUrl}</code></p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="QuietPulse-WebAPK-Launcher.html"');
  return res.send(htmlContent);
});

async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QuietPulse Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
