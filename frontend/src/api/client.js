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
    credentials: "include",
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
  me: () => apiFetch("/me"),
  users: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.enabled != null) q.set("enabled", String(params.enabled));
      const query = q.toString();
      return apiFetch(`/users${query ? `?${query}` : ""}`);
    },
  },
  switchUser: (userId) =>
    apiFetch("/switch-user", { method: "POST", body: JSON.stringify({ user_id: userId }) }),

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
      const titleTrim = params.title_contains != null ? String(params.title_contains).trim() : "";
      if (titleTrim) q.set("title_contains", titleTrim);
      if (params.is_enabled_for_auto_download === true || params.is_enabled_for_auto_download === false) {
        q.set("is_enabled_for_auto_download", String(params.is_enabled_for_auto_download));
      }
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
      if (params.include_unavailable != null) q.set("include_unavailable", params.include_unavailable);
      if (params.limit != null) q.set("limit", params.limit);
      const query = q.toString();
      return apiFetch(`/videos/by-tags${query ? `?${query}` : ""}`);
    },
    search: (params = {}) => {
      const q = new URLSearchParams();
      if (params.q != null && params.q !== "") q.set("q", params.q);
      if (params.include_unavailable != null) q.set("include_unavailable", params.include_unavailable);
      if (params.limit != null) q.set("limit", params.limit);
      const query = q.toString();
      return apiFetch(`/videos/search${query ? `?${query}` : ""}`);
    },
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.channel_id != null && params.channel_id !== "") q.set("channel_id", params.channel_id);
      if (params.ignored != null && params.ignored !== "") q.set("ignored", params.ignored);
      if (params.status != null && params.status !== "") q.set("status", params.status);
      if (params.title_contains != null && params.title_contains !== "") q.set("title_contains", params.title_contains);
      if (params.has_file === true || params.has_file === false) q.set("has_file", String(params.has_file));
      if (params.has_transcode === true || params.has_transcode === false) q.set("has_transcode", String(params.has_transcode));
      if (params.watch_finished === true || params.watch_finished === false) q.set("watch_finished", String(params.watch_finished));
      if (params.tag_id != null && params.tag_id !== "") q.set("tag_id", params.tag_id);
      if (params.upload_date_from != null && params.upload_date_from !== "") q.set("upload_date_from", params.upload_date_from);
      if (params.upload_date_to != null && params.upload_date_to !== "") q.set("upload_date_to", params.upload_date_to);
      if (params.download_date_from != null && params.download_date_from !== "") q.set("download_date_from", params.download_date_from);
      if (params.download_date_to != null && params.download_date_to !== "") q.set("download_date_to", params.download_date_to);
      if (params.record_created_from != null && params.record_created_from !== "") q.set("record_created_from", params.record_created_from);
      if (params.record_created_to != null && params.record_created_to !== "") q.set("record_created_to", params.record_created_to);
      if (params.video_id != null && params.video_id !== "") q.set("video_id", params.video_id);
      if (params.limit != null) q.set("limit", params.limit);
      if (params.offset != null) q.set("offset", params.offset);
      if (params.sort_by != null) q.set("sort_by", params.sort_by);
      if (params.sort_order != null) q.set("sort_order", params.sort_order);
      const query = q.toString();
      return apiFetch(`/videos${query ? `?${query}` : ""}`);
    },
    filterOptions: () => apiFetch("/videos/filter-options"),
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
    updateWatchStatus: (id, isFinished) =>
      apiFetch(`/videos/${id}/watch-status`, {
        method: "PATCH",
        body: JSON.stringify({ is_finished: isFinished }),
      }),
    create: (body) =>
      apiFetch("/videos", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/videos/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    resetStatus: (id) => apiFetch(`/videos/${id}/reset-status`, { method: "POST" }),
  },

  queue: {
    summary: () => apiFetch("/queue/summary"),
    list: (params = {}) => {
      const { signal, ...queryParams } = params;
      const q = new URLSearchParams();
      if (queryParams.status) q.set("status", queryParams.status);
      if (queryParams.job_type) q.set("job_type", queryParams.job_type);
      if (queryParams.scheduler_entry_id != null) q.set("scheduler_entry_id", queryParams.scheduler_entry_id);
      if (queryParams.video_id != null && queryParams.video_id !== "") q.set("video_id", queryParams.video_id);
      if (queryParams.channel_id != null && queryParams.channel_id !== "") q.set("channel_id", queryParams.channel_id);
      if (queryParams.scheduled_future !== undefined && queryParams.scheduled_future !== null) q.set("scheduled_future", String(queryParams.scheduled_future));
      if (queryParams.error_flag !== undefined && queryParams.error_flag !== null) q.set("error_flag", String(queryParams.error_flag));
      if (queryParams.warning_flag !== undefined && queryParams.warning_flag !== null) q.set("warning_flag", String(queryParams.warning_flag));
      if (queryParams.acknowledge_flag !== undefined && queryParams.acknowledge_flag !== null) q.set("acknowledge_flag", String(queryParams.acknowledge_flag));
      if (queryParams.record_created_from) q.set("record_created_from", queryParams.record_created_from);
      if (queryParams.record_created_to) q.set("record_created_to", queryParams.record_created_to);
      if (queryParams.last_update_from) q.set("last_update_from", queryParams.last_update_from);
      if (queryParams.last_update_to) q.set("last_update_to", queryParams.last_update_to);
      if (queryParams.run_after_from) q.set("run_after_from", queryParams.run_after_from);
      if (queryParams.run_after_to) q.set("run_after_to", queryParams.run_after_to);
      if (queryParams.limit != null) q.set("limit", queryParams.limit);
      if (queryParams.offset != null) q.set("offset", queryParams.offset);
      if (queryParams.sort_by != null) q.set("sort_by", queryParams.sort_by);
      if (queryParams.sort_order != null) q.set("sort_order", queryParams.sort_order);
      const query = q.toString();
      return apiFetch(`/queue${query ? `?${query}` : ""}`, { signal });
    },
    filterOptions: () => apiFetch("/queue/filter-options"),
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

  information: {
    get: () => apiFetch("/information"),
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
    getGenerateMissingLlmDescriptionsPreview: () =>
      apiFetch("/maintenance/generate-missing-llm-descriptions/preview"),
    generateMissingLlmDescriptions: () =>
      apiFetch("/maintenance/generate-missing-llm-descriptions", { method: "POST" }),
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

  jellyfin: {
    getStatus: () => apiFetch("/jellyfin/status"),
    getLibraryItems: (libraryName = "FSYT-2") =>
      apiFetch(`/jellyfin/library-items?library_name=${encodeURIComponent(libraryName)}`),
    getItemWatchStatus: (itemId) =>
      apiFetch(`/jellyfin/library-items/${encodeURIComponent(itemId)}/watch-status`),
  },

  log: {
    get: (id) => apiFetch(`/log/${id}`),
    filterOptions: () => apiFetch("/log/filter-options"),
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", params.limit);
      if (params.offset != null) q.set("offset", params.offset);
      if (params.video_id != null) q.set("video_id", params.video_id);
      if (params.min_severity != null) q.set("min_severity", params.min_severity);
      const msg = params.message_contains != null ? String(params.message_contains).trim() : "";
      if (msg) q.set("message_contains", msg);
      if (params.job_id != null) q.set("job_id", params.job_id);
      if (params.channel_id != null) q.set("channel_id", params.channel_id);
      if (params.acknowledged === true || params.acknowledged === false) q.set("acknowledged", String(params.acknowledged));
      const sub = params.subsystem != null ? String(params.subsystem).trim() : "";
      if (sub) q.set("subsystem", sub);
      if (params.sort_by != null) q.set("sort_by", params.sort_by);
      if (params.sort_order != null) q.set("sort_order", params.sort_order);
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
