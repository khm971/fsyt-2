import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getWsUrl, api } from "../api/client";

const RECONNECT_INTERVAL_MS = 5000;
const INITIAL_QUEUE_LIMIT = 500;

function isInProgress(status) {
  return status != null && status !== "new" && status !== "done" && status !== "cancelled";
}

/** Build summary from server-provided counts and optional pending_jobs (for running list). */
function summaryFromMessage(msg, pendingList) {
  const list = pendingList || [];
  const running = list.filter((j) => isInProgress(j.status));
  return {
    running,
    running_count: typeof msg.running_count === "number" ? msg.running_count : running.length,
    queued_count: typeof msg.queued_count === "number" ? msg.queued_count : list.filter((j) => j.status === "new").length,
    runnable_count: typeof msg.runnable_count === "number" ? msg.runnable_count : 0,
    total_count: typeof msg.total_count === "number" ? msg.total_count : 0,
    errors_count: typeof msg.errors_count === "number" ? msg.errors_count : 0,
    warnings_count: typeof msg.warnings_count === "number" ? msg.warnings_count : 0,
    scheduled_count: typeof msg.scheduled_count === "number" ? msg.scheduled_count : 0,
    next_scheduled_job: msg.next_scheduled_job ?? null,
    last_scheduled_job: msg.last_scheduled_job ?? null,
    running_job: msg.running_job ?? (running[0] ? { job_queue_id: running[0].job_queue_id, job_type: running[0].job_type, status_percent_complete: running[0].status_percent_complete, video_id: running[0].video_id } : null),
    instances_summary: Array.isArray(msg.instances_summary) ? msg.instances_summary : [],
    this_server_instance_id: msg.this_server_instance_id ?? null,
    duplicate_server_instance_id: Boolean(msg.duplicate_server_instance_id),
    instance_queue_paused: Boolean(msg.instance_queue_paused),
  };
}

const QueueWebSocketContext = createContext(null);

