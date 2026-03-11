import { useState, useMemo } from "react";
import { DynamicIcon, iconNames } from "lucide-react/dynamic";
import Modal from "./Modal";

const ICONS_PER_ROW = 8;
const MAX_VISIBLE = 200;

function formatIconLabel(name) {
  return (name || "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function IconPicker({ onSelect, onClose, title = "Choose icon" }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) return iconNames.slice(0, MAX_VISIBLE);
    return iconNames.filter((name) => name.includes(q)).slice(0, MAX_VISIBLE);
  }, [query]);

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className="input w-full"
          autoFocus
        />
        <div className="border border-gray-700 rounded-lg bg-gray-800/50 max-h-[60vh] overflow-y-auto">
          <div className="p-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                onClose();
              }}
              className="flex flex-col items-center justify-center w-14 h-14 rounded-md border border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-white hover:border-gray-500 transition-colors"
            >
              <span className="text-xs">None</span>
            </button>
            {filtered.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onSelect(name);
                  onClose();
                }}
                className="flex flex-col items-center justify-center w-14 h-14 rounded-md border border-transparent text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-600 transition-colors"
                title={formatIconLabel(name)}
              >
                <DynamicIcon name={name} className="w-5 h-5 shrink-0" />
                <span className="text-[10px] mt-0.5 truncate w-full text-center px-0.5">
                  {formatIconLabel(name)}
                </span>
              </button>
            ))}
          </div>
        </div>
        {query && filtered.length === 0 && (
          <p className="text-gray-400 text-sm">No icons match &quot;{query}&quot;</p>
        )}
      </div>
    </Modal>
  );
}
