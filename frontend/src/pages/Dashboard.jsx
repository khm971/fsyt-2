import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { useToast } from "../context/ToastContext";
import { cn, formatSmartTime, formatHeartbeatTime, formatRelativeTime, formatScheduledRunAfter, formatDateTimeWithSeconds } from "../lib/utils";
import { Cpu, Film, ScrollText, Users, ListTodo, PlayCircle, Clock, AlertCircle, AlertTriangle, CalendarClock, Pause, Play } from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import { JobDetailsModal } from "../components/JobDetailsModal";

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
  const queueRefreshTriggeredRef = useRef(false);
  const { jobs, queueSummary, queueUpdatedAt, logUpdatedAt, transcodeStatusChangedAt, transcodeProgress, serverHeartbeat, multipleInstances, backendInstances, queuePausedFromServer, videoProgressOverrides, refreshSummary } = useQueueWebSocket();

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
  const isJobInProgress = (j) => j.status != null && j.status !== "new" && j.status !== "done" && j.status !== "cancelled";
  const runningCount = queueSummary?.running_count ?? jobs.filter(isJobInProgress).length;
  const running = queueSummary?.running?.length ? queueSummary.running : jobs.filter(isJobInProgress);
  const runningJob =
    queueSummary?.running_job != null
      ? queueSummary.running_job
      : running[0] != null
        ? {
            job_queue_id: running[0].job_queue_id,
            job_type: running[0].job_type,
            status_percent_complete: running[0].status_percent_complete,
            video_id: running[0].video_id ?? undefined,
          }
        : null;
  const runnableCount =
    queueSummary?.runnable_count ??
    jobs.filter(
      (j) =>
        j.status === "new" &&
        (!j.run_after || new Date(j.run_after) <= now)
    ).length;
  const errorsCount = queueSummary?.errors_count ?? jobs.filter((j) => j.error_flag && !j.acknowledge_flag).length;
  const warningsCount = queueSummary?.warnings_count ?? jobs.filter((j) => j.warning_flag && !j.acknowledge_flag).length;
  const futureScheduled = jobs.filter(
    (j) => j.status === "new" && j.run_after != null && new Date(j.run_after) > now
  );
  const jobsWithRunAfter = jobs.filter((j) => j.status === "new" && j.run_after != null);
  const lastScheduledRunAfter =
    jobsWithRunAfter.length > 0
      ? Math.max(...jobsWithRunAfter.map((j) => new Date(j.run_after).getTime()))
      : null;
  const nextScheduledRunAfter =
    futureScheduled.length > 0
      ? Math.min(...futureScheduled.map((j) => new Date(j.run_after).getTime()))
      : null;
  const nextScheduledJob =
    futureScheduled.length > 0 && nextScheduledRunAfter != null
      ? futureScheduled.find((j) => new Date(j.run_after).getTime() === nextScheduledRunAfter)
      : null;
  useEffect(() => {
    if (queueSummary == null && refreshSummary && !queueRefreshTriggeredRef.current) {
      queueRefreshTriggeredRef.current = true;
      refreshSummary();
    }
  }, [queueSummary, refreshSummary]);
  const lastScheduledJob =
    jobsWithRunAfter.length > 0 && lastScheduledRunAfter != null
      ? jobsWithRunAfter.find((j) => new Date(j.run_after).getTime() === lastScheduledRunAfter)
      : null;

  if (loading) {
    return (
      <div className="text-gray-400 py-8">Loading...</div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Dashboard</h2>

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
                    to="/queue?filter=warnings_and_errors"
                    className="flex items-center gap-1.5 text-red-400 hover:text-red-300"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {errorsCount} error{errorsCount !== 1 ? "s" : ""}
                  </Link>
                )}
                {warningsCount > 0 && (
                  <Link
                    to="/queue?filter=warnings_and_errors"
                    className="flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {warningsCount} warning{warningsCount !== 1 ? "s" : ""}
                  </Link>
                )}
              </div>
            )}
            {futureScheduled.length > 0 && nextScheduledRunAfter != null && nextScheduledJob && (
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
                {futureScheduled.length > 1 && (
                  <Link
                    to="/queue?filter=scheduled"
                    className="text-cyan-400 ml-1 hover:text-cyan-300"
                  >
                    ({futureScheduled.length} total)
                  </Link>
                )}
              </div>
            )}
            {futureScheduled.length > 0 && lastScheduledRunAfter != null && lastScheduledJob && (
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
              {chargeableErrorsLockout ? (
                <span className="text-red-400 font-medium">Locked out</span>
              ) : queuePaused ? (
                <span className="text-yellow-400 font-medium">Paused</span>
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
            {multipleInstances && (
              <div className="flex items-center gap-1.5 text-red-400 font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Multiple backends detected
              </div>
            )}
            {multipleInstances && backendInstances.length > 0 ? (
              <div className="font-mono text-xs space-y-0.5 text-red-200/90">
                {backendInstances.map((inst, i) => (
                  <div key={inst.instance_id ?? i}>
                    {inst.hostname || inst.instance_id || "Unknown"}: {formatHeartbeatTime(inst.last_heartbeat_utc)}{" "}
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
                title={`Severity: ${e.severity}, Job ID: ${e.job_id ?? "—"}, Video ID: ${e.video_id ?? "—"}, Channel ID: ${e.channel_id ?? "—"}`}
                className={cn(
                  "flex gap-2 truncate items-center",
                  e.message === "Application starting, database connected"
                    ? "text-green-400"
                    : SEVERITY_COLORS[e.severity] ?? "text-gray-300"
                )}
              >
                <span className="text-gray-500 shrink-0">
                  {formatSmartTime(e.event_time)}
                </span>
                <span className="truncate flex-1">{e.message}</span>
                {e.acknowledged ? (
                  <span className="text-green-500 text-xs shrink-0">Acked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAck(e.event_log_id)}
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

      <JobDetailsModal
        jobId={jobQueueIdForModal}
        onClose={() => setJobQueueIdForModal(null)}
        setError={setError}
        toast={toast}
      />
    </div>
  );
}
