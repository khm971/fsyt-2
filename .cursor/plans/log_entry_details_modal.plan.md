---
name: ""
overview: ""
todos: []
isProject: false
---

# Log entry details modal

## Overview

Add a LogEntryDetailsModal that shows full event_log fields (with nulls suppressed), severity color/icon, **links that open the related Job / Video / Channel modal** when present, and an acknowledge button. Expose it from the dashboard Recent events widget and from the Log page (clicking log text or time).

**Clarification:** Within the Log Entry Details Modal, clicking on a job, video, or channel must open the related **modal dialog** (JobDetailsModal, VideoDetailsModal, or ChannelEditModal), not just navigate to a page. So both Dashboard and Log page will pass `onOpenJob`, `onOpenVideo`, and `onOpenChannel` callbacks and will host all three modals so that any of those links can open the corresponding modal.

---

## 1. Backend: single-log endpoint and full row shape

**File:** [backend/api/log.py](backend/api/log.py)

- **Extend `row_to_log(r)`** to include `instance_id` and `hostname` (from `r.get("instance_id")`, `r.get("hostname")`).
- **Add `GET /{event_log_id}`** that selects all columns (including `instance_id`, `hostname`), returns 404 if not found, and uses the extended `row_to_log` for the response.

## 2. Frontend API client

**File:** [frontend/src/api/client.js](frontend/src/api/client.js)

- Add `get: (id) => apiFetch(\`/log/${id})`to the`log` object.

## 3. New component: LogEntryDetailsModal

**File:** `frontend/src/components/LogEntryDetailsModal.jsx` (new)

- **Props:** `eventLogId`, `onClose`, `setError`, `toast`, and `**onOpenJob(id)`, `onOpenVideo(id)`, `onOpenChannel(id)`** (all three required or used when present so that job/video/channel always open the related modal).
- **Behavior:** When the user clicks a job ID, video ID, or channel ID in the modal, call the corresponding callback with that id and then `onClose()` so the parent opens the Job/Video/Channel modal. No fallback to page navigation — the parent is responsible for rendering the modals and providing the callbacks.
- **Content:** Full event_log fields (suppress nulls), severity color + icon, Acknowledge button. Same styling and patterns as in the original plan (Modal, SEVERITY_COLORS, severity icons, optional `onAcknowledged`).

## 4. Dashboard: open log modal and related modals

**File:** [frontend/src/pages/Dashboard.jsx](frontend/src/pages/Dashboard.jsx)

- Add state: `eventLogIdForModal`, and `**videoIdForModal`**, `**channelIdForModal`** (Dashboard already has `jobQueueIdForModal` and JobDetailsModal).
- Make each Recent events row clickable to set `eventLogIdForModal` (keep Ack button separate).
- Render **VideoDetailsModal** and **ChannelEditModal** (same as on Log page), with `videoId={videoIdForModal}`, `channelId={channelIdForModal}`, and their `onClose` setters.
- Render `LogEntryDetailsModal` with:
  - `onOpenJob={(id) => { setEventLogIdForModal(null); setJobQueueIdForModal(id); }}`
  - `onOpenVideo={(id) => { setEventLogIdForModal(null); setVideoIdForModal(id); }}`
  - `onOpenChannel={(id) => { setEventLogIdForModal(null); setChannelIdForModal(id); }}`

So clicking job/video/channel in the log modal closes the log modal and opens the corresponding Job/Video/Channel modal.

## 5. Log page: open log modal and pass callbacks

**File:** [frontend/src/pages/Log.jsx](frontend/src/pages/Log.jsx)

- Add state: `eventLogIdForModal`.
- Make the **time** and **message** cells clickable to set `eventLogIdForModal`.
- Render `LogEntryDetailsModal` with:
  - `onOpenJob={(id) => { setEventLogIdForModal(null); setJobIdForModal(id); }}`
  - `onOpenVideo={(id) => { setEventLogIdForModal(null); setVideoIdForModal(id); }}`
  - `onOpenChannel={(id) => { setEventLogIdForModal(null); setChannelIdForModal(id); }}`
  - `onAcknowledged` to update the log list when the user acks from the modal.

Log page already has JobDetailsModal, VideoDetailsModal, and ChannelEditModal, so no new modals needed there.

---

## Summary

- **Log Entry Details Modal:** Shows full entry, severity styling + icon, links for job_id/video_id/channel_id that **open the related modal** via callbacks.
- **Dashboard:** Add VideoDetailsModal and ChannelEditModal (and their state); pass all three callbacks to LogEntryDetailsModal so job/video/channel open the right modal.
- **Log page:** Pass all three callbacks to LogEntryDetailsModal so job/video/channel open the existing modals.

