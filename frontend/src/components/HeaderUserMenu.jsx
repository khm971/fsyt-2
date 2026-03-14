import { useState, useEffect, useRef } from "react";
import { Settings, Users, LogOut } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useUser } from "../context/UserContext";
import { SwitchUserModal } from "./SwitchUserModal";

function getInitials(user) {
  if (!user) return "?";
  const first = (user.firstname || "").trim();
  const last = (user.lastname || "").trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last) return last.slice(0, 2).toUpperCase();
  const u = (user.username || "").trim();
  if (u.length >= 2) return u.slice(0, 2).toUpperCase();
  return u.toUpperCase() || "?";
}

export function HeaderUserMenu() {
  const { currentUser, loading } = useUser();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [switchUserModalOpen, setSwitchUserModalOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [dropdownOpen]);

  const initials = currentUser ? getInitials(currentUser) : (loading ? "…" : "?");
  const showDropdown = () => setDropdownOpen((v) => !v);
  const closeDropdown = () => setDropdownOpen(false);

  function handleSwitchUser() {
    closeDropdown();
    setSwitchUserModalOpen(true);
  }

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <Tooltip title="User menu" side="bottom">
        <button
          type="button"
          onClick={showDropdown}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-700 text-gray-200 border border-gray-600 text-sm font-medium transition-colors hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          aria-label="User menu"
        >
          {initials}
        </button>
      </Tooltip>
      {dropdownOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-48 rounded-md border border-gray-700 bg-gray-900 py-1 shadow-lg z-50"
          role="menu"
        >
          <button
            type="button"
            onClick={closeDropdown}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            role="menuitem"
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </button>
          <button
            type="button"
            onClick={handleSwitchUser}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            role="menuitem"
          >
            <Users className="h-4 w-4 shrink-0" />
            Switch User
          </button>
          <button
            type="button"
            onClick={closeDropdown}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            role="menuitem"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Log out
          </button>
        </div>
      )}
      {switchUserModalOpen && (
        <SwitchUserModal onClose={() => setSwitchUserModalOpen(false)} />
      )}
    </div>
  );
}
