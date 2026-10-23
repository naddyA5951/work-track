/**
 * Mobile Cross-Platform DND & Notification Blocker Manager
 * (Android Native NotificationManager.setInterruptionFilter + iOS Shortcuts/Focus Filter +
 *  In-App Notification Quarantine Queue & Fullscreen Lockout Fallback)
 */

import { NativeModules, Platform, Linking } from 'react-native';

const { QuietPulseDnd } = NativeModules;

export class MobileDndManager {
  constructor() {
    this.previousFilterInt = 1; // 1 = INTERRUPTION_FILTER_ALL on Android
    this.previousFilterName = 'INTERRUPTION_FILTER_ALL';
    this.activeFilterName = 'INTERRUPTION_FILTER_ALL';
    this.isDndActive = false;
    this.iosShortcutConfigured = false;
    this.quarantinedNotifications = [];
    this.policy = {
      allowVipContacts: true,
      allowAlarms: true,
      blacklistedApps: ['Instagram', 'TikTok', 'Discord'],
    };
  }

  setIosShortcutConfigured(configured) {
    this.iosShortcutConfigured = Boolean(configured);
  }

  /**
   * Intercepts incoming notifications while DND is active and either blocks/quarantines
   * them in the vault or allows priority VIP/Alarm alerts through.
   */
  interceptNotification(notification) {
    const app = notification.app || 'App';
    const category = notification.category || 'social';

    if (!this.isDndActive && !this.policy.blacklistedApps.includes(app)) {
      return { blocked: false, reason: 'DND Inactive (INTERRUPTION_FILTER_ALL)' };
    }

    if (this.activeFilterName === 'INTERRUPTION_FILTER_PRIORITY') {
      if (category === 'alarm' && this.policy.allowAlarms) {
        return { blocked: false, reason: 'Allowed System Alarm' };
      }
      if (category === 'vip_contact' && this.policy.allowVipContacts) {
        return { blocked: false, reason: 'Allowed VIP Starred Contact' };
      }
    } else if (this.activeFilterName === 'INTERRUPTION_FILTER_ALARMS') {
      if (category === 'alarm') {
        return { blocked: false, reason: 'Allowed System Alarm' };
      }
    }

    const record = {
      ...notification,
      id: notification.id || `${Date.now()}`,
      interceptedAt: new Date().toISOString(),
      filterMode: this.activeFilterName,
    };
    this.quarantinedNotifications.unshift(record);
    return {
      blocked: true,
      reason: `Blocked by ${this.activeFilterName}`,
      record,
    };
  }

  getQuarantinedNotifications() {
    return [...this.quarantinedNotifications];
  }

  flushQuarantinedDigest() {
    const digest = [...this.quarantinedNotifications];
    this.quarantinedNotifications = [];
    return digest;
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
          currentStateName: this.activeFilterName,
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
        currentStateName: this.isDndActive ? 'IOS_FOCUS_DO_NOT_DISTURB' : 'IOS_STANDARD_MODE',
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
  async activateForSession(targetFilter = 'INTERRUPTION_FILTER_PRIORITY') {
    this.isDndActive = true;
    this.activeFilterName = targetFilter;

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

    // Universal fallback: Full-screen in-app focus mode + Notification Firewall
    return {
      appliedMode: 'in_app_fullscreen',
      previousState: this.previousFilterName,
      fullscreenFallback: true,
    };
  }

  /**
   * Restores the exact previous DND state when a Focus Session ends or is cancelled,
   * and returns the digest of any notifications blocked during the session.
   */
  async restoreAfterSession(appliedMode) {
    this.isDndActive = false;
    this.activeFilterName = this.previousFilterName || 'INTERRUPTION_FILTER_ALL';
    const blockedDigest = this.flushQuarantinedDigest();

    if (Platform.OS === 'android' && QuietPulseDnd && appliedMode === 'native_os') {
      await QuietPulseDnd.restoreDnd(this.previousFilterInt);
      return { restored: true, blockedDigest };
    }

    if (Platform.OS === 'ios' && appliedMode === 'shortcut_bridge') {
      const shortcutUrl = 'shortcuts://run-shortcut?name=QuietPulse%20DND&input=off';
      const supported = await Linking.canOpenURL(shortcutUrl);
      if (supported) {
        await Linking.openURL(shortcutUrl);
        return { restored: true, blockedDigest };
      }
    }

    return { restored: true, mode: 'in_app_fullscreen_closed', blockedDigest };
  }
}

export const mobileDndManager = new MobileDndManager();
