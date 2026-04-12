import { useState, useEffect } from "react";
import { api } from "../api/client";
import Modal from "./Modal";

const OPTIONAL_COLUMNS = [
  { key: "time", label: "Time", defaultVisible: true },
  { key: "job_id", label: "Job", defaultVisible: true },
  { key: "video_id", label: "Video", defaultVisible: true },
  { key: "channel_id", label: "Channel", defaultVisible: true },
  { key: "severity", label: "Severity", defaultVisible: true },
  { key: "message", label: "Message", defaultVisible: true },
  { key: "ack", label: "Ack", defaultVisible: true },
  { key: "event_log_id", label: "Event ID", defaultVisible: false },
  { key: "username", label: "User", defaultVisible: false },
  { key: "subsystem", label: "Subsystem", defaultVisible: false },
  { key: "server_instance_id", label: "Server inst.", defaultVisible: false },
];

export const DEFAULT_VISIBLE_COLUMNS = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

export const DEFAULT_LOG_MIN_SEVERITY = 20;

export const LOG_LEVELS = [
  { value: 5, label: "Low" },
  { value: 10, label: "Debug" },
  { value: 20, label: "Info" },
  { value: 25, label: "Notice" },
  { value: 30, label: "Warning" },
  { value: 40, label: "Error" },
  { value: 50, label: "Critical" },
];

const EMPTY_FILTERS = {
  min_severity: DEFAULT_LOG_MIN_SEVERITY,
  message_contains: "",
  job_id: "",
  video_id: "",
  channel_id: "",
  server_instance_id: "",
  acknowledged: null,
  subsystem: "",
};

const BOOL_OPTIONS = [
  { value: "", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export default function LogColumnFilterModal({
  visibleColumns,
  onVisibleColumnsChange,
  filters,
  onFiltersChange,
  onClose,
}) {
  const [subsystems, setSubsystems] = useState([]);
  const [localColumns, setLocalColumns] = useState(() => [...visibleColumns]);
  const [localFilters, setLocalFilters] = useState(() => ({ ...filters }));

  useEffect(() => {
    setLocalColumns([...visibleColumns]);
    setLocalFilters({ ...filters });
  }, [visibleColumns, filters]);

  useEffect(() => {
    api.log
      .filterOptions()
      .then((d) => setSubsystems(d.subsystems || []))
      .catch(() => setSubsystems([]));
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
          <p className="text-xs text-gray-500 mb-2">Include or hide table columns.</p>
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
              <span className="text-gray-400 block mb-1">Lowest level (min severity)</span>
              <select
                value={localFilters.min_severity}
                onChange={(e) => updateFilter("min_severity", Number(e.target.value))}
                className="input w-full min-w-0"
              >
                {LOG_LEVELS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-gray-400 block mb-1">Message contains</span>
              <input
                type="text"
                value={localFilters.message_contains}
                onChange={(e) => updateFilter("message_contains", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Substring match"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Job ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.job_id}
                onChange={(e) => updateFilter("job_id", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Any"
              />
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
              <span className="text-gray-400 block mb-1">Channel ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.channel_id}
                onChange={(e) => updateFilter("channel_id", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Any"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Server instance ID</span>
              <input
                type="number"
                min={1}
                value={localFilters.server_instance_id}
                onChange={(e) => updateFilter("server_instance_id", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Any"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Acknowledged</span>
              <select
                value={localFilters.acknowledged === null ? "" : String(localFilters.acknowledged)}
                onChange={(e) =>
                  updateFilter("acknowledged", e.target.value === "" ? null : e.target.value === "true")
                }
                className="input w-full min-w-0"
              >
                {BOOL_OPTIONS.map((o) => (
                  <option key={o.value || "any"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-gray-400 block mb-1">Subsystem</span>
              <select
                value={localFilters.subsystem}
                onChange={(e) => updateFilter("subsystem", e.target.value)}
                className="input w-full min-w-0"
              >
                <option value="">— Any —</option>
                {subsystems.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
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

export function hasLogActiveFilters(filters) {
  return !!(
    filters.min_severity !== DEFAULT_LOG_MIN_SEVERITY ||
    (filters.message_contains && filters.message_contains.trim()) ||
    (filters.job_id !== "" && filters.job_id != null) ||
    (filters.video_id !== "" && filters.video_id != null) ||
    (filters.channel_id !== "" && filters.channel_id != null) ||
    (filters.server_instance_id !== "" && filters.server_instance_id != null) ||
    filters.acknowledged !== null ||
    (filters.subsystem && filters.subsystem.trim())
  );
}

export function logFiltersToApiParams(filters) {
  const p = { min_severity: filters.min_severity };
  const msg = (filters.message_contains || "").trim();
  if (msg) p.message_contains = msg;
  const jid = filters.job_id !== "" && filters.job_id != null ? parseInt(String(filters.job_id), 10) : NaN;
  if (Number.isFinite(jid)) p.job_id = jid;
  const vid = filters.video_id !== "" && filters.video_id != null ? parseInt(String(filters.video_id), 10) : NaN;
  if (Number.isFinite(vid)) p.video_id = vid;
  const cid = filters.channel_id !== "" && filters.channel_id != null ? parseInt(String(filters.channel_id), 10) : NaN;
  if (Number.isFinite(cid)) p.channel_id = cid;
  const sid =
    filters.server_instance_id !== "" && filters.server_instance_id != null
      ? parseInt(String(filters.server_instance_id), 10)
      : NaN;
  if (Number.isFinite(sid)) p.server_instance_id = sid;
  if (filters.acknowledged === true || filters.acknowledged === false) p.acknowledged = filters.acknowledged;
  const sub = (filters.subsystem || "").trim();
  if (sub) p.subsystem = sub;
  return p;
}
