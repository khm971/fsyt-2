import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const btnClass =
  "flex items-center justify-center gap-1 min-w-[2.25rem] px-2 py-1.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-700";

/**
 * Unified pagination bar. Page is 1-based.
 * @param {number} page - Current page (1-based)
 * @param {number} totalPages - Total number of pages
 * @param {number} total - Total item count
 * @param {number} pageSize - Items per page
 * @param {string} itemLabel - Label for items (e.g. "jobs", "videos", "entries")
 * @param {(page: number) => void} onPageChange - Called with new 1-based page
 * @param {boolean} [disabled] - Disable all buttons (e.g. while loading)
 */
export function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  itemLabel,
  onPageChange,
  disabled = false,
}) {
  if (totalPages <= 1 && total <= pageSize) return null;

  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 px-3 bg-gray-800/60 border border-gray-700 rounded-lg">
      <span className="text-sm text-gray-400">
        Showing {total === 0 ? 0 : startItem}–{endItem} of {total} {itemLabel}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={disabled || page <= 1}
          className={btnClass}
          aria-label="First page"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
          className={btnClass}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="sr-only">Previous</span>
        </button>
        <span className="text-sm text-gray-400 px-2 min-w-[6rem] text-center">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
          className={btnClass}
          aria-label="Next page"
        >
          <span className="sr-only">Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={disabled || page >= totalPages}
          className={btnClass}
          aria-label="Last page"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
