/**
 * Label for server instance <option> text (matches Queue / Add Video / Job Scheduler style).
 * @param {{ server_instance_id: number; display_name?: string | null; is_enabled?: boolean; is_running?: boolean; assign_download_jobs?: boolean }} s
 */
export function serverInstanceSelectLabel(s) {
  if (s == null || s.server_instance_id == null) return "";
  const name = (s.display_name && String(s.display_name).trim()) || `Instance ${s.server_instance_id}`;
  const state = s.is_running ? "Running" : "Not running";
  let extra = "";
  if (s.is_enabled === false) extra += ", disabled";
  if (s.assign_download_jobs === false) extra += ", no downloader";
  return `${name} (ID ${s.server_instance_id}) — ${state}${extra}`;
}
