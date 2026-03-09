import { useState, useEffect } from "react";
import { api } from "../api/client";
import { formatDateTime } from "../lib/utils";
import { CalendarClock, Pencil, Trash2, History, Search } from "lucide-react";
import { useToast } from "../context/ToastContext";
import Modal from "../components/Modal";
import { Tooltip } from "../components/Tooltip";
import { JobDetailsModal } from "../components/JobDetailsModal";
import ScheduleBuilder, { cronToDescription } from "../components/ScheduleBuilder";

const JOB_TYPES = [
  "download_video",
  "get_metadata",
  "fill_missing_metadata",
  "queue_all_downloads",
  "download_channel_artwork",
  "download_one_channel",
  "download_auto_enabled_channels",
  "update_channel_info",
  "add_video_from_frontend",
  "add_video_from_playlist",
  "transcode_video_for_ipad",
];

function jobTypeNeedsVideoId(jobType) {
  return ["download_video", "get_metadata", "transcode_video_for_ipad"].includes(jobType);
}

function jobTypeNeedsChannelId(jobType) {
  return [
    "download_channel_artwork",
    "download_one_channel",
    "update_channel_info",
  ].includes(jobType);
}

function jobTypeNeedsParameter(jobType) {
  return [
    "fill_missing_metadata",
    "download_one_channel",
    "add_video_from_frontend",
    "add_video_from_playlist",
  ].includes(jobType);
}

const emptyForm = () => ({
  name: "",
  job_type: "get_metadata",
  cron_expression: "0 * * * *",
  video_id: "",
  channel_id: "",
  parameter: "",
  priority: 50,
  is_enabled: true,
});

