const API = import.meta.env.VITE_API_URL ?? "/api";
const WS_BASE =
  import.meta.env.VITE_WS_URL ??
  (typeof location !== "undefined"
    ? (location.protocol === "https:" ? "wss://" : "ws://") + location.host
    : "ws://localhost:8000");

export function getWsUrl() {
  return `${WS_BASE.replace(/\/$/, "")}/ws`;
}

async function apiFetch(path, options = {}) {
  const url = `${API.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 204) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? res.statusText);
  return data;
}

export const api = {
  health: () => apiFetch("/health"),

  tags: {
    list: () => apiFetch("/tags"),
    search: (q) => apiFetch(`/tags/search?q=${encodeURIComponent(q)}`),
    get: (id) => apiFetch(`/tags/${id}`),
    create: (body) => apiFetch("/tags", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id) => apiFetch(`/tags/${id}`, { method: "DELETE" }),
  },

  channels: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.sort_by != null) q.set("sort_by", params.sort_by);
      if (params.sort_order != null) q.set("sort_order", params.sort_order);
      const query = q.toString();
      return apiFetch(`/channels${query ? `?${query}` : ""}`);
    },
    get: (id) => apiFetch(`/channels/${id}`),
    create: (body) => apiFetch("/channels", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id) => apiFetch(`/channels/${id}`, { method: "DELETE" }),
  },

  videos: {
    watchList: (params = {}) => {
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", params.limit);
      const query = q.toString();
      return apiFetch(`/videos/watch${query ? `?${query}` : ""}`);
    },
    listByTags: (params = {}) => {
      const q = new URLSearchParams();
      if (Array.isArray(params.tag_ids) && params.tag_ids.length > 0) {
        params.tag_ids.forEach((id) => q.append("tag_ids", id));
      }
      if (params.tag_match != null) q.set("tag_match", params.tag_match);
      if (params.limit != null) q.set("limit", params.limit);
      const query = q.toString();
      return apiFetch(`/videos/by-tags${query ? `?${query}` : ""}`);
    },
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.channel_id != null) q.set("channel_id", params.channel_id);
      if (params.include_ignored != null) q.set("include_ignored", params.include_ignored);
      if (params.limit != null) q.set("limit", params.limit);
      if (params.sort_by != null) q.set("sort_by", params.sort_by);
      if (params.sort_order != null) q.set("sort_order", params.sort_order);
      const query = q.toString();
      return apiFetch(`/videos${query ? `?${query}` : ""}`);
    },
    get: (id) => apiFetch(`/videos/${id}`),
    getTags: (videoId) => apiFetch(`/videos/${videoId}/tags`),
    addTag: (videoId, body) =>
      apiFetch(`/videos/${videoId}/tags`, { method: "POST", body: JSON.stringify(body) }),
    removeTag: (videoId, tagId) =>
      apiFetch(`/videos/${videoId}/tags/${tagId}`, { method: "DELETE" }),
    streamUrl: (id, options = {}) => {
      const base = `${API.replace(/\/$/, "")}/videos/${id}/stream`;
      if (options.transcode) return `${base}?transcode=1`;
      return base;
    },
    hlsUrl: (id) => `${API.replace(/\/$/, "")}/videos/${id}/hls/playlist.m3u8`,
    getWatchProgress: (id) => apiFetch(`/videos/${id}/watch-progress`),
    updateWatchProgress: (id, progressSeconds, progressPercent) =>
      apiFetch(`/videos/${id}/watch-progress`, {
        method: "PUT",
        body: JSON.stringify({ progress_seconds: progressSeconds, progress_percent: progressPercent }),
      }),
    create: (body) =>
      apiFetch("/videos", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/videos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id) => apiFetch(`/videos/${id}`, { method: "DELETE" }),
  },

  queue: {
    summary: () => apiFetch("/queue/summary"),
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.set("status", params.status);
      if (params.scheduler_entry_id != null) q.set("scheduler_entry_id", params.scheduler_entry_id);
      if (params.limit != null) q.set("limit", params.limit);
      if (params.offset != null) q.set("offset", params.offset);
      const query = q.toString();
      return apiFetch(`/queue${query ? `?${query}` : ""}`);
    },
    get: (id) => apiFetch(`/queue/${id}`),
    create: (body) => apiFetch("/queue", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/queue/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    acknowledge: (id) => apiFetch(`/queue/${id}/acknowledge`, { method: "PATCH" }),
    unacknowledge: (id) => apiFetch(`/queue/${id}/unacknowledge`, { method: "PATCH" }),
    cancel: (id) => apiFetch(`/queue/${id}/cancel`, { method: "POST" }),
  },

  control: {
    list: () => apiFetch("/control"),
    get: (key) => apiFetch(`/control/${encodeURIComponent(key)}`),
    set: (key, value) => apiFetch(`/control/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) }),
  },

  status: {
    get: () => apiFetch("/status"),
  },

  scheduler: {
    list: () => apiFetch("/scheduler"),
    get: (id) => apiFetch(`/scheduler/${id}`),
    create: (body) => apiFetch("/scheduler", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/scheduler/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    delete: (id) => apiFetch(`/scheduler/${id}`, { method: "DELETE" }),
    runNow: (id) => apiFetch(`/scheduler/${id}/run-now`, { method: "POST" }),
  },

  maintenance: {
    getCancelPendingFutureJobsPreview: () =>
      apiFetch("/maintenance/cancel-pending-future-jobs/preview"),
    cancelPendingFutureJobs: () =>
      apiFetch("/maintenance/cancel-pending-future-jobs", { method: "POST" }),
    clearTranscodes: () => apiFetch("/maintenance/clear-transcodes", { method: "POST" }),
    clearWatchHistory: () => apiFetch("/maintenance/clear-watch-history", { method: "POST" }),
  },

  chargedErrors: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", params.limit);
      if (params.dismissed != null) q.set("dismissed", params.dismissed);
      const query = q.toString();
      return apiFetch(`/charged_errors${query ? `?${query}` : ""}`);
    },
    dismiss: (id) => apiFetch(`/charged_errors/${id}/dismiss`, { method: "POST" }),
    undismiss: (id) => apiFetch(`/charged_errors/${id}/undismiss`, { method: "POST" }),
    dismissAll: () => apiFetch("/charged_errors/dismiss-all", { method: "POST" }),
  },

  log: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", params.limit);
      if (params.offset != null) q.set("offset", params.offset);
      if (params.video_id != null) q.set("video_id", params.video_id);
      if (params.min_severity != null) q.set("min_severity", params.min_severity);
      const query = q.toString();
      return apiFetch(`/log${query ? `?${query}` : ""}`);
    },
    recent: (limitOrParams = 10) => {
      const params = typeof limitOrParams === "object" ? limitOrParams : { limit: limitOrParams };
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", params.limit);
      if (params.video_id != null) q.set("video_id", params.video_id);
      if (params.min_severity != null) q.set("min_severity", params.min_severity);
      const query = q.toString();
      return apiFetch(`/log/recent${query ? `?${query}` : ""}`);
    },
    acknowledge: (id) => apiFetch(`/log/${id}/acknowledge`, { method: "PATCH" }),
  },
};
