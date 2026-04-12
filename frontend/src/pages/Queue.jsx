import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import { Pause, Play, Check, X, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, AlertTriangle, CalendarClock, CheckCircle, Undo2, MessageCircle, Clock, Filter, CheckCheck } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import { PaginationBar } from "../components/PaginationBar";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import QueueColumnFilterModal, { DEFAULT_VISIBLE_COLUMNS, EMPTY_FILTERS } from "../components/QueueColumnFilterModal";
import {
  JOB_TYPES,
  jobTypeUsesVideoId,
  jobTypeUsesChannelId,
  getVideoIdRequirement,
  getChannelIdRequirement,
  getParameterConfig,
  isJobTypeImplemented,
  validateJobParams,
} from "../lib/jobTypes";

const QUEUE_VISIBLE_COLUMNS_KEY = "queueVisibleColumns";
const QUEUE_FILTERS_KEY = "queueFilters";

function filtersToParams(filters) {
  const p = {};
  if (filters.status) p.status = filters.status;
  if (filters.job_type) p.job_type = filters.job_type;
  if (filters.video_id !== "" && filters.video_id != null) p.video_id = Number(filters.video_id);
  if (filters.channel_id !== "" && filters.channel_id != null) p.channel_id = Number(filters.channel_id);
  if (filters.scheduled_future !== null && filters.scheduled_future !== undefined) p.scheduled_future = filters.scheduled_future;
  if (filters.has_error !== null && filters.has_error !== undefined) p.error_flag = filters.has_error;
  if (filters.has_warning !== null && filters.has_warning !== undefined) p.warning_flag = filters.has_warning;
  if (filters.acknowledged !== null && filters.acknowledged !== undefined) p.acknowledge_flag = filters.acknowledged;
  if (filters.record_created_from) p.record_created_from = filters.record_created_from;
  if (filters.record_created_to) p.record_created_to = filters.record_created_to;
  if (filters.last_update_from) p.last_update_from = filters.last_update_from;
  if (filters.last_update_to) p.last_update_to = filters.last_update_to;
  if (filters.run_after_from) p.run_after_from = filters.run_after_from;
  if (filters.run_after_to) p.run_after_to = filters.run_after_to;
  if (filters.target_server_instance_id !== "" && filters.target_server_instance_id != null) {
    const tid = parseInt(String(filters.target_server_instance_id), 10);
    if (Number.isFinite(tid) && tid >= 1) p.target_server_instance_id = tid;
  }
  return p;
}

function hasActiveFilters(filters) {
  return !!(
    filters.status ||
    filters.job_type ||
    (filters.video_id !== "" && filters.video_id != null) ||
    (filters.channel_id !== "" && filters.channel_id != null) ||
    filters.scheduled_future !== null ||
    filters.has_error !== null ||
    filters.has_warning !== null ||
    filters.acknowledged !== null ||
    filters.record_created_from ||
    filters.record_created_to ||
    filters.last_update_from ||
    filters.last_update_to ||
    filters.run_after_from ||
    filters.run_after_to ||
    (filters.target_server_instance_id !== "" && filters.target_server_instance_id != null)
  );
}

function loadStoredColumns() {
  try {
    const s = localStorage.getItem(QUEUE_VISIBLE_COLUMNS_KEY);
    if (s) {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (_) {}
  return [...DEFAULT_VISIBLE_COLUMNS];
}

function loadStoredFilters() {
  try {
    const s = localStorage.getItem(QUEUE_FILTERS_KEY);
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === "object") return { ...EMPTY_FILTERS, ...o };
    }
  } catch (_) {}
  return { ...EMPTY_FILTERS };
}

/**
 * Dashboard / deep links: ?filter=… and/or ?target_server_instance_id=…
 * Apply on first paint so the list request matches the link (avoids effect-order race).
 */