export default function JobScheduler({ setError }) {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [historyEntryId, setHistoryEntryId] = useState(null);
  const [historyJobs, setHistoryJobs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [jobQueueIdForModal, setJobQueueIdForModal] = useState(null);
  const [channels, setChannels] = useState([]);
  const [videos, setVideos] = useState([]);

  const loadEntries = () => {
    api.scheduler
      .list()
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEntries();
  }, []);

  useEffect(() => {
    if (showForm || historyEntryId) {
      api.channels.list().then(setChannels).catch(() => setChannels([]));
      api.videos.list({ limit: 500 }).then(setVideos).catch(() => setVideos([]));
    }
  }, [showForm, historyEntryId]);

  useEffect(() => {
    if (historyEntryId != null) {
      setHistoryLoading(true);
      api.queue
        .list({ scheduler_entry_id: historyEntryId, limit: 200 })
        .then(setHistoryJobs)
        .catch((e) => {
          setError(e.message);
          setHistoryJobs([]);
        })
        .finally(() => setHistoryLoading(false));
    } else {
      setHistoryJobs([]);
    }
  }, [historyEntryId, setError]);

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (entry) => {
    setForm({
      name: entry.name,
      job_type: entry.job_type,
      cron_expression: entry.cron_expression || "0 * * * *",
      video_id: entry.video_id != null ? String(entry.video_id) : "",
      channel_id: entry.channel_id != null ? String(entry.channel_id) : "",
      parameter: entry.parameter ?? "",
      priority: entry.priority ?? 50,
      is_enabled: entry.is_enabled ?? true,
    });
    setEditingId(entry.scheduler_entry_id);
    setShowForm(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) {
      toast.addToast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        job_type: form.job_type,
        cron_expression: form.cron_expression,
        video_id: form.video_id ? parseInt(form.video_id, 10) : null,
        channel_id: form.channel_id ? parseInt(form.channel_id, 10) : null,
        parameter: form.parameter?.trim() || null,
        priority: form.priority,
        is_enabled: form.is_enabled,
      };
      if (editingId != null) {
        await api.scheduler.update(editingId, body);
        toast.addToast("Schedule updated", "success");
      } else {
        await api.scheduler.create(body);
        toast.addToast("Schedule created", "success");
      }
      setShowForm(false);
      loadEntries();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (entry) => {
    if (!confirm(`Delete schedule "${entry.name}"?`)) return;
    try {
      await api.scheduler.delete(entry.scheduler_entry_id);
      toast.addToast("Schedule deleted", "success");
      loadEntries();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Job Scheduler</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Create and manage scheduled jobs. Each entry runs on a cron-like schedule and adds a job to the queue.
            </p>
          </div>
          <button type="button" onClick={openCreate} className="btn-primary flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Create schedule
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-gray-400">Loading…</p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="pb-3 pr-4 font-medium">Name</th>
                  <th className="pb-3 pr-4 font-medium">Job type</th>
                  <th className="pb-3 pr-4 font-medium">Schedule</th>
                  <th className="pb-3 pr-4 font-medium">Next run</th>
                  <th className="pb-3 pr-4 font-medium">Last run</th>
                  <th className="pb-3 pr-4 font-medium">Enabled</th>
                  <th className="pb-3 pr-4 font-medium w-32">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {entries.map((e) => (
                  <tr key={e.scheduler_entry_id} className="hover:bg-gray-800/30">
                    <td className="py-3 pr-4 text-white">{e.name}</td>
                    <td className="py-3 pr-4 text-gray-300">{e.job_type}</td>
                    <td className="py-3 pr-4 text-gray-400">{cronToDescription(e.cron_expression)}</td>
                    <td className="py-3 pr-4 text-gray-400">{formatDateTime(e.next_run_at)}</td>
                    <td className="py-3 pr-4 text-gray-400">{formatDateTime(e.last_run_at)}</td>
                    <td className="py-3 pr-4">
                      <span className={e.is_enabled ? "text-green-400" : "text-gray-500"}>
                        {e.is_enabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 flex items-center gap-1">
                      <Tooltip title="Edit" side="top">
                        <button
                          type="button"
                          onClick={() => openEdit(e)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip title="View history" side="top">
                        <button
                          type="button"
                          onClick={() => setHistoryEntryId(e.scheduler_entry_id)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        >
                          <History className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip title="Delete" side="top">
                        <button
                          type="button"
                          onClick={() => deleteEntry(e)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && (
              <p className="py-8 text-center text-gray-500">No schedules. Create one to run jobs on a schedule.</p>
            )}
          </div>
        )}
      </div>

      {showForm && (
        <Modal title={editingId != null ? "Edit schedule" : "Create schedule"} onClose={() => !saving && setShowForm(false)} maxWidthClass="max-w-lg">
          <div className="space-y-4">
            <label className="block">
              <span className="text-gray-400 block mb-1">Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input w-full"
                placeholder="e.g. Daily metadata refresh"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Job type</span>
              <select
                value={form.job_type}
                onChange={(e) => setForm({ ...form, job_type: e.target.value })}
                className="input w-full"
              >
                {JOB_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <ScheduleBuilder
              cron={form.cron_expression}
              onChange={(c) => setForm({ ...form, cron_expression: c })}
              disabled={saving}
            />
            {jobTypeNeedsVideoId(form.job_type) && (
              <label className="block">
                <span className="text-gray-400 block mb-1">Video ID</span>
                <select
                  value={String(form.video_id)}
                  onChange={(e) => setForm({ ...form, video_id: e.target.value })}
                  className="input w-full"
                >
                  <option value="">— Select video —</option>
                  {videos.map((v) => (
                    <option key={v.video_id} value={String(v.video_id)}>
                      {v.title || v.provider_key || v.video_id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {jobTypeNeedsChannelId(form.job_type) && (
              <label className="block">
                <span className="text-gray-400 block mb-1">Channel</span>
                <select
                  value={String(form.channel_id)}
                  onChange={(e) => setForm({ ...form, channel_id: e.target.value })}
                  className="input w-full"
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
            {jobTypeNeedsParameter(form.job_type) && (
              <label className="block">
                <span className="text-gray-400 block mb-1">
                  {["add_video_from_frontend", "add_video_from_playlist"].includes(form.job_type)
                    ? "YouTube URL or video ID"
                    : "Parameter"}
                </span>
                <input
                  type="text"
                  value={form.parameter}
                  onChange={(e) => setForm({ ...form, parameter: e.target.value })}
                  className="input w-full"
                  placeholder={form.job_type === "fill_missing_metadata" ? "Max videos (optional)" : ""}
                />
              </label>
            )}
            <label className="block">
              <span className="text-gray-400 block mb-1">Priority</span>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 50 })}
                className="input w-full"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_enabled}
                onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
                className="rounded border-gray-600"
              />
              <span className="text-gray-400">Enabled</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowForm(false)} disabled={saving} className="btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={saveForm} disabled={saving} className="btn-primary">
                {saving ? "Saving…" : editingId != null ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {historyEntryId != null && (
        <Modal
          title="Schedule history"
          onClose={() => setHistoryEntryId(null)}
          maxWidthClass="max-w-3xl"
        >
          <p className="text-sm text-gray-400 mb-3">
            Jobs added to the queue by this schedule (most recent first).
          </p>
          {historyLoading ? (
            <p className="text-gray-400">Loading…</p>
          ) : (
            <div className="overflow-x-hidden overflow-y-auto max-h-96">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400 border-b border-gray-800 sticky top-0 bg-gray-900">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">ID</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Created</th>
                    <th className="pb-2 pr-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {historyJobs.map((j) => (
                    <tr key={j.job_queue_id}>
                      <td className="py-2 pr-3 font-mono text-gray-300">{j.job_queue_id}</td>
                      <td className="py-2 pr-3 text-white">{j.job_type}</td>
                      <td className="py-2 pr-3 text-gray-400">{j.status}</td>
                      <td className="py-2 pr-3 text-gray-400">{formatDateTime(j.record_created)}</td>
                      <td className="py-2 pr-3">
                        <Tooltip title="Job details" side="left">
                          <button
                            type="button"
                            onClick={() => setJobQueueIdForModal(j.job_queue_id)}
                            className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                          >
                            <Search className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyJobs.length === 0 && (
                <p className="py-4 text-center text-gray-500">No jobs have been run by this schedule yet.</p>
              )}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => setHistoryEntryId(null)} className="btn-secondary">
              Close
            </button>
          </div>
        </Modal>
      )}

      <JobDetailsModal
        jobId={jobQueueIdForModal}
        onClose={() => setJobQueueIdForModal(null)}
        setError={setError}
        toast={toast}
      />
    </div>
  );
}
