<#
.SYNOPSIS
    Windows 10 / 11 Focus Assist & Do Not Disturb Helper for QuietPulse Electron App.

.DESCRIPTION
    Architectural & OS Security Note (Windows Focus Assist Limits):
    Microsoft does not provide a public documented Win32 or WinRT SDK method for standard
    unpackaged desktop applications to toggle Windows 10/11 "Focus Assist" (renamed "Do Not Disturb"
    in Windows 11 22H2+) directly without writing to internal Windows Notification Facility (WNF)
    state (`WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED`) or modifying current-user PushNotifications
    Registry settings (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings`).

    What this script does:
    1. Reads and backs up the current user's `NOC_GLOBAL_SETTING_TOASTS_ENABLED` registry value in
       `HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications` before starting a focus session.
    2. Sets `ToastEnabled = 0` (suppressing Windows Action Center banner toast popups) or invokes
       the Python WNF helper (`windows_dnd_helper.py`) when available.
    3. Restores the exact prior `ToastEnabled` value (`1` or prior integer) when the focus session ends
       or is cancelled.
    4. Returns structured JSON to Electron's `main.js` so the app knows whether OS-level toast suppression
       succeeded or if it should activate QuietPulse's Always-On-Top Full-Screen Focus Mode fallback.
#>

param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("status", "enable", "restore")]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [int]$PreviousValue = 1
)

$ErrorActionPreference = "Stop"
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications"
$ValueName = "ToastEnabled"

try {
    if (-not (Test-Path $RegPath)) {
        New-Item -Path $RegPath -Force | Out-Null
    }

    $currentProp = Get-ItemProperty -Path $RegPath -Name $ValueName -ErrorAction SilentlyContinue
    $currentVal = if ($null -ne $currentProp.$ValueName) { [int]$currentProp.$ValueName } else { 1 }

    if ($Action -eq "status") {
        $out = @{
            ok = $true
            toastEnabled = $currentVal
            stateName = if ($currentVal -eq 0) { "WINDOWS_TOASTS_MUTED" } else { "WINDOWS_TOASTS_ENABLED" }
        }
        Write-Output ($out | ConvertTo-Json -Compress)
        exit 0
    }

    if ($Action -eq "enable") {
        Set-ItemProperty -Path $RegPath -Name $ValueName -Value 0 -Type DWord
        $out = @{
            ok = $true
            applied = $true
            previousValue = $currentVal
            previousStateName = if ($currentVal -eq 0) { "WINDOWS_TOASTS_MUTED" } else { "WINDOWS_TOASTS_ENABLED" }
            activeStateName = "WINDOWS_TOASTS_MUTED"
        }
        Write-Output ($out | ConvertTo-Json -Compress)
        exit 0
    }

    if ($Action -eq "restore") {
        Set-ItemProperty -Path $RegPath -Name $ValueName -Value $PreviousValue -Type DWord
        $out = @{
            ok = $true
            restored = $true
            restoredValue = $PreviousValue
            restoredStateName = if ($PreviousValue -eq 0) { "WINDOWS_TOASTS_MUTED" } else { "WINDOWS_TOASTS_ENABLED" }
        }
        Write-Output ($out | ConvertTo-Json -Compress)
        exit 0
    }
}
catch {
    $errOut = @{
        ok = $false
        applied = $false
        error = $_.Exception.Message
        fallback = "in_app_fullscreen"
    }
    Write-Output ($errOut | ConvertTo-Json -Compress)
    exit 0
}
