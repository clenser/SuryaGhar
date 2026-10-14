import { useState } from "react";
import {
  ArrowLeft,
  Bird,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudSun,
  Download,
  Layers,
  Loader2,
  MapPin,
  Moon,
  Pause,
  Play,
  Sun,
  Trees,
  Zap,
} from "lucide-react";
import type { WeatherPreset } from "../../lib/3d/lighting";
import type { useSunSimulation } from "../../hooks/useSunSimulation";
import { compassDirection } from "../../services/analysis";
import { formatClockTime } from "../../lib/solar";

export interface FinalModelControlsProps {
  weatherPreset: WeatherPreset;
  onWeatherPresetChange: (preset: WeatherPreset) => void;
  sun: ReturnType<typeof useSunSimulation>;
  electricityFlowActive: boolean;
  onToggleElectricityFlow: () => void;
  xray: boolean;
  onToggleXray: () => void;
  treesVisible: boolean;
  onToggleTrees: () => void;
  /** Whether nature animations (birds & clouds) are active in presentation view */
  natureActive?: boolean;
  onToggleNature?: () => void;
  /** Export 3D model action */
  onExport3DModel?: () => void;
  /** Whether 3D model export is currently generating */
  isExporting3D?: boolean;
  onBackToDesign?: () => void;
  onBackToMap?: () => void;
}

const WEATHER_OPTIONS: Array<{ id: WeatherPreset; label: string; icon: typeof Sun }> = [
  { id: "sunny", label: "Sunny", icon: Sun },
  { id: "cloudy", label: "Cloudy", icon: CloudSun },
  { id: "rainy", label: "Rainy", icon: Cloud },
];

/**
 * Clean executive floating control panel for the read-only Final Model presentation view.
 * Exposes visual simulation controls (Weather, Sun, Nature, Electricity, X-Ray, Trees) + navigation.
 */