function queueUrlFilters(searchParams) {
  const tidRaw = searchParams.get("target_server_instance_id");
  let targetPart = null;
  if (tidRaw != null && tidRaw !== "") {
    const n = parseInt(tidRaw, 10);
    if (Number.isFinite(n) && n >= 1) targetPart = String(n);
  }
  const filter = searchParams.get("filter");
  let base = null;
  if (filter === "scheduled") base = { ...EMPTY_FILTERS, scheduled_future: true };
  else if (filter === "queued") base = { ...EMPTY_FILTERS, scheduled_future: false, status: "new" };
  else if (filter === "warnings") base = { ...EMPTY_FILTERS, has_warning: true, acknowledged: false };
  else if (filter === "errors") base = { ...EMPTY_FILTERS, has_error: true, acknowledged: false };
  if (targetPart != null) {
    base = base
      ? { ...base, target_server_instance_id: targetPart }
      : { ...EMPTY_FILTERS, target_server_instance_id: targetPart };
  }
  return base;
}

/** Remove error/warning/ack filters so bulk-ack can apply its own on top of channel, dates, status, etc. */
function stripAckListFlagParams(params) {
  const p = { ...params };
  delete p.error_flag;
  delete p.warning_flag;
  delete p.acknowledge_flag;
  return p;
}

/** Paginate through queue list API (max 500 per request) and collect job_queue_id. */
async function fetchAllJobQueueIdsForParams(listParams) {
  const limit = 500;
  const ids = [];
  let offset = 0;
  while (true) {
    const res = await api.queue.list({ ...listParams, limit, offset });
    const items = res.items || [];
    for (const j of items) ids.push(j.job_queue_id);
    if (items.length < limit) break;
    offset += limit;
  }
  return ids;
}

