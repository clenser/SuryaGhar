import { ChevronDown, Satellite } from "lucide-react";
import { activeImageryProvider } from "../../providers/imagery";

interface ImagerySelectorProps {
  onOpenLayers: () => void;
}

/**
 * Compact floating imagery control. The app ships a single satellite
 * provider, so this surfaces the current source and opens the existing
 * layer panel for any changes — no providers are invented here.
 */
export function ImagerySelector({ onOpenLayers }: ImagerySelectorProps) {
  return (
    <button
      type="button"
      className="imagery-selector"
      onClick={onOpenLayers}
      aria-haspopup="dialog"
      title="Satellite view options"
    >
      <span className="imagery-selector__swatch" aria-hidden="true">
        <Satellite size={15} strokeWidth={1.75} />
      </span>
      <span className="imagery-selector__text">
        <span className="imagery-selector__title">Satellite view</span>
        <span className="imagery-selector__subtitle">{activeImageryProvider.getDisplayName()}</span>
      </span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="imagery-selector__chevron" />
    </button>
  );
}
