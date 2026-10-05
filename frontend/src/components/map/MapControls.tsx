import { Plus, Minus, Compass, Mountain, Layers, LocateFixed } from "lucide-react";

interface MapControlsProps {
  bearing: number;
  pitch: number;
  layersOpen: boolean;
  terrainOn: boolean;
  buildingsOn: boolean;
  onLocate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  onTogglePitch: () => void;
  onToggleTerrain: () => void;
  onToggleLayers: () => void;
}

/** Grouped, compact map controls (MASTER_PROMPT section 9-10). */
export function MapControls(props: MapControlsProps) {
  const northRotated = Math.abs(props.bearing) > 0.5;
  const tilted = props.pitch > 1;
  return (
    <div className="map-controls" aria-label="Map controls">
      <div className="map-controls__group">
        <button type="button" className="map-btn" onClick={props.onLocate} aria-label="Current position" title="Current position">
          <LocateFixed size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="map-controls__divider" aria-hidden="true" />
        <button type="button" className="map-btn" onClick={props.onZoomIn} aria-label="Zoom in" title="Zoom in">
          <Plus size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="map-controls__divider" aria-hidden="true" />
        <button type="button" className="map-btn" onClick={props.onZoomOut} aria-label="Zoom out" title="Zoom out">
          <Minus size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="map-controls__group">
        <button
          type="button"
          className="map-btn"
          onClick={props.onResetNorth}
          aria-label={northRotated ? "Reset map to north" : "Map is facing north"}
          title="Reset to north"
          disabled={!northRotated}
        >
          <Compass
            size={17}
            strokeWidth={1.75}
            aria-hidden="true"
            style={{ transform: `rotate(${-props.bearing}deg)`, transition: "transform var(--motion-base) var(--ease-standard)" }}
          />
        </button>
      </div>

      <div className="map-controls__group">
        <button
          type="button"
          className={`map-btn${tilted ? " is-active" : ""}`}
          onClick={props.onTogglePitch}
          aria-pressed={tilted}
          aria-label="Toggle 3D perspective"
          title="Tilt view"
        >
          <span className="map-btn__text" aria-hidden="true">3D</span>
        </button>
        <span className="map-controls__divider" aria-hidden="true" />
        <button
          type="button"
          className={`map-btn${props.terrainOn ? " is-active" : ""}`}
          onClick={props.onToggleTerrain}
          aria-pressed={props.terrainOn}
          aria-label="Toggle terrain relief"
          title="Terrain relief"
        >
          <Mountain size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="map-controls__group">
        <button
          type="button"
          className={`map-btn${props.layersOpen ? " is-active" : ""}`}
          onClick={props.onToggleLayers}
          aria-expanded={props.layersOpen}
          aria-controls="layer-panel"
          aria-label="Map layers"
          title="Map layers"
        >
          <Layers size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
