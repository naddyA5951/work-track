import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Check,
  Plus,
  Play,
  Square,
  Shield,
  ShieldCheck,
  Wifi,
  WifiOff,
  RefreshCw,
  Sun,
  Moon,
  Trash2,
  Edit3,
  Clock,
  Flame,
  BarChart3,
  FolderGit2,
  Copy,
  CheckCheck,
  Smartphone,
  User,
  Maximize2,
  Minimize2,
  Code2,
  BookOpen,
  Activity,
  Zap,
  Coffee,
  Brain,
  Dumbbell,
  PenTool,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Box,
  Download,
  ExternalLink,
} from 'lucide-react';

import {
  HABIT_COLORS,
  HABIT_ICONS,
  FOCUS_PRESETS_MINUTES,
  WEEKDAYS,
  createHabitModel,
  createHabitLogModel,
  createFocusSessionModel,
  toLocalISODate,
  parseLocalISODate,
  computeHabitStats,
  buildCompletionSeries,
  computeFocusStats,
  QuietPulseApiClient,
  OfflineSyncEngine,
} from '../shared/index.js';

import {
  ZenFocusScene3D,
  CameraPresetId,
  FinishPresetId,
} from './components/ZenFocusScene3D';
import { usePWAInstall } from './hooks/usePWAInstall';

interface HabitItem {
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
  _dirty?: boolean;
}

interface HabitLogItem {
  id: string;
  habit_id: string;
  user_id: string;
  log_date: string;
  completed: boolean;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  _dirty?: boolean;
}

interface FocusSessionItem {
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
  _dirty?: boolean;
}

interface MonorepoFileItem {
  path: string;
  package: string;
  label: string;
  content: string;
}

type NavTab = 'dashboard' | 'focus' | 'sanctuary' | 'analytics' | 'apk' | 'codebase';
type PlatformTarget = 'android' | 'ios' | 'windows';

const browserStorageAdapter = {
  getItem: async (key: string) => window.localStorage.getItem(key),
  setItem: async (key: string, val: string) => window.localStorage.setItem(key, val),
};

