import { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { getWsUrl } from "../api/client";

const RECONNECT_INTERVAL_MS = 5000;

const QueueWebSocketContext = createContext(null);

export function QueueWebSocketProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [videoUpdatedAt, setVideoUpdatedAt] = useState(0);
  const [queueUpdatedAt, setQueueUpdatedAt] = useState(0);
  const [logUpdatedAt, setLogUpdatedAt] = useState(0);
  const [transcodeStatusChangedAt, setTranscodeStatusChangedAt] = useState(0);
  const [transcodeProgress, setTranscodeProgress] = useState(null);
  const [videoProgressOverrides, setVideoProgressOverrides] = useState({});
  const [reconnectedAt, setReconnectedAt] = useState(0);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const wasClosedRef = useRef(false);

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
          setJobs(msg.jobs);
          setQueueUpdatedAt(Date.now());
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

  const value = {
    jobs,
    status,
    videoUpdatedAt,
    queueUpdatedAt,
    logUpdatedAt,
    transcodeStatusChangedAt,
    transcodeProgress,
    videoProgressOverrides,
    reconnectedAt,
    send,
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
