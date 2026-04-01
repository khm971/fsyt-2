import { useState, useEffect } from "react";
import Modal from "./Modal";

const OPTIONAL_COLUMNS = [
  { key: "id", label: "ID", defaultVisible: true },
  { key: "title", label: "Handle / Title", defaultVisible: true },
  { key: "videos", label: "Videos", defaultVisible: true },
  { key: "auto_dl", label: "Auto DL", defaultVisible: true },
  { key: "provider_key", label: "Provider key", defaultVisible: false },
  { key: "record_created", label: "Record created", defaultVisible: false },
  { key: "record_updated", label: "Record updated", defaultVisible: false },
  { key: "created_by", label: "Created by", defaultVisible: false },
  { key: "url", label: "URL", defaultVisible: false },
  { key: "folder_on_disk", label: "Folder on disk", defaultVisible: false },
];

export const DEFAULT_VISIBLE_COLUMNS = OPTIONAL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

const EMPTY_FILTERS = {
  title_contains: "",
  auto_download: null,
};

const BOOL_OPTIONS = [
  { value: "", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export default function ChannelColumnFilterModal({
  visibleColumns,
  onVisibleColumnsChange,
  filters,
  onFiltersChange,
  onClose,
}) {
  const [localColumns, setLocalColumns] = useState(() => [...visibleColumns]);
  const [localFilters, setLocalFilters] = useState(() => ({ ...filters }));

  useEffect(() => {
    setLocalColumns([...visibleColumns]);
    setLocalFilters({ ...filters });
  }, [visibleColumns, filters]);

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
          <p className="text-xs text-gray-500 mb-2">Actions are always shown.</p>
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
            <label className="block sm:col-span-2">
              <span className="text-gray-400 block mb-1">Title or handle contains</span>
              <input
                type="text"
                value={localFilters.title_contains}
                onChange={(e) => updateFilter("title_contains", e.target.value)}
                className="input w-full min-w-0"
                placeholder="Substring match"
              />
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Auto download</span>
              <select
                value={localFilters.auto_download === null ? "" : String(localFilters.auto_download)}
                onChange={(e) =>
                  updateFilter("auto_download", e.target.value === "" ? null : e.target.value === "true")
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
