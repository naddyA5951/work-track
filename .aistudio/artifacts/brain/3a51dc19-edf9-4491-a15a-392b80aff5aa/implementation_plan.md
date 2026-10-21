# QuietPulse — Cross-Platform Daily Habit Tracker & Automatic DND Focus System

QuietPulse is an offline-first, cross-platform daily habit tracker and deep-work session timer that automatically silences system notifications via native Do Not Disturb (DND) integrations while keeping habits, streaks, and focus analytics synchronized across Android, iOS, Windows Desktop, and Web.

### User Review & Critical Decisions

> [!IMPORTANT]
> Please review the proposed system architecture, relational database schema, offline-first synchronization protocol, and platform-specific Do Not Disturb (DND) strategies below. Once you click **Proceed**, we will build the complete monorepo packages step by step (Backend, Shared Core, Mobile, Desktop, DND Integrations, Seed Scripts, and the interactive AI Studio preview).

- **Live Preview + Complete Monorepo Deliverables (Recommended Default)**: Alongside generating the complete multi-platform monorepo packages (FastAPI + SQLAlchemy backend, shared JavaScript core, React Native Expo mobile app, and Electron Windows desktop app with platform DND helpers), the live AI Studio application will run a full-featured interactive workspace wired to the shared core and backend API so you can test every habit, chart, focus timer, offline sync conflict, and platform DND flow directly in your browser.
- **Flexible Habit Scheduling (Recommended Default)**: Habits support both specific weekday schedules (e.g., Mon/Wed/Fri) and flexible weekly frequency targets (e.g., 4 times per week), ensuring streaks only evaluate scheduled days and never penalize planned rest days.
- **Offline-First Sync via Client UUIDs & Microsecond UTC Timestamps (Recommended Default)**: Every entity uses client-generated UUIDv4 primary keys, UTC `updated_at` timestamps, and `deleted_at` soft-delete markers so devices can create, check off, edit, and delete records completely offline and resolve conflicts deterministically via Last-Write-Wins (LWW) during batch `/sync`.

---

### 1. Overview & Core Concept

- **What It Does**: Combines frictionless one-tap daily habit tracking with an automatic Do Not Disturb focus timer. Users schedule daily or weekly habits, visualize streak momentum and completion charts, launch habit-linked focus sessions (25 / 50 / 90 min presets or custom durations) that automatically engage system-level DND and restore the prior notification state afterward, and seamlessly sync across mobile and desktop devices with full offline resilience.
- **Target Audience / Persona**: Knowledge workers, developers, students, and mindful builders who operate across mobile phones (Android/iOS) and Windows workstations and need distraction-free focus sessions directly tied to their daily habits.
- **Key Value**: Bridges the gap between *habit checklists* and *deep work execution* by linking habits to protected focus blocks that automatically silence OS-level interruptions and record focus time toward daily goals.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Onboarding & Authentication**: Users sign in or register with email and password (receiving a JWT token), or start immediately in local offline mode and sync their account later. First-time focus users are guided through a platform-aware DND permission card (Android Notification Policy Access, iOS Shortcuts/Focus Filter setup, or Windows Focus Assist bridge).
  2. **Daily Dashboard & One-Tap Check-Off**: The primary view displays today's scheduled habits with a horizontal date scroller (`M 19`, `T 20`, `W 21`), summary KPI cards (Current Streak, Today's Completion Rate, Total Focus Time Today, Sync Queue Status), and tactile one-tap check-off rows that trigger smooth completion animations and immediate streak recalculation.
  3. **Habit Creation & Analytics**: A clean modal drawer lets users configure a habit's name, icon, semantic accent color, schedule mode (Every Day, Specific Weekdays, or X Times/Week), and optional target focus minutes. Clicking a habit opens weekly and monthly completion bar charts and a 90-day consistency heatmap.
  4. **Focus Session & Automatic DND Lifecycle**: Users select a preset (`25m`, `50m`, `90m`) or custom duration, optionally link a habit, and press **Start Focus Session**. The system records the current OS interruption state, activates DND (or triggers the full-screen Zenith Focus Lockout fallback if OS permission is unavailable), runs a background-resilient monotonic timer, and upon completion or cancellation restores the exact prior DND state while optionally checking off the linked habit.
  5. **Offline Queue & Batch Sync Inspector**: Changes made while offline are queued locally in an outbox and automatically batch-synced via `POST /sync` when connectivity returns, with a live sync indicator and one-click manual sync trigger.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Calm, tactile, high-craft precision utility combining SaaS dashboard data clarity with mobile thumb-zone ergonomics.
  - *Color Palette & Mood*: Follows a disciplined 60-30-10 distribution across Dark and Light modes:
    - **60% Neutral Canvas**: Deep obsidian slate (`#0B0F17`) in dark mode; crisp alabaster (`#F8FAFC`) in light mode.
    - **30% Structural Surfaces**: Elevated slate containers (`#111827` dark / `#FFFFFF` light) with subtle `1px` hairline borders (`#1E293B` dark / `#E2E8F0` light) and muted secondary typography (`#94A3B8` dark / `#64748B` light).
    - **10% Semantic Accents**: Emerald (`#10B981`) for completed habits and active streaks, Indigo (`#6366F1`) for active focus timers and DND engagement, Amber (`#F59E0B`) for streak-at-risk alerts and offline sync queues, and Rose (`#F43F5E`) for destructive or cancelled states.
  - *Typography & Hierarchy*:
    - **Display & Headings**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700, tight tracking) for section headers, dashboard greetings, and modal titles.
    - **Body & Controls**: `DM Sans` (Regular 400 / Medium 500) for scannable habit rows, descriptions, and navigation labels.
    - **Timers, Streaks & Tabular Metrics**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for countdown clocks, streak counters, completion percentages, and sync timestamps to prevent layout jitter.
  - *Component Styling & Layout*:
    - Responsive workspace layout that adapts from a 1440px desktop sidebar + multi-column dashboard canvas (`260px` navigation rail + 12-column content grid) down to a mobile-first single-column viewport (`375px–430px`) with a fixed 4-tab bottom navigation bar and $48 \times 48\text{px}$ minimum touch hitboxes.
    - Strict adherence to single-elevation cards (no nested cards-within-cards) and clean unboxed metadata separated by middle dots (`·`).
