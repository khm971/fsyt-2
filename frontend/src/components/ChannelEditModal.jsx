import { useState, useEffect } from "react";
import { api } from "../api/client";
import Modal from "./Modal";

export function ChannelEditModal({ channelId, onClose, onSaved, setError }) {
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    provider_key: "",
    handle: "",
    title: "",
    url: "",
    is_enabled_for_auto_download: false,
  });

  useEffect(() => {
    if (channelId == null) {
      setChannel(null);
      setForm({
        provider_key: "",
        handle: "",
        title: "",
        url: "",
        is_enabled_for_auto_download: false,
      });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setChannel(null);
    api.channels
      .get(channelId)
      .then((ch) => {
        if (!cancelled) {
          setChannel(ch);
          setForm({
            provider_key: ch.provider_key ?? "",
            handle: ch.handle ?? "",
            title: ch.title ?? "",
            url: ch.url ?? "",
            is_enabled_for_auto_download: ch.is_enabled_for_auto_download ?? false,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [channelId, setError]);

  const handleSave = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      await api.channels.update(channel.channel_id, form);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (channelId == null) return null;

  return (
    <Modal title="Edit channel" onClose={onClose}>
      {loading && (
        <div className="text-gray-400 py-4">Loading...</div>
      )}
      {!loading && channel && (
        <>
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
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
      {!loading && !channel && (
        <div className="text-gray-400 py-4">Channel not found.</div>
      )}
    </Modal>
  );
}
