/**
 * QuietPulse Mobile App (React Native + Expo Dev Build)
 * Reuses `@quietpulse/shared` for data models, streak math, API calls, and LWW offline sync,
 * and integrates with `mobileDndManager` for automatic Do Not Disturb focus sessions.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  StyleSheet,
  AppState,
  Platform,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createHabitModel,
  createHabitLogModel,
  createFocusSessionModel,
  toLocalISODate,
  computeHabitStats,
  buildCompletionSeries,
  computeFocusStats,
  QuietPulseApiClient,
  OfflineSyncEngine,
  FOCUS_PRESETS_MINUTES,
} from '@quietpulse/shared';
import { mobileDndManager } from './src/dnd/DndManager';

const API_BASE_URL = 'http://localhost:8000';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'focus' | 'analytics' | 'dnd_setup'
  const [habits, setHabits] = useState([]);
  const [habitLogs, setHabitLogs] = useState([]);
  const [focusSessions, setFocusSessions] = useState([]);
  const [selectedDate, setSelectedDate] = useState(toLocalISODate());

  // Timer & DND state
  const [selectedPresetMin, setSelectedPresetMin] = useState(25);
  const [selectedHabitId, setSelectedHabitId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [fullscreenFocusActive, setFullscreenFocusActive] = useState(false);
  const [dndStatusText, setDndStatusText] = useState('Standard Notifications');
  const [iosShortcutReady, setIosShortcutReady] = useState(false);

  // New Habit Modal
  const [showNewHabitModal, setShowNewHabitModal] = useState(false);
  const [newHabitName, setNewHabitName] = useState('');

  const scaleAnim = useRef(new Animated.Value(1)).current;

  const apiClient = useMemo(
    () =>
      new QuietPulseApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => AsyncStorage.getItem('qp_jwt_token'),
      }),
    []
  );

  const syncEngine = useMemo(
    () =>
      new OfflineSyncEngine({
        apiClient,
        storage: AsyncStorage,
      }),
    [apiClient]
  );

  // Load persisted offline state on mount
  useEffect(() => {
    (async () => {
      const saved = await syncEngine.loadState();
      if (saved && saved.habits && saved.habits.length > 0) {
        setHabits(saved.habits);
        setHabitLogs(saved.habitLogs || []);
        setFocusSessions(saved.focusSessions || []);
      } else {
        const initialHabits = [
          createHabitModel({
            name: 'Deep Architecture & Coding',
            color: '#6366F1',
            default_focus_minutes: 50,
          }),
          createHabitModel({
            name: 'Technical & Philosophy Reading',
            color: '#10B981',
            default_focus_minutes: 25,
          }),
        ];
        setHabits(initialHabits);
      }
    })();
  }, [syncEngine]);

  // Background-resilient monotonic timestamp countdown
  useEffect(() => {
    if (!activeSession) return undefined;

    const updateClock = () => {
      const startedMs = new Date(activeSession.started_at).getTime();
      const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
      const left = Math.max(0, activeSession.planned_duration_sec - elapsedSec);
      setRemainingSeconds(left);
      if (left === 0) {
        handleFinishSession('completed');
      }
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateClock();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [activeSession]);

  const handleToggleHabit = async (habitId) => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();

    const now = new Date().toISOString();
    let updatedLogs = [...habitLogs];
    const existingIdx = updatedLogs.findIndex(
      (l) => l.habit_id === habitId && l.log_date === selectedDate
    );

    if (existingIdx >= 0) {
      updatedLogs[existingIdx] = {
        ...updatedLogs[existingIdx],
        completed: !updatedLogs[existingIdx].completed,
        updated_at: now,
        _dirty: true,
      };
    } else {
      updatedLogs.push({
        ...createHabitLogModel({
          habit_id: habitId,
          log_date: selectedDate,
          completed: true,
          updated_at: now,
        }),
        _dirty: true,
      });
    }

    setHabitLogs(updatedLogs);
    await syncEngine.saveState({ habits, habitLogs: updatedLogs, focusSessions });
  };

  const handleStartSession = async () => {
    const dndOutcome = await mobileDndManager.activateForSession();
    const session = createFocusSessionModel({
      habit_id: selectedHabitId,
      planned_duration_sec: selectedPresetMin * 60,
      dnd_requested: true,
      dnd_applied_mode: dndOutcome.appliedMode,
      previous_dnd_state: dndOutcome.previousState,
    });

    setActiveSession(session);
    setRemainingSeconds(selectedPresetMin * 60);
    setDndStatusText(
      dndOutcome.appliedMode === 'native_os'
        ? 'Android System DND Active'
        : dndOutcome.appliedMode === 'shortcut_bridge'
          ? 'iOS Shortcuts Focus Active'
          : 'Full-Screen Focus Lockout Active'
    );
    if (dndOutcome.fullscreenFallback) {
      setFullscreenFocusActive(true);
    }
  };

  const handleFinishSession = async (finalStatus) => {
    if (!activeSession) return;
    const startedMs = new Date(activeSession.started_at).getTime();
    const elapsedSec = Math.min(
      activeSession.planned_duration_sec,
      Math.max(1, Math.floor((Date.now() - startedMs) / 1000))
    );

    await mobileDndManager.restoreAfterSession(activeSession.dnd_applied_mode);

    const finished = {
      ...activeSession,
      status: finalStatus,
      actual_duration_sec: elapsedSec,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      _dirty: true,
    };

    const nextSessions = [finished, ...focusSessions];
    setFocusSessions(nextSessions);
    setActiveSession(null);
    setFullscreenFocusActive(false);
    setDndStatusText(`Restored (${activeSession.previous_dnd_state})`);

    if (finalStatus === 'completed' && activeSession.habit_id) {
      await handleToggleHabit(activeSession.habit_id);
    } else {
      await syncEngine.saveState({ habits, habitLogs, focusSessions: nextSessions });
    }
  };

  const handleCreateHabit = async () => {
    if (!newHabitName.trim()) return;
    const created = {
      ...createHabitModel({ name: newHabitName.trim() }),
      _dirty: true,
    };
    const nextHabits = [...habits, created];
    setHabits(nextHabits);
    setNewHabitName('');
    setShowNewHabitModal(false);
    await syncEngine.saveState({ habits: nextHabits, habitLogs, focusSessions });
  };

  const weeklySeries = useMemo(
    () => buildCompletionSeries(habits, habitLogs, 7, selectedDate),
    [habits, habitLogs, selectedDate]
  );
  const focusStats = useMemo(
    () => computeFocusStats(focusSessions, habits, selectedDate),
    [focusSessions, habits, selectedDate]
  );

  const theme = darkMode ? darkStyles : lightStyles;

  return (
    <SafeAreaView style={[styles.container, theme.bg]}>
      {/* Header */}
      <View style={[styles.header, theme.cardBorder]}>
        <Text style={[styles.brandTitle, theme.text]}>QuietPulse</Text>
        <TouchableOpacity onPress={() => setDarkMode(!darkMode)} style={styles.modeButton}>
          <Text style={theme.subtext}>{darkMode ? 'Light Mode' : 'Dark Mode'}</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'dashboard' && (
          <View>
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, theme.card]}>
                <Text style={theme.subtext}>Focus Today</Text>
                <Text style={[styles.kpiValue, theme.text]}>{focusStats.todayFocusMinutes}m</Text>
              </View>
              <View style={[styles.kpiCard, theme.card]}>
                <Text style={theme.subtext}>7d Focus</Text>
                <Text style={[styles.kpiValue, theme.text]}>{focusStats.weekFocusMinutes}m</Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, theme.text]}>Today's Habits</Text>
              <TouchableOpacity
                onPress={() => setShowNewHabitModal(true)}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>+ New Habit</Text>
              </TouchableOpacity>
            </View>

            {habits.map((h) => {
              const stats = computeHabitStats(h, habitLogs, selectedDate);
              return (
                <Animated.View
                  key={h.id}
                  style={[styles.habitRow, theme.card, { transform: [{ scale: scaleAnim }] }]}
                >
                  <TouchableOpacity
                    style={styles.habitCheckArea}
                    onPress={() => handleToggleHabit(h.id)}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        stats.completedToday && { backgroundColor: h.color, borderColor: h.color },
                      ]}
                    >
                      {stats.completedToday && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View>
                      <Text style={[styles.habitName, theme.text]}>{h.name}</Text>
                      <Text style={theme.subtext}>
                        {stats.currentStreak}d streak · {stats.completionRate7d}% 7d rate
                      </Text>
                    </View>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        )}

        {activeTab === 'focus' && (
          <View style={[styles.focusCard, theme.card]}>
            <Text style={[styles.sectionTitle, theme.text]}>Automatic DND Focus Timer</Text>
            <Text style={theme.subtext}>DND Status: {dndStatusText}</Text>

            <Text style={[styles.timerDigits, theme.text]}>
              {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:
              {String(remainingSeconds % 60).padStart(2, '0')}
            </Text>

            {!activeSession ? (
              <View>
                <View style={styles.presetRow}>
                  {FOCUS_PRESETS_MINUTES.map((min) => (
                    <TouchableOpacity
                      key={min}
                      onPress={() => {
                        setSelectedPresetMin(min);
                        setRemainingSeconds(min * 60);
                      }}
                      style={[
                        styles.presetBtn,
                        selectedPresetMin === min && styles.presetBtnActive,
                      ]}
                    >
                      <Text style={styles.presetBtnText}>{min} min</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity onPress={handleStartSession} style={styles.startFocusBtn}>
                  <Text style={styles.primaryBtnText}>Start Session & Enable DND</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.presetRow}>
                <TouchableOpacity
                  onPress={() => handleFinishSession('completed')}
                  style={styles.completeBtn}
                >
                  <Text style={styles.primaryBtnText}>Complete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleFinishSession('cancelled')}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.primaryBtnText}>Cancel & Restore DND</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {activeTab === 'analytics' && (
          <View style={[styles.focusCard, theme.card]}>
            <Text style={[styles.sectionTitle, theme.text]}>Weekly Completion Progress</Text>
            {weeklySeries.map((day) => (
              <View key={day.date} style={styles.chartRow}>
                <Text style={[styles.chartLabel, theme.subtext]}>{day.dayLabel}</Text>
                <View style={styles.chartBarTrack}>
                  <View style={[styles.chartBarFill, { width: `${day.percentage}%` }]} />
                </View>
                <Text style={[styles.chartPct, theme.text]}>{day.percentage}%</Text>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'dnd_setup' && (
          <View style={[styles.focusCard, theme.card]}>
            <Text style={[styles.sectionTitle, theme.text]}>
              {Platform.OS === 'android'
                ? 'Android Notification Policy Access'
                : 'iOS Focus Filter & Shortcuts Setup'}
            </Text>
            {Platform.OS === 'android' ? (
              <View>
                <Text style={theme.subtext}>
                  QuietPulse uses Android's NotificationManager.setInterruptionFilter to silence
                  interruptions automatically when a focus session starts and restore your exact
                  previous filter when it ends.
                </Text>
                <TouchableOpacity
                  onPress={() => mobileDndManager.openAndroidPolicySettings()}
                  style={[styles.startFocusBtn, { marginTop: 16 }]}
                >
                  <Text style={styles.primaryBtnText}>Grant Notification Policy Access</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text style={theme.subtext}>
                  iOS sandboxes direct system DND toggling. Enable our Focus Filter in Settings →
                  Focus, or install the "QuietPulse DND" Apple Shortcut for automatic toggling.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    const next = !iosShortcutReady;
                    setIosShortcutReady(next);
                    mobileDndManager.setIosShortcutConfigured(next);
                  }}
                  style={[styles.startFocusBtn, { marginTop: 16 }]}
                >
                  <Text style={styles.primaryBtnText}>
                    {iosShortcutReady ? 'iOS Shortcut Bridge Enabled ✓' : 'Mark iOS Shortcut Configured'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Full-Screen Focus Mode Fallback Modal */}
      <Modal visible={fullscreenFocusActive} animationType="fade" transparent={false}>
        <View style={styles.fullscreenLockout}>
          <Text style={styles.lockoutKicker}>Full-Screen Focus Lockout Active</Text>
          <Text style={styles.lockoutTimer}>
            {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:
            {String(remainingSeconds % 60).padStart(2, '0')}
          </Text>
          <TouchableOpacity
            onPress={() => handleFinishSession('cancelled')}
            style={styles.cancelBtn}
          >
            <Text style={styles.primaryBtnText}>Exit Focus Session</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* New Habit Modal */}
      <Modal visible={showNewHabitModal} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, theme.card]}>
            <Text style={[styles.sectionTitle, theme.text]}>Create Habit</Text>
            <TextInput
              value={newHabitName}
              onChangeText={setNewHabitName}
              placeholder="Habit name..."
              placeholderTextColor="#64748B"
              style={[styles.input, theme.text]}
            />
            <View style={styles.presetRow}>
              <TouchableOpacity onPress={handleCreateHabit} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Save Habit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowNewHabitModal(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.primaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bottom Tab Navigation (44x44px minimum touch hitboxes) */}
      <View style={[styles.bottomBar, theme.card]}>
        {[
          { id: 'dashboard', label: 'Today' },
          { id: 'focus', label: 'Focus DND' },
          { id: 'analytics', label: 'Charts' },
          { id: 'dnd_setup', label: 'DND Setup' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={styles.tabItem}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === tab.id ? { color: '#10B981', fontWeight: '700' } : theme.subtext,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  brandTitle: { fontSize: 18, fontWeight: '700' },
  modeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  kpiCard: { flex: 1, padding: 16, borderRadius: 16, borderWidth: 1 },
  kpiValue: { fontSize: 24, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  habitRow: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  habitCheckArea: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#FFFFFF', fontWeight: '700' },
  habitName: { fontSize: 15, fontWeight: '600' },
  focusCard: { padding: 20, borderRadius: 20, borderWidth: 1 },
  timerDigits: {
    fontSize: 54,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 24,
    fontVariant: ['tabular-nums'],
  },
  presetRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 12 },
  presetBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
  },
  presetBtnActive: { backgroundColor: '#6366F1' },
  presetBtnText: { color: '#FFFFFF', fontWeight: '600' },
  primaryBtn: {
    minHeight: 44,
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
  },
  startFocusBtn: {
    minHeight: 48,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtn: {
    minHeight: 48,
    backgroundColor: '#10B981',
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
  },
  cancelBtn: {
    minHeight: 48,
    backgroundColor: '#F43F5E',
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  chartLabel: { width: 36, fontSize: 12 },
  chartBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: '#1E293B',
    borderRadius: 5,
    overflow: 'hidden',
  },
  chartBarFill: { height: '100%', backgroundColor: '#10B981' },
  chartPct: { width: 42, fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  tabItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 12 },
  fullscreenLockout: {
    flex: 1,
    backgroundColor: '#090D16',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockoutKicker: { color: '#818CF8', fontSize: 14, fontWeight: '600' },
  lockoutTimer: {
    color: '#FFFFFF',
    fontSize: 68,
    fontWeight: '700',
    marginVertical: 28,
    fontVariant: ['tabular-nums'],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { padding: 20, borderRadius: 20, borderWidth: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
});

const darkStyles = StyleSheet.create({
  bg: { backgroundColor: '#0B0F17' },
  card: { backgroundColor: '#111827', borderColor: '#1E293B' },
  cardBorder: { borderBottomColor: '#1E293B' },
  text: { color: '#F8FAFC' },
  subtext: { color: '#94A3B8', fontSize: 13 },
});

const lightStyles = StyleSheet.create({
  bg: { backgroundColor: '#F8FAFC' },
  card: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0' },
  cardBorder: { borderBottomColor: '#E2E8F0' },
  text: { color: '#0F172A' },
  subtext: { color: '#64748B', fontSize: 13 },
});
