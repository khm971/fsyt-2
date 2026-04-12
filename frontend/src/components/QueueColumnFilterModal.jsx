import { useState, useEffect } from "react";
import { api } from "../api/client";
import Modal from "./Modal";

const OPTIONAL_COLUMNS = [
  { key: "priority", label: "Priority", defaultVisible: true },
  { key: "video_id", label: "Video ID", defaultVisible: true },
  { key: "channel_id", label: "Channel ID", defaultVisible: false },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "record_created", label: "Record created", defaultVisible: true },
  { key: "last_update", label: "As of", defaultVisible: true },
  { key: "run_after", label: "Run after", defaultVisible: false },
  { key: "parameter", label: "Parameter", defaultVisible: false },
  { key: "scheduler_entry_id", label: "Scheduler entry", defaultVisible: false },
  { key: "target_server_instance_id", label: "Target instance", defaultVisible: true },
];

export const DEFAULT_VISIBLE_COLUMNS = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

const EMPTY_FILTERS = {
  status: "",
  job_type: "",
  video_id: "",
  channel_id: "",
  scheduled_future: null,
  has_error: null,
  has_warning: null,
  acknowledged: null,
  record_created_from: "",
  record_created_to: "",
  last_update_from: "",
  last_update_to: "",
  run_after_from: "",
  run_after_to: "",
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

export default function QueueColumnFilterModal({
  visibleColumns,
  onVisibleColumnsChange,
  filters,
  onFiltersChange,
  onClose,
}) {
  const [filterOptions, setFilterOptions] = useState({ statuses: [], job_types: [] });
  const [loading, setLoading] = useState(true);
  const [localColumns, setLocalColumns] = useState(() => [...visibleColumns]);
  const [localFilters, setLocalFilters] = useState(() => ({ ...filters }));

  useEffect(() => {
    setLocalColumns([...visibleColumns]);
    setLocalFilters({ ...filters });
  }, [visibleColumns, filters]);

  useEffect(() => {
    setLoading(true);
    api.queue
      .filterOptions()
      .then(setFilterOptions)
      .catch(() => setFilterOptions({ statuses: [], job_types: [] }))
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
    setLocalFilters((prev) => ({ ...prev, [name]: value === "" ? (name in EMPTY_FILTERS && EMPTY_FILTERS[name] === null ? null : "") : value }));
  };

  return (
    <Modal title="Columns and filters" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-6 max-h-[70vh] overflow-y-auto">
        <section>
          <h4 className="text-sm font-medium text-gray-300 mb-2">Columns</h4>
          <p className="text-xs text-gray-500 mb-2">ID, Type, Flags, and Actions are always shown.</p>
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
              <span className="text-gray-400 block mb-1">Status</span>
              <select
                value={localFilters.status}
                onChange={(e) => updateFilter("status", e.target.value)}
                className="input w-full"
              >
                <option value="">— Any —</option>
                {loading ? (
                  <option disabled>Loading…</option>
                ) : (
                  filterOptions.statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Type</span>
              <select
                value={localFilters.job_type}
                onChange={(e) => updateFilter("job_type", e.target.value)}
                className="input w-full"
              >
                <option value="">— Any —</option>
                {loading ? (
                  <option disabled>Loading…</option>
                ) : (
                  filterOptions.job_types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Video ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.video_id}
                onChange={(e) => updateFilter("video_id", e.target.value)}
                className="input w-full"
                placeholder="Any"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Channel ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.channel_id}
                onChange={(e) => updateFilter("channel_id", e.target.value)}
                className="input w-full"
                placeholder="Any"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Scheduled to run in the future</span>
              <select
                value={localFilters.scheduled_future === null ? "" : String(localFilters.scheduled_future)}
                onChange={(e) => updateFilter("scheduled_future", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Has error</span>
              <select
                value={localFilters.has_error === null ? "" : String(localFilters.has_error)}
                onChange={(e) => updateFilter("has_error", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Has warning</span>
              <select
                value={localFilters.has_warning === null ? "" : String(localFilters.has_warning)}
                onChange={(e) => updateFilter("has_warning", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Acknowledged</span>
              <select
                value={localFilters.acknowledged === null ? "" : String(localFilters.acknowledged)}
                onChange={(e) => updateFilter("acknowledged", e.target.value === "" ? null : e.target.value === "true")}
                className="input w-full"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 border-t border-gray-700 pt-3 mt-1">
              <span className="text-gray-400 block mb-2">Date ranges</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-500 block mb-1">Record created</span>
                  <div className="flex gap-2 items-center">
                    <input
                      type="datetime-local"
                      value={localFilters.record_created_from ? toDatetimeLocalValue(localFilters.record_created_from) : ""}
                      onChange={(e) => updateFilter("record_created_from", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="From"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="datetime-local"
                      value={localFilters.record_created_to ? toDatetimeLocalValue(localFilters.record_created_to) : ""}
                      onChange={(e) => updateFilter("record_created_to", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="To"
                    />
                  </div>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block mb-1">Last update</span>
                  <div className="flex gap-2 items-center">
                    <input
                      type="datetime-local"
                      value={localFilters.last_update_from ? toDatetimeLocalValue(localFilters.last_update_from) : ""}
                      onChange={(e) => updateFilter("last_update_from", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="From"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="datetime-local"
                      value={localFilters.last_update_to ? toDatetimeLocalValue(localFilters.last_update_to) : ""}
                      onChange={(e) => updateFilter("last_update_to", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="To"
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs text-gray-500 block mb-1">Run after</span>
                  <div className="flex gap-2 items-center">
                    <input
                      type="datetime-local"
                      value={localFilters.run_after_from ? toDatetimeLocalValue(localFilters.run_after_from) : ""}
                      onChange={(e) => updateFilter("run_after_from", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="From"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="datetime-local"
                      value={localFilters.run_after_to ? toDatetimeLocalValue(localFilters.run_after_to) : ""}
                      onChange={(e) => updateFilter("run_after_to", e.target.value ? new Date(e.target.value).toISOString() : "")}
                      className="input flex-1 min-w-0"
                      placeholder="To"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-700">
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
