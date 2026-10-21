import AppIntents
import Foundation

/**
 * iOS 16+ Focus Filter Extension for QuietPulse (`SetFocusFilterIntent`).
 *
 * Why this is needed on iOS:
 * Apple does not permit third-party sandboxed iOS applications to toggle system-wide
 * Do Not Disturb / Focus modes directly via a single imperative API call without user
 * involvement. QuietPulse solves this on iOS with a dual approach:
 *
 * 1. `QuietPulseFocusFilter` (this AppIntent): Allows iOS Focus (Settings -> Focus -> Work/Do Not Disturb -> Focus Filters)
 *    to automatically notify QuietPulse whenever the user enters or exits a system Focus mode,
 *    and exposes a Shortcut action in the Apple Shortcuts app.
 * 2. Apple Shortcuts URL Automation Bridge (`shortcuts://run-shortcut?name=QuietPulse%20DND&input=on|off`):
 *    Guided one-time setup inside QuietPulse installs a 2-action Shortcut ("Set Focus -> Turn Do Not Disturb On/Off")
 *    so starting or ending a session in QuietPulse triggers the Shortcut or falls back to
 *    QuietPulse's built-in Full-Screen Focus Mode.
 */
@available(iOS 16.0, *)
struct QuietPulseFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "QuietPulse Focus Session Filter"
    static var description: IntentDescription? = IntentDescription(
        "Synchronizes QuietPulse focus sessions and suppresses non-essential habit reminders while Focus is active."
    )

    @Parameter(title: "Silence Habit Reminders", default: true)
    var silenceReminders: Bool

    @Parameter(title: "Auto-Start Deep Work Mode", default: true)
    var autoStartFocusMode: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "QuietPulse Focus Mode",
            subtitle: silenceReminders ? "Reminders Silenced" : "Standard Notifications"
        )
    }

    func perform() async throws -> some IntentResult {
        // Persist Focus Filter state into App Group UserDefaults so React Native can read it
        if let sharedDefaults = UserDefaults(suiteName: "group.com.quietpulse.app") {
            sharedDefaults.set(silenceReminders, forKey: "ios_focus_silence_reminders")
            sharedDefaults.set(autoStartFocusMode, forKey: "ios_focus_auto_start")
            sharedDefaults.set(Date().timeIntervalSince1970, forKey: "ios_focus_updated_at")
        }
        return .result()
    }
}
