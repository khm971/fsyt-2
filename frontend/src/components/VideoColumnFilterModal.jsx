import { useState, useEffect } from "react";
import { api } from "../api/client";
import Modal from "./Modal";

const OPTIONAL_COLUMNS = [
  { key: "id", label: "ID", defaultVisible: true },
  { key: "title", label: "Title (with tags)", defaultVisible: true },
  { key: "provider_key", label: "Provider key", defaultVisible: false },
  { key: "channel", label: "Channel", defaultVisible: false },
  { key: "duration", label: "Duration", defaultVisible: false },
  { key: "upload_date", label: "Upload date", defaultVisible: false },
  { key: "record_created", label: "Record created", defaultVisible: false },
  { key: "download_date", label: "Download date", defaultVisible: false },
  { key: "watch_progress", label: "Watch progress", defaultVisible: false },
  { key: "created_by", label: "Created by", defaultVisible: false },
  { key: "status", label: "Status (raw)", defaultVisible: false },
];

export const DEFAULT_VISIBLE_COLUMNS = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

/** Sentinel `status` filter value; API matches any status containing "error" (case-insensitive). */
export const VIDEO_STATUS_FILTER_ANY_ERROR = "__any_error__";

const EMPTY_FILTERS = {
  channel_id: "",
  status: "",
  title_contains: "",
  has_file: null,
  has_transcode: null,
  watch_finished: null,
  tag_id: "",
  include_ignored: false,
  record_created_from: "",
  record_created_to: "",
  video_id: "",
};

const BOOL_OPTIONS = [
  { value: "", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function VideoColumnFilterModal({
  visibleColumns,
  onVisibleColumnsChange,
  filters,
  onFiltersChange,
  channels,
  onClose,
}) {
  const [filterOptions, setFilterOptions] = useState({ statuses: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [localColumns, setLocalColumns] = useState(() => [...visibleColumns]);
  const [localFilters, setLocalFilters] = useState(() => ({ ...filters }));

  useEffect(() => {
    setLocalColumns([...visibleColumns]);
    setLocalFilters({ ...filters });
  }, [visibleColumns, filters]);

  useEffect(() => {
    setLoading(true);
    api.videos
      .filterOptions()
      .then((data) => setFilterOptions({ statuses: data.statuses || [], tags: data.tags || [] }))
      .catch(() => setFilterOptions({ statuses: [], tags: [] }))
      .finally(() => setLoading(false));
  }, []);

  const handleApply = () => {
    onVisibleColumnsChange(localColumns);
    onFiltersChange(localFilters);
    onClose();
  };

  const handleClearFilters = () => {
    const cleared = { ...EMPTY_FILTERS };
    setLocalFilters(cleared);
    onVisibleColumnsChange(localColumns);
    onFiltersChange(cleared);
    onClose();
  };

  const handleResetColumns = () => {
    setLocalColumns([...DEFAULT_VISIBLE_COLUMNS]);
  };

  const toggleColumn = (key) => {
    setLocalColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const updateFilter = (name, value) => {
    setLocalFilters((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Modal title="Columns and filters" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-6 max-h-[70vh] overflow-y-auto overflow-x-hidden">
        <section>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Columns</h4>
          <p className="text-xs text-gray-500 mb-2">Flags and Actions are always shown.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {OPTIONAL_COLUMNS.map((col) => (
              <label key={col.key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localColumns.includes(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                />
                {col.label}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={handleResetColumns}
            className="mt-2 text-xs text-gray-400 hover:text-gray-300"
          >
            Reset to default columns
          </button>
        </section>

        <section>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Filters</h4>
          <p className="text-xs text-gray-500 mb-3">All filters are ANDed together.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="text-gray-400 block mb-1">Channel</span>
              <select
                value={localFilters.channel_id}
                onChange={(e) => updateFilter("channel_id", e.target.value)}
                className="input w-full min-w-0"
              >
                <option value="">— All channels —</option>
                {(channels || []).map((ch) => (
                  <option key={ch.channel_id} value={String(ch.channel_id)}>
                    {ch.title || ch.handle || ch.channel_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Status</span>
              <select
                value={localFilters.status}
                onChange={(e) => updateFilter("status", e.target.value)}
                className="input w-full min-w-0"
              >
                <option value="">— Any —</option>
                <option value={VIDEO_STATUS_FILTER_ANY_ERROR}>Any Error</option>
                {loading ? (
                  <option disabled>Loading…</option>
                ) : (
                  filterOptions.statuses
                    .filter((s) => s !== VIDEO_STATUS_FILTER_ANY_ERROR)
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))
                )}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-gray-400 block mb-1">Title contains</span>
              <input
                type="text"
                value={localFilters.title_contains}
                onChange={(e) => updateFilter("title_contains", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Substring match"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Tag</span>
              <select
                value={localFilters.tag_id}
                onChange={(e) => updateFilter("tag_id", e.target.value)}
                className="input w-full min-w-0"
              >
                <option value="">— Any —</option>
                {filterOptions.tags.map((t) => (
                  <option key={t.tag_id} value={String(t.tag_id)}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Video ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.video_id}
                onChange={(e) => updateFilter("video_id", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Any"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Has file on disk</span>
              <select
                value={localFilters.has_file === null ? "" : String(localFilters.has_file)}
                onChange={(e) => updateFilter("has_file", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full min-w-0"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Has transcode</span>
              <select
                value={localFilters.has_transcode === null ? "" : String(localFilters.has_transcode)}
                onChange={(e) => updateFilter("has_transcode", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full min-w-0"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Watch finished</span>
              <select
                value={localFilters.watch_finished === null ? "" : String(localFilters.watch_finished)}
                onChange={(e) => updateFilter("watch_finished", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full min-w-0"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer mt-6 sm:mt-8">
              <input
                type="checkbox"
                checked={localFilters.include_ignored}
                onChange={(e) => setLocalFilters((prev) => ({ ...prev, include_ignored: e.target.checked }))}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 shrink-0"
              />
              <span className="text-sm">Show ignored videos</span>
            </label>
            <div className="sm:col-span-2 border-t border-gray-700 pt-3 mt-1">
              <span className="text-gray-400 block mb-2">Date ranges</span>
              <div>
                <span className="text-xs text-gray-500 block mb-1">Record created</span>
                <div className="flex flex-wrap gap-2 items-center min-w-0">
                  <input
                    type="datetime-local"
                    value={localFilters.record_created_from ? toDatetimeLocalValue(localFilters.record_created_from) : ""}
                    onChange={(e) =>
                      updateFilter("record_created_from", e.target.value ? new Date(e.target.value).toISOString() : "")
                    }
                    className="input flex-1 min-w-[8rem]"
                  />
                  <span className="text-gray-500 shrink-0">to</span>
                  <input
                    type="datetime-local"
                    value={localFilters.record_created_to ? toDatetimeLocalValue(localFilters.record_created_to) : ""}
                    onChange={(e) =>
                      updateFilter("record_created_to", e.target.value ? new Date(e.target.value).toISOString() : "")
                    }
                    className="input flex-1 min-w-[8rem]"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700 flex-wrap">
        <button type="button" onClick={handleClearFilters} className="btn-secondary">
          Clear filters
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button type="button" onClick={handleApply} className="btn-primary">
          Apply
        </button>
      </div>
    </Modal>
  );
}

export { EMPTY_FILTERS };
