import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../api/client";

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetchUser = useCallback(async () => {
    setError(null);
    try {
      const user = await api.me();
      setCurrentUser(user);
    } catch (e) {
      setError(e?.message ?? "Failed to load user");
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetchUser();
  }, [refetchUser]);

  const value = {
    currentUser,
    loading,
    error,
    refetchUser,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