- **Interactive Feedback & Motion**:
  - Spring-physics checkmark scale and subtle SVG progress ring fill ($\le 200\text{ms}$ compositor transitions using `transform` and `opacity`) when toggling habits.
  - Smooth radial countdown ring during active Focus Sessions, plus an immersive Full-Screen Focus Mode overlay when system-level DND cannot be toggled directly.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Shared Plain-JavaScript Core Across Mobile, Desktop & Web**
  - *Chosen Approach*: Build the API client, offline sync engine, LWW conflict resolver, and streak/statistics calculators as pure, dependency-free ES modules in the shared core.
  - *Why*: Eliminates logic drift between React Native (iOS/Android) and Electron/React (Windows/Web) so streak numbers, completion percentages, and sync payloads behave identically everywhere.
  - *Alternatives Considered*: Duplicating business logic per platform or using native C++/Rust bridges, which adds build complexity without performance benefits for habit/timer domain logic.

- **Decision 2: Monotonic Timestamp Timer vs. Interval Tick Counting**
  - *Chosen Approach*: Store `started_at`, `target_duration_sec`, `paused_accumulated_sec`, and `expected_end_at` timestamps in persistent storage and compute remaining time against wall-clock/monotonic delta on each frame or foreground resume, paired with OS scheduled local notifications.
  - *Why*: Standard JavaScript `setInterval` timers throttle or freeze when mobile OSs background the app or when Windows sleeps. Timestamp-anchored timers never lose time in the background.
  - *Alternatives Considered*: Pure foreground `setInterval` counters, which drift heavily when the screen locks.

- **Decision 3: Deterministic Last-Write-Wins (LWW) Offline Synchronization**
  - *Chosen Approach*: Every client generates UUIDv4 identifiers and records `client_updated_at` (ISO-8601 UTC timestamp). The `/sync` endpoint accepts a batch of dirty local records (`habits`, `habit_logs`, `focus_sessions`) plus `last_synced_at`. For each record, the server compares `client_updated_at` against the stored `updated_at`; whichever timestamp is newer wins, and the server returns all records modified since `last_synced_at`.
  - *Why*: Allows full offline habit creation, check-offs, and focus logging across multiple devices without complex CRDT overhead or blocking network locks.
  - *Alternatives Considered*: Server-assigned sequential integer IDs, which prevent offline linking of new habit check-offs or focus sessions to newly created offline habits.

