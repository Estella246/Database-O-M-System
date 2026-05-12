"""Flask SSO Application - Simple Single Sign-On Service."""
from flask import Flask, request, render_template, jsonify, make_response, redirect, url_for
from urllib.parse import urlparse
from utils.cookie_handler import generate_session_id, get_session_id_from_cookies
from utils.session_manager import (
    create_session,
    get_session,
    get_user_by_credentials
)

app = Flask(__name__)

# Cookie domain for cross-subdomain SSO
COOKIE_DOMAIN = '.bluezone.com'

# Allowed redirect domains for security
ALLOWED_REDIRECT_DOMAINS = ['bluezone.com', 'localhost']


def is_safe_redirect_url(url: str) -> bool:
    """Validate redirect URL to prevent open redirect attacks."""
    if not url:
        return False
    try:
        parsed = urlparse(url)
        # Check if domain is allowed
        host = parsed.hostname or ''
        for allowed in ALLOWED_REDIRECT_DOMAINS:
            if host == allowed or host.endswith('.' + allowed):
                return True
        return False
    except Exception:
        return False


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handle login page display and authentication."""
    redirect_url = request.args.get('redirect', '') or request.form.get('redirect', '')

    if request.method == 'GET':
        return render_template('login.html', redirect=redirect_url)

    # POST - process login
    w3Account = request.form.get('w3Account', '')
    password = request.form.get('password', '')

    if not w3Account or not password:
        return render_template('login.html', error='域账户和密码不能为空', redirect=redirect_url)

    # Validate credentials using w3Account (domain account)
    user = get_user_by_credentials(w3Account, password)
    if not user:
        return render_template('login.html', error='域账户或密码错误', redirect=redirect_url)

    # Create session
    session_id = generate_session_id()
    create_session(session_id, user)

    # Handle redirect after successful login
    if redirect_url and is_safe_redirect_url(redirect_url):
        response = make_response(redirect(redirect_url))
    else:
        response = make_response(render_template('success.html', user=user))

    # Set cookies for cross-subdomain SSO
    response.set_cookie(
        'hwssot',
        session_id,
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )
    response.set_cookie(
        'hwssot3',
        session_id,
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )
    response.set_cookie(
        'login_sid',
        session_id,
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )
    response.set_cookie(
        'login_uid',
        user['id'],
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )
    response.set_cookie(
        'hwsso_login',
        'true',
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )
    response.set_cookie(
        'suid',
        user['id'],
        domain=COOKIE_DOMAIN,
        path='/',
        max_age=600
    )

    return response


@app.route('/account/profile', methods=['GET'])
def account_profile():
    """Return user account information based on session cookie."""
    # Get cookie string from request
    cookie_string = request.headers.get('Cookie', '')

    # Extract session ID
    session_id = get_session_id_from_cookies(cookie_string)

    if not session_id:
        return "No login user found."

    # Get session info
    session = get_session(session_id)

    if not session:
        return "No login user found."

    # Return account info
    return jsonify({
        'success': True,
        'lname': session['lname'],
        'w3Account': session['w3Account'],
        'email': session['email'],
        'userName': session['userName']
    })


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print("SSO Service starting...")
    print("Login URL: http://login.bluezone.com:5000/login")
    print("Profile API: http://login.bluezone.com:5000/account/profile")
    app.run(host='0.0.0.0', port=5000, debug=True)