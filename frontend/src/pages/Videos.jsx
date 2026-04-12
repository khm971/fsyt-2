import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { cn, formatDateOnly, formatDateTimeWithSeconds, formatDurationSeconds } from "../lib/utils";
import { shouldSkipIgnoreVideoConfirm, setSkipIgnoreVideoConfirm } from "../lib/ignoreVideoConfirm";
import { shouldSkipClearVideoStatusConfirm, setSkipClearVideoStatusConfirm } from "../lib/clearVideoStatusConfirm";
import {
  Plus, Download, FileSearch, Play, ArrowUp, ArrowDown, ArrowUpDown, Film,
  CheckCircle, Loader2, Search, FileCheck, Brain, Settings, XCircle, AlertCircle, HelpCircle,
  ListTodo, CircleDot, Eye, EyeOff, AlertTriangle, Bot, IdCard, Lock, Crown, RotateCcw,
} from "lucide-react";
import { PaginationBar } from "../components/PaginationBar";
import Modal from "../components/Modal";
import VideoColumnFilterModal, {
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
  VIDEO_IGNORED_FILTER,
} from "../components/VideoColumnFilterModal";

const PAGE_SIZE = 200;
const VIDEOS_VISIBLE_COLUMNS_KEY = "videosVisibleColumns";
const VIDEOS_FILTERS_KEY = "videosFilters";

function loadStoredColumns() {
  try {
    const s = localStorage.getItem(VIDEOS_VISIBLE_COLUMNS_KEY);
    if (!s) return [...DEFAULT_VISIBLE_COLUMNS];
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && parsed.v === 2 && Array.isArray(parsed.columns)) {
      const cols = parsed.columns;
      if (cols.length === 0) return [...DEFAULT_VISIBLE_COLUMNS];
      return cols;
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return [...DEFAULT_VISIBLE_COLUMNS];
      // Legacy: only optional keys were stored; ID and Title were always shown
      const merged = [...DEFAULT_VISIBLE_COLUMNS];
      for (const k of parsed) {
        if (!merged.includes(k)) merged.push(k);
      }
      return merged;
    }
  } catch (_) {}
  return [...DEFAULT_VISIBLE_COLUMNS];
}

function persistVisibleColumns(cols) {
  try {
    localStorage.setItem(VIDEOS_VISIBLE_COLUMNS_KEY, JSON.stringify({ v: 2, columns: cols }));
  } catch (_) {}
}

function loadStoredFilters() {
  try {
    const s = localStorage.getItem(VIDEOS_FILTERS_KEY);
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === "object") {
        const merged = { ...EMPTY_FILTERS, ...o };
        if (Object.prototype.hasOwnProperty.call(o, "include_ignored") && !Object.prototype.hasOwnProperty.call(o, "ignored")) {
          merged.ignored = o.include_ignored ? VIDEO_IGNORED_FILTER.ALL : VIDEO_IGNORED_FILTER.NOT_IGNORED;
        }
        delete merged.include_ignored;
        if (!["not_ignored", "only_ignored", "all"].includes(merged.ignored)) {
          merged.ignored = VIDEO_IGNORED_FILTER.NOT_IGNORED;
        }
        return merged;
      }
    }
  } catch (_) {}
  return { ...EMPTY_FILTERS };
}

function filtersToParams(filters) {
  const p = {};
  if (filters.channel_id) p.channel_id = parseInt(filters.channel_id, 10);
  p.ignored = filters.ignored || VIDEO_IGNORED_FILTER.NOT_IGNORED;
  if (filters.status) p.status = filters.status;
  const titleTrim = (filters.title_contains || "").trim();
  if (titleTrim) p.title_contains = titleTrim;
  if (filters.has_file === true || filters.has_file === false) p.has_file = filters.has_file;
  if (filters.has_transcode === true || filters.has_transcode === false) p.has_transcode = filters.has_transcode;
  if (filters.watch_finished === true || filters.watch_finished === false) p.watch_finished = filters.watch_finished;
  if (filters.tag_id) p.tag_id = parseInt(String(filters.tag_id), 10);
  if (filters.upload_date_from) p.upload_date_from = filters.upload_date_from;
  if (filters.upload_date_to) p.upload_date_to = filters.upload_date_to;
  if (filters.download_date_from) p.download_date_from = filters.download_date_from;
  if (filters.download_date_to) p.download_date_to = filters.download_date_to;
  if (filters.record_created_from) p.record_created_from = filters.record_created_from;
  if (filters.record_created_to) p.record_created_to = filters.record_created_to;
  if (filters.video_id !== "" && filters.video_id != null) p.video_id = parseInt(String(filters.video_id), 10);
  return p;
}

