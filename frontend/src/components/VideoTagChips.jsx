import { DynamicIcon } from "lucide-react/dynamic";
import { Tooltip } from "./Tooltip";

/**
 * Renders up to maxVisible tag chips (same style as Video details modal).
 * If more than maxVisible tags, shows first (maxVisible - 1) chips then a "plus X more" chip.
 * No delete icon; clicking a tag chip calls onTagClick(tag); clicking "plus X more" calls onMoreClick.
 * Hovering "plus X more" shows the list of additional tag names, one per line.
 */
export function VideoTagChips({ tags = [], maxVisible = 3, onTagClick, onMoreClick }) {
  if (!tags?.length) return null;

  const showMoreChip = tags.length > maxVisible;
  const visibleTags = showMoreChip ? tags.slice(0, maxVisible - 1) : tags;
  const moreTags = showMoreChip ? tags.slice(maxVisible - 1) : [];
  const moreCount = moreTags.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleTags.map((t) => (
        <button
          key={t.tag_id}
          type="button"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-gray-600 cursor-pointer select-none hover:opacity-90 transition-opacity"
          style={{
            backgroundColor: t.bg_color || "#111827",
            color: t.fg_color || "#f3f4f6",
            borderColor: t.fg_color ? "rgba(255,255,255,0.2)" : undefined,
          }}
          onClick={() => onTagClick?.(t)}
        >
          {t.icon_before && (
            <DynamicIcon name={t.icon_before} className="w-3 h-3 shrink-0" />
          )}
          <span className="pointer-events-none">{t.title}</span>
          {t.icon_after && (
            <DynamicIcon name={t.icon_after} className="w-3 h-3 shrink-0" />
          )}
        </button>
      ))}
      {showMoreChip && (
        <Tooltip
          title={moreTags.map((t) => t.title).join("\n")}
          side="top"
          wrap
        >
          <button
            type="button"
            onClick={() => onMoreClick?.()}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-gray-600 bg-gray-800 text-gray-300 cursor-pointer select-none hover:bg-gray-700 hover:text-gray-200 transition-colors"
          >
            plus {moreCount} more
          </button>
        </Tooltip>
      )}
    </div>
  );
}
