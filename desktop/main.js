/**
 * QuietPulse Electron Main Process (`desktop/main.js`)
 * Manages the Windows Desktop window, background focus timer resilience,
 * PowerShell / Python Windows Focus Assist bridge, app-own notification suppression,
 * and Always-On-Top Full-Screen Focus Mode fallback.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

let mainWindow = null;
let appNotificationsSuppressed = false;
let savedWindowsDndState = 1; // 1 = ToastEnabled (normal), 0 = Muted

function runWindowsDndHelper(action, previousValue = 1) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({
        ok: false,
        applied: false,
        reason: 'Host OS is not Windows; activating Full-Screen Focus Mode + App Notification Suppression.',
        fallback: 'in_app_fullscreen',
      });
      return;
    }

    const psScript = path.join(__dirname, 'scripts', 'windows-dnd-helper.ps1');
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      psScript,
      '-Action',
      action,
      '-PreviousValue',
      String(previousValue),
    ];

    execFile('powershell.exe', args, { timeout: 4000 }, (err, stdout) => {
      if (err) {
        resolve({
          ok: false,
          applied: false,
          error: err.message,
          fallback: 'in_app_fullscreen',
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (parseErr) {
        resolve({
          ok: false,
          applied: false,
          error: parseErr.message,
          fallback: 'in_app_fullscreen',
        });
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 380,
    minHeight: 620,
    backgroundColor: '#0B0F17',
    title: 'QuietPulse — Daily Habit Tracker & Focus Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Prevents timer drift when window is minimized/backgrounded
    },
  });

  const devServerUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  if (!app.isPackaged) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  // IPC: Query Windows Focus Assist / DND Status
  ipcMain.handle('dnd:status', async () => {
    const res = await runWindowsDndHelper('status');
    return {
      ...res,
      appNotificationsSuppressed,
    };
  });

  // IPC: Enable Windows DND + suppress app's own notifications
  ipcMain.handle('dnd:enable', async (_event, { requestFullscreenFallback = false } = {}) => {
    appNotificationsSuppressed = true;
    const res = await runWindowsDndHelper('enable');

    if (res && res.ok && res.applied) {
      savedWindowsDndState = typeof res.previousValue === 'number' ? res.previousValue : 1;
      return {
        appliedMode: 'native_os',
        previousState: res.previousStateName || 'WINDOWS_TOASTS_ENABLED',
        appNotificationsSuppressed: true,
        fullscreenFallback: false,
      };
    }

    // Fallback: suppress app's own notifications + engage Full-Screen Focus Mode
    if (mainWindow && requestFullscreenFallback) {
      mainWindow.setFullScreen(true);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    return {
      appliedMode: 'in_app_fullscreen',
      previousState: 'WINDOWS_TOASTS_ENABLED',
      appNotificationsSuppressed: true,
      fullscreenFallback: true,
    };
  });

  // IPC: Restore previous Windows DND state when session completes or is cancelled
  ipcMain.handle('dnd:restore', async () => {
    appNotificationsSuppressed = false;
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(false);
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
    }
    const res = await runWindowsDndHelper('restore', savedWindowsDndState);
    return {
      restored: true,
      osResult: res,
      appNotificationsSuppressed: false,
    };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
