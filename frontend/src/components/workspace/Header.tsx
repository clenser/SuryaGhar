import { Sun, SlidersHorizontal } from "lucide-react";
import { LocationSearch } from "../search/LocationSearch";
import { BackendStatusIndicator } from "./BackendStatusIndicator";
import { ThemeToggle } from "./ThemeToggle";
import type { LocationResult } from "../../types";

interface HeaderProps {
  advanced: boolean;
  onAdvancedToggle: () => void;
  onSelectPlace: (place: LocationResult) => void;
}

export function Header({ advanced, onAdvancedToggle, onSelectPlace }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true"><Sun size={17} strokeWidth={2} /></span>
        <span className="brand__name">Surya-Ghar</span>
      </div>
      <div className="app-header__search">
        <LocationSearch onSelect={onSelectPlace} />
      </div>
      <div className="app-header__actions">
        <BackendStatusIndicator />
        <ThemeToggle />
        <button
          type="button"
          className={`header-btn${advanced ? " is-active" : ""}`}
          onClick={onAdvancedToggle}
          aria-pressed={advanced}
          title="Advanced map and provider details"
        >
          <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>Advanced</span>
        </button>
      </div>
    </header>
  );
}
