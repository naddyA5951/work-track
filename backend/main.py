"""
QuietPulse FastAPI Server
=========================
Provides REST API for cross-platform Habit Tracking, Automatic DND Focus Sessions,
Streak Analytics, and Offline-First Batch Synchronization (Last-Write-Wins).
"""

import uuid
from datetime import datetime, timedelta, timezone, date
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import engine, Base, get_db
from models import User, Habit, HabitLog, FocusSession, utc_now
from schemas import (
    UserRegisterRequest,
    UserLoginRequest,
    UserResponse,
    AuthTokenResponse,
    HabitCreateRequest,
    HabitUpdateRequest,
    HabitCheckRequest,
    HabitResponse,
    HabitLogResponse,
    SessionStartRequest,
    SessionEndRequest,
    FocusSessionResponse,
    SessionStatsResponse,
    DailyFocusBucket,
    StreaksOverviewResponse,
    HabitStreakSummary,
    SyncRequest,
    SyncResponse,
)
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)

# Initialize database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="QuietPulse API",
    description="Cross-platform Daily Habit Tracker & Automatic DND Focus Session API",
    version="1.0.0",
)

# Enable CORS for React Native, Electron Desktop, and Web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_utc(dt: Optional[datetime]) -> datetime:
    """
    Tricky part: SQLite strips tzinfo when reading back DateTime columns, whereas
    PostgreSQL preserves tzinfo. Normalize any datetime to timezone-aware UTC
    before comparing timestamps during Last-Write-Wins conflict resolution.
    """
    if dt is None:
        return utc_now()
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def is_scheduled_for_date(habit: Habit, target_date: date) -> bool:
    """
    Determines whether a habit is scheduled on a given calendar date.
     Python's date.weekday() returns 0 for Monday .. 6 for Sunday.
    """
    if habit.frequency_type == "daily":
        return True
    weekday = target_date.weekday()
    target_days = habit.target_days if isinstance(habit.target_days, list) else [0, 1, 2, 3, 4, 5, 6]
    if habit.frequency_type == "weekdays":
        return weekday in target_days
    # For 'weekly_count', any day can contribute to the weekly quota
    return True


def compute_habit_streak_and_rates(
    habit: Habit, logs: List[HabitLog], reference_date: date
) -> dict:
    """
    Computes current_streak, longest_streak, 7-day completion %, and 30-day completion %.
    Tricky part:
    - Unscheduled weekdays do NOT break a streak (e.g. a Mon/Wed/Fri habit checked on
      Monday and Wednesday stays unbroken on Tuesday and Thursday).
    - If today is scheduled but not yet checked off, we preserve the streak accumulated
      through yesterday so the user's streak doesn't drop to 0 every morning before they
      complete today's habit.
    """
    completed_dates = {
        log.log_date
        for log in logs
        if log.completed and log.deleted_at is None
    }

    today_iso = reference_date.isoformat()
    completed_today = today_iso in completed_dates

    # 1. Calculate current streak walking backwards from reference_date (up to 365 days)
    current_streak = 0
    cursor = reference_date
    for i in range(365):
        iso = cursor.isoformat()
        scheduled = is_scheduled_for_date(habit, cursor)
        if iso in completed_dates:
            current_streak += 1
        elif scheduled:
            # If cursor is today and not yet completed, allow streak from yesterday to stand
            if i == 0:
                pass
            else:
                break
        cursor -= timedelta(days=1)

    # 2. Calculate longest streak over the last 180 days
    longest_streak = current_streak
    running = 0
    start_scan = reference_date - timedelta(days=180)
    for offset in range(181):
        d = start_scan + timedelta(days=offset)
        iso = d.isoformat()
        scheduled = is_scheduled_for_date(habit, d)
        if iso in completed_dates:
            running += 1
            if running > longest_streak:
                longest_streak = running
        elif scheduled and d < reference_date:
            running = 0

    # 3. Calculate 7-day and 30-day completion percentages
    def rate_over_window(days_count: int) -> int:
        scheduled_total = 0
        completed_total = 0
        for offset in range(days_count):
            d = reference_date - timedelta(days=offset)
            if is_scheduled_for_date(habit, d):
                scheduled_total += 1
                if d.isoformat() in completed_dates:
                    completed_total += 1
        if scheduled_total == 0:
            return 100
        return min(100, round((completed_total / scheduled_total) * 100))

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "completion_rate_7d": rate_over_window(7),
        "completion_rate_30d": rate_over_window(30),
        "completed_today": completed_today,
    }


