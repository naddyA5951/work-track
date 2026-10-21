"""
Seed Data Script for QuietPulse FastAPI Backend.
Run with: python seed.py
Creates a demo user (`alex@quietpulse.app` / `password123`), 5 realistic daily & weekly
habits, 30 days of historical check-off logs with realistic streaks, and focus sessions.
"""

import uuid
from datetime import datetime, timedelta, timezone
from database import SessionLocal, engine, Base
from models import User, Habit, HabitLog, FocusSession
from auth import hash_password


def run_seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        demo_email = "alex@quietpulse.app"
        existing_user = db.query(User).filter(User.email == demo_email).first()
        if existing_user:
            print(f"Seed user {demo_email} already exists. Resetting demo records...")
            db.delete(existing_user)
            db.commit()

        now = datetime.now(timezone.utc)
        user_id = "user-demo-alex-001"
        user = User(
            id=user_id,
            email=demo_email,
            password_hash=hash_password("password123"),
            display_name="Alex Rivera",
            created_at=now - timedelta(days=35),
            updated_at=now,
        )
        db.add(user)

        habits_seed = [
            {
                "id": "habit-deep-code-001",
                "name": "Deep Architecture & Coding",
                "description": "90 minutes of uninterrupted engineering without Slack or email.",
                "icon": "code",
                "color": "#6366F1",
                "frequency_type": "weekdays",
                "target_days": [0, 1, 2, 3, 4],  # Mon-Fri
                "weekly_target_count": 5,
                "default_focus_minutes": 50,
                "completion_modulo": 1,  # 100% streak on scheduled days
            },
            {
                "id": "habit-mindful-read-002",
                "name": "Technical & Philosophy Reading",
                "description": "Read 25 pages of non-fiction or research papers in DND mode.",
                "icon": "book-open",
                "color": "#10B981",
                "frequency_type": "daily",
                "target_days": [0, 1, 2, 3, 4, 5, 6],
                "weekly_target_count": 7,
                "default_focus_minutes": 25,
                "completion_modulo": 1,
            },
            {
                "id": "habit-zone2-cardio-003",
                "name": "Zone 2 Aerobic Conditioning",
                "description": "45m outdoor run or rowing session.",
                "icon": "activity",
                "color": "#F59E0B",
                "frequency_type": "weekdays",
                "target_days": [0, 2, 4, 5],  # Mon, Wed, Fri, Sat
                "weekly_target_count": 4,
                "default_focus_minutes": 50,
                "completion_modulo": 2,
            },
            {
                "id": "habit-evening-journal-004",
                "name": "Evening Shutdown & Review",
                "description": "Clear inbox, plan tomorrow's top 3 priorities, lock devices.",
                "icon": "moon",
                "color": "#06B6D4",
                "frequency_type": "daily",
                "target_days": [0, 1, 2, 3, 4, 5, 6],
                "weekly_target_count": 7,
                "default_focus_minutes": 25,
                "completion_modulo": 3,
            },
        ]

        today = now.date()

        for h_data in habits_seed:
            modulo = h_data.pop("completion_modulo")
            habit = Habit(
                user_id=user_id,
                created_at=now - timedelta(days=30),
                updated_at=now,
                **h_data,
            )
            db.add(habit)

            # Generate 28 days of realistic check-offs
            for day_offset in range(28, -1, -1):
                d = today - timedelta(days=day_offset)
                weekday = d.weekday()
                is_scheduled = weekday in h_data["target_days"]
                if not is_scheduled:
                    continue

                # Keep recent 7 days mostly completed for active streaks
                should_complete = (day_offset <= 6 and day_offset > 0) or (day_offset % modulo == 0)
                if day_offset == 0 and h_data["id"] in ("habit-deep-code-001", "habit-mindful-read-002"):
                    should_complete = True
                elif day_offset == 0:
                    should_complete = False

                if should_complete:
                    log_ts = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=10)
                    db.add(
                        HabitLog(
                            id=str(uuid.uuid4()),
                            habit_id=h_data["id"],
                            user_id=user_id,
                            log_date=d.isoformat(),
                            completed=True,
                            note="Completed on schedule",
                            created_at=log_ts,
                            updated_at=log_ts,
                        )
                    )

        # Seed 10 realistic Focus Sessions over the past 7 days
        for offset in range(6, -1, -1):
            session_start = (now - timedelta(days=offset)).replace(hour=9, minute=30, second=0, microsecond=0)
            duration_min = 50 if offset % 2 == 0 else 25
            db.add(
                FocusSession(
                    id=f"session-seed-{offset}",
                    user_id=user_id,
                    habit_id="habit-deep-code-001" if offset % 2 == 0 else "habit-mindful-read-002",
                    planned_duration_sec=duration_min * 60,
                    actual_duration_sec=duration_min * 60,
                    status="completed",
                    started_at=session_start,
                    ended_at=session_start + timedelta(minutes=duration_min),
                    dnd_requested=True,
                    dnd_applied_mode="native_os",
                    previous_dnd_state="INTERRUPTION_FILTER_ALL",
                    updated_at=session_start + timedelta(minutes=duration_min),
                )
            )

        db.commit()
        print("Successfully seeded QuietPulse database!")
        print("Demo Credentials -> Email: alex@quietpulse.app | Password: password123")
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()
