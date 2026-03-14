import { useState, useEffect } from "react";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import Modal from "./Modal";
import {
  Bug,
  Info,
  Bell,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Hash,
  Clock,
  FileText,
  ListTodo,
  Film,
  Users,
  User,
  Settings,
  Cpu,
  Server,
} from "lucide-react";

const SEVERITY_COLORS = {
  5: "text-gray-500",
  10: "text-gray-400",
  20: "text-blue-400",
  25: "text-cyan-400",
  30: "text-yellow-400",
  40: "text-red-400",
  50: "text-red-600 font-semibold",
};

const SEVERITY_LABELS = {
  5: "Low",
  10: "Debug",
  20: "Info",
  25: "Notice",
  30: "Warning",
  40: "Error",
  50: "Critical",
};

function getSeverityIcon(severity) {
  if (severity >= 40) return AlertCircle;
  if (severity >= 30) return AlertTriangle;
  if (severity >= 25) return Bell;
  if (severity >= 20) return Info;
  return Bug;
}

export function LogEntryDetailsModal({
  eventLogId,
  onClose,
  setError,
  toast,
  onOpenJob,
  onOpenVideo,
  onOpenChannel,
  onAcknowledged,
}) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    if (eventLogId == null) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEntry(null);
    api.log
      .get(eventLogId)
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventLogId, setError]);

  const handleAck = async () => {
    if (entry?.acknowledged || !eventLogId) return;
    setAcking(true);
    try {
      await api.log.acknowledge(eventLogId);
      setEntry((prev) => (prev ? { ...prev, acknowledged: true } : prev));
      onAcknowledged?.();
      toast.addToast("Log entry acknowledged", "success");
    } catch (e) {
      setError(e.message);
    } finally {
      setAcking(false);
    }
  };

  const handleOpenJob = (id) => {
    onOpenJob?.(id);
  };
  const handleOpenVideo = (id) => {
    onOpenVideo?.(id);
  };
  const handleOpenChannel = (id) => {
    onOpenChannel?.(id);
  };

  const severity = entry?.severity ?? 20;
  const SeverityIcon = getSeverityIcon(severity);
  const severityColor = SEVERITY_COLORS[severity] ?? "text-gray-300";
  const severityLabel = SEVERITY_LABELS[severity] ?? "Info";

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <SeverityIcon className={cn("w-5 h-5 shrink-0", severityColor)} />
          <span className={severityColor}>Log entry details</span>
        </span>
      }
      onClose={onClose}
      maxWidthClass="max-w-2xl"
    >
      {loading && (
        <div className="text-gray-400 py-4">Loading…</div>
      )}
      {!loading && entry && (
        <div className="text-sm">
          <table className="w-full border-collapse">
            <tbody>
              {entry.event_log_id != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top w-40">
                    <span className="inline-flex items-center gap-1.5">
                      <Hash className="w-4 h-4 shrink-0 text-gray-500" />
                      Event log ID
                    </span>
                  </td>
                  <td className="py-1.5 text-white font-mono">{entry.event_log_id}</td>
                </tr>
              )}
              {entry.event_time != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4 shrink-0 text-gray-500" />
                      Event time
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{formatDateTimeWithSeconds(entry.event_time)}</td>
                </tr>
              )}
              {entry.severity != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <SeverityIcon className={cn("w-4 h-4 shrink-0", severityColor)} />
                      Severity
                    </span>
                  </td>
                  <td className={cn("py-1.5", severityColor)}>{severityLabel}</td>
                </tr>
              )}
              {entry.message != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="w-4 h-4 shrink-0 text-gray-500" />
                      Message
                    </span>
                  </td>
                  <td className="py-1.5 text-white whitespace-pre-wrap break-words">{entry.message}</td>
                </tr>
              )}
              {entry.acknowledged != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle className={cn("w-4 h-4 shrink-0", entry.acknowledged ? "text-green-400" : "text-gray-500")} />
                      Acknowledged
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{entry.acknowledged ? "Yes" : "No"}</td>
                </tr>
              )}
              {entry.job_id != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <ListTodo className="w-4 h-4 shrink-0 text-gray-500" />
                      Job ID
                    </span>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenJob(entry.job_id)}
                      className="text-blue-400 hover:text-blue-300 text-left font-mono"
                    >
                      {entry.job_id}
                    </button>
                  </td>
                </tr>
              )}
              {entry.video_id != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Film className="w-4 h-4 shrink-0 text-gray-500" />
                      Video ID
                    </span>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenVideo(entry.video_id)}
                      className="text-blue-400 hover:text-blue-300 text-left font-mono"
                    >
                      {entry.video_id}
                    </button>
                  </td>
                </tr>
              )}
              {entry.channel_id != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-4 h-4 shrink-0 text-gray-500" />
                      Channel ID
                    </span>
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenChannel(entry.channel_id)}
                      className="text-blue-400 hover:text-blue-300 text-left font-mono"
                    >
                      {entry.channel_id}
                    </button>
                  </td>
                </tr>
              )}
              {(entry.user_id != null || entry.username != null) && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top w-40">
                    <span className="inline-flex items-center gap-1.5">
                      <User className="w-4 h-4 shrink-0 text-gray-500" />
                      User
                    </span>
                  </td>
                  <td className="py-1.5 text-white">
                    {entry.username != null ? `${entry.username} (ID ${entry.user_id})` : `ID ${entry.user_id}`}
                  </td>
                </tr>
              )}
              {entry.subsystem != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Settings className="w-4 h-4 shrink-0 text-gray-500" />
                      Subsystem
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{entry.subsystem}</td>
                </tr>
              )}
              {entry.instance_id != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 shrink-0 text-gray-500" />
                      Instance ID
                    </span>
                  </td>
                  <td className="py-1.5 text-white font-mono">{entry.instance_id}</td>
                </tr>
              )}
              {entry.hostname != null && (
                <tr>
                  <td className="py-1.5 pr-4 text-gray-400 align-top">
                    <span className="inline-flex items-center gap-1.5">
                      <Server className="w-4 h-4 shrink-0 text-gray-500" />
                      Hostname
                    </span>
                  </td>
                  <td className="py-1.5 text-white">{entry.hostname}</td>
                </tr>
              )}
            </tbody>
          </table>
          {!entry.acknowledged && (
            <div className="pt-3 mt-3 border-t border-gray-800">
              <button
                type="button"
                onClick={handleAck}
                disabled={acking}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 text-sm disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                {acking ? "Acknowledging…" : "Acknowledge"}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
