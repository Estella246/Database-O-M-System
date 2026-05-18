import { PERMISSION_WHITELIST_NODE_KEY } from "../constants/permission.js";
import { state } from "../state/state.js";
import { getWhitelistKeyByActiveKey } from "../utils/normalize.js";
import { whitelistAllows } from "../utils/normalize.js";
import { ensureListTab, ensureLeaveTab, ensureRequirementTab, ensureSettingsTab } from "../pages/settings-page.js";
import { ensureHomeTab, ensureDutyTab } from "../pages/ticket-core.js";
import { ensureStatsChartsTab } from "../pages/stats-page.js";

// Global 401 handler state
let isHandling401 = false;

/**
 * Show session expired modal and redirect to login.
 */
function handleSessionExpired() {
  if (isHandling401) return;
  isHandling401 = true;

  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); display: flex;
    align-items: center; justify-content: center; z-index: 99999;
  `;
  const box = document.createElement("div");
  box.style.cssText = `
    background: white; padding: 40px; border-radius: 10px;
    max-width: 400px; text-align: center; font-family: sans-serif;
  `;
  box.innerHTML = `
    <h2 style="color: #c00; margin-bottom: 20px;">登录已过期</h2>
    <p style="color: #666; margin-bottom: 30px;">您的登录状态已失效，即将跳转到登录页面...</p>
  `;
  container.appendChild(box);
  document.body.appendChild(container);

  // Redirect to login after 2 seconds
  setTimeout(async () => {
    const config = ssoConfig || await fetchSsoConfig();
    const currentUrl = window.location.href;
    window.location.href = `${config.login_url}?redirect=${encodeURIComponent(currentUrl)}`;
  }, 2000);
}

/**
 * Setup global fetch interceptor for 401 responses.
 * This handles session expiration during user activity.
 */
function setupFetchInterceptor() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    // Only handle 401 for API requests (not auth endpoints during login flow)
    if (response.status === 401) {
      const url = args[0];
      const urlStr = typeof url === 'string' ? url : url?.url || '';

      // Skip 401 handling for auth endpoints (they handle their own errors)
      if (urlStr.includes('/api/auth/me') ||
          urlStr.includes('/api/auth/config') ||
          urlStr.includes('/api/auth/health')) {
        return response;
      }

      // Try to parse error detail
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        if (data.detail === "No login user found." || data.detail === "No cookie") {
          handleSessionExpired();
        }
      } catch (e) {
        // If parsing fails, still handle 401 as session expired
        handleSessionExpired();
      }
    }

    return response;
  };
}

// Initialize fetch interceptor on module load
setupFetchInterceptor();

// SSO config (loaded from backend API)
let ssoConfig = null;

/**
 * Fetch SSO config from backend.
 * Returns { login_url, cookie_domain, cookie_names, skip_auth }
 */
async function fetchSsoConfig() {
  if (ssoConfig) return ssoConfig;
  try {
    const response = await fetch("/api/auth/config");
    if (response.ok) {
      ssoConfig = await response.json();
      return ssoConfig;
    }
  } catch (e) {
    // If config fetch fails, use fallback defaults
  }
  // Fallback defaults (should not happen in production)
  ssoConfig = {
    login_url: "http://app.bulezone.com/login",
    profile_url: "http://login.bulezone.com/account/profile",
    cookie_domain: ".bulezone.com",
    cookie_names: ["env_token", "hwsso_login", "hwssot", "hwssot3", "idss_cid", "lang", "login_logFlag", "login_sid", "login_uid", "suid", "ztsg_ruuid"],
    skip_auth: false,
  };
  return ssoConfig;
}

// Current logged-in user info (set after SSO validation)
let currentUser = null;

/**
 * Get current logged-in user info.
 * Returns null if not logged in.
 */
function getCurrentUser() {
  return currentUser;
}

/**
 * Set current user info after successful login.
 */
function setCurrentUser(user) {
  currentUser = user;
}

/**
 * Get user display name for avatar (first character of name).
 */
function getAvatarText() {
  if (!currentUser) return "?";
  const localUser = currentUser.local_user || {};
  const ssoUser = currentUser.sso_user || {};
  const userName = localUser.user_name || ssoUser.lname || "";
  return userName.charAt(0) || "?";
}

/**
 * Fetch current user info from backend auth endpoint.
 * Backend validates SSO cookie, checks user registration, and returns user data.
 * Returns { success, data } or { success: false, error, status }
 */
async function fetchSsoUser() {
  try {
    const response = await fetch("/api/auth/me");
    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    }
    const errorData = await response.json();
    return { success: false, error: errorData.detail || "验证失败", status: response.status };
  } catch (e) {
    return { success: false, error: "网络错误", status: 0 };
  }
}

/**
 * Show error message and prevent app loading.
 */
async function showAuthError(message) {
  const config = await fetchSsoConfig();
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); display: flex;
    align-items: center; justify-content: center; z-index: 99999;
  `;
  const box = document.createElement("div");
  box.style.cssText = `
    background: white; padding: 40px; border-radius: 10px;
    max-width: 400px; text-align: center; font-family: sans-serif;
  `;
  box.innerHTML = `
    <h2 style="color: #c00; margin-bottom: 20px;">登录失败</h2>
    <p style="color: #666; margin-bottom: 30px;">${message}</p>
    <button onclick="window.location.href='${config.login_url}?redirect=${encodeURIComponent(window.location.href)}'"
      style="background: #667eea; color: white; padding: 12px 30px; border: none; border-radius: 5px; cursor: pointer;">
      重新登录
    </button>
  `;
  container.appendChild(box);
  document.body.appendChild(container);
}