export default function Queue({ setError }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const PAGE_SIZE = 500;
  const { jobs, totalCount, status: wsStatus, queueUpdatedAt, videoProgressOverrides, jobOverrides, refreshQueue } = useQueueWebSocket();
  const [control, setControl] = useState({});
  const [paused, setPaused] = useState(false);
  const [addForm, setAddForm] = useState({
    job_type: "get_metadata",
    video_id: "",
    channel_id: "",
    parameter: "",
    priority: 50,
    target_server_instance_id: "1",
    queue_all_target_all_downloaders: false,
  });
  const [serverInstances, setServerInstances] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [showAckAllModal, setShowAckAllModal] = useState(false);
  const [showColumnFilterModal, setShowColumnFilterModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(loadStoredColumns);
  const [filters, setFilters] = useState(() => {
    const fromUrl = queueUrlFilters(searchParams);
    return fromUrl != null ? fromUrl : loadStoredFilters();
  });
  const [listTotal, setListTotal] = useState(0);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageJobs, setPageJobs] = useState([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [listNonce, setListNonce] = useState(0);
  const [channels, setChannels] = useState([]);

  const filterParams = useMemo(() => filtersToParams(filters), [filters]);
  const activeFilters = useMemo(() => hasActiveFilters(filters), [filters]);
  const effectiveTotal = activeFilters ? listTotal : totalCount;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / PAGE_SIZE));

  useEffect(() => {
    const next = queueUrlFilters(searchParams);
    if (!next) return;
    setFilters((prev) => {
      const sameApiParams =
        JSON.stringify(filtersToParams(prev)) === JSON.stringify(filtersToParams(next));
      return sameApiParams ? prev : next;
    });
    setPage(1);
    try {
      localStorage.setItem(QUEUE_FILTERS_KEY, JSON.stringify(next));
    } catch (_) {}
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const sortableColumns = ["id", "priority", "job_type", "video_id", "status", "record_created", "last_update"];
  const renderSortTh = (sortKey, label, defaultOrder = "desc") => (
    <th className="px-4 py-3 font-medium" key={sortKey}>
      <div className="flex items-center gap-1">
        {label}
        {sortableColumns.includes(sortKey) && (
          <Tooltip title={sortBy === sortKey ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : `Sort by ${label}`} side="top">
            <button
              type="button"
              onClick={() => {
                setPage(1);
                if (sortBy === sortKey) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                else {
                  setSortBy(sortKey);
                  setSortOrder(defaultOrder);
                }
              }}
              className={cn(
                "p-0.5 rounded hover:bg-gray-700",
                sortBy === sortKey ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
              )}
            >
              {sortBy === sortKey ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
            </button>
          </Tooltip>
        )}
      </div>
    </th>
  );

  const displayJobs = useMemo(
    () => pageJobs.map((j) => (jobOverrides[j.job_queue_id] ? { ...j, ...jobOverrides[j.job_queue_id] } : j)),
    [pageJobs, jobOverrides]
  );

  useEffect(() => {
    if (page === 1 && jobs.length === 0 && totalCount > 0 && refreshQueue) refreshQueue();
  }, [page, jobs.length, totalCount, refreshQueue]);

  useEffect(() => {
    if (showAdd) {
      api.channels.list().then(setChannels).catch(() => setChannels([]));
      api.serverInstances
        .list()
        .then(setServerInstances)
        .catch(() => setServerInstances([]));
    }
  }, [showAdd]);

  useEffect(() => {
    const ac = new AbortController();
    setPageLoading(true);
    api.queue
      .list({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort_by: sortBy,
        sort_order: sortOrder,
        ...filterParams,
        signal: ac.signal,
      })
      .then((res) => {
        setPageJobs(res.items || []);
        if (Object.keys(filterParams).length > 0) setListTotal(res.total ?? 0);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setPageLoading(false);
      });
    return () => ac.abort();
  }, [page, sortBy, sortOrder, filterParams, listNonce, setError]);

  useEffect(() => {
    if (effectiveTotal > 0 && page > totalPages) setPage(totalPages);
  }, [effectiveTotal, totalPages, page]);

  const unackCounts = useMemo(() => {
    const unack = displayJobs.filter((j) => !j.acknowledge_flag && (j.error_flag || j.warning_flag));
    return {
      warningsOnly: unack.filter((j) => j.warning_flag && !j.error_flag).length,
      errorsOnly: unack.filter((j) => j.error_flag && !j.warning_flag).length,
      both: unack.filter((j) => j.warning_flag && j.error_flag).length,
      total: unack.length,
    };
  }, [displayJobs]);


  useEffect(() => {
    api.control
      .list()
      .then((list) => {
        const map = {};
        list.forEach((c) => (map[c.key] = c));
        setControl(map);
        setPaused(map.queue_paused?.value === "true");
      })
      .catch((e) => setError(e.message));
  }, [queueUpdatedAt]);

  const lockedOut = control.chargeable_errors_lockout?.value === "true";

  const togglePause = async () => {
    try {
      const newVal = !paused;
      await api.control.set("queue_paused", newVal ? "true" : "false");
      setPaused(newVal);
      toast.addToast(newVal ? "Queue paused" : "Queue resumed", "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const setAcknowledge = async (id, acknowledged) => {
    try {
      if (acknowledged) {
        await api.queue.acknowledge(id);
        toast.addToast(`Job ${id} acknowledged`, "success");
      } else {
        await api.queue.unacknowledge(id);
        toast.addToast(`Job ${id} unacknowledged`, "success");
      }
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const cancel = async (id) => {
    try {
      await api.queue.cancel(id);
      toast.addToast(`Job ${id} cancelled`, "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const acknowledgeAll = async (mode) => {
    setShowAckAllModal(false);
    const base = stripAckListFlagParams(filterParams);
    const sortParams = { sort_by: sortBy, sort_order: sortOrder };
    let ids = [];
    try {
      if (mode === "warnings") {
        ids = await fetchAllJobQueueIdsForParams({
          ...sortParams,
          ...base,
          acknowledge_flag: false,
          warning_flag: true,
        });
      } else if (mode === "errors") {
        ids = await fetchAllJobQueueIdsForParams({
          ...sortParams,
          ...base,
          acknowledge_flag: false,
          error_flag: true,
        });
      } else {
        const idSet = new Set();
        const w = await fetchAllJobQueueIdsForParams({
          ...sortParams,
          ...base,
          acknowledge_flag: false,
          warning_flag: true,
        });
        const e = await fetchAllJobQueueIdsForParams({
          ...sortParams,
          ...base,
          acknowledge_flag: false,
          error_flag: true,
        });
        w.forEach((id) => idSet.add(id));
        e.forEach((id) => idSet.add(id));
        ids = [...idSet];
      }
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
      return;
    }
    if (ids.length === 0) {
      toast.addToast("No jobs to acknowledge", "info");
      return;
    }
    const CHUNK = 40;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await Promise.all(slice.map((id) => api.queue.acknowledge(id)));
      }
      toast.addToast(`Acknowledged ${ids.length} job${ids.length === 1 ? "" : "s"}`, "success");
      setListNonce((n) => n + 1);
      refreshQueue?.();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const addJob = async () => {
    const err = validateJobParams(addForm.job_type, {
      video_id: addForm.video_id,
      channel_id: addForm.channel_id,
      parameter: addForm.parameter,
    });
    if (err) {
      toast.addToast(err, "error");
      return;
    }
    try {
      const body = {
        job_type: addForm.job_type,
        priority: addForm.priority,
      };
      if (jobTypeUsesVideoId(addForm.job_type) && addForm.video_id) {
        body.video_id = parseInt(addForm.video_id, 10);
      }
      if (jobTypeUsesChannelId(addForm.job_type) && addForm.channel_id) {
        body.channel_id = parseInt(addForm.channel_id, 10);
      }
      const paramConfig = getParameterConfig(addForm.job_type);
      if (paramConfig && addForm.parameter.trim()) {
        body.parameter = addForm.parameter.trim();
      }
      body.target_server_instance_id = parseInt(addForm.target_server_instance_id, 10) || 1;
      if (addForm.job_type === "queue_all_downloads") {
        body.queue_all_target_all_downloaders = addForm.queue_all_target_all_downloaders;
      }
      const j = await api.queue.create(body);
      setShowAdd(false);
      const extra = [];
      if (j.video_id) extra.push(`video ${j.video_id}`);
      if (j.channel_id) extra.push(`channel ${j.channel_id}`);
      toast.addToast(`Job queued: ${j.job_type} (ID ${j.job_queue_id}${extra.length ? ", " + extra.join(", ") : ""})`, "info");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      {lockedOut && (
        <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-red-400 font-semibold">Queue locked out</span>
          <span className="text-red-300 text-sm">
            Too many charged errors. The job processor has stopped.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Job queue</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                wsStatus === "open" && "bg-green-500",
                wsStatus === "connecting" && "bg-yellow-500 animate-pulse",
                wsStatus === "closed" && "bg-red-500"
              )}
            />
            <span className="text-sm text-gray-400">
              {wsStatus === "open" && "WebSocket open"}
              {wsStatus === "connecting" && "WebSocket connecting"}
              {wsStatus === "closed" && "WebSocket closed"}
              {!["open", "connecting", "closed"].includes(wsStatus) && "WebSocket " + (wsStatus || "unknown")}
            </span>
            {lockedOut && (
              <span className="text-red-400 text-sm font-medium">Locked out</span>
            )}
          </div>
          <button
            type="button"
            onClick={togglePause}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
              paused
                ? "bg-yellow-600 hover:bg-yellow-500 text-white"
                : "bg-gray-700 hover:bg-gray-600 text-gray-200"
            )}
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {paused ? "Resume" : "Pause"}
          </button>
          {unackCounts.total > 0 && (
            <button
              type="button"
              onClick={() => setShowAckAllModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white"
            >
              <CheckCheck className="w-4 h-4" />
              Acknowledge all
            </button>
          )}
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary">
            Add job
          </button>
        </div>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={effectiveTotal}
        pageSize={PAGE_SIZE}
        itemLabel="jobs"
        onPageChange={setPage}
        disabled={pageLoading}
        onFilterClick={() => setShowColumnFilterModal(true)}
        filterActive={activeFilters}
        onClearFilters={() => {
          const next = { ...EMPTY_FILTERS };
          setFilters(next);
          setPage(1);
          try {
            localStorage.setItem(QUEUE_FILTERS_KEY, JSON.stringify(next));
          } catch (_) {}
        }}
      />

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        {pageLoading && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
            Loading page…
          </div>
        )}
        {!pageLoading && (
        <>
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              {renderSortTh("id", "ID")}
              {visibleColumns.includes("priority") && renderSortTh("priority", "Priority")}
              {renderSortTh("job_type", "Type", "asc")}
              {visibleColumns.includes("target_server_instance_id") && (
                <th className="px-4 py-3 font-medium" key="target_server_instance_id">
                  Inst
                </th>
              )}
              {visibleColumns.includes("video_id") && renderSortTh("video_id", "Video ID")}
              {visibleColumns.includes("channel_id") && <th className="px-4 py-3 font-medium" key="channel_id">Channel ID</th>}
              {visibleColumns.includes("status") && renderSortTh("status", "Status", "asc")}
              {visibleColumns.includes("record_created") && renderSortTh("record_created", "Record Created")}
              {visibleColumns.includes("last_update") && renderSortTh("last_update", "As of")}
              {visibleColumns.includes("run_after") && <th className="px-4 py-3 font-medium" key="run_after">Run after</th>}
              {visibleColumns.includes("parameter") && <th className="px-4 py-3 font-medium" key="parameter">Parameter</th>}
              {visibleColumns.includes("scheduler_entry_id") && <th className="px-4 py-3 font-medium" key="scheduler_entry_id">Scheduler</th>}
              <th className="px-4 py-3 font-medium" key="flags">Flags</th>
              <th className="px-4 py-3 font-medium w-36" key="actions">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {displayJobs.map((j) => (
              <tr
                key={j.job_queue_id}
                className={cn(
                  "hover:bg-gray-800/30",
                  !j.acknowledge_flag && j.error_flag && "bg-red-950/25",
                  !j.acknowledge_flag && !j.error_flag && j.warning_flag && "bg-yellow-950/25"
                )}
              >
                <td className="px-4 py-2 font-mono text-gray-300">
                  <button
                    type="button"
                    onClick={() => setJobQueueIdForModal(j.job_queue_id)}
                    className="text-left hover:text-blue-400"
                  >
                    {j.job_queue_id}
                  </button>
                </td>
                {visibleColumns.includes("priority") && (
                  <td className="px-4 py-2 font-mono text-gray-400">{j.priority ?? "—"}</td>
                )}
                <td className="px-4 py-2 text-white">
                  <button
                    type="button"
                    onClick={() => setJobQueueIdForModal(j.job_queue_id)}
                    className="text-left hover:text-blue-400"
                  >
                    {j.job_type}
                  </button>
                </td>
                {visibleColumns.includes("target_server_instance_id") && (
                  <td className="px-4 py-2 font-mono text-gray-400">
                    {j.target_server_instance_id ?? 1}
                    {j.queue_all_target_all_downloaders ? (
                      <span className="text-cyan-500/90 text-xs ml-0.5" title="Target all downloaders">
                        *
                      </span>
                    ) : null}
                  </td>
                )}
                {visibleColumns.includes("video_id") && (
                  <td className="px-4 py-2 font-mono">
                    {j.video_id != null ? (
                      <Tooltip title="Video details" side="top" wrap>
                        <button
                          type="button"
                          onClick={() => setVideoIdForDetails(j.video_id)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {j.video_id}
                        </button>
                      </Tooltip>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                )}
                {visibleColumns.includes("channel_id") && (
                  <td className="px-4 py-2 font-mono text-gray-400">{j.channel_id ?? "—"}</td>
                )}
                {visibleColumns.includes("status") && (
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-0.5">
                      <Tooltip title={j.status_message || ""} side="top">
                        <span
                          className={cn(
                            "inline-block",
                            (() => {
                              const displayStatus =
                                j.video_id != null && videoProgressOverrides[j.video_id]?.status != null
                                  ? videoProgressOverrides[j.video_id].status
                                  : j.status;
                              if (displayStatus === "done") return "text-green-400";
                              if (displayStatus === "new") return "text-blue-400";
                              if (displayStatus === "error") return "text-red-400";
                              if (displayStatus === "cancelled") return "text-white";
                              return "text-fuchsia-400";
                            })()
                          )}
                        >
                          {j.video_id != null && videoProgressOverrides[j.video_id]?.status != null
                            ? videoProgressOverrides[j.video_id].status
                            : j.status}
                        </span>
                      </Tooltip>
                      {(() => {
                        const percent =
                          j.video_id != null && videoProgressOverrides[j.video_id]?.status_percent_complete != null
                            ? videoProgressOverrides[j.video_id].status_percent_complete
                            : j.status_percent_complete;
                        return percent != null && percent >= 1 && percent <= 99 ? (
                          <div className="w-full max-w-[120px] h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(0, Number(percent) || 0))}%` }}
                            />
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </td>
                )}
                {visibleColumns.includes("record_created") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {formatDateTimeWithSeconds(j.record_created)}
                  </td>
                )}
                {visibleColumns.includes("last_update") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {formatDateTimeWithSeconds(j.last_update)}
                  </td>
                )}
                {visibleColumns.includes("run_after") && (
                  <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {j.run_after ? formatDateTimeWithSeconds(j.run_after) : "—"}
                  </td>
                )}
                {visibleColumns.includes("parameter") && (
                  <td className="px-4 py-2 text-gray-400 text-xs max-w-[12rem] truncate" title={j.parameter ?? ""}>
                    {j.parameter ?? "—"}
                  </td>
                )}
                {visibleColumns.includes("scheduler_entry_id") && (
                  <td className="px-4 py-2 font-mono text-gray-400">{j.scheduler_entry_id ?? "—"}</td>
                )}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1 flex-nowrap">
                    {j.status_message && (
                      <Tooltip title={j.status_message} side="top">
                        <span className="inline-flex text-purple-400">
                          <MessageCircle className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                    {j.error_flag && (
                      <Tooltip title="Error" side="top">
                        <span className="inline-flex text-red-400">
                          <AlertCircle className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                    {j.warning_flag && (
                      <Tooltip title="Warning" side="top">
                        <span className="inline-flex text-yellow-400">
                          <AlertTriangle className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                    {j.scheduler_entry_id != null && (
                      <Tooltip title={`Scheduled by job scheduler (ID ${j.scheduler_entry_id})`} side="top">
                        <span className="inline-flex text-blue-400">
                          <CalendarClock className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                    {j.run_after != null && (
                      <Tooltip
                        title={`Scheduled to run after ${formatDateTimeWithSeconds(j.run_after)}`}
                        side="top"
                      >
                        <span className="inline-flex text-blue-400">
                          <Clock className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                    {j.acknowledge_flag && (
                      <Tooltip title="Acknowledged" side="top">
                        <span className="inline-flex text-green-400">
                          <CheckCircle className="w-4 h-4" />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 flex gap-1 flex-nowrap">
                  {(j.error_flag || j.warning_flag) && (
                    <Tooltip title={j.acknowledge_flag ? "Unacknowledge" : "Acknowledge"} side="top">
                      <button
                        type="button"
                        onClick={() => setAcknowledge(j.job_queue_id, !j.acknowledge_flag)}
                        className={cn(
                          "p-1.5 rounded hover:bg-gray-700",
                          j.acknowledge_flag ? "text-green-400 hover:text-green-300" : "text-gray-400 hover:text-white"
                        )}
                      >
                        {j.acknowledge_flag ? <Undo2 className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                      </button>
                    </Tooltip>
                  )}
                  {j.status === "new" && (
                    <Tooltip title="Cancel" side="top">
                      <button
                        type="button"
                        onClick={() => cancel(j.job_queue_id)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {displayJobs.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No matching jobs found.</div>
        )}
        </>
        )}
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        total={effectiveTotal}
        pageSize={PAGE_SIZE}
        itemLabel="jobs"
        onPageChange={setPage}
        disabled={pageLoading}
        onFilterClick={() => setShowColumnFilterModal(true)}
        filterActive={activeFilters}
        onClearFilters={() => {
          const next = { ...EMPTY_FILTERS };
          setFilters(next);
          setPage(1);
          try {
            localStorage.setItem(QUEUE_FILTERS_KEY, JSON.stringify(next));
          } catch (_) {}
        }}
      />

      {showColumnFilterModal && (
        <QueueColumnFilterModal
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={(cols) => {
            setVisibleColumns(cols);
            try {
              localStorage.setItem(QUEUE_VISIBLE_COLUMNS_KEY, JSON.stringify(cols));
            } catch (_) {}
          }}
          filters={filters}
          onFiltersChange={(newFilters) => {
            setFilters(newFilters);
            setPage(1);
            try {
              localStorage.setItem(QUEUE_FILTERS_KEY, JSON.stringify(newFilters));
            } catch (_) {}
          }}
          onClose={() => setShowColumnFilterModal(false)}
        />
      )}

      {showAckAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAckAllModal(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-white mb-2">Acknowledge all</h3>
            <p className="text-sm text-gray-400 mb-4">Choose which unacknowledged jobs to acknowledge:</p>
            <div className="space-y-2 mb-4">
              {unackCounts.warningsOnly + unackCounts.both > 0 && (
                <button
                  type="button"
                  onClick={() => acknowledgeAll("warnings")}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left text-sm font-medium bg-yellow-900/40 hover:bg-yellow-800/50 text-yellow-200 border border-yellow-700/50"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Warnings only
                  </span>
                  <span className="text-yellow-400/80">
                    {unackCounts.warningsOnly + unackCounts.both} job{(unackCounts.warningsOnly + unackCounts.both) === 1 ? "" : "s"}
                  </span>
                </button>
              )}
              {unackCounts.errorsOnly + unackCounts.both > 0 && (
                <button
                  type="button"
                  onClick={() => acknowledgeAll("errors")}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left text-sm font-medium bg-red-900/40 hover:bg-red-800/50 text-red-200 border border-red-700/50"
                >
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Errors only
                  </span>
                  <span className="text-red-400/80">
                    {unackCounts.errorsOnly + unackCounts.both} job{(unackCounts.errorsOnly + unackCounts.both) === 1 ? "" : "s"}
                  </span>
                </button>
              )}
              {unackCounts.total > 0 && (
                <button
                  type="button"
                  onClick={() => acknowledgeAll("both")}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600"
                >
                  <span className="flex items-center gap-2">
                    <CheckCheck className="w-4 h-4" />
                    Both (warnings and errors)
                  </span>
                  <span className="text-gray-400">
                    {unackCounts.total} job{unackCounts.total === 1 ? "" : "s"}
                  </span>
                </button>
              )}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setShowAckAllModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAdd(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-white mb-4">Add job</h3>
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-gray-400 block mb-1">Job type</span>
                <select
                  value={addForm.job_type}
                  onChange={(e) => setAddForm({ ...addForm, job_type: e.target.value })}
                  className="input"
                >
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              {!isJobTypeImplemented(addForm.job_type) && (
                <p className="text-amber-400 text-sm">This job type is not implemented yet.</p>
              )}
              {jobTypeUsesVideoId(addForm.job_type) && (
                <label className="block">
                  <span className="text-gray-400 block mb-1">
                    Video ID ({getVideoIdRequirement(addForm.job_type) === "required" ? "required" : "optional"})
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={addForm.video_id}
                    onChange={(e) => setAddForm({ ...addForm, video_id: e.target.value })}
                    className="input"
                    placeholder=""
                  />
                </label>
              )}
              {jobTypeUsesChannelId(addForm.job_type) && (
                <label className="block">
                  <span className="text-gray-400 block mb-1">
                    Channel ({getChannelIdRequirement(addForm.job_type) === "required" ? "required" : "optional"})
                  </span>
                  <select
                    value={String(addForm.channel_id)}
                    onChange={(e) => setAddForm({ ...addForm, channel_id: e.target.value })}
                    className="input"
                  >
                    <option value="">— Select channel —</option>
                    {channels.map((c) => (
                      <option key={c.channel_id} value={String(c.channel_id)}>
                        {c.title || c.handle || c.channel_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {getParameterConfig(addForm.job_type) && (
                <label className="block">
                  <span className="text-gray-400 block mb-1">
                    {getParameterConfig(addForm.job_type).label}
                    {getParameterConfig(addForm.job_type).required ? " (required)" : " (optional)"}
                  </span>
                  <input
                    type={getParameterConfig(addForm.job_type).inputType === "number" ? "number" : "text"}
                    min={getParameterConfig(addForm.job_type).min}
                    value={addForm.parameter}
                    onChange={(e) => setAddForm({ ...addForm, parameter: e.target.value })}
                    className="input"
                    placeholder={getParameterConfig(addForm.job_type).placeholder ?? ""}
                  />
                </label>
              )}
              <label className="block">
                <span className="text-gray-400 block mb-1">Target server instance</span>
                <select
                  value={String(addForm.target_server_instance_id)}
                  onChange={(e) => setAddForm({ ...addForm, target_server_instance_id: e.target.value })}
                  className="input"
                >
                  {serverInstances.map((s) => (
                    <option key={s.server_instance_id} value={String(s.server_instance_id)}>
                      {s.display_name} (ID {s.server_instance_id})
                      {!s.is_enabled ? " — disabled" : ""}
                      {s.is_running ? " — running" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {addForm.job_type === "queue_all_downloads" && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={addForm.queue_all_target_all_downloaders}
                    onChange={(e) =>
                      setAddForm({ ...addForm, queue_all_target_all_downloaders: e.target.checked })
                    }
                    className="rounded border-gray-600 bg-gray-800"
                  />
                  <span className="text-gray-400">Target all downloaders</span>
                </label>
              )}
              <label className="block">
                <span className="text-gray-400 block mb-1">Priority</span>
                <input
                  type="number"
                  value={addForm.priority}
                  onChange={(e) => setAddForm({ ...addForm, priority: parseInt(e.target.value, 10) || 50 })}
                  className="input"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={addJob} className="btn-primary" disabled={!isJobTypeImplemented(addForm.job_type)}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      <VideoDetailsModal
        videoId={videoIdForDetails}
        onClose={() => setVideoIdForDetails(null)}
        setError={setError}
        toast={toast}
        onVideoUpdated={() => {}}
        onOpenJobDetails={(jobId) => setJobQueueIdForModal(jobId)}
        onOpenChannelEdit={(channelId) => setEditingChannelId(channelId)}
      />
      <ChannelEditModal
        channelId={editingChannelId}
        onClose={() => setEditingChannelId(null)}
        onSaved={() => {}}
        setError={setError}
      />
      <JobDetailsModal
        jobId={jobQueueIdForModal}
        onClose={() => setJobQueueIdForModal(null)}
        setError={setError}
        toast={toast}
      />
    </div>
  );
}
