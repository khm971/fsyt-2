import { useState, useEffect } from "react";
import { api } from "../api/client";
import { cn, formatSmartTime } from "../lib/utils";
import { PaginationBar } from "../components/PaginationBar";
import { useToast } from "../context/ToastContext";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Tooltip } from "../components/Tooltip";

const PAGE_SIZE = 200;
const SEVERITY_COLORS = {
  5: "text-gray-500",
  10: "text-gray-400",
  20: "text-blue-400",
  25: "text-cyan-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};

// Lowest to highest (for "Lowest Level" dropdown and display)
const LOG_LEVELS = [
  { value: 5, label: "Low" },
  { value: 10, label: "Debug" },
  { value: 20, label: "Info" },
  { value: 25, label: "Notice" },
  { value: 30, label: "Warning" },
  { value: 40, label: "Error" },
  { value: 50, label: "Critical" },
];
const DEFAULT_LOWEST_LEVEL = 20; // INFO

export default function Log({ setError }) {
  const toast = useToast();
  const [data, setData] = useState({ entries: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [ackingId, setAckingId] = useState(null);
  const [lowestLevel, setLowestLevel] = useState(DEFAULT_LOWEST_LEVEL);
  const [jobIdForModal, setJobIdForModal] = useState(null);
  const [videoIdForModal, setVideoIdForModal] = useState(null);
  const [channelIdForModal, setChannelIdForModal] = useState(null);
  const [sortBy, setSortBy] = useState("time");
  const [sortOrder, setSortOrder] = useState("desc");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await api.log.list({
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          min_severity: lowestLevel,
          sort_by: sortBy,
          sort_order: sortOrder,
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
  }, [setError, page, lowestLevel, sortBy, sortOrder]);

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

  if (loading && data.entries.length === 0) {
    return <div className="text-gray-400 py-8">Loading...</div>;
  }

  const handleLowestLevelChange = (value) => {
    const level = Number(value);
    setLowestLevel(level);
    setPage(0);
  };

  const toggleSort = (column, defaultOrder = "desc") => {
    setPage(0);
    setSortBy((current) => {
      if (current === column) {
        setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortOrder(defaultOrder);
      return column;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Event log</h2>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <span>Lowest level</span>
          <select
            value={lowestLevel}
            onChange={(e) => handleLowestLevelChange(e.target.value)}
            className="input w-32"
          >
            {LOG_LEVELS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.total > 0 && (
        <PaginationBar
          page={page + 1}
          totalPages={totalPages}
          total={data.total}
          pageSize={PAGE_SIZE}
          itemLabel="entries"
          onPageChange={(p) => setPage(p - 1)}
          disabled={loading}
        />
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Time
                    <Tooltip
                      title={
                        sortBy === "time"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Time"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("time", "desc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "time" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "time" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Job
                    <Tooltip
                      title={
                        sortBy === "job_id"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Job ID"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("job_id", "desc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "job_id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "job_id" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Video
                    <Tooltip
                      title={
                        sortBy === "video_id"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Video ID"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("video_id", "desc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "video_id"
                            ? "text-blue-400"
                            : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "video_id" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Channel
                    <Tooltip
                      title={
                        sortBy === "channel_id"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Channel ID"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("channel_id", "desc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "channel_id"
                            ? "text-blue-400"
                            : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "channel_id" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Severity
                    <Tooltip
                      title={
                        sortBy === "severity"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Severity"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("severity", "desc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "severity"
                            ? "text-blue-400"
                            : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "severity" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    Message
                    <Tooltip
                      title={
                        sortBy === "message"
                          ? sortOrder === "asc"
                            ? "Sort ascending (click to toggle)"
                            : "Sort descending (click to toggle)"
                          : "Sort by Message"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort("message", "asc")}
                        className={cn(
                          "p-0.5 rounded hover:bg-gray-700",
                          sortBy === "message"
                            ? "text-blue-400"
                            : "text-gray-500 hover:text-gray-400"
                        )}
                      >
                        {sortBy === "message" ? (
                          sortOrder === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </th>
                <th className="px-4 py-2">Ack</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.event_log_id} className="border-b border-gray-800/50">
                  <td className="px-4 py-2 text-gray-500 font-mono whitespace-nowrap">
                    {formatSmartTime(e.event_time)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {e.job_id != null ? (
                      <button
                        type="button"
                        onClick={() => setJobIdForModal(e.job_id)}
                        className="text-blue-400 hover:text-blue-300 text-left"
                      >
                        {e.job_id}
                      </button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {e.video_id != null ? (
                      <button
                        type="button"
                        onClick={() => setVideoIdForModal(e.video_id)}
                        className="text-blue-400 hover:text-blue-300 text-left"
                      >
                        {e.video_id}
                      </button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {e.channel_id != null ? (
                      <button
                        type="button"
                        onClick={() => setChannelIdForModal(e.channel_id)}
                        className="text-blue-400 hover:text-blue-300 text-left"
                      >
                        {e.channel_id}
                      </button>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn(SEVERITY_COLORS[e.severity] ?? "text-gray-300")}>
                        {e.severity === 5 && "Low"}
                        {e.severity === 10 && "Debug"}
                        {e.severity === 20 && "Info"}
                        {e.severity === 25 && "Notice"}
                        {e.severity === 30 && "Warning"}
                        {e.severity === 40 && "Error"}
                        {e.severity === 50 && "Critical"}
                      </span>
                      {e.subsystem && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                          {e.subsystem}
                        </span>
                      )}
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

        {data.total > 0 && (
          <PaginationBar
            page={page + 1}
            totalPages={totalPages}
            total={data.total}
            pageSize={PAGE_SIZE}
            itemLabel="entries"
            onPageChange={(p) => setPage(p - 1)}
            disabled={loading}
          />
        )}
      </div>

      <VideoDetailsModal
        videoId={videoIdForModal}
        onClose={() => setVideoIdForModal(null)}
        setError={setError}
        toast={toast}
        onOpenJobDetails={(jobId) => setJobIdForModal(jobId)}
        onOpenChannelEdit={(channelId) => setChannelIdForModal(channelId)}
      />
      <JobDetailsModal
        jobId={jobIdForModal}
        onClose={() => setJobIdForModal(null)}
        setError={setError}
        toast={toast}
      />
      <ChannelEditModal
        channelId={channelIdForModal}
        onClose={() => setChannelIdForModal(null)}
        setError={setError}
      />
    </div>
  );
}
