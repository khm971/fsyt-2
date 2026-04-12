import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Server, Plus, Pencil } from "lucide-react";
import Modal from "../components/Modal";

export default function ServerInstances({ setError }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editDownloader, setEditDownloader] = useState(true);

  const load = () => {
    api.serverInstances
      .list()
      .then(setRows)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setLoading(true);
    api.serverInstances
      .list()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const openEdit = (r) => {
    setEditRow(r);
    setEditName(r.display_name ?? "");
    setEditEnabled(!!r.is_enabled);
    setEditDownloader(!!r.assign_download_jobs);
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    try {
      await api.serverInstances.update(editRow.server_instance_id, {
        display_name: editName.trim() || `Instance ${editRow.server_instance_id}`,
        is_enabled: editEnabled,
        assign_download_jobs: editDownloader,
      });
      toast.addToast("Instance updated", "success");
      setEditRow(null);
      load();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const createInstance = async () => {
    const id = parseInt(newId, 10);
    if (!id || id < 1) {
      toast.addToast("Enter a positive numeric instance ID", "error");
      return;
    }
    setSaving(true);
    try {
      await api.serverInstances.create({
        server_instance_id: id,
        display_name: newName.trim() || `Instance ${id}`,
        is_enabled: true,
        assign_download_jobs: true,
      });
      toast.addToast("Instance created", "success");
      setShowAdd(false);
      setNewId("");
      setNewName("");
      load();
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Server className="w-5 h-5" />
            Server instances
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Each running backend sets <code className="text-gray-300">SERVER_INSTANCE_ID</code> in{" "}
            <code className="text-gray-300">.env</code> to match a row here. Configure names, enabled state, and
            download assignment.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white"
        >
          <Plus className="w-4 h-4" />
          Add instance ID
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-800/80 text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Running</th>
              <th className="px-4 py-3 font-medium">Last heartbeat</th>
              <th className="px-4 py-3 font-medium">Enabled</th>
              <th className="px-4 py-3 font-medium">Downloader</th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((r) => (
              <tr key={r.server_instance_id} className="hover:bg-gray-800/30">
                <td className="px-4 py-2 font-mono text-gray-300">{r.server_instance_id}</td>
                <td className="px-4 py-2 text-white">{r.display_name}</td>
                <td className="px-4 py-2">
                  <span className={r.is_running ? "text-green-400" : "text-gray-500"}>
                    {r.is_running ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-gray-400">
                  {r.last_heartbeat_utc ? new Date(r.last_heartbeat_utc).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2">{r.is_enabled ? "Yes" : "No"}</td>
                <td className="px-4 py-2">{r.assign_download_jobs ? "Yes" : "No"}</td>
                <td className="px-4 py-2 text-xs space-x-2">
                  {r.duplicate_id_conflict && (
                    <span className="text-red-400">Duplicate process</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="Add server instance" onClose={() => !saving && setShowAdd(false)}>
          <div className="space-y-3 text-sm">
            <label className="block text-gray-300">
              Instance ID (integer)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
              />
            </label>
            <label className="block text-gray-300">
              Display name
              <input
                type="text"
                className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-1.5 rounded bg-gray-700 text-gray-200" onClick={() => setShowAdd(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={createInstance} disabled={saving}>
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editRow && (
        <Modal title={`Edit instance ${editRow.server_instance_id}`} onClose={() => !saving && setEditRow(null)}>
          <div className="space-y-3 text-sm">
            <label className="block text-gray-300">
              Display name
              <input
                type="text"
                className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
              Enabled (worker will not dequeue jobs when off)
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input type="checkbox" checked={editDownloader} onChange={(e) => setEditDownloader(e.target.checked)} />
              Include when assigning download jobs (target-all downloaders)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-1.5 rounded bg-gray-700 text-gray-200" onClick={() => setEditRow(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={saveEdit} disabled={saving}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