- **Decision 4: Platform-Realistic DND Architecture with Graceful In-App Fallback**
  - *Chosen Approach*: Implement tailored native integrations per OS alongside a unified `DndController` interface that captures `previousState` before enabling DND and restores it upon session completion/cancellation, falling back to an in-app Full-Screen Focus Lockout Mode whenever OS permissions are restricted.
  - *Why*: Each OS enforces distinct security boundaries around system notification filtering:
    - **Android**: Uses a custom React Native Native Module (`DndModule.java` / `.kt`) calling `NotificationManager.getCurrentInterruptionFilter()` and `setInterruptionFilter(INTERRUPTION_FILTER_PRIORITY)`, with an onboarding screen that deep-links to `Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS` if `isNotificationPolicyAccessGranted()` is false.
    - **iOS**: iOS sandboxes third-party apps from mutating system Focus modes directly via public APIs without user setup. We implement a two-part iOS solution: (1) an `AppIntents` Focus Filter (`SetFocusFilterIntent`) so system Focus changes notify the app, and (2) a custom URL scheme / Apple Shortcuts automation bridge (`shortcuts://run-shortcut?name=QuietPulseDND&input=on|off`) paired with a one-time guided interactive setup screen.
    - **Windows (Electron)**: Windows 10/11 does not expose a documented public Win32 API for third-party non-system apps to toggle Focus Assist / Do Not Disturb directly without WNF (Windows Notification Facility) state writes or Registry/CloudStore modifications. We implement a PowerShell / Python helper invoked by Electron's main process that queries and toggles Windows Quiet Hours / Focus Assist via WNF/Registry state where permitted by the OS build, clearly documents its OS build limits, suppresses all Electron app notifications, and offers the Full-Screen Always-On-Top Focus Mode fallback.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

#### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS (UI LAYER)                            │
│                                                                                   │
│  ┌──────────────────────────────┐         ┌────────────────────────────────────┐  │
│  │   Mobile App (Android/iOS)   │         │  Desktop App (Windows Electron)    │  │
│  │   React Native + Expo Dev    │         │  & Live Web Workspace Preview      │  │
│  │  ┌────────────────────────┐  │         │  ┌──────────────────────────────┐  │  │
│  │  │ Dashboard / Check-Off  │  │         │  │ Responsive Sidebar & Top Bar │  │  │
│  │  │ Habit Editor & Charts  │  │         │  │ Today Habits & Streak Grid   │  │  │
│  │  │ Focus Timer & History  │  │         │  │ Focus Timer & DND Controller │  │  │
│  │  │ DND Permission Guide   │  │         │  │ Weekly/Monthly Analytics     │  │  │
│  │  └───────────┬────────────┘  │         │  └──────────────┬───────────────┘  │  │
│  └──────────────┼───────────────┘         └─────────────────┼──────────────────┘  │
└─────────────────┼───────────────────────────────────────────┼─────────────────────┘
                  │                                           │
                  ▼                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        SHARED CORE ENGINE (PLAIN JAVASCRIPT)                      │
