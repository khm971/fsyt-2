import { createContext, useContext, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const container = (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "px-4 py-2 rounded-lg shadow-lg text-sm font-medium",
            t.type === "success" && "bg-green-900/90 text-green-100 border border-green-700",
            t.type === "error" && "bg-red-900/90 text-red-100 border border-red-700",
            t.type === "warning" && "bg-yellow-900/90 text-yellow-100 border border-yellow-700",
            t.type === "info" && "bg-blue-900/90 text-blue-100 border border-blue-700"
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(container, document.body)}
    </ToastContext.Provider>
  );
}
