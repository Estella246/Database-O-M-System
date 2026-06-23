/** 与 backend/utils/person_display.py、xiaoluban extract_account 对齐的人员展示解析。 */

const PERSON_ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_.-]+$/;

/**
 * @param {string} raw
 * @returns {{ name: string, account: string }}
 */
export function parsePersonDisplay(raw) {
  const s = String(raw || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { name: "", account: "" };
  const parts = s.split(" ");
  if (parts.length >= 2) {
    const account = String(parts[parts.length - 1] || "").trim();
    if (PERSON_ACCOUNT_RE.test(account)) {
      const name = parts.slice(0, -1).join(" ").trim();
      return { name, account };
    }
  }
  if (PERSON_ACCOUNT_RE.test(s)) return { name: "", account: s };
  return { name: s, account: "" };
}

/**
 * @param {{ name?: string, account?: string }} person
 * @returns {string}
 */
export function formatPersonCopyText(person) {
  const name = String(person?.name || "").trim();
  const account = String(person?.account || "").trim();
  if (name && account) return `${name} ${account}`;
  return name || account;
}
