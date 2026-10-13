/**
 * ViewportToolbar - Contextual tools overlay on the 3D viewport
 *
 * Compact floating toolbar anchored to the viewport (not the inspector),
 * showing only the tools relevant to the current mode. Mirrors the map
 * toolbar's visual language so the transition feels consistent.
 *
 * AGENTS.md §48: professional, minimal, engineering-oriented.
 * AGENTS.md §46: 44px touch targets on mobile.
 */

import { useState } from "react";
import {
  MousePointer2,
  PenTool,
  Move,
  Trash2,
  Layers,
  RotateCcw,
  Eye,
  Box,
  Sun,
  TreePine,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Zap,
  Building2,
  Bird,
} from "lucide-react";
import type { ObstacleType } from "../../lib/3d/obstacles";

export type ViewportTool =
  | "select"
  | "draw-obstacle"
  | "move"
  | "delete"
  | "layers"
  | "xray"
  | "reset-view"
  | "sun"
  | "trees"
  | "flow"
  | "nature";

export interface LayerVisibility {
  building: boolean;
  panels: boolean;
  obstacles: boolean;
  trees: boolean;
  ground: boolean;
  electricityFlow?: boolean;
  birds?: boolean;
  clouds?: boolean;
  nature?: boolean;
}

interface ViewportToolbarProps {
  /** Currently active tool */
  activeTool: ViewportTool | null;
  /** Callback when a tool is selected */
  onToolChange: (tool: ViewportTool | null) => void;
  /** Whether X-ray mode is active */
  xrayActive: boolean;
  /** Toggle X-ray mode */
  onToggleXray: () => void;
  /** Reset camera to default view (relocated to inspector bottom, kept optional here) */
  onResetView?: () => void;
  /** Current obstacle type for draw mode (Custom obstacles only) */
  obstacleType?: ObstacleType;
  /** Whether we're in footprint drawing mode */
  drawing?: boolean;
  /** Whether manual panel placement is active */
  manualPlaceActive?: boolean;
  /** Sun simulation playing state */
  sunPlaying?: boolean;
  /** Toggle sun playback */
  onToggleSunPlay?: () => void;
  /** Whether the inspector is collapsed (mobile) */
  inspectorCollapsed?: boolean;
  /** Exit 3D design mode and return to map */
  onExitDesign?: () => void;
  /** Layer visibility states */
  layerVisibility?: LayerVisibility;
  /** Toggle layer visibility callback */
  onToggleLayer?: (layer: keyof LayerVisibility) => void;
  /** Delete currently selected object callback */
  onDeleteSelected?: () => void;
  /** Whether an obstacle or tree is currently selected */
  hasSelectedObject?: boolean;
  /** Whether nature animations (birds & clouds) are active (default: false) */
  natureActive?: boolean;
  /** Toggle nature animations */
  onToggleNature?: () => void;
}

const TOOL_CONFIG: Record<Exclude<ViewportTool, "draw-obstacle">, { icon: React.ReactNode; label: string; title: string }> = {
  select: { icon: <MousePointer2 size={16} strokeWidth={2} />, label: "Select", title: "Select objects (V)" },
  move: { icon: <Move size={16} strokeWidth={2} />, label: "Move", title: "Move selected object (M)" },
  delete: { icon: <Trash2 size={16} strokeWidth={2} />, label: "Delete", title: "Delete selected object (Del)" },
  layers: { icon: <Layers size={16} strokeWidth={2} />, label: "Layers", title: "Toggle layer visibility (L)" },
  xray: { icon: <Eye size={16} strokeWidth={2} />, label: "X-ray", title: "Toggle X-ray view (X)" },
  "reset-view": { icon: <RotateCcw size={16} strokeWidth={2} />, label: "Reset view", title: "Reset camera to default view (R)" },
  sun: { icon: <Sun size={16} strokeWidth={2} />, label: "Sun", title: "Sun & shadows (S)" },
  trees: { icon: <TreePine size={16} strokeWidth={2} />, label: "Trees", title: "Trees & obstacles (T)" },
  flow: { icon: <Zap size={16} strokeWidth={2} />, label: "Electricity Flow", title: "Toggle animated electricity flow" },
  nature: { icon: <Bird size={16} strokeWidth={2} />, label: "Nature", title: "Toggle Nature animations: Clouds & Flying Birds" },
};

const DRAW_OBSTACLE_CONFIG: Record<ObstacleType, { icon: React.ReactNode; label: string; title: string }> = {
  "water-tank": { icon: <Box size={16} strokeWidth={2} />, label: "Water tank", title: "Draw water tank footprint" },
  "staircase-room": { icon: <Box size={16} strokeWidth={2} />, label: "Stair room", title: "Draw stair room footprint" },
  "lift-room": { icon: <Box size={16} strokeWidth={2} />, label: "Lift room", title: "Draw lift room footprint" },
  hvac: { icon: <Box size={16} strokeWidth={2} />, label: "HVAC", title: "Draw HVAC unit footprint" },
  custom: { icon: <PenTool size={16} strokeWidth={2} />, label: "Custom", title: "Draw custom footprint" },
  building: { icon: <Building2 size={16} strokeWidth={2} />, label: "Building", title: "Nearby building" },
};

