"""Tests for SSO service - compatible with Python 3.8+."""
import json
import os
import sys
import time

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.cookie_handler import generate_session_id, parse_cookies, get_session_id_from_cookies
from utils.session_manager import (
    load_sessions,
    save_sessions,
    load_users,
    create_session,
    get_session,
    get_user_by_credentials,
    clean_expired_sessions
)


def test_generate_session_id():
    """Test session ID generation."""
    sid1 = generate_session_id()
    sid2 = generate_session_id()

    assert sid1 != sid2, "Session IDs should be unique"
    assert len(sid1) == 36, "UUID format should be 36 characters"
    assert '-' in sid1, "UUID should contain dashes"
    print("test_generate_session_id: PASSED")


def test_parse_cookies():
    """Test cookie string parsing."""
    cookie_string = "JESESSIONID=abc123; login_uid=1001; sso_login=true"
    cookies = parse_cookies(cookie_string)

    assert cookies['JESESSIONID'] == 'abc123'
    assert cookies['login_uid'] == '1001'
    assert cookies['sso_login'] == 'true'
    print("test_parse_cookies: PASSED")

    # Test empty cookie string
    empty_cookies = parse_cookies('')
    assert empty_cookies == {}, "Empty cookie string should return empty dict"
    print("test_parse_cookies_empty: PASSED")


def test_get_session_id_from_cookies():
    """Test session ID extraction from cookies."""
    cookie_string = "JESESSIONID=test-session-id; login_uid=1001"
    sid = get_session_id_from_cookies(cookie_string)
    assert sid == 'test-session-id'
    print("test_get_session_id_from_cookies: PASSED")

    # Test with login_sid fallback
    cookie_string2 = "login_sid=backup-session-id"
    sid2 = get_session_id_from_cookies(cookie_string2)
    assert sid2 == 'backup-session-id'
    print("test_get_session_id_from_cookies_fallback: PASSED")


def test_load_users():
    """Test user loading."""
    users = load_users()
    assert 'users' in users
    assert len(users['users']) >= 2
    print("test_load_users: PASSED")


def test_get_user_by_credentials():
    """Test user credential validation."""
    # Valid credentials (using w3Account as username)
    user = get_user_by_credentials('z12345678', '123456')
    assert user is not None
    assert user['id'] == '1001'
    assert user['userName'] == 'zhangsan'
    assert user['lname'] == '张三'
    print("test_get_user_by_credentials_valid: PASSED")

    # Invalid credentials
    invalid_user = get_user_by_credentials('z12345678', 'wrongpassword')
    assert invalid_user is None
    print("test_get_user_by_credentials_invalid: PASSED")


def test_session_creation_and_retrieval():
    """Test session lifecycle."""
    # Clean up first
    clean_expired_sessions()

    # Create session
    sid = generate_session_id()
    user = {
        'id': '1001',
        'lname': '张三',
        'userName': 'zhangsan',
        'w3Account': 'z12345678',
        'email': 'zhangsan@bluezone.com'
    }
    session = create_session(sid, user)

    assert session['id'] == '1001'
    assert session['userName'] == 'zhangsan'
    assert session['lname'] == '张三'
    assert 'created_at' in session
    assert 'expires_at' in session
    print("test_create_session: PASSED")

    # Retrieve session
    retrieved = get_session(sid)
    assert retrieved is not None
    assert retrieved['id'] == '1001'
    print("test_get_session: PASSED")

    # Invalid session ID
    invalid_session = get_session('non-existent-id')
    assert invalid_session is None
    print("test_get_session_invalid: PASSED")


def test_session_expiry():
    """Test session expiry logic."""
    # Create a session with short expiry by manipulating time
    sid = generate_session_id()
    sessions_data = load_sessions()

    # Create expired session (expired 1 second ago)
    current_time = time.time()
    sessions_data['sessions'][sid] = {
        'id': '9999',
        'lname': '过期用户',
        'userName': 'expired_user',
        'w3Account': 'e12345678',
        'email': 'expired@bluezone.com',
        'created_at': current_time - 700,
        'expires_at': current_time - 1  # Already expired
    }
    save_sessions(sessions_data)

    # Try to retrieve - should return None due to expiry
    expired_session = get_session(sid)
    assert expired_session is None, "Expired session should not be retrievable"
    print("test_session_expiry: PASSED")


def test_clean_expired_sessions():
    """Test expired session cleanup."""
    sessions_data = load_sessions()

    # Add an expired session
    expired_sid = 'expired-test-session'
    current_time = time.time()
    sessions_data['sessions'][expired_sid] = {
        'id': '8888',
        'lname': '待清理用户',
        'userName': 'to_be_cleaned',
        'w3Account': 't12345678',
        'email': 'clean@bluezone.com',
        'created_at': current_time - 1000,
        'expires_at': current_time - 100  # Expired
    }
    save_sessions(sessions_data)

    # Run cleanup
    clean_expired_sessions()

    # Check if removed
    sessions_after = load_sessions()
    assert expired_sid not in sessions_after['sessions']
    print("test_clean_expired_sessions: PASSED")


def run_all_tests():
    """Run all tests."""
    print("=" * 50)
    print("Running SSO Service Tests")
    print("=" * 50)

    tests = [
        test_generate_session_id,
        test_parse_cookies,
        test_get_session_id_from_cookies,
        test_load_users,
        test_get_user_by_credentials,
        test_session_creation_and_retrieval,
        test_session_expiry,
        test_clean_expired_sessions,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"FAILED: {test.__name__} - {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR: {test.__name__} - {e}")
            failed += 1

    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)

    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)