import { useState, useEffect } from "react";
import { api } from "../api/client";
import { cn, formatSmartTime } from "../lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 50;
const SEVERITY_COLORS = {
  5: "text-gray-500",
  10: "text-gray-400",
  20: "text-blue-400",
  25: "text-cyan-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};

export default function Log({ setError }) {
  const [data, setData] = useState({ entries: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [ackingId, setAckingId] = useState(null);
  const [showLowLevel, setShowLowLevel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await api.log.list({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          min_severity: showLowLevel ? undefined : 10,
        });
        if (cancelled) return;
        setData(res);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [setError, page, showLowLevel]);

  const handleAck = async (eventLogId) => {
    setAckingId(eventLogId);
    try {
      await api.log.acknowledge(eventLogId);
      setData((prev) => ({
        ...prev,
        entries: prev.entries.map((e) =>
          e.event_log_id === eventLogId ? { ...e, acknowledged: true } : e
        ),
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setAckingId(null);
    }
  };

  const totalPages = Math.ceil(data.total / PAGE_SIZE) || 1;
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

  if (loading && data.entries.length === 0) {
    return <div className="text-gray-400 py-8">Loading...</div>;
  }

  const handleShowLowLevelChange = (checked) => {
    setShowLowLevel(checked);
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Event log</h2>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showLowLevel}
            onChange={(e) => handleShowLowLevelChange(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
          />
          Include low-level messages
        </label>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Job</th>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Channel</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Message</th>
                <th className="px-4 py-2">Ack</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.event_log_id} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 text-gray-500 font-mono whitespace-nowrap">
                    {formatSmartTime(e.event_time)}
                  </td>
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                    {e.job_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                    {e.video_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                    {e.channel_id ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={cn(SEVERITY_COLORS[e.severity] ?? "text-gray-300")}>
                      {e.severity === 5 && "Low"}
                      {e.severity === 10 && "Debug"}
                      {e.severity === 20 && "Info"}
                      {e.severity === 25 && "Notice"}
                      {e.severity === 30 && "Warning"}
                      {e.severity === 40 && "Error"}
                      {e.severity === 50 && "Critical"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2",
                      e.message === "Application starting, database connected"
                        ? "text-green-400"
                        : SEVERITY_COLORS[e.severity] ?? "text-gray-300"
                    )}
                  >
                    {e.message}
                  </td>
                  <td className="px-4 py-2">
                    {e.acknowledged ? (
                      <span className="text-green-500">Yes</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAck(e.event_log_id)}
                        disabled={ackingId === e.event_log_id}
                        className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50"
                      >
                        {ackingId === e.event_log_id ? "..." : "Ack"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 text-gray-400 text-sm">
          <span>
            {data.entries.length === 0
              ? `Showing 0 of ${data.total}`
              : `Showing ${data.offset + 1}–${data.offset + data.entries.length} of ${data.total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!canPrev || loading}
              className="p-1 rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={!canNext || loading}
              className="p-1 rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
