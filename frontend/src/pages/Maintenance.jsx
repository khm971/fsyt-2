import { useState, useEffect } from "react";
import { AlertTriangle, CalendarX2, History, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import Modal from "../components/Modal";

function formatRunAfter(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function Maintenance({ setError }) {
  const toast = useToast();
  const [confirmingAction, setConfirmingAction] = useState(null);
  const [isClearing, setIsClearing] = useState(false);
  const [cancelFuturePreview, setCancelFuturePreview] = useState(null);
  const [cancelFuturePreviewLoading, setCancelFuturePreviewLoading] = useState(false);

  useEffect(() => {
    if (confirmingAction !== "cancelFutureJobs") return;
    setCancelFuturePreview(null);
    setCancelFuturePreviewLoading(true);
    api.maintenance
      .getCancelPendingFutureJobsPreview()
      .then(setCancelFuturePreview)
      .catch((e) => {
        setError(e.message);
        toast.addToast(e.message, "error");
      })
      .finally(() => setCancelFuturePreviewLoading(false));
  }, [confirmingAction, setError, toast]);

  const cancelPendingFutureJobs = async () => {
    setIsClearing(true);
    try {
      const { cancelled_count } = await api.maintenance.cancelPendingFutureJobs();
      setConfirmingAction(null);
      toast.addToast(`Cancelled ${cancelled_count} pending future job(s).`, "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIsClearing(false);
    }
  };

  const clearTranscodes = async () => {
    setIsClearing(true);
    try {
      await api.maintenance.clearTranscodes();
      setConfirmingAction(null);
      toast.addToast("Deleted all transcodes.", "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIsClearing(false);
    }
  };

  const clearWatchHistory = async () => {
    setIsClearing(true);
    try {
      await api.maintenance.clearWatchHistory();
      setConfirmingAction(null);
      toast.addToast("Cleared all watch history.", "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Maintenance</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Run one-off maintenance actions that affect the database, cached media, job queue, and related system state.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-blue-900/70 bg-blue-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-blue-900/40 p-2 text-blue-300">
              <CalendarX2 className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-white">Cancel Pending Future Jobs</h4>
              <p className="mt-1 text-sm text-gray-400">
                Sets status to Cancelled for all jobs in the queue that are NEW and scheduled to run at a future time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingAction("cancelFutureJobs")}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              Cancel Pending Future Jobs
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-yellow-900/70 bg-yellow-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-yellow-900/40 p-2 text-yellow-300">
              <Trash2 className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-white">Clear Transcodes</h4>
              <p className="mt-1 text-sm text-gray-400">
                Deletes everything under `/media/_transcodes` and clears all stored
                `transcode_path` values from the database.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingAction("transcodes")}
              className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600"
            >
              Clear Transcodes
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-red-900/70 bg-red-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-red-900/40 p-2 text-red-300">
              <History className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-white">Clear Watch History</h4>
              <p className="mt-1 text-sm text-gray-400">
                Resets progress for all videos: sets progress_seconds and progress_percent to 0,
                and is_finished to false for every user_video record.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingAction("watchHistory")}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              Clear Watch History
            </button>
          </div>
        </div>
        </div>
      </div>

      {confirmingAction === "cancelFutureJobs" && (
        <Modal title="Cancel Pending Future Jobs" onClose={() => !isClearing && setConfirmingAction(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-blue-900/60 bg-blue-950/30 p-4">
              <div className="rounded-full bg-blue-900/50 p-2 text-blue-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  {cancelFuturePreviewLoading
                    ? "Loading..."
                    : cancelFuturePreview?.count === 0
                      ? "No pending future jobs to cancel."
                      : "Are you sure you want to cancel all pending future jobs?"}
                </p>
                {!cancelFuturePreviewLoading && cancelFuturePreview && cancelFuturePreview.count > 0 && (
                  <p className="mt-2 text-sm text-gray-400">
                    This will cancel <strong>{cancelFuturePreview.count}</strong> pending job(s) scheduled for the future.
                    {cancelFuturePreview.first_run_after != null && (
                      <> First would run: {formatRunAfter(cancelFuturePreview.first_run_after)}.</>
                    )}
                    {cancelFuturePreview.last_run_after != null && (
                      <> Last would run: {formatRunAfter(cancelFuturePreview.last_run_after)}.</>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingAction(null)}
                disabled={isClearing}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={cancelPendingFutureJobs}
                disabled={isClearing || cancelFuturePreviewLoading || (cancelFuturePreview?.count ?? 0) === 0}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
              >
                {isClearing ? "Cancelling..." : "Yes, Cancel Pending Future Jobs"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmingAction === "transcodes" && (
        <Modal title="Clear Transcodes" onClose={() => !isClearing && setConfirmingAction(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-yellow-900/60 bg-yellow-950/30 p-4">
              <div className="rounded-full bg-yellow-900/50 p-2 text-yellow-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  Are you sure you want to clear all transcodes?
                </p>
                <p className="mt-2 text-sm text-gray-400">
                  This will delete all folders and files under `/media/_transcodes`,
                  reset every video&apos;s `transcode_path` to `null`, and stop any active
                  cached HLS transcodes.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingAction(null)}
                disabled={isClearing}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearTranscodes}
                disabled={isClearing}
                className="rounded-lg bg-yellow-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-50"
              >
                {isClearing ? "Clearing..." : "Yes, Clear Transcodes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {confirmingAction === "watchHistory" && (
        <Modal title="Clear Watch History" onClose={() => !isClearing && setConfirmingAction(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
              <div className="rounded-full bg-red-900/50 p-2 text-red-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  Are you sure you want to clear all watch history?
                </p>
                <p className="mt-2 text-sm text-gray-400">
                  This will reset progress_seconds and progress_percent to 0, and set is_finished
                  to false for every record in user_video. All watch progress will be lost.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingAction(null)}
                disabled={isClearing}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearWatchHistory}
                disabled={isClearing}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {isClearing ? "Clearing..." : "Yes, Clear Watch History"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
