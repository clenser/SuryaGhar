import { useRef } from "react";
import { ChevronDown, ChevronUp, GripHorizontal } from "lucide-react";
import type { SheetState } from "../../hooks/useBottomSheet";

interface SheetBarProps {
  sheet: SheetState;
  stageLabel: string;
  summary: string | null;
  onCycle: () => void;
  onDragEnd: (dyPx: number) => void;
}

/**
 * Mobile bottom-sheet chrome: drag handle, current stage, compact result.
 * Rendered always but only visible below the phone breakpoint (CSS).
 * Interaction contract:
 * - tap (pointer without movement) cycles collapsed -> partial -> expanded
 * - vertical drag (>= snap threshold, handled by parent) snaps to a state
 * - keyboard Enter/Space fires click without a preceding pointer sequence,
 *   so it cycles too. A `pointerHandled` flag prevents double-cycling when
 *   the browser synthesises a click after pointerup.
 */
export function SheetBar({ sheet, stageLabel, summary, onCycle, onDragEnd }: SheetBarProps) {
  const startY = useRef<number | null>(null);
  const moved = useRef(false);
  const pointerHandled = useRef(false);

  return (
    <div className="sheet-bar" data-sheet={sheet}>
      <button
        type="button"
        className="sheet-handle"
        aria-label={
          sheet === "expanded"
            ? "Collapse results panel"
            : sheet === "partial"
              ? "Expand results panel"
              : "Show results panel"
        }
        aria-expanded={sheet === "expanded"}
        onClick={() => {
          if (pointerHandled.current) {
            pointerHandled.current = false;
            return;
          }
          onCycle();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          startY.current = e.clientY;
          moved.current = false;
          pointerHandled.current = false;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (startY.current === null) return;
          if (Math.abs(e.clientY - startY.current) > 8) moved.current = true;
        }}
        onPointerUp={(e) => {
          if (startY.current === null) return;
          const dy = startY.current - e.clientY;
          startY.current = null;
          pointerHandled.current = true;
          if (moved.current) {
            onDragEnd(dy);
          } else {
            onCycle();
          }
        }}
        onPointerCancel={() => {
          startY.current = null;
          moved.current = false;
          pointerHandled.current = true;
        }}
      >
        <GripHorizontal size={20} strokeWidth={2} aria-hidden="true" className="sheet-handle__grip" />
        <span className="sheet-handle__title">{stageLabel}</span>
        {summary ? (
          <span className="sheet-handle__summary">{summary}</span>
        ) : null}
        {sheet === "expanded" ? (
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
