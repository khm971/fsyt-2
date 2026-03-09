import { useState, useEffect, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import { formatDateTime } from "../lib/utils";
import { useToast } from "../context/ToastContext";
import Modal from "../components/Modal";

function mapControls(list) {
  const next = {};
  list.forEach((c) => {
    next[c.key] = c;
  });
  return next;
}

export default function ChargedErrors({ setError }) {
  const toast = useToast();
  const [errors, setErrors] = useState([]);
  const [control, setControl] = useState({});
  const [loading, setLoading] = useState(true);
  const [confirmingAction, setConfirmingAction] = useState(null);
  const [isClearing, setIsClearing] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [turningOffLockout, setTurningOffLockout] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, controlList] = await Promise.all([
        api.chargedErrors.list({ limit: 200 }),
        api.control.list(),
      ]);
      setErrors(list);
      setControl(mapControls(controlList));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const chargeableErrorsLockout = control.chargeable_errors_lockout?.value === "true";

  const handleDismiss = async (id) => {
    setTogglingId(id);
    try {
      await api.chargedErrors.dismiss(id);
      setErrors((prev) =>
        prev.map((e) =>
          e.charged_error_id === id ? { ...e, is_dismissed: true } : e
        )
      );
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setTogglingId(null);
    }
  };

  const handleUndismiss = async (id) => {
    setTogglingId(id);
    try {
      await api.chargedErrors.undismiss(id);
      setErrors((prev) =>
        prev.map((e) =>
          e.charged_error_id === id ? { ...e, is_dismissed: false } : e
        )
      );
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setTogglingId(null);
    }
  };

  const handleTurnOffLockout = async () => {
    setTurningOffLockout(true);
    try {
      await api.control.set("chargeable_errors_lockout", "false");
      setControl((prev) => ({
        ...prev,
        chargeable_errors_lockout: {
          ...prev.chargeable_errors_lockout,
          value: "false",
        },
      }));
      toast.addToast("Chargeable Errors Lockout turned off.", "success");
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setTurningOffLockout(false);
    }
  };

  const dismissAll = async () => {
    setIsClearing(true);
    try {
      const { dismissed_count } = await api.chargedErrors.dismissAll();
      setConfirmingAction(null);
      setErrors((prev) => prev.map((e) => ({ ...e, is_dismissed: true })));
      toast.addToast(
        dismissed_count === 0
          ? "No undismissed charged errors to dismiss."
          : `Dismissed ${dismissed_count} charged error(s).`,
        "success"
      );
    } catch (e) {
      setError(e.message);
      toast.addToast(e.message, "error");
    } finally {
      setIsClearing(false);
    }
  };

  const hasUndismissed = errors.some((e) => !e.is_dismissed);

  if (loading) {
    return <div className="text-gray-400 py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Charged Errors</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Records from the charged_error table used for rate/lockout. You can dismiss or undismiss each entry, or dismiss all at once.
            </p>
          </div>
          {errors.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmingAction("dismissAll")}
              disabled={!hasUndismissed}
              className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Dismiss all
            </button>
          )}
        </div>

        {/* Lockout status */}
        <div className="mt-4">
          {chargeableErrorsLockout ? (
            <div className="rounded-xl border border-red-900/70 bg-red-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-red-900/40 p-2 text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    Chargeable Errors Lockout is active
                  </p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    The queue is locked out due to too many chargeable errors. Turn off lockout to resume processing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleTurnOffLockout}
                disabled={turningOffLockout}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {turningOffLockout ? "Turning off…" : "Turn off lockout"}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <p className="text-sm text-gray-400">
                Chargeable Errors Lockout is not active.
              </p>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="mt-6 overflow-x-auto">
          {errors.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No charged errors.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-gray-400">
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Error code</th>
                  <th className="px-4 py-2">Message</th>
                  <th className="px-4 py-2">Dismissed</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.charged_error_id} className="border-b border-gray-800/50">
                    <td className="px-4 py-2 text-gray-500 font-mono">
                      {e.charged_error_id}
                    </td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {formatDateTime(e.error_date)}
                    </td>
                    <td className="px-4 py-2 text-gray-300">
                      {e.error_code ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-300 max-w-md truncate" title={e.message ?? ""}>
                      {e.message ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-400">
                      {e.is_dismissed ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-2">
                      {e.is_dismissed ? (
                        <button
                          type="button"
                          onClick={() => handleUndismiss(e.charged_error_id)}
                          disabled={togglingId !== null}
                          className="text-blue-400 hover:text-blue-300 text-sm disabled:opacity-50"
                        >
                          {togglingId === e.charged_error_id ? "…" : "Undismiss"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDismiss(e.charged_error_id)}
                          disabled={togglingId !== null}
                          className="text-amber-400 hover:text-amber-300 text-sm disabled:opacity-50"
                        >
                          {togglingId === e.charged_error_id ? "…" : "Dismiss"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {confirmingAction === "dismissAll" && (
        <Modal
          title="Dismiss all charged errors"
          onClose={() => !isClearing && setConfirmingAction(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-900/60 bg-amber-950/30 p-4">
              <div className="rounded-full bg-amber-900/50 p-2 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  Are you sure you want to mark all charged errors as dismissed?
                </p>
                <p className="mt-2 text-sm text-gray-400">
                  This will set is_dismissed to true for every undismissed record. You can undismiss individual entries later if needed.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingAction(null)}
                disabled={isClearing}
                className="btn-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={dismissAll}
                disabled={isClearing}
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {isClearing ? "Dismissing…" : "Yes, Dismiss all"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