│                                                                                   │
│  ┌──────────────────────┐  ┌───────────────────────┐  ┌────────────────────────┐  │
│  │  Models & Validators │  │ Streak & Stats Engine │  │ Offline Sync & LWW     │  │
│  │  • Habit, HabitLog   │  │ • Current/Best Streak │  │ • Local Outbox Queue   │  │
│  │  • FocusSession      │  │ • Completion %        │  │ • Conflict Resolver    │  │
│  │  • Schedule Rules    │  │ • Weekly/Monthly Agg  │  │ • REST API Client      │  │
│  └──────────────────────┘  └───────────────────────┘  └───────────┬────────────┘  │
└───────────────────┬───────────────────────────────────────────────┼───────────────┘
                    │                                               │
                    ▼                                               ▼
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────┐
│      PLATFORM DND ADAPTER LAYER         │   │     BACKEND SERVER (FASTAPI)        │
│                                         │   │                                     │
│ • Android: NotificationManager Bridge   │   │ • Auth: /auth/register, /auth/login │
│   (setInterruptionFilter + Policy UI)   │   │ • Habits: CRUD /habits, /{id}/check │
│ • iOS: Shortcuts URL + FocusFilter      │   │ • Sessions: /sessions/start, /end,  │
│   Guided Setup Flow                     │   │   /sessions/stats                   │
│ • Windows: Electron IPC -> PowerShell / │   │ • Streaks: GET /stats/streaks       │
│   Python Helper + App Mute              │   │ • Batch Sync: POST /sync (LWW)      │
│ • Universal: Full-Screen Focus Fallback │   │ • ORM: SQLAlchemy (Postgres/SQLite) │
└─────────────────────────────────────────┘   └─────────────────────────────────────┘
```

#### Relational Database Schema (PostgreSQL & SQLite via SQLAlchemy)

All syncable entities use UUID strings (`CHAR(36)` / `UUID`) generated on the client or server, UTC timestamps (`created_at`, `updated_at`), and nullable `deleted_at` columns for soft-delete propagation across devices:

1. **`users`**
   - `id` (`String(36)`, PK, UUIDv4)
   - `email` (`String(255)`, Unique, Indexed, Not Null)
   - `password_hash` (`String(255)`, Not Null — bcrypt/PBKDF2 hashed)
   - `display_name` (`String(100)`, Nullable)
   - `created_at` (`DateTime(timezone=True)`, Not Null)
   - `updated_at` (`DateTime(timezone=True)`, Not Null)

2. **`habits`**
   - `id` (`String(36)`, PK, UUIDv4)
   - `user_id` (`String(36)`, FK $\rightarrow$ `users.id`, Indexed, Not Null)
   - `name` (`String(120)`, Not Null)
   - `description` (`String(500)`, Nullable)
   - `icon` (`String(50)`, Not Null, default `'check-circle'`)
   - `color` (`String(20)`, Not Null, default `'#10B981'`)
   - `frequency_type` (`String(20)`, Not Null — `'daily'` | `'weekdays'` | `'weekly_count'`)
   - `target_days` (`JSON`, Not Null — array of weekday ints `[0..6]` where `0=Mon, 6=Sun`, e.g. `[0,1,2,3,4,5,6]`)
   - `weekly_target_count` (`Integer`, Not Null, default `7` — used when `frequency_type == 'weekly_count'`)
   - `default_focus_minutes` (`Integer`, Not Null, default `25`)
   - `archived` (`Boolean`, Not Null, default `False`)
   - `created_at` (`DateTime(timezone=True)`, Not Null)
   - `updated_at` (`DateTime(timezone=True)`, Indexed, Not Null — used for LWW conflict resolution)
   - `deleted_at` (`DateTime(timezone=True)`, Nullable — soft delete tombstone)

3. **`habit_logs`** (Daily Check-Off Records)
   - `id` (`String(36)`, PK, UUIDv4)
   - `habit_id` (`String(36)`, FK $\rightarrow$ `habits.id`, Indexed, Not Null)
   - `user_id` (`String(36)`, FK $\rightarrow$ `users.id`, Indexed, Not Null)
   - `log_date` (`String(10)`, Indexed, Not Null — ISO local date `'YYYY-MM-DD'`)
   - `completed` (`Boolean`, Not Null, default `True`)
   - `note` (`String(280)`, Nullable)
   - `created_at` (`DateTime(timezone=True)`, Not Null)
   - `updated_at` (`DateTime(timezone=True)`, Indexed, Not Null — LWW timestamp)
   - `deleted_at` (`DateTime(timezone=True)`, Nullable)
   - *Unique Constraint*: `(habit_id, log_date)` so toggling a habit on a specific date updates the deterministic record for that day.

4. **`focus_sessions`**
   - `id` (`String(36)`, PK, UUIDv4)
   - `user_id` (`String(36)`, FK $\rightarrow$ `users.id`, Indexed, Not Null)
   - `habit_id` (`String(36)`, FK $\rightarrow$ `habits.id`, Nullable, Indexed — optional linked habit)
   - `planned_duration_sec` (`Integer`, Not Null — e.g., `1500`, `3000`, `5400`, or custom)
   - `actual_duration_sec` (`Integer`, Not Null, default `0`)
   - `status` (`String(20)`, Not Null — `'in_progress'` | `'completed'` | `'cancelled'`)
   - `started_at` (`DateTime(timezone=True)`, Indexed, Not Null)
   - `ended_at` (`DateTime(timezone=True)`, Nullable)
   - `dnd_requested` (`Boolean`, Not Null, default `True`)
   - `dnd_applied_mode` (`String(30)`, Not Null — `'native_os'` | `'shortcut_bridge'` | `'in_app_fullscreen'` | `'none'`)
   - `previous_dnd_state` (`String(50)`, Nullable — serialized prior OS interruption state for restoration)
   - `updated_at` (`DateTime(timezone=True)`, Indexed, Not Null — LWW timestamp)
   - `deleted_at` (`DateTime(timezone=True)`, Nullable)

#### Backend REST API Specification

| Endpoint | Method | Auth | Purpose & Payload |
| :--- | :--- | :--- | :--- |
| `/auth/register` | `POST` | Public | Creates user (`email`, `password`, `display_name`), hashes password, returns JWT access token + user profile. |
| `/auth/login` | `POST` | Public | Verifies credentials, returns signed JWT (`Bearer` token) + user profile. |
| `/habits` | `GET` | JWT | Lists all active (non-deleted) habits for the authenticated user, along with today's check-off status and current streak. |
| `/habits` | `POST` | JWT | Creates a new habit with schedule configuration and client/server UUID. |
| `/habits/{id}` | `PUT` / `PATCH` | JWT | Updates habit metadata, schedule, or color; updates `updated_at`. |
| `/habits/{id}` | `DELETE` | JWT | Soft-deletes a habit (`deleted_at = now()`, `updated_at = now()`) for clean sync propagation. |
| `/habits/{id}/check` | `POST` | JWT | One-tap toggle or explicit check-off for `log_date` (defaults to today `'YYYY-MM-DD'`), upserting `habit_logs` and returning updated streak metrics. |
| `/sessions/start` | `POST` | JWT | Starts a new focus session (`planned_duration_sec`, optional `habit_id`, `dnd_applied_mode`, `previous_dnd_state`). |
| `/sessions/end` | `POST` | JWT | Completes or cancels an active session (`session_id`, `status`, `actual_duration_sec`, `auto_check_habit`). |
| `/sessions/stats` | `GET` | JWT | Returns daily and weekly focus time totals, session completion rate, per-habit focus breakdown, and recent session history. |
| `/stats/streaks` | `GET` | JWT | Returns current streak, longest streak, 7-day / 30-day completion percentages, and weekly/monthly chart series across all habits. |
| `/sync` | `POST` | JWT | Accepts `{ last_synced_at, changes: { habits, habit_logs, focus_sessions } }`. Applies LWW by comparing `updated_at` per UUID (and `(habit_id, log_date)` for logs), persists winning rows, and returns `{ server_time, changes, conflicts_resolved }`. |

#### Interactive Component & State Mapping

- **Dashboard View**: Displays today's date selector, 4 top-level tabular KPI cards, the interactive habit checklist with one-tap check-off and quick "Focus" launch button per habit, and an active session mini-player if a timer is running.
- **Habits & Analytics View**: Full CRUD habit manager (create/edit modal with icon, color, and weekday/count schedule pickers, plus archive/delete) alongside interactive weekly/monthly completion bar charts and per-habit streak breakdowns.
- **Focus Studio & DND Center**: Preset selector (`25 min`, `50 min`, `90 min`, `Custom`), habit linker dropdown, automatic DND toggle with live OS state badge (`Previous DND State -> Active DND -> Restored State`), platform setup guides (Android Policy Access, iOS Focus Filter/Shortcuts, Windows PowerShell Helper), and the Full-Screen Focus Mode overlay.
- **Sync & Architecture Explorer View**: Live offline/online toggle simulator, outbox queue viewer, one-click batch sync trigger, conflict resolution log, and an interactive monorepo deliverables explorer so you can inspect and copy the exact Python FastAPI, React Native, Electron, and Native DND module files directly from the UI as well as the workspace filesystem.