# ---------------------------------------------------------------------------
# AUTH ENDPOINTS
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserRegisterRequest, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    existing = db.query(User).filter(User.email == normalized_email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        id=str(uuid.uuid4()),
        email=normalized_email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or normalized_email.split("@")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return AuthTokenResponse(access_token=token, user=UserResponse.model_validate(user))


@app.post("/auth/login", response_model=AuthTokenResponse)
def login_user(payload: UserLoginRequest, db: Session = Depends(get_db)):
    normalized_email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token(user.id, user.email)
    return AuthTokenResponse(access_token=token, user=UserResponse.model_validate(user))


# ---------------------------------------------------------------------------
# HABITS CRUD & ONE-TAP CHECK-OFF
# ---------------------------------------------------------------------------

@app.get("/habits", response_model=List[HabitResponse])
def list_habits(
    include_archived: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Habit).filter(
        Habit.user_id == current_user.id,
        Habit.deleted_at.is_(None),
    )
    if not include_archived:
        query = query.filter(Habit.archived.is_(False))
    return query.order_by(Habit.created_at.asc()).all()


@app.post("/habits", response_model=HabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(
    payload: HabitCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    habit_id = payload.id or str(uuid.uuid4())
    now = ensure_utc(payload.updated_at)

    habit = Habit(
        id=habit_id,
        user_id=current_user.id,
        name=payload.name.strip(),
        description=payload.description or "",
        icon=payload.icon,
        color=payload.color,
        frequency_type=payload.frequency_type,
        target_days=payload.target_days,
        weekly_target_count=payload.weekly_target_count,
        default_focus_minutes=payload.default_focus_minutes,
        archived=payload.archived,
        created_at=now,
        updated_at=now,
    )
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit


@app.put("/habits/{habit_id}", response_model=HabitResponse)
@app.patch("/habits/{habit_id}", response_model=HabitResponse)
def update_habit(
    habit_id: str,
    payload: HabitUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    habit = (
        db.query(Habit)
        .filter(Habit.id == habit_id, Habit.user_id == current_user.id, Habit.deleted_at.is_(None))
        .first()
    )
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field != "updated_at" and value is not None:
            setattr(habit, field, value)

    habit.updated_at = ensure_utc(payload.updated_at)
    db.commit()
    db.refresh(habit)
    return habit


@app.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(
    habit_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    habit = (
        db.query(Habit)
        .filter(Habit.id == habit_id, Habit.user_id == current_user.id, Habit.deleted_at.is_(None))
        .first()
    )
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")

    now = utc_now()
    habit.deleted_at = now
    habit.updated_at = now
    db.commit()
    return None


@app.post("/habits/{habit_id}/check", response_model=HabitLogResponse)
def check_habit(
    habit_id: str,
    payload: HabitCheckRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    One-tap daily check-off endpoint.
    If a log already exists for (habit_id, log_date), toggles or sets its `completed` boolean
    and updates `updated_at` for LWW sync compatibility.
    """
    habit = (
        db.query(Habit)
        .filter(Habit.id == habit_id, Habit.user_id == current_user.id, Habit.deleted_at.is_(None))
        .first()
    )
    if not habit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Habit not found")

    target_date = payload.log_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = ensure_utc(payload.updated_at)

    log = (
        db.query(HabitLog)
        .filter(HabitLog.habit_id == habit_id, HabitLog.log_date == target_date)
        .first()
    )

    if log:
        log.completed = (not log.completed) if payload.completed is None else payload.completed
        if payload.note is not None:
            log.note = payload.note
        log.deleted_at = None
        log.updated_at = now
    else:
        log = HabitLog(
            id=str(uuid.uuid4()),
            habit_id=habit_id,
            user_id=current_user.id,
            log_date=target_date,
            completed=True if payload.completed is None else payload.completed,
            note=payload.note or "",
            created_at=now,
            updated_at=now,
        )
        db.add(log)

    db.commit()
    db.refresh(log)
    return log


# ---------------------------------------------------------------------------
# FOCUS SESSIONS & DND LIFECYCLE
# ---------------------------------------------------------------------------

@app.post("/sessions/start", response_model=FocusSessionResponse, status_code=status.HTTP_201_CREATED)
def start_focus_session(
    payload: SessionStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = ensure_utc(payload.started_at)
    session = FocusSession(
        id=payload.id or str(uuid.uuid4()),
        user_id=current_user.id,
        habit_id=payload.habit_id,
        planned_duration_sec=payload.planned_duration_sec,
        actual_duration_sec=0,
        status="in_progress",
        started_at=now,
        dnd_requested=payload.dnd_requested,
        dnd_applied_mode=payload.dnd_applied_mode,
        previous_dnd_state=payload.previous_dnd_state,
        updated_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@app.post("/sessions/end", response_model=FocusSessionResponse)
def end_focus_session(
    payload: SessionEndRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(FocusSession)
        .filter(
            FocusSession.id == payload.session_id,
            FocusSession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Focus session not found")

    now = ensure_utc(payload.ended_at)
    session.status = payload.status
    session.actual_duration_sec = payload.actual_duration_sec
    session.ended_at = now
    session.updated_at = now

    # Optionally auto-check the linked habit when a focus session completes
    if payload.status == "completed" and payload.auto_check_habit and session.habit_id:
        target_date = payload.log_date or now.strftime("%Y-%m-%d")
        existing_log = (
            db.query(HabitLog)
            .filter(HabitLog.habit_id == session.habit_id, HabitLog.log_date == target_date)
            .first()
        )
        if existing_log:
            existing_log.completed = True
            existing_log.deleted_at = None
            existing_log.updated_at = now
        else:
            db.add(
                HabitLog(
                    id=str(uuid.uuid4()),
                    habit_id=session.habit_id,
                    user_id=current_user.id,
                    log_date=target_date,
                    completed=True,
                    note=f"Completed via {round(payload.actual_duration_sec / 60)}m focus session",
                    created_at=now,
                    updated_at=now,
                )
            )

    db.commit()
    db.refresh(session)
    return session


@app.get("/sessions/stats", response_model=SessionStatsResponse)
def get_session_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(FocusSession)
        .filter(
            FocusSession.user_id == current_user.id,
            FocusSession.deleted_at.is_(None),
        )
        .order_by(FocusSession.started_at.desc())
        .all()
    )

    today_date = datetime.now(timezone.utc).date()
    week_ago_date = today_date - timedelta(days=6)

    today_sec = 0
    week_sec = 0
    total_sec = 0
    completed_count = 0
    cancelled_count = 0

    buckets_map = {
        (today_date - timedelta(days=i)).isoformat(): {"minutes": 0, "sessions_count": 0}
        for i in range(6, -1, -1)
    }

    for s in sessions:
        s_date = ensure_utc(s.started_at).date()
        s_iso = s_date.isoformat()
        if s.status == "completed":
            completed_count += 1
            total_sec += s.actual_duration_sec
            if s_date == today_date:
                today_sec += s.actual_duration_sec
            if s_date >= week_ago_date:
                week_sec += s.actual_duration_sec
            if s_iso in buckets_map:
                buckets_map[s_iso]["minutes"] += round(s.actual_duration_sec / 60)
                buckets_map[s_iso]["sessions_count"] += 1
        elif s.status == "cancelled":
            cancelled_count += 1

    total_finished = completed_count + cancelled_count
    completion_rate = round((completed_count / total_finished) * 100) if total_finished > 0 else 100

    daily_breakdown = [
        DailyFocusBucket(date=d, minutes=data["minutes"], sessions_count=data["sessions_count"])
        for d, data in buckets_map.items()
    ]

    return SessionStatsResponse(
        today_focus_minutes=round(today_sec / 60),
        week_focus_minutes=round(week_sec / 60),
        total_focus_minutes=round(total_sec / 60),
        completed_sessions_count=completed_count,
        cancelled_sessions_count=cancelled_count,
        completion_rate_percent=completion_rate,
        daily_breakdown=daily_breakdown,
        recent_sessions=sessions[:20],
    )


# ---------------------------------------------------------------------------
# STREAKS & CHART ANALYTICS
# ---------------------------------------------------------------------------

@app.get("/stats/streaks", response_model=StreaksOverviewResponse)
def get_streak_stats(
    reference_date_str: Optional[str] = Query(default=None, alias="date"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ref_date = (
        date.fromisoformat(reference_date_str)
        if reference_date_str
        else datetime.now(timezone.utc).date()
    )

    habits = (
        db.query(Habit)
        .filter(
            Habit.user_id == current_user.id,
            Habit.deleted_at.is_(None),
            Habit.archived.is_(False),
        )
        .all()
    )
    all_logs = (
        db.query(HabitLog)
        .filter(
            HabitLog.user_id == current_user.id,
            HabitLog.deleted_at.is_(None),
        )
        .all()
    )

    logs_by_habit = {}
    for lg in all_logs:
        logs_by_habit.setdefault(lg.habit_id, []).append(lg)

    habit_summaries: List[HabitStreakSummary] = []
    today_scheduled = 0
    today_completed = 0

    for h in habits:
        h_logs = logs_by_habit.get(h.id, [])
        metrics = compute_habit_streak_and_rates(h, h_logs, ref_date)
        if is_scheduled_for_date(h, ref_date):
            today_scheduled += 1
            if metrics["completed_today"]:
                today_completed += 1

        habit_summaries.append(
            HabitStreakSummary(
                habit_id=h.id,
                habit_name=h.name,
                color=h.color,
                current_streak=metrics["current_streak"],
                longest_streak=metrics["longest_streak"],
                completion_rate_7d=metrics["completion_rate_7d"],
                completion_rate_30d=metrics["completion_rate_30d"],
                completed_today=metrics["completed_today"],
            )
        )

    overall_current = max((s.current_streak for s in habit_summaries), default=0)
    overall_longest = max((s.longest_streak for s in habit_summaries), default=0)
    today_pct = round((today_completed / today_scheduled) * 100) if today_scheduled > 0 else 0

    def build_series(days_window: int) -> List[dict]:
        series = []
        for offset in range(days_window - 1, -1, -1):
            d = ref_date - timedelta(days=offset)
            d_iso = d.isoformat()
            sched = 0
            comp = 0
            for h in habits:
                if is_scheduled_for_date(h, d):
                    sched += 1
                    h_logs = logs_by_habit.get(h.id, [])
                    if any(l.log_date == d_iso and l.completed for l in h_logs):
                        comp += 1
            pct = round((comp / sched) * 100) if sched > 0 else 0
            series.append(
                {
                    "date": d_iso,
                    "completed": comp,
                    "scheduled": sched,
                    "percentage": pct,
                }
            )
        return series

    return StreaksOverviewResponse(
        overall_current_streak=overall_current,
        overall_longest_streak=overall_longest,
        today_completed_count=today_completed,
        today_scheduled_count=today_scheduled,
        today_completion_percent=today_pct,
        habit_streaks=habit_summaries,
        weekly_series=build_series(7),
        monthly_series=build_series(30),
    )


# ---------------------------------------------------------------------------
# OFFLINE-FIRST BATCH SYNC (LAST-WRITE-WINS)
# ---------------------------------------------------------------------------

@app.post("/sync", response_model=SyncResponse)
def batch_sync(
    payload: SyncRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Bidirectional Offline Sync Endpoint with Deterministic Last-Write-Wins (LWW).
    1. Processes incoming client changes (`habits`, `habit_logs`, `focus_sessions`).
       If a record exists on the server, compares `ensure_utc(incoming.updated_at)`
       with `ensure_utc(existing.updated_at)`. Only overwrites if incoming >= existing.
    2. Queries all user records updated since `last_synced_at` (including soft-deleted
       tombstones) so the client can reconcile its local store.
    """
    server_now = utc_now()
    applied = {"habits": 0, "habit_logs": 0, "focus_sessions": 0}
    conflicts_resolved = 0

    # 1. Reconcile Habits
    for item in payload.changes.habits:
        incoming_ts = ensure_utc(item.updated_at)
        existing = (
            db.query(Habit)
            .filter(Habit.id == item.id, Habit.user_id == current_user.id)
            .first()
        )
        if existing is None:
            db.add(
                Habit(
                    id=item.id,
                    user_id=current_user.id,
                    name=item.name,
                    description=item.description or "",
                    icon=item.icon,
                    color=item.color,
                    frequency_type=item.frequency_type,
                    target_days=item.target_days,
                    weekly_target_count=item.weekly_target_count,
                    default_focus_minutes=item.default_focus_minutes,
                    archived=item.archived,
                    created_at=ensure_utc(item.created_at) if item.created_at else incoming_ts,
                    updated_at=incoming_ts,
                    deleted_at=ensure_utc(item.deleted_at) if item.deleted_at else None,
                )
            )
            applied["habits"] += 1
        else:
            if incoming_ts >= ensure_utc(existing.updated_at):
                existing.name = item.name
                existing.description = item.description or ""
                existing.icon = item.icon
                existing.color = item.color
                existing.frequency_type = item.frequency_type
                existing.target_days = item.target_days
                existing.weekly_target_count = item.weekly_target_count
                existing.default_focus_minutes = item.default_focus_minutes
                existing.archived = item.archived
                existing.updated_at = incoming_ts
                existing.deleted_at = ensure_utc(item.deleted_at) if item.deleted_at else None
                applied["habits"] += 1
            else:
                conflicts_resolved += 1

    # 2. Reconcile Habit Logs (matched by (habit_id, log_date) or id)
    for log_item in payload.changes.habit_logs:
        incoming_ts = ensure_utc(log_item.updated_at)
        existing_log = (
            db.query(HabitLog)
            .filter(
                HabitLog.user_id == current_user.id,
                HabitLog.habit_id == log_item.habit_id,
                HabitLog.log_date == log_item.log_date,
            )
            .first()
        )
        if existing_log is None:
            db.add(
                HabitLog(
                    id=log_item.id,
                    habit_id=log_item.habit_id,
                    user_id=current_user.id,
                    log_date=log_item.log_date,
                    completed=log_item.completed,
                    note=log_item.note or "",
                    created_at=ensure_utc(log_item.created_at) if log_item.created_at else incoming_ts,
                    updated_at=incoming_ts,
                    deleted_at=ensure_utc(log_item.deleted_at) if log_item.deleted_at else None,
                )
            )
            applied["habit_logs"] += 1
        else:
            if incoming_ts >= ensure_utc(existing_log.updated_at):
                existing_log.completed = log_item.completed
                existing_log.note = log_item.note or ""
                existing_log.updated_at = incoming_ts
                existing_log.deleted_at = ensure_utc(log_item.deleted_at) if log_item.deleted_at else None
                applied["habit_logs"] += 1
            else:
                conflicts_resolved += 1

    # 3. Reconcile Focus Sessions
    for sess_item in payload.changes.focus_sessions:
        incoming_ts = ensure_utc(sess_item.updated_at)
        existing_sess = (
            db.query(FocusSession)
            .filter(FocusSession.id == sess_item.id, FocusSession.user_id == current_user.id)
            .first()
        )
        if existing_sess is None:
            db.add(
                FocusSession(
                    id=sess_item.id,
                    user_id=current_user.id,
                    habit_id=sess_item.habit_id,
                    planned_duration_sec=sess_item.planned_duration_sec,
                    actual_duration_sec=sess_item.actual_duration_sec,
                    status=sess_item.status,
                    started_at=ensure_utc(sess_item.started_at),
                    ended_at=ensure_utc(sess_item.ended_at) if sess_item.ended_at else None,
                    dnd_requested=sess_item.dnd_requested,
                    dnd_applied_mode=sess_item.dnd_applied_mode,
                    previous_dnd_state=sess_item.previous_dnd_state,
                    updated_at=incoming_ts,
                    deleted_at=ensure_utc(sess_item.deleted_at) if sess_item.deleted_at else None,
                )
            )
            applied["focus_sessions"] += 1
        else:
            if incoming_ts >= ensure_utc(existing_sess.updated_at):
                existing_sess.habit_id = sess_item.habit_id
                existing_sess.planned_duration_sec = sess_item.planned_duration_sec
                existing_sess.actual_duration_sec = sess_item.actual_duration_sec
                existing_sess.status = sess_item.status
                existing_sess.ended_at = ensure_utc(sess_item.ended_at) if sess_item.ended_at else None
                existing_sess.dnd_requested = sess_item.dnd_requested
                existing_sess.dnd_applied_mode = sess_item.dnd_applied_mode
                existing_sess.previous_dnd_state = sess_item.previous_dnd_state
                existing_sess.updated_at = incoming_ts
                existing_sess.deleted_at = ensure_utc(sess_item.deleted_at) if sess_item.deleted_at else None
                applied["focus_sessions"] += 1
            else:
                conflicts_resolved += 1

    db.commit()

    # 4. Fetch delta records updated since last_synced_at
    habits_query = db.query(Habit).filter(Habit.user_id == current_user.id)
    logs_query = db.query(HabitLog).filter(HabitLog.user_id == current_user.id)
    sessions_query = db.query(FocusSession).filter(FocusSession.user_id == current_user.id)

    if payload.last_synced_at:
        since_ts = ensure_utc(payload.last_synced_at)
        habits_query = habits_query.filter(Habit.updated_at >= since_ts)
        logs_query = logs_query.filter(HabitLog.updated_at >= since_ts)
        sessions_query = sessions_query.filter(FocusSession.updated_at >= since_ts)

    return SyncResponse(
        server_time=server_now,
        applied_counts=applied,
        conflicts_resolved=conflicts_resolved,
        changes={
            "habits": [HabitResponse.model_validate(h).model_dump(mode="json") for h in habits_query.all()],
            "habit_logs": [HabitLogResponse.model_validate(l).model_dump(mode="json") for l in logs_query.all()],
            "focus_sessions": [
                FocusSessionResponse.model_validate(s).model_dump(mode="json") for s in sessions_query.all()
            ],
        },
    )
