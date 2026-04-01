import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { cn, formatDateTimeWithSeconds } from "../lib/utils";
import { Plus, Pencil, Trash2, Download, RefreshCw, Image, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { Tooltip } from "../components/Tooltip";
import ConfirmModal from "../components/Modal";
import { ChannelEditModal } from "../components/ChannelEditModal";
import { PaginationBar } from "../components/PaginationBar";
import ChannelColumnFilterModal, {
  DEFAULT_VISIBLE_COLUMNS,
  EMPTY_FILTERS,
} from "../components/ChannelColumnFilterModal";

const CHANNELS_VISIBLE_COLUMNS_KEY = "channelsVisibleColumns";
const CHANNELS_FILTERS_KEY = "channelsFilters";

function loadStoredColumns() {
  try {
    const s = localStorage.getItem(CHANNELS_VISIBLE_COLUMNS_KEY);
    if (!s) return [...DEFAULT_VISIBLE_COLUMNS];
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && parsed.v === 2 && Array.isArray(parsed.columns)) {
      const cols = parsed.columns;
      if (cols.length === 0) return [...DEFAULT_VISIBLE_COLUMNS];
      return cols;
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const merged = [...DEFAULT_VISIBLE_COLUMNS];
      for (const k of parsed) {
        if (!merged.includes(k)) merged.push(k);
      }
      return merged;
    }
  } catch (_) {}
  return [...DEFAULT_VISIBLE_COLUMNS];
}

function persistVisibleColumns(cols) {
  try {
    localStorage.setItem(CHANNELS_VISIBLE_COLUMNS_KEY, JSON.stringify({ v: 2, columns: cols }));
  } catch (_) {}
}

function loadStoredFilters() {
  try {
    const s = localStorage.getItem(CHANNELS_FILTERS_KEY);
    if (s) {
      const o = JSON.parse(s);
      if (o && typeof o === "object") return { ...EMPTY_FILTERS, ...o };
    }
  } catch (_) {}
  return { ...EMPTY_FILTERS };
}

function filtersToParams(filters) {
  const p = {};
  const t = (filters.title_contains || "").trim();
  if (t) p.title_contains = t;
  if (filters.auto_download === true || filters.auto_download === false) {
    p.is_enabled_for_auto_download = filters.auto_download;
  }
  return p;
}

function hasActiveFilters(filters) {
  return !!(filters.title_contains?.trim() || filters.auto_download !== null);
}

