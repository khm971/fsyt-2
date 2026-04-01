import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds, formatDurationSeconds } from "../lib/utils";
import {
  Plus, Download, FileSearch, Play, ArrowUp, ArrowDown, ArrowUpDown, Film,
  CheckCircle, Loader2, Search, FileCheck, Brain, Settings, XCircle, AlertCircle, HelpCircle,
  ListTodo, CircleDot, Eye, EyeOff, AlertTriangle,
} from "lucide-react";
import { PaginationBar } from "../components/PaginationBar";
import Modal from "../components/Modal";
import VideoColumnFilterModal, {
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
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
      if (o && typeof o === "object") return { ...EMPTY_FILTERS, ...o };
    }
  } catch (_) {}
  return { ...EMPTY_FILTERS };
}

function filtersToParams(filters) {
  const p = {};
  if (filters.channel_id) p.channel_id = parseInt(filters.channel_id, 10);
  if (filters.include_ignored) p.include_ignored = true;
  if (filters.status) p.status = filters.status;
  const titleTrim = (filters.title_contains || "").trim();
  if (titleTrim) p.title_contains = titleTrim;
  if (filters.has_file === true || filters.has_file === false) p.has_file = filters.has_file;
  if (filters.has_transcode === true || filters.has_transcode === false) p.has_transcode = filters.has_transcode;
  if (filters.watch_finished === true || filters.watch_finished === false) p.watch_finished = filters.watch_finished;
  if (filters.tag_id) p.tag_id = parseInt(String(filters.tag_id), 10);
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
    filters.include_ignored ||
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
  const [sortBy, setSortBy] = useState("id");
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
  const [ignoreLoading, setIgnoreLoading] = useState(false);
  const { videoUpdatedAt, videoProgressOverrides, jobs } = useQueueWebSocket();

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

  const openAdd = () => setShowAdd(true);

  const queueVideoJob = async (videoId, jobType) => {
    try {
      const j = await api.queue.create({ job_type: jobType, video_id: videoId, priority: 50 });
      setError(null);
      toast.addToast(`Job queued: ${jobType} (ID ${j.job_queue_id}, video ${videoId})`, "info");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const performIgnoreConfirm = async () => {
    if (!ignoreConfirm) return;
    setIgnoreLoading(true);
    try {
      await api.videos.update(ignoreConfirm.videoId, { is_ignore: ignoreConfirm.isIgnore });
      setError(null);
      toast.addToast(ignoreConfirm.isIgnore ? "Video ignored" : "Video unignored", "success");
      setIgnoreConfirm(null);
      await loadVideos();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIgnoreLoading(false);
    }
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
                <th className="px-4 py-3 font-medium">Upload date</th>
              )}
              {visibleColumns.includes("record_created") && (
                <th className="px-4 py-3 font-medium">Record created</th>
              )}
              {visibleColumns.includes("download_date") && (
                <th className="px-4 py-3 font-medium">Download date</th>
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
              const pendingJobFromApi = v.pending_job_id != null && v.pending_job_type != null
                ? { job_queue_id: v.pending_job_id, job_type: v.pending_job_type }
                : null;
              const pendingJobFromWs = jobs
                .filter((j) => j.video_id === v.video_id)
                .sort((a, b) => {
                  const aT = a.last_update ? new Date(a.last_update).getTime() : 0;
                  const bT = b.last_update ? new Date(b.last_update).getTime() : 0;
                  if (bT !== aT) return bT - aT;
                  return (b.job_queue_id ?? 0) - (a.job_queue_id ?? 0);
                })[0] ?? null;
              const pendingJob = pendingJobFromApi ?? pendingJobFromWs;
              const StatusIconComponent = status ? (STATUS_ICONS[status] ?? HelpCircle) : HelpCircle;
              const statusTooltip = [formatStatus(status), v.status_message].filter(Boolean).join(" — ");
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
                    {v.upload_date ? formatDateTimeWithSeconds(v.upload_date) : "—"}
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
                        const jobTooltip = `Job #${pendingJob.job_queue_id}: ${pendingJob.job_type}${pendingJob.status ? ` (${pendingJob.status})` : ""}`;
                        return (
                          <Tooltip title={jobTooltip}>
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
                <td className="px-4 py-2 flex gap-1 flex-nowrap">
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
                      onClick={() => queueVideoJob(v.video_id, "download_video")}
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title={v.is_ignore ? "Unignore video" : "Ignore video"} side="top" wrap>
                    <button
                      type="button"
                      onClick={() =>
                        setIgnoreConfirm({
                          videoId: v.video_id,
                          isIgnore: !v.is_ignore,
                        })
                      }
                      className={cn(
                        "p-1.5 rounded",
                        v.is_ignore
                          ? "text-yellow-400 hover:text-yellow-300 hover:bg-gray-700"
                          : "text-gray-400 hover:text-yellow-400 hover:bg-gray-700"
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

      {ignoreConfirm && (
        <Modal
          title={ignoreConfirm.isIgnore ? "Ignore video" : "Unignore video"}
          onClose={() => !ignoreLoading && setIgnoreConfirm(null)}
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
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIgnoreConfirm(null)}
                disabled={ignoreLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performIgnoreConfirm}
                disabled={ignoreLoading}
                className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {ignoreLoading ? "Please wait…" : "Yes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
