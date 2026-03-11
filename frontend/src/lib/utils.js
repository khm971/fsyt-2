import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Full date/time (e.g. "Mar 5, 2025, 3:45 PM"). */
export function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full date/time with seconds (e.g. "Mar 5, 2025, 3:45:32 PM"). */
export function formatDateTimeWithSeconds(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Duration in seconds to mm:ss or h:mm:ss. Returns "—" for null/invalid. */
export function formatDurationSeconds(seconds) {
  if (seconds == null || seconds < 0 || !Number.isFinite(seconds)) return "—";
  const s = Math.floor(Number(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * For Last heartbeat: today = time with seconds (e.g. "3:45:32 PM");
 * otherwise full date + time with seconds (e.g. "Mar 5, 2025, 3:45:32 PM").
 */
export function formatHeartbeatTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Relative time for heartbeat: "10 seconds ago", "2 days ago", or "Just Now" if in the future.
 * Caller typically wraps in parentheses, e.g. (Current) or (5 hours ago).
 * @param {string} isoString - ISO date string
 * @param {Date} [now] - Reference time (default: new Date()); pass from state to get live updates.
 */
export function formatRelativeTime(isoString, now = new Date()) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "Just Now";
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return `${diffSec} second${diffSec === 1 ? "" : "s"} ago`;
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

/**
 * Friendly format for a scheduled run_after time: "in 20 minutes", "Tomorrow at 2:15 PM",
 * "Today at 2:15 PM", or "Should have run already" if in the past.
 * @param {string} isoString - ISO date string (run_after)
 * @param {Date} [now] - Reference time (default: new Date())
 */
export function formatScheduledRunAfter(isoString, now = new Date()) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return "Should have run already";
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear();
  if (diffMin < 60) return diffMin <= 1 ? "in 1 minute" : `in ${diffMin} minutes`;
  if (diffHr < 24 && sameDay)
    return `Today at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (diffHr < 48 && isTomorrow)
    return `Tomorrow at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (diffHr < 24) return `in ${diffHr} hour${diffHr === 1 ? "" : "s"}`;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Today: time only with seconds (e.g. "3:45:32 PM"). Previous days: date + time with seconds (e.g. "Mar 6 6:15:00 PM" or "Dec 3, 2024 6:15:00 PM"). */
export function formatSmartTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const timeOpts = { hour: "numeric", minute: "2-digit", second: "2-digit" };
  if (isToday) {
    return d.toLocaleTimeString(undefined, timeOpts);
  }
  const datePart = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  const timePart = d.toLocaleTimeString(undefined, timeOpts);
  return `${datePart} ${timePart}`;
}
