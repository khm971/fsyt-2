import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import { cn, formatDateOnly, formatDateTime, formatDateTimeWithSeconds, formatDurationSeconds } from "../lib/utils";
import { shouldSkipIgnoreVideoConfirm, setSkipIgnoreVideoConfirm } from "../lib/ignoreVideoConfirm";
import {
  Hash,
  Users,
  User,
  FileText,
  Calendar,
  Clock,
  MessageCircle,
  EyeOff,
  Eye,
  Activity,
  ClipboardList,
  ListTodo,
  Plus,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Key,
  AlignLeft,
  Image,
  FolderOpen,
  Film,
  Download,
  RefreshCw,
  FileCheck,
  CheckCircle,
  Loader2,
  Search,
  FileSearch,
  Brain,
  Settings,
  XCircle,
  AlertCircle,
  HelpCircle,
  Play,
  CircleDot,
  X,
} from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { Tooltip } from "./Tooltip";
import Modal from "./Modal";
import { TagEditModal } from "./TagEditModal";

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

function getStatusColor(status) {
  if (!status) return "text-gray-500";
  if (status === "available") return "text-green-400";
  if (status === "no_metadata") return "text-white";
  if (["running", "downloading", "getting_metadata", "get_metadata_for_download", "post_download_processing", "llm_processing"].includes(status)) return "text-blue-400";
  if (status === "error" || status?.startsWith("error")) return "text-red-400";
  return "text-gray-500";
}