/**
 * Redirect to SSO login page.
 * Current URL is passed as redirect parameter for post-login redirect.
 */
async function redirectToSsoLogin() {
  const config = await fetchSsoConfig();
  const currentUrl = window.location.href;
  const loginUrl = `${config.login_url}?redirect=${encodeURIComponent(currentUrl)}`;
  window.location.href = loginUrl;
}

/**
 * Ensure user is logged in before proceeding.
 * Returns true if authenticated, false if redirecting to login or showing error.
 */
async function ensureLoggedIn() {
  // Load SSO config first
  await fetchSsoConfig();

  // Validate session with backend
  const result = await fetchSsoUser();

  // Handle different error cases
  if (!result.success) {
    // 403 = user not registered or disabled - show error message
    if (result.status === 403) {
      await showAuthError(result.error);
      return false;
    }
    // 401/other errors - redirect to login
    await redirectToSsoLogin();
    return false;
  }

  const user = result.data;
  if (!user.success) {
    await redirectToSsoLogin();
    return false;
  }

  // Set current user for avatar component
  setCurrentUser(user);

  // Store user info in localStorage for legacy compatibility
  const w3Account = user.w3Account || "";
  const localUser = user.local_user || {};
  const ssoUser = user.sso_user || {};

  // Use local user_name if available, otherwise use SSO lname
  const userName = localUser.user_name || ssoUser.lname || "";

  if (w3Account) {
    window.localStorage.setItem("demo_operator_account", w3Account);
    window.localStorage.setItem("demo_operator_name", userName);
  }

  return true;
}

/**
 * Get current operator info (legacy compatibility).
 * Uses localStorage set by SSO login or fallback.
 */
function getCurrentOperator() {
  const savedAccount = (window.localStorage.getItem("demo_operator_account") || "").trim();
  const savedName = (window.localStorage.getItem("demo_operator_name") || "").trim();
  const account = savedAccount;
  const row = state.adminUsers.find((u) => String(u.account || "") === account);
  const userName = String(row?.user_name || savedName);
  return { account, userName };
}

function getCurrentRoleCode() {
  const operator = getCurrentOperator();
  const row = state.adminUsers.find((u) => String(u.account || "") === operator.account);
  return String(row?.role_code || "");
}

function getCurrentWhitelistSettings() {
  const operator = getCurrentOperator();
  const user = state.adminUsers.find((u) => String(u.account || "") === operator.account);
  const roleCode = String(user?.role_code || "");
  if (!roleCode) return {};
  const rows = state.adminPermissions.filter(
    (x) => String(x.role_code || "") === roleCode && String(x.node_key || "") === PERMISSION_WHITELIST_NODE_KEY
  );
  const out = {};
  rows.forEach((r) => {
    out[String(r.field_key || "")] = String(r.permission_level || "hidden");
  });
  return out;
}

