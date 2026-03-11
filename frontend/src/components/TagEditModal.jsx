import { useState, useEffect } from "react";
import { DynamicIcon } from "lucide-react/dynamic";
import { AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import Modal from "./Modal";
import { IconPicker } from "./IconPicker";

const DEFAULT_FG = "#f3f4f6";
const DEFAULT_BG = "#111827";

function formatIconLabel(name) {
  if (!name) return "None";
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function TagEditModal({ tag, videoId, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [bgColor, setBgColor] = useState(DEFAULT_BG);
  const [fgColor, setFgColor] = useState(DEFAULT_FG);
  const [iconBefore, setIconBefore] = useState(null);
  const [iconAfter, setIconAfter] = useState(null);
  const [saving, setSaving] = useState(false);
  const [iconPickerFor, setIconPickerFor] = useState(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!tag) return;
    setName(tag.title || "");
    setBgColor(tag.bg_color || DEFAULT_BG);
    setFgColor(tag.fg_color || DEFAULT_FG);
    setIconBefore(tag.icon_before ?? null);
    setIconAfter(tag.icon_after ?? null);
  }, [tag]);

  const handleSave = async () => {
    const trimmed = (name || "").trim();
    if (!trimmed && !tag?.is_system) {
      return;
    }
    setSaving(true);
    try {
      await api.tags.update(tag.tag_id, {
        ...(tag.is_system ? {} : { title: trimmed }),
        bg_color: bgColor || DEFAULT_BG,
        fg_color: fgColor || DEFAULT_FG,
        icon_before: iconBefore || null,
        icon_after: iconAfter || null,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async () => {
    if (!tag || tag.is_system || tag.video_count !== 1 || videoId == null) return;
    setDeleting(true);
    try {
      await api.videos.removeTag(videoId, tag.tag_id);
      await api.tags.delete(tag.tag_id);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      setDeleting(false);
      setConfirmDeleteTag(false);
    }
  };

  const canDeleteTag = tag && !tag.is_system && tag.video_count === 1 && videoId != null;

  if (!tag) return null;

  return (
    <>
      <Modal title="Edit tag" onClose={onClose} maxWidthClass="max-w-md" closeOnBackdropClick={false}>
        <div className="space-y-4">
          <label className="block">
            <span className="text-gray-400 block mb-1">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={tag.is_system}
              className="input w-full disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {tag.is_system && (
              <span className="text-gray-500 text-xs mt-1 block">System tag name cannot be changed.</span>
            )}
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-gray-400 block mb-1">Background color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-10 h-8 rounded border border-gray-600 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="input flex-1 font-mono text-sm"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Foreground color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fgColor}
                  onChange={(e) => setFgColor(e.target.value)}
                  className="w-10 h-8 rounded border border-gray-600 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={fgColor}
                  onChange={(e) => setFgColor(e.target.value)}
                  className="input flex-1 font-mono text-sm"
                />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-gray-400 block mb-1">Icon before</span>
              <button
                type="button"
                onClick={() => setIconPickerFor("before")}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 bg-gray-800 text-left text-gray-300 hover:border-gray-500 hover:bg-gray-700"
              >
                {iconBefore ? (
                  <>
                    <DynamicIcon name={iconBefore} className="w-4 h-4 shrink-0" />
                    <span className="text-sm truncate">{formatIconLabel(iconBefore)}</span>
                  </>
                ) : (
                  <span className="text-gray-500 text-sm">None</span>
                )}
              </button>
            </label>
            <label className="block">
              <span className="text-gray-400 block mb-1">Icon after</span>
              <button
                type="button"
                onClick={() => setIconPickerFor("after")}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 bg-gray-800 text-left text-gray-300 hover:border-gray-500 hover:bg-gray-700"
              >
                {iconAfter ? (
                  <>
                    <DynamicIcon name={iconAfter} className="w-4 h-4 shrink-0" />
                    <span className="text-sm truncate">{formatIconLabel(iconAfter)}</span>
                  </>
                ) : (
                  <span className="text-gray-500 text-sm">None</span>
                )}
              </button>
            </label>
          </div>

          {canDeleteTag && (
            <div className="pt-2 border-t border-gray-700">
              <button
                type="button"
                onClick={() => setConfirmDeleteTag(true)}
                className="text-red-400 hover:text-red-300 text-sm"
              >
                Delete tag
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={deleting}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting || (!tag.is_system && !(name || "").trim())}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      {confirmDeleteTag && (
        <Modal
          title="Delete tag"
          onClose={() => !deleting && setConfirmDeleteTag(false)}
          closeOnBackdropClick={!deleting}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-red-900/60 bg-red-950/30 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-300 mt-0.5" />
              <p className="text-sm font-medium text-white">
                Remove &quot;{tag?.title}&quot; from this video and delete the tag permanently? It will no longer appear in searches.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTag(false)}
                disabled={deleting}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteTag}
                disabled={deleting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-red-700 hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete tag"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {iconPickerFor && (
        <IconPicker
          title={iconPickerFor === "before" ? "Icon before" : "Icon after"}
          onSelect={(name) => {
            if (iconPickerFor === "before") setIconBefore(name);
            else setIconAfter(name);
            setIconPickerFor(null);
          }}
          onClose={() => setIconPickerFor(null)}
        />
      )}
    </>
  );
}
