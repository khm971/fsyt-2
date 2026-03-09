import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import {
  Plus, Download, FileSearch, Film, ListTodo, Settings, Play, Clock, CheckCircle,
  XCircle, AlertCircle, AlertTriangle, HelpCircle, CalendarClock, MessageCircle,
  Hash, Users, Calendar, RefreshCw, Activity, ArrowUp, FileText, Braces, ClipboardList,
} from "lucide-react";
import { Tooltip } from "./Tooltip";

const JOB_TYPE_ICONS = {
  download_video: Download,
  get_metadata: FileSearch,
  fill_missing_metadata: FileSearch,
  download_channel_artwork: Download,
  download_one_channel: Download,
  download_auto_enabled_channels: Download,
  update_channel_info: Settings,
  add_video_from_frontend: Plus,
  add_video_from_playlist: Plus,
  transcode_video_for_ipad: Film,
  queue_all_downloads: ListTodo,
};
function getJobTypeIcon(jobType) {
  return JOB_TYPE_ICONS[jobType] ?? ListTodo;
}

const JOB_STATUS_ICONS = {
  new: Clock,
  running: Play,
  done: CheckCircle,
  cancelled: XCircle,
  error: AlertCircle,
};
function getJobStatusIcon(status) {
  return JOB_STATUS_ICONS[status] ?? HelpCircle;
}
function getJobStatusColor(status) {
  if (!status) return "text-gray-500";
  if (status === "done") return "text-green-400";
  if (status === "running") return "text-blue-400";
  if (status === "error") return "text-red-400";
  if (status === "new") return "text-gray-400";
  if (status === "cancelled") return "text-gray-500";
  return "text-gray-500";
}