function isActiveKeyVisible(activeKey, whitelist) {
  const fieldKey = getWhitelistKeyByActiveKey(activeKey);
  if (!fieldKey) return true;
  return whitelistAllows(fieldKey, "readonly", whitelist);
}

function getDefaultVisibleActiveKey(whitelist) {
  if (whitelistAllows("home", "readonly", whitelist)) return ensureHomeTab();
  if (whitelistAllows("ticket_list", "readonly", whitelist)) return ensureListTab();
  if (whitelistAllows("duty_roster", "readonly", whitelist)) return ensureDutyTab();
  if (whitelistAllows("leave_application", "readonly", whitelist)) return ensureLeaveTab();
  if (whitelistAllows("requirement_list", "readonly", whitelist)) return ensureRequirementTab();
  if (whitelistAllows("stats_dashboard", "readonly", whitelist)) return ensureStatsChartsTab();
  return ensureSettingsTab();
}

/**
 * Logout: clear localStorage, clear cookies, redirect to SSO login.
 */
async function logout() {
  // Clear localStorage
  window.localStorage.removeItem("demo_operator_account");
  window.localStorage.removeItem("demo_operator_name");
  window.localStorage.removeItem("operator_badge_pos");

  // Get SSO config for cookie domain and names
  const config = ssoConfig || await fetchSsoConfig();

  // Clear SSO cookies by setting them to expire in the past
  config.cookie_names.forEach((name) => {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${config.cookie_domain}`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  // Clear current user
  currentUser = null;

  // Redirect to SSO login
  await redirectToSsoLogin();
}

/**
 * Show user profile modal in center of screen.
 */
function showUserProfileModal() {
  if (!currentUser) return;

  const localUser = currentUser.local_user || {};
  const ssoUser = currentUser.sso_user || {};
  const userName = localUser.user_name || ssoUser.lname || "未知";
  const account = currentUser.w3Account || localUser.account || "";
  const roleCode = localUser.role_code || "";
  const groupName = localUser.group_name || "";
  const email = ssoUser.email || "";

  // Role display mapping
  const roleMap = { admin: "管理员", user: "普通用户" };
  const roleDisplay = roleMap[roleCode] || roleCode || "未设置";

  // Create modal container
  const container = document.createElement("div");
  container.className = "user-profile-modal-overlay";
  container.innerHTML = `
    <div class="user-profile-modal">
      <div class="user-profile-header">
        <div class="user-profile-avatar">${userName.charAt(0)}</div>
        <div class="user-profile-title">个人信息</div>
      </div>
      <div class="user-profile-content">
        <div class="user-profile-row">
          <span class="user-profile-label">用户名</span>
          <span class="user-profile-value">${userName}</span>
        </div>
        <div class="user-profile-row">
          <span class="user-profile-label">域账户</span>
          <span class="user-profile-value">${account}</span>
        </div>
        <div class="user-profile-row">
          <span class="user-profile-label">邮箱</span>
          <span class="user-profile-value">${email}</span>
        </div>
        <div class="user-profile-row">
          <span class="user-profile-label">用户角色</span>
          <span class="user-profile-value">${roleDisplay}</span>
        </div>
        <div class="user-profile-row">
          <span class="user-profile-label">用户组</span>
          <span class="user-profile-value">${groupName || "未设置"}</span>
        </div>
      </div>
      <div class="user-profile-footer">
        <button class="user-profile-close-btn">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  // Close on click outside or close button
  container.addEventListener("click", (e) => {
    if (e.target === container) {
      container.remove();
    }
  });
  container.querySelector(".user-profile-close-btn").addEventListener("click", () => {
    container.remove();
  });
}

export {
  fetchSsoConfig,
  fetchSsoUser,
  redirectToSsoLogin,
  showAuthError,
  ensureLoggedIn,
  logout,
  showUserProfileModal,
  getCurrentUser,
  setCurrentUser,
  getAvatarText,
  getCurrentOperator,
  getCurrentRoleCode,
  getCurrentWhitelistSettings,
  isActiveKeyVisible,
  getDefaultVisibleActiveKey
};
