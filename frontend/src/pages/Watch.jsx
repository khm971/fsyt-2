import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import { cn, formatDurationSeconds } from "../lib/utils";
import { Play, Film, X } from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import VideoPlayer from "../components/VideoPlayer";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { VideoTagChips } from "../components/VideoTagChips";
import { TagEditModal } from "../components/TagEditModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { JobDetailsModal } from "../components/JobDetailsModal";

export default function Watch({ setError }) {
  const toast = useToast();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingVideo, setPlayingVideo] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [tagToEdit, setTagToEdit] = useState(null);
  const [videoIdForTagEdit, setVideoIdForTagEdit] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [tagMatchMode, setTagMatchMode] = useState("any");
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [tagSearchResults, setTagSearchResults] = useState([]);
  const tagSearchDebounceRef = useRef(null);
  const { videoUpdatedAt } = useQueueWebSocket();

  const loadVideos = useCallback(async () => {
    try {
      if (selectedTags.length === 0) {
        const list = await api.videos.watchList();
        setVideos(list);
      } else {
        const list = await api.videos.listByTags({
          tag_ids: selectedTags.map((t) => t.tag_id),
          tag_match: tagMatchMode,
        });
        setVideos(list);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [setError, selectedTags, tagMatchMode]);

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

  useEffect(() => {
    setLoading(true);
    loadVideos().finally(() => setLoading(false));
  }, [loadVideos]);

  useEffect(() => {
    if (videoUpdatedAt > 0) loadVideos();
  }, [videoUpdatedAt, loadVideos]);

  // Debounced tag search for typeahead
  useEffect(() => {
    const q = (tagSearchQuery || "").trim();
    if (!q) {
      setTagSearchResults([]);
      return;
    }
    if (tagSearchDebounceRef.current) clearTimeout(tagSearchDebounceRef.current);
    tagSearchDebounceRef.current = setTimeout(() => {
      api.tags
        .search(q)
        .then((list) => {
          const selectedIds = new Set(selectedTags.map((t) => t.tag_id));
          setTagSearchResults(list.filter((t) => !selectedIds.has(t.tag_id)));
        })
        .catch(() => setTagSearchResults([]));
    }, 250);
    return () => {
      if (tagSearchDebounceRef.current) clearTimeout(tagSearchDebounceRef.current);
    };
  }, [tagSearchQuery, selectedTags]);

  const isByTagsMode = selectedTags.length >= 1;
  const subtitle = isByTagsMode
    ? `Videos matching ${tagMatchMode === "all" ? "all" : "any"} tags.`
    : "Videos you've started but not finished, most recent first.";
  const emptyMessage = isByTagsMode
    ? "No videos match the selected tags."
    : "No videos in progress.";

  if (loading) return <div className="text-gray-400 py-8">Loading...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Watch</h2>

      {/* Search section */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-300">Search</h3>
        <div className="flex flex-wrap items-center gap-2">
          {selectedTags.map((t) => (
            <span
              key={t.tag_id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-gray-600 select-none"
              style={{
                backgroundColor: t.bg_color || "#111827",
                color: t.fg_color || "#f3f4f6",
                borderColor: t.fg_color ? "rgba(255,255,255,0.2)" : undefined,
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
                onClick={() => setSelectedTags((prev) => prev.filter((x) => x.tag_id !== t.tag_id))}
                className="ml-0.5 rounded hover:opacity-80 p-1 -m-1 cursor-pointer"
                aria-label="Remove tag"
              >
                <X className="w-4 h-4" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
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
                  if (existing && !selectedTags.some((s) => s.tag_id === existing.tag_id)) {
                    setSelectedTags((prev) => [...prev, existing]);
                    setTagSearchQuery("");
                    setTagSearchResults([]);
                  }
                }
              }}
              placeholder="Search tags (type to search, select to filter)"
              className="input w-full"
            />
            {tagSearchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-10">
                {tagSearchResults.map((t) => (
                  <button
                    key={t.tag_id}
                    type="button"
                    onClick={() => {
                      setSelectedTags((prev) => [...prev, t]);
                      setTagSearchQuery("");
                      setTagSearchResults([]);
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
          {selectedTags.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <span>Match:</span>
                <select
                  value={tagMatchMode}
                  onChange={(e) => setTagMatchMode(e.target.value)}
                  className="input py-1.5 px-2 text-gray-300 bg-gray-800 border-gray-600 rounded"
                >
                  <option value="any">Any tag</option>
                  <option value="all">All tags</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="btn-secondary text-sm"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-gray-400 text-sm">{subtitle}</p>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium w-24">Duration</th>
              <th className="px-4 py-3 font-medium w-24">Watched</th>
              <th className="px-4 py-3 font-medium w-14">Play</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {videos.map((v) => (
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
                    {v.transcode_path && (
                      <Tooltip title="Transcode Exists">
                        <span className="inline-flex text-gray-400 shrink-0">
                          <Film className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
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
                <td className="px-4 py-2 text-gray-300">{formatDurationSeconds(v.duration)}</td>
                <td className="px-4 py-2 text-gray-300">{formatDurationSeconds(v.watch_progress_seconds)}</td>
                <td className="px-4 py-2">
                  <Tooltip title={
                    v.watch_is_finished ? "Play (finished)" :
                    (v.watch_progress_percent != null && v.watch_progress_percent > 0 && v.watch_progress_percent < 95)
                      ? `Play (in progress, ${Math.round(v.watch_progress_percent)}%)`
                      : "Play"
                  }>
                    <button
                      type="button"
                      onClick={() => setPlayingVideo({ id: v.video_id, title: v.title || v.provider_key, duration: v.duration })}
                      disabled={v.status !== "available"}
                      className={cn(
                        "p-1.5 rounded",
                        v.status === "available"
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {videos.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">{emptyMessage}</div>
        )}
      </div>

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
