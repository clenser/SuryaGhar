import { useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudSun,
  Layers,
  MapPin,
  Pause,
  Play,
  Sun,
  Trees,
  Zap,
} from "lucide-react";
import type { WeatherPreset } from "../../lib/3d/lighting";
import type { useSunSimulation } from "../../hooks/useSunSimulation";

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
 * Exposes strictly 5 allowed visual simulation controls + navigation.
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

          {/* 2. Daylight / Sun Simulation */}
          <div className="final-model-section">
            <div className="final-model-section__row">
              <span className="final-model-section__label">2. Daylight / Sun Simulation</span>
              <span className="final-model-time-readout">{formattedTime}</span>
            </div>
            <div className="final-model-sun-row">
              <button
                type="button"
                className={`btn btn--icon ${sun.playing ? "is-active" : ""}`}
                onClick={sun.togglePlay}
                aria-label={sun.playing ? "Pause daylight simulation" : "Play daylight simulation"}
                title={sun.playing ? "Pause daylight simulation" : "Play full-day sun simulation"}
              >
                {sun.playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <input
                type="range"
                className="final-model-slider"
                min={0}
                max={1440}
                step={1}
                value={Math.min(1440, Math.round(sun.timeMinutes))}
                onChange={handleTimeSlider}
                aria-label="Time of day"
                aria-valuetext={`${formattedTime} local time`}
              />
            </div>
          </div>

          {/* 3. Electricity Flow */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">3. Electricity Flow</span>
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

          {/* 4. X-ray */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">4. X-ray View</span>
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

          {/* 5. Tree Visibility */}
          <div className="final-model-section">
            <div className="final-model-toggle-row">
              <span className="final-model-section__label">5. Tree Visibility</span>
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

          {/* Navigation Controls */}
          <div className="final-model-nav">
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
