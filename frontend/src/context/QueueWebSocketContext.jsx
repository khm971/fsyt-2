import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getWsUrl, api } from "../api/client";

const RECONNECT_INTERVAL_MS = 5000;
const INITIAL_QUEUE_LIMIT = 500;

function isInProgress(status) {
  return status != null && status !== "new" && status !== "done" && status !== "cancelled";
}

function summaryFromJobs(jobsList) {
  const list = jobsList || [];
  const running = list.filter((j) => isInProgress(j.status));
  const queued = list.filter((j) => j.status === "new");
  const errors = list.filter((j) => j.error_flag && !j.acknowledge_flag);
  const warnings = list.filter((j) => j.warning_flag && !j.acknowledge_flag);
  return {
    running,
    running_count: running.length,
    queued_count: queued.length,
    total_count: list.length,
    errors_count: errors.length,
    warnings_count: warnings.length,
  };
}

const QueueWebSocketContext = createContext(null);

export function QueueWebSocketProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [queueSummary, setQueueSummary] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [videoUpdatedAt, setVideoUpdatedAt] = useState(0);
  const [queueUpdatedAt, setQueueUpdatedAt] = useState(0);
  const [logUpdatedAt, setLogUpdatedAt] = useState(0);
  const [transcodeStatusChangedAt, setTranscodeStatusChangedAt] = useState(0);
  const [transcodeProgress, setTranscodeProgress] = useState(null);
  const [videoProgressOverrides, setVideoProgressOverrides] = useState({});
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
        if (msg.type === "queue_update" && Array.isArray(msg.jobs)) {
          const hasJobs = msg.jobs.length > 0;
          const hadJobs = jobsRef.current.length > 0;
          if (hasJobs || !hadJobs) {
            jobsRef.current = msg.jobs;
            setJobs(msg.jobs);
            setTotalCount(typeof msg.total_count === "number" ? msg.total_count : msg.jobs.length);
          }
          const summary = summaryFromJobs(msg.jobs);
          if (typeof msg.total_count === "number") summary.total_count = msg.total_count;
          setQueueSummary(summary);
          setQueueUpdatedAt(Date.now());
          if (msg.heartbeat != null) setServerHeartbeat(msg.heartbeat);
          if (msg.multiple_instances !== undefined) setMultipleInstances(Boolean(msg.multiple_instances));
          if (Array.isArray(msg.backend_instances)) setBackendInstances(msg.backend_instances);
          if (msg.queue_paused !== undefined) setQueuePausedFromServer(Boolean(msg.queue_paused));
        }
        if (msg.type === "multi_instance_status" && msg.multiple_instances !== undefined) {
          setMultipleInstances(Boolean(msg.multiple_instances));
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
          setVideoUpdatedAt(Date.now());
          setVideoProgressOverrides((prev) => {
            const next = { ...prev };
            delete next[msg.video_id];
            return next;
          });
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
    api.queue
      .list({ limit: INITIAL_QUEUE_LIMIT })
      .then((res) => {
        if (res?.items && Array.isArray(res.items)) {
          jobsRef.current = res.items;
          setJobs(res.items);
          setTotalCount(typeof res.total === "number" ? res.total : res.items.length);
          setQueueSummary(summaryFromJobs(res.items));
          setQueueUpdatedAt(Date.now());
        }
      })
      .catch(() => {});
  }, []);

  const refreshSummary = useCallback(() => {
    api.queue
      .summary()
      .then((res) => {
        if (res) {
          setQueueSummary({
            running: res.running ?? [],
            running_count: res.running_count ?? 0,
            queued_count: res.queued_count ?? 0,
            total_count: res.total_count ?? 0,
            errors_count: res.errors_count ?? 0,
            warnings_count: res.warnings_count ?? 0,
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
    queueUpdatedAt,
    logUpdatedAt,
    transcodeStatusChangedAt,
    transcodeProgress,
    videoProgressOverrides,
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
