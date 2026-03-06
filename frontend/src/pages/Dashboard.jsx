import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn, formatSmartTime, formatDateTime } from "../lib/utils";
import { Activity, ScrollText } from "lucide-react";

function isBoolean(val) {
  return val === "true" || val === "false";
}

function isNumeric(val) {
  if (val == null || val === "") return false;
  return /^-?\d+(\.\d+)?$/.test(String(val).trim());
}

function isDatestamp(val) {
  if (val == null || val === "") return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(val));
}

function formatKey(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SEVERITY_COLORS = {
  10: "text-gray-400",
  20: "text-blue-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};

export default function Dashboard({ setError }) {
  const [control, setControl] = useState({});
  const [logEntries, setLogEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const { jobs, status: wsStatus, queueUpdatedAt } = useQueueWebSocket();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [list, recent] = await Promise.all([
          api.control.list(),
          api.log.recent(10),
        ]);
        if (cancelled) return;
        const map = {};
        list.forEach((c) => {
          map[c.key] = c;
        });
        setControl(map);
        setLogEntries(recent);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [setError, queueUpdatedAt]);

  const [savingKey, setSavingKey] = useState(null);
  const [editValues, setEditValues] = useState({});

  const handleControlChange = (key, newValue) => {
    setEditValues((prev) => ({ ...prev, [key]: newValue }));
  };

  const handleControlSave = async (key) => {
    const c = control[key];
    const displayVal = editValues[key] !== undefined ? editValues[key] : c?.value;
    const strVal =
      typeof displayVal === "boolean"
        ? String(displayVal)
        : String(displayVal ?? "");
    setSavingKey(key);
    try {
      await api.control.set(key, strVal);
      setControl((prev) => ({
        ...prev,
        [key]: { ...prev[key], value: strVal, last_update: new Date().toISOString() },
      }));
      setEditValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  };

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

  const heartbeat = control.server_heartbeat?.value;
  const queuePaused = control.queue_paused?.value === "true";
  const chargeableErrorsLockout = control.chargeable_errors_lockout?.value === "true";
  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "new");
  const errors = jobs.filter((j) => j.error_flag);

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
          <div className="text-gray-400 text-sm mb-1">Jobs</div>
          <div className="text-white">
            {running.length} running, {queued.length} queued
            {errors.length > 0 && (
              <span className="text-red-400 ml-1">({errors.length} errors)</span>
            )}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm mb-1">Last heartbeat</div>
          <div className="text-white text-sm font-mono">
            {heartbeat ? new Date(heartbeat).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Control values</h3>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 py-1 border-b border-gray-800 text-gray-500 text-xs">
            <div className="w-48 shrink-0">Key</div>
            <div className="flex-1 min-w-0">Value</div>
            <div className="w-36 shrink-0">Updated</div>
          </div>
          {Object.entries(control).map(([key, c]) => {
            const val = c?.value ?? "";
            const displayVal = editValues[key] !== undefined ? editValues[key] : val;
            const readOnly = isDatestamp(val);
            const isBool = isBoolean(val);
            const isNum = isNumeric(val);

            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-800 last:border-0"
              >
                <div className="w-48 shrink-0">
                  <span className="text-gray-400 text-sm">{formatKey(key)}</span>
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {readOnly ? (
                    <span className="text-gray-300 text-sm font-mono">
                      {formatDateTime(val)}
                    </span>
                  ) : isBool ? (
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={displayVal === "true"}
                        onChange={(e) =>
                          handleControlChange(key, e.target.checked ? "true" : "false")
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 peer-focus:ring-2 peer-focus:ring-blue-500/50" />
                      <div className="absolute left-0.5 top-1 bg-white w-3.5 h-3.5 rounded-full transition-all peer-checked:translate-x-4" />
                    </label>
                  ) : isNum ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9.-]*"
                      value={displayVal}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^-?\d*\.?\d*$/.test(v))
                          handleControlChange(key, v);
                      }}
                      onBlur={() => handleControlSave(key)}
                      onKeyDown={(e) => e.key === "Enter" && handleControlSave(key)}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white font-mono w-24 focus:border-blue-500 focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      value={displayVal}
                      onChange={(e) => handleControlChange(key, e.target.value)}
                      onBlur={() => handleControlSave(key)}
                      onKeyDown={(e) => e.key === "Enter" && handleControlSave(key)}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white flex-1 min-w-0 focus:border-blue-500 focus:outline-none"
                    />
                  )}
                  {!readOnly && (editValues[key] !== undefined || (isBool && displayVal !== val)) && (
                    <button
                      type="button"
                      onClick={() => handleControlSave(key)}
                      disabled={savingKey === key}
                      className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50 shrink-0"
                    >
                      {savingKey === key ? "..." : "Save"}
                    </button>
                  )}
                </div>
                <div className="text-gray-500 text-xs shrink-0 w-36">
                  {c?.last_update ? formatDateTime(c.last_update) : "—"}
                </div>
              </div>
            );
          })}
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