export default function App() {
  // Theme & Tab Navigation
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');

  // 3D Scene & Collapsible Bottom Dock State
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('overview');
  const [finishPreset, setFinishPreset] = useState<FinishPresetId>('emerald_obsidian');
  const [explodedAmount, setExplodedAmount] = useState<number>(0);
  const [kineticSpeed, setKineticSpeed] = useState<number>(1.0);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);

  // PWA & Chrome Android APK Hook
  const {
    isInstallable,
    isInstalled,
    isIOS,
    install: triggerPwaInstall,
    getChromeAndroidIntentUrl,
  } = usePWAInstall();
  const [apkInstallFeedback, setApkInstallFeedback] = useState<string | null>(null);

  // Auth & User State
  const [jwtToken, setJwtToken] = useState<string>(() => {
    return window.localStorage.getItem('qp_jwt_token') || 'qp_jwt_user-demo-alex-001';
  });
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    email: string;
    display_name: string;
  }>({
    id: 'user-demo-alex-001',
    email: 'alex@quietpulse.app',
    display_name: 'Alex Rivera',
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('alex@quietpulse.app');
  const [authPassword, setAuthPassword] = useState('password123');
  const [authDisplayName, setAuthDisplayName] = useState('Alex Rivera');
  const [authError, setAuthError] = useState<string | null>(null);

  // Core Domain State (Offline-first)
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLogItem[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSessionItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(toLocalISODate());
  const [justCheckedHabitId, setJustCheckedHabitId] = useState<string | null>(null);

  // Sync & Connectivity State
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<{
    conflictsResolved: number;
    appliedCount: number;
    timestamp: string;
  } | null>(null);

  // Habit Editor Modal State
  const [showHabitModal, setShowHabitModal] = useState<boolean>(false);
  const [editingHabit, setEditingHabit] = useState<HabitItem | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitDesc, setHabitDesc] = useState('');
  const [habitIcon, setHabitIcon] = useState('code');
  const [habitColor, setHabitColor] = useState('#10B981');
  const [habitFreqType, setHabitFreqType] = useState<'daily' | 'weekdays' | 'weekly_count'>('daily');
  const [habitTargetDays, setHabitTargetDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [habitWeeklyCount, setHabitWeeklyCount] = useState<number>(5);
  const [habitDefaultFocusMin, setHabitDefaultFocusMin] = useState<number>(25);

  // Focus Session & Automatic DND State
  const [focusDurationMin, setFocusDurationMin] = useState<number>(25);
  const [customDurationInput, setCustomDurationInput] = useState<string>('40');
  const [linkedHabitId, setLinkedHabitId] = useState<string>('habit-deep-code-001');
  const [autoCheckOnComplete, setAutoCheckOnComplete] = useState<boolean>(true);
  const [activeSession, setActiveSession] = useState<FocusSessionItem | null>(null);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);
  const [pausedAccumulatedSec, setPausedAccumulatedSec] = useState<number>(0);
  const [pauseStartedAtMs, setPauseStartedAtMs] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(25 * 60);

  // Platform DND State Machine
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformTarget>('android');
  const [osDndPermissionGranted, setOsDndPermissionGranted] = useState<boolean>(true);
  const [priorOsDndState, setPriorOsDndState] = useState<string>('INTERRUPTION_FILTER_ALL');
  const [liveDndState, setLiveDndState] = useState<{
    active: boolean;
    mode: 'idle' | 'native_os' | 'shortcut_bridge' | 'in_app_fullscreen';
    statusLabel: string;
    restoredBanner: string | null;
  }>({
    active: false,
    mode: 'idle',
    statusLabel: 'Standard Notifications Active',
    restoredBanner: null,
  });
  const [fullscreenFocusLockout, setFullscreenFocusLockout] = useState<boolean>(false);
  const [showDndGuideModal, setShowDndGuideModal] = useState<boolean>(false);

  // Analytics & Codebase Explorer State
  const [chartWindow, setChartWindow] = useState<7 | 30>(7);
  const [monorepoFiles, setMonorepoFiles] = useState<MonorepoFileItem[]>([]);
  const [selectedPackageFilter, setSelectedPackageFilter] = useState<string>('all');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('backend/main.py');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Keyboard shortcut 'H' to collapse/expand bottom 3D control dock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Shared API Client & Offline Sync Engine instances
  const apiClient = useMemo(
    () =>
      new QuietPulseApiClient({
        baseUrl: '/api',
        getToken: () => jwtToken,
      }),
    [jwtToken]
  );

  const syncEngine = useMemo(
    () =>
      new OfflineSyncEngine({
        apiClient,
        storage: browserStorageAdapter,
        storageKey: 'quietpulse_offline_state_v1',
      }),
    [apiClient]
  );

  const persistLocalState = useCallback(
    async (
      nextHabits: HabitItem[],
      nextLogs: HabitLogItem[],
      nextSessions: FocusSessionItem[],
      syncedAt: string | null = lastSyncedAt
    ) => {
      await syncEngine.saveState({
        habits: nextHabits,
        habitLogs: nextLogs,
        focusSessions: nextSessions,
        lastSyncedAt: syncedAt,
      });
    },
    [syncEngine, lastSyncedAt]
  );

  // Initial Load: Load local storage first, then sync with backend
  useEffect(() => {
    let mounted = true;
    (async () => {
      const local = await syncEngine.loadState();
      if (local && Array.isArray(local.habits) && local.habits.length > 0 && mounted) {
        setHabits(local.habits);
        setHabitLogs(local.habitLogs || []);
        setFocusSessions(local.focusSessions || []);
        setLastSyncedAt(local.lastSyncedAt || null);
      }

      try {
        const synced = await syncEngine.synchronize({
          habits: (local && local.habits) || [],
          habitLogs: (local && local.habitLogs) || [],
          focusSessions: (local && local.focusSessions) || [],
          lastSyncedAt: null,
        });
        if (mounted) {
          setHabits(synced.habits);
          setHabitLogs(synced.habitLogs);
          setFocusSessions(synced.focusSessions);
          setLastSyncedAt(synced.lastSyncedAt);
        }
      } catch {
        // Offline fallback works seamlessly
      }

      try {
        const res = await fetch('/api/monorepo/files');
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.files) {
            setMonorepoFiles(data.files);
          }
        }
      } catch {
        // Ignore if offline
      }
    })();

    return () => {
      mounted = false;
    };
  }, [syncEngine]);

  // Background-resilient monotonic countdown timer
  useEffect(() => {
    if (!activeSession || isTimerPaused) return undefined;

    const tick = () => {
      const startedMs = new Date(activeSession.started_at).getTime();
      const nowMs = Date.now();
      const totalElapsedSec = Math.floor((nowMs - startedMs) / 1000) - pausedAccumulatedSec;
      const left = Math.max(0, activeSession.planned_duration_sec - totalElapsedSec);
      setRemainingSeconds(left);

      if (left <= 0) {
        handleEndFocusSession('completed');
      }
    };

    tick();
    const interval = window.setInterval(tick, 500);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, isTimerPaused, pausedAccumulatedSec]);

  // Trigger batch sync with backend
  const handleBatchSync = useCallback(
    async (
      overrideHabits?: HabitItem[],
      overrideLogs?: HabitLogItem[],
      overrideSessions?: FocusSessionItem[]
    ) => {
      if (isOfflineSimulated) return;
      setIsSyncing(true);
      try {
        const currentH = overrideHabits ?? habits;
        const currentL = overrideLogs ?? habitLogs;
        const currentS = overrideSessions ?? focusSessions;

        const dirtyCount =
          currentH.filter((h) => h._dirty).length +
          currentL.filter((l) => l._dirty).length +
          currentS.filter((s) => s._dirty).length;

        const synced = await syncEngine.synchronize({
          habits: currentH,
          habitLogs: currentL,
          focusSessions: currentS,
          lastSyncedAt,
        });

        setHabits(synced.habits);
        setHabitLogs(synced.habitLogs);
        setFocusSessions(synced.focusSessions);
        setLastSyncedAt(synced.lastSyncedAt);
        setLastSyncSummary({
          conflictsResolved: synced.lastSyncStats?.conflictsResolved || 0,
          appliedCount: dirtyCount,
          timestamp: new Date().toLocaleTimeString(),
        });
      } catch {
        // Remains queued in local storage
      } finally {
        setIsSyncing(false);
      }
    },
    [isOfflineSimulated, habits, habitLogs, focusSessions, lastSyncedAt, syncEngine]
  );

  const handleToggleOfflineMode = async () => {
    const nextOffline = !isOfflineSimulated;
    setIsOfflineSimulated(nextOffline);
    if (!nextOffline) {
      await handleBatchSync();
    }
  };

  // One-tap habit check-off handler
  const handleToggleHabitCheck = async (habitId: string, targetDate = selectedDate) => {
    setJustCheckedHabitId(habitId);
    window.setTimeout(() => setJustCheckedHabitId(null), 350);

    const nowIso = new Date().toISOString();
    const existingIdx = habitLogs.findIndex(
      (l) => l.habit_id === habitId && l.log_date === targetDate && !l.deleted_at
    );

    let nextLogs: HabitLogItem[];
    if (existingIdx >= 0) {
      nextLogs = habitLogs.map((item, idx) =>
        idx === existingIdx
          ? {
              ...item,
              completed: !item.completed,
              updated_at: nowIso,
              _dirty: true,
            }
          : item
      );
    } else {
      const newLog = {
        ...(createHabitLogModel({
          habit_id: habitId,
          user_id: currentUser.id,
          log_date: targetDate,
          completed: true,
          updated_at: nowIso,
        }) as HabitLogItem),
        _dirty: true,
      };
      nextLogs = [...habitLogs, newLog];
    }

    setHabitLogs(nextLogs);
    await persistLocalState(habits, nextLogs, focusSessions);

    if (!isOfflineSimulated) {
      await handleBatchSync(habits, nextLogs, focusSessions);
    }
  };

  // Open Create or Edit Habit Modal
  const openCreateHabitModal = () => {
    setEditingHabit(null);
    setHabitName('');
    setHabitDesc('');
    setHabitIcon('code');
    setHabitColor('#10B981');
    setHabitFreqType('daily');
    setHabitTargetDays([0, 1, 2, 3, 4, 5, 6]);
    setHabitWeeklyCount(5);
    setHabitDefaultFocusMin(25);
    setShowHabitModal(true);
  };

  const openEditHabitModal = (habit: HabitItem) => {
    setEditingHabit(habit);
    setHabitName(habit.name);
    setHabitDesc(habit.description || '');
    setHabitIcon(habit.icon || 'code');
    setHabitColor(habit.color || '#10B981');
    setHabitFreqType(habit.frequency_type || 'daily');
    setHabitTargetDays(
      Array.isArray(habit.target_days) ? habit.target_days : [0, 1, 2, 3, 4, 5, 6]
    );
    setHabitWeeklyCount(habit.weekly_target_count || 5);
    setHabitDefaultFocusMin(habit.default_focus_minutes || 25);
    setShowHabitModal(true);
  };

  const handleSaveHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!habitName.trim()) return;

    const nowIso = new Date().toISOString();
    const resolvedDays =
      habitFreqType === 'daily'
        ? [0, 1, 2, 3, 4, 5, 6]
        : habitTargetDays.length > 0
          ? habitTargetDays
          : [0, 1, 2, 3, 4];

    let nextHabits: HabitItem[];
    if (editingHabit) {
      nextHabits = habits.map((h) =>
        h.id === editingHabit.id
          ? {
              ...h,
              name: habitName.trim(),
              description: habitDesc.trim(),
              icon: habitIcon,
              color: habitColor,
              frequency_type: habitFreqType,
              target_days: resolvedDays,
              weekly_target_count: habitWeeklyCount,
              default_focus_minutes: habitDefaultFocusMin,
              updated_at: nowIso,
              _dirty: true,
            }
          : h
      );
    } else {
      const created = {
        ...(createHabitModel({
          user_id: currentUser.id,
          name: habitName.trim(),
          description: habitDesc.trim(),
          icon: habitIcon,
          color: habitColor,
          frequency_type: habitFreqType,
          target_days: resolvedDays,
          weekly_target_count: habitWeeklyCount,
          default_focus_minutes: habitDefaultFocusMin,
          created_at: nowIso,
          updated_at: nowIso,
        }) as HabitItem),
        _dirty: true,
      };
      nextHabits = [...habits, created];
    }

    setHabits(nextHabits);
    setShowHabitModal(false);
    await persistLocalState(nextHabits, habitLogs, focusSessions);

    if (!isOfflineSimulated) {
      await handleBatchSync(nextHabits, habitLogs, focusSessions);
    }
  };

  const handleDeleteHabit = async (habitId: string) => {
    const nowIso = new Date().toISOString();
    const nextHabits = habits.map((h) =>
      h.id === habitId ? { ...h, deleted_at: nowIso, updated_at: nowIso, _dirty: true } : h
    );
    setHabits(nextHabits);
    await persistLocalState(nextHabits, habitLogs, focusSessions);

    if (!isOfflineSimulated) {
      await handleBatchSync(nextHabits, habitLogs, focusSessions);
    }
  };

  // Start a Focus Session & Automatically Enable Platform DND
  const handleStartFocusSession = async (overrideHabit?: HabitItem) => {
    const durationMin = overrideHabit ? overrideHabit.default_focus_minutes : focusDurationMin;
    const targetHabitId = overrideHabit ? overrideHabit.id : linkedHabitId || null;

    if (overrideHabit) {
      setFocusDurationMin(overrideHabit.default_focus_minutes);
      setLinkedHabitId(overrideHabit.id);
      setActiveTab('focus');
    }

    let appliedMode: 'native_os' | 'shortcut_bridge' | 'in_app_fullscreen' = 'native_os';
    let capturedPreviousState = priorOsDndState;
    let statusLabel = '';

    const winWithElectron = window as unknown as {
      electronDnd?: {
        enableDnd: (opts: { requestFullscreenFallback: boolean }) => Promise<{
          appliedMode: 'native_os' | 'in_app_fullscreen';
          previousState: string;
          fullscreenFallback: boolean;
        }>;
      };
    };

    if (winWithElectron.electronDnd) {
      const electronRes = await winWithElectron.electronDnd.enableDnd({
        requestFullscreenFallback: !osDndPermissionGranted,
      });
      appliedMode = electronRes.appliedMode;
      capturedPreviousState = electronRes.previousState;
      statusLabel =
        appliedMode === 'native_os'
          ? 'Windows Toast Notifications Muted (PowerShell Registry Helper)'
          : 'In-App Full-Screen Focus Lockout Active';
      if (electronRes.fullscreenFallback) {
        setFullscreenFocusLockout(true);
      }
    } else if (!osDndPermissionGranted) {
      appliedMode = 'in_app_fullscreen';
      capturedPreviousState =
        selectedPlatform === 'android'
          ? 'INTERRUPTION_FILTER_ALL'
          : selectedPlatform === 'ios'
            ? 'IOS_FOCUS_OFF'
            : 'WINDOWS_TOASTS_ENABLED';
      statusLabel = 'In-App Full-Screen Focus Mode (OS DND Fallback)';
      setFullscreenFocusLockout(true);
    } else if (selectedPlatform === 'android') {
      appliedMode = 'native_os';
      capturedPreviousState = priorOsDndState || 'INTERRUPTION_FILTER_ALL';
      statusLabel = 'Android NotificationManager: INTERRUPTION_FILTER_PRIORITY';
    } else if (selectedPlatform === 'ios') {
      appliedMode = 'shortcut_bridge';
      capturedPreviousState = 'IOS_FOCUS_OFF';
      statusLabel = 'iOS Shortcuts Automation ("QuietPulse DND") + Focus Filter Active';
    } else {
      appliedMode = 'native_os';
      capturedPreviousState = 'WINDOWS_TOASTS_ENABLED';
      statusLabel = 'Windows Focus Assist Helper Active + App Notifications Suppressed';
    }

    setLiveDndState({
      active: true,
      mode: appliedMode,
      statusLabel,
      restoredBanner: null,
    });

    const newSession = {
      ...(createFocusSessionModel({
        user_id: currentUser.id,
        habit_id: targetHabitId,
        planned_duration_sec: durationMin * 60,
        actual_duration_sec: 0,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        dnd_requested: true,
        dnd_applied_mode: appliedMode,
        previous_dnd_state: capturedPreviousState,
      }) as FocusSessionItem),
      _dirty: true,
    };

    setActiveSession(newSession);
    setIsTimerPaused(false);
    setPausedAccumulatedSec(0);
    setPauseStartedAtMs(null);
    setRemainingSeconds(durationMin * 60);
  };

  const handleTogglePauseTimer = () => {
    if (!activeSession) return;
    if (!isTimerPaused) {
      setIsTimerPaused(true);
      setPauseStartedAtMs(Date.now());
    } else {
      if (pauseStartedAtMs) {
        const deltaSec = Math.floor((Date.now() - pauseStartedAtMs) / 1000);
        setPausedAccumulatedSec((prev) => prev + deltaSec);
      }
      setPauseStartedAtMs(null);
      setIsTimerPaused(false);
    }
  };

  const handleEndFocusSession = async (finalStatus: 'completed' | 'cancelled') => {
    if (!activeSession) return;

    const winWithElectron = window as unknown as {
      electronDnd?: { restoreDnd: () => Promise<void> };
    };
    if (winWithElectron.electronDnd) {
      await winWithElectron.electronDnd.restoreDnd();
    }

    const nowIso = new Date().toISOString();
    const startedMs = new Date(activeSession.started_at).getTime();
    const rawElapsedSec = Math.max(
      60,
      Math.floor((Date.now() - startedMs) / 1000) - pausedAccumulatedSec
    );
    const actualSec =
      finalStatus === 'completed'
        ? activeSession.planned_duration_sec
        : Math.min(activeSession.planned_duration_sec, rawElapsedSec);

    const completedSession: FocusSessionItem = {
      ...activeSession,
      status: finalStatus,
      actual_duration_sec: actualSec,
      ended_at: nowIso,
      updated_at: nowIso,
      _dirty: true,
    };

    const nextSessions = [
      completedSession,
      ...focusSessions.filter((s) => s.id !== completedSession.id),
    ];

    const restoredStateName = activeSession.previous_dnd_state || 'INTERRUPTION_FILTER_ALL';
    setLiveDndState({
      active: false,
      mode: 'idle',
      statusLabel: `Restored Previous State (${restoredStateName})`,
      restoredBanner: `Session ${finalStatus}: System DND automatically restored to ${restoredStateName}.`,
    });
    setFullscreenFocusLockout(false);
    setActiveSession(null);
    setIsTimerPaused(false);
    setFocusSessions(nextSessions);

    let nextLogs = habitLogs;
    if (finalStatus === 'completed' && autoCheckOnComplete && activeSession.habit_id) {
      const todayIso = toLocalISODate();
      const existingIdx = habitLogs.findIndex(
        (l) =>
          l.habit_id === activeSession.habit_id && l.log_date === todayIso && !l.deleted_at
      );
      if (existingIdx >= 0) {
        nextLogs = habitLogs.map((l, idx) =>
          idx === existingIdx
            ? { ...l, completed: true, updated_at: nowIso, _dirty: true }
            : l
        );
      } else {
        nextLogs = [
          ...habitLogs,
          {
            ...(createHabitLogModel({
              habit_id: activeSession.habit_id,
              user_id: currentUser.id,
              log_date: todayIso,
              completed: true,
              note: `Completed via ${Math.round(actualSec / 60)}m focus session`,
              updated_at: nowIso,
            }) as HabitLogItem),
            _dirty: true,
          },
        ];
      }
      setHabitLogs(nextLogs);
    }

    await persistLocalState(habits, nextLogs, nextSessions);
    if (!isOfflineSimulated) {
      await handleBatchSync(habits, nextLogs, nextSessions);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res =
        authMode === 'login'
          ? await apiClient.login({ email: authEmail, password: authPassword })
          : await apiClient.register({
              email: authEmail,
              password: authPassword,
              display_name: authDisplayName,
            });
      if (res && res.access_token) {
        setJwtToken(res.access_token);
        window.localStorage.setItem('qp_jwt_token', res.access_token);
        setCurrentUser(res.user);
        setShowAuthModal(false);
        await handleBatchSync();
      }
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleSimulateConflictAndSync = async () => {
    if (visibleHabits.length === 0) return;
    const target = visibleHabits[0];
    const newerIso = new Date(Date.now() + 1000).toISOString();
    const updatedHabits = habits.map((h) =>
      h.id === target.id
        ? {
            ...h,
            description: `${h.description.split(' [Synced')[0]} [Synced LWW @ ${new Date().toLocaleTimeString()}]`,
            updated_at: newerIso,
            _dirty: true,
          }
        : h
    );
    setHabits(updatedHabits);
    await persistLocalState(updatedHabits, habitLogs, focusSessions);
    await handleBatchSync(updatedHabits, habitLogs, focusSessions);
  };

  // Trigger Chrome Android WebAPK installation or open Android APK tab
  const handleInstallOrLaunchApk = async () => {
    if (isInstallable) {
      const accepted = await triggerPwaInstall();
      if (accepted) {
        setApkInstallFeedback('QuietPulse WebAPK installed to your device home screen.');
      }
    } else {
      setActiveTab('apk');
    }
  };

  const visibleHabits = useMemo(
    () => habits.filter((h) => !h.deleted_at && !h.archived),
    [habits]
  );

  const habitStatsMap = useMemo(() => {
    const map: Record<
      string,
      {
        currentStreak: number;
        longestStreak: number;
        completionRate7d: number;
        completionRate30d: number;
        completedToday: boolean;
      }
    > = {};
    for (const h of visibleHabits) {
      map[h.id] = computeHabitStats(h, habitLogs, selectedDate);
    }
    return map;
  }, [visibleHabits, habitLogs, selectedDate]);

  const dashboardSummary = useMemo(() => {
    let completedToday = 0;
    let bestCurrentStreak = 0;
    let bestEverStreak = 0;

    for (const h of visibleHabits) {
      const st = habitStatsMap[h.id];
      if (!st) continue;
      if (st.completedToday) completedToday += 1;
      if (st.currentStreak > bestCurrentStreak) bestCurrentStreak = st.currentStreak;
      if (st.longestStreak > bestEverStreak) bestEverStreak = st.longestStreak;
    }

    const totalCount = visibleHabits.length;
    const completionPct = totalCount > 0 ? Math.round((completedToday / totalCount) * 100) : 0;
    return {
      completedToday,
      totalCount,
      completionPct,
      bestCurrentStreak,
      bestEverStreak,
    };
  }, [visibleHabits, habitStatsMap]);

  const completionSeries = useMemo(
    () => buildCompletionSeries(visibleHabits, habitLogs, chartWindow, selectedDate),
    [visibleHabits, habitLogs, chartWindow, selectedDate]
  );

  const focusStats = useMemo(
    () => computeFocusStats(focusSessions, visibleHabits, selectedDate),
    [focusSessions, visibleHabits, selectedDate]
  );

  const dirtyOutboxCount = useMemo(() => {
    return (
      habits.filter((h) => h._dirty).length +
      habitLogs.filter((l) => l._dirty).length +
      focusSessions.filter((s) => s._dirty).length
    );
  }, [habits, habitLogs, focusSessions]);

  const recentDates = useMemo(() => {
    const today = new Date();
    const list = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = toLocalISODate(d);
      list.push({
        iso,
        dayShort: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.getDate(),
        isToday: i === 0,
      });
    }
    return list;
  }, []);

  const filteredMonorepoFiles = useMemo(() => {
    if (selectedPackageFilter === 'all') return monorepoFiles;
    return monorepoFiles.filter((f) => f.package === selectedPackageFilter);
  }, [monorepoFiles, selectedPackageFilter]);

  const currentInspectedFile = useMemo(() => {
    return (
      monorepoFiles.find((f) => f.path === selectedFilePath) ||
      filteredMonorepoFiles[0] ||
      null
    );
  }, [monorepoFiles, selectedFilePath, filteredMonorepoFiles]);

  const renderHabitIcon = (iconName: string, colorHex: string) => {
    const props = { className: 'w-5 h-5', style: { color: colorHex } };
    switch (iconName) {
      case 'code':
        return <Code2 {...props} />;
      case 'book-open':
        return <BookOpen {...props} />;
      case 'activity':
        return <Activity {...props} />;
      case 'moon':
        return <Moon {...props} />;
      case 'zap':
        return <Zap {...props} />;
      case 'flame':
        return <Flame {...props} />;
      case 'coffee':
        return <Coffee {...props} />;
      case 'brain':
        return <Brain {...props} />;
      case 'dumbbell':
        return <Dumbbell {...props} />;
      default:
        return <PenTool {...props} />;
    }
  };

  const formatScheduleText = (habit: HabitItem) => {
    if (habit.frequency_type === 'daily') return 'Every day';
    if (habit.frequency_type === 'weekly_count') {
      return `${habit.weekly_target_count}x per week`;
    }
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = (habit.target_days || []).map((idx) => labels[idx]).filter(Boolean);
    if (days.length === 5 && !habit.target_days.includes(5) && !habit.target_days.includes(6)) {
      return 'Weekdays (Mon–Fri)';
    }
    return days.join(', ');
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const timerProgressPct = activeSession
    ? Math.min(
        100,
        Math.max(
          0,
          ((activeSession.planned_duration_sec - remainingSeconds) /
            activeSession.planned_duration_sec) *
            100
        )
      )
    : 0;

  // Solid / high-opacity RGBA surface classes (Zero backdrop-filter over WebGL per threejs skill)
  const surfaceCardClass = darkMode
    ? 'bg-[#0F1624]/92 border-slate-800 text-slate-100'
    : 'bg-white/95 border-slate-200 text-slate-900';

  const TABS_LIST: { id: NavTab; label: string }[] = [
    { id: 'dashboard', label: 'Today Habits' },
    { id: 'focus', label: 'Focus & DND' },
    { id: 'sanctuary', label: '3D Sanctuary' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'apk', label: 'Android APK' },
    { id: 'codebase', label: 'Sync & Codebase' },
  ];

  return (
    <div
      className={
        darkMode
          ? 'min-h-screen text-slate-100 flex flex-col relative selection:bg-indigo-500 selection:text-white'
          : 'min-h-screen text-slate-900 flex flex-col relative selection:bg-indigo-600 selection:text-white'
      }
    >
      {/* PERSISTENT FULL-BLEED THREE.JS 3D BACKGROUND SCENE */}
      <ZenFocusScene3D
        darkMode={darkMode}
        isFocusActive={Boolean(activeSession)}
        completionPct={dashboardSummary.completionPct}
        cameraPreset={cameraPreset}
        finishPreset={finishPreset}
        explodedAmount={explodedAmount}
        kineticSpeed={kineticSpeed}
      />

      {/* STRICT 3-ZONE TOP BAR CONTRACT (Solid/RGBA surface without backdrop-filter over WebGL) */}
      <header
        className={`relative z-20 flex items-center justify-between gap-8 px-6 lg:px-10 py-4 border-b ${
          darkMode ? 'bg-[#0B0F17]/95 border-slate-800' : 'bg-white/95 border-slate-200'
        }`}
      >
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-lg font-bold tracking-tight font-display whitespace-nowrap shrink-0"
        >
          QuietPulse
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {[
            { id: 'dashboard', label: 'Today' },
            { id: 'focus', label: 'Focus DND' },
            { id: 'sanctuary', label: '3D Sanctuary' },
            { id: 'analytics', label: 'Analytics' },
            { id: 'apk', label: 'Android APK' },
          ].map((item) => {
            const isCurrent = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as NavTab)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                  isCurrent
                    ? 'border-emerald-500 text-emerald-500 font-semibold'
                    : darkMode
                      ? 'border-transparent text-slate-400 hover:text-slate-100'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action (Install / Launch Chrome Android APK) */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleInstallOrLaunchApk}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isInstalled
              ? 'APK Installed'
              : isInstallable
                ? 'Install Android APK'
                : 'Launch Android APK'}
          </button>
        </div>
      </header>

      {/* DEDICATED WORKSPACE TABS & CONTEXT BAR */}
      <div
        className={`relative z-20 border-b px-6 lg:px-10 py-2.5 flex flex-wrap items-center justify-between gap-4 ${
          darkMode ? 'bg-[#111827]/95 border-slate-800' : 'bg-slate-100/95 border-slate-200'
        }`}
      >
        {/* Interactive Segmented Tab Bar */}
        <div
          className={`flex items-center gap-1 p-1 rounded-xl border overflow-x-auto ${
            darkMode ? 'bg-[#0B0F17] border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          {TABS_LIST.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white font-semibold'
                    : darkMode
                      ? 'text-slate-400 hover:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Workspace Controls: Active Session, Offline Switch, Sync, Theme, Account */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeSession && (
            <button
              onClick={() => setActiveTab('focus')}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-indigo-600/25 border border-indigo-500/40 text-indigo-300 text-xs font-medium flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>DND Active:</span>
              <span className="font-mono tabular-nums font-bold">
                {formatTimer(remainingSeconds)}
              </span>
            </button>
          )}

          <button
            onClick={handleToggleOfflineMode}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isOfflineSimulated
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : darkMode
                  ? 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {isOfflineSimulated ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Offline ({dirtyOutboxCount} queued)</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span>Online</span>
              </>
            )}
          </button>

          <button
            onClick={() => handleBatchSync()}
            disabled={isOfflineSimulated || isSyncing}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 ${
              darkMode
                ? 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
          </button>

          <button
            onClick={() => setDarkMode(!darkMode)}
            aria-label="Toggle color theme"
            className={`min-h-[38px] min-w-[38px] px-2.5 py-1.5 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
              darkMode
                ? 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setShowAuthModal(true)}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              darkMode
                ? 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5 text-indigo-400" />
            <span>{currentUser.display_name}</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          TAB 3: 3D ZEN SANCTUARY (100% Unobstructed Central 3D Viewport)
         ===================================================================== */}
      {activeTab === 'sanctuary' ? (
        <div className="relative z-10 flex-1 pointer-events-none flex flex-col justify-between p-6 lg:p-10">
          {/* Minimal Top-Left Spec Kicker leaving center 100% unobstructed */}
          <div
            className={`pointer-events-auto max-w-md p-4 rounded-xl border ${surfaceCardClass}`}
          >
            <div className="text-xs font-mono text-emerald-400">
              3D KINETIC CHRONOMETER SANCTUARY
            </div>
            <h2 className="text-base font-bold font-display mt-0.5">
              Interactive 9-Part Gyroscopic Focus Vessel
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Drag to orbit · Scroll to zoom · Use the collapsible bottom dock to adjust camera
              angles, PBR metal finishes, or exploded view separation.
            </p>
          </div>
        </div>
      ) : (
        /* =====================================================================
           OTHER WORKSPACE TABS OVERLAYING THE 3D BACKGROUND
           ===================================================================== */
        <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-6 lg:px-10 py-7 pb-36">
          {/* TAB 1: DASHBOARD & DAILY HABITS */}
          {activeTab === 'dashboard' && (
            <div className="space-y-7">
              {/* Date Scroller + Add Habit Row */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                  {recentDates.map((d) => {
                    const isSelected = d.iso === selectedDate;
                    return (
                      <button
                        key={d.iso}
                        onClick={() => setSelectedDate(d.iso)}
                        className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-semibold'
                            : darkMode
                              ? 'bg-[#0F1624]/92 text-slate-300 hover:text-white border border-slate-800'
                              : 'bg-white/95 text-slate-700 hover:text-slate-900 border border-slate-200'
                        }`}
                      >
                        <span>{d.isToday ? 'Today' : d.dayShort}</span>
                        <span className="font-mono tabular-nums">{d.dayNum}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('sanctuary')}
                    className={`min-h-[40px] px-3.5 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${surfaceCardClass}`}
                  >
                    <Box className="w-4 h-4 text-indigo-400" />
                    <span>Inspect 3D Background</span>
                  </button>
                  <button
                    onClick={openCreateHabitModal}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Habit</span>
                  </button>
                </div>
              </div>

              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={`p-5 rounded-xl border ${surfaceCardClass}`}>
                  <div className="text-xs text-slate-400 font-medium">Today’s Completion</div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono tabular-nums">
                      {dashboardSummary.completedToday}/{dashboardSummary.totalCount}
                    </span>
                    <span className="text-sm font-mono tabular-nums text-emerald-500 font-semibold">
                      {dashboardSummary.completionPct}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800/60 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-transform duration-200 origin-left"
                      style={{
                        transform: `scaleX(${dashboardSummary.completionPct / 100})`,
                      }}
                    />
                  </div>
                </div>

                <div className={`p-5 rounded-xl border ${surfaceCardClass}`}>
                  <div className="text-xs text-slate-400 font-medium">Active Streak Momentum</div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono tabular-nums">
                      {dashboardSummary.bestCurrentStreak} days
                    </span>
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      Best: {dashboardSummary.bestEverStreak}d
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    Scheduled rest days preserve streak continuity
                  </p>
                </div>

                <div className={`p-5 rounded-xl border ${surfaceCardClass}`}>
                  <div className="text-xs text-slate-400 font-medium">Deep Work Focus Time</div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono tabular-nums">
                      {focusStats.todayFocusMinutes}m
                    </span>
                    <span className="text-xs text-indigo-400 font-mono tabular-nums">
                      7d: {focusStats.weekFocusMinutes}m
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    {focusStats.completedSessionsCount} DND sessions completed
                  </p>
                </div>

                <div className={`p-5 rounded-xl border ${surfaceCardClass}`}>
                  <div className="text-xs text-slate-400 font-medium">Android APK &amp; Sync</div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-lg font-bold font-mono tabular-nums">
                      {dirtyOutboxCount === 0 ? 'All Synced' : `${dirtyOutboxCount} Pending`}
                    </span>
                    <button
                      onClick={() => setActiveTab('apk')}
                      className="text-xs text-emerald-400 hover:underline font-medium cursor-pointer"
                    >
                      Chrome APK &rarr;
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-slate-400 truncate">
                    {lastSyncedAt
                      ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
                      : 'Offline-first local store ready'}
                  </p>
                </div>
              </div>

              {/* Main 2-Column Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left 8 Columns: Habits List */}
                <div className="lg:col-span-8 space-y-3">
                  {visibleHabits.map((habit) => {
                    const st = habitStatsMap[habit.id] || {
                      currentStreak: 0,
                      longestStreak: 0,
                      completionRate7d: 0,
                      completionRate30d: 0,
                      completedToday: false,
                    };
                    const isAnimating = justCheckedHabitId === habit.id;

                    return (
                      <div
                        key={habit.id}
                        className={`p-4 sm:p-5 rounded-xl border transition-transform duration-150 ${
                          isAnimating ? 'scale-[0.985]' : 'scale-100'
                        } ${surfaceCardClass}`}
                      >
                        <div className="flex items-start sm:items-center justify-between gap-4">
                          <div className="flex items-start sm:items-center gap-4 flex-1 min-w-0">
                            <button
                              onClick={() => handleToggleHabitCheck(habit.id)}
                              aria-label={`Check off ${habit.name}`}
                              className="min-h-[48px] min-w-[48px] rounded-xl flex items-center justify-center transition-transform duration-150 active:scale-90 cursor-pointer shrink-0 border-2"
                              style={{
                                backgroundColor: st.completedToday ? habit.color : 'transparent',
                                borderColor: st.completedToday
                                  ? habit.color
                                  : darkMode
                                    ? '#334155'
                                    : '#CBD5E1',
                              }}
                            >
                              {st.completedToday ? (
                                <Check className="w-6 h-6 text-white stroke-[2.5]" />
                              ) : (
                                renderHabitIcon(habit.icon, habit.color)
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <h3
                                className={`font-semibold text-base truncate ${
                                  st.completedToday ? 'line-through opacity-75' : ''
                                }`}
                              >
                                {habit.name}
                              </h3>

                              {habit.description && (
                                <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                                  {habit.description}
                                </p>
                              )}

                              {/* Unboxed metadata with middle dots */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 mt-2 font-mono tabular-nums">
                                <span>{formatScheduleText(habit)}</span>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={
                                    st.currentStreak > 0 ? 'text-emerald-400 font-medium' : ''
                                  }
                                >
                                  {st.currentStreak}d streak
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{st.completionRate30d}% 30d rate</span>
                                <span aria-hidden="true">·</span>
                                <span>{habit.default_focus_minutes}m focus</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => handleStartFocusSession(habit)}
                              className="min-h-[40px] px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Focus {habit.default_focus_minutes}m</span>
                            </button>

                            <button
                              onClick={() => openEditHabitModal(habit)}
                              aria-label={`Edit ${habit.name}`}
                              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => handleDeleteHabit(habit.id)}
                              aria-label={`Delete ${habit.name}`}
                              className="min-h-[40px] min-w-[40px] rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right 4 Columns: Quick Focus & Weekly Snapshot */}
                <div className="lg:col-span-4 space-y-6">
                  <div className={`p-6 rounded-xl border space-y-4 ${surfaceCardClass}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold font-display">Quick DND Focus</h3>
                      <Shield className="w-5 h-5 text-indigo-400" />
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Launch a preset session to accelerate the 3D Zen Chronometer and engage
                      automatic system Do Not Disturb.
                    </p>

                    <div className="grid grid-cols-3 gap-2">
                      {FOCUS_PRESETS_MINUTES.map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setFocusDurationMin(preset)}
                          className={`min-h-[40px] py-2 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer ${
                            focusDurationMin === preset
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : darkMode
                                ? 'bg-slate-900 border-slate-800 text-slate-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          {preset} min
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        setActiveTab('focus');
                        if (!activeSession) {
                          handleStartFocusSession();
                        }
                      }}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>
                        {activeSession
                          ? 'Open Active Focus Session'
                          : `Start ${focusDurationMin}m DND Session`}
                      </span>
                    </button>
                  </div>

                  <div className={`p-6 rounded-xl border space-y-4 ${surfaceCardClass}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold font-display">7-Day Momentum</h3>
                      <button
                        onClick={() => setActiveTab('analytics')}
                        className="text-xs text-emerald-400 hover:underline cursor-pointer"
                      >
                        Full Charts &rarr;
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {completionSeries.slice(-7).map((day) => (
                        <div key={day.date} className="flex items-center gap-3 text-xs">
                          <span className="w-10 text-slate-400 font-mono tabular-nums">
                            {day.dayLabel}
                          </span>
                          <div
                            className={`flex-1 h-2 rounded-full overflow-hidden ${
                              darkMode ? 'bg-slate-800' : 'bg-slate-200'
                            }`}
                          >
                            <div
                              className="h-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${day.percentage}%` }}
                            />
                          </div>
                          <span className="w-10 text-right font-mono tabular-nums font-medium">
                            {day.percentage}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FOCUS STUDIO & AUTOMATIC PLATFORM DND */}
          {activeTab === 'focus' && (
            <div className="space-y-8">
              {liveDndState.restoredBanner && (
                <div
                  className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                    darkMode
                      ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-200'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-xs">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{liveDndState.restoredBanner}</span>
                  </div>
                  <button
                    onClick={() =>
                      setLiveDndState((prev) => ({ ...prev, restoredBanner: null }))
                    }
                    className="text-xs underline cursor-pointer shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div
                  className={`lg:col-span-7 p-6 sm:p-8 rounded-xl border space-y-6 ${surfaceCardClass}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold font-display">Focus Session Timer</h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Background-persistent monotonic timer synchronized with the 3D Chronometer
                      </p>
                    </div>
                    <button
                      onClick={() => setShowDndGuideModal(true)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 text-indigo-300 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Platform DND Setup Guide
                    </button>
                  </div>

                  {/* Radial Countdown */}
                  <div className="flex flex-col items-center justify-center py-4">
                    <div className="relative w-64 h-64 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                        <circle
                          cx="60"
                          cy="60"
                          r="52"
                          fill="none"
                          stroke={darkMode ? '#1E293B' : '#E2E8F0'}
                          strokeWidth="6"
                        />
                        <circle
                          cx="60"
                          cy="60"
                          r="52"
                          fill="none"
                          stroke="#6366F1"
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 52}
                          strokeDashoffset={
                            2 * Math.PI * 52 * (1 - (activeSession ? timerProgressPct / 100 : 0))
                          }
                          className="transition-all duration-300"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-5xl font-bold font-mono tabular-nums tracking-tight">
                          {formatTimer(activeSession ? remainingSeconds : focusDurationMin * 60)}
                        </span>
                        <span className="text-xs text-slate-400 mt-2">
                          {activeSession
                            ? isTimerPaused
                              ? 'Paused'
                              : 'DND Session Running'
                            : `${focusDurationMin} min preset ready`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!activeSession ? (
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {FOCUS_PRESETS_MINUTES.map((min) => (
                          <button
                            key={min}
                            onClick={() => {
                              setFocusDurationMin(min);
                              setRemainingSeconds(min * 60);
                            }}
                            className={`min-h-[44px] py-2.5 px-4 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer ${
                              focusDurationMin === min
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : darkMode
                                  ? 'bg-slate-900 border-slate-800 text-slate-300'
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                          >
                            {min} min
                          </button>
                        ))}

                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={240}
                            value={customDurationInput}
                            onChange={(e) => {
                              setCustomDurationInput(e.target.value);
                              const val = Math.max(1, Math.min(240, Number(e.target.value) || 25));
                              setFocusDurationMin(val);
                              setRemainingSeconds(val * 60);
                            }}
                            aria-label="Custom focus minutes"
                            className={`w-full min-h-[44px] px-3 py-2 rounded-lg border text-xs font-mono tabular-nums text-center ${
                              darkMode
                                ? 'bg-slate-900 border-slate-800 text-slate-200'
                                : 'bg-slate-50 border-slate-200 text-slate-800'
                            }`}
                          />
                          <span className="text-xs text-slate-400">m</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1.5">
                            Link Session to Habit
                          </label>
                          <select
                            value={linkedHabitId}
                            onChange={(e) => setLinkedHabitId(e.target.value)}
                            className={`w-full min-h-[44px] px-3 py-2 rounded-lg border text-xs ${
                              darkMode
                                ? 'bg-slate-900 border-slate-800 text-slate-200'
                                : 'bg-slate-50 border-slate-200 text-slate-800'
                            }`}
                          >
                            <option value="">No linked habit (General Focus)</option>
                            {visibleHabits.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-end">
                          <label className="flex items-center gap-2.5 text-xs cursor-pointer select-none min-h-[44px]">
                            <input
                              type="checkbox"
                              checked={autoCheckOnComplete}
                              onChange={(e) => setAutoCheckOnComplete(e.target.checked)}
                              className="w-4 h-4 rounded accent-indigo-600"
                            />
                            <span>Auto-check habit when session finishes</span>
                          </label>
                        </div>
                      </div>

                      <button
                        onClick={() => handleStartFocusSession()}
                        className="w-full min-h-[48px] py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Start Focus Session &amp; Auto-Enable DND</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <button
                        onClick={handleTogglePauseTimer}
                        className="min-h-[48px] px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer"
                      >
                        <Clock className="w-4 h-4" />
                        <span>{isTimerPaused ? 'Resume Timer' : 'Pause Timer'}</span>
                      </button>

                      <button
                        onClick={() => handleEndFocusSession('completed')}
                        className="min-h-[48px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>Complete &amp; Restore DND</span>
                      </button>

                      <button
                        onClick={() => handleEndFocusSession('cancelled')}
                        className="min-h-[48px] px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Cancel &amp; Restore DND</span>
                      </button>

                      <button
                        onClick={() => setFullscreenFocusLockout(true)}
                        className="min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <Maximize2 className="w-4 h-4" />
                        <span>Full-Screen Lockout</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Right 5 Columns: Platform DND Adapter Inspector */}
                <div className="lg:col-span-5 space-y-6">
                  <div className={`p-6 rounded-xl border space-y-4 ${surfaceCardClass}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold font-display">
                        Platform DND State Controller
                      </h3>
                      <ShieldCheck className="w-5 h-5 text-emerald-500" />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'android', label: 'Android Native' },
                        { id: 'ios', label: 'iOS Shortcuts' },
                        { id: 'windows', label: 'Windows Helper' },
                      ].map((plat) => (
                        <button
                          key={plat.id}
                          onClick={() => setSelectedPlatform(plat.id as PlatformTarget)}
                          className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                            selectedPlatform === plat.id
                              ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
                              : darkMode
                                ? 'bg-slate-900 border-slate-800 text-slate-400'
                                : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          {plat.label}
                        </button>
                      ))}
                    </div>

                    <div
                      className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                        darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          {selectedPlatform === 'android'
                            ? 'Notification Policy Access Granted'
                            : selectedPlatform === 'ios'
                              ? 'Apple Shortcut "QuietPulse DND" Installed'
                              : 'Windows Registry/WNF Helper Permitted'}
                        </span>
                        <input
                          type="checkbox"
                          checked={osDndPermissionGranted}
                          onChange={(e) => setOsDndPermissionGranted(e.target.checked)}
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                      </div>
                      <p className="text-slate-400 leading-relaxed">
                        {osDndPermissionGranted
                          ? 'Starting a session snapshots your current OS interruption filter, enables DND, and restores the prior filter when finished.'
                          : 'When OS DND permission is off, starting a session automatically triggers the in-app Full-Screen Focus Lockout Mode.'}
                      </p>
                    </div>

                    <div
                      className={`p-3.5 rounded-lg border text-xs font-mono space-y-1 ${
                        liveDndState.active
                          ? 'bg-indigo-950/60 border-indigo-500/40 text-indigo-300'
                          : darkMode
                            ? 'bg-slate-900 border-slate-800 text-slate-300'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div>STATE: {liveDndState.active ? 'DND_ENGAGED' : 'IDLE_NORMAL'}</div>
                      <div>MODE: {liveDndState.mode}</div>
                      <div className="truncate">DETAIL: {liveDndState.statusLabel}</div>
                    </div>
                  </div>

                  <div className={`p-6 rounded-xl border space-y-4 ${surfaceCardClass}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold font-display">Session History</h3>
                      <span className="text-xs font-mono tabular-nums text-slate-400">
                        {focusStats.totalFocusMinutes}m total
                      </span>
                    </div>

                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                      {focusSessions.slice(0, 7).map((sess) => {
                        const linked = visibleHabits.find((h) => h.id === sess.habit_id);
                        const mins = Math.max(1, Math.round(sess.actual_duration_sec / 60));
                        return (
                          <div
                            key={sess.id}
                            className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                              darkMode
                                ? 'bg-slate-900 border-slate-800'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">
                                {linked ? linked.name : 'General Deep Work'}
                              </div>
                              <div className="text-slate-400 font-mono tabular-nums mt-0.5">
                                {new Date(sess.started_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}{' '}
                                · {sess.dnd_applied_mode} · {sess.status}
                              </div>
                            </div>
                            <span
                              className={`font-mono tabular-nums font-bold shrink-0 ${
                                sess.status === 'completed' ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {mins}m
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ANALYTICS & WEEKLY/MONTHLY PROGRESS CHARTS */}
          {activeTab === 'analytics' && (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold font-display">
                    Habit Consistency &amp; Focus Analytics
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Weekly 7-day and Monthly 30-day completion metrics
                  </p>
                </div>

                <div
                  className={`flex items-center gap-1 p-1 rounded-lg border ${
                    darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
                  }`}
                >
                  <button
                    onClick={() => setChartWindow(7)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartWindow === 7
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Weekly (7 Days)
                  </button>
                  <button
                    onClick={() => setChartWindow(30)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartWindow === 30
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Monthly (30 Days)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className={`p-6 rounded-xl border space-y-5 ${surfaceCardClass}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold font-display">
                      {chartWindow === 7 ? 'Weekly' : 'Monthly'} Habit Completion (%)
                    </h3>
                    <BarChart3 className="w-4 h-4 text-emerald-500" />
                  </div>

                  <div className="h-52 flex items-end gap-1.5 pt-6 pb-2 border-b border-slate-800/60">
                    {completionSeries.map((pt) => (
                      <div
                        key={pt.date}
                        className="flex-1 flex flex-col items-center justify-end h-full group"
                      >
                        <div className="w-full bg-slate-800/50 rounded-t-sm h-full flex items-end overflow-hidden">
                          <div
                            className="w-full bg-emerald-500 group-hover:bg-emerald-400 transition-all duration-300 rounded-t-sm"
                            style={{ height: `${Math.max(4, pt.percentage)}%` }}
                          />
                        </div>
                        {chartWindow === 7 && (
                          <span className="text-[11px] text-slate-400 font-mono tabular-nums mt-2">
                            {pt.dayLabel}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`p-6 rounded-xl border space-y-5 ${surfaceCardClass}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold font-display">
                      Daily Deep Focus Time (Last 7 Days)
                    </h3>
                    <Clock className="w-4 h-4 text-indigo-400" />
                  </div>

                  <div className="h-52 flex items-end gap-3 pt-6 pb-2 border-b border-slate-800/60">
                    {focusStats.dailyBreakdown.map(
                      (bucket: { date: string; dayLabel: string; minutes: number }) => {
                        const maxMin = Math.max(
                          60,
                          ...focusStats.dailyBreakdown.map((b: { minutes: number }) => b.minutes)
                        );
                        const heightPct = Math.round((bucket.minutes / maxMin) * 100);
                        return (
                          <div
                            key={bucket.date}
                            className="flex-1 flex flex-col items-center justify-end h-full"
                          >
                            <span className="text-[11px] font-mono tabular-nums text-indigo-400 mb-1">
                              {bucket.minutes}m
                            </span>
                            <div className="w-full bg-slate-800/50 rounded-t-md h-full flex items-end overflow-hidden">
                              <div
                                className="w-full bg-indigo-500 transition-all duration-300 rounded-t-md"
                                style={{ height: `${Math.max(5, heightPct)}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono tabular-nums mt-2">
                              {bucket.dayLabel}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: CHROME ANDROID APK & WEBAPK LAUNCHER */}
          {activeTab === 'apk' && (
            <div className="space-y-8">
              <div className={`p-6 sm:p-8 rounded-xl border space-y-6 ${surfaceCardClass}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold font-display">
                      Launch &amp; Install as Chrome Android APK (WebAPK / TWA / Native)
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      QuietPulse is configured with a full Web App Manifest, Service Worker,
                      maskable Android adaptive icons, Digital Asset Links (
                      <code className="font-mono text-emerald-400">
                        /.well-known/assetlinks.json
                      </code>
                      ), and Bubblewrap TWA / React Native Android APK build configs.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Option 1: Direct Chrome WebAPK Install */}
                    <button
                      onClick={async () => {
                        if (isInstallable) {
                          const ok = await triggerPwaInstall();
                          if (ok) {
                            setApkInstallFeedback(
                              'Installed! QuietPulse WebAPK is now on your Android launcher.'
                            );
                          }
                        } else {
                          setApkInstallFeedback(
                            'In Chrome on Android, tap the browser menu (⋮) → "Install app" or use the Launch in Chrome Android Intent button.'
                          );
                        }
                      }}
                      className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isInstalled
                          ? 'Running as Installed Standalone APK'
                          : 'Install Chrome WebAPK'}
                      </span>
                    </button>

                    {/* Option 2: Android Chrome Intent URI Launcher */}
                    <a
                      href={getChromeAndroidIntentUrl()}
                      className="min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2"
                    >
                      <Smartphone className="w-4 h-4" />
                      <span>Launch in Android Chrome (Intent URI)</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {apkInstallFeedback && (
                  <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/50 text-emerald-200 text-xs">
                    {apkInstallFeedback}
                  </div>
                )}

                {isIOS && (
                  <div className="p-4 rounded-xl border border-indigo-500/40 bg-indigo-950/50 text-indigo-200 text-xs">
                    On iOS Safari: Tap the <strong>Share</strong> icon in the toolbar and choose{' '}
                    <strong>Add to Home Screen</strong> to launch QuietPulse in full-screen
                    standalone mode.
                  </div>
                )}

                {/* 3 Ways to Run/Package on Android */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                  <div
                    className={`p-5 rounded-xl border space-y-2.5 ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="font-bold text-sm text-emerald-400">
                      Method 1: Instant Chrome WebAPK
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      When opened in <strong>Google Chrome on Android</strong>, Chrome automatically
                      compiles the manifest (<code className="font-mono">display: standalone</code>)
                      and maskable icons into a signed system <strong>WebAPK</strong> installed to
                      your app drawer without an address bar.
                    </p>
                  </div>

                  <div
                    className={`p-5 rounded-xl border space-y-2.5 ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="font-bold text-sm text-indigo-400">
                      Method 2: Standalone Chrome TWA .APK
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Package this web app into a standalone installable{' '}
                      <code className="font-mono">app-release-signed.apk</code> powered by Chrome’s
                      Trusted Web Activity engine using the included{' '}
                      <code className="font-mono">twa-manifest.json</code>:
                    </p>
                    <pre className="p-2.5 rounded bg-black/70 text-slate-200 font-mono text-[11px] overflow-x-auto">
                      {`npx @bubblewrap/cli build\nadb install app-release-signed.apk`}
                    </pre>
                  </div>

                  <div
                    className={`p-5 rounded-xl border space-y-2.5 ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="font-bold text-sm text-amber-400">
                      Method 3: Native Expo + DndModule APK
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Build the React Native package in <code className="font-mono">/mobile</code>{' '}
                      with our custom Java{' '}
                      <code className="font-mono">NotificationManager.setInterruptionFilter</code>{' '}
                      module:
                    </p>
                    <pre className="p-2.5 rounded bg-black/70 text-slate-200 font-mono text-[11px] overflow-x-auto">
                      {`cd mobile && npx expo prebuild\ncd android && ./gradlew assembleRelease`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: OFFLINE SYNC LAB & MONOREPO DELIVERABLES EXPLORER */}
          {activeTab === 'codebase' && (
            <div className="space-y-8">
              <div className={`p-6 rounded-xl border space-y-4 ${surfaceCardClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold font-display">
                      Offline-First Sync &amp; Last-Write-Wins (LWW) Lab
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Test offline mutations and batch POST /sync conflict resolution
                    </p>
                  </div>

                  <button
                    onClick={handleSimulateConflictAndSync}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Test LWW Timestamp Update &amp; Sync
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono tabular-nums">
                  <div
                    className={`p-4 rounded-lg border ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="text-slate-400">LOCAL OUTBOX QUEUE</div>
                    <div className="text-lg font-bold mt-1">{dirtyOutboxCount} dirty records</div>
                  </div>

                  <div
                    className={`p-4 rounded-lg border ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="text-slate-400">CONFLICT STRATEGY</div>
                    <div className="text-lg font-bold mt-1">ISO-8601 UTC LWW</div>
                  </div>

                  <div
                    className={`p-4 rounded-lg border ${
                      darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="text-slate-400">LAST SYNC RESULT</div>
                    <div className="text-lg font-bold mt-1 text-emerald-400">
                      {lastSyncSummary
                        ? `Synced @ ${lastSyncSummary.timestamp}`
                        : 'Initial Seed Synced'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-xl font-bold font-display">
                    Monorepo Source Files (/backend, /shared, /mobile, /desktop)
                  </h2>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'all', label: 'All Files' },
                      { id: 'backend', label: '/backend' },
                      { id: 'shared', label: '/shared' },
                      { id: 'mobile', label: '/mobile & APK' },
                      { id: 'desktop', label: '/desktop' },
                      { id: 'docs', label: 'README' },
                    ].map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => {
                          setSelectedPackageFilter(pkg.id);
                          const firstMatch =
                            pkg.id === 'all'
                              ? monorepoFiles[0]
                              : monorepoFiles.find((f) => f.package === pkg.id);
                          if (firstMatch) setSelectedFilePath(firstMatch.path);
                        }}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                          selectedPackageFilter === pkg.id
                            ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
                            : surfaceCardClass
                        }`}
                      >
                        {pkg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className={`lg:col-span-4 rounded-xl border overflow-hidden ${surfaceCardClass}`}>
                    <div className="px-4 py-3 border-b border-slate-800/80 text-xs font-semibold text-slate-400">
                      Files ({filteredMonorepoFiles.length})
                    </div>
                    <div className="divide-y divide-slate-800/50 max-h-[500px] overflow-y-auto">
                      {filteredMonorepoFiles.map((file) => {
                        const active = currentInspectedFile?.path === file.path;
                        return (
                          <button
                            key={file.path}
                            onClick={() => setSelectedFilePath(file.path)}
                            className={`w-full text-left px-4 py-3 text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                              active ? 'bg-indigo-600/20 text-indigo-400 font-semibold' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-mono truncate">{file.path}</div>
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                {file.label}
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={`lg:col-span-8 rounded-xl border overflow-hidden ${surfaceCardClass}`}>
                    {currentInspectedFile ? (
                      <>
                        <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-mono font-bold text-emerald-400">
                              /{currentInspectedFile.path}
                            </div>
                            <div className="text-xs text-slate-400">
                              {currentInspectedFile.label}
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(currentInspectedFile.content);
                              setCopiedPath(currentInspectedFile.path);
                              setTimeout(() => setCopiedPath(null), 2000);
                            }}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {copiedPath === currentInspectedFile.path ? (
                              <>
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy File</span>
                              </>
                            )}
                          </button>
                        </div>

                        <pre className="p-5 text-xs font-mono leading-relaxed overflow-x-auto max-h-[500px] overflow-y-auto bg-[#090D14] text-slate-200">
                          <code>{currentInspectedFile.content}</code>
                        </pre>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* =====================================================================
          UNIFIED COLLAPSIBLE BOTTOM 3D CONTROL DOCK (<= 15% Viewport Footprint)
         ===================================================================== */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[94vw] max-w-[920px] pointer-events-auto">
        <div className="flex justify-center mb-1">
          <button
            onClick={() => setDockCollapsed(!dockCollapsed)}
            className={`px-3.5 py-1 rounded-t-lg border border-b-0 text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              darkMode
                ? 'bg-[#0B0F17]/95 border-slate-800 text-slate-300 hover:text-white'
                : 'bg-white/95 border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
                <span>Show 3D Scene Dock (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hide 3D Controls (H)</span>
              </>
            )}
          </button>
        </div>

        {!dockCollapsed && (
          <div
            className={`p-3 rounded-2xl border shadow-2xl flex flex-wrap items-center justify-between gap-3 text-xs ${
              darkMode
                ? 'bg-[#0B0F17]/95 border-slate-800 text-slate-200'
                : 'bg-white/95 border-slate-200 text-slate-800'
            }`}
          >
            {/* Camera Presets */}
            <div className="flex items-center gap-1">
              <span className="text-slate-400 mr-1 font-medium">Camera:</span>
              {(
                [
                  { id: 'overview', label: 'Overview' },
                  { id: 'macro', label: 'Macro' },
                  { id: 'zenith', label: 'Zenith' },
                  { id: 'horizon', label: 'Horizon' },
                ] as { id: CameraPresetId; label: string }[]
              ).map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setCameraPreset(cam.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    cameraPreset === cam.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>

            {/* PBR Finishes */}
            <div className="flex items-center gap-1">
              <span className="text-slate-400 mr-1 font-medium">Finish:</span>
              {(
                [
                  { id: 'emerald_obsidian', label: 'Emerald' },
                  { id: 'indigo_titanium', label: 'Titanium' },
                  { id: 'amber_bronze', label: 'Bronze' },
                ] as { id: FinishPresetId; label: string }[]
              ).map((fin) => (
                <button
                  key={fin.id}
                  onClick={() => setFinishPreset(fin.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    finishPreset === fin.id
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {fin.label}
                </button>
              ))}
            </div>

            {/* Exploded View Slider */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-medium whitespace-nowrap">Explode:</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={explodedAmount}
                onChange={(e) => setExplodedAmount(Number(e.target.value))}
                aria-label="Exploded view separation"
                className="w-24 accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Kinetic Speed & Pure 3D Toggle */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  setKineticSpeed((prev) => (prev === 1 ? 2 : prev === 2 ? 0.4 : 1))
                }
                className="px-2.5 py-1 rounded-md border border-slate-700 font-mono tabular-nums cursor-pointer whitespace-nowrap"
              >
                {kineticSpeed}x
              </button>
              <button
                onClick={() =>
                  setActiveTab(activeTab === 'sanctuary' ? 'dashboard' : 'sanctuary')
                }
                className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer whitespace-nowrap"
              >
                {activeTab === 'sanctuary' ? 'Show UI Panels' : 'Pure 3D View'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          UNIVERSAL FALLBACK: IN-APP FULL-SCREEN FOCUS LOCKOUT OVERLAY
         ===================================================================== */}
      {fullscreenFocusLockout && (
        <div className="fixed inset-0 z-50 bg-[#070A10]/95 text-white flex flex-col items-center justify-center p-6">
          <div className="max-w-lg w-full text-center space-y-6">
            <div className="inline-flex items-center gap-2 text-indigo-400 text-xs font-mono">
              <Shield className="w-4 h-4" />
              <span>In-App Full-Screen Focus Mode Active (DND Fallback)</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold font-display">
              {visibleHabits.find((h) => h.id === activeSession?.habit_id)?.name ||
                'Deep Focus Session'}
            </h2>

            <div className="text-7xl sm:text-8xl font-bold font-mono tabular-nums tracking-tight py-6">
              {formatTimer(remainingSeconds)}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => handleEndFocusSession('completed')}
                className="min-h-[48px] px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                Complete Session Early
              </button>
              <button
                onClick={() => handleEndFocusSession('cancelled')}
                className="min-h-[48px] px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
              >
                Cancel &amp; Restore State
              </button>
              <button
                onClick={() => setFullscreenFocusLockout(false)}
                className="min-h-[48px] px-4 py-3 rounded-xl border border-slate-800 text-slate-400 hover:text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
                <span>Minimize Overlay</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          CREATE / EDIT HABIT MODAL
         ===================================================================== */}
      {showHabitModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className={`max-w-lg w-full rounded-2xl border p-6 space-y-5 relative ${surfaceCardClass}`}>
            <button
              onClick={() => setShowHabitModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display">
              {editingHabit ? 'Edit Habit' : 'Create New Habit'}
            </h3>

            <form onSubmit={handleSaveHabit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Habit Name</label>
                <input
                  type="text"
                  required
                  value={habitName}
                  onChange={(e) => setHabitName(e.target.value)}
                  placeholder="e.g., Deep Architecture & Systems Work"
                  className={`w-full min-h-[42px] px-3.5 py-2 rounded-lg border text-sm ${
                    darkMode
                      ? 'bg-slate-900 border-slate-800 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Description</label>
                <input
                  type="text"
                  value={habitDesc}
                  onChange={(e) => setHabitDesc(e.target.value)}
                  placeholder="Optional note or cue..."
                  className={`w-full min-h-[40px] px-3.5 py-2 rounded-lg border ${
                    darkMode
                      ? 'bg-slate-900 border-slate-800 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">Accent Color</label>
                  <div className="flex items-center gap-2">
                    {HABIT_COLORS.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setHabitColor(c.hex)}
                        className={`w-8 h-8 rounded-lg cursor-pointer transition-transform ${
                          habitColor === c.hex ? 'scale-110 ring-2 ring-white' : 'opacity-75'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1.5 font-medium">
                    Default Focus Session (min)
                  </label>
                  <select
                    value={habitDefaultFocusMin}
                    onChange={(e) => setHabitDefaultFocusMin(Number(e.target.value))}
                    className={`w-full min-h-[38px] px-3 py-1.5 rounded-lg border font-mono ${
                      darkMode
                        ? 'bg-slate-900 border-slate-800 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  >
                    <option value={25}>25 minutes</option>
                    <option value={50}>50 minutes</option>
                    <option value={90}>90 minutes</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1.5 font-medium">Schedule Cadence</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'daily', label: 'Every Day' },
                    { id: 'weekdays', label: 'Specific Days' },
                    { id: 'weekly_count', label: 'X Times / Week' },
                  ].map((mode) => (
                    <button
                      type="button"
                      key={mode.id}
                      onClick={() =>
                        setHabitFreqType(mode.id as 'daily' | 'weekdays' | 'weekly_count')
                      }
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg border font-medium cursor-pointer ${
                        habitFreqType === mode.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : darkMode
                            ? 'bg-slate-900 border-slate-800 text-slate-300'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {habitFreqType === 'weekdays' && (
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const active = habitTargetDays.includes(d.index);
                    return (
                      <button
                        type="button"
                        key={d.index}
                        onClick={() => {
                          if (active && habitTargetDays.length > 1) {
                            setHabitTargetDays(habitTargetDays.filter((x) => x !== d.index));
                          } else if (!active) {
                            setHabitTargetDays([...habitTargetDays, d.index].sort());
                          }
                        }}
                        className={`min-h-[40px] rounded-lg border font-semibold cursor-pointer ${
                          active
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : darkMode
                              ? 'bg-slate-900 border-slate-800 text-slate-400'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => setShowHabitModal(false)}
                  className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-700 text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                >
                  {editingHabit ? 'Save Changes' : 'Create Habit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          PLATFORM DND GUIDED SETUP MODAL
         ===================================================================== */}
      {showDndGuideModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div
            className={`max-w-2xl w-full rounded-2xl border p-6 space-y-5 relative max-h-[85vh] overflow-y-auto ${surfaceCardClass}`}
          >
            <button
              onClick={() => setShowDndGuideModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display">
              Cross-Platform Do Not Disturb (DND) Architecture
            </h3>

            <div className="space-y-4 text-xs leading-relaxed">
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/90">
                <div className="font-bold text-sm text-emerald-400 mb-1">
                  1. Android Native Module (NotificationManager.setInterruptionFilter)
                </div>
                <p className="text-slate-300">
                  Checks <code className="font-mono">isNotificationPolicyAccessGranted()</code>,
                  opens <code className="font-mono">ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS</code>
                  , snapshots <code className="font-mono">getCurrentInterruptionFilter()</code>,
                  enables <code className="font-mono">INTERRUPTION_FILTER_PRIORITY</code>, and
                  restores the exact prior filter when the focus session ends or is cancelled.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/90">
                <div className="font-bold text-sm text-indigo-400 mb-1">
                  2. iOS Focus Filter &amp; Apple Shortcuts Bridge
                </div>
                <p className="text-slate-300">
                  Uses <code className="font-mono">QuietPulseFocusExtension.swift</code> (
                  <code className="font-mono">SetFocusFilterIntent</code>) and the Apple Shortcuts
                  automation bridge{' '}
                  <code className="font-mono">
                    shortcuts://run-shortcut?name=QuietPulse%20DND&amp;input=on|off
                  </code>
                  .
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/90">
                <div className="font-bold text-sm text-amber-400 mb-1">
                  3. Windows Desktop (Electron + PowerShell / Python Helper)
                </div>
                <p className="text-slate-300">
                  Invokes <code className="font-mono">desktop/scripts/windows-dnd-helper.ps1</code>{' '}
                  to back up and mute Windows Action Center toast notifications, suppresses app
                  notifications, and restores the prior registry state when the session ends.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowDndGuideModal(false)}
                className="min-h-[40px] px-5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          JWT AUTHENTICATION MODAL
         ===================================================================== */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className={`max-w-md w-full rounded-2xl border p-6 space-y-5 relative ${surfaceCardClass}`}>
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold font-display">
              {authMode === 'login' ? 'Sign In to Sync Devices' : 'Create QuietPulse Account'}
            </h3>

            {authError && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-rose-300 text-xs">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4 text-xs">
              {authMode === 'register' && (
                <div>
                  <label className="block text-slate-400 mb-1">Display Name</label>
                  <input
                    type="text"
                    required
                    value={authDisplayName}
                    onChange={(e) => setAuthDisplayName(e.target.value)}
                    className={`w-full min-h-[40px] px-3 py-2 rounded-lg border ${
                      darkMode
                        ? 'bg-slate-900 border-slate-800 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className={`w-full min-h-[40px] px-3 py-2 rounded-lg border ${
                    darkMode
                      ? 'bg-slate-900 border-slate-800 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className={`w-full min-h-[40px] px-3 py-2 rounded-lg border ${
                    darkMode
                      ? 'bg-slate-900 border-slate-800 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <button
                type="submit"
                className="w-full min-h-[42px] py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
              >
                {authMode === 'login' ? 'Sign In & Sync' : 'Register & Sync'}
              </button>
            </form>

            <div className="text-center text-xs text-slate-400">
              {authMode === 'login' ? (
                <button
                  onClick={() => setAuthMode('register')}
                  className="text-indigo-400 hover:underline cursor-pointer"
                >
                  Need a new account? Register
                </button>
              ) : (
                <button
                  onClick={() => setAuthMode('login')}
                  className="text-indigo-400 hover:underline cursor-pointer"
                >
                  Already have an account? Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