export function QueueWebSocketProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [queueSummary, setQueueSummary] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [videoUpdatedAt, setVideoUpdatedAt] = useState(0);
  const [videoWatchPatches, setVideoWatchPatches] = useState(() => ({}));
  const [queueUpdatedAt, setQueueUpdatedAt] = useState(0);
  const [logUpdatedAt, setLogUpdatedAt] = useState(0);
  const [transcodeStatusChangedAt, setTranscodeStatusChangedAt] = useState(0);
  const [transcodeProgress, setTranscodeProgress] = useState(null);
  const [videoProgressOverrides, setVideoProgressOverrides] = useState({});
  const [jobOverrides, setJobOverrides] = useState(() => ({}));
  const [serverHeartbeat, setServerHeartbeat] = useState(null);
  const [reconnectedAt, setReconnectedAt] = useState(0);
  const [multipleInstances, setMultipleInstances] = useState(false);
  const [backendInstances, setBackendInstances] = useState([]);
  const [queuePausedFromServer, setQueuePausedFromServer] = useState(undefined);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const wasClosedRef = useRef(false);
  const jobsRef = useRef([]);

  const send = useCallback((message) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(typeof message === "string" ? message : JSON.stringify(message));
    }
  }, []);

  const connect = useCallback(() => {
    const url = getWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      if (wasClosedRef.current) {
        setReconnectedAt(Date.now());
        wasClosedRef.current = false;
      }
    };
    ws.onclose = () => {
      wasClosedRef.current = true;
      setStatus("closed");
      wsRef.current = null;
      reconnectTimerRef.current = setTimeout(() => connect(), RECONNECT_INTERVAL_MS);
    };
    ws.onerror = () => {
      setStatus("closed");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "queue_update") {
          const pendingJobs = Array.isArray(msg.pending_jobs) ? msg.pending_jobs : [];
          jobsRef.current = pendingJobs;
          setJobs(pendingJobs);
          setTotalCount(typeof msg.total_count === "number" ? msg.total_count : pendingJobs.length);
          setQueueSummary(summaryFromMessage(msg, pendingJobs));
          setQueueUpdatedAt(Date.now());
          if (msg.heartbeat != null) setServerHeartbeat(msg.heartbeat);
          if (msg.duplicate_server_instance_id !== undefined) {
            setMultipleInstances(Boolean(msg.duplicate_server_instance_id));
          } else if (msg.multiple_instances !== undefined) {
            setMultipleInstances(Boolean(msg.multiple_instances));
          }
          if (Array.isArray(msg.backend_instances)) setBackendInstances(msg.backend_instances);
          if (msg.queue_paused !== undefined) setQueuePausedFromServer(Boolean(msg.queue_paused));
        }
        if (msg.type === "multi_instance_status") {
          if (msg.duplicate_server_instance_id !== undefined) {
            setMultipleInstances(Boolean(msg.duplicate_server_instance_id));
          } else if (msg.multiple_instances !== undefined) {
            setMultipleInstances(Boolean(msg.multiple_instances));
          }
          if (Array.isArray(msg.instances)) setBackendInstances(msg.instances);
        }
        if (msg.type === "heartbeat" && msg.value != null) {
          setServerHeartbeat(msg.value);
        }
        if (msg.type === "log_event") {
          setLogUpdatedAt(Date.now());
        }
        if (msg.type === "transcode_status_changed") {
          setTranscodeStatusChangedAt(Date.now());
          setTranscodeProgress(null);
        }
        if (msg.type === "transcode_progress" && Array.isArray(msg.transcodes)) {
          setTranscodeProgress(msg.transcodes);
        }
        if (msg.type === "video_updated") {
          const hasWatchPatch =
            msg.watch_is_finished !== undefined ||
            msg.watch_progress_seconds !== undefined ||
            msg.watch_progress_percent !== undefined;
          if (hasWatchPatch) {
            setVideoWatchPatches((prev) => ({
              ...prev,
              [msg.video_id]: {
                watch_is_finished: msg.watch_is_finished,
                watch_progress_seconds: msg.watch_progress_seconds,
                watch_progress_percent: msg.watch_progress_percent,
              },
            }));
          } else {
            setVideoUpdatedAt(Date.now());
            setVideoProgressOverrides((prev) => {
              const next = { ...prev };
              delete next[msg.video_id];
              return next;
            });
          }
        }
        if (msg.type === "video_progress" && msg.video_id != null) {
          setVideoProgressOverrides((prev) => ({
            ...prev,
            [msg.video_id]: {
              status: msg.status,
              status_percent_complete: msg.status_percent_complete,
            },
          }));
        }
        if (msg.type === "job_updated" && msg.job?.job_queue_id != null) {
          setJobOverrides((prev) => ({ ...prev, [msg.job.job_queue_id]: msg.job }));
        }
      } catch (_) {}
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [connect]);

  const refreshQueue = useCallback(() => {
    Promise.all([api.queue.summary(), api.queue.list({ limit: INITIAL_QUEUE_LIMIT })])
      .then(([summaryRes, listRes]) => {
        if (summaryRes) {
          setQueueSummary({
            running: summaryRes.running ?? [],
            running_count: summaryRes.running_count ?? 0,
            queued_count: summaryRes.queued_count ?? 0,
            runnable_count: summaryRes.runnable_count ?? 0,
            total_count: summaryRes.total_count ?? 0,
            errors_count: summaryRes.errors_count ?? 0,
            warnings_count: summaryRes.warnings_count ?? 0,
            scheduled_count: summaryRes.scheduled_count ?? 0,
            next_scheduled_job: summaryRes.next_scheduled_job ?? null,
            last_scheduled_job: summaryRes.last_scheduled_job ?? null,
            running_job: summaryRes.running?.length ? { job_queue_id: summaryRes.running[0].job_queue_id, job_type: summaryRes.running[0].job_type, status_percent_complete: summaryRes.running[0].status_percent_complete, video_id: summaryRes.running[0].video_id } : null,
            instances_summary: summaryRes.instances_summary ?? [],
            this_server_instance_id: summaryRes.this_server_instance_id ?? null,
            duplicate_server_instance_id: Boolean(summaryRes.duplicate_server_instance_id),
            instance_queue_paused: Boolean(summaryRes.instance_queue_paused),
          });
          setTotalCount(summaryRes.total_count ?? 0);
        }
        if (listRes?.items && Array.isArray(listRes.items)) {
          const pending = listRes.items.filter((j) => j.status !== "done" && j.status !== "cancelled");
          jobsRef.current = pending;
          setJobs(pending);
        }
        setQueueUpdatedAt(Date.now());
      })
      .catch(() => {});
  }, []);

  const clearVideoWatchPatches = useCallback((videoIds) => {
    if (!Array.isArray(videoIds) || videoIds.length === 0) return;
    setVideoWatchPatches((prev) => {
      const next = { ...prev };
      for (const id of videoIds) delete next[id];
      return next;
    });
  }, []);

  const addVideoWatchPatch = useCallback((videoId, patch) => {
    setVideoWatchPatches((prev) => ({
      ...prev,
      [videoId]: {
        ...prev[videoId],
        ...patch,
      },
    }));
  }, []);

  const refreshSummary = useCallback(() => {
    api.queue
      .summary()
      .then((res) => {
        if (res) {
          const running = res.running ?? [];
          setQueueSummary({
            running,
            running_count: res.running_count ?? 0,
            queued_count: res.queued_count ?? 0,
            runnable_count: res.runnable_count ?? 0,
            total_count: res.total_count ?? 0,
            errors_count: res.errors_count ?? 0,
            warnings_count: res.warnings_count ?? 0,
            scheduled_count: res.scheduled_count ?? 0,
            next_scheduled_job: res.next_scheduled_job ?? null,
            last_scheduled_job: res.last_scheduled_job ?? null,
            running_job: running.length
              ? { job_queue_id: running[0].job_queue_id, job_type: running[0].job_type, status_percent_complete: running[0].status_percent_complete, video_id: running[0].video_id }
              : null,
            instances_summary: res.instances_summary ?? [],
            this_server_instance_id: res.this_server_instance_id ?? null,
            duplicate_server_instance_id: Boolean(res.duplicate_server_instance_id),
            instance_queue_paused: Boolean(res.instance_queue_paused),
          });
          setTotalCount(res.total_count ?? 0);
          setQueueUpdatedAt(Date.now());
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  const value = {
    jobs,
    totalCount,
    queueSummary,
    status,
    videoUpdatedAt,
    videoWatchPatches,
    clearVideoWatchPatches,
    addVideoWatchPatch,
    queueUpdatedAt,
    logUpdatedAt,
    transcodeStatusChangedAt,
    transcodeProgress,
    videoProgressOverrides,
    jobOverrides,
    serverHeartbeat,
    reconnectedAt,
    multipleInstances,
    backendInstances,
    queuePausedFromServer,
    send,
    refreshQueue,
    refreshSummary,
  };

  return (
    <QueueWebSocketContext.Provider value={value}>
      {children}
    </QueueWebSocketContext.Provider>
  );
}

export function useQueueWebSocket() {
  const ctx = useContext(QueueWebSocketContext);
  if (!ctx) {
    throw new Error("useQueueWebSocket must be used within QueueWebSocketProvider");
  }
  return ctx;
}
