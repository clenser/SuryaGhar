import { Sun, SlidersHorizontal } from "lucide-react";
import { LocationSearch } from "../search/LocationSearch";
import { BackendStatusIndicator } from "./BackendStatusIndicator";
import { MapProviderIndicator } from "./MapProviderIndicator";
import { ThemeToggle } from "./ThemeToggle";
import type { LocationResult } from "../../types";

interface HeaderProps {
  advanced: boolean;
  onAdvancedToggle: () => void;
  onSelectPlace: (place: LocationResult) => void;
  /** 3D design workspace active — shown as a header pill like ui.png. */
  designMode?: boolean;
}

export function Header({ advanced, onAdvancedToggle, onSelectPlace, designMode = false }: HeaderProps) {
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
        {designMode && (
          <span className="backend-status" aria-live="polite" title="3D design workspace">
            <span className="backend-status__dot backend-status__dot--online" aria-hidden="true" />
            <span className="backend-status__full">Design mode</span>
            <span className="backend-status__short">Design</span>
          </span>
        )}
        <MapProviderIndicator />
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
