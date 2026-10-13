import { ChevronDown, Satellite } from "lucide-react";
import { activeImageryProvider } from "../../providers/imagery";
import { useMapProvider } from "../../services/mapProvider";

interface ImagerySelectorProps {
  onOpenLayers: () => void;
}

/**
 * Compact floating imagery control. Shows the active satellite imagery source
 * and opens the existing layer panel for any adjustments.
 */
export function ImagerySelector({ onOpenLayers }: ImagerySelectorProps) {
  const mapState = useMapProvider();
  const isGoogleActive = mapState === "google-ready" || mapState === "google-loading";
  const providerName = isGoogleActive ? "Google Maps Satellite" : activeImageryProvider.getDisplayName();

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
        <span className="imagery-selector__subtitle">{providerName}</span>
      </span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="imagery-selector__chevron" />
    </button>
  );
}
