package com.quietpulse.dnd;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

/**
 * Native Android Do Not Disturb (DND) Module for QuietPulse.
 *
 * Uses android.app.NotificationManager to:
 * 1. Check whether the user has granted Notification Policy Access (`isNotificationPolicyAccessGranted()`).
 * 2. Launch the system permission settings screen (`Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`).
 * 3. Read the current interruption filter (`getCurrentInterruptionFilter()`) before starting a focus session.
 * 4. Enable Priority DND (`INTERRUPTION_FILTER_PRIORITY`) when a focus session starts.
 * 5. Restore the exact previous interruption filter when the focus session completes or is cancelled.
 */
public class DndModule extends ReactContextBaseJavaModule {
    private static final String MODULE_NAME = "QuietPulseDnd";
    private final ReactApplicationContext reactContext;

    public DndModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    private NotificationManager getNotificationManager() {
        return (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    @ReactMethod
    public void checkPolicyAccess(Promise promise) {
        try {
            NotificationManager nm = getNotificationManager();
            boolean granted = false;
            int currentFilter = NotificationManager.INTERRUPTION_FILTER_ALL;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null) {
                granted = nm.isNotificationPolicyAccessGranted();
                currentFilter = nm.getCurrentInterruptionFilter();
            }
            WritableMap result = Arguments.createMap();
            result.putBoolean("granted", granted);
            result.putInt("currentFilter", currentFilter);
            result.putString("filterName", filterToName(currentFilter));
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("DND_CHECK_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void requestPolicyAccessSettings(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                reactContext.startActivity(intent);
                promise.resolve(true);
            } else {
                promise.resolve(false);
            }
        } catch (Exception e) {
            promise.reject("DND_INTENT_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Captures the user's current interruption filter and switches Android into Priority DND.
     */
    @ReactMethod
    public void enableDnd(Promise promise) {
        try {
            NotificationManager nm = getNotificationManager();
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || nm == null) {
                promise.reject("DND_UNSUPPORTED", "Android API 23+ is required for NotificationManager DND.");
                return;
            }
            if (!nm.isNotificationPolicyAccessGranted()) {
                WritableMap denied = Arguments.createMap();
                denied.putBoolean("applied", false);
                denied.putString("reason", "PERMISSION_REQUIRED");
                promise.resolve(denied);
                return;
            }

            int previousFilter = nm.getCurrentInterruptionFilter();
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);

            WritableMap res = Arguments.createMap();
            res.putBoolean("applied", true);
            res.putInt("previousFilter", previousFilter);
            res.putString("previousFilterName", filterToName(previousFilter));
            res.putInt("activeFilter", NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            promise.resolve(res);
        } catch (Exception e) {
            promise.reject("DND_ENABLE_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Restores the exact interruption filter that was active before the focus session began.
     */
    @ReactMethod
    public void restoreDnd(int previousFilter, Promise promise) {
        try {
            NotificationManager nm = getNotificationManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && nm != null && nm.isNotificationPolicyAccessGranted()) {
                int targetFilter = previousFilter > 0
                        ? previousFilter
                        : NotificationManager.INTERRUPTION_FILTER_ALL;
                nm.setInterruptionFilter(targetFilter);
                WritableMap res = Arguments.createMap();
                res.putBoolean("restored", true);
                res.putInt("restoredFilter", targetFilter);
                res.putString("restoredFilterName", filterToName(targetFilter));
                promise.resolve(res);
            } else {
                WritableMap res = Arguments.createMap();
                res.putBoolean("restored", false);
                promise.resolve(res);
            }
        } catch (Exception e) {
            promise.reject("DND_RESTORE_ERROR", e.getMessage(), e);
        }
    }

    private String filterToName(int filter) {
        switch (filter) {
            case NotificationManager.INTERRUPTION_FILTER_ALL:
                return "INTERRUPTION_FILTER_ALL";
            case NotificationManager.INTERRUPTION_FILTER_PRIORITY:
                return "INTERRUPTION_FILTER_PRIORITY";
            case NotificationManager.INTERRUPTION_FILTER_NONE:
                return "INTERRUPTION_FILTER_NONE";
            case NotificationManager.INTERRUPTION_FILTER_ALARMS:
                return "INTERRUPTION_FILTER_ALARMS";
            default:
                return "INTERRUPTION_FILTER_UNKNOWN";
        }
    }
}
