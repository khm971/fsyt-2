import { useState, useEffect } from "react";
import {
  ScrollText,
  ListOrdered,
  Video,
  CheckCircle,
  AlertCircle,
  CalendarClock,
  Radio,
  PlayCircle,
  Clock,
  Database,
} from "lucide-react";
import { api } from "../api/client";
import { formatDateTime, formatRelativeTimeAgo } from "../lib/utils";

function StatCard({ icon: Icon, iconBg, label, value, subValue }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full p-2 ${iconBg}`}>
          <Icon className="h-4 w-4 text-current" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
          <div className="mt-1 text-lg font-semibold text-white tabular-nums">{value}</div>
          {subValue != null && subValue !== "" && (
            <div className="mt-0.5 text-sm text-gray-400">{subValue}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
      <Icon className="h-4 w-4" />
      {children}
    </h3>
  );
}

export default function Information({ setError }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.information
      .get()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [setError]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-800 bg-gray-900 py-16">
        <div className="flex items-center gap-2 text-gray-400">
          <Database className="h-5 w-5 animate-pulse" />
          <span>Loading system information…</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-white">Information</h3>
        <p className="mt-1 text-sm text-gray-400">
          System-wide counts and oldest records for event log, job queue, videos, errors, scheduler, channels, and watch progress.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <SectionTitle icon={ScrollText}>Event log</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={ScrollText}
              iconBg="bg-amber-900/40 text-amber-300"
              label="Event log entries"
              value={stats.event_log_total.toLocaleString()}
            />
            <StatCard
              icon={Clock}
              iconBg="bg-amber-900/40 text-amber-300"
              label="Oldest log entry"
              value={formatDateTime(stats.event_log_oldest)}
              subValue={formatRelativeTimeAgo(stats.event_log_oldest)}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <SectionTitle icon={ListOrdered}>Job queue</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={ListOrdered}
              iconBg="bg-blue-900/40 text-blue-300"
              label="Job queue entries"
              value={stats.job_queue_total.toLocaleString()}
            />
            <StatCard
              icon={Clock}
              iconBg="bg-blue-900/40 text-blue-300"
              label="Oldest queue entry"
              value={formatDateTime(stats.job_queue_oldest)}
              subValue={formatRelativeTimeAgo(stats.job_queue_oldest)}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <SectionTitle icon={Video}>Videos</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={Video}
              iconBg="bg-emerald-900/40 text-emerald-300"
              label="Videos (total)"
              value={stats.video_total.toLocaleString()}
            />
            <StatCard
              icon={CheckCircle}
              iconBg="bg-emerald-900/40 text-emerald-300"
              label="Videos (available)"
              value={stats.video_available.toLocaleString()}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <SectionTitle icon={AlertCircle}>Charged errors</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={AlertCircle}
              iconBg="bg-red-900/40 text-red-300"
              label="Charged errors"
              value={stats.charged_error_total.toLocaleString()}
            />
            <StatCard
              icon={AlertCircle}
              iconBg="bg-red-900/40 text-red-300"
              label="Unacknowledged charged errors"
              value={stats.charged_error_unacknowledged.toLocaleString()}
            />
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <SectionTitle icon={CalendarClock}>Scheduler</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={CalendarClock}
              iconBg="bg-violet-900/40 text-violet-300"
              label="Scheduler entries"
              value={stats.scheduler_total.toLocaleString()}
            />
            <StatCard
              icon={CheckCircle}
              iconBg="bg-violet-900/40 text-violet-300"
              label="Scheduler entries (enabled)"
              value={stats.scheduler_enabled.toLocaleString()}
            />
          </div>
        </div>

        <div>
          <SectionTitle icon={Radio}>Channels</SectionTitle>
          <StatCard
            icon={Radio}
            iconBg="bg-cyan-900/40 text-cyan-300"
            label="Channels"
            value={stats.channel_total.toLocaleString()}
          />
        </div>

        <div className="sm:col-span-2">
          <SectionTitle icon={PlayCircle}>Watch progress</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              icon={CheckCircle}
              iconBg="bg-teal-900/40 text-teal-300"
              label="Videos watched to completion"
              value={stats.videos_watched_to_completion.toLocaleString()}
            />
            <StatCard
              icon={PlayCircle}
              iconBg="bg-teal-900/40 text-teal-300"
              label="Videos in progress (watching)"
              value={stats.videos_watch_in_progress.toLocaleString()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
