import { useState, useEffect, useMemo } from "react";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import { Pause, Play, Check, X, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, AlertTriangle, CalendarClock, CheckCircle, Undo2, MessageCircle, Clock } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";

export default function Queue({ setError }) {
  const toast = useToast();
  const { jobs, status: wsStatus, queueUpdatedAt } = useQueueWebSocket();
  const [control, setControl] = useState({});
  const [paused, setPaused] = useState(false);
  const [addForm, setAddForm] = useState({ job_type: "get_metadata", video_id: "", priority: 50 });
  const [showAdd, setShowAdd] = useState(false);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("desc");

  const sortedJobs = useMemo(() => {
    const copy = [...jobs];
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
  }, [jobs, sortBy, sortOrder]);

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

  const addJob = async () => {
    try {
      const body = {
        job_type: addForm.job_type,
        priority: addForm.priority,
      };
      if (addForm.video_id) body.video_id = parseInt(addForm.video_id, 10);
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
            Too many chargeable errors. The job processor has stopped.
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
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary">
            Add job
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">
                <div className="flex items-center gap-1">
                  ID
                  <Tooltip title={sortBy === "id" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by ID"}>
                    <button
                      type="button"
                      onClick={() => { if (sortBy === "id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("id"); setSortOrder("desc"); } }}
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
                      onClick={() => { if (sortBy === "priority") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("priority"); setSortOrder("desc"); } }}
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
                      onClick={() => { if (sortBy === "job_type") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("job_type"); setSortOrder("asc"); } }}
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
                      onClick={() => { if (sortBy === "video_id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("video_id"); setSortOrder("desc"); } }}
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
                      onClick={() => { if (sortBy === "status") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("status"); setSortOrder("asc"); } }}
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
                      onClick={() => { if (sortBy === "record_created") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("record_created"); setSortOrder("desc"); } }}
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
                      onClick={() => { if (sortBy === "last_update") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("last_update"); setSortOrder("desc"); } }}
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
                <td className="px-4 py-2 font-mono text-gray-400">{j.video_id ?? "—"}</td>
                <td className="px-4 py-2">
                  <Tooltip title={j.status_message || ""} side="top">
                    <span
                      className={cn(
                        "inline-block",
                        j.status === "done" && "text-green-400",
                        j.status === "running" && "text-blue-400",
                        j.status === "error" && "text-red-400",
                        j.status === "new" && "text-gray-400"
                      )}
                    >
                      {j.status}
                    </span>
                  </Tooltip>
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
      </div>

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
                  <option value="get_metadata">get_metadata</option>
                  <option value="download_video">download_video</option>
                  <option value="fill_missing_metadata">fill_missing_metadata</option>
                  <option value="queue_all_downloads">queue_all_downloads</option>
                  <option value="download_channel_artwork">download_channel_artwork</option>
                  <option value="download_one_channel">download_one_channel</option>
                  <option value="download_auto_enabled_channels">download_auto_enabled_channels</option>
                  <option value="update_channel_info">update_channel_info</option>
                </select>
              </label>
              <label className="block">
                <span className="text-gray-400 block mb-1">Video ID (optional)</span>
                <input
                  type="number"
                  value={addForm.video_id}
                  onChange={(e) => setAddForm({ ...addForm, video_id: e.target.value })}
                  className="input"
                  placeholder=""
                />
              </label>
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
              <button type="button" onClick={addJob} className="btn-primary">
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