export function FinalModelControls({
  weatherPreset,
  onWeatherPresetChange,
  sun,
  electricityFlowActive,
  onToggleElectricityFlow,
  xray,
  onToggleXray,
  treesVisible,
  onToggleTrees,
  natureActive = false,
  onToggleNature,
  onExport3DModel,
  isExporting3D = false,
  onBackToDesign,
  onBackToMap,
}: FinalModelControlsProps) {
  const [collapsed, setCollapsed] = useState(false);

  const formattedTime = formatClockTime(sun.timeMinutes);

  const handleTimeSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    sun.setTime(val);
  };

  return (
    <div
      className={`final-model-overlay ${collapsed ? "final-model-overlay--collapsed" : ""}`}
      role="region"
      aria-label="Final model presentation controls"
    >
      <div className="final-model-overlay__header">
        <div className="final-model-overlay__title-wrap">
          <span className="final-model-overlay__badge">Final Model</span>
          <h3 className="final-model-overlay__heading">Presentation View</h3>
        </div>
        <button
          type="button"
          className="btn btn--subtle final-model-overlay__collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand controls" : "Collapse controls"}
          title={collapsed ? "Expand controls" : "Collapse controls"}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="final-model-overlay__body">
          {/* 1. Weather Preset */}
          <div className="final-model-section">
            <span className="final-model-section__label">1. Weather Preset</span>
            <div className="final-model-btn-group" role="group" aria-label="Weather presets">
              {WEATHER_OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`btn btn--toggle ${weatherPreset === id ? "is-active" : ""}`}
                  onClick={() => onWeatherPresetChange(id)}
                  title={`Set weather to ${label}`}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Daylight / Sun Simulation (Inspired by Section 2 SunControls) */}
          <div className="final-model-section">
            <div className="final-model-section__row">
              <span className="final-model-section__label">2. Daylight &amp; Sun Simulation</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="final-model-time-readout">{formattedTime}</span>
                {sun.state && (
                  <span className={`sun-state-chip ${sun.state.night ? "sun-state-chip--night" : "sun-state-chip--day"}`}>
                    {sun.state.night ? (
                      <>
                        <Moon size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                        Night
                      </>
                    ) : (
                      <>
                        <Sun size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                        Daylight
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Play/Pause & Speed Row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginTop: "2px" }}>
              <button
                type="button"
                className={`btn ${sun.playing ? "btn--primary" : "btn--secondary"}`}
                onClick={sun.togglePlay}
                style={{ flex: 1, height: "28px", fontSize: "var(--text-xs)", justifyContent: "center", padding: "0 8px" }}
                aria-label={sun.playing ? "Pause daylight simulation" : "Play daylight simulation"}
                title={sun.playing ? "Pause daylight simulation" : "Play full-day sun simulation"}
              >
                {sun.playing ? <Pause size={13} strokeWidth={2} aria-hidden="true" /> : <Play size={13} strokeWidth={2} aria-hidden="true" />}
                <span style={{ marginLeft: "4px" }}>{sun.playing ? "Pause" : "Play day"}</span>
              </button>

              <div className="sun-speed-group" role="group" aria-label="Simulation speed">
                {[
                  { label: "0.5×", val: 10 },
                  { label: "1×", val: 20 },
                  { label: "2×", val: 40 },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className={`sun-speed-btn ${sun.speed === s.val ? "sun-speed-btn--active" : ""}`}
                    onClick={() => sun.setSpeed(s.val)}
                    aria-label={`${s.label} speed`}
                    title={`${s.label} speed (${s.val} min/sec)`}
                    style={{ padding: "2px 6px", fontSize: "0.68rem" }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Continuous Day/Night Gradient Slider Track */}
            <div className="sun-slider-wrapper" style={{ padding: "4px 0 2px" }}>
              <input
                id="final-model-sun-slider"
                type="range"
                className="sun-time-slider"
                min={0}
                max={1440}
                step={1}
                value={Math.min(1440, Math.round(sun.timeMinutes))}
                onChange={handleTimeSlider}
                aria-label="Time of day"
                aria-valuetext={`${formattedTime} local time`}
              />
            </div>

            {/* Timeline markers */}
            <div className="sun-timeline-markers" style={{ marginTop: "2px" }}>
              <button
                type="button"
                className="sun-marker-btn"
                onClick={() => sun.setTime(0)}
                aria-label="Jump to 00:00 (Midnight)"
                title="Jump to 00:00 (Midnight)"
              >
                <span>00:00</span>
                <span className="sun-marker-sub">Night</span>
              </button>
              <button
                type="button"
                className="sun-marker-btn"
                onClick={() => sun.setTime(360)}
                aria-label="Jump to 06:00 (Dawn)"
                title="Jump to 06:00 (Dawn)"
              >
                <span>06:00</span>
                <span className="sun-marker-sub">Dawn</span>
              </button>
              <button
                type="button"
                className="sun-marker-btn"
                onClick={() => sun.setTime(720)}
                aria-label="Jump to 12:00 (Solar Noon)"
                title="Jump to 12:00 (Solar Noon)"
              >
                <span>12:00</span>
                <span className="sun-marker-sub">Noon</span>
              </button>
              <button
                type="button"
                className="sun-marker-btn"
                onClick={() => sun.setTime(1080)}
                aria-label="Jump to 18:00 (Dusk)"
                title="Jump to 18:00 (Dusk)"
              >
                <span>18:00</span>
                <span className="sun-marker-sub">Dusk</span>
              </button>
              <button
                type="button"
                className="sun-marker-btn"
                onClick={() => sun.setTime(1440)}
                aria-label="Jump to 24:00 (Midnight)"
                title="Jump to 24:00 (Midnight)"
              >
                <span>24:00</span>
                <span className="sun-marker-sub">Night</span>
              </button>
            </div>

            {/* Sun position readout */}
            {sun.state && (
              <p
                className={`sun-readout ${sun.state.night ? "sun-readout--night" : ""}`}
                style={{ margin: "4px 0 0", padding: "4px 8px", fontSize: "0.72rem", borderLeftWidth: "2px" }}
                role="status"
              >
                {sun.state.night ? (
                  <>
                    <Moon size={12} strokeWidth={1.75} aria-hidden="true" />
                    Night — sun below horizon, no direct sunlight
                  </>
                ) : (
                  <>
                    <Sun size={12} strokeWidth={1.75} aria-hidden="true" style={{ color: "#f59e0b" }} />
                    Azimuth <strong>{sun.state.azimuthDeg.toFixed(1)}°</strong>{" "}
                    {compassDirection(sun.state.azimuthDeg)} · Elev{" "}
                    <strong>{sun.state.elevationDeg.toFixed(1)}°</strong>
                  </>
                )}
              </p>
            )}
          </div>

          {/* 3. Nature (Birds & Clouds Animation) */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">3. Nature (Birds &amp; Clouds)</span>
              <button
                type="button"
                className={`btn btn--toggle ${natureActive ? "is-active" : ""}`}
                onClick={onToggleNature}
                aria-pressed={natureActive}
                aria-label="Toggle nature animations"
                title="Toggle nature animations: flying birds and drifting clouds"
              >
                <Bird size={14} aria-hidden="true" />
                <span>{natureActive ? "Active" : "Off"}</span>
              </button>
            </div>
          </div>

          {/* 4. Electricity Flow */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">4. Electricity Flow</span>
              <button
                type="button"
                className={`btn btn--toggle ${electricityFlowActive ? "is-active" : ""}`}
                onClick={onToggleElectricityFlow}
                aria-pressed={electricityFlowActive}
                title="Toggle animated electricity flow along roof conduits"
              >
                <Zap size={14} aria-hidden="true" />
                <span>{electricityFlowActive ? "Active" : "Hidden"}</span>
              </button>
            </div>
          </div>

          {/* 5. X-ray */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">5. X-ray View</span>
              <button
                type="button"
                className={`btn btn--toggle ${xray ? "is-active" : ""}`}
                onClick={onToggleXray}
                aria-pressed={xray}
                title="Toggle building shell transparency"
              >
                <Layers size={14} aria-hidden="true" />
                <span>{xray ? "Transparent" : "Solid"}</span>
              </button>
            </div>
          </div>

          {/* 6. Tree Visibility */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">6. Tree Visibility</span>
              <button
                type="button"
                className={`btn btn--toggle ${treesVisible ? "is-active" : ""}`}
                onClick={onToggleTrees}
                aria-pressed={treesVisible}
                title="Toggle surrounding trees"
              >
                <Trees size={14} aria-hidden="true" />
                <span>{treesVisible ? "Visible" : "Hidden"}</span>
              </button>
            </div>
          </div>

          {/* Navigation & Export Controls */}
          <div className="final-model-nav">
            {onExport3DModel && (
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={onExport3DModel}
                disabled={isExporting3D}
                title="Export the complete assembled 3D solar installation as a GLB file"
                style={{ marginBottom: "var(--space-2)" }}
              >
                {isExporting3D ? (
                  <Loader2 size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={15} strokeWidth={2} aria-hidden="true" />
                )}
                <span style={{ marginLeft: "6px" }}>
                  {isExporting3D ? "Exporting GLB Model…" : "Export 3D Model (GLB)"}
                </span>
              </button>
            )}
            {onBackToDesign && (
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={onBackToDesign}
                title="Return to the editable Step 2 3D workspace"
              >
                <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
                Back to Design
              </button>
            )}
            {onBackToMap && (
              <button
                type="button"
                className="btn btn--subtle btn--block"
                onClick={onBackToMap}
                title="Return to Step 1 / Map view to select another site"
              >
                <MapPin size={15} strokeWidth={2} aria-hidden="true" />
                New Site / Back to Map
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
