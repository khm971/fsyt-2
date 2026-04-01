/** Session-only: cleared when the tab is closed or the page is fully reloaded. */
const SESSION_KEY = "fsyt:skip-clear-video-status-confirm";

export function shouldSkipClearVideoStatusConfirm() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipClearVideoStatusConfirm(skip) {
  try {
    if (skip) sessionStorage.setItem(SESSION_KEY, "1");
    else sessionStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}