function hasActiveFilters(filters) {
  return !!(
    filters.channel_id ||
    filters.status ||
    (filters.title_contains && filters.title_contains.trim()) ||
    filters.has_file !== null ||
    filters.has_transcode !== null ||
    filters.watch_finished !== null ||
    filters.tag_id ||
    (filters.ignored && filters.ignored !== VIDEO_IGNORED_FILTER.NOT_IGNORED) ||
    filters.upload_date_from ||
    filters.upload_date_to ||
    filters.download_date_from ||
    filters.download_date_to ||
    filters.record_created_from ||
    filters.record_created_to ||
    (filters.video_id !== "" && filters.video_id != null)
  );
}

const STATUS_LABELS = {
  available: "Available",
  no_metadata: "No Metadata",
  initial_metadata_load: "Initial Metadata Load",
  getting_metadata: "Getting Metadata",
  get_metadata_for_download: "Get Metadata for Download",
  metadata_available: "Metadata Available",
  llm_processing: "LLM Processing",
  downloading: "Downloading",
  post_download_processing: "Post-Download Processing",
  error: "Error",
  error_getting_metadata: "Error Getting Metadata",
  download_error: "Download Error",
  running: "Running",
};

const STATUS_ICONS = {
  available: CheckCircle,
  no_metadata: CircleDot,
  initial_metadata_load: Loader2,
  getting_metadata: Search,
  get_metadata_for_download: Download,
  metadata_available: FileCheck,
  llm_processing: Brain,
  downloading: Download,
  post_download_processing: Settings,
  error: XCircle,
  error_getting_metadata: AlertCircle,
  download_error: AlertCircle,
  running: Play,
};

function getStatusColor(status) {
  if (!status) return "text-gray-500";
  if (status === "available") return "text-green-400";
  if (status === "no_metadata") return "text-white";
  if (["running", "downloading", "getting_metadata", "get_metadata_for_download", "post_download_processing", "llm_processing"].includes(status)) return "text-blue-400";
  if (status === "error" || status.startsWith("error")) return "text-red-400";
  return "text-gray-500";
}

function formatStatus(s) {
  if (!s) return "—";
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strip leading yt-dlp-style noise: optional "ERROR: ", "[extractor] ", video id, ":" — keep human message only. */
function stripDownloadToolStatusPrefix(s) {
  if (!s || typeof s !== "string") return s;
  const re = /^(?:[A-Z][A-Z0-9_]*:\s*)?(?:\[[^\]]+\]\s+)[A-Za-z0-9_-]{6,24}:\s*/;
  const next = s.replace(re, "").trim();
  return next.length > 0 ? next : s;
}

/** Status text column body: cleaned `status_message` only (no status label prefix). */
function statusTextForColumnCell(status, statusMessage) {
  const msg = (statusMessage || "").trim();
  if (msg) return stripDownloadToolStatusPrefix(msg);
  return formatStatus(status);
}

/** Normalize status_message for substring checks (curly apostrophe, etc.). */
function normalizeStatusMessageHints(s) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/\u2019/g, "'").toLowerCase();
}

function statusMessageIndicatesBotChallenge(statusMessage) {
  return normalizeStatusMessageHints(statusMessage).includes("sign in to confirm you're not a bot");
}

function statusMessageIndicatesAgeVerification(statusMessage) {
  const n = normalizeStatusMessageHints(statusMessage);
  return n.includes("sign in to confirm your age");
}

function statusMessageIndicatesPrivateVideo(statusMessage) {
  return normalizeStatusMessageHints(statusMessage).includes("private video");
}

function statusMessageIndicatesChannelMembersOnly(statusMessage) {
  return normalizeStatusMessageHints(statusMessage).includes(
    "this video is available to this channel's members"
  );
}

const JOB_TYPE_ICONS = {
  download_video: Download,
  get_metadata: FileSearch,
  fill_missing_metadata: FileSearch,
  download_channel_artwork: Download,
  download_one_channel: Download,
  download_auto_enabled_channels: Download,
  update_channel_info: Settings,
  add_video_from_frontend: Plus,
  add_video_from_playlist: Plus,
  transcode_video_for_ipad: Film,
  queue_all_downloads: ListTodo,
};
function getJobTypeIcon(jobType) {
  return JOB_TYPE_ICONS[jobType] ?? ListTodo;
}

/** Tooltip for pending-job icon: job id/type/status + target server instance name and id when known. */
function formatPendingJobTooltip(job, instanceNameById) {
  const line1 = `Job #${job.job_queue_id}: ${job.job_type}${job.status ? ` (${job.status})` : ""}`;
  const tid = job.target_server_instance_id;
  if (tid == null || tid === undefined) return line1;
  const name =
    (job.target_instance_name && String(job.target_instance_name).trim()) ||
    (instanceNameById && instanceNameById[tid]) ||
    "";
  const line2 = name ? `Target instance: ${name} (ID ${tid})` : `Target instance ID: ${tid}`;
  return `${line1}\n${line2}`;
}

