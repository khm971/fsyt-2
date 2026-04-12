import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import {
  Plus, Download, FileSearch, Film, ListTodo, Settings, Play, Clock, CheckCircle,
  XCircle, AlertCircle, AlertTriangle, HelpCircle, CalendarClock, MessageCircle,
  Hash, Users, User, Calendar, RefreshCw, Activity, ArrowUp, FileText, Braces, ClipboardList,
  Check, Undo2, Server,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import Modal from "./Modal";

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
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelJobLoading, setCancelJobLoading] = useState(false);
  const [acknowledgeLoading, setAcknowledgeLoading] = useState(false);

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
    if (jobId == null) return Promise.resolve();
    return api.queue
      .get(jobId)
      .then((j) => {
        setJobDetails(j);
        return j;
      })
      .catch((e) => {
        setError(e.message);
        throw e;
      });
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

  const handleCancelJobConfirm = async () => {
    setCancelJobLoading(true);
    try {
      await cancelJob();
      setShowCancelConfirm(false);
    } finally {
      setCancelJobLoading(false);
      setShowCancelConfirm(false);
    }
  };

  const toggleAcknowledge = async () => {
    if (jobDetails == null || acknowledgeLoading) return;
    setAcknowledgeLoading(true);
    try {
      const id = jobDetails.job_queue_id;
      if (jobDetails.acknowledge_flag) {
        await api.queue.unacknowledge(id);
        toast.addToast(`Job ${id} unacknowledged`, "success");
      } else {
        await api.queue.acknowledge(id);
        toast.addToast(`Job ${id} acknowledged`, "success");
      }
      await refreshJobDetails();
    } catch (e) {
      setError(e.message);
    } finally {
      setAcknowledgeLoading(false);
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
                      <Server className="w-4 h-4 shrink-0 text-gray-500" />
                      Target instance
                    </span>
                  </td>
                  <td className="py-1.5 text-white">
                    {(() => {
                      const tid = jobDetails.target_server_instance_id ?? 1;
                      const tname = (jobDetails.target_server_instance_name || "").trim();
                      const label = tname ? `${tname} (ID ${tid})` : `ID ${tid}`;
                      if (jobDetails.queue_all_target_all_downloaders) {
                        return (
                          <div className="space-y-1">
                            <span className="text-cyan-400 text-sm">Target all downloaders (fan-out)</span>
                            <div className="text-xs text-gray-400">
                              Job owner / base instance: <span className="text-gray-300">{label}</span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <span>
                          {tname ? (
                            <>
                              <span className="text-white">{tname}</span>
                              <span className="text-gray-400 font-mono text-sm ml-2">(ID {tid})</span>
                            </>
                          ) : (
                            <span className="font-mono text-sm text-gray-300">ID {tid}</span>
                          )}
                        </span>
                      );
                    })()}
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
                {(jobDetails.user_id != null || jobDetails.username != null) && (
                  <tr>
                    <td className="py-1.5 pr-4 text-gray-400 align-top">
                      <span className="inline-flex items-center gap-1.5">
                        <User className="w-4 h-4 shrink-0 text-gray-500" />
                        Queued by
                      </span>
                    </td>
                    <td className="py-1.5 text-white">
                      {jobDetails.username != null ? `${jobDetails.username} (ID ${jobDetails.user_id})` : `ID ${jobDetails.user_id}`}
                    </td>
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
                  <td className="py-1.5 text-white">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      {jobDetails.acknowledge_flag ? "Yes" : "No"}
                      <Tooltip title={jobDetails.acknowledge_flag ? "Mark as not acknowledged" : "Mark as acknowledged"} side="top" wrap>
                        <button
                          type="button"
                          onClick={toggleAcknowledge}
                          disabled={acknowledgeLoading}
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border transition-colors disabled:opacity-50",
                            jobDetails.acknowledge_flag
                              ? "border-green-800 text-green-400 hover:bg-green-950/40"
                              : "border-gray-600 text-gray-200 hover:bg-gray-800"
                          )}
                        >
                          {acknowledgeLoading ? (
                            "…"
                          ) : jobDetails.acknowledge_flag ? (
                            <>
                              <Undo2 className="w-3.5 h-3.5 shrink-0" />
                              Unacknowledge
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              Acknowledge
                            </>
                          )}
                        </button>
                      </Tooltip>
                    </span>
                  </td>
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
              <Tooltip
                title={
                  jobDetails.status === "new"
                    ? "Cancel this queued job"
                    : "Only jobs with status New can be cancelled"
                }
                side="top"
                wrap
              >
                <span
                  className={cn(
                    "inline-flex rounded",
                    jobDetails.status !== "new" && "cursor-not-allowed"
                  )}
                >
                  <button
                    type="button"
                    disabled={jobDetails.status !== "new"}
                    onClick={() => setShowCancelConfirm(true)}
                    className={cn(
                      "p-2 rounded transition-colors",
                      jobDetails.status === "new"
                        ? "text-red-400 hover:text-red-300 hover:bg-gray-700"
                        : "text-gray-500 opacity-50 pointer-events-none"
                    )}
                  >
                    Cancel job
                  </button>
                </span>
              </Tooltip>
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

      {showCancelConfirm && (
        <Modal title="Cancel job" onClose={() => !cancelJobLoading && setShowCancelConfirm(false)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
              <div className="rounded-full bg-red-900/50 p-2 text-red-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                Are you sure you want to cancel this job?
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelJobLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Keep job
              </button>
              <button
                type="button"
                onClick={handleCancelJobConfirm}
                disabled={cancelJobLoading}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {cancelJobLoading ? "Cancelling…" : "Yes, cancel job"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
