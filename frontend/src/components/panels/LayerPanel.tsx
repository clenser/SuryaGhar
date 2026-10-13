import { X, Layers, Sliders, Stethoscope } from "lucide-react";
import type { LayerSettings, MapErrorEntry } from "../../types";
import { activeImageryProvider } from "../../providers/imagery";
import { activeTerrainProvider } from "../../providers/terrain";
import { INDIAN_TEST_SITES } from "../../config/locations";
import type { LocationResult } from "../../types";
import { useMapProvider } from "../../services/mapProvider";

interface LayerPanelProps {
  open: boolean;
  layers: LayerSettings;
  advanced: boolean;
  errors: MapErrorEntry[];
  onChange: (next: Partial<LayerSettings>) => void;
  onAdvancedChange: (value: boolean) => void;
  onClose: () => void;
  onJumpTo: (place: LocationResult) => void;
}

export function LayerPanel({ open, layers, advanced, errors, onChange, onAdvancedChange, onClose, onJumpTo }: LayerPanelProps) {
  const mapState = useMapProvider();
  const isGoogleActive = mapState === "google-ready" || mapState === "google-loading";
  const imageryCoverage = activeImageryProvider.getCoverageInfo();
  const terrainCoverage = activeTerrainProvider.getCoverage();

  return (
    <aside
      id="layer-panel"
      className={`layer-panel${open ? " is-open" : ""}`}
      aria-label="Map layers"
      aria-hidden={!open}
    >
      <header className="layer-panel__header">
        <div className="layer-panel__title">
          <Layers size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2>Map layers</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close layers">
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <div className="layer-panel__body">
        <section className="layer-group" aria-labelledby="layers-heading">
          <h3 id="layers-heading" className="layer-group__title">Display</h3>
          <Toggle
            label="Satellite imagery"
            description="Primary base layer"
            checked={layers.satelliteOpacity > 0}
            onChange={(v) => onChange({ satelliteOpacity: v ? 1 : 0 })}
          />
          <Toggle
            label="Roads and place names"
            description="OpenStreetMap context over imagery"
            checked={layers.contextOpacity > 0}
            onChange={(v) => onChange({ contextOpacity: v ? 1 : 0 })}
          />
          <Toggle
            label="3D buildings"
            description="Footprints extruded from OpenStreetMap height tags"
            checked={layers.buildings3d}
            onChange={(v) => onChange({ buildings3d: v })}
          />
          <Toggle
            label="Terrain relief"
            description={`Elevation from ${activeTerrainProvider.getDisplayName()}`}
            checked={layers.terrain}
            onChange={(v) => onChange({ terrain: v })}
          />
        </section>

        <section className="layer-group layer-group--row" aria-label="Advanced mode">
          <div>
            <h3 className="layer-group__title">Advanced</h3>
            <p className="layer-group__hint">Opacity, exaggeration and provider diagnostics</p>
          </div>
          <Toggle label="Advanced mode" description="" checked={advanced} onChange={onAdvancedChange} compact />
        </section>

        {advanced && (
          <>
            <section className="layer-group" aria-labelledby="tuning-heading">
              <h3 id="tuning-heading" className="layer-group__title"><Sliders size={13} aria-hidden="true" /> Tuning</h3>
              <Slider
                label="Satellite opacity"
                value={layers.satelliteOpacity}
                min={0.2}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onChange({ satelliteOpacity: v })}
              />
              <Slider
                label="Context opacity"
                value={layers.contextOpacity}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onChange({ contextOpacity: v })}
              />
              <Slider
                label="Terrain exaggeration"
                value={layers.terrainExaggeration}
                min={1}
                max={2}
                step={0.1}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(v) => onChange({ terrainExaggeration: v })}
              />
            </section>

            <section className="layer-group" aria-labelledby="diag-heading">
              <h3 id="diag-heading" className="layer-group__title"><Stethoscope size={13} aria-hidden="true" /> Diagnostics</h3>
              <dl className="meta-list">
                <div>
                  <dt>Imagery</dt>
                  <dd>
                    {isGoogleActive ? "Google Maps Satellite" : `${activeImageryProvider.getDisplayName()}${imageryCoverage.prototypeOnly ? " · prototype" : ""}`}
                  </dd>
                </div>
                <div><dt>Native max zoom</dt><dd>{isGoogleActive ? 22 : imageryCoverage.nativeMaxZoom}</dd></div>
                <div><dt>Terrain</dt><dd>{activeTerrainProvider.getDisplayName()} · max z{terrainCoverage.maxZoom}</dd></div>
              </dl>
              <p className="layer-group__hint">
                {isGoogleActive
                  ? "High-resolution satellite imagery powered by Google Maps with precision zoom up to z22."
                  : imageryCoverage.notes}
              </p>
              <p className="layer-group__hint">{terrainCoverage.resolutionNote}</p>

              <h4 className="layer-group__subtitle">Test sites</h4>
              <ul className="test-sites">
                {INDIAN_TEST_SITES.map((site) => (
                  <li key={site.id}>
                    <button type="button" className="test-site" onClick={() => onJumpTo(site.place)}>
                      <span>{site.label}</span>
                      <span className="test-site__kind">{site.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <h4 className="layer-group__subtitle">Map events</h4>
              {errors.length === 0 ? (
                <p className="layer-group__hint">No provider errors recorded this session.</p>
              ) : (
                <ol className="error-log">
                  {errors.slice(-6).map((e) => (
                    <li key={e.id}>
                      <span className="error-log__time">{e.at}</span>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  compact,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label className={`toggle${compact ? " toggle--compact" : ""}`}>
      <span className="toggle__text">
        {label && <span className="toggle__label">{label}</span>}
        {description && <span className="toggle__desc">{description}</span>}
      </span>
      <input
        type="checkbox"
        className="toggle__input"
        checked={checked}
        aria-label={label || description}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true"><span className="toggle__thumb" /></span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span className="slider__label">{label}</span>
        <span className="slider__value">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
