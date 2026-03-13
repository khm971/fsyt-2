import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import {
  Plus, Download, FileSearch, Play, ArrowUp, ArrowDown, ArrowUpDown, Film,
  CheckCircle, Loader2, Search, FileCheck, Brain, Settings, XCircle, AlertCircle, HelpCircle,
  ListTodo, CalendarClock, MessageCircle, CircleDot,
} from "lucide-react";
import { PaginationBar } from "../components/PaginationBar";

const PAGE_SIZE = 200;

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

export default function Videos({ setError }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const channelFromUrl = searchParams.get("channel_id") || "";
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [channelFilter, setChannelFilter] = useState(channelFromUrl);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [totalVideos, setTotalVideos] = useState(0);
  const [addForm, setAddForm] = useState({ provider_key: "", queue_download: true });
  const [playingVideo, setPlayingVideo] = useState(null);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [tagToEdit, setTagToEdit] = useState(null);
  const [videoIdForTagEdit, setVideoIdForTagEdit] = useState(null);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const { videoUpdatedAt, videoProgressOverrides, jobs } = useQueueWebSocket();

  const loadVideos = useCallback(async () => {
    try {
      const params = {
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      if (channelFilter) params.channel_id = parseInt(channelFilter, 10);
      const data = await api.videos.list(params);
      setVideos(data.videos);
      setTotalVideos(data.total);
    } catch (e) {
      setError(e.message);
    }
  }, [channelFilter, sortBy, sortOrder, page, setError]);

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

  const loadChannels = async () => {
    try {
      const list = await api.channels.list();
      setChannels(list);
    } catch (e) {
      setError(e.message);
    }
  };

  // Sync channel filter from URL when navigating with ?channel_id=
  useEffect(() => {
    if (channelFromUrl !== channelFilter) {
      setChannelFilter(channelFromUrl);
    }
  }, [channelFromUrl]);

  // Initial load and when filters or page change
  useEffect(() => {
    setLoading(true);
    Promise.all([loadVideos(), loadChannels()]).finally(() => setLoading(false));
  }, [channelFilter, sortBy, sortOrder, page]);

  // Refetch when backend notifies that a video was updated (e.g. job finished)
  useEffect(() => {
    if (videoUpdatedAt > 0) loadVideos();
  }, [videoUpdatedAt, loadVideos]);

  const openAdd = () => {
    setAddForm({ provider_key: "", queue_download: true, tag_needs_review: true });
    setShowAdd(true);
  };

  const saveAdd = async () => {
    try {
      const v = await api.videos.create({
        provider_key: addForm.provider_key,
        queue_download: addForm.queue_download,
        tag_needs_review: addForm.tag_needs_review !== false,
      });
      setShowAdd(false);
      loadVideos();
      toast.addToast(`Video added (ID ${v.video_id})${addForm.queue_download ? ", download queued" : ""}`, "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

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

  if (loading) return <div className="text-gray-400 py-8">Loading...</div>;

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
            value={channelFilter}
            onChange={(e) => {
              const val = e.target.value;
              setChannelFilter(val);
              setPage(1);
              setSearchParams(val ? { channel_id: val } : {});
            }}
            className="input w-40"
          >
            <option value="">All channels</option>
            {channels.map((ch) => (
              <option key={ch.channel_id} value={ch.channel_id}>
                {ch.title || ch.handle || ch.channel_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {totalVideos > 0 && (
        <PaginationBar
          page={page}
          totalPages={Math.max(1, Math.ceil(totalVideos / PAGE_SIZE))}
          total={totalVideos}
          pageSize={PAGE_SIZE}
          itemLabel="videos"
          onPageChange={setPage}
          disabled={loading}
        />
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">
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
              <th className="px-4 py-3 font-medium">
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
                .filter((j) => j.video_id === v.video_id && (j.status === "new" || j.status === "running"))
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
                <td className="px-4 py-2 font-mono text-gray-300">{v.video_id}</td>
                <td className="px-4 py-2">
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
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
        {videos.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No videos.</div>
        )}
      </div>

      {totalVideos > 0 && (
        <PaginationBar
          page={page}
          totalPages={Math.max(1, Math.ceil(totalVideos / PAGE_SIZE))}
          total={totalVideos}
          pageSize={PAGE_SIZE}
          itemLabel="videos"
          onPageChange={setPage}
          disabled={loading}
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
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAdd(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-white mb-4">Add video</h3>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-gray-400 block mb-1">YouTube video ID or full URL</span>
                <input
                  type="text"
                  value={addForm.provider_key}
                  onChange={(e) => setAddForm({ ...addForm, provider_key: e.target.value })}
                  className="input"
                  placeholder="https://www.youtube.com/watch?v=... or video ID"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addForm.queue_download}
                  onChange={(e) => setAddForm({ ...addForm, queue_download: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-800"
                />
                <span className="text-gray-400">Queue download</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addForm.tag_needs_review !== false}
                  onChange={(e) => setAddForm({ ...addForm, tag_needs_review: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-800"
                />
                <span className="text-gray-400">Tag with Needs Review</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={saveAdd} className="btn-primary">
                Add
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
