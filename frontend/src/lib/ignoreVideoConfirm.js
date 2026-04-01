/** Session-only: cleared when the tab is closed or the page is fully reloaded. */
const SESSION_KEY = "fsyt:skip-ignore-video-confirm";

export function shouldSkipIgnoreVideoConfirm() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipIgnoreVideoConfirm(skip) {
  try {
    if (skip) sessionStorage.setItem(SESSION_KEY, "1");
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}