export default function Channels({ setError }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [showAdd, setShowAdd] = useState(false);
  const [showColumnFilterModal, setShowColumnFilterModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(loadStoredColumns);
  const [filters, setFilters] = useState(loadStoredFilters);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState(null);
  const [deleteChannelLoading, setDeleteChannelLoading] = useState(false);
  const [form, setForm] = useState({
    provider_key: "",
    handle: "",
    title: "",
    url: "",
    is_enabled_for_auto_download: false,
  });

  const filterListParams = useMemo(() => filtersToParams(filters), [filters]);
  const activeFilters = hasActiveFilters(filters);

  const load = useCallback(async () => {
    try {
      const list = await api.channels.list({
        sort_by: sortBy,
        sort_order: sortOrder,
        ...filterListParams,
      });
      setChannels(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortOrder, filterListParams, setError]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const persistFilters = (next) => {
    setFilters(next);
    try {
      localStorage.setItem(CHANNELS_FILTERS_KEY, JSON.stringify(next));
    } catch (_) {}
  };

  const openAdd = () => {
    setForm({
      provider_key: "",
      handle: "",
      title: "",
      url: "",
      is_enabled_for_auto_download: false,
    });
    setShowAdd(true);
  };

  const openEdit = (ch) => {
    setEditingChannelId(ch.channel_id);
  };

  const closeEdit = () => {
    setEditingChannelId(null);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("edit");
      return p;
    });
  };

  useEffect(() => {
    const editId = searchParams.get("edit");
    const id = editId != null && editId !== "" ? parseInt(editId, 10) : NaN;
    if (!Number.isFinite(id)) return;
    setEditingChannelId(id);
  }, [searchParams]);

  const saveAdd = async () => {
    try {
      const ch = await api.channels.create(form);
      setShowAdd(false);
      load();
      toast.addToast(`Channel created (ID ${ch.channel_id})`, "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const performDeleteChannel = async () => {
    if (confirmDeleteChannelId == null) return;
    setDeleteChannelLoading(true);
    try {
      await api.channels.delete(confirmDeleteChannelId);
      load();
      toast.addToast("Channel deleted", "success");
      setConfirmDeleteChannelId(null);
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setDeleteChannelLoading(false);
    }
  };

  const queueChannelJob = async (channelId, jobType, parameter = null) => {
    try {
      const body = { job_type: jobType, channel_id: channelId, priority: 50 };
      if (parameter != null) body.parameter = String(parameter);
      const j = await api.queue.create(body);
      setError(null);
      const extra = parameter != null ? `, param=${parameter}` : "";
      toast.addToast(`Job queued: ${jobType} (ID ${j.job_queue_id}, channel ${channelId}${extra})`, "info");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    }
  };

  const total = channels.length;
  const pageSize = Math.max(total, 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">Channels</h2>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm"
          >
            <Plus className="w-4 h-4" />
            Add channel
          </button>
        </div>
      </div>

      <PaginationBar
        page={1}
        totalPages={1}
        total={total}
        pageSize={pageSize}
        itemLabel="channels"
        onPageChange={() => {}}
        disabled={loading}
        onFilterClick={() => setShowColumnFilterModal(true)}
        filterActive={activeFilters}
        onClearFilters={() => {
          const next = { ...EMPTY_FILTERS };
          persistFilters(next);
        }}
      />

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-hidden">
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Loading...</div>
        )}
        {!loading && (
          <table className="w-full text-left text-sm table-fixed">
            <thead className="bg-gray-800/80 text-gray-400">
              <tr>
                {visibleColumns.includes("id") && (
                  <th className="px-4 py-3 font-medium w-20">
                    <div className="flex items-center gap-1">
                      ID
                      <Tooltip title={sortBy === "id" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by ID"}>
                        <button
                          type="button"
                          onClick={() => { if (sortBy === "id") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("id"); setSortOrder("asc"); } }}
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
                )}
                {visibleColumns.includes("title") && (
                  <th className="px-4 py-3 font-medium min-w-0">
                    <div className="flex items-center gap-1">
                      Handle / Title
                      <Tooltip title={sortBy === "title" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by Title"}>
                        <button
                          type="button"
                          onClick={() => { if (sortBy === "title") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("title"); setSortOrder("asc"); } }}
                          className={cn(
                            "p-0.5 rounded hover:bg-gray-700",
                            sortBy === "title" ? "text-blue-400" : "text-gray-500 hover:text-gray-400"
                          )}
                        >
                          {sortBy === "title" ? (sortOrder === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />) : <ArrowUpDown className="w-3.5 h-3.5" />}
                        </button>
                      </Tooltip>
                    </div>
                  </th>
                )}
                {visibleColumns.includes("videos") && (
                  <th className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1">
                      Videos
                      <Tooltip title={sortBy === "status" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by available video count"}>
                        <button
                          type="button"
                          onClick={() => { if (sortBy === "status") setSortOrder((o) => (o === "asc" ? "desc" : "asc")); else { setSortBy("status"); setSortOrder("desc"); } }}
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
                )}
                {visibleColumns.includes("provider_key") && (
                  <th className="px-4 py-3 font-medium">Provider key</th>
                )}
                {visibleColumns.includes("record_created") && (
                  <th className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1">
                      Record created
                      <Tooltip title={sortBy === "record_created" ? (sortOrder === "asc" ? "Sort ascending (click to toggle)" : "Sort descending (click to toggle)") : "Sort by record created"}>
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
                )}
                {visibleColumns.includes("record_updated") && (
                  <th className="px-4 py-3 font-medium">Record updated</th>
                )}
                {visibleColumns.includes("created_by") && (
                  <th className="px-4 py-3 font-medium">Created by</th>
                )}
                {visibleColumns.includes("url") && (
                  <th className="px-4 py-3 font-medium">URL</th>
                )}
                {visibleColumns.includes("folder_on_disk") && (
                  <th className="px-4 py-3 font-medium">Folder</th>
                )}
                {visibleColumns.includes("auto_dl") && (
                  <th className="px-4 py-3 font-medium">Auto DL</th>
                )}
                <th className="px-4 py-3 font-medium w-48">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {channels.map((ch) => (
                <tr key={ch.channel_id} className="hover:bg-gray-800/30">
                  {visibleColumns.includes("id") && (
                    <td className="px-4 py-2 font-mono text-gray-300">{ch.channel_id}</td>
                  )}
                  {visibleColumns.includes("title") && (
                    <td className="px-4 py-2 min-w-0">
                      <Link
                        to={`/videos?channel_id=${ch.channel_id}`}
                        className="text-white hover:text-blue-400 hover:underline truncate block"
                      >
                        {ch.title || ch.handle || ch.provider_key || "—"}
                      </Link>
                    </td>
                  )}
                  {visibleColumns.includes("videos") && (
                    <td className="px-4 py-2 font-mono text-gray-400">
                      {ch.video_count != null
                        ? ch.video_count_done != null && ch.video_count_done < ch.video_count
                          ? `${ch.video_count} (${ch.video_count_done} available)`
                          : ch.video_count
                        : "—"}
                    </td>
                  )}
                  {visibleColumns.includes("provider_key") && (
                    <td className="px-4 py-2 font-mono text-gray-400 text-xs truncate" title={ch.provider_key || undefined}>
                      {ch.provider_key || "—"}
                    </td>
                  )}
                  {visibleColumns.includes("record_created") && (
                    <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                      {ch.record_created ? formatDateTimeWithSeconds(ch.record_created) : "—"}
                    </td>
                  )}
                  {visibleColumns.includes("record_updated") && (
                    <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                      {ch.record_updated ? formatDateTimeWithSeconds(ch.record_updated) : "—"}
                    </td>
                  )}
                  {visibleColumns.includes("created_by") && (
                    <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[8rem]" title={ch.created_by_username || undefined}>
                      {ch.created_by_username || "—"}
                    </td>
                  )}
                  {visibleColumns.includes("url") && (
                    <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[10rem]" title={ch.url || undefined}>
                      {ch.url || "—"}
                    </td>
                  )}
                  {visibleColumns.includes("folder_on_disk") && (
                    <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-[10rem]" title={ch.folder_on_disk || undefined}>
                      {ch.folder_on_disk || "—"}
                    </td>
                  )}
                  {visibleColumns.includes("auto_dl") && (
                    <td className="px-4 py-2">
                      {ch.is_enabled_for_auto_download ? (
                        <span className="text-green-400">Yes</span>
                      ) : (
                        <span className="text-gray-500">No</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2 flex flex-wrap gap-1">
                    <Tooltip title="Download one channel (scan latest videos)">
                      <button
                        type="button"
                        onClick={() => queueChannelJob(ch.channel_id, "download_one_channel", 10)}
                        className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip title="Update channel info">
                      <button
                        type="button"
                        onClick={() => queueChannelJob(ch.channel_id, "update_channel_info")}
                        className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-gray-700 rounded"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip title="Download channel artwork">
                      <button
                        type="button"
                        onClick={() => queueChannelJob(ch.channel_id, "download_channel_artwork")}
                        className="p-1.5 text-gray-400 hover:text-purple-400 hover:bg-gray-700 rounded"
                      >
                        <Image className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <button
                        type="button"
                        onClick={() => openEdit(ch)}
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteChannelId(ch.channel_id)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && channels.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500">No channels yet.</div>
        )}
      </div>

      {showColumnFilterModal && (
        <ChannelColumnFilterModal
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={(cols) => {
            setVisibleColumns(cols);
            persistVisibleColumns(cols);
          }}
          filters={filters}
          onFiltersChange={(newFilters) => {
            persistFilters(newFilters);
          }}
          onClose={() => setShowColumnFilterModal(false)}
        />
      )}

      {confirmDeleteChannelId != null && (
        <ConfirmModal title="Delete channel" onClose={() => !deleteChannelLoading && setConfirmDeleteChannelId(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
              <div className="rounded-full bg-red-900/50 p-2 text-red-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-white">
                Are you sure you want to delete this channel?
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteChannelId(null)}
                disabled={deleteChannelLoading}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performDeleteChannel}
                disabled={deleteChannelLoading}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deleteChannelLoading ? "Deleting…" : "Yes, delete channel"}
              </button>
            </div>
          </div>
        </ConfirmModal>
      )}

      {showAdd && (
        <AddChannelModal title="Add channel" onClose={() => setShowAdd(false)}>
          <ChannelForm form={form} setForm={setForm} />
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={saveAdd} className="btn-primary">
              Create
            </button>
          </div>
        </AddChannelModal>
      )}

      <ChannelEditModal
        channelId={editingChannelId}
        onClose={closeEdit}
        onSaved={() => {
          load();
          toast.addToast("Channel updated", "success");
        }}
        setError={setError}
      />
    </div>
  );
}

function AddChannelModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-md w-full mx-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ChannelForm({ form, setForm }) {
  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="text-gray-400 block mb-1">Provider key</span>
        <input
          type="text"
          value={form.provider_key}
          onChange={(e) => setForm({ ...form, provider_key: e.target.value })}
          className="input"
        />
      </label>
      <label className="block">
        <span className="text-gray-400 block mb-1">Handle</span>
        <input
          type="text"
          value={form.handle}
          onChange={(e) => setForm({ ...form, handle: e.target.value })}
          className="input"
        />
      </label>
      <label className="block">
        <span className="text-gray-400 block mb-1">Title</span>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="input"
        />
      </label>
      <label className="block">
        <span className="text-gray-400 block mb-1">URL</span>
        <input
          type="text"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          className="input"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={form.is_enabled_for_auto_download}
          onChange={(e) => setForm({ ...form, is_enabled_for_auto_download: e.target.checked })}
          className="rounded border-gray-600 bg-gray-800 text-blue-500"
        />
        <span className="text-gray-400">Auto download</span>
      </label>
    </div>
  );
}
