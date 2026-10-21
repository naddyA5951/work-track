"""
Pydantic v2 Request & Response Schemas for QuietPulse API.
Handles strict validation for Auth, Habits, Habit Check-Offs, Focus Sessions,
Streak Analytics, and Batch Offline Synchronization.
"""

from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict


# ---------------------------------------------------------------------------
# Authentication Schemas
# ---------------------------------------------------------------------------

class UserRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=100)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: Optional[str] = None
    created_at: datetime


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ---------------------------------------------------------------------------
# Habit & Check-Off Schemas
# ---------------------------------------------------------------------------

class HabitCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default="", max_length=500)
    icon: str = Field(default="check-circle", max_length=50)
    color: str = Field(default="#10B981", max_length=20)
    frequency_type: Literal["daily", "weekdays", "weekly_count"] = "daily"
    target_days: List[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    weekly_target_count: int = Field(default=7, ge=1, le=7)
    default_focus_minutes: int = Field(default=25, ge=1, le=240)
    archived: bool = False
    updated_at: Optional[datetime] = None


class HabitUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    icon: Optional[str] = None
    color: Optional[str] = None
    frequency_type: Optional[Literal["daily", "weekdays", "weekly_count"]] = None
    target_days: Optional[List[int]] = None
    weekly_target_count: Optional[int] = Field(default=None, ge=1, le=7)
    default_focus_minutes: Optional[int] = Field(default=None, ge=1, le=240)
    archived: Optional[bool] = None
    updated_at: Optional[datetime] = None


class HabitCheckRequest(BaseModel):
    log_date: Optional[str] = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Local ISO date YYYY-MM-DD; defaults to server UTC date if omitted.",
    )
    completed: Optional[bool] = None  # If None, toggles current state
    note: Optional[str] = Field(default="", max_length=280)
    updated_at: Optional[datetime] = None


class HabitLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    habit_id: str
    user_id: str
    log_date: str
    completed: bool
    note: Optional[str] = ""
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class HabitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    name: str
    description: Optional[str] = ""
    icon: str
    color: str
    frequency_type: str
    target_days: List[int]
    weekly_target_count: int
    default_focus_minutes: int
    archived: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Focus Session Schemas
# ---------------------------------------------------------------------------

class SessionStartRequest(BaseModel):
    id: Optional[str] = None
    habit_id: Optional[str] = None
    planned_duration_sec: int = Field(default=1500, ge=60, le=28800)
    dnd_requested: bool = True
    dnd_applied_mode: str = "native_os"
    previous_dnd_state: Optional[str] = "INTERRUPTION_FILTER_ALL"
    started_at: Optional[datetime] = None


class SessionEndRequest(BaseModel):
    session_id: str
    status: Literal["completed", "cancelled"] = "completed"
    actual_duration_sec: int = Field(..., ge=0)
    ended_at: Optional[datetime] = None
    auto_check_habit: bool = True
    log_date: Optional[str] = None


class FocusSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    habit_id: Optional[str] = None
    planned_duration_sec: int
    actual_duration_sec: int
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    dnd_requested: bool
    dnd_applied_mode: str
    previous_dnd_state: Optional[str] = None
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class DailyFocusBucket(BaseModel):
    date: str
    minutes: int
    sessions_count: int


class SessionStatsResponse(BaseModel):
    today_focus_minutes: int
    week_focus_minutes: int
    total_focus_minutes: int
    completed_sessions_count: int
    cancelled_sessions_count: int
    completion_rate_percent: int
    daily_breakdown: List[DailyFocusBucket]
    recent_sessions: List[FocusSessionResponse]


# ---------------------------------------------------------------------------
# Streak & Progress Analytics Schemas
# ---------------------------------------------------------------------------

class HabitStreakSummary(BaseModel):
    habit_id: str
    habit_name: str
    color: str
    current_streak: int
    longest_streak: int
    completion_rate_7d: int
    completion_rate_30d: int
    completed_today: bool


class StreaksOverviewResponse(BaseModel):
    overall_current_streak: int
    overall_longest_streak: int
    today_completed_count: int
    today_scheduled_count: int
    today_completion_percent: int
    habit_streaks: List[HabitStreakSummary]
    weekly_series: List[dict]
    monthly_series: List[dict]


# ---------------------------------------------------------------------------
# Offline Batch Sync Schemas (Last-Write-Wins)
# ---------------------------------------------------------------------------

class SyncHabitPayload(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    icon: str = "check-circle"
    color: str = "#10B981"
    frequency_type: str = "daily"
    target_days: List[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    weekly_target_count: int = 7
    default_focus_minutes: int = 25
    archived: bool = False
    created_at: Optional[datetime] = None
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class SyncHabitLogPayload(BaseModel):
    id: str
    habit_id: str
    log_date: str
    completed: bool
    note: Optional[str] = ""
    created_at: Optional[datetime] = None
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class SyncFocusSessionPayload(BaseModel):
    id: str
    habit_id: Optional[str] = None
    planned_duration_sec: int
    actual_duration_sec: int
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    dnd_requested: bool = True
    dnd_applied_mode: str = "native_os"
    previous_dnd_state: Optional[str] = None
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class SyncChangesBundle(BaseModel):
    habits: List[SyncHabitPayload] = Field(default_factory=list)
    habit_logs: List[SyncHabitLogPayload] = Field(default_factory=list)
    focus_sessions: List[SyncFocusSessionPayload] = Field(default_factory=list)


class SyncRequest(BaseModel):
    last_synced_at: Optional[datetime] = None
    changes: SyncChangesBundle


class SyncResponse(BaseModel):
    server_time: datetime
    applied_counts: dict
    conflicts_resolved: int
    changes: dict
