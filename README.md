# QuietPulse — Cross-Platform Daily Habit Tracker & Automatic DND Focus System

QuietPulse is an offline-first, cross-platform daily habit tracker with automatic **Do Not Disturb (DND)** focus sessions. It is architected as a monorepo sharing plain-JavaScript domain models, streak/analytics engines, REST API client, and Last-Write-Wins (LWW) synchronization across **Android**, **iOS**, **Windows Desktop (Electron)**, and **Web**, backed by **Python (FastAPI) + PostgreSQL/SQLite (SQLAlchemy)** with JWT authentication.

---

## Monorepo Architecture

- `/shared`: Plain-JavaScript ES module package (`models.js`, `stats.js`, `apiClient.js`, `syncEngine.js`) shared across Mobile, Desktop, and Web.
- `/backend`: Python FastAPI server (`main.py`, `models.py`, `schemas.py`, `auth.py`, `database.py`, `seed.py`, `requirements.txt`) supporting PostgreSQL in production and SQLite in local development.
- `/mobile`: React Native (JavaScript) + Expo Dev Build app (`App.js`, `src/dnd/DndManager.js`, Android native `DndModule.java`, iOS `QuietPulseFocusExtension.swift`).
- `/desktop`: Windows Electron + React app (`main.js`, `preload.js`, `scripts/windows-dnd-helper.ps1`, `scripts/windows_dnd_helper.py`, `src/App.jsx`).
- `/src` & `/server.ts`: Live full-stack interactive workspace preview running on Port 3000.

---

## Setup & Run Instructions by Platform

### 1. Backend (Python FastAPI + PostgreSQL / SQLite)

```bash
cd backend
python -m venv .venv
# Activate venv:
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt

# Seed realistic demo user, habits, 30-day check-off logs, and focus sessions:
python seed.py
# Demo credentials created:
# Email: alex@quietpulse.app
# Password: password123

# Start FastAPI server (defaults to SQLite ./quietpulse.db; set DATABASE_URL=postgresql://... for Postgres):
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Shared Package (`/shared`)

`/shared` is pure ES module JavaScript with zero external runtime dependencies. Both `/mobile`, `/desktop`, and the root workspace import it directly via relative path or `"@quietpulse/shared": "file:../shared"`.

### 3. Mobile App (Android & iOS — React Native + Expo Dev Build)

Because Android requires a custom native Java module (`DndModule.java` calling `NotificationManager.setInterruptionFilter`) and iOS uses `AppIntents` (`SetFocusFilterIntent`) + `shortcuts://` URL schemes, use an **Expo Dev Build** (`expo-dev-client`) rather than standard Expo Go:

```bash
cd mobile
npm install

# Generate native android/ and ios/ directories and link DndPackage:
npx expo prebuild

# Run on Android Emulator or physical USB device:
npx expo run:android

# Run on iOS Simulator or physical iPhone (macOS with Xcode required):
npx expo run:ios
```

#### Building Production Mobile Binaries (APK / AAB / IPA)

- **Android Release APK / AAB**:
  ```bash
  cd mobile/android
  ./gradlew assembleRelease      # Outputs APK in app/build/outputs/apk/release/
  ./gradlew bundleRelease        # Outputs Play Store AAB in app/build/outputs/bundle/release/
  ```
- **iOS Release Archive (IPA)**:
  Open `mobile/ios/QuietPulse.xcworkspace` in Xcode, select your Apple Developer Team under **Signing & Capabilities**, add the **Focus** capability for the `QuietPulseFocusFilter` extension, and run **Product → Archive**.

### 4. Windows Desktop App (Electron + React) & `.exe` Installer

```bash
cd desktop
npm install

# Run in local development mode:
npm run dev

# Build the Windows .exe NSIS installer (outputs to desktop/release/QuietPulse Setup 1.0.0.exe):
npm run build:renderer
npm run dist:win
```

---

## Platform Do Not Disturb (DND) Implementation & Limits

1. **Android (`DndModule.java`)**:
   - Uses `NotificationManager.isNotificationPolicyAccessGranted()` to check permission.
   - Displays a dedicated explanation screen before opening `Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`.
   - Captures `NotificationManager.getCurrentInterruptionFilter()` prior to enabling `INTERRUPTION_FILTER_PRIORITY`, and restores the exact prior filter when the focus session ends or is cancelled.
2. **iOS (`QuietPulseFocusExtension.swift` + Apple Shortcuts)**:
   - iOS sandboxes third-party apps from mutating system-wide DND directly without user automation.
   - Implements a native iOS 16+ `SetFocusFilterIntent` (`QuietPulseFocusFilter`) AND an Apple Shortcuts URL bridge (`shortcuts://run-shortcut?name=QuietPulse%20DND&input=on|off`) with a one-time guided setup screen.
3. **Windows (`windows-dnd-helper.ps1` & `windows_dnd_helper.py`)**:
   - Windows 10/11 does not expose an official public Win32 API for third-party unpackaged apps to toggle Focus Assist.
   - Our Electron main process invokes `windows-dnd-helper.ps1` (or `windows_dnd_helper.py`), which backs up `HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications\ToastEnabled`, sets `ToastEnabled = 0` during the focus session to silence Windows Action Center toast popups, suppresses all internal Electron notifications, and restores the original registry state when the session ends.
4. **Universal Fallback (All Platforms)**:
   - Whenever OS-level DND permission is not granted or restricted by OS policy, QuietPulse automatically activates its **Full-Screen Focus Lockout Mode** (`setFullScreen(true)` + `setAlwaysOnTop(true, 'screen-saver')` on Desktop; full-screen modal lockout on Mobile/Web) and suppresses all in-app notifications.
