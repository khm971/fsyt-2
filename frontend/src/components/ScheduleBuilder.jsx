/**
 * Friendly schedule builder: presets that produce cron expressions.
 * Cron format: minute hour day month day_of_week (0-6, 0=Sunday in standard cron; backend uses same).
 */
const PRESETS = [
  { value: "daily", label: "Every day at a set time", needsTime: true },
  { value: "hourly", label: "Every hour", cron: "0 * * * *" },
  { value: "every2h", label: "Every 2 hours", cron: "0 */2 * * *" },
  { value: "every4h", label: "Every 4 hours", cron: "0 */4 * * *" },
  { value: "every6h", label: "Every 6 hours", cron: "0 */6 * * *" },
  { value: "every12h", label: "Every 12 hours", cron: "0 */12 * * *" },
  { value: "every30", label: "Every 30 minutes", cron: "*/30 * * * *" },
  { value: "every15", label: "Every 15 minutes", cron: "*/15 * * * *" },
  { value: "weekdays_at", label: "Weekdays (Mon–Fri) at a set time", needsTime: true, cronSuffix: "* * 1-5" },
  { value: "weekends_at", label: "Weekends (Sat–Sun) at a set time", needsTime: true, cronSuffix: "* * 0,6" },
  { value: "custom", label: "Custom (cron expression)" },
];

/** Build cron from preset + optional time (HH:mm). */
export function presetToCron(presetValue, timeStr) {
  if (presetValue === "custom") return "";
  const p = PRESETS.find((x) => x.value === presetValue);
  if (!p) return "";
  if (p.cron) return p.cron;
  if (p.needsTime && timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    const hour = Number.isFinite(h) ? h : 0;
    const minute = Number.isFinite(m) ? m : 0;
    if (p.value === "daily") return `${minute} ${hour} * * *`;
    if ((p.value === "weekdays_at" || p.value === "weekends_at") && p.cronSuffix)
      return `${minute} ${hour} ${p.cronSuffix}`;
  }
  return "";
}

/** Parse cron to preset + time if possible (for editing). */
export function cronToPresetAndTime(cron) {
  if (typeof cron !== "string") return { presetValue: "hourly", timeStr: "12:00" };
  if (cron.trim() === "") return { presetValue: "custom", timeStr: "", customCron: "" };
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return { presetValue: "custom", timeStr: "", customCron: cron };
  const [min, hour, day, month, dow] = parts;
  if (cron === "0 * * * *") return { presetValue: "hourly", timeStr: "" };
  if (cron === "0 */2 * * *") return { presetValue: "every2h", timeStr: "" };
  if (cron === "0 */4 * * *") return { presetValue: "every4h", timeStr: "" };
  if (cron === "0 */6 * * *") return { presetValue: "every6h", timeStr: "" };
  if (cron === "0 */12 * * *") return { presetValue: "every12h", timeStr: "" };
  if (cron === "*/30 * * * *") return { presetValue: "every30", timeStr: "" };
  if (cron === "*/15 * * * *") return { presetValue: "every15", timeStr: "" };
  if (day === "*" && month === "*" && dow === "*" && min !== "*" && hour !== "*") {
    const m = parseInt(min, 10);
    const h = parseInt(hour, 10);
    if (Number.isFinite(m) && Number.isFinite(h))
      return { presetValue: "daily", timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  if (dow === "1-5" && day === "*" && month === "*" && min !== "*" && hour !== "*") {
    const m = parseInt(min, 10);
    const h = parseInt(hour, 10);
    if (Number.isFinite(m) && Number.isFinite(h))
      return { presetValue: "weekdays_at", timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  if ((dow === "0,6" || dow === "6,0") && day === "*" && month === "*" && min !== "*" && hour !== "*") {
    const m = parseInt(min, 10);
    const h = parseInt(hour, 10);
    if (Number.isFinite(m) && Number.isFinite(h))
      return { presetValue: "weekends_at", timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
  }
  return { presetValue: "custom", timeStr: "", customCron: cron };
}

/** Human-readable short description of a cron expression. */
export function cronToDescription(cron) {
  if (!cron) return "—";
  const { presetValue, timeStr } = cronToPresetAndTime(cron);
  const p = PRESETS.find((x) => x.value === presetValue);
  if (presetValue === "custom") return cron;
  if (p?.label) {
    if (timeStr) return `${p.label.replace(" at a set time", "")} at ${timeStr}`;
    return p.label;
  }
  return cron;
}

export default function ScheduleBuilder({ cron, onChange, disabled }) {
  const { presetValue, timeStr, customCron } = cronToPresetAndTime(cron);

  const handlePresetChange = (value) => {
    if (value === "custom") {
      onChange(customCron || "");
      return;
    }
    const next = presetToCron(value, timeStr || "12:00");
    onChange(next);
  };

  const handleTimeChange = (e) => {
    const t = e.target.value;
    onChange(presetToCron(presetValue, t));
  };

  const handleCustomCronChange = (e) => {
    onChange(e.target.value.trim());
  };

  const showTime = PRESETS.find((x) => x.value === presetValue)?.needsTime;
  const showCustom = presetValue === "custom";

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-gray-400 block mb-1">Schedule</span>
        <select
          value={presetValue}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={disabled}
          className="input"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {showTime && (
        <label className="block">
          <span className="text-gray-400 block mb-1">Time</span>
          <input
            type="time"
            value={timeStr || "12:00"}
            onChange={handleTimeChange}
            disabled={disabled}
            className="input"
          />
        </label>
      )}
      {showCustom && (
        <label className="block">
          <span className="text-gray-400 block mb-1">Cron (minute hour day month day_of_week)</span>
          <input
            type="text"
            value={customCron || ""}
            onChange={handleCustomCronChange}
            placeholder="e.g. 0 14 * * *"
            disabled={disabled}
            className="input font-mono text-sm"
          />
        </label>
      )}
    </div>
  );
}

export { PRESETS };
