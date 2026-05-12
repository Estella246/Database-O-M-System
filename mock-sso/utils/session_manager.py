"""Session management utilities for SSO service."""
import json
import os
import time
from typing import Dict, Optional, Any

SESSION_EXPIRY_SECONDS = 600  # 10 minutes

CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config')
SESSIONS_FILE = os.path.join(CONFIG_DIR, 'sessions.json')
USERS_FILE = os.path.join(CONFIG_DIR, 'users.json')


def load_sessions() -> Dict[str, Any]:
    """Load sessions from the JSON file."""
    if not os.path.exists(SESSIONS_FILE):
        return {"sessions": {}}
    with open(SESSIONS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_sessions(sessions_data: Dict[str, Any]) -> None:
    """Save sessions to the JSON file."""
    with open(SESSIONS_FILE, 'w', encoding='utf-8') as f:
        json.dump(sessions_data, f, indent=2, ensure_ascii=False)


def load_users() -> Dict[str, Any]:
    """Load users from the JSON file."""
    if not os.path.exists(USERS_FILE):
        return {"users": []}
    with open(USERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def clean_expired_sessions() -> None:
    """Remove expired sessions from the sessions file."""
    sessions_data = load_sessions()
    current_time = time.time()

    expired_keys = [
        sid for sid, session in sessions_data.get("sessions", {}).items()
        if session.get("expires_at", 0) < current_time
    ]

    for key in expired_keys:
        del sessions_data["sessions"][key]

    if expired_keys:
        save_sessions(sessions_data)


def create_session(session_id: str, user: Dict[str, str]) -> Dict[str, Any]:
    """Create a new session and save it."""
    clean_expired_sessions()

    sessions_data = load_sessions()
    current_time = time.time()

    session_info = {
        "id": user["id"],
        "lname": user["lname"],
        "userName": user["userName"],
        "w3Account": user["w3Account"],
        "email": user["email"],
        "created_at": current_time,
        "expires_at": current_time + SESSION_EXPIRY_SECONDS
    }

    sessions_data["sessions"][session_id] = session_info
    save_sessions(sessions_data)

    return session_info


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Get session info if valid and not expired."""
    if not session_id:
        return None

    clean_expired_sessions()

    sessions_data = load_sessions()
    session = sessions_data.get("sessions", {}).get(session_id)

    if not session:
        return None

    current_time = time.time()
    if session.get("expires_at", 0) < current_time:
        return None

    return session


def get_user_by_credentials(w3Account: str, password: str) -> Optional[Dict[str, str]]:
    """Validate user credentials and return user info if valid.

    Uses w3Account (domain account) as the username for authentication.
    """
    users_data = load_users()

    for user in users_data.get("users", []):
        if user.get("w3Account") == w3Account and user.get("password") == password:
            return {
                "id": user["id"],
                "lname": user["lname"],
                "userName": user["userName"],
                "w3Account": user["w3Account"],
                "email": user["email"]
            }

    return None