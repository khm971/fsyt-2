import { useState, useEffect, useCallback } from "react";
import {
  Server,
  Database,
  FolderOpen,
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Film,
} from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { cn } from "../lib/utils";
import { Tooltip } from "../components/Tooltip";
import { VideoDetailsModal } from "../components/VideoDetailsModal";

function SectionTitle({ icon: Icon, children }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
      <Icon className="h-4 w-4" />
      {children}
    </h3>
  );
}

export default function Jellyfin({ setError }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [libraryItems, setLibraryItems] = useState(null);
  const [libraryItemsLoading, setLibraryItemsLoading] = useState(false);
  const [libraryItemsError, setLibraryItemsError] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [jellyfinWatchByItemId, setJellyfinWatchByItemId] = useState(() => ({}));
  const [getAllRunning, setGetAllRunning] = useState(false);
  const [getAllProgress, setGetAllProgress] = useState({ current: 0, total: 0 });

  const load = useCallback(() => {
    setLoading(true);
    api.jellyfin
      .getStatus()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const loadLibraryItems = useCallback(() => {
    setLibraryItemsLoading(true);
    setLibraryItemsError(null);
    setJellyfinWatchByItemId({});
    api.jellyfin
      .getLibraryItems("FSYT-2")
      .then((res) => {
        setLibraryItems(res.items ?? []);
        if (res.error) setLibraryItemsError(res.error);
      })
      .catch((e) => {
        setError(e.message);
        setLibraryItemsError(e.message);
        setLibraryItems([]);
      })
      .finally(() => setLibraryItemsLoading(false));
  }, [setError]);

  const fetchJellyfinWatchStatus = useCallback((itemId, e) => {
    if (e) e.stopPropagation();
    if (itemId == null) return;
    setJellyfinWatchByItemId((prev) => ({ ...prev, [itemId]: { loading: true } }));
    api.jellyfin
      .getItemWatchStatus(itemId)
      .then((res) => {
        if (res?.error) {
          setJellyfinWatchByItemId((p) => ({ ...p, [itemId]: { loading: false, error: res.error } }));
        } else {
          setJellyfinWatchByItemId((p) => ({
            ...p,
            [itemId]: {
              loading: false,
              started: res.started,
              progress_seconds: res.progress_seconds,
              progress_percent: res.progress_percent,
              play_count: res.play_count,
            },
          }));
        }
      })
      .catch((e) => {
        setJellyfinWatchByItemId((p) => ({ ...p, [itemId]: { loading: false, error: e?.message || "Failed to load" } }));
      });
  }, []);

  const runGetAllWatchStatuses = useCallback(() => {
    if (libraryItems == null || libraryItems.length === 0) return;
    const episodes = libraryItems.filter((i) => i.type === "Episode" && i.id != null);
    if (episodes.length === 0) return;
    setGetAllRunning(true);
    setGetAllProgress({ current: 0, total: episodes.length });
    let index = 0;
    const runNext = () => {
      if (index >= episodes.length) {
        setGetAllRunning(false);
        setGetAllProgress({ current: 0, total: 0 });
        return;
      }
      const item = episodes[index];
      const id = item.id;
      setGetAllProgress((p) => ({ ...p, current: index + 1 }));
      setJellyfinWatchByItemId((prev) => ({ ...prev, [id]: { loading: true } }));
      api.jellyfin
        .getItemWatchStatus(id)
        .then((res) => {
          if (res?.error) {
            setJellyfinWatchByItemId((p) => ({ ...p, [id]: { loading: false, error: res.error } }));
          } else {
            setJellyfinWatchByItemId((p) => ({
              ...p,
              [id]: {
                loading: false,
                started: res.started,
                progress_seconds: res.progress_seconds,
                progress_percent: res.progress_percent,
                play_count: res.play_count,
              },
            }));
          }
        })
        .catch((e) => {
          setJellyfinWatchByItemId((p) => ({ ...p, [id]: { loading: false, error: e?.message || "Failed to load" } }));
        })
        .finally(() => {
          index += 1;
          runNext();
        });
    };
    runNext();
  }, [libraryItems]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-800 bg-gray-900 py-16">
        <div className="flex items-center gap-2 text-gray-400">
          <Database className="h-5 w-5 animate-pulse" />
          <span>Loading Jellyfin status…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.connected) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-white">Jellyfin</h3>
          <p className="mt-1 text-sm text-gray-400">
            Integration with your local Jellyfin media server.
          </p>
        </div>
        <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-4">
          <div className="flex items-center gap-2 text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="font-medium">Unable to connect to Jellyfin</span>
          </div>
          {data.error && (
            <p className="mt-2 text-sm text-gray-300">{data.error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Jellyfin</h3>
          <p className="mt-1 text-sm text-gray-400">
            Integration with your local Jellyfin media server.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="rounded-lg border border-emerald-900/50 bg-emerald-900/20 p-4">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <span className="font-medium">Connected to Jellyfin</span>
        </div>
      </div>

      {data.error && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-900/20 p-4">
          <div className="flex items-center gap-2 text-amber-300 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{data.error}</span>
          </div>
        </div>
      )}

      <div>
        <SectionTitle icon={Server}>Server</SectionTitle>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-400">Name:</span>
            <span className="text-white">{data.server_name ?? "—"}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-400">Version:</span>
            <span className="text-white">{data.server_version ?? "—"}</span>
          </div>
          {data.operating_system != null && data.operating_system !== "" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">OS:</span>
              <span className="text-white">{data.operating_system}</span>
            </div>
          )}
          {data.sessions_count != null && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">Active sessions:</span>
              <span className="text-white">{data.sessions_count}</span>
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon={FolderOpen}>Libraries</SectionTitle>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          {Array.isArray(data.libraries) && data.libraries.length > 0 ? (
            <ul className="space-y-2">
              {data.libraries.map((lib, i) => (
                <li key={lib.item_id ?? i} className="text-sm text-white">
                  <span className="font-medium">{lib.name ?? "Unnamed"}</span>
                  {lib.collection_type != null && lib.collection_type !== "" && (
                    <span className="ml-2 text-gray-500">({lib.collection_type})</span>
                  )}
                  {Array.isArray(lib.locations) && lib.locations.length > 0 && (
                    <div className="mt-0.5 text-gray-400 text-xs truncate max-w-full">
                      {lib.locations.join(", ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No libraries returned.</p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon={Users}>Users</SectionTitle>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          {Array.isArray(data.users) && data.users.length > 0 ? (
            <ul className="space-y-2">
              {data.users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-white">{u.name ?? "—"}</span>
                  <span className="text-gray-500">ID: {String(u.id)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No users returned.</p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle icon={Film}>FSYT-2 Library Videos</SectionTitle>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadLibraryItems}
              disabled={libraryItemsLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Film className="h-4 w-4" />
              Load FSYT-2 Library Videos
            </button>
            <button
              type="button"
              onClick={runGetAllWatchStatuses}
              disabled={
                libraryItems == null ||
                libraryItems.length === 0 ||
                libraryItemsLoading ||
                getAllRunning ||
                libraryItems.filter((i) => i.type === "Episode" && i.id != null).length === 0
              }
              className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 disabled:pointer-events-none"
            >
              <RefreshCw className={cn("h-4 w-4", getAllRunning && "animate-spin")} />
              Get All Watch Statuses
            </button>
          </div>
          {libraryItemsLoading && (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
          {getAllRunning && getAllProgress.total > 0 && (
            <p className="text-sm text-gray-400">
              Fetching Jellyfin watch status: {getAllProgress.current} of {getAllProgress.total} episodes…
            </p>
          )}
          {libraryItemsError && !libraryItemsLoading && (
            <div className="rounded-lg border border-amber-900/50 bg-amber-900/20 p-4">
              <div className="flex items-center gap-2 text-amber-300 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{libraryItemsError}</span>
              </div>
            </div>
          )}
          {libraryItems !== null && !libraryItemsLoading && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              {libraryItems.length === 0 ? (
                <p className="text-sm text-gray-500">No videos in this library.</p>
              ) : (
                <ul className="space-y-4 min-w-0">
                  {libraryItems.map((item) => {
                    const isEpisode = item.type === "Episode";
                    const hasMatch = isEpisode && item.video_id != null;
                    const noMatch = isEpisode && item.video_id == null;
                    const jellyfinFetched =
                      isEpisode &&
                      item.id != null &&
                      jellyfinWatchByItemId[item.id] != null &&
                      !jellyfinWatchByItemId[item.id].loading &&
                      jellyfinWatchByItemId[item.id].error == null;
                    const rowBg = hasMatch
                      ? jellyfinFetched
                        ? "bg-emerald-700/40 border-emerald-600/50"
                        : "bg-emerald-900/30 border-emerald-800/50"
                      : noMatch
                        ? "bg-amber-900/30 border-amber-800/50"
                        : "bg-gray-800/50 border-gray-800";
                    const isClickable = hasMatch;
                    const handleRowActivate = () => {
                      if (!hasMatch) return;
                      setVideoIdForDetails(item.video_id);
                    };
                    return (
                      <li
                        key={item.id}
                        role={isClickable ? "button" : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                        onClick={isClickable ? handleRowActivate : undefined}
                        onKeyDown={
                          isClickable
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleRowActivate();
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          "rounded-lg border p-3 space-y-1.5",
                          rowBg,
                          isClickable && "cursor-pointer hover:opacity-90 transition-opacity"
                        )}
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium text-white">{item.name ?? "—"}</span>
                          {item.type != null && item.type !== "" && (
                            <span className="text-xs text-gray-500">{item.type}</span>
                          )}
                          {item.series_name != null && item.series_name !== "" && (
                            <span className="text-xs text-gray-400">({item.series_name})</span>
                          )}
                          {isEpisode && item.id != null && (
                            <Tooltip title="Get Jellyfin watch status">
                              <button
                                type="button"
                                onClick={(e) => fetchJellyfinWatchStatus(item.id, e)}
                                disabled={jellyfinWatchByItemId[item.id]?.loading}
                                className="ml-1 rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50 disabled:pointer-events-none"
                                aria-label="Get Jellyfin watch status"
                              >
                                <RefreshCw className={cn("h-4 w-4", jellyfinWatchByItemId[item.id]?.loading && "animate-spin")} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0 text-sm text-gray-400">
                          {item.id != null && (
                            <span>Jellyfin ID: {String(item.id)}</span>
                          )}
                          {item.production_year != null && item.production_year !== "" && (
                            <span>Year: {item.production_year}</span>
                          )}
                          {item.runtime_display != null && item.runtime_display !== "" && (
                            <span>Runtime: {item.runtime_display}</span>
                          )}
                          {isEpisode && (
                            <span>
                              video_id: {item.video_id != null ? item.video_id : "No match"}
                            </span>
                          )}
                        </div>
                        {isEpisode && item.watch_status != null && (
                          <div className="text-sm text-gray-400">
                            FSYT Watch Status: Started {item.watch_status.started ? "yes" : "no"}
                            {", "}
                            Progress: {(item.watch_status.progress_seconds ?? 0) > 0
                              ? `${item.watch_status.progress_seconds}s`
                              : "—"}
                            {(item.watch_status.progress_percent ?? 0) > 0
                              ? `, ${Number(item.watch_status.progress_percent).toFixed(1)}%`
                              : ""}
                            {", "}
                            Finished: {item.watch_status.is_finished ? "yes" : "no"}
                          </div>
                        )}
                        {isEpisode && (getAllRunning && jellyfinWatchByItemId[item.id] == null ? (
                          <div className="text-sm text-gray-400">
                            Jellyfin Watch Status: Waiting…
                          </div>
                        ) : jellyfinWatchByItemId[item.id] != null ? (
                          <div className="text-sm text-gray-400">
                            {jellyfinWatchByItemId[item.id].loading ? (
                              <>Jellyfin Watch Status: Loading…{getAllRunning && getAllProgress.total > 0 ? ` (${getAllProgress.current} of ${getAllProgress.total})` : ""}</>
                            ) : jellyfinWatchByItemId[item.id].error != null ? (
                              <>Jellyfin Watch Status: {jellyfinWatchByItemId[item.id].error}</>
                            ) : (
                              <>
                                Jellyfin Watch Status: Started {jellyfinWatchByItemId[item.id].started ? "yes" : "no"}
                                {", "}
                                Progress: {(jellyfinWatchByItemId[item.id].progress_seconds ?? 0) > 0
                                  ? `${jellyfinWatchByItemId[item.id].progress_seconds}s`
                                  : "—"}
                                {(jellyfinWatchByItemId[item.id].progress_percent ?? 0) > 0
                                  ? `, ${Number(jellyfinWatchByItemId[item.id].progress_percent).toFixed(1)}%`
                                  : ""}
                                {", "}
                                Play count: {jellyfinWatchByItemId[item.id].play_count ?? 0}
                              </>
                            )}
                          </div>
                        ) : null)}
                        {isEpisode && !hasMatch && item.path != null && item.path !== "" && (
                          <div className="text-xs text-gray-500 truncate max-w-full" title={item.path}>
                            Jellyfin path: {item.path}
                          </div>
                        )}
                        {item.overview != null && item.overview !== "" && (
                          <p className="text-sm text-gray-300 line-clamp-3">{item.overview}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <VideoDetailsModal
        videoId={videoIdForDetails}
        onClose={() => setVideoIdForDetails(null)}
        setError={setError}
        toast={toast}
        onOpenJobDetails={() => {}}
        onOpenChannelEdit={() => {}}
      />
    </div>
  );
}
