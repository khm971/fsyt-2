/**
 * Tooltip with offset from the trigger to avoid being covered by large cursors.
 * Positions above the element by default with ~8px gap.
 */
export function Tooltip({ children, title, side = "top" }) {
  if (!title) return children;

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span className="relative group/tooltip inline-flex">
      {children}
      <span
        className={`absolute ${sideClasses[side]} px-3 py-1.5 rounded-md bg-gray-800 text-gray-100 text-xs whitespace-nowrap opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-opacity duration-150 pointer-events-none z-50 border border-gray-700 shadow-lg`}
      >
        {title}
      </span>
    </span>
  );
}
