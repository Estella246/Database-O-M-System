"""Cookie handling utilities for SSO service."""
import uuid
from typing import Dict, Optional


def generate_session_id() -> str:
    """Generate a unique session ID using UUID4."""
    return str(uuid.uuid4())


def parse_cookies(cookie_string: str) -> Dict[str, str]:
    """Parse cookie string into a dictionary."""
    cookies = {}
    if not cookie_string:
        return cookies

    for item in cookie_string.split(';'):
        item = item.strip()
        if '=' in item:
            key, value = item.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies


def get_session_id_from_cookies(cookie_string: str) -> Optional[str]:
    """Extract session ID from cookie string."""
    cookies = parse_cookies(cookie_string)
    # Try multiple cookie names for session ID
    return cookies.get('hwssot') or cookies.get('hwssot3') or cookies.get('login_sid')