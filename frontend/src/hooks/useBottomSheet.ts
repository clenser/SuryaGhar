import { useCallback, useState } from "react";

export type SheetState = "collapsed" | "partial" | "expanded";

const ORDER: SheetState[] = ["collapsed", "partial", "expanded"];

/** Drag distance in px that commits to the next/previous sheet state. */
export const SHEET_SNAP_PX = 48;

/**
 * Bottom-sheet state machine for the mobile workflow panel. Desktop ignores
 * it (CSS only applies the sheet below the phone breakpoint). Tap cycles
 * collapsed -> partial -> expanded -> collapsed; drags snap by threshold.
 * All transitions are instant state changes — animation lives in CSS and
 * respects prefers-reduced-motion via the motion tokens.
 *
 * Drag convention: `applyDrag(startY - endY)`, i.e. positive when the handle
 * was dragged upward (sheet grows), negative when dragged down (sheet shrinks).
 */
export function useBottomSheet(initial: SheetState = "partial") {
  const [sheet, setSheet] = useState<SheetState>(initial);

  const cycle = useCallback(() => {
    setSheet((prev) => ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]);
  }, []);

  const expand = useCallback(() => setSheet("expanded"), []);
  const collapse = useCallback(() => setSheet("collapsed"), []);

  /** Vertical drag delta in px (positive = dragged up). Snaps on release. */
  const applyDrag = useCallback((dyPx: number) => {
    if (dyPx >= SHEET_SNAP_PX) {
      setSheet((prev) => (prev === "collapsed" ? "partial" : "expanded"));
    } else if (dyPx <= -SHEET_SNAP_PX) {
      setSheet((prev) => (prev === "expanded" ? "partial" : "collapsed"));
    }
  }, []);

  return { sheet, setSheet, cycle, expand, collapse, applyDrag };
}
