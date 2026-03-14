# Queue Column Selector and Filter Modal

## Overview

Add a Column Selector and Filter modal to the Queue page, opened from a filter icon in the pagination bar. Implement server-side filtering (status, type, video/channel IDs, run-after, error/warning/ack, date ranges) with dropdowns and inputs, column show/hide (except id, type, Flags, actions), and ensure sorting, pagination, and WebSocket updates continue to work.

## Current state

- **Queue page** ([frontend/src/pages/Queue.jsx](frontend/src/pages/Queue.jsx)): Uses [PaginationBar](frontend/src/components/PaginationBar.jsx) (top and bottom) for "Showing 1–xxx of yyy jobs"; fetches page via `api.queue.list({ limit, offset, sort_by, sort_order })`; **does not** use the list response `total` — it uses `totalCount` from [QueueWebSocketContext](frontend/src/context/QueueWebSocketContext.jsx). URL params `filter=warnings_and_errors|queued|scheduled` apply **client-side** only to the current page.
- **Backend** ([backend/api/queue.py](backend/api/queue.py)): `list_jobs` supports only `status` and `scheduler_entry_id`; returns `items` and `total` with a single `WHERE` and existing sort/limit/offset.
- **Job queue schema** ([backend/api/schemas.py](backend/api/schemas.py)): `JobQueueResponse` has job_queue_id, record_created, job_type, video_id, channel_id, other_target_id, parameter, extended_parameters, status, status_percent_complete, status_message, last_update, completed_flag, warning_flag, error_flag, acknowledge_flag, run_after, priority, scheduler_entry_id. Date fields: **record_created**, **last_update**, **run_after**.

## Architecture

- **Filtering**: All filters are ANDed and applied **server-side** in `list_jobs`. Pagination and "Showing x–y of z" use the **list response `total`** when any filter is active (and optionally always use it for consistency).
- **Columns**: Frontend keeps a list of visible column keys; table renders only visible columns plus the four locked ones (id, type, Flags, actions). Default visible set = current table (id, priority, type, video_id, status, record_created, last_update, Flags, actions).
- **State**: Column visibility and filter values stored in React state; optionally persist in `localStorage` so they survive refresh.
- **Dynamic updates**: Keep using `jobOverrides` / `videoProgressOverrides` from WebSocket so the current page's rows still update live; list refetch still depends on page/sort/filters so new data is loaded when those change.

---

## 1. Backend: extend list endpoint and add filter-options

**File: [backend/api/queue.py](backend/api/queue.py)**

- **New query parameters** for `list_jobs` (all optional; add to existing `status`, `scheduler_entry_id`):
  - **status** (existing), **job_type** (string)
  - **video_id** (int), **channel_id** (int)
  - **run_after_after** (datetime): job has `run_after` and `run_after > value`
  - **error_flag** (bool), **warning_flag** (bool), **acknowledge_flag** (bool)
  - **record_created_from**, **record_created_to**, **last_update_from**, **last_update_to**, **run_after_from**, **run_after_to** (datetimes for range filters)
- Build `WHERE` by appending conditions for each provided filter (AND). Use parameterized queries (`$1`, `$2`, …) and a params list. For count and SELECT use the same `where` and `params`.
- Keep existing `sort_by` / `sort_order` and `limit` / `offset` behavior.

**New endpoint: GET /queue/filter-options**

- Returns `{ "statuses": string[], "job_types": string[] }`.
- Implement via two queries: `SELECT DISTINCT status FROM job_queue ORDER BY 1` and `SELECT DISTINCT job_type FROM job_queue ORDER BY 1` (or a single query with two subqueries). Use this for dropdown options so users pick from existing values only.

---

## 2. Frontend API client: pass filters and call filter-options

**File: [frontend/src/api/client.js](frontend/src/api/client.js)**

- In `queue.list`, add query params for: `status`, `job_type`, `video_id`, `channel_id`, `run_after_after`, `error_flag`, `warning_flag`, `acknowledge_flag`, `record_created_from`, `record_created_to`, `last_update_from`, `last_update_to`, `run_after_from`, `run_after_to` (only append when value is set and not empty).
- Add `queue.filterOptions: () => apiFetch("/queue/filter-options")`.

---

## 3. PaginationBar: filter icon

**File: [frontend/src/components/PaginationBar.jsx](frontend/src/components/PaginationBar.jsx)**

