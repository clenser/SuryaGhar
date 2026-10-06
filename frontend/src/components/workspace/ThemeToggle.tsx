import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

/** Compact header theme switch (light/dark), persisted per device. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toDark = theme !== "dark";
  return (
    <button
      type="button"
      className="header-btn theme-toggle"
      onClick={toggle}
      aria-label={toDark ? "Switch to dark theme" : "Switch to light theme"}
      title={toDark ? "Switch to dark theme" : "Switch to light theme"}
      aria-pressed={!toDark}
    >
      {toDark ? (
        <Moon size={15} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Sun size={15} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  );
}
