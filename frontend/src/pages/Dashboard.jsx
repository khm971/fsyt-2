import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { useToast } from "../context/ToastContext";
import { cn, formatSmartTime, formatHeartbeatTime, formatRelativeTime, formatScheduledRunAfter, formatDateTimeWithSeconds } from "../lib/utils";
import { Cpu, Film, ScrollText, Users, ListTodo, PlayCircle, Clock, AlertCircle, AlertTriangle, CalendarClock, Pause, Play, Plus, Server } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { LogEntryDetailsModal } from "../components/LogEntryDetailsModal";
import { AddVideoModal } from "../components/AddVideoModal";

function serverInstanceHeartbeatDotTitle(inst, now) {
  if (inst.last_heartbeat_utc) {
    const abs = formatDateTimeWithSeconds(inst.last_heartbeat_utc);
    const rel = formatRelativeTime(inst.last_heartbeat_utc, now);
    return `Last heartbeat: ${abs} (${rel}). ${
      inst.is_running
        ? "Green: last check-in within the last 10 minutes."
        : "Gray: last check-in was more than 10 minutes ago."
    }`;
  }
  return "No heartbeat recorded for this instance yet.";
}

const SEVERITY_COLORS = {
  5: "text-gray-500",
  10: "text-gray-400",
  20: "text-blue-400",
  25: "text-cyan-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};


export default function Dashboard({ setError }) {
  const toast = useToast();
  const [control, setControl] = useState({});
  const [logEntries, setLogEntries] = useState([]);
  const [statusData, setStatusData] = useState({ transcodes: [], websocket_connections: 0 });
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [videoIdForModal, setVideoIdForModal] = useState(null);
  const [channelIdForModal, setChannelIdForModal] = useState(null);
  const [eventLogIdForModal, setEventLogIdForModal] = useState(null);
  const [showAddVideo, setShowAddVideo] = useState(false);
  const queueRefreshTriggeredRef = useRef(false);
  const { queueSummary, queueUpdatedAt, logUpdatedAt, transcodeStatusChangedAt, transcodeProgress, serverHeartbeat, multipleInstances, backendInstances, queuePausedFromServer, videoProgressOverrides, refreshSummary } = useQueueWebSocket();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [list, recent, status] = await Promise.all([
          api.control.list(),
          api.log.recent({ limit: 20, min_severity: 20 }),
          api.status.get(),
        ]);
        if (cancelled) return;
        const map = {};
        list.forEach((c) => {
          map[c.key] = c;
        });
        setControl(map);
        setLogEntries(recent);
        setStatusData(status);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [setError, queueUpdatedAt, logUpdatedAt, transcodeStatusChangedAt]);

  const transcodes = transcodeProgress ?? statusData.transcodes ?? [];

  const handleAck = async (eventLogId) => {
    try {
      await api.log.acknowledge(eventLogId);
      setLogEntries((prev) =>
        prev.map((e) =>
          e.event_log_id === eventLogId ? { ...e, acknowledged: true } : e
        )
      );
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSetQueuePaused = async (paused) => {
    try {
      const value = paused ? "true" : "false";
      const r = await api.control.set("queue_paused", value);
      setControl((prev) => ({ ...prev, [r.key]: { key: r.key, index: r.index, value: r.value, last_update: r.last_update } }));
      toast.addToast(paused ? "Queue paused" : "Queue resumed", "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const heartbeat = serverHeartbeat ?? control.server_heartbeat?.value;
  const heartbeatAgeMs = heartbeat != null ? now.getTime() - new Date(heartbeat).getTime() : null;
  const oneMinuteMs = 60 * 1000;
  const fiveMinutesMs = 5 * 60 * 1000;
  const heartbeatCurrent = heartbeatAgeMs != null && heartbeatAgeMs <= oneMinuteMs;
  const heartbeatStale = heartbeatAgeMs != null && heartbeatAgeMs > oneMinuteMs && heartbeatAgeMs <= fiveMinutesMs;
  const heartbeatOld = heartbeatAgeMs != null && heartbeatAgeMs > fiveMinutesMs;
  const queuePaused =
    queuePausedFromServer !== undefined
      ? queuePausedFromServer
      : control.queue_paused?.value === "true";
  const chargeableErrorsLockout = control.chargeable_errors_lockout?.value === "true";
  const runningCount = queueSummary?.running_count ?? 0;
  const running = queueSummary?.running ?? [];
  const runningJob = queueSummary?.running_job ?? null;
  const runnableCount = queueSummary?.runnable_count ?? 0;
  const errorsCount = queueSummary?.errors_count ?? 0;
  const warningsCount = queueSummary?.warnings_count ?? 0;
  const scheduledCount = queueSummary?.scheduled_count ?? 0;
  const nextScheduledJob = queueSummary?.next_scheduled_job ?? null;
  const lastScheduledJob = queueSummary?.last_scheduled_job ?? null;
  const nextScheduledRunAfter =
    nextScheduledJob?.run_after != null ? new Date(nextScheduledJob.run_after).getTime() : null;
  const lastScheduledRunAfter =
    lastScheduledJob?.run_after != null ? new Date(lastScheduledJob.run_after).getTime() : null;
  const instancesSummary = queueSummary?.instances_summary ?? [];
  const thisServerInstanceId = queueSummary?.this_server_instance_id;
  const duplicateThisInstance = queueSummary?.duplicate_server_instance_id ?? multipleInstances;
  const instanceQueuePaused = queueSummary?.instance_queue_paused ?? false;
  useEffect(() => {
    if (queueSummary == null && refreshSummary && !queueRefreshTriggeredRef.current) {
      queueRefreshTriggeredRef.current = true;
      refreshSummary();
    }
  }, [queueSummary, refreshSummary]);

  if (loading) {
    return (
      <div className="text-gray-400 py-8">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-white">Dashboard</h2>
        <button
          type="button"
          onClick={() => setShowAddVideo(true)}
          className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap min-w-[8.5rem] px-5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden />
          Add video
        </button>
      </div>

      {chargeableErrorsLockout && (
        <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-red-400 font-semibold">Queue locked out</span>
          <span className="text-red-300 text-sm">
            Too many charged errors. The job processor has stopped.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <Link
            to="/queue"
            className="flex items-center gap-2 text-gray-400 text-sm mb-2 hover:text-gray-300"
          >
            <ListTodo className="w-4 h-4" />
            Jobs
          </Link>
          <div className="text-white text-sm space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              {runningCount > 0 ? (
                <Tooltip
                  title={
                    runningJob?.status_percent_complete != null
                      ? `${runningJob.job_type} (${runningJob.status_percent_complete}%)`
                      : runningJob?.job_type
                  }
                  side="top"
                >
                  <button
                    type="button"
                    onClick={() => setJobQueueIdForModal(runningJob?.job_queue_id)}
                    className="flex items-center gap-1.5 text-green-400 hover:text-green-300 text-left"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    {runningCount} running
                  </button>
                </Tooltip>
              ) : (
                <span className="flex items-center gap-1.5 text-gray-300">
                  <PlayCircle className="w-3.5 h-3.5" />
                  {runningCount} running
                </span>
              )}
              {runnableCount > 0 ? (
                <Link
                  to="/queue?filter=queued"
                  className={cn(
                    "flex items-center gap-1.5",
                    runnableCount >= 10
                      ? "text-yellow-400 hover:text-yellow-300"
                      : "text-blue-400 hover:text-blue-300"
                  )}
                >
                  <Clock className="w-3.5 h-3.5" />
                  {runnableCount} runnable
                </Link>
              ) : (
                <span className="flex items-center gap-1.5 text-gray-300">
                  <Clock className="w-3.5 h-3.5" />
                  {runnableCount} runnable
                </span>
              )}
            </div>
            {runningCount > 0 && runningJob && (() => {
              const percent =
                runningJob.video_id != null && videoProgressOverrides[runningJob.video_id]?.status_percent_complete != null
                  ? videoProgressOverrides[runningJob.video_id].status_percent_complete
                  : runningJob.status_percent_complete;
              return percent != null && percent >= 1 && percent <= 99 ? (
                <div className="w-full max-w-[120px] h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, Number(percent) || 0))}%`,
                    }}
                  />
                </div>
              ) : null;
            })()}
            {(errorsCount > 0 || warningsCount > 0) && (
              <div className="flex items-center gap-2 flex-wrap">
                {errorsCount > 0 && (
                  <Link
                    to="/queue?filter=errors"
                    className="flex items-center gap-1.5 text-red-400 hover:text-red-300"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {errorsCount} error{errorsCount !== 1 ? "s" : ""}
                  </Link>
                )}
                {warningsCount > 0 && (
                  <Link
                    to="/queue?filter=warnings"
                    className="flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {warningsCount} warning{warningsCount !== 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            )}
            {scheduledCount > 0 && nextScheduledRunAfter != null && nextScheduledJob && (
              <div className="flex items-center gap-1.5 text-gray-300 pt-0.5 flex-wrap">
                <CalendarClock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                <Tooltip
                  title={`${formatDateTimeWithSeconds(nextScheduledJob.run_after)}\nJob ID: ${nextScheduledJob.job_queue_id}`}
                  side="right"
                  wrap
                >
                  <button
                    type="button"
                    onClick={() => setJobQueueIdForModal(nextScheduledJob.job_queue_id)}
                    className="text-left text-cyan-400 hover:text-cyan-300"
                  >
                    Next scheduled: {formatScheduledRunAfter(new Date(nextScheduledRunAfter).toISOString(), now)}
                  </button>
                </Tooltip>
                {scheduledCount > 1 && (
                  <Link
                    to="/queue?filter=scheduled"
                    className="text-cyan-400 ml-1 hover:text-cyan-300"
                  >
                    ({scheduledCount} total)
                  </Link>
                )}
              </div>
            )}
            {scheduledCount > 0 && lastScheduledRunAfter != null && lastScheduledJob && (
              <div className="flex items-center gap-1.5 text-gray-300 pt-0.5">
                <CalendarClock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                <Tooltip
                  title={`${formatDateTimeWithSeconds(lastScheduledJob.run_after)}\nJob ID: ${lastScheduledJob.job_queue_id}`}
                  side="right"
                  wrap
                >
                  <button
                    type="button"
                    onClick={() => setJobQueueIdForModal(lastScheduledJob.job_queue_id)}
                    className="text-left text-cyan-400 hover:text-cyan-300"
                  >
                    Last scheduled: {formatScheduledRunAfter(new Date(lastScheduledRunAfter).toISOString(), now)}
                  </button>
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
            <Cpu className="w-4 h-4" />
            Job Processor
          </div>
          <div className="text-white text-sm space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {thisServerInstanceId != null && (
                <span className="text-gray-400 text-xs font-mono border border-gray-700 rounded px-1.5 py-0.5">
                  Connected: instance {thisServerInstanceId}
                </span>
              )}
              {chargeableErrorsLockout ? (
                <span className="text-red-400 font-medium">Locked out</span>
              ) : queuePaused ? (
                <span className="text-yellow-400 font-medium">Paused (global)</span>
              ) : instanceQueuePaused ? (
                <span className="text-yellow-400 font-medium">Paused (duplicate ID)</span>
              ) : (
                "Running"
              )}
              {!chargeableErrorsLockout && (
                <>
                  {queuePaused && (
                    <button
                      type="button"
                      onClick={() => handleSetQueuePaused(false)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 text-xs"
                    >
                      <Play className="w-3 h-3" />
                      Resume
                    </button>
                  )}
                  {!queuePaused && (
                    <button
                      type="button"
                      onClick={() => handleSetQueuePaused(true)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 text-xs"
                    >
                      <Pause className="w-3 h-3" />
                      Pause
                    </button>
                  )}
                </>
              )}
            </div>
            {duplicateThisInstance && (
              <div className="flex items-center gap-1.5 text-red-400 font-medium flex-wrap">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Duplicate process for this instance ID
                <Link to="/admin/server-instances" className="text-cyan-400 hover:text-cyan-300 text-sm font-normal">
                  Manage instances
                </Link>
              </div>
            )}
            {duplicateThisInstance && backendInstances.length > 0 ? (
              <div className="font-mono text-xs space-y-0.5 text-red-200/90">
                {backendInstances.map((inst, i) => (
                  <div key={inst.instance_id ?? i}>
                    ID {inst.server_instance_id ?? "?"} {inst.hostname ? `· ${inst.hostname}` : ""}:{" "}
                    {formatHeartbeatTime(inst.last_heartbeat_utc)}{" "}
                    <span className="text-red-300/80">
                      ({inst.last_heartbeat_utc ? formatRelativeTime(inst.last_heartbeat_utc, now) : "—"})
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-mono text-gray-300">
                {heartbeat ? (
                  <>
                    {formatHeartbeatTime(heartbeat)}{" "}
                    <span
                      className={cn(
                        "font-normal",
                        heartbeatCurrent && "text-green-400",
                        heartbeatStale && "text-yellow-400",
                        heartbeatOld && "text-red-400"
                      )}
                    >
                      ({heartbeatCurrent ? "Current" : formatRelativeTime(heartbeat, now)})
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
            <Film className="w-4 h-4" />
            Transcodes
          </div>
          <div className="text-white text-sm">
            {!transcodes || transcodes.length === 0 ? (
              "No transcodes running"
            ) : (
              <div className="space-y-1">
                <span>{transcodes.length} running</span>
                <div className="text-gray-300 font-mono text-xs">
                  {transcodes.map((t) => (
                    <div key={t.video_id}>
                      Video {t.video_id}
                      {t.segment_count != null && (
                        <span className="text-gray-500 ml-1">
                          ({t.segment_count}
                          {t.total_segments != null ? ` / ${t.total_segments}` : ""} segments
                          {t.percent_complete != null && `, ${t.percent_complete}%`})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
            <Users className="w-4 h-4" />
            WebSocket connections
          </div>
          <div className="text-white">
            {statusData.websocket_connections ?? 0}
          </div>
        </div>
      </div>

      {instancesSummary.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Server className="w-4 h-4" />
              Server instances (cluster)
            </div>
            <Link to="/admin/server-instances" className="text-xs text-cyan-400 hover:text-cyan-300">
              Configure
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {instancesSummary.map((inst) => (
              <Link
                key={inst.server_instance_id}
                to={`/queue?target_server_instance_id=${inst.server_instance_id}`}
                className={cn(
                  "rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-sm space-y-1.5 block text-left",
                  "hover:border-gray-600 hover:bg-gray-900/60 transition-colors cursor-pointer",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                )}
                title="Open job queue filtered to this instance"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white font-medium truncate" title={inst.display_name}>
                    {inst.display_name}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 w-2 h-2 rounded-full",
                      inst.is_running ? "bg-green-500" : "bg-gray-600"
                    )}
                    title={serverInstanceHeartbeatDotTitle(inst, now)}
                  />
                </div>
                <div className="text-gray-500 text-xs font-mono">ID {inst.server_instance_id}</div>
                <div className="text-gray-400 text-xs flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>Queued: {inst.queued_new}</span>
                  <span>Runnable: {inst.runnable}</span>
                  <span>Scheduled: {inst.scheduled_future}</span>
                </div>
                {inst.running_job && (
                  <div className="text-xs text-gray-300 truncate" title={inst.running_job.job_type}>
                    Running: {inst.running_job.job_type}
                    {inst.running_job.video_id != null ? ` · v${inst.running_job.video_id}` : ""}
                    {inst.running_job.status_percent_complete != null
                      ? ` (${inst.running_job.status_percent_complete}%)`
                      : ""}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {!inst.is_enabled && (
                    <span className="text-amber-400/90">Disabled</span>
                  )}
                  {!inst.assign_download_jobs && (
                    <span className="text-gray-500">No downloader</span>
                  )}
                  {inst.duplicate_id_conflict && (
                    <span className="text-red-400">Duplicate</span>
                  )}
                  {inst.instance_queue_paused && (
                    <span className="text-yellow-400">Paused</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-400">Recent events</h3>
          <Link
            to="/log"
            className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
          >
            <ScrollText className="w-4 h-4" />
            View full log
          </Link>
        </div>
        <div className="space-y-1 text-xs font-mono">
          {logEntries.length === 0 ? (
            <div className="text-gray-500">No events yet</div>
          ) : (
            logEntries.map((e) => (
              <div
                key={e.event_log_id}
                role="button"
                tabIndex={0}
                onClick={() => setEventLogIdForModal(e.event_log_id)}
                onKeyDown={(ev) => ev.key === "Enter" && setEventLogIdForModal(e.event_log_id)}
                title={`Severity: ${e.severity}, Instance: ${e.server_instance_id ?? "—"}, Job ID: ${e.job_id ?? "—"}, Video ID: ${e.video_id ?? "—"}, Channel ID: ${e.channel_id ?? "—"}`}
                className={cn(
                  "flex gap-2 truncate items-center cursor-pointer rounded px-1 -mx-1 hover:bg-gray-800/50",
                  e.message === "Application starting, database connected"
                    ? "text-green-400"
                    : SEVERITY_COLORS[e.severity] ?? "text-gray-300"
                )}
              >
                <span className="text-gray-500 shrink-0">
                  {formatSmartTime(e.event_time)}
                </span>
                <span
                  className="shrink-0 rounded border border-gray-700/80 bg-gray-800/50 px-1.5 py-px text-[10px] leading-tight font-mono text-gray-400 tabular-nums"
                  title={e.server_instance_id != null ? `Server instance ${e.server_instance_id}` : "No server instance on record (older entry)"}
                >
                  {e.server_instance_id != null ? `[${e.server_instance_id}]` : "—"}
                </span>
                <span className="truncate flex-1 min-w-0">{e.message}</span>
                {e.acknowledged ? (
                  <span className="text-green-500 text-xs shrink-0">Acked</span>
                ) : (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleAck(e.event_log_id);
                    }}
                    className="text-blue-400 hover:text-blue-300 text-xs shrink-0"
                  >
                    Ack
                  </button>
                )}
              </div>
              ))
          )}
        </div>
      </div>

      {eventLogIdForModal != null && (
        <LogEntryDetailsModal
          eventLogId={eventLogIdForModal}
          onClose={() => setEventLogIdForModal(null)}
          setError={setError}
          toast={toast}
          onOpenJob={(id) => setJobQueueIdForModal(id)}
          onOpenVideo={(id) => setVideoIdForModal(id)}
          onOpenChannel={(id) => setChannelIdForModal(id)}
        />
      )}
      <JobDetailsModal
        jobId={jobQueueIdForModal}
        onClose={() => setJobQueueIdForModal(null)}
        setError={setError}
        toast={toast}
      />
      <VideoDetailsModal
        videoId={videoIdForModal}
        onClose={() => setVideoIdForModal(null)}
        setError={setError}
        toast={toast}
        onOpenJobDetails={(jobId) => setJobQueueIdForModal(jobId)}
        onOpenChannelEdit={(channelId) => setChannelIdForModal(channelId)}
      />
      <ChannelEditModal
        channelId={channelIdForModal}
        onClose={() => setChannelIdForModal(null)}
        setError={setError}
      />
      <AddVideoModal
        open={showAddVideo}
        onClose={() => setShowAddVideo(false)}
        setError={setError}
        onSuccess={() => refreshSummary?.()}
      />
    </div>
  );
}
