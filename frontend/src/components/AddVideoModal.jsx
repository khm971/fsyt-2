import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";

export function AddVideoModal({ open, onClose, setError, onSuccess }) {
  const toast = useToast();
  const [addForm, setAddForm] = useState({
    provider_key: "",
    queue_download: true,
    tag_needs_review: true,
    target_server_instance_id: "1",
  });
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [serverInstances, setServerInstances] = useState([]);

  useEffect(() => {
    if (open) {
      setAddForm({
        provider_key: "",
        queue_download: true,
        tag_needs_review: true,
        target_server_instance_id: "1",
      });
      setAddSubmitting(false);
      api.serverInstances
        .list()
        .then(setServerInstances)
        .catch(() => setServerInstances([]));
    }
  }, [open]);

  const saveAdd = async () => {
    if (addSubmitting) return;
    setAddSubmitting(true);
    try {
      const v = await api.videos.create({
        provider_key: addForm.provider_key,
        queue_download: addForm.queue_download,
        tag_needs_review: addForm.tag_needs_review !== false,
        target_server_instance_id: parseInt(addForm.target_server_instance_id, 10) || 1,
      });
      onClose();
      onSuccess?.(v);
      toast.addToast(
        `Video added (ID ${v.video_id})${addForm.queue_download ? ", download queued" : ""}`,
        "success"
      );
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setAddSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => {
        if (!addSubmitting) onClose();
      }}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-white mb-4">Add video</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-gray-400 block mb-1">YouTube video ID or full URL</span>
            <input
              type="text"
              value={addForm.provider_key}
              onChange={(e) => setAddForm({ ...addForm, provider_key: e.target.value })}
              className="input"
              placeholder="https://www.youtube.com/watch?v=... or video ID"
              disabled={addSubmitting}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={addForm.queue_download}
              onChange={(e) => setAddForm({ ...addForm, queue_download: e.target.checked })}
              className="rounded border-gray-600 bg-gray-800"
              disabled={addSubmitting}
            />
            <span className={addSubmitting ? "text-gray-500" : "text-gray-400"}>Queue download</span>
          </label>
          {addForm.queue_download && (
            <label className="block">
              <span className="text-gray-400 block mb-1">Target server instance</span>
              <select
                value={String(addForm.target_server_instance_id)}
                onChange={(e) => setAddForm({ ...addForm, target_server_instance_id: e.target.value })}
                className="input w-full"
                disabled={addSubmitting}
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
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={addForm.tag_needs_review !== false}
              onChange={(e) => setAddForm({ ...addForm, tag_needs_review: e.target.checked })}
              className="rounded border-gray-600 bg-gray-800"
              disabled={addSubmitting}
            />
            <span className={addSubmitting ? "text-gray-500" : "text-gray-400"}>Tag with Needs Review</span>
          </label>
        </div>
        <div className="flex flex-col gap-2 mt-4">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={addSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveAdd}
              className="btn-primary inline-flex items-center justify-center gap-2 min-w-[5.5rem]"
              disabled={addSubmitting}
            >
              {addSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden />
                  <span>Adding…</span>
                </>
              ) : (
                "Add"
              )}
            </button>
          </div>
          {addSubmitting && (
            <p className="text-xs text-gray-500 text-right">Contacting the server…</p>
          )}
        </div>
      </div>
    </div>
  );
}
