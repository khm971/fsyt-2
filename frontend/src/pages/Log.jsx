import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "../api/client";
import { cn, formatSmartTime } from "../lib/utils";
import { PaginationBar } from "../components/PaginationBar";
import { useToast } from "../context/ToastContext";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { LogEntryDetailsModal } from "../components/LogEntryDetailsModal";
import LogColumnFilterModal, {
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
  hasLogActiveFilters,
  logFiltersToApiParams,
} from "../components/LogColumnFilterModal";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Tooltip } from "../components/Tooltip";

const PAGE_SIZE = 200;
const LOG_VISIBLE_COLUMNS_KEY = "logVisibleColumns";
const LOG_FILTERS_KEY = "logFilters";

const SEVERITY_COLORS = {
  5: "text-gray-500",
  10: "text-gray-400",
  20: "text-blue-400",
  25: "text-cyan-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};

function loadStoredColumns() {
  try {
    const s = localStorage.getItem(LOG_VISIBLE_COLUMNS_KEY);
    if (!s) return [...DEFAULT_VISIBLE_COLUMNS];
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && parsed.v === 2 && Array.isArray(parsed.columns)) {
      const cols = parsed.columns;
      if (cols.length === 0) return [...DEFAULT_VISIBLE_COLUMNS];
      return cols;
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const merged = [...DEFAULT_VISIBLE_COLUMNS];
      for (const k of parsed) {
        if (!merged.includes(k)) merged.push(k);
      }
      return merged;
    }
  } catch (_) {}
  return [...DEFAULT_VISIBLE_COLUMNS];
}

function persistVisibleColumns(cols) {
  try {
    localStorage.setItem(LOG_VISIBLE_COLUMNS_KEY, JSON.stringify({ v: 2, columns: cols }));
  } catch (_) {}
}

function loadStoredFilters() {
  try {
    const s = localStorage.getItem(LOG_FILTERS_KEY);
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === "object") return { ...EMPTY_FILTERS, ...o };
    }
  } catch (_) {}
  return { ...EMPTY_FILTERS };
}

