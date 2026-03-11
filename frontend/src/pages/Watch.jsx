import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { cn, formatDurationSeconds } from "../lib/utils";
import { Play, Film } from "lucide-react";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import VideoPlayer from "../components/VideoPlayer";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
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
  const { videoUpdatedAt } = useQueueWebSocket();

  const loadVideos = useCallback(async () => {
    try {
      const list = await api.videos.watchList();
      setVideos(list);
    } catch (e) {
      setError(e.message);
    }
  }, [setError]);

  useEffect(() => {
    setLoading(true);
    loadVideos().finally(() => setLoading(false));
  }, [loadVideos]);

  useEffect(() => {
    if (videoUpdatedAt > 0) loadVideos();
  }, [videoUpdatedAt, loadVideos]);

  if (loading) return <div className="text-gray-400 py-8">Loading...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Watch</h2>
      <p className="text-gray-400 text-sm">Videos you&apos;ve started but not finished, most recent first.</p>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Title / Provider key</th>
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
                  <div className="flex items-center gap-1.5">
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
          <div className="px-4 py-8 text-center text-gray-500">No videos in progress.</div>
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
        onClose={() => setVideoIdForDetails(null)}
        setError={setError}
        toast={toast}
        onVideoUpdated={loadVideos}
        onOpenJobDetails={(jobId) => setJobQueueIdForModal(jobId)}
        onOpenChannelEdit={(channelId) => setEditingChannelId(channelId)}
      />
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