export function ViewportToolbar({
  activeTool,
  onToolChange,
  xrayActive,
  onToggleXray,
  onResetView,
  obstacleType = "custom",
  drawing = false,
  manualPlaceActive = false,
  sunPlaying = false,
  onToggleSunPlay,
  inspectorCollapsed = false,
  onExitDesign,
  layerVisibility,
  onToggleLayer,
  onDeleteSelected,
  hasSelectedObject = false,
  natureActive = false,
  onToggleNature,
}: ViewportToolbarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Primary tools: always visible
  const primaryTools: ViewportTool[] = ["select", "move", "delete", "layers"];

  // Mode tools: visible when relevant
  const modeTools: ViewportTool[] = [];
  if (drawing || obstacleType === "custom") modeTools.push("draw-obstacle");
  if (manualPlaceActive) modeTools.push("sun"); // Sun affects panel preview shadows
  if (sunPlaying !== undefined) modeTools.push("sun");
  modeTools.push("trees");
  modeTools.push("flow");
  modeTools.push("nature");

  // View tools: always visible
  const viewTools: ViewportTool[] = ["xray"];
  if (onResetView) viewTools.push("reset-view");

  const handleToolClick = (tool: ViewportTool) => {
    if (tool === "delete" && hasSelectedObject && onDeleteSelected) {
      onDeleteSelected();
      return;
    }
    onToolChange(activeTool === tool ? null : tool);
  };

  const renderToolButton = (tool: ViewportTool, isActive: boolean) => {
    if (tool === "draw-obstacle") {
      const config = DRAW_OBSTACLE_CONFIG[obstacleType];
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${isActive ? " is-active" : ""}`}
          onClick={() => handleToolClick(tool)}
          title={config.title}
          aria-pressed={isActive}
          aria-label={config.title}
        >
          {config.icon}
          <span className="viewport-tool__label">{config.label}</span>
        </button>
      );
    }

    if (tool === "xray") {
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${xrayActive ? " is-active" : ""}`}
          onClick={onToggleXray}
          title="Toggle X-ray view (X)"
          aria-pressed={xrayActive}
          aria-label="Toggle X-ray view"
        >
          <Eye size={16} strokeWidth={2} />
          <span className="viewport-tool__label">X-ray</span>
        </button>
      );
    }

    if (tool === "reset-view") {
      return (
        <button
          key={tool}
          type="button"
          className="viewport-tool"
          onClick={onResetView}
          title="Reset camera to default (R)"
          aria-label="Reset camera to default view"
        >
          <RotateCcw size={16} strokeWidth={2} />
          <span className="viewport-tool__label">Reset view</span>
        </button>
      );
    }

    if (tool === "sun") {
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${sunPlaying ? " is-playing" : ""}${activeTool === "sun" ? " is-active" : ""}`}
          onClick={onToggleSunPlay}
          title={sunPlaying ? "Pause sun simulation" : "Play sun simulation"}
          aria-pressed={sunPlaying}
          aria-label={sunPlaying ? "Pause sun simulation" : "Play sun simulation"}
        >
          {sunPlaying ? (
            <>
              <span className="viewport-tool__icon" style={{ display: "flex" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </span>
              <span className="viewport-tool__label">Pause</span>
            </>
          ) : (
            <>
              <Sun size={16} strokeWidth={2} />
              <span className="viewport-tool__label">Play day</span>
            </>
          )}
        </button>
      );
    }

    if (tool === "flow") {
      const isFlowActive = Boolean(layerVisibility?.electricityFlow);
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${isFlowActive ? " is-active" : ""}`}
          onClick={() => {
            if (onToggleLayer) onToggleLayer("electricityFlow");
            else onToolChange(activeTool === "flow" ? null : "flow");
          }}
          title={isFlowActive ? "Disable electricity flow" : "Enable electricity flow"}
          aria-pressed={isFlowActive}
          aria-label={isFlowActive ? "Disable electricity flow" : "Enable electricity flow"}
        >
          <span className="viewport-tool__icon"><Zap size={16} strokeWidth={2} /></span>
          <span className="viewport-tool__label">Electricity Flow</span>
        </button>
      );
    }

    if (tool === "nature") {
      const isNatureOn = natureActive ?? (Boolean(layerVisibility?.birds) && Boolean(layerVisibility?.clouds));
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${isNatureOn ? " is-active" : ""}`}
          onClick={() => {
            if (onToggleNature) onToggleNature();
            else if (onToggleLayer) {
              onToggleLayer("birds");
              onToggleLayer("clouds");
            }
          }}
          title={isNatureOn ? "Disable Nature: Birds & Clouds" : "Enable Nature: Birds & Clouds"}
          aria-pressed={isNatureOn}
          aria-label={isNatureOn ? "Disable Nature" : "Enable Nature"}
        >
          <span className="viewport-tool__icon"><Bird size={16} strokeWidth={2} /></span>
          <span className="viewport-tool__label">Nature</span>
        </button>
      );
    }

    const config = TOOL_CONFIG[tool];
    return (
      <button
        key={tool}
        type="button"
        className={`viewport-tool${isActive ? " is-active" : ""}`}
        onClick={() => handleToolClick(tool)}
        title={config.title}
        aria-pressed={isActive}
        aria-label={config.title}
      >
        <span className="viewport-tool__icon">{config.icon}</span>
        <span className="viewport-tool__label">{config.label}</span>
      </button>
    );
  };

  return (
    <div
      className={`viewport-toolbar${collapsed ? " is-collapsed" : ""}`}
      role="toolbar"
      aria-label="Viewport tools"
    >
      <button
        type="button"
        className="viewport-toolbar__toggle"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand toolbar" : "Collapse toolbar"}
        aria-label={collapsed ? "Expand toolbar" : "Collapse toolbar"}
        aria-expanded={!collapsed}
        aria-controls="viewport-toolbar-track"
      >
        {collapsed ? <ChevronRight size={16} strokeWidth={2} /> : <ChevronLeft size={16} strokeWidth={2} />}
      </button>

      <div
        id="viewport-toolbar-track"
        className="viewport-toolbar__track"
        {...(collapsed ? { inert: "" } : {})}
      >
        {onExitDesign && (
          <>
            <button
              type="button"
              className="viewport-tool viewport-tool--exit"
              onClick={onExitDesign}
              title="Back to map"
              aria-label="Back to map"
            >
              <span className="viewport-tool__icon">
                <ArrowLeft size={16} strokeWidth={2} />
              </span>
              <span className="viewport-tool__label">Back to map</span>
            </button>
            <div className="viewport-toolbar__divider" aria-hidden="true" />
          </>
        )}

        <div className="viewport-toolbar__group" aria-label="Primary tools">
          {primaryTools.map((tool) => renderToolButton(tool, activeTool === tool))}
        </div>

        <div className="viewport-toolbar__divider" aria-hidden="true" />

        <div className="viewport-toolbar__group" aria-label="Mode tools">
          {modeTools.map((tool) => renderToolButton(tool, activeTool === tool))}
        </div>

        <div className="viewport-toolbar__divider" aria-hidden="true" />

        <div className="viewport-toolbar__group" aria-label="View tools">
          {viewTools.map((tool) => renderToolButton(tool, activeTool === tool))}
        </div>

        {inspectorCollapsed && (
          <button
            type="button"
            className="viewport-tool viewport-tool--inspector-toggle"
            onClick={() => onToolChange("layers")}
            title="Open inspector"
            aria-label="Open inspector panel"
          >
            <Layers size={16} strokeWidth={2} />
            <span className="viewport-tool__label">Inspector</span>
          </button>
        )}
      </div>

      {/* Layer Visibility Menu */}
      {activeTool === "layers" && layerVisibility && onToggleLayer && (
        <div className="viewport-layers-menu" role="menu" aria-label="Layer visibility">
          <div className="viewport-layers-menu__title">Layer Visibility</div>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.building}
              onChange={() => onToggleLayer("building")}
            />
            <span>Building structure</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.panels}
              onChange={() => onToggleLayer("panels")}
            />
            <span>Solar panels</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.obstacles}
              onChange={() => onToggleLayer("obstacles")}
            />
            <span>Rooftop obstacles</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.trees}
              onChange={() => onToggleLayer("trees")}
            />
            <span>Ground trees</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.ground}
              onChange={() => onToggleLayer("ground")}
            />
            <span>Satellite ground</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.electricityFlow ?? false}
              onChange={() => onToggleLayer("electricityFlow")}
            />
            <span>Electricity Flow</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={natureActive ?? (Boolean(layerVisibility.birds) && Boolean(layerVisibility.clouds))}
              onChange={() => {
                if (onToggleNature) onToggleNature();
                else if (onToggleLayer) {
                  onToggleLayer("birds");
                  onToggleLayer("clouds");
                }
              }}
            />
            <span>Nature (Birds & Clouds)</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.birds ?? false}
              onChange={() => onToggleLayer("birds")}
            />
            <span>Birds in sky</span>
          </label>
          <label className="viewport-layers-menu__item">
            <input
              type="checkbox"
              checked={layerVisibility.clouds ?? false}
              onChange={() => onToggleLayer("clouds")}
            />
            <span>Clouds in sky</span>
          </label>
        </div>
      )}
    </div>
  );
}

export default ViewportToolbar;