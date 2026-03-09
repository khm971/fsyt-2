import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn, formatSmartTime, formatHeartbeatTime, formatRelativeTime, formatScheduledRunAfter } from "../lib/utils";
import { Activity, Film, ScrollText, Users, ListTodo, PlayCircle, Clock, AlertCircle, CalendarClock } from "lucide-react";

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
  const [control, setControl] = useState({});
  const [logEntries, setLogEntries] = useState([]);
  const [statusData, setStatusData] = useState({ transcodes: [], websocket_connections: 0 });
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const { jobs, status: wsStatus, queueUpdatedAt, logUpdatedAt, transcodeStatusChangedAt, transcodeProgress, serverHeartbeat } = useQueueWebSocket();

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

  const heartbeat = serverHeartbeat ?? control.server_heartbeat?.value;
  const queuePaused = control.queue_paused?.value === "true";
  const chargeableErrorsLockout = control.chargeable_errors_lockout?.value === "true";
  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "new");
  const errors = jobs.filter((j) => j.error_flag);
  const futureScheduled = jobs.filter(
    (j) => j.run_after != null && new Date(j.run_after) > now
  );
  const jobsWithRunAfter = jobs.filter((j) => j.run_after != null);
  const lastScheduledRunAfter =
    jobsWithRunAfter.length > 0
      ? Math.max(...jobsWithRunAfter.map((j) => new Date(j.run_after).getTime()))
      : null;
  const nextScheduledRunAfter =
    futureScheduled.length > 0
      ? Math.min(...futureScheduled.map((j) => new Date(j.run_after).getTime()))
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
            Too many chargeable errors. The job processor has stopped.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
            <Activity className="w-4 h-4" />
            WebSocket
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                wsStatus === "open" && "bg-green-500",
                wsStatus === "connecting" && "bg-yellow-500",
                wsStatus === "closed" && "bg-red-500"
              )}
            />
            <span className="text-white">{wsStatus}</span>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Queue status</div>
          <div className="text-white">
            {chargeableErrorsLockout ? (
              <span className="text-red-400 font-medium">Locked out</span>
            ) : queuePaused ? (
              <span className="text-yellow-400 font-medium">Paused</span>
            ) : (
              "Running"
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
            <ListTodo className="w-4 h-4" />
            Jobs
          </div>
          <div className="text-white text-sm space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5">
                <PlayCircle className="w-3.5 h-3.5 text-green-400" />
                {running.length} running
              </span>
              <span className="flex items-center gap-1.5 text-gray-300">
                <Clock className="w-3.5 h-3.5" />
                {queued.length} queued
              </span>
            </div>
            {errors.length > 0 && (
              <div className="flex items-center gap-1.5 text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errors.length} error{errors.length !== 1 ? "s" : ""}
              </div>
            )}
            {futureScheduled.length > 0 && nextScheduledRunAfter != null && (
              <div className="flex items-center gap-1.5 text-gray-300 pt-0.5">
                <CalendarClock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                <span>
                  Next scheduled: {formatScheduledRunAfter(new Date(nextScheduledRunAfter).toISOString(), now)}
                  {futureScheduled.length > 1 && (
                    <span className="text-gray-500 ml-1">
                      ({futureScheduled.length} total)
                    </span>
                  )}
                </span>
              </div>
            )}
            {futureScheduled.length > 0 && lastScheduledRunAfter != null && (
              <div className="flex items-center gap-1.5 text-gray-300 pt-0.5">
                <CalendarClock className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                <span>
                  Last scheduled: {formatScheduledRunAfter(new Date(lastScheduledRunAfter).toISOString(), now)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Last heartbeat</div>
          <div className="text-white text-sm font-mono">
            {heartbeat ? (
              <>
                {formatHeartbeatTime(heartbeat)}{" "}
                <span className="text-gray-400 font-normal">{formatRelativeTime(heartbeat, now)}</span>
              </>
            ) : (
              "—"
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
                  SEVERITY_COLORS[e.severity] ?? "text-gray-300"
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
    </div>
  );
}
