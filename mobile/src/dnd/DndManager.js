/**
 * Mobile Cross-Platform DND Manager (Android Native Module + iOS Shortcuts/Focus Filter + Fullscreen Fallback)
 */

import { NativeModules, Platform, Linking } from 'react-native';

const { QuietPulseDnd } = NativeModules;

export class MobileDndManager {
  constructor() {
    this.previousFilterInt = 1; // 1 = INTERRUPTION_FILTER_ALL on Android
    this.previousFilterName = 'INTERRUPTION_FILTER_ALL';
    this.iosShortcutConfigured = false;
  }

  setIosShortcutConfigured(configured) {
    this.iosShortcutConfigured = Boolean(configured);
  }

  /**
   * Checks whether the current mobile platform can toggle system DND or requires setup.
   */
  async getCapabilities() {
    if (Platform.OS === 'android') {
      if (!QuietPulseDnd) {
        return {
          platform: 'android',
          canToggleSystemDnd: false,
          permissionGranted: false,
          currentStateName: 'INTERRUPTION_FILTER_ALL',
          reason: 'Native module requires Expo Dev Build (`npx expo run:android`).',
        };
      }
      const status = await QuietPulseDnd.checkPolicyAccess();
      return {
        platform: 'android',
        canToggleSystemDnd: status.granted,
        permissionGranted: status.granted,
        currentStateName: status.filterName,
        currentFilterInt: status.currentFilter,
      };
    }

    if (Platform.OS === 'ios') {
      const canOpenShortcuts = await Linking.canOpenURL('shortcuts://');
      return {
        platform: 'ios',
        canToggleSystemDnd: canOpenShortcuts && this.iosShortcutConfigured,
        permissionGranted: this.iosShortcutConfigured,
        currentStateName: 'IOS_STANDARD_MODE',
        reason:
          'iOS sandboxes direct DND toggles. Uses Apple Shortcuts ("QuietPulse DND") or Focus Filter.',
      };
    }

    return {
      platform: Platform.OS,
      canToggleSystemDnd: false,
      permissionGranted: false,
      currentStateName: 'STANDARD',
    };
  }

  /**
   * Opens Android Notification Policy Access settings screen.
   */
  async openAndroidPolicySettings() {
    if (Platform.OS === 'android' && QuietPulseDnd) {
      return QuietPulseDnd.requestPolicyAccessSettings();
    }
    return false;
  }

  /**
   * Activates DND when a Focus Session starts and captures the prior state for restoration.
   * Falls back to `in_app_fullscreen` if OS permission or Shortcuts automation is unavailable.
   */
  async activateForSession() {
    if (Platform.OS === 'android' && QuietPulseDnd) {
      const res = await QuietPulseDnd.enableDnd();
      if (res && res.applied) {
        this.previousFilterInt = res.previousFilter;
        this.previousFilterName = res.previousFilterName;
        return {
          appliedMode: 'native_os',
          previousState: res.previousFilterName,
          fullscreenFallback: false,
        };
      }
      return {
        appliedMode: 'in_app_fullscreen',
        previousState: 'INTERRUPTION_FILTER_ALL',
        fullscreenFallback: true,
      };
    }

    if (Platform.OS === 'ios' && this.iosShortcutConfigured) {
      const shortcutUrl = 'shortcuts://run-shortcut?name=QuietPulse%20DND&input=on';
      const supported = await Linking.canOpenURL(shortcutUrl);
      if (supported) {
        await Linking.openURL(shortcutUrl);
        return {
          appliedMode: 'shortcut_bridge',
          previousState: 'IOS_FOCUS_OFF',
          fullscreenFallback: false,
        };
      }
    }

    // Universal fallback: Full-screen in-app focus mode
    return {
      appliedMode: 'in_app_fullscreen',
      previousState: this.previousFilterName,
      fullscreenFallback: true,
    };
  }

  /**
   * Restores the exact previous DND state when a Focus Session ends or is cancelled.
   */
  async restoreAfterSession(appliedMode) {
    if (Platform.OS === 'android' && QuietPulseDnd && appliedMode === 'native_os') {
      return QuietPulseDnd.restoreDnd(this.previousFilterInt);
    }

    if (Platform.OS === 'ios' && appliedMode === 'shortcut_bridge') {
      const shortcutUrl = 'shortcuts://run-shortcut?name=QuietPulse%20DND&input=off';
      const supported = await Linking.canOpenURL(shortcutUrl);
      if (supported) {
        await Linking.openURL(shortcutUrl);
        return { restored: true };
      }
    }

    return { restored: true, mode: 'in_app_fullscreen_closed' };
  }
}

export const mobileDndManager = new MobileDndManager();