- Add optional props: `onFilterClick` (function) and optionally `filterActive` (boolean).
- When `onFilterClick` is provided, render a filter icon button (e.g. Lucide `Filter`) next to the "Showing x–y of z" text (e.g. in the left area of the bar). Use the shared [Tooltip](frontend/src/components/Tooltip.jsx) component for accessibility (e.g. "Columns and filters"). Style consistently (e.g. `text-gray-400 hover:text-blue-400`); if `filterActive` is true, use a distinct style (e.g. blue) to indicate active filters.

---

## 4. Queue page: state and list fetch

**File: [frontend/src/pages/Queue.jsx](frontend/src/pages/Queue.jsx)**

- **Column visibility**: Define a constant list of optional column keys (e.g. `priority`, `video_id`, `channel_id`, `status`, `record_created`, `last_update`, `run_after`, `parameter`, `scheduler_entry_id`) with labels and default visibility (default = true for priority, video_id, status, record_created, last_update so current table is default). Store visible columns in state (e.g. `visibleColumns: Set` or array); persist in `localStorage` key like `queueVisibleColumns` and read on mount.
- **Filter state**: One state object for all filters: `status`, `job_type`, `video_id`, `channel_id`, `run_after_after` (datetime), `has_error` (bool | null), `has_warning` (bool | null), `acknowledged` (bool | null), `record_created_from/to`, `last_update_from/to`, `run_after_from/to`. Persist in `localStorage` (e.g. `queueFilters`) if desired.
- **Modal open**: `showColumnFilterModal` state; when filter icon is clicked, set to true.
- **List fetch**: In the `useEffect` that calls `api.queue.list`, add all filter params (only non-empty). When **any** filter is active, use the response `res.total` for `totalCount` in the pagination bar and for `totalPages` (store in state, e.g. `listTotal`). When no filter is active, keep using WebSocket `totalCount` for display and `totalPages` so behavior stays the same. So: `effectiveTotal = hasActiveFilters ? listTotal : totalCount`; `totalPages = Math.ceil(effectiveTotal / PAGE_SIZE)`.
- **Remove or migrate URL filters**: Drop `filter=warnings_and_errors|queued|scheduled` from the page (or map them into the new filter state when present so one UX). Prefer replacing so the new modal is the single place for filters.

---

## 5. New modal component: Column Selector and Filter

**New file: e.g. [frontend/src/components/QueueColumnFilterModal.jsx](frontend/src/components/QueueColumnFilterModal.jsx)**

- Use the same modal pattern as existing modals (fixed overlay, `bg-gray-900 border border-gray-700`, no browser `confirm`/`alert` per workspace rules). Can wrap content in the shared [Modal.jsx](frontend/src/components/Modal.jsx) if it supports a large body (e.g. `maxWidthClass="max-w-2xl"`).
- **Column selector section**: Heading "Columns". List optional columns with checkboxes; locked columns (id, type, Flags, actions) are not listed or are shown as disabled. On "Apply" or "Save", call parent with new `visibleColumns` and close.
- **Filter section**: Heading "Filters" (all ANDed). Use existing styling (labels, `input`, `select`, date inputs).
  - **Status**: `<select>` — options from `filterOptions.statuses` (load once when modal opens via `api.queue.filterOptions()`).
  - **Type**: `<select>` — options from `filterOptions.job_types` (or `JOB_TYPES` from [frontend/src/lib/jobTypes.js](frontend/src/lib/jobTypes.js) if you prefer; backend list ensures only existing types).
  - **Run after (scheduled after)**: Single datetime or date input; maps to `run_after_after` (show only jobs with `run_after > value`).
  - **Has error** / **Has warning**: Dropdowns with options like "Any", "Yes", "No" (backend: send `error_flag`/`warning_flag` only when "Yes" or "No").
  - **Acknowledged**: Same "Any" / "Yes" / "No" → `acknowledge_flag`.
  - **Video ID** / **Channel ID**: Number inputs; send only when non-empty.
  - **Date ranges**: For **record_created**, **last_update**, **run_after**: each has "From" and "To" (date or datetime); map to `record_created_from/to`, `last_update_from/to`, `run_after_from/to`.