export default function Log({ setError }) {
  const toast = useToast();
  const [data, setData] = useState({ entries: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [ackingId, setAckingId] = useState(null);
  const [jobIdForModal, setJobIdForModal] = useState(null);
  const [videoIdForModal, setVideoIdForModal] = useState(null);
  const [channelIdForModal, setChannelIdForModal] = useState(null);
  const [eventLogIdForModal, setEventLogIdForModal] = useState(null);
  const [sortBy, setSortBy] = useState("time");
  const [sortOrder, setSortOrder] = useState("desc");
  const [visibleColumns, setVisibleColumns] = useState(loadStoredColumns);
  const [filters, setFilters] = useState(loadStoredFilters);
  const [showColumnFilterModal, setShowColumnFilterModal] = useState(false);

  const filterListParams = useMemo(() => logFiltersToApiParams(filters), [filters]);
  const activeFilters = hasLogActiveFilters(filters);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.log.list({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...filterListParams,
      });
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [setError, page, filterListParams, sortBy, sortOrder]);

  useEffect(() => {
    load();
  }, [load]);

  const persistFilters = (next) => {
    setFilters(next);
    try {
      localStorage.setItem(LOG_FILTERS_KEY, JSON.stringify(next));
    } catch (_) {}
  };

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

  const severityLabel = (sev) => {
    if (sev === 5) return "Low";
    if (sev === 10) return "Debug";
    if (sev === 20) return "Info";
    if (sev === 25) return "Notice";
    if (sev === 30) return "Warning";
    if (sev === 40) return "Error";
    if (sev === 50) return "Critical";
    return String(sev);
  };

  const paginationBarProps = {
    page: page + 1,
    totalPages,
    total: data.total,
    pageSize: PAGE_SIZE,
    itemLabel: "entries",
    onPageChange: (p) => setPage(p - 1),
    disabled: loading,
    onFilterClick: () => setShowColumnFilterModal(true),
    filterActive: activeFilters,
    onClearFilters: () => {
      const next = { ...EMPTY_FILTERS };
      persistFilters(next);
      setPage(0);
    },
  };

  const subsystemInSeverityCol = !visibleColumns.includes("subsystem");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Event log</h2>
        <p className="text-xs text-gray-500">
          Columns and filters: use the funnel next to the entry count (lowest level is in the dialog).
        </p>
      </div>

      <PaginationBar {...paginationBarProps} />

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {loading && data.entries.length === 0 && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Loading...</div>
        )}
        {!(loading && data.entries.length === 0) && (
          <div className="overflow-x-hidden">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  {visibleColumns.includes("time") && (
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
                  )}
                  {visibleColumns.includes("job_id") && (
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
                  )}
                  {visibleColumns.includes("video_id") && (
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
                              sortBy === "video_id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
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
                  )}
                  {visibleColumns.includes("channel_id") && (
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
                              sortBy === "channel_id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
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
                  )}
                  {visibleColumns.includes("server_instance_id") && (
                    <th className="px-4 py-2 text-gray-400">Inst</th>
                  )}
                  {visibleColumns.includes("severity") && (
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
                              sortBy === "severity" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
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
                  )}
                  {visibleColumns.includes("subsystem") && (
                    <th className="px-4 py-2">Subsystem</th>
                  )}
                  {visibleColumns.includes("message") && (
                    <th className="px-4 py-2 min-w-0">
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
                              sortBy === "message" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
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
                  )}
                  {visibleColumns.includes("event_log_id") && (
                    <th className="px-4 py-2">ID</th>
                  )}
                  {visibleColumns.includes("username") && (
                    <th className="px-4 py-2">User</th>
                  )}
                  {visibleColumns.includes("ack") && (
                    <th className="px-4 py-2">Ack</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.event_log_id} className="border-b border-gray-800/50">
                    {visibleColumns.includes("time") && (
                      <td className="px-4 py-2 text-gray-500 font-mono whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEventLogIdForModal(e.event_log_id)}
                          className="text-left hover:text-gray-300 rounded px-0.5 -mx-0.5 hover:bg-gray-800/50"
                        >
                          {formatSmartTime(e.event_time)}
                        </button>
                      </td>
                    )}
                    {visibleColumns.includes("job_id") && (
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
                    )}
                    {visibleColumns.includes("video_id") && (
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
                    )}
                    {visibleColumns.includes("channel_id") && (
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
                    )}
                    {visibleColumns.includes("server_instance_id") && (
                      <td className="px-4 py-2 font-mono text-xs text-gray-400">
                        {e.server_instance_id != null ? e.server_instance_id : "—"}
                      </td>
                    )}
                    {visibleColumns.includes("severity") && (
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn(SEVERITY_COLORS[e.severity] ?? "text-gray-300")}>
                            {severityLabel(e.severity)}
                          </span>
                          {e.subsystem && subsystemInSeverityCol && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                              {e.subsystem}
                            </span>
                          )}
                        </span>
                      </td>
                    )}
                    {visibleColumns.includes("subsystem") && (
                      <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[8rem]" title={e.subsystem || undefined}>
                        {e.subsystem ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                            {e.subsystem}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {visibleColumns.includes("message") && (
                      <td
                        className={cn(
                          "px-4 py-2 min-w-0",
                          e.message === "Application starting, database connected"
                            ? "text-green-400"
                            : SEVERITY_COLORS[e.severity] ?? "text-gray-300"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setEventLogIdForModal(e.event_log_id)}
                          className="text-left w-full max-w-full truncate text-start rounded px-0.5 -mx-0.5 hover:bg-gray-800/50"
                          title={e.message}
                        >
                          {e.message}
                        </button>
                      </td>
                    )}
                    {visibleColumns.includes("event_log_id") && (
                      <td className="px-4 py-2 font-mono text-gray-400 text-xs">{e.event_log_id}</td>
                    )}
                    {visibleColumns.includes("username") && (
                      <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[7rem]" title={e.username || undefined}>
                        {e.username || "—"}
                      </td>
                    )}
                    {visibleColumns.includes("ack") && (
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
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && data.entries.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No log entries match the current filters.</div>
        )}

        <PaginationBar {...paginationBarProps} />
      </div>

      {showColumnFilterModal && (
        <LogColumnFilterModal
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={(cols) => {
            setVisibleColumns(cols);
            persistVisibleColumns(cols);
          }}
          filters={filters}
          onFiltersChange={(newFilters) => {
            persistFilters(newFilters);
            setPage(0);
          }}
          onClose={() => setShowColumnFilterModal(false)}
        />
      )}

      {eventLogIdForModal != null && (
        <LogEntryDetailsModal
          eventLogId={eventLogIdForModal}
          onClose={() => setEventLogIdForModal(null)}
          setError={setError}
          toast={toast}
          onOpenJob={(id) => setJobIdForModal(id)}
          onOpenVideo={(id) => setVideoIdForModal(id)}
          onOpenChannel={(id) => setChannelIdForModal(id)}
          onAcknowledged={() => {
            setData((prev) => ({
              ...prev,
              entries: prev.entries.map((ent) =>
                ent.event_log_id === eventLogIdForModal ? { ...ent, acknowledged: true } : ent
              ),
            }));
          }}
        />
      )}
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
