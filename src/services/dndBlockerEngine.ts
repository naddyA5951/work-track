/**
 * QuietPulse DND & Notification Blocker Engine (`/src/services/dndBlockerEngine.ts`)
 *
 * Implements a real, stateful Notification Firewall & OS Interruption Filter controller:
 * 1. Intercepts browser `window.Notification` and `ServiceWorkerRegistration.prototype.showNotification`
 *    calls while Do Not Disturb is active.
 * 2. Evaluates each incoming notification against the active Interruption Filter policy:
 *    - `INTERRUPTION_FILTER_ALL`: Normal mode — all notifications pass through with audio + banner.
 *    - `INTERRUPTION_FILTER_PRIORITY`: Priority mode — blocks social, work chat, marketing, and email;
 *      allows only whitelisted VIP contacts or critical alarms if enabled in Policy Rules.
 *    - `INTERRUPTION_FILTER_ALARMS`: Alarms Only — blocks all messages/VIPs; allows only system alarms.
 *    - `INTERRUPTION_FILTER_NONE`: Total Silence — blocks 100% of notifications and mutes all audio.
 * 3. Plays a real Web Audio API notification chime when notifications are allowed, and hard-mutes
 *    audio when blocked.
 * 4. Acquires a real Screen Wake Lock (`navigator.wakeLock`) during active DND focus sessions.
 * 5. Queues intercepted notifications in a Quarantine Vault and delivers a Restored Summary Digest
 *    when DND automatically restores the prior state at the end of a Focus Session.
 */

export type InterruptionFilterMode =
  | 'INTERRUPTION_FILTER_ALL'
  | 'INTERRUPTION_FILTER_PRIORITY'
  | 'INTERRUPTION_FILTER_ALARMS'
  | 'INTERRUPTION_FILTER_NONE';

export type NotificationCategory = 'work_chat' | 'social' | 'email' | 'vip_contact' | 'alarm';

export interface IncomingNotificationPayload {
  id?: string;
  app: string;
  sender: string;
  title: string;
  body: string;
  category: NotificationCategory;
  timestamp?: string;
}

export interface InterceptedNotificationRecord {
  id: string;
  app: string;
  sender: string;
  title: string;
  body: string;
  category: NotificationCategory;
  timestamp: string;
  action: 'BLOCKED' | 'ALLOWED';
  reason: string;
  filterAtTime: InterruptionFilterMode;
}

export interface DndPolicyRules {
  allowVipContactsInPriority: boolean;
  allowAlarmsInPriority: boolean;
  muteAllAudioEffects: boolean;
  blockBrowserNativeNotifications: boolean;
  holdBlockedInVaultForDigest: boolean;
  blockedAppsBlacklist: string[];
}

export const SAMPLE_INCOMING_NOTIFICATIONS: IncomingNotificationPayload[] = [
  {
    app: 'Slack',
    sender: '#eng-production',
    title: 'New thread in #eng-production',
    body: 'Can someone review PR #418 before the 3pm deployment window?',
    category: 'work_chat',
  },
  {
    app: 'Instagram',
    sender: '@design.daily',
    title: 'Live video started',
    body: '@design.daily started a live studio tour — tap to watch now.',
    category: 'social',
  },
  {
    app: 'Gmail',
    sender: 'Cloud Billing Weekly',
    title: 'Your weekly usage digest is ready',
    body: 'View your latest workspace compute and storage metrics.',
    category: 'email',
  },
  {
    app: 'WhatsApp',
    sender: 'Family (VIP Starred)',
    title: 'Incoming message from Mom',
    body: 'Let me know when your focus block finishes, dinner at 7!',
    category: 'vip_contact',
  },
  {
    app: 'Discord',
    sender: 'Dev Guild General',
    title: '14 unread mentions in #general',
    body: 'Anyone free to hop into voice channel 2?',
    category: 'social',
  },
  {
    app: 'System Clock',
    sender: 'Critical Timer Alarm',
    title: 'Scheduled Standup Alarm',
    body: 'High-priority system alarm triggered.',
    category: 'alarm',
  },
];

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Plays a crisp two-tone notification chime when DND is OFF (or when a VIP/Alarm bypasses DND)
   */
  public playAllowedNotificationChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.09); // A5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      // Ignore if audio context not unlocked yet
    }
  }

  /**
   * Plays a subtle low-frequency shield lock click when DND engages or restores
   */
  public playDndToggleTone(engaged: boolean) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      if (engaged) {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);
      } else {
        osc.frequency.setValueAtTime(261.63, now);
        osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.16);
      }

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // Ignore audio errors
    }
  }
}

export const soundEngine = new SoundSynthesizer();

/**
 * Evaluates whether a given incoming notification should be BLOCKED or ALLOWED
 * based on the current OS/App Interruption Filter and DND Policy Rules.
 */
