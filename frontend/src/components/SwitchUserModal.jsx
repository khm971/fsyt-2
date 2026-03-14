import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useUser } from "../context/UserContext";
import Modal from "./Modal";

export function SwitchUserModal({ onClose }) {
  const { currentUser, refetchUser } = useUser();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [switchingId, setSwitchingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    api.users
      .list({ enabled: true })
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load users");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleSelectUser(user) {
    if (user.user_id === currentUser?.user_id) {
      onClose();
      return;
    }
    setSwitchingId(user.user_id);
    setError(null);
    try {
      await api.switchUser(user.user_id);
      await refetchUser();
      onClose();
    } catch (e) {
      setError(e?.message ?? "Failed to switch user");
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <Modal title="Switch User" onClose={onClose}>
      {loading && (
        <p className="text-gray-400 text-sm">Loading users…</p>
      )}
      {error && (
        <p className="text-red-400 text-sm mb-3">{error}</p>
      )}
      {!loading && users.length === 0 && !error && (
        <p className="text-gray-400 text-sm">No users available.</p>
      )}
      {!loading && users.length > 0 && (
        <ul className="space-y-1">
          {users.map((u) => {
            const displayName = [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username;
            const isCurrent = u.user_id === currentUser?.user_id;
            const isSwitching = switchingId === u.user_id;
            return (
              <li key={u.user_id}>
                <button
                  type="button"
                  onClick={() => handleSelectUser(u)}
                  disabled={isSwitching}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    isCurrent
                      ? "bg-gray-800 text-gray-400 cursor-default"
                      : "text-gray-200 hover:bg-gray-800 hover:text-white"
                  } ${isSwitching ? "opacity-70" : ""}`}
                >
                  <span className="font-medium">{displayName}</span>
                  {u.username && displayName !== u.username && (
                    <span className="text-gray-500 ml-2">({u.username})</span>
                  )}
                  {isCurrent && <span className="text-gray-500 ml-2">— current</span>}
                  {isSwitching && <span className="text-gray-400 ml-2">…</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
