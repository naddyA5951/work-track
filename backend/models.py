"""
SQLAlchemy ORM Models for QuietPulse.
Designed for offline-first synchronization with client-generated UUIDs,
ISO UTC updated_at timestamps for Last-Write-Wins (LWW) conflict resolution,
and nullable deleted_at columns for soft-delete tombstone propagation.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    habits = relationship("Habit", back_populates="user", cascade="all, delete-orphan")
    habit_logs = relationship("HabitLog", back_populates="user", cascade="all, delete-orphan")
    focus_sessions = relationship("FocusSession", back_populates="user", cascade="all, delete-orphan")


class Habit(Base):
    __tablename__ = "habits"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    description = Column(String(500), nullable=True, default="")
    icon = Column(String(50), nullable=False, default="check-circle")
    color = Column(String(20), nullable=False, default="#10B981")

    # Schedule: 'daily' | 'weekdays' | 'weekly_count'
    frequency_type = Column(String(20), nullable=False, default="daily")
    # Array of weekday integers [0..6] where 0=Monday, 6=Sunday
    target_days = Column(JSON, nullable=False, default=lambda: [0, 1, 2, 3, 4, 5, 6])
    weekly_target_count = Column(Integer, nullable=False, default=7)
    default_focus_minutes = Column(Integer, nullable=False, default=25)
    archived = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="habits")
    logs = relationship("HabitLog", back_populates="habit", cascade="all, delete-orphan")
    focus_sessions = relationship("FocusSession", back_populates="habit")


class HabitLog(Base):
    """
    Represents a single daily check-off record for a habit on a specific local date (YYYY-MM-DD).
    The (habit_id, log_date) unique constraint guarantees deterministic upserts during offline sync.
    """
    __tablename__ = "habit_logs"
    __table_args__ = (
        UniqueConstraint("habit_id", "log_date", name="uq_habit_log_date"),
        Index("ix_habit_logs_user_date", "user_id", "log_date"),
    )

    id = Column(String(36), primary_key=True, default=generate_uuid)
    habit_id = Column(String(36), ForeignKey("habits.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    log_date = Column(String(10), index=True, nullable=False)  # 'YYYY-MM-DD'
    completed = Column(Boolean, nullable=False, default=True)
    note = Column(String(280), nullable=True, default="")

    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    habit = relationship("Habit", back_populates="logs")
    user = relationship("User", back_populates="habit_logs")


class FocusSession(Base):
    """
    Records a timed deep-work focus session and its Do Not Disturb (DND) state transitions.
    """
    __tablename__ = "focus_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    habit_id = Column(String(36), ForeignKey("habits.id", ondelete="SET NULL"), index=True, nullable=True)

    planned_duration_sec = Column(Integer, nullable=False, default=1500)
    actual_duration_sec = Column(Integer, nullable=False, default=0)
    # 'in_progress' | 'completed' | 'cancelled'
    status = Column(String(20), nullable=False, default="in_progress")

    started_at = Column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    dnd_requested = Column(Boolean, nullable=False, default=True)
    # 'native_os' | 'shortcut_bridge' | 'in_app_fullscreen' | 'none'
    dnd_applied_mode = Column(String(30), nullable=False, default="native_os")
    previous_dnd_state = Column(String(100), nullable=True)

    updated_at = Column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="focus_sessions")
    habit = relationship("Habit", back_populates="focus_sessions")
