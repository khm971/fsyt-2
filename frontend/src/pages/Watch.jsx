import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { cn, formatDurationSeconds } from "../lib/utils";
import { Play, Film, X, Search, MoreVertical, CheckCircle, Circle } from "lucide-react";
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
  const [freeFormSearchInput, setFreeFormSearchInput] = useState("");
  const [freeFormTerms, setFreeFormTerms] = useState([]);
  const [includeUnavailableInSearch, setIncludeUnavailableInSearch] = useState(false);
  const [overflowVideoId, setOverflowVideoId] = useState(null);
  const [overflowMenuAnchor, setOverflowMenuAnchor] = useState(null);
  const overflowRef = useRef(null);
  const overflowMenuRef = useRef(null);
  const { videoUpdatedAt, videoWatchPatches, clearVideoWatchPatches, addVideoWatchPatch } = useQueueWebSocket();

  useEffect(() => {
    if (overflowVideoId == null) return;
    function handleClickOutside(e) {
      const target = e.target;
      if (
        overflowRef.current?.contains(target) ||
        overflowMenuRef.current?.contains(target)
      ) return;
      setOverflowVideoId(null);
      setOverflowMenuAnchor(null);
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [overflowVideoId]);

  const loadVideos = useCallback(async () => {
    try {
      let list;
      if (freeFormTerms.length > 0) {
        list = await api.videos.search({
          q: freeFormTerms.join(","),
          include_unavailable: includeUnavailableInSearch,
        });
      } else if (selectedTags.length === 0) {
        list = await api.videos.watchList();
      } else {
        list = await api.videos.listByTags({
          tag_ids: selectedTags.map((t) => t.tag_id),
          tag_match: tagMatchMode,
          include_unavailable: includeUnavailableInSearch,
        });
      }
      setVideos(list);
      if (list?.length) clearVideoWatchPatches(list.map((v) => v.video_id));
    } catch (e) {
      setError(e.message);
    }
  }, [setError, freeFormTerms, includeUnavailableInSearch, selectedTags, tagMatchMode, clearVideoWatchPatches]);

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

  const isFreeFormSearchMode = freeFormTerms.length > 0;
  const isByTagsMode = selectedTags.length >= 1;
  const isDefaultWatchList = !isFreeFormSearchMode && !isByTagsMode;

  /** Build effective row (video + patch); then for default watch list, only include if still "in progress". */
  const displayVideos = (() => {
    const withPatches = videos.map((v) => {
      const patch = videoWatchPatches[v.video_id];
      let row =
        patch && Object.keys(patch).some((k) => patch[k] !== undefined)
          ? { ...v, ...Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)) }
          : v;
      if (row.watch_is_finished && row.watch_progress_percent === 100 && row.duration != null) {
        row = { ...row, watch_progress_seconds: row.duration };
      }
      return row;
    });
    if (!isDefaultWatchList) return withPatches;
    return withPatches.filter(
      (row) =>
        row.watch_is_finished !== true &&
        ((row.watch_progress_seconds != null && row.watch_progress_seconds > 0) ||
          (row.watch_progress_percent != null && row.watch_progress_percent > 0))
    );
  })();

  const subtitle = isFreeFormSearchMode
    ? `Videos where all terms appear in title or description.`
    : isByTagsMode
      ? `Videos matching ${tagMatchMode === "all" ? "all" : "any"} tags.`
      : "Videos you've started but not finished, most recent first.";
  const emptyMessage = isFreeFormSearchMode
    ? "No videos match your search terms. Try different or fewer terms."
    : isByTagsMode
      ? "No videos match the selected tags."
      : "No videos in progress.";

  const runFreeFormSearch = useCallback(() => {
    const terms = (freeFormSearchInput || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setFreeFormTerms(terms);
  }, [freeFormSearchInput]);

  if (loading) return <div className="text-gray-400 py-8">Loading...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Watch</h2>

      {/* Search section */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/80 p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-300">Search</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={freeFormSearchInput}
            onChange={(e) => setFreeFormSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFreeFormSearch();
              }
            }}
            placeholder="Search by title or description (e.g. Bob, Sam, Joe)"
            className="input flex-1 min-w-[200px]"
          />
          <button
            type="button"
            onClick={runFreeFormSearch}
            className="btn-primary flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            Search
          </button>
          {isFreeFormSearchMode && (
            <button
              type="button"
              onClick={() => {
                setFreeFormTerms([]);
                setFreeFormSearchInput("");
              }}
              className="btn-secondary text-sm"
            >
              Clear search
            </button>
          )}
          {(isFreeFormSearchMode || isByTagsMode) && (
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={includeUnavailableInSearch}
                onChange={(e) => setIncludeUnavailableInSearch(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
              />
              <span>Include videos that are not yet available</span>
            </label>
          )}
        </div>
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

      <p className="text-gray-400 text-sm">{displayVideos.length === 1 ? "1 video found" : `${displayVideos.length} videos found`}</p>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium w-24">Duration</th>
              <th className="px-4 py-3 font-medium w-24">Watched</th>
              <th className="px-4 py-3 font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {displayVideos.map((v) => {
              const row = v;
              return (
                <tr key={row.video_id} className="hover:bg-gray-800/30">
                  <td className="px-4 py-2 font-mono text-gray-300">{row.video_id}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Tooltip title="Video details" side="top" wrap>
                        <button
                          type="button"
                          onClick={() => setVideoIdForDetails(row.video_id)}
                          className="text-white hover:text-blue-400 text-left"
                        >
                          {row.title || row.provider_key || "—"}
                        </button>
                      </Tooltip>
                      {row.transcode_path && (
                        <Tooltip title="Transcode Exists">
                          <span className="inline-flex text-gray-400 shrink-0">
                            <Film className="w-4 h-4" />
                          </span>
                        </Tooltip>
                      )}
                      <VideoTagChips
                        tags={row.tags || []}
                        onTagClick={(tag) => {
                          setTagToEdit(tag);
                          setVideoIdForTagEdit(row.video_id);
                        }}
                        onMoreClick={() => setVideoIdForDetails(row.video_id)}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-300">{formatDurationSeconds(row.duration)}</td>
                  <td className="px-4 py-2 text-gray-300">{formatDurationSeconds(row.watch_progress_seconds)}</td>
                  <td className="px-4 py-2">
                    {row.status === "available" ? (
                      <div className="flex items-center gap-0.5">
                        <Tooltip title={
                          row.watch_is_finished ? "Play (finished)" :
                          (row.watch_progress_percent != null && row.watch_progress_percent > 0 && row.watch_progress_percent < 95)
                            ? `Play (in progress, ${Math.round(row.watch_progress_percent)}%)`
                            : "Play"
                        }>
                          <button
                            type="button"
                            onClick={() => setPlayingVideo({ id: row.video_id, title: row.title || row.provider_key, duration: row.duration })}
                            className={cn(
                              "p-1.5 rounded",
                              row.watch_is_finished
                                ? "text-purple-400 hover:text-purple-300 hover:bg-gray-700"
                                : (row.watch_progress_percent != null && row.watch_progress_percent > 0 && row.watch_progress_percent < 95)
                                  ? "text-blue-400 hover:text-blue-300 hover:bg-gray-700"
                                  : "text-gray-400 hover:text-green-400 hover:bg-gray-700"
                            )}
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        </Tooltip>
                        <div className="relative inline-flex" ref={overflowVideoId === row.video_id ? overflowRef : null}>
                          <Tooltip title="More actions" side="top">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = overflowVideoId === row.video_id ? null : row.video_id;
                                setOverflowVideoId(next);
                                setOverflowMenuAnchor(next != null ? e.currentTarget.getBoundingClientRect() : null);
                              }}
                              className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                              aria-expanded={overflowVideoId === row.video_id}
                              aria-haspopup="true"
                              aria-label="More actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayVideos.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">{emptyMessage}</div>
        )}
      </div>

      {overflowVideoId != null && overflowMenuAnchor && (() => {
        const row = displayVideos.find((v) => v.video_id === overflowVideoId);
        if (!row) return null;
        const menuHeight = 88;
        const menuWidth = 192;
        const gap = 4;
        const spaceBelow = typeof window !== "undefined" ? window.innerHeight - overflowMenuAnchor.bottom : menuHeight + gap;
        const openAbove = spaceBelow < menuHeight + gap;
        const top = openAbove
          ? overflowMenuAnchor.top - menuHeight - gap
          : overflowMenuAnchor.bottom + gap;
        const left = Math.max(8, Math.min(overflowMenuAnchor.right - menuWidth, (typeof window !== "undefined" ? window.innerWidth : 0) - menuWidth - 8));
        return createPortal(
          <div
            ref={overflowMenuRef}
            className="fixed w-48 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-lg z-[100]"
            role="menu"
            style={{ top, left }}
          >
            <button
              type="button"
              onClick={async () => {
                setOverflowVideoId(null);
                setOverflowMenuAnchor(null);
                try {
                  await api.videos.updateWatchStatus(row.video_id, true);
                  addVideoWatchPatch(row.video_id, {
                    watch_is_finished: true,
                    watch_progress_percent: 100,
                  });
                  toast.addToast("Marked as finished", "success");
                } catch (e) {
                  setError(e.message);
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
              role="menuitem"
            >
              <CheckCircle className="h-4 w-4 shrink-0" />
              Mark as finished
            </button>
            <button
              type="button"
              onClick={async () => {
                setOverflowVideoId(null);
                setOverflowMenuAnchor(null);
                try {
                  await api.videos.updateWatchStatus(row.video_id, false);
                  addVideoWatchPatch(row.video_id, {
                    watch_is_finished: false,
                    watch_progress_seconds: 0,
                    watch_progress_percent: 0,
                  });
                  toast.addToast("Marked as not started", "success");
                } catch (e) {
                  setError(e.message);
                }
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
              role="menuitem"
            >
              <Circle className="h-4 w-4 shrink-0" />
              Mark as not started
            </button>
          </div>,
          document.body
        );
      })()}

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
