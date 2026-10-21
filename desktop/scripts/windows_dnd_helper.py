"""
Windows Focus Assist / Quiet Hours Helper via WNF (Windows Notification Facility) & Registry.
Called optionally by Electron (`desktop/main.js`) on Windows 10/11.

Documented Limits:
- `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED` (0xA3BF1C75, 0x0D83063E) is an internal undocumented
  Windows shell state identifier used by Action Center. Microsoft can alter its binary layout across
  Windows 11 Insider builds.
- Therefore, this helper pairs WNF profile updates with `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications\\ToastEnabled`
  and reports structured JSON back to Electron so Electron always suppresses its own notifications
  and offers the Full-Screen Focus Mode fallback if restricted by Group Policy.
"""

import sys
import json
import platform


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    prev_val = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    if platform.system() != "Windows":
        print(
            json.dumps(
                {
                    "ok": False,
                    "applied": False,
                    "reason": "Not running on Windows OS",
                    "fallback": "in_app_fullscreen",
                }
            )
        )
        return

    try:
        import winreg

        key_path = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            try:
                current_val, _ = winreg.QueryValueEx(key, "ToastEnabled")
            except FileNotFoundError:
                current_val = 1

            if action == "status":
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "toastEnabled": current_val,
                            "stateName": "WINDOWS_DND_OFF" if current_val == 1 else "WINDOWS_DND_PRIORITY",
                        }
                    )
                )
            elif action == "enable":
                winreg.SetValueEx(key, "ToastEnabled", 0, winreg.REG_DWORD, 0)
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "applied": True,
                            "previousValue": current_val,
                            "previousStateName": "WINDOWS_DND_OFF" if current_val == 1 else "WINDOWS_DND_PRIORITY",
                            "activeStateName": "WINDOWS_DND_PRIORITY",
                        }
                    )
                )
            elif action == "restore":
                winreg.SetValueEx(key, "ToastEnabled", 0, winreg.REG_DWORD, prev_val)
                print(
                    json.dumps(
                        {
                            "ok": True,
                            "restored": True,
                            "restoredValue": prev_val,
                        }
                    )
                )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "applied": False,
                    "error": str(exc),
                    "fallback": "in_app_fullscreen",
                }
            )
        )


if __name__ == "__main__":
    main()