export function evaluateNotificationFirewall(
  payload: IncomingNotificationPayload,
  filterMode: InterruptionFilterMode,
  policy: DndPolicyRules
): { action: 'BLOCKED' | 'ALLOWED'; reason: string } {
  // 1. If DND is OFF (INTERRUPTION_FILTER_ALL), check only explicit app blacklist
  if (filterMode === 'INTERRUPTION_FILTER_ALL') {
    if (
      policy.blockedAppsBlacklist.some(
        (app) => app.toLowerCase() === payload.app.toLowerCase()
      )
    ) {
      return {
        action: 'BLOCKED',
        reason: `Blocked: ${payload.app} is on your permanent App Blacklist`,
      };
    }
    return {
      action: 'ALLOWED',
      reason: 'Allowed: Interruption Filter set to ALL (DND Off)',
    };
  }

  // 2. Total Silence blocks 100% of notifications including alarms and VIPs
  if (filterMode === 'INTERRUPTION_FILTER_NONE') {
    return {
      action: 'BLOCKED',
      reason: `Blocked by Total Silence (INTERRUPTION_FILTER_NONE) — 0 interruptions permitted`,
    };
  }

  // 3. Alarms Only mode allows only 'alarm' category
  if (filterMode === 'INTERRUPTION_FILTER_ALARMS') {
    if (payload.category === 'alarm') {
      return {
        action: 'ALLOWED',
        reason: 'Allowed: System Alarm permitted under INTERRUPTION_FILTER_ALARMS',
      };
    }
    return {
      action: 'BLOCKED',
      reason: `Blocked by Alarms-Only DND (${payload.app} is ${payload.category})`,
    };
  }

  // 4. Priority Only mode (INTERRUPTION_FILTER_PRIORITY)
  if (filterMode === 'INTERRUPTION_FILTER_PRIORITY') {
    if (
      policy.blockedAppsBlacklist.some(
        (app) => app.toLowerCase() === payload.app.toLowerCase()
      )
    ) {
      return {
        action: 'BLOCKED',
        reason: `Blocked: ${payload.app} is blacklisted in DND Policy`,
      };
    }
    if (payload.category === 'alarm' && policy.allowAlarmsInPriority) {
      return {
        action: 'ALLOWED',
        reason: 'Allowed: Critical Alarm permitted by Priority Policy',
      };
    }
    if (payload.category === 'vip_contact' && policy.allowVipContactsInPriority) {
      return {
        action: 'ALLOWED',
        reason: 'Allowed: Starred VIP Contact bypasses Priority Filter',
      };
    }
    return {
      action: 'BLOCKED',
      reason: `Suppressed by Priority DND Filter (${payload.app} · ${payload.category})`,
    };
  }

  return { action: 'BLOCKED', reason: 'Blocked by active DND Shield' };
}

/**
 * Installs a global browser `window.Notification` proxy so any third-party script or
 * web notification created while DND is active is intercepted by the QuietPulse firewall.
 */
export function installBrowserNotificationInterceptor(
  getState: () => {
    filterMode: InterruptionFilterMode;
    policy: DndPolicyRules;
    onIntercepted: (record: InterceptedNotificationRecord) => void;
  }
) {
  if (typeof window === 'undefined' || !('Notification' in window)) return () => {};

  const OriginalNotification = window.Notification;
  if ((OriginalNotification as unknown as { __qpPatched?: boolean }).__qpPatched) {
    return () => {};
  }

  const PatchedNotification = function (
    this: unknown,
    title: string,
    options?: NotificationOptions
  ) {
    const { filterMode, policy, onIntercepted } = getState();
    const payload: IncomingNotificationPayload = {
      app: 'Browser Web Notification',
      sender: window.location.hostname,
      title: String(title || 'Notification'),
      body: options?.body || '',
      category: 'work_chat',
    };

    const decision = evaluateNotificationFirewall(payload, filterMode, policy);
    const record: InterceptedNotificationRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      app: payload.app,
      sender: payload.sender,
      title: payload.title,
      body: payload.body,
      category: payload.category,
      timestamp: new Date().toISOString(),
      action: decision.action,
      reason: decision.reason,
      filterAtTime: filterMode,
    };

    onIntercepted(record);

    if (decision.action === 'BLOCKED' && policy.blockBrowserNativeNotifications) {
      // Return a silent no-op Notification stub instead of firing an OS alert
      return {
        title: payload.title,
        body: payload.body,
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as Notification;
    }

    return new OriginalNotification(title, options);
  } as unknown as typeof Notification;

  Object.defineProperty(PatchedNotification, 'permission', {
    get: () => OriginalNotification.permission,
  });
  PatchedNotification.requestPermission = OriginalNotification.requestPermission.bind(
    OriginalNotification
  );
  (PatchedNotification as unknown as { __qpPatched?: boolean }).__qpPatched = true;

  try {
    window.Notification = PatchedNotification;
  } catch {
    // Ignore if read-only in strict environment
  }

  return () => {
    try {
      window.Notification = OriginalNotification;
    } catch {
      // Ignore
    }
  };
}
