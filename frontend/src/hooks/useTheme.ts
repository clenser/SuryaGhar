import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "suryaghar-theme";

/** Stored choice wins; otherwise follow the OS; default to light. Never throws. */
export function resolveInitialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage unavailable (private mode, etc.) — fall through to OS/default.
  }
  try {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {
    // matchMedia unavailable — fall through.
  }
  return "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Per-device theme state. Persists an explicit choice to localStorage (which
 * always wins afterwards); applies via `data-theme` so CSS variables swap.
 * Safe under StrictMode (idempotent) and without storage/DOM APIs.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the session still switches, it just won't persist.
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Non-fatal (see above).
      }
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