import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import VideoPlayer from "../components/VideoPlayer";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { VideoTagChips } from "../components/VideoTagChips";
import { TagEditModal } from "../components/TagEditModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { AddVideoModal } from "../components/AddVideoModal";

export default function Videos({ setError }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const channelFromUrl = searchParams.get("channel_id") || "";
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showColumnFilterModal, setShowColumnFilterModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(loadStoredColumns);
  const [filters, setFilters] = useState(() => {
    const base = loadStoredFilters();
    const ch = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("channel_id") || "" : "";
    if (ch) return { ...base, channel_id: ch };
    return base;
  });
  const [sortBy, setSortBy] = useState("upload_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [totalVideos, setTotalVideos] = useState(0);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [tagToEdit, setTagToEdit] = useState(null);
  const [videoIdForTagEdit, setVideoIdForTagEdit] = useState(null);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [ignoreConfirm, setIgnoreConfirm] = useState(null);
  const [ignoreBusyVideoId, setIgnoreBusyVideoId] = useState(null);
  const [ignoreDontAskAgain, setIgnoreDontAskAgain] = useState(false);
  const [clearStatusConfirm, setClearStatusConfirm] = useState(null);
  const [clearStatusBusyVideoId, setClearStatusBusyVideoId] = useState(null);
  const [clearStatusDontAskAgain, setClearStatusDontAskAgain] = useState(false);
  /** null | { videoId, choices } — pick target instance for download_video */
  const [downloadTargetModal, setDownloadTargetModal] = useState(null);
  const [downloadTargetSelected, setDownloadTargetSelected] = useState("1");
  const [downloadBusyVideoId, setDownloadBusyVideoId] = useState(null);
  const [instanceNameById, setInstanceNameById] = useState({});
  const { videoUpdatedAt, videoProgressOverrides, jobs } = useQueueWebSocket();

  useEffect(() => {
    api.serverInstances
      .list()
      .then((rows) => {
        const m = {};
        for (const r of rows) {
          m[r.server_instance_id] =
            (r.display_name && String(r.display_name).trim()) || `Instance ${r.server_instance_id}`;
        }
        setInstanceNameById(m);
      })
      .catch(() => {});
  }, []);

  const filterListParams = useMemo(() => filtersToParams(filters), [filters]);

  const channelById = useMemo(() => {
    const m = new Map();
    for (const ch of channels) m.set(ch.channel_id, ch);
    return m;
  }, [channels]);

  const loadVideos = useCallback(async () => {
    try {
      const params = {
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        ...filterListParams,
      };
      const data = await api.videos.list(params);
      setVideos(data.videos);
      setTotalVideos(data.total);
    } catch (e) {
      setError(e.message);
    }
  }, [filterListParams, sortBy, sortOrder, page, setError]);

  const refreshVideoTags = useCallback((videoId) => {
    api.videos
      .getTags(videoId)
      .then((tags) => {
        setVideos((prev) =>
          prev.map((v) => (v.video_id === videoId ? { ...v, tags } : v))
        );
      })
      .catch(() => {});
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const list = await api.channels.list();
      setChannels(list);
    } catch (e) {
      setError(e.message);
    }
  }, [setError]);

  // Sync channel from URL when navigating with ?channel_id=
  useEffect(() => {
    setFilters((prev) => {
      const cur = prev.channel_id || "";
      if (channelFromUrl === cur) return prev;
      return { ...prev, channel_id: channelFromUrl };
    });
  }, [channelFromUrl]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Videos list when filters, sort, or page change
  useEffect(() => {
    setLoading(true);
    loadVideos().finally(() => setLoading(false));
  }, [loadVideos]);

  const persistFilters = (next) => {
    setFilters(next);
    try {
      localStorage.setItem(VIDEOS_FILTERS_KEY, JSON.stringify(next));
    } catch (_) {}
  };

  const setChannelIdAndUrl = (val) => {
    setFilters((prev) => {
      const next = { ...prev, channel_id: val };
      try {
        localStorage.setItem(VIDEOS_FILTERS_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
    setPage(1);
    setSearchParams(val ? { channel_id: String(val) } : {});
  };

  // Refetch when backend notifies that a video was updated (e.g. job finished)
  useEffect(() => {
    if (videoUpdatedAt > 0) loadVideos();
  }, [videoUpdatedAt, loadVideos]);

  useEffect(() => {
    if (ignoreConfirm) setIgnoreDontAskAgain(false);
  }, [ignoreConfirm]);

  useEffect(() => {
    if (clearStatusConfirm) setClearStatusDontAskAgain(false);
  }, [clearStatusConfirm]);

  const openAdd = () => setShowAdd(true);

  const queueVideoJob = async (videoId, jobType, targetServerInstanceId) => {
    try {
      const body = { job_type: jobType, video_id: videoId, priority: 50 };
      if (targetServerInstanceId != null) {
        body.target_server_instance_id = targetServerInstanceId;
      }
      const j = await api.queue.create(body);
      setError(null);
      toast.addToast(`Job queued: ${jobType} (ID ${j.job_queue_id}, video ${videoId})`, "info");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const handleDownloadClick = async (videoId) => {
    setDownloadBusyVideoId(videoId);
    try {
      const list = await api.serverInstances.list();
      const eligible = list.filter((s) => s.is_enabled && s.assign_download_jobs);
      const active = eligible.filter((s) => s.is_running);

      if (eligible.length === 0) {
        toast.addToast(
          "No server instances are enabled for downloads. Configure them in Admin → Server instances.",
          "error"
        );
        return;
      }

      if (active.length === 1) {
        await queueVideoJob(videoId, "download_video", active[0].server_instance_id);
        return;
      }

      const choices = active.length > 1 ? active : eligible;
      setDownloadTargetSelected(String(choices[0].server_instance_id));
      setDownloadTargetModal({ videoId, choices });
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setDownloadBusyVideoId(null);
    }
  };

  const confirmDownloadTarget = async () => {
    if (!downloadTargetModal) return;
    const id = parseInt(downloadTargetSelected, 10);
    const vid = downloadTargetModal.videoId;
    setDownloadTargetModal(null);
    await queueVideoJob(vid, "download_video", Number.isFinite(id) ? id : 1);
  };

  const performIgnoreToggle = async (videoId, isIgnore, { persistDontAskAgain = false } = {}) => {
    setIgnoreBusyVideoId(videoId);
    try {
      if (persistDontAskAgain) setSkipIgnoreVideoConfirm(true);
      await api.videos.update(videoId, { is_ignore: isIgnore });
      setError(null);
      toast.addToast(isIgnore ? "Video ignored" : "Video unignored", "success");
      setIgnoreConfirm(null);
      await loadVideos();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIgnoreBusyVideoId(null);
    }
  };

  const performIgnoreConfirm = async () => {
    if (!ignoreConfirm) return;
    await performIgnoreToggle(ignoreConfirm.videoId, ignoreConfirm.isIgnore, {
      persistDontAskAgain: ignoreDontAskAgain,
    });
  };

  const rowActionBusy = (videoId) =>
    ignoreBusyVideoId === videoId ||
    clearStatusBusyVideoId === videoId ||
    downloadBusyVideoId === videoId;

  const performClearStatusToggle = async (videoId, { persistDontAskAgain = false } = {}) => {
    setClearStatusBusyVideoId(videoId);
    try {
      if (persistDontAskAgain) setSkipClearVideoStatusConfirm(true);
      await api.videos.resetStatus(videoId);
      setError(null);
      toast.addToast("Video status cleared (no metadata)", "success");
      setClearStatusConfirm(null);
      await loadVideos();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setClearStatusBusyVideoId(null);
    }
  };

  const performClearStatusConfirm = async () => {
    if (!clearStatusConfirm) return;
    await performClearStatusToggle(clearStatusConfirm.videoId, {
      persistDontAskAgain: clearStatusDontAskAgain,
    });
  };

  const activeFilters = hasActiveFilters(filters);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Videos</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={openAdd} className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap min-w-[8.5rem] px-5">
            <Plus className="w-4 h-4 shrink-0" />
            Add video
          </button>
          <select
            value={filters.channel_id}
            onChange={(e) => setChannelIdAndUrl(e.target.value)}
            className="input w-40 min-w-0 max-w-[12rem]"
          >
            <option value="">All channels</option>
            {channels.map((ch) => (
              <option key={ch.channel_id} value={String(ch.channel_id)}>
                {ch.title || ch.handle || ch.channel_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <PaginationBar
        page={page}
        totalPages={Math.max(1, Math.ceil(totalVideos / PAGE_SIZE))}
        total={totalVideos}
        pageSize={PAGE_SIZE}
        itemLabel="videos"
        onPageChange={setPage}
        disabled={loading}
        onFilterClick={() => setShowColumnFilterModal(true)}
        filterActive={activeFilters}
        onClearFilters={() => {
          const next = { ...EMPTY_FILTERS };
          persistFilters(next);
          setPage(1);
          setSearchParams({});
        }}
      />

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Loading...</div>
        )}
        {!loading && (
        <table className="w-full text-left text-sm table-fixed">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              {visibleColumns.includes("id") && (
              <th className="px-4 py-3 font-medium w-16">
                <div className="flex items-center gap-1">
                  ID
                  <Tooltip title={sortBy === "id" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by ID"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("id"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "id" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              )}
              {visibleColumns.includes("title") && (
              <th className="px-4 py-3 font-medium min-w-0">
                <div className="flex items-center gap-1">
                  Title
                  <Tooltip title={sortBy === "title" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Title"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); setSortBy("title"); if (sortBy === "title") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else setSortOrder("asc"); }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "title" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "title" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              )}
              {visibleColumns.includes("provider_key") && (
                <th className="px-4 py-3 font-medium">Provider key</th>
              )}
              {visibleColumns.includes("channel") && (
                <th className="px-4 py-3 font-medium">Channel</th>
              )}
              {visibleColumns.includes("duration") && (
                <th className="px-4 py-3 font-medium">Duration</th>
              )}
              {visibleColumns.includes("upload_date") && (
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-1">
                    Upload date
                    <Tooltip title={sortBy === "upload_date" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by upload date"}>
                      <button
                        type="button"
                        onClick={() => { setPage(1); if (sortBy === "upload_date") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("upload_date"); setSortOrder("desc"); } }}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "upload_date" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "upload_date" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </Tooltip>
                  </div>
                </th>
              )}
              {visibleColumns.includes("record_created") && (
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-1">
                    Record created
                    <Tooltip title={sortBy === "record_created" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by record created"}>
                      <button
                        type="button"
                        onClick={() => { setPage(1); if (sortBy === "record_created") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("record_created"); setSortOrder("desc"); } }}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "record_created" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "record_created" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </Tooltip>
                  </div>
                </th>
              )}
              {visibleColumns.includes("download_date") && (
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-1">
                    Download date
                    <Tooltip title={sortBy === "download_date" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by download date"}>
                      <button
                        type="button"
                        onClick={() => { setPage(1); if (sortBy === "download_date") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("download_date"); setSortOrder("desc"); } }}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "download_date" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "download_date" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                      </button>
                    </Tooltip>
                  </div>
                </th>
              )}
              {visibleColumns.includes("watch_progress") && (
                <th className="px-4 py-3 font-medium">Watch</th>
              )}
              {visibleColumns.includes("created_by") && (
                <th className="px-4 py-3 font-medium">Created by</th>
              )}
              {visibleColumns.includes("status") && (
                <th className="px-4 py-3 font-medium min-w-0 max-w-[12rem]">Status</th>
              )}
              {visibleColumns.includes("status_text") && (
                <th className="px-4 py-3 font-medium min-w-0 max-w-[16rem]">Status text</th>
              )}
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Flags
                  <Tooltip title={sortBy === "status" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Status"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); setSortBy("status"); if (sortBy === "status") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else setSortOrder("asc"); }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "status" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "status" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium w-48">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {videos.map((v) => {
              const override = videoProgressOverrides[v.video_id];
              const status = override?.status ?? v.status;
              const percent = override?.status_percent_complete ?? v.status_percent_complete;
              const showProgress = ["downloading", "get_metadata_for_download", "post_download_processing", "getting_metadata", "llm_processing"].includes(status) && (percent != null || status === "downloading");
              const pendingJobFromApi =
                v.pending_job_id != null && v.pending_job_type != null
                  ? {
                      job_queue_id: v.pending_job_id,
                      job_type: v.pending_job_type,
                      status: v.pending_job_status,
                      target_server_instance_id: v.pending_job_target_server_instance_id,
                      target_instance_name: v.pending_job_target_instance_name,
                    }
                  : null;
              const pendingJobFromWsRaw =
                jobs
                  .filter((j) => j.video_id === v.video_id)
                  .sort((a, b) => {
                    const aT = a.last_update ? new Date(a.last_update).getTime() : 0;
                    const bT = b.last_update ? new Date(b.last_update).getTime() : 0;
                    if (bT !== aT) return bT - aT;
                    return (b.job_queue_id ?? 0) - (a.job_queue_id ?? 0);
                  })[0] ?? null;
              const pendingJobFromWs = pendingJobFromWsRaw
                ? {
                    job_queue_id: pendingJobFromWsRaw.job_queue_id,
                    job_type: pendingJobFromWsRaw.job_type,
                    status: pendingJobFromWsRaw.status,
                    target_server_instance_id: pendingJobFromWsRaw.target_server_instance_id,
                    target_instance_name: null,
                  }
                : null;
              const pendingJob = pendingJobFromApi ?? pendingJobFromWs;
              const StatusIconComponent = status ? (STATUS_ICONS[status] ?? HelpCircle) : HelpCircle;
              const statusTooltip = [formatStatus(status), v.status_message].filter(Boolean).join(" — ");
              const showBotChallengeFlag = statusMessageIndicatesBotChallenge(v.status_message);
              const showAgeVerificationFlag = statusMessageIndicatesAgeVerification(v.status_message);
              const showPrivateVideoFlag = statusMessageIndicatesPrivateVideo(v.status_message);
              const showChannelMembersFlag = statusMessageIndicatesChannelMembersOnly(v.status_message);
              return (
              <tr key={v.video_id} className="hover:bg-gray-800/30">
                {visibleColumns.includes("id") && (
                <td className="px-4 py-2 font-mono text-gray-300">{v.video_id}</td>
                )}
                {visibleColumns.includes("title") && (
                <td className="px-4 py-2 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tooltip title="Video details" side="top" wrap>
                      <button
                        type="button"
                        onClick={() => setVideoIdForDetails(v.video_id)}
                        className="text-white hover:text-blue-400 text-left"
                      >
                        {v.title || v.provider_key || "—"}
                      </button>
                    </Tooltip>
                    <VideoTagChips
                      tags={v.tags || []}
                      onTagClick={(tag) => {
                        setTagToEdit(tag);
                        setVideoIdForTagEdit(v.video_id);
                      }}
                      onMoreClick={() => setVideoIdForDetails(v.video_id)}
                    />
                  </div>
                </td>
                )}
                {visibleColumns.includes("provider_key") && (
                  <td className="px-4 py-2 font-mono text-gray-400 text-xs truncate" title={v.provider_key}>
                    {v.provider_key || "—"}
                  </td>
                )}
                {visibleColumns.includes("channel") && (() => {
                  const ch = v.channel_id != null ? channelById.get(v.channel_id) : null;
                  const label = ch ? ch.title || ch.handle || String(v.channel_id) : v.channel_id != null ? String(v.channel_id) : "—";
                  return (
                    <td className="px-4 py-2 text-gray-300 truncate max-w-[10rem]" title={label}>
                      {label}
                    </td>
                  );
                })()}
                {visibleColumns.includes("duration") && (
                  <td className="px-4 py-2 text-gray-300 whitespace-nowrap">
                    {v.duration != null ? formatDurationSeconds(v.duration) : "—"}
                  </td>
                )}
                {visibleColumns.includes("upload_date") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {v.upload_date ? formatDateOnly(v.upload_date) : "—"}
                  </td>
                )}
                {visibleColumns.includes("record_created") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {v.record_created ? formatDateTimeWithSeconds(v.record_created) : "—"}
                  </td>
                )}
                {visibleColumns.includes("download_date") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {v.download_date ? formatDateTimeWithSeconds(v.download_date) : "—"}
                  </td>
                )}
                {visibleColumns.includes("watch_progress") && (
                  <td className="px-4 py-2 text-gray-300 text-xs">
                    {v.watch_is_finished
                      ? "Finished"
                      : v.watch_progress_percent != null && v.watch_progress_percent > 0
                        ? `${Math.round(v.watch_progress_percent)}%`
                        : "—"}
                  </td>
                )}
                {visibleColumns.includes("created_by") && (
                  <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[8rem]" title={v.created_by_username || undefined}>
                    {v.created_by_username || "—"}
                  </td>
                )}
                {visibleColumns.includes("status") && (
                  <td
                    className="px-4 py-2 font-mono text-gray-400 text-xs truncate max-w-[14rem]"
                    title={status ? `${status} — ${formatStatus(status)}` : undefined}
                  >
                    {status || "—"}
                  </td>
                )}
                {visibleColumns.includes("status_text") && (
                  <td
                    className="px-4 py-2 text-gray-300 text-xs truncate max-w-[16rem] min-w-0"
                    title={statusTooltip || undefined}
                  >
                    {statusTextForColumnCell(status, v.status_message) || "—"}
                  </td>
                )}
                <td className="px-4 py-2 min-w-[140px]">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Tooltip title={statusTooltip || "Status"}>
                        <span className={cn("inline-flex shrink-0", getStatusColor(status))}>
                          <StatusIconComponent className="w-4 h-4" />
                        </span>
                      </Tooltip>
                      {v.transcode_path && (
                        <Tooltip title="Transcode Exists">
                          <span className="inline-flex text-gray-400 shrink-0">
                            <Film className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                      {pendingJob && (() => {
                        const JobIconComponent = getJobTypeIcon(pendingJob.job_type);
                        const jobTooltip = formatPendingJobTooltip(pendingJob, instanceNameById);
                        return (
                          <Tooltip title={jobTooltip} wrap side="top">
                            <button
                              type="button"
                              onClick={() => setJobQueueIdForModal(pendingJob.job_queue_id)}
                              className="inline-flex text-purple-400 hover:text-purple-300 hover:bg-gray-700 rounded p-0.5 shrink-0"
                            >
                              <JobIconComponent className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        );
                      })()}
                      {showBotChallengeFlag && (
                        <Tooltip
                          title="Sign-in may be required: source reports a bot check ('confirm you're not a bot')."
                          side="top"
                          wrap
                        >
                          <span className="inline-flex shrink-0 text-red-500" aria-label="Bot check may be required">
                            <Bot className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                      {showAgeVerificationFlag && (
                        <Tooltip
                          title="Sign-in may be required: age verification ('confirm your age')."
                          side="top"
                          wrap
                        >
                          <span className="inline-flex shrink-0 text-yellow-400" aria-label="Age verification may be required">
                            <IdCard className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                      {showPrivateVideoFlag && (
                        <Tooltip
                          title="Status text indicates this video is private (may require access or sign-in)."
                          side="top"
                          wrap
                        >
                          <span className="inline-flex shrink-0 text-yellow-400" aria-label="Private video">
                            <Lock className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                      {showChannelMembersFlag && (
                        <Tooltip
                          title="Status text indicates this video is for the channel's members only (membership may be required)."
                          side="top"
                          wrap
                        >
                          <span className="inline-flex shrink-0 text-amber-400" aria-label="Channel members only">
                            <Crown className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    {showProgress && (
                      <div className="w-full max-w-[120px] h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, Number(percent) || 0))}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 flex gap-1 flex-wrap">
                  <Tooltip title={
                    v.watch_is_finished ? "Play (finished)" :
                    (v.watch_progress_percent != null && v.watch_progress_percent > 0 && v.watch_progress_percent < 95) ? `Play (in progress, ${Math.round(v.watch_progress_percent)}%)` :
                    "Play"
                  }>
                    <button
                      type="button"
                      onClick={() => setPlayingVideo({ id: v.video_id, title: v.title || v.provider_key, duration: v.duration })}
                      disabled={status !== "available"}
                      className={cn(
                        "p-1.5 rounded",
                        status === "available"
                          ? v.watch_is_finished
                            ? "text-purple-400 hover:text-purple-300 hover:bg-gray-700"
                            : (v.watch_progress_percent != null && v.watch_progress_percent > 0 && v.watch_progress_percent < 95)
                              ? "text-blue-400 hover:text-blue-300 hover:bg-gray-700"
                              : "text-gray-400 hover:text-green-400 hover:bg-gray-700"
                          : "text-gray-600 cursor-not-allowed opacity-50"
                      )}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title="Get metadata">
                    <button
                      type="button"
                      onClick={() => queueVideoJob(v.video_id, "get_metadata")}
                      className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded"
                    >
                      <FileSearch className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title="Download">
                    <button
                      type="button"
                      onClick={() => handleDownloadClick(v.video_id)}
                      disabled={downloadBusyVideoId === v.video_id}
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title="Clear status — reset to No metadata (as when first added); does not delete files" side="top" wrap>
                    <button
                      type="button"
                      onClick={() => {
                        if (shouldSkipClearVideoStatusConfirm()) {
                          void performClearStatusToggle(v.video_id);
                        } else {
                          setClearStatusConfirm({ videoId: v.video_id });
                        }
                      }}
                      disabled={rowActionBusy(v.video_id)}
                      className="p-1.5 text-gray-400 hover:text-orange-400 hover:bg-gray-700 rounded disabled:opacity-50 disabled:pointer-events-none"
                      aria-label="Clear video status"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title={v.is_ignore ? "Unignore video" : "Ignore video"} side="top" wrap>
                    <button
                      type="button"
                      onClick={() => {
                        const isIgnore = !v.is_ignore;
                        if (shouldSkipIgnoreVideoConfirm()) {
                          void performIgnoreToggle(v.video_id, isIgnore);
                        } else {
                          setIgnoreConfirm({ videoId: v.video_id, isIgnore });
                        }
                      }}
                      disabled={rowActionBusy(v.video_id)}
                      className={cn(
                        "p-1.5 rounded disabled:opacity-50 disabled:pointer-events-none",
                        v.is_ignore
                          ? "text-yellow-400 hover:text-yellow-300 hover:bg-gray-700"
                          : "text-gray-400 hover:text-yellow-400 hover:bg-gray-700",
                      )}
                      aria-label={v.is_ignore ? "Unignore video" : "Ignore video"}
                    >
                      {v.is_ignore ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </Tooltip>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
        )}
        {!loading && videos.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No videos.</div>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={Math.max(1, Math.ceil(totalVideos / PAGE_SIZE))}
        total={totalVideos}
        pageSize={PAGE_SIZE}
        itemLabel="videos"
        onPageChange={setPage}
        disabled={loading}
        onFilterClick={() => setShowColumnFilterModal(true)}
        filterActive={activeFilters}
        onClearFilters={() => {
          const next = { ...EMPTY_FILTERS };
          persistFilters(next);
          setPage(1);
          setSearchParams({});
        }}
      />

      {showColumnFilterModal && (
        <VideoColumnFilterModal
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={(cols) => {
            setVisibleColumns(cols);
            persistVisibleColumns(cols);
          }}
          filters={filters}
          onFiltersChange={(newFilters) => {
            persistFilters(newFilters);
            setPage(1);
            const ch = newFilters.channel_id;
            setSearchParams(ch ? { channel_id: String(ch) } : {});
          }}
          channels={channels}
          onClose={() => setShowColumnFilterModal(false)}
        />
      )}

      {playingVideo && (
        <VideoPlayer
          videoId={playingVideo.id}
          title={playingVideo.title}
          duration={playingVideo.duration}
          onClose={() => {
            setPlayingVideo(null);
            loadVideos();
          }}
        />
      )}
      <AddVideoModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        setError={setError}
        onSuccess={() => loadVideos()}
      />

      <VideoDetailsModal
        videoId={videoIdForDetails}
        onClose={() => {
          const vid = videoIdForDetails;
          setVideoIdForDetails(null);
          if (vid != null) refreshVideoTags(vid);
        }}
        setError={setError}
        toast={toast}
        onVideoUpdated={loadVideos}
        onOpenJobDetails={(jobId) => setJobQueueIdForModal(jobId)}
        onOpenChannelEdit={(channelId) => setEditingChannelId(channelId)}
      />
      {tagToEdit && (
        <TagEditModal
          tag={tagToEdit}
          videoId={videoIdForTagEdit}
          onClose={() => {
            setTagToEdit(null);
            setVideoIdForTagEdit(null);
          }}
          onSaved={() => {
            if (videoIdForTagEdit != null) refreshVideoTags(videoIdForTagEdit);
          }}
        />
      )}
      <ChannelEditModal
        channelId={editingChannelId}
        onClose={() => setEditingChannelId(null)}
        onSaved={loadVideos}
        setError={setError}
      />
      <JobDetailsModal
        jobId={jobQueueIdForModal}
        onClose={() => setJobQueueIdForModal(null)}
        setError={setError}
        toast={toast}
        onJobCanceled={loadVideos}
      />

      {clearStatusConfirm && (
        <Modal
          title="Clear video status"
          onClose={() => clearStatusBusyVideoId == null && setClearStatusConfirm(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-blue-900/60 bg-blue-950/30 p-4">
              <div className="rounded-full bg-blue-900/50 p-2 text-blue-300">
                <RotateCcw className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                Reset processing status to <span className="font-mono text-blue-200">no_metadata</span> (same as when the video was first added, before download). The status message is cleared. Downloaded files are not removed.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={clearStatusDontAskAgain}
                onChange={(e) => setClearStatusDontAskAgain(e.target.checked)}
                disabled={clearStatusBusyVideoId != null}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 shrink-0"
              />
              Don&apos;t ask again (until you refresh or close this tab)
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setClearStatusConfirm(null)}
                disabled={clearStatusBusyVideoId != null}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performClearStatusConfirm}
                disabled={clearStatusBusyVideoId != null}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {clearStatusBusyVideoId != null ? "Please wait…" : "Clear status"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {downloadTargetModal && (
        <Modal
          title="Download — target server instance"
          onClose={() => setDownloadTargetModal(null)}
        >
          <div className="space-y-4 text-sm">
            <p className="text-gray-300">
              Choose which worker should run this <span className="font-mono text-white">download_video</span> job
              (video ID {downloadTargetModal.videoId}).
            </p>
            {downloadTargetModal.choices.length > 0 &&
              !downloadTargetModal.choices.some((s) => s.is_running) && (
                <p className="text-amber-400/90 text-xs">
                  No instance has a recent heartbeat; you can still queue to a configured downloader.
                </p>
              )}
            <label className="block">
              <span className="text-gray-400 block mb-1">Server instance</span>
              <select
                value={downloadTargetSelected}
                onChange={(e) => setDownloadTargetSelected(e.target.value)}
                className="input w-full"
              >
                {downloadTargetModal.choices.map((s) => (
                  <option key={s.server_instance_id} value={String(s.server_instance_id)}>
                    {s.display_name} (ID {s.server_instance_id})
                    {s.is_running ? " — running" : " — not running"}
                    {!s.is_enabled ? " — disabled" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setDownloadTargetModal(null)} className="btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={() => void confirmDownloadTarget()} className="btn-primary">
                Queue download
              </button>
            </div>
          </div>
        </Modal>
      )}

      {ignoreConfirm && (
        <Modal
          title={ignoreConfirm.isIgnore ? "Ignore video" : "Unignore video"}
          onClose={() => ignoreBusyVideoId == null && setIgnoreConfirm(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-yellow-900/60 bg-yellow-950/30 p-4">
              <div className="rounded-full bg-yellow-900/50 p-2 text-yellow-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                {ignoreConfirm.isIgnore
                  ? "Ignore this video? It will be hidden from the default view."
                  : "Unignore this video?"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ignoreDontAskAgain}
                onChange={(e) => setIgnoreDontAskAgain(e.target.checked)}
                disabled={ignoreBusyVideoId != null}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 shrink-0"
              />
              Don&apos;t ask again (until you refresh or close this tab)
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIgnoreConfirm(null)}
                disabled={ignoreBusyVideoId != null}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performIgnoreConfirm}
                disabled={ignoreBusyVideoId != null}
                className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {ignoreBusyVideoId != null ? "Please wait…" : "Yes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
