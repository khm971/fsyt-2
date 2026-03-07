import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useQueueWebSocket } from "../hooks/useQueueWebSocket";
import { cn } from "../lib/utils";
import { Pause, Play, Check, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";

export default function Queue({ setError }) {
  const toast = useToast();
  const { jobs, status: wsStatus, queueUpdatedAt } = useQueueWebSocket();
  const [control, setControl] = useState({});
  const [paused, setPaused] = useState(false);
  const [addForm, setAddForm] = useState({ job_type: "get_metadata", video_id: "", priority: 50 });
  const [showAdd, setShowAdd] = useState(false);

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

  const acknowledge = async (id) => {
    try {
      await api.queue.acknowledge(id);
      toast.addToast(`Job ${id} acknowledged`, "success");
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
            <span className="text-sm text-gray-400">{wsStatus}</span>
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
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Video ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Message</th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {jobs.map((j) => (
              <tr key={j.job_queue_id} className="hover:bg-gray-800/30">
                <td className="px-4 py-2 font-mono text-gray-300">{j.job_queue_id}</td>
                <td className="px-4 py-2 text-white">{j.job_type}</td>
                <td className="px-4 py-2 font-mono text-gray-400">{j.video_id ?? "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={cn(
                      j.status === "done" && "text-green-400",
                      j.status === "running" && "text-blue-400",
                      j.status === "error" && "text-red-400",
                      j.status === "new" && "text-gray-400"
                    )}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-400 max-w-xs">
                  <Tooltip title={j.status_message || ""}>
                    <span className="inline-block max-w-full truncate">{j.status_message || "—"}</span>
                  </Tooltip>
                </td>
                <td className="px-4 py-2">
                  {j.error_flag && <span className="text-red-400 text-xs">error </span>}
                  {j.warning_flag && <span className="text-yellow-400 text-xs">warn </span>}
                  {j.completed_flag && <span className="text-green-400 text-xs">done</span>}
                  {!j.error_flag && !j.warning_flag && !j.completed_flag && "—"}
                </td>
                <td className="px-4 py-2 flex gap-1">
                  {j.error_flag && !j.acknowledge_flag && (
                    <Tooltip title="Acknowledge">
                      <button
                        type="button"
                        onClick={() => acknowledge(j.job_queue_id)}
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  )}
                  {j.status === "new" && (
                    <Tooltip title="Cancel">
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
        {jobs.length === 0 && (
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