function formatStatus(s) {
  if (!s) return "—";
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getJobTypeIcon(jobType) {
  return JOB_TYPE_ICONS[jobType] ?? ListTodo;
}

export function VideoDetailsModal({
  videoId,
  onClose,
  setError,
  toast,
  onVideoUpdated,
  onOpenJobDetails,
  onOpenChannelEdit,
}) {
  const [video, setVideo] = useState(null);
  const [channelName, setChannelName] = useState(null);
  const [loading, setLoading] = useState(false);
  const [technicalExpanded, setTechnicalExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [videoTags, setVideoTags] = useState([]);
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [tagSearchResults, setTagSearchResults] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [tagToEdit, setTagToEdit] = useState(null);
  const [tagActionLoading, setTagActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [ignoreConfirmDontAskAgain, setIgnoreConfirmDontAskAgain] = useState(false);
  const [jobQueueLoading, setJobQueueLoading] = useState(null);
  const tagSearchDebounceRef = useRef(null);
  const contextMenuRef = useRef(null);

  useEffect(() => {
    if (videoId == null) {
      setVideo(null);
      setChannelName(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setVideo(null);
    setChannelName(null);
    Promise.all([
      api.videos.get(videoId),
      api.videos.getTags(videoId).catch(() => []),
    ]).then(([v, tags]) => {
      if (!cancelled) setVideo(v);
      if (!cancelled) setVideoTags(Array.isArray(tags) ? tags : []);
      if (!cancelled && v?.channel_id != null) {
        api.channels
          .get(v.channel_id)
          .then((ch) => {
            if (!cancelled) setChannelName(ch?.title || ch?.handle || `Channel ${v.channel_id}`);
          })
          .catch(() => {});
      }
    })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [videoId, setError]);

  // Debounced tag search for typeahead
  useEffect(() => {
    const q = (tagSearchQuery || "").trim();
    if (!q) {
      setTagSearchResults([]);
      return;
    }
    if (tagSearchDebounceRef.current) clearTimeout(tagSearchDebounceRef.current);
    tagSearchDebounceRef.current = setTimeout(() => {
      api.tags.search(q).then((list) => {
        const onVideo = new Set((videoTags || []).map((t) => t.tag_id));
        setTagSearchResults(list.filter((t) => !onVideo.has(t.tag_id)));
      }).catch(() => setTagSearchResults([]));
    }, 250);
    return () => {
      if (tagSearchDebounceRef.current) clearTimeout(tagSearchDebounceRef.current);
    };
  }, [tagSearchQuery, videoTags]);

  // Close context menu on outside click or Escape (ignore clicks inside the menu so Edit can fire)
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onDocClick = (e) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (confirmAction) setIgnoreConfirmDontAskAgain(false);
  }, [confirmAction]);

  const refreshVideo = useCallback(() => {
    if (videoId == null) return;
    api.videos.get(videoId).then(setVideo).catch((e) => setError(e.message));
  }, [videoId, setError]);

  const openChannelEdit = () => {
    if (video?.channel_id != null && onOpenChannelEdit) onOpenChannelEdit(video.channel_id);
  };

  const executeIgnoreToggle = async (targetVideoId, isIgnore, persistDontAskAgain = false) => {
    setConfirmLoading(true);
    try {
      if (persistDontAskAgain) setSkipIgnoreVideoConfirm(true);
      await api.videos.update(targetVideoId, { is_ignore: isIgnore });
      refreshVideo();
      onVideoUpdated?.();
      toast.addToast(isIgnore ? "Video ignored" : "Video unignored", "success");
      setConfirmAction(null);
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setConfirmLoading(false);
    }
  };

  const performConfirmAction = async () => {
    if (!confirmAction) return;
    await executeIgnoreToggle(confirmAction.videoId, confirmAction.isIgnore, ignoreConfirmDontAskAgain);
  };

  const queueVideoJob = async (jobType) => {
    if (!video) return;
    setJobQueueLoading(jobType);
    try {
      const j = await api.queue.create({
        job_type: jobType,
        video_id: video.video_id,
        priority: 50,
      });
      toast.addToast(`Job queued: ${jobType} (ID ${j.job_queue_id})`, "success");
      refreshVideo();
      onVideoUpdated?.();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setJobQueueLoading(null);
    }
  };

  if (videoId == null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-white mb-0 p-4 pb-2 shrink-0">Video details</h3>
        {loading && (
          <div className="text-gray-400 py-4 px-4">Loading...</div>
        )}
        {!loading && video && (
          <>
            <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0 px-4">
              <div className="text-sm">
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top w-40">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="w-4 h-4 shrink-0 text-gray-500" />
                          Title
                        </span>
                      </td>
                      <td className="py-1.5 text-white break-words">{video.title || video.provider_key || "—"}</td>
                    </tr>
                    {video.channel_id != null && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="w-4 h-4 shrink-0 text-gray-500" />
                            Channel
                          </span>
                        </td>
                        <td className="py-1.5">
                          {onOpenChannelEdit ? (
                            <Tooltip title="Open channel edit" side="top" wrap>
                              <button
                                type="button"
                                onClick={openChannelEdit}
                                className="text-blue-400 hover:text-blue-300 text-left font-mono break-all"
                              >
                                {video.channel_id}
                                {channelName != null && (
                                  <span className="text-gray-300 ml-1.5 font-normal">
                                    ({channelName})
                                  </span>
                                )}
                              </button>
                            </Tooltip>
                          ) : (
                            <span className="text-white font-mono break-all">
                              {video.channel_id}
                              {channelName != null && (
                                <span className="text-gray-300 ml-1.5 font-normal">({channelName})</span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {(video.created_by_user_id != null || video.created_by_username != null) && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <User className="w-4 h-4 shrink-0 text-gray-500" />
                            Created by
                          </span>
                        </td>
                        <td className="py-1.5 text-white">
                          {video.created_by_username != null ? `${video.created_by_username} (ID ${video.created_by_user_id})` : `ID ${video.created_by_user_id}`}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          <Hash className="w-4 h-4 shrink-0 text-gray-500" />
                          Video ID
                        </span>
                      </td>
                      <td className="py-1.5 text-white font-mono break-all">{video.video_id}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 shrink-0 text-gray-500" />
                          Upload date
                        </span>
                      </td>
                      <td className="py-1.5 text-white">{video.upload_date ? formatDateOnly(video.upload_date) : "—"}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-4 h-4 shrink-0 text-gray-500" />
                          Duration
                        </span>
                      </td>
                      <td className="py-1.5 text-white">{formatDurationSeconds(video.duration)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          {(() => {
                            const StatusIcon = STATUS_ICONS[video.status] ?? HelpCircle;
                            return (
                              <StatusIcon
                                className={cn("w-4 h-4 shrink-0", getStatusColor(video.status))}
                              />
                            );
                          })()}
                          Status
                        </span>
                      </td>
                      <td className="py-1.5 text-white">{formatStatus(video.status)}</td>
                    </tr>
                    {video.status_message && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <MessageCircle className="w-4 h-4 shrink-0 text-gray-500" />
                            Status message
                          </span>
                        </td>
                        <td className="py-1.5 text-white break-words">{video.status_message}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 pr-4 text-gray-400 align-top">
                        <span className="inline-flex items-center gap-1.5">
                          {video.is_ignore ? (
                            <EyeOff className="w-4 h-4 shrink-0 text-yellow-400" />
                          ) : (
                            <Eye className="w-4 h-4 shrink-0 text-gray-500" />
                          )}
                          Ignored
                        </span>
                      </td>
                      <td className="py-1.5 text-white">{video.is_ignore ? "Yes" : "No"}</td>
                    </tr>
                    {video.status_percent_complete != null &&
                      video.status_percent_complete > 0 && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <Activity className="w-4 h-4 shrink-0 text-gray-500" />
                            Progress
                          </span>
                        </td>
                        <td className="py-1.5 text-white">{video.status_percent_complete}%</td>
                      </tr>
                    )}
                    {((video.watch_progress_percent != null && video.watch_progress_percent > 0) ||
                      (video.watch_progress_seconds != null && video.watch_progress_seconds > 0) ||
                      video.watch_is_finished) && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <Play className="w-4 h-4 shrink-0 text-gray-500" />
                            Watch progress
                          </span>
                        </td>
                        <td className="py-1.5 text-white">
                          {video.watch_is_finished && (
                            <span className="text-green-400 mr-2">Finished</span>
                          )}
                          {video.watch_progress_percent != null && video.watch_progress_percent > 0 && (
                            <span>{Math.round(video.watch_progress_percent)}%</span>
                          )}
                          {video.watch_progress_seconds != null && video.watch_progress_seconds > 0 && (
                            <span className="text-gray-400 ml-1">
                              ({formatDurationSeconds(video.watch_progress_seconds)})
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {video.pending_job_id != null && (
                      <tr>
                        <td className="py-1.5 pr-4 text-gray-400 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <ClipboardList className="w-4 h-4 shrink-0 text-gray-500" />
                            Pending job
                          </span>
                        </td>
                        <td className="py-1.5">
                          {onOpenJobDetails ? (
                            <Tooltip title="Open job details" side="top" wrap>
                              <button
                                type="button"
                                onClick={() => onOpenJobDetails(video.pending_job_id)}
                                className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1.5"
                              >
                                {(() => {
                                  const JobIcon = getJobTypeIcon(video.pending_job_type);
                                  return <JobIcon className="w-4 h-4 shrink-0" />;
                                })()}
                                <span className="font-mono">{video.pending_job_id}</span>
                                {video.pending_job_type && (
                                  <span className="text-gray-400 font-normal">
                                    {video.pending_job_type}
                                  </span>
                                )}
                              </button>
                            </Tooltip>
                          ) : (
                            <span className="text-white font-mono">
                              {video.pending_job_id}
                              {video.pending_job_type && (
                                <span className="text-gray-400 ml-1">{video.pending_job_type}</span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <div className="mt-4 border-t border-gray-700 pt-3">
                  <button
                    type="button"
                    onClick={() => setTagsExpanded((e) => !e)}
                    className="flex items-center gap-2 w-full text-left text-gray-300 hover:text-white"
                  >
                    {tagsExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    )}
                    <span className="font-medium">Tags</span>
                  </button>
                  {tagsExpanded && (
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {videoTags.map((t) => (
                          <span
                            key={t.tag_id}
                            role="button"
                            tabIndex={0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-gray-600 cursor-pointer select-none"
                            style={{
                              backgroundColor: t.bg_color || "#111827",
                              color: t.fg_color || "#f3f4f6",
                              borderColor: t.fg_color ? "rgba(255,255,255,0.2)" : undefined,
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({ x: e.clientX, y: e.clientY, tag: t });
                            }}
                            onClick={() => {
                              setTagToEdit(t);
                              setContextMenu(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setTagToEdit(t);
                                setContextMenu(null);
                              }
                            }}
                          >
                            {t.icon_before && (
                              <DynamicIcon name={t.icon_before} className="w-4 h-4 shrink-0" />
                            )}
                            <span className="pointer-events-none">{t.title}</span>
                            {t.icon_after && (
                              <DynamicIcon name={t.icon_after} className="w-4 h-4 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTagActionLoading(true);
                                api.videos
                                  .removeTag(videoId, t.tag_id)
                                  .then(() => {
                                    setVideoTags((prev) => prev.filter((x) => x.tag_id !== t.tag_id));
                                  })
                                  .catch((err) => setError(err.message))
                                  .finally(() => setTagActionLoading(false));
                              }}
                              className="ml-0.5 rounded hover:opacity-80 p-1 -m-1 cursor-pointer"
                              aria-label="Remove tag"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={tagSearchQuery}
                          onChange={(e) => setTagSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const trimmed = (tagSearchQuery || "").trim();
                              if (!trimmed) return;
                              const existing = tagSearchResults.find(
                                (r) => r.title.toLowerCase() === trimmed.toLowerCase()
                              );
                              if (existing) {
                                setTagActionLoading(true);
                                api.videos
                                  .addTag(videoId, { tag_id: existing.tag_id })
                                  .then((tags) => {
                                    setVideoTags(tags);
                                    setTagSearchQuery("");
                                    setTagSearchResults([]);
                                  })
                                  .catch((err) => setError(err.message))
                                  .finally(() => setTagActionLoading(false));
                              } else {
                                setTagActionLoading(true);
                                api.videos
                                  .addTag(videoId, { title: trimmed })
                                  .then((tags) => {
                                    setVideoTags(tags);
                                    setTagSearchQuery("");
                                    setTagSearchResults([]);
                                  })
                                  .catch((err) => setError(err.message))
                                  .finally(() => setTagActionLoading(false));
                              }
                            }
                          }}
                          placeholder="Add tag (type to search, Enter to add or create)"
                          className="input w-full"
                          disabled={tagActionLoading}
                        />
                        {tagSearchResults.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-10">
                            {tagSearchResults.map((t) => (
                              <button
                                key={t.tag_id}
                                type="button"
                                onClick={() => {
                                  setTagActionLoading(true);
                                  api.videos
                                    .addTag(videoId, { tag_id: t.tag_id })
                                    .then((tags) => {
                                      setVideoTags(tags);
                                      setTagSearchQuery("");
                                      setTagSearchResults([]);
                                    })
                                    .catch((err) => setError(err.message))
                                    .finally(() => setTagActionLoading(false));
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-800 border-b border-gray-800 last:border-b-0"
                                style={{
                                  color: t.fg_color || "#f3f4f6",
                                }}
                              >
                                {t.icon_before && (
                                  <DynamicIcon name={t.icon_before} className="w-4 h-4 shrink-0" />
                                )}
                                <span
                                  className="px-1.5 py-0.5 rounded text-xs"
                                  style={{
                                    backgroundColor: t.bg_color || "#111827",
                                    color: t.fg_color || "#f3f4f6",
                                  }}
                                >
                                  {t.title}
                                </span>
                                {t.icon_after && (
                                  <DynamicIcon name={t.icon_after} className="w-4 h-4 shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-gray-700 pt-3">
                  <button
                    type="button"
                    onClick={() => setTechnicalExpanded((e) => !e)}
                    className="flex items-center gap-2 w-full text-left text-gray-300 hover:text-white"
                  >
                    {technicalExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" />
                    )}
                    <span className="font-medium">Technical Information</span>
                  </button>
                  {technicalExpanded && (
                    <table className="w-full border-collapse mt-2">
                      <tbody>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top w-40">
                            <span className="inline-flex items-center gap-1.5">
                              <Key className="w-4 h-4 shrink-0 text-gray-500" />
                              Provider key
                            </span>
                          </td>
                          <td className="py-1.5 text-white font-mono break-all">{video.provider_key ?? "—"}</td>
                        </tr>
                        {video.llm_description_1 != null && video.llm_description_1 !== "" && (
                          <tr>
                            <td className="py-1.5 pr-4 text-gray-400 align-top">
                              <span className="inline-flex items-center gap-1.5">
                                <AlignLeft className="w-4 h-4 shrink-0 text-gray-500" />
                                LLM description
                              </span>
                            </td>
                            <td className="py-1.5 text-white break-words whitespace-pre-wrap">{video.llm_description_1}</td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <Image className="w-4 h-4 shrink-0 text-gray-500" />
                              Thumbnail
                            </span>
                          </td>
                          <td className="py-1.5 text-white break-all">{video.thumbnail ?? "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <FolderOpen className="w-4 h-4 shrink-0 text-gray-500" />
                              File path
                            </span>
                          </td>
                          <td className="py-1.5 text-white break-all font-mono text-xs">{video.file_path ?? "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <Film className="w-4 h-4 shrink-0 text-gray-500" />
                              Transcode path
                            </span>
                          </td>
                          <td className="py-1.5 text-white break-all font-mono text-xs">{video.transcode_path ?? "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <Download className="w-4 h-4 shrink-0 text-gray-500" />
                              Download date
                            </span>
                          </td>
                          <td className="py-1.5 text-white">{video.download_date ? formatDateTimeWithSeconds(video.download_date) : "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <Calendar className="w-4 h-4 shrink-0 text-gray-500" />
                              Record created
                            </span>
                          </td>
                          <td className="py-1.5 text-white">{video.record_created ? formatDateTimeWithSeconds(video.record_created) : "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <RefreshCw className="w-4 h-4 shrink-0 text-gray-500" />
                              Metadata last updated
                            </span>
                          </td>
                          <td className="py-1.5 text-white">{video.metadata_last_updated ? formatDateTimeWithSeconds(video.metadata_last_updated) : "—"}</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 pr-4 text-gray-400 align-top">
                            <span className="inline-flex items-center gap-1.5">
                              <FileCheck className="w-4 h-4 shrink-0 text-gray-500" />
                              NFO last written
                            </span>
                          </td>
                          <td className="py-1.5 text-white">{video.nfo_last_written ? formatDateTimeWithSeconds(video.nfo_last_written) : "—"}</td>
                        </tr>
                        {video.description != null && video.description !== "" && (
                          <tr>
                            <td className="py-1.5 pr-4 text-gray-400 align-top">
                              <span className="inline-flex items-center gap-1.5">
                                <AlignLeft className="w-4 h-4 shrink-0 text-gray-500" />
                                Description
                              </span>
                            </td>
                            <td className="py-1.5 text-white break-words whitespace-pre-wrap">{video.description}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end flex-wrap gap-2 p-4 pt-3 border-t border-gray-700 shrink-0">
              {(() => {
                const st = video.status;
                const canDownload = st !== "available";
                const canGetMetadata = st !== "available" && st !== "metadata_available";
                return (
                  <>
                    <Tooltip
                      title={
                        canDownload
                          ? "Queue download for this video"
                          : "Video is already available locally"
                      }
                      side="top"
                      wrap
                    >
                      <span className={cn("inline-flex rounded", !canDownload && "cursor-not-allowed")}>
                        <button
                          type="button"
                          disabled={!canDownload || jobQueueLoading}
                          onClick={() => queueVideoJob("download_video")}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-2 rounded text-sm font-medium transition-colors disabled:pointer-events-none",
                            canDownload
                              ? "text-blue-400 hover:text-blue-300 hover:bg-gray-700"
                              : "text-gray-500 opacity-50"
                          )}
                        >
                          {jobQueueLoading === "download_video" ? (
                            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4 shrink-0" />
                          )}
                          Download
                        </button>
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        canGetMetadata
                          ? "Queue metadata fetch for this video"
                          : st === "metadata_available"
                            ? "Metadata is already available for this video"
                            : "Video is already available locally"
                      }
                      side="top"
                      wrap
                    >
                      <span className={cn("inline-flex rounded", !canGetMetadata && "cursor-not-allowed")}>
                        <button
                          type="button"
                          disabled={!canGetMetadata || jobQueueLoading}
                          onClick={() => queueVideoJob("get_metadata")}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-2 rounded text-sm font-medium transition-colors disabled:pointer-events-none",
                            canGetMetadata
                              ? "text-green-400 hover:text-green-300 hover:bg-gray-700"
                              : "text-gray-500 opacity-50"
                          )}
                        >
                          {jobQueueLoading === "get_metadata" ? (
                            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                          ) : (
                            <FileSearch className="w-4 h-4 shrink-0" />
                          )}
                          Get metadata
                        </button>
                      </span>
                    </Tooltip>
                  </>
                );
              })()}
              <button
                type="button"
                disabled={confirmLoading}
                onClick={() => {
                  const isIgnore = !video.is_ignore;
                  if (shouldSkipIgnoreVideoConfirm()) {
                    void executeIgnoreToggle(video.video_id, isIgnore, false);
                  } else {
                    setConfirmAction({ type: "ignore", videoId: video.video_id, isIgnore });
                  }
                }}
                className={cn(
                  "p-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
                  video.is_ignore
                    ? "text-yellow-400 hover:text-yellow-300 hover:bg-gray-700"
                    : "text-gray-400 hover:text-yellow-400 hover:bg-gray-700"
                )}
              >
                {video.is_ignore ? "Unignore" : "Ignore"}
              </button>
              <button type="button" onClick={onClose} className="btn-secondary">
                Close
              </button>
            </div>
          </>
        )}
        {!loading && !video && (
          <div className="text-gray-400 py-4 px-4">Video not found.</div>
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[60] min-w-[8rem] rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setTagToEdit(contextMenu.tag);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
          >
            Edit
          </button>
        </div>
      )}

      {tagToEdit && (
        <TagEditModal
          tag={tagToEdit}
          videoId={videoId}
          onClose={() => setTagToEdit(null)}
          onSaved={() => {
            api.videos.getTags(videoId).then(setVideoTags).catch(() => {});
          }}
        />
      )}

      {confirmAction && (
        <Modal
          title={confirmAction.isIgnore ? "Ignore video" : "Unignore video"}
          onClose={() => !confirmLoading && setConfirmAction(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-yellow-900/60 bg-yellow-950/30 p-4">
              <div className="rounded-full bg-yellow-900/50 p-2 text-yellow-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                {confirmAction.isIgnore
                  ? "Ignore this video? It will be hidden from the default view."
                  : "Unignore this video?"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ignoreConfirmDontAskAgain}
                onChange={(e) => setIgnoreConfirmDontAskAgain(e.target.checked)}
                disabled={confirmLoading}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 shrink-0"
              />
              Don&apos;t ask again (until you refresh or close this tab)
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performConfirmAction}
                disabled={confirmLoading}
                className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {confirmLoading ? "Please wait…" : "Yes"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
