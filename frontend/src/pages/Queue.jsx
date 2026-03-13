import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import { Pause, Play, Check, X, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, AlertTriangle, CalendarClock, CheckCircle, Undo2, MessageCircle, Clock, Search, Filter, CheckCheck } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import { PaginationBar } from "../components/PaginationBar";
import { JobDetailsModal } from "../components/JobDetailsModal";
import { VideoDetailsModal } from "../components/VideoDetailsModal";
import { ChannelEditModal } from "../components/ChannelEditModal";
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

export default function Queue({ setError }) {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const filterWarningsAndErrors = searchParams.get("filter") === "warnings_and_errors";
  const filterQueued = searchParams.get("filter") === "queued";
  const filterScheduled = searchParams.get("filter") === "scheduled";
  const PAGE_SIZE = 500;
  const { jobs, totalCount, status: wsStatus, queueUpdatedAt, videoProgressOverrides, jobOverrides, refreshQueue } = useQueueWebSocket();
  const [control, setControl] = useState({});
  const [paused, setPaused] = useState(false);
  const [addForm, setAddForm] = useState({ job_type: "get_metadata", video_id: "", channel_id: "", parameter: "", priority: 50 });
  const [showAdd, setShowAdd] = useState(false);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [videoIdForDetails, setVideoIdForDetails] = useState(null);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [showAckAllModal, setShowAckAllModal] = useState(false);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageJobs, setPageJobs] = useState([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [channels, setChannels] = useState([]);

  const displayJobs = useMemo(
    () => pageJobs.map((j) => (jobOverrides[j.job_queue_id] ? { ...j, ...jobOverrides[j.job_queue_id] } : j)),
    [pageJobs, jobOverrides]
  );
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (page === 1 && jobs.length === 0 && totalCount > 0 && refreshQueue) refreshQueue();
  }, [page, jobs.length, totalCount, refreshQueue]);

  useEffect(() => {
    if (showAdd) {
      api.channels.list().then(setChannels).catch(() => setChannels([]));
    }
  }, [showAdd]);

  useEffect(() => {
    setPageLoading(true);
    api.queue
      .list({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort_by: sortBy,
        sort_order: sortOrder,
      })
      .then((res) => {
        setPageJobs(res.items || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setPageLoading(false));
  }, [page, sortBy, sortOrder]);

  useEffect(() => {
    if (totalCount > 0 && page > totalPages) setPage(totalPages);
  }, [totalCount, totalPages, page]);

  const unackCounts = useMemo(() => {
    const unack = displayJobs.filter((j) => !j.acknowledge_flag && (j.error_flag || j.warning_flag));
    return {
      warningsOnly: unack.filter((j) => j.warning_flag && !j.error_flag).length,
      errorsOnly: unack.filter((j) => j.error_flag && !j.warning_flag).length,
      both: unack.filter((j) => j.warning_flag && j.error_flag).length,
      total: unack.length,
    };
  }, [displayJobs]);

  const sortedJobs = useMemo(() => {
    let list = displayJobs;
    const now = new Date();
    if (filterWarningsAndErrors) {
      list = list.filter((j) => j.error_flag || j.warning_flag);
    } else if (filterQueued) {
      list = list.filter((j) => j.status === "new");
    } else if (filterScheduled) {
      list = list.filter((j) => j.status === "new" && j.run_after != null && new Date(j.run_after) > now);
    }
    const copy = [...list];
    copy.sort((a, b) => {
      let aVal, bVal;
      if (sortBy === "id") {
        aVal = a.job_queue_id;
        bVal = b.job_queue_id;
      } else if (sortBy === "video_id") {
        aVal = a.video_id ?? -1;
        bVal = b.video_id ?? -1;
      } else if (sortBy === "status") {
        aVal = a.status ?? "";
        bVal = b.status ?? "";
      } else if (sortBy === "last_update") {
        aVal = a.last_update ? new Date(a.last_update).getTime() : 0;
        bVal = b.last_update ? new Date(b.last_update).getTime() : 0;
      } else if (sortBy === "record_created") {
        aVal = a.record_created ? new Date(a.record_created).getTime() : 0;
        bVal = b.record_created ? new Date(b.record_created).getTime() : 0;
      } else if (sortBy === "job_type") {
        aVal = a.job_type ?? "";
        bVal = b.job_type ?? "";
      } else if (sortBy === "priority") {
        aVal = a.priority ?? 0;
        bVal = b.priority ?? 0;
      } else {
        return 0;
      }
      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [displayJobs, sortBy, sortOrder, filterWarningsAndErrors, filterQueued, filterScheduled]);

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
    const unack = jobs.filter((j) => !j.acknowledge_flag && (j.error_flag || j.warning_flag));
    let ids = [];
    if (mode === "warnings") {
      ids = unack.filter((j) => j.warning_flag).map((j) => j.job_queue_id);
    } else if (mode === "errors") {
      ids = unack.filter((j) => j.error_flag).map((j) => j.job_queue_id);
    } else {
      ids = unack.map((j) => j.job_queue_id);
    }
    setShowAckAllModal(false);
    if (ids.length === 0) {
      toast.addToast("No jobs to acknowledge", "info");
      return;
    }
    try {
      await Promise.all(ids.map((id) => api.queue.acknowledge(id)));
      toast.addToast(`Acknowledged ${ids.length} job${ids.length === 1 ? "" : "s"}`, "success");
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
      {(filterWarningsAndErrors || filterQueued || filterScheduled) && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 flex items-center justify-between gap-3">
          <span className="text-gray-300 text-sm flex items-center gap-2">
            <Filter className="w-4 h-4 text-blue-400" />
            {filterWarningsAndErrors && "Showing only jobs with errors or warnings"}
            {filterQueued && "Showing only queued jobs"}
            {filterScheduled && "Showing only future scheduled jobs"}
          </span>
          <Link to="/queue" className="text-sm text-blue-400 hover:text-blue-300">
            Clear filter
          </Link>
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

      {totalCount > PAGE_SIZE && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={totalCount}
          pageSize={PAGE_SIZE}
          itemLabel="jobs"
          onPageChange={setPage}
          disabled={pageLoading}
        />
      )}

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
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  ID
                  <Tooltip title={sortBy === "id" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by ID"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("id"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "id" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Priority
                  <Tooltip title={sortBy === "priority" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Priority"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "priority") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("priority"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "priority" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "priority" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Type
                  <Tooltip title={sortBy === "job_type" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Type"} side="top">
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "job_type") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("job_type"); setSortOrder("asc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "job_type" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "job_type" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Video ID
                  <Tooltip title={sortBy === "video_id" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Video ID"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "video_id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("video_id"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "video_id" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "video_id" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Status
                  <Tooltip title={sortBy === "status" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Status"}>
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "status") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("status"); setSortOrder("asc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "status" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "status" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  Record Created
                  <Tooltip title={sortBy === "record_created" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by record created"} side="top">
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "record_created") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("record_created"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "record_created" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "record_created" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  As of
                  <Tooltip title={sortBy === "last_update" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by last update"} side="top">
                    <button
                      type="button"
                      onClick={() => { setPage(1); if (sortBy === "last_update") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("last_update"); setSortOrder("desc"); } }}
                      className={cn(
                        "p-0.5 rounded hover:bg-gray-700",
                        sortBy === "last_update" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                      )}
                    >
                      {sortBy === "last_update" ? (sortOrder === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
                    </button>
                  </Tooltip>
                </div>
              </th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium w-36">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sortedJobs.map((j) => (
              <tr
                key={j.job_queue_id}
                className={cn(
                  "hover:bg-gray-800/30",
                  !j.acknowledge_flag && j.error_flag && "bg-red-950/25",
                  !j.acknowledge_flag && !j.error_flag && j.warning_flag && "bg-yellow-950/25"
                )}
              >
                <td className="px-4 py-2 font-mono text-gray-300">{j.job_queue_id}</td>
                <td className="px-4 py-2 font-mono text-gray-400">{j.priority ?? "—"}</td>
                <td className="px-4 py-2 text-white">{j.job_type}</td>
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
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-0.5">
                    <Tooltip title={j.status_message || ""} side="top">
                      <span
                        className={cn(
                          "inline-block",
                          (() => {
                            const displayStatus = j.video_id != null && videoProgressOverrides[j.video_id]?.status != null
                              ? videoProgressOverrides[j.video_id].status
                              : j.status;
                            return (
                              (displayStatus === "done" && "text-green-400") ||
                              (displayStatus === "running" && "text-blue-400") ||
                              (displayStatus === "error" && "text-red-400") ||
                              (displayStatus === "new" && "text-gray-400")
                            );
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
                            style={{
                              width: `${Math.min(100, Math.max(0, Number(percent) || 0))}%`,
                            }}
                          />
                        </div>
                      ) : null;
                    })()}
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                  {formatDateTimeWithSeconds(j.record_created)}
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                  {formatDateTimeWithSeconds(j.last_update)}
                </td>
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
                  <Tooltip title="Job details" side="top">
                    <button
                      type="button"
                      onClick={() => setJobQueueIdForModal(j.job_queue_id)}
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </Tooltip>
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
        {sortedJobs.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No jobs. Connect WebSocket or add a job.</div>
        )}
        </>
        )}
      </div>

      {totalCount > PAGE_SIZE && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={totalCount}
          pageSize={PAGE_SIZE}
          itemLabel="jobs"
          onPageChange={setPage}
          disabled={pageLoading}
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
