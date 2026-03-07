import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { cn } from "../lib/utils";
import { useQueueWebSocket } from "../context/QueueWebSocketContext";
import { X, Settings } from "lucide-react";
import { Tooltip } from "./Tooltip";

const PROGRESS_INTERVAL_MS = 10000;

// iPad: userAgent contains "iPad", or iPadOS 13+ reports as MacIntel with touch
const isIpad = typeof navigator !== "undefined" && (
  /iPad/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
);

function formatDuration(seconds) {
  if (seconds == null || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({ videoId, title, duration, onClose }) {
  const { send, status: wsStatus } = useQueueWebSocket();
  const [startTime, setStartTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsData, setDetailsData] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [liveProgress, setLiveProgress] = useState({ seconds: 0, percent: 0 });
  const [transcodeLogs, setTranscodeLogs] = useState([]);
  const videoRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const progress = await api.videos.getWatchProgress(videoId);
        if (cancelled) return;
        const percent = progress.progress_percent ?? 0;
        const seconds = progress.progress_seconds ?? 0;
        if (percent >= 100) {
          setStartTime(0);
        } else {
          setStartTime(seconds);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [videoId]);

  // Set video source: direct URL for non-iPad; HLS for iPad (Safari native HLS = progressive playback, no full buffering)
  useEffect(() => {
    if (loading) return;
    setVideoSrc(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (!isIpad) {
      setVideoSrc(api.videos.streamUrl(videoId, { transcode: false }));
      return;
    }
    setVideoSrc(api.videos.hlsUrl(videoId));
  }, [videoId, loading]);

  const reportProgress = useCallback((seconds, percent) => {
    if (wsStatus === "open") {
      send({
        type: "watch_progress",
        video_id: videoId,
        progress_seconds: Math.floor(seconds),
        progress_percent: percent,
      });
    } else {
      api.videos.updateWatchProgress(videoId, Math.floor(seconds), percent).catch(() => {});
    }
  }, [videoId, wsStatus, send]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loading || !videoSrc) return;

    const getValidDuration = () => {
      const d = video.duration;
      if (typeof d === "number" && d > 0 && Number.isFinite(d)) return d;
      return duration != null && duration > 0 ? duration : null;
    };

    const setInitialTime = () => {
      if (startTime > 0) {
        video.currentTime = startTime;
        const dur = getValidDuration();
        if (dur != null) {
          setLiveProgress({ seconds: Math.floor(startTime), percent: (startTime / dur) * 100 });
        }
      }
    };

    video.addEventListener("loadedmetadata", setInitialTime);
    if (video.readyState >= 1) setInitialTime();

    const onTimeUpdate = () => {
      const sec = video.currentTime;
      const dur = getValidDuration();
      if (dur != null) {
        setLiveProgress({ seconds: Math.floor(sec), percent: (sec / dur) * 100 });
      }
    };

    const onEnded = () => {
      const dur = getValidDuration();
      if (dur != null) reportProgress(Math.floor(dur), 100);
    };

    const onPlay = () => {
      const sec = video.currentTime;
      const dur = getValidDuration();
      if (dur != null) reportProgress(sec, (sec / dur) * 100);
    };

    progressIntervalRef.current = setInterval(() => {
      if (video.paused) return;
      const sec = video.currentTime;
      const dur = getValidDuration();
      if (dur != null) reportProgress(sec, (sec / dur) * 100);
    }, PROGRESS_INTERVAL_MS);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("loadedmetadata", setInitialTime);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("ended", onEnded);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [videoId, startTime, loading, duration, reportProgress, videoSrc]);

  const loadDetails = useCallback(async () => {
    setDetailsLoading(true);
    setDetailsData(null);
    try {
      const [video, progress] = await Promise.all([
        api.videos.get(videoId),
        api.videos.getWatchProgress(videoId),
      ]);
      let channel = null;
      if (video?.channel_id) {
        try {
          channel = await api.channels.get(video.channel_id);
        } catch {
          channel = { title: null, handle: null };
        }
      }
      const el = videoRef.current;
      const resolution = el && el.videoWidth && el.videoHeight
        ? `${el.videoWidth}×${el.videoHeight}`
        : null;
      const format = video?.file_path
        ? (video.file_path.match(/\.([a-zA-Z0-9]+)$/)?.[1] || "mp4").toUpperCase()
        : "MP4";
      setDetailsData({
        video,
        progress,
        channel,
        resolution,
        format,
      });
    } catch (e) {
      setDetailsData({ error: e.message });
    } finally {
      setDetailsLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    if (showDetails) {
      loadDetails();
    } else {
      setDetailsData(null);
    }
  }, [showDetails, loadDetails]);

  // Poll transcode logs when transcoding (iPad) and details panel is open
  useEffect(() => {
    if (!showDetails || !isIpad) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const entries = await api.log.recent({ limit: 30, video_id: videoId });
        if (!cancelled) setTranscodeLogs(entries);
      } catch {
        if (!cancelled) setTranscodeLogs([]);
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [showDetails, isIpad, videoId]);

  const updateResolutionFromVideo = () => {
    const el = videoRef.current;
    if (el?.videoWidth && el?.videoHeight) {
      setDetailsData((d) => d && !d.error ? { ...d, resolution: `${el.videoWidth}×${el.videoHeight}` } : d);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
        <div className="bg-gray-900 rounded-lg p-4 max-w-md">
          <p className="text-red-400">{error}</p>
          <button type="button" onClick={onClose} className="mt-4 text-blue-400 hover:text-blue-300">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div
        className="relative w-[90vw] h-[90vh] flex flex-col rounded-lg overflow-hidden bg-black border border-gray-600/60 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-2 py-1 shrink-0">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Tooltip title="Video details">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className={cn(
                  "p-1.5 rounded shrink-0",
                  showDetails ? "text-blue-400 bg-gray-700/50" : "text-gray-400 hover:text-gray-300 hover:bg-gray-700/50"
                )}
              >
                <Settings className="w-4 h-4" />
              </button>
            </Tooltip>
            <p className="text-white text-sm truncate">{title || "Video"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className={cn("flex-1 min-h-0 flex items-center justify-center relative", showDetails && "min-w-0")}>
            {videoSrc && (
              <video
                ref={videoRef}
                src={videoSrc}
                controls
                autoPlay
                className="w-full h-full object-contain rounded-b-lg"
                onLoadedMetadata={updateResolutionFromVideo}
              />
            )}
          </div>
          {showDetails && (
            <div className="w-64 shrink-0 border-l border-gray-700 bg-gray-900/95 overflow-y-auto">
              {detailsLoading && (
                <div className="p-3 text-gray-400 text-sm">Loading…</div>
              )}
              {detailsData?.error && (
                <div className="p-3 text-red-400 text-sm">{detailsData.error}</div>
              )}
              {detailsData && !detailsData.error && !detailsLoading && (
                <div className="p-3 text-xs text-gray-400 space-y-2">
                  <div><span className="text-gray-500">Video ID:</span> <span className="text-gray-300 font-mono">{detailsData.video?.video_id}</span></div>
                  <div><span className="text-gray-500">Provider key:</span> <span className="text-gray-300 font-mono break-all">{detailsData.video?.provider_key}</span></div>
                  <div><span className="text-gray-500">Duration:</span> <span className="text-gray-300">{formatDuration(detailsData.video?.duration)}</span></div>
                  <div><span className="text-gray-500">Seconds watched:</span> <span className="text-gray-300">{liveProgress.seconds}</span></div>
                  <div><span className="text-gray-500">Percent watched:</span> <span className="text-gray-300">{liveProgress.percent.toFixed(1)}%</span></div>
                  <div><span className="text-gray-500">Resolution:</span> <span className="text-gray-300">{detailsData.resolution || "—"}</span></div>
                  <div><span className="text-gray-500">Format:</span> <span className="text-gray-300">{detailsData.format}</span></div>
                  <div><span className="text-gray-500">Transcoding:</span> <span className="text-gray-300">{isIpad ? "Yes" : "No"}</span></div>
                  <div><span className="text-gray-500">Channel ID:</span> <span className="text-gray-300 font-mono">{detailsData.video?.channel_id ?? "—"}</span></div>
                  <div><span className="text-gray-500">Channel:</span> <span className="text-gray-300 truncate block">{detailsData.channel?.title || detailsData.channel?.handle || "—"}</span></div>
                  {detailsData.video?.status && (
                    <div><span className="text-gray-500">Status:</span> <span className="text-gray-300">{detailsData.video.status}</span></div>
                  )}
                  {detailsData.video?.file_path && (
                    <div><span className="text-gray-500">File path:</span> <span className="text-gray-300 font-mono break-all text-[10px]">{detailsData.video.file_path}</span></div>
                  )}
                  {isIpad && transcodeLogs.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-gray-700">
                      <div className="text-gray-500 mb-1">Transcode log (FFMPEG):</div>
                      <div className="font-mono text-[10px] text-gray-400 space-y-0.5 max-h-40 overflow-y-auto bg-gray-950/50 rounded p-1.5">
                        {transcodeLogs.map((e) => (
                          <div key={e.event_log_id} className={e.severity >= 30 ? "text-amber-400" : ""}>
                            {e.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