- Buttons: "Clear filters", "Apply" (apply filters and column visibility, close modal), "Cancel" (close without applying). Optionally "Reset columns to default".
- Pass in: `visibleColumns`, `onVisibleColumnsChange`, `filters`, `onFiltersChange`, `onClose`, and optionally `filterOptions` (or fetch inside modal).

---

## 6. Queue page: table rendering and wiring

**File: [frontend/src/pages/Queue.jsx](frontend/src/pages/Queue.jsx)**

- **Table**: Define column config (key, label, sortKey if any, render cell). Loop over `[locked columns] + visibleColumns` to render `<th>` and `<td>`. Keep sort buttons only on columns that support sorting (reuse current sortBy/sortOrder). Keep ID and Type as links to job details; Flags and Actions unchanged.
- **PaginationBar**: Render twice (top and bottom) as now; pass `onFilterClick={() => setShowColumnFilterModal(true)}` and `filterActive={hasActiveFilters}`.
- **Modal**: Render `QueueColumnFilterModal` when `showColumnFilterModal` is true; on Apply, update `visibleColumns` and `filters` state (and persist to localStorage), then close. List fetch effect must depend on `filters` (and page, sortBy, sortOrder) so changing filters refetches with new total.
- **displayJobs**: Continue to use `pageJobs` merged with `jobOverrides`/`videoProgressOverrides`; **remove** client-side filtering in `sortedJobs` (filtering is server-side). So `sortedJobs` becomes just the current page items with sort applied — but sort is already done server-side, so you may only need to merge overrides and not re-sort. If the backend returns already-sorted items, `displayJobs` can be the merged list and the table renders it; no need for a separate client sort.

---

## 7. Sorting and pagination

- **Sorting**: Already sent in list request (`sort_by`, `sort_order`). Keep column headers that are sortable; when visible columns change, only show sort controls for columns that exist and are sortable (id, priority, job_type, video_id, status, record_created, last_update).
- **Pagination**: `onPageChange` stays as-is. When filters are applied, `totalPages` and the "of N" value use `listTotal` from the last list response; when no filters, use WebSocket `totalCount`. Ensure when filters change you reset to page 1 and refetch.
- **WebSocket**: Continue to use `jobOverrides` and `videoProgressOverrides` so the table rows update in place; when the user changes page/sort/filters, the existing `useEffect` refetches and overwrites `pageJobs`. No polling; follow "Preference for WebSockets" rule.

---

## 8. Logging

- **Severity**: All logging added for this work must use **debug or low_level severity**, except for **errors and warnings**, which should be logged at the appropriate error/warning severity.
- Log important events (e.g. queue filters applied, queue columns changed, filter-options or list request failures) using the existing logging system ([Logging rule](.cursor/rules/Logging.mdc)). Use debug/low_level for normal operations (filter applied, columns changed, filter-options fetched); use error/warning severity only for actual failures or exceptional conditions.

---

## 9. Edge cases and UX

- **Empty filter options**: If `filterOptions` returns empty arrays, show a single "Any" or "—" option so the dropdown still works.
- **Date inputs**: Use `type="datetime-local"` or separate date + time; send ISO strings to the API. Backend parses with FastAPI/datetime.
- **Horizontal scroll**: Per workspace rule, avoid horizontal scrollbars; the table can stay within the container (existing `overflow-x-hidden` on the table wrapper); if many columns are shown, consider allowing horizontal scroll only on the table with a wrapper so the rest of the page doesn't scroll horizontally.

---

## Summary of files to touch

| Area | File | Changes |
|------|------|--------|
| Backend | [backend/api/queue.py](backend/api/queue.py) | New query params in `list_jobs`; new GET `/queue/filter-options` |
| API client | [frontend/src/api/client.js](frontend/src/api/client.js) | Extend `queue.list` params; add `queue.filterOptions` |
| Pagination | [frontend/src/components/PaginationBar.jsx](frontend/src/components/PaginationBar.jsx) | Optional filter icon + tooltip |
| Queue page | [frontend/src/pages/Queue.jsx](frontend/src/pages/Queue.jsx) | Column state, filter state, list with filters, use list total when filtered, dynamic table columns, open modal from icon, remove URL-based client filters |
| New | `frontend/src/components/QueueColumnFilterModal.jsx` | Modal UI: column checkboxes, filter form (dropdowns + inputs + date ranges), Apply/Cancel/Clear |

No database migrations required; all filters use existing `job_queue` columns.
