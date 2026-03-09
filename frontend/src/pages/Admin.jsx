import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { SlidersHorizontal, Wrench, CalendarClock } from "lucide-react";
import { cn } from "../lib/utils";
import ControlValuesPanel from "../components/ControlValuesPanel";
import Maintenance from "./Maintenance";
import JobScheduler from "./JobScheduler";

function AdminNavLink({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-gray-800 text-white"
            : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
        )
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

export default function Admin({ setError }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Admin</h2>
        <p className="mt-1 text-sm text-gray-400">
          Manage administrative settings and system configuration.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-gray-800 bg-gray-900 p-3 h-fit">
          <div className="mb-3 px-3 text-xs font-medium uppercase tracking-wide text-gray-500">
            Admin Pages
          </div>
          <nav className="space-y-1">
            <AdminNavLink to="/admin/control-values" icon={SlidersHorizontal}>
              Control Values
            </AdminNavLink>
            <AdminNavLink to="/admin/job-scheduler" icon={CalendarClock}>
              Job Scheduler
            </AdminNavLink>
            <AdminNavLink to="/admin/maintenance" icon={Wrench}>
              Maintenance
            </AdminNavLink>
          </nav>
        </aside>

        <section className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="control-values" replace />} />
            <Route path="control-values" element={<ControlValuesPanel setError={setError} />} />
            <Route path="maintenance" element={<Maintenance setError={setError} />} />
            <Route path="job-scheduler" element={<JobScheduler setError={setError} />} />
          </Routes>
        </section>
      </div>
    </div>
  );
}