export function JobDetailsModal({ jobId, onClose, setError, toast, onJobCanceled }) {
  const [jobDetails, setJobDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [schedulerEntryName, setSchedulerEntryName] = useState(null);

  useEffect(() => {
    if (jobId == null) {
      setJobDetails(null);
      setSchedulerEntryName(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setJobDetails(null);
    setSchedulerEntryName(null);
    api.queue
      .get(jobId)
      .then((j) => {
        if (!cancelled) setJobDetails(j);
        if (!cancelled && j?.scheduler_entry_id != null) {
          api.scheduler.get(j.scheduler_entry_id).then((e) => !cancelled && setSchedulerEntryName(e.name)).catch(() => {});
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [jobId, setError]);

  const refreshJobDetails = useCallback(() => {
    if (jobId == null) return;
    api.queue.get(jobId).then(setJobDetails).catch((e) => setError(e.message));
  }, [jobId, setError]);

  const runJobNow = async () => {
    if (jobDetails?.status !== "new") return;
    try {
      await api.queue.update(jobDetails.job_queue_id, { run_after: null });
      toast.addToast("Run after cleared — job will run as soon as possible", "success");
      refreshJobDetails();
    } catch (e) {
      setError(e.message);
    }
  };

  const updateJobPriority = async (priority) => {
    if (jobDetails?.status !== "new") return;
    const p = Math.min(100, Math.max(1, Number(priority) || 1));
    try {
      await api.queue.update(jobDetails.job_queue_id, { priority: p });
      toast.addToast(`Priority set to ${p} (1 = highest)`, "success");
      refreshJobDetails();
    } catch (e) {
      setError(e.message);
    }
  };

  const cancelJob = async () => {
    if (jobDetails?.status !== "new") return;
    try {
      await api.queue.cancel(jobDetails.job_queue_id);
      toast.addToast(`Job ${jobDetails.job_queue_id} cancelled`, "success");
      onClose();
      onJobCanceled?.();
    } catch (e) {
      setError(e.message);
    }
  };

  if (jobId == null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-4 max-h-[90vh] overflow-x-hidden overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-white mb-4">Job details</h3>
        {loading && (
          <div className="text-gray-400 py-4">Loading...</div>
        )}
        {!loading && jobDetails && (
          <div className="text-sm">
            <table className="w-full border-collapse">
              <tbody>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top w-40">
                    <span className="inline-flex items-center gap-1.5">
                      <Hash className="w-4 h-4 shrink-0 text-gray-500" />
                      ID
                    </span>
                  </td>
                  <td className="py-1.5 text-white font-mono">{jobDetails.job_queue_id}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Settings className="w-4 h-4 shrink-0 text-gray-500" />
                      Type
                    </span>
                  </td>
                  <td className="py-1.5 text-white">
                    <span className="inline-flex items-center gap-1.5">
                      {(() => {
                        const Icon = getJobTypeIcon(jobDetails.job_type);
                        return <Icon className="w-4 h-4 text-gray-400 shrink-0" />;
                      })()}
                      {jobDetails.job_type}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <ClipboardList className="w-4 h-4 shrink-0 text-gray-500" />
                      Status
                    </span>
                  </td>
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-1.5 text-white">
                      {(() => {
                        const StatusIcon = getJobStatusIcon(jobDetails.status);
                        return (
                          <StatusIcon
                            className={cn("w-4 h-4 shrink-0", getJobStatusColor(jobDetails.status))}
                          />
                        );
                      })()}
                      {jobDetails.status}
                    </span>
                  </td>
                </tr>
                {jobDetails.video_id != null && (
                  <tr>
                    <td className="py-1.5 pr-4 text-gray-400 align-top">
                      <span className="inline-flex items-center gap-1.5">
                        <Film className="w-4 h-4 shrink-0 text-gray-500" />
                        Video ID
                      </span>
                    </td>
                    <td className="py-1.5 text-white font-mono">{jobDetails.video_id}</td>
                  </tr>
                )}
                {jobDetails.channel_id != null && (
                  <tr>
                    <td className="py-1.5 pr-4 text-gray-400 align-top">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4 shrink-0 text-gray-500" />
                        Channel ID
                      </span>
                    </td>
                    <td className="py-1.5 text-white font-mono">{jobDetails.channel_id}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 shrink-0 text-gray-500" />
                      Created
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{formatDateTimeWithSeconds(jobDetails.record_created)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 shrink-0 text-gray-500" />
                      Last update
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{formatDateTimeWithSeconds(jobDetails.last_update)}</td>
                </tr>
                {(jobDetails.status_percent_complete != null) && (
                  <tr>
                    <td className="py-1.5 pr-4 text-gray-400 align-top">
                      <span className="inline-flex items-center gap-1.5">
                        <Activity className="w-4 h-4 shrink-0 text-gray-500" />
                        Progress
                      </span>
                    </td>
                    <td className="py-1.5 text-white">{jobDetails.status_percent_complete}%</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertCircle className={cn("w-4 h-4 shrink-0", jobDetails.error_flag ? "text-red-400" : "text-gray-500")} />
                      Error
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{jobDetails.error_flag ? "Yes" : "No"}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle className={cn("w-4 h-4 shrink-0", jobDetails.warning_flag ? "text-yellow-400" : "text-gray-500")} />
                      Warning
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{jobDetails.warning_flag ? "Yes" : "No"}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle className={cn("w-4 h-4 shrink-0", jobDetails.completed_flag ? "text-green-400" : "text-gray-500")} />
                      Completed
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{jobDetails.completed_flag ? "Yes" : "No"}</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle className={cn("w-4 h-4 shrink-0", jobDetails.acknowledge_flag ? "text-green-400" : "text-gray-500")} />
                      Acknowledged
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{jobDetails.acknowledge_flag ? "Yes" : "No"}</td>
                </tr>
                {jobDetails.scheduler_entry_id != null && (
                  <tr>
                    <td className="py-1.5 pr-4 text-gray-400 align-top">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="w-4 h-4 shrink-0 text-cyan-400" />
                        Scheduler entry
                      </span>
                    </td>
                    <td className="py-1.5 text-white font-mono">
                      <span title={schedulerEntryName ?? undefined}>
                        {jobDetails.scheduler_entry_id}
                        {schedulerEntryName != null && (
                          <span className="text-gray-400 ml-1.5">
                            ({schedulerEntryName.length > 15 ? `${schedulerEntryName.slice(0, 15)}…` : schedulerEntryName})
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className={cn("w-4 h-4 shrink-0", jobDetails.run_after != null ? "text-blue-400" : "text-gray-500")} />
                      Scheduled for
                    </span>
                  </td>
                  <td className="py-1.5 text-white">
                    {jobDetails.run_after != null ? (
                      <span className="inline-flex items-center gap-2">
                        {formatDateTimeWithSeconds(jobDetails.run_after)}
                        {jobDetails.status === "new" && (
                          <Tooltip title="Clear run-after so the job runs as soon as possible" side="left" wrap>
                            <button
                              type="button"
                              onClick={runJobNow}
                              className="text-blue-400 hover:text-blue-300 text-xs px-2 py-0.5 rounded bg-gray-800"
                            >
                              Run now
                            </button>
                          </Tooltip>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <ArrowUp className="w-4 h-4 shrink-0 text-gray-500" />
                      Priority
                    </span>
                  </td>
                  <td className="py-1.5">
                    {jobDetails.status === "new" ? (
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          defaultValue={jobDetails.priority ?? 50}
                          onBlur={(e) => updateJobPriority(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && updateJobPriority(e.target.value)}
                          className="w-16 px-2 py-0.5 rounded bg-gray-800 text-white font-mono border border-gray-600 focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-gray-500 text-xs">1 = highest, 100 = lowest</span>
                      </span>
                    ) : (
                      <span className="text-white">{jobDetails.priority ?? "—"}</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            {jobDetails.status_message && (
              <div className="flex items-start gap-2 mt-3">
                <MessageCircle className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-gray-400 block">Status message</span>
                  <span className="text-white break-words">{jobDetails.status_message}</span>
                </div>
              </div>
            )}
            {jobDetails.parameter && (
              <div className="mt-3">
                <span className="text-gray-400 inline-flex items-center gap-1.5 mb-1 block">
                  <FileText className="w-4 h-4 shrink-0 text-gray-500" />
                  Parameter
                </span>
                <span className="text-white break-all font-mono text-xs">{jobDetails.parameter}</span>
              </div>
            )}
            {jobDetails.extended_parameters && (
              <div className="mt-3">
                <span className="text-gray-400 inline-flex items-center gap-1.5 mb-1 block">
                  <Braces className="w-4 h-4 shrink-0 text-gray-500" />
                  Extended parameters
                </span>
                <pre className="text-white break-all font-mono text-xs whitespace-pre-wrap bg-gray-800 p-2 rounded">
                  {jobDetails.extended_parameters}
                </pre>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-700">
              {jobDetails.status === "new" && (
                <button
                  type="button"
                  onClick={cancelJob}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-gray-700 rounded"
                >
                  Cancel job
                </button>
              )}
              <button type="button" onClick={onClose} className="btn-secondary">
                Close
              </button>
            </div>
          </div>
        )}
        {!loading && !jobDetails && (
          <div className="text-gray-400 py-4">Job not found.</div>
        )}
      </div>
    </div>
  );
}
