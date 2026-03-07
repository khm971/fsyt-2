import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatDateTime } from "../lib/utils";

function isBoolean(val) {
  return val === "true" || val === "false";
}

function isNumeric(val) {
  if (val == null || val === "") return false;
  return /^-?\d+(\.\d+)?$/.test(String(val).trim());
}

function isDatestamp(val) {
  if (val == null || val === "") return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(val));
}

function formatKey(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapControls(list) {
  const next = {};
  list.forEach((controlValue) => {
    next[controlValue.key] = controlValue;
  });
  return next;
}

export default function ControlValuesPanel({ setError }) {
  const [control, setControl] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [editValues, setEditValues] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await api.control.list();
        if (cancelled) return;
        setControl(mapControls(list));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [setError]);

  const handleControlChange = (key, newValue) => {
    setEditValues((prev) => ({ ...prev, [key]: newValue }));
  };

  const handleControlSave = async (key) => {
    const current = control[key];
    const displayVal = editValues[key] !== undefined ? editValues[key] : current?.value;
    const strVal =
      typeof displayVal === "boolean"
        ? String(displayVal)
        : String(displayVal ?? "");

    setSavingKey(key);
    try {
      await api.control.set(key, strVal);
      setControl((prev) => ({
        ...prev,
        [key]: { ...prev[key], value: strVal, last_update: new Date().toISOString() },
      }));
      setEditValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return <div className="text-gray-400 py-8">Loading...</div>;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">Control Values</h3>
        <p className="text-sm text-gray-400 mt-1">
          Update system-wide control settings used by the queue and dashboard.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 py-1 border-b border-gray-800 text-gray-500 text-xs">
          <div className="w-48 shrink-0">Key</div>
          <div className="flex-1 min-w-0">Value</div>
          <div className="w-36 shrink-0">Updated</div>
        </div>
        {Object.entries(control).map(([key, controlValue]) => {
          const val = controlValue?.value ?? "";
          const displayVal = editValues[key] !== undefined ? editValues[key] : val;
          const readOnly = isDatestamp(val);
          const isBool = isBoolean(val);
          const isNum = isNumeric(val);

          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-800 last:border-0"
            >
              <div className="w-48 shrink-0">
                <span className="text-gray-400 text-sm">{formatKey(key)}</span>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {readOnly ? (
                  <span className="text-gray-300 text-sm font-mono">
                    {formatDateTime(val)}
                  </span>
                ) : isBool ? (
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={displayVal === "true"}
                      onChange={(e) =>
                        handleControlChange(key, e.target.checked ? "true" : "false")
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:bg-blue-600 peer-focus:ring-2 peer-focus:ring-blue-500/50" />
                    <div className="absolute left-0.5 top-1 bg-white w-3.5 h-3.5 rounded-full transition-all peer-checked:translate-x-4" />
                  </label>
                ) : isNum ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9.-]*"
                    value={displayVal}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (nextValue === "" || /^-?\d*\.?\d*$/.test(nextValue)) {
                        handleControlChange(key, nextValue);
                      }
                    }}
                    onBlur={() => handleControlSave(key)}
                    onKeyDown={(e) => e.key === "Enter" && handleControlSave(key)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white font-mono w-24 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={displayVal}
                    onChange={(e) => handleControlChange(key, e.target.value)}
                    onBlur={() => handleControlSave(key)}
                    onKeyDown={(e) => e.key === "Enter" && handleControlSave(key)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white flex-1 min-w-0 focus:border-blue-500 focus:outline-none"
                  />
                )}
                {!readOnly && (editValues[key] !== undefined || (isBool && displayVal !== val)) && (
                  <button
                    type="button"
                    onClick={() => handleControlSave(key)}
                    disabled={savingKey === key}
                    className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50 shrink-0"
                  >
                    {savingKey === key ? "..." : "Save"}
                  </button>
                )}
              </div>
              <div className="text-gray-500 text-xs shrink-0 w-36">
                {controlValue?.last_update ? formatDateTime(controlValue.last_update) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
