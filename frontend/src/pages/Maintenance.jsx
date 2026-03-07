import { useState } from "react";
import { AlertTriangle, History, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import Modal from "../components/Modal";

export default function Maintenance({ setError }) {
  const toast = useToast();
  const [confirmingAction, setConfirmingAction] = useState(null);
  const [isClearing, setIsClearing] = useState(false);

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
              Run one-off maintenance actions that affect the database, cached media, and related system state.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-red-900/70 bg-red-950/20 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-red-900/40 p-2 text-red-300">
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
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
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

      {confirmingAction === "transcodes" && (
        <Modal title="Clear Transcodes" onClose={() => !isClearing && setConfirmingAction(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
              <div className="rounded-full bg-red-900/50 p-2 text-red-300">
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
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
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
