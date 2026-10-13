/**
 * ObjectDetailsHUD - 3D Viewport Selected Object Inspector Card
 *
 * Displays real-world engineering details of the clicked 3D object
 * (obstacles, trees, solar modules, building terrace) when the Select
 * tool is active.
 *
 * AGENTS.md §48: Professional, minimal, engineering-oriented.
 * Displays authoritative real-world dimensions and coordinates.
 */

import { Box, Building2, TreePine, Sun, Move, MousePointer2, Pencil, Trash2, X } from "lucide-react";
import { obstacleTypeLabel, type Obstacle } from "../../lib/3d/obstacles";
import type { Tree } from "../../lib/3d/treeTypes";
import type { PanelSet } from "../../lib/3d/panelSets";
import { PANEL_TYPES, effectivePanelDims, type InstallationType } from "../../lib/3d/panels";
import { formatArea, type PolygonMetrics } from "../../lib/geo";
import type { ViewportTool } from "./ViewportToolbar";

export interface ObjectDetailsHUDProps {
  activeTool: ViewportTool | null;
  onToolChange: (tool: ViewportTool) => void;
  selectedObstacle: Obstacle | null;
  selectedTree: Tree | null;
  selectedPanelInfo: { setId: string; panelIndex: number; panelId: string } | null;
  panelSets: PanelSet[];
  selectedBuilding: boolean;
  buildingHeightM: number;
  parapetHeightM: number;
  metrics: PolygonMetrics | null;
  installationType: InstallationType;
  onEditObstacle?: (obstacle: Obstacle) => void;
  onDeleteObstacle?: (id: string) => void;
  onEditTree?: (tree: Tree) => void;
  onDeleteTree?: (id: string) => void;
  onClose: () => void;
}

function compassDirection(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return "N";
  if (norm >= 22.5 && norm < 67.5) return "NE";
  if (norm >= 67.5 && norm < 112.5) return "E";
  if (norm >= 112.5 && norm < 157.5) return "SE";
  if (norm >= 157.5 && norm < 202.5) return "S";
  if (norm >= 202.5 && norm < 247.5) return "SW";
  if (norm >= 247.5 && norm < 292.5) return "W";
  return "NW";
}

export function ObjectDetailsHUD({
  activeTool,
  onToolChange,
  selectedObstacle,
  selectedTree,
  selectedPanelInfo,
  panelSets,
  selectedBuilding,
  buildingHeightM,
  parapetHeightM,
  metrics,
  installationType,
  onEditObstacle,
  onDeleteObstacle,
  onEditTree,
  onDeleteTree,
  onClose,
}: ObjectDetailsHUDProps) {
  // If no object is currently selected, render nothing
  if (!selectedObstacle && !selectedTree && !selectedPanelInfo && !selectedBuilding) {
    return null;
  }

  const isMoveActive = activeTool === "move";

  return (
    <div
      className="object-details-hud"
      role="region"
      aria-label="Selected 3D object details"
    >
      {/* 1. OBSTACLE DETAILS */}
      {selectedObstacle && (
        <>
          <div className="object-details-hud__header">
            <div className="object-details-hud__title-group">
              <span className="object-details-hud__icon" aria-hidden="true">
                {selectedObstacle.type === "building" ? <Building2 size={16} /> : <Box size={16} />}
              </span>
              <div>
                <h4 className="object-details-hud__title">
                  {obstacleTypeLabel(selectedObstacle.type)}
                </h4>
                <p className="object-details-hud__subtitle">
                  {selectedObstacle.type === "building" ? "Nearby building structure" : "Rooftop obstacle"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="object-details-hud__close"
              onClick={onClose}
              title="Close details"
              aria-label="Close details"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div className="object-details-hud__badge-row">
            {isMoveActive ? (
              <span className="object-details-hud__badge object-details-hud__badge--move">
                <Move size={11} aria-hidden="true" /> Move Tool Active · Drag to move
              </span>
            ) : (
              <span className="object-details-hud__badge object-details-hud__badge--select">
                <MousePointer2 size={11} aria-hidden="true" /> Select Mode · Moving locked
              </span>
            )}
          </div>

          <dl className="object-details-hud__grid">
            <div>
              <dt>Width × Length</dt>
              <dd>{selectedObstacle.width.toFixed(2)} m × {selectedObstacle.length.toFixed(2)} m</dd>
            </div>
            <div>
              <dt>Height</dt>
              <dd>{selectedObstacle.height.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>Footprint Area</dt>
              <dd>{(selectedObstacle.width * selectedObstacle.length).toFixed(1)} m²</dd>
            </div>
            <div>
              <dt>Rotation</dt>
              <dd>{selectedObstacle.rotation}°</dd>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <dt>Position (Local)</dt>
              <dd>E {selectedObstacle.position.x.toFixed(1)} m, N {selectedObstacle.position.y.toFixed(1)} m</dd>
            </div>
          </dl>

          <div className="object-details-hud__actions">
            <button
              type="button"
              className={`btn btn--subtle${isMoveActive ? " is-active" : ""}`}
              onClick={() => onToolChange(isMoveActive ? "select" : "move")}
              title={isMoveActive ? "Switch to select mode" : "Switch to move tool to drag this object"}
            >
              <Move size={13} strokeWidth={2} aria-hidden="true" />
              {isMoveActive ? "Moving Active" : "Move Object"}
            </button>
            {onEditObstacle && (
              <button
                type="button"
                className="btn btn--subtle"
                onClick={() => onEditObstacle(selectedObstacle)}
                title="Edit obstacle dimensions"
              >
                <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                Edit
              </button>
            )}
            {onDeleteObstacle && (
              <button
                type="button"
                className="btn btn--subtle-danger"
                onClick={() => onDeleteObstacle(selectedObstacle.id)}
                title="Delete this obstacle"
              >
                <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {/* 2. GROUND TREE DETAILS */}
      {selectedTree && (
        <>
          <div className="object-details-hud__header">
            <div className="object-details-hud__title-group">
              <span className="object-details-hud__icon" aria-hidden="true">
                <TreePine size={16} />
              </span>
              <div>
                <h4 className="object-details-hud__title">
                  {selectedTree.type.charAt(0).toUpperCase() + selectedTree.type.slice(1)} Tree
                </h4>
                <p className="object-details-hud__subtitle">Ground vegetation obstacle</p>
              </div>
            </div>
            <button
              type="button"
              className="object-details-hud__close"
              onClick={onClose}
              title="Close details"
              aria-label="Close details"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div className="object-details-hud__badge-row">
            {isMoveActive ? (
              <span className="object-details-hud__badge object-details-hud__badge--move">
                <Move size={11} aria-hidden="true" /> Move Tool Active · Drag to move
              </span>
            ) : (
              <span className="object-details-hud__badge object-details-hud__badge--select">
                <MousePointer2 size={11} aria-hidden="true" /> Select Mode · Moving locked
              </span>
            )}
          </div>

          <dl className="object-details-hud__grid">
            <div>
              <dt>Tree Height</dt>
              <dd>{selectedTree.height.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>Canopy Width</dt>
              <dd>{selectedTree.canopyWidth.toFixed(1)} m</dd>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <dt>Ground Position</dt>
              <dd>E {selectedTree.position.x.toFixed(1)} m, N {selectedTree.position.y.toFixed(1)} m</dd>
            </div>
          </dl>

          <div className="object-details-hud__actions">
            <button
              type="button"
              className={`btn btn--subtle${isMoveActive ? " is-active" : ""}`}
              onClick={() => onToolChange(isMoveActive ? "select" : "move")}
              title={isMoveActive ? "Switch to select mode" : "Switch to move tool to drag this tree"}
            >
              <Move size={13} strokeWidth={2} aria-hidden="true" />
              {isMoveActive ? "Moving Active" : "Move Tree"}
            </button>
            {onEditTree && (
              <button
                type="button"
                className="btn btn--subtle"
                onClick={() => onEditTree(selectedTree)}
                title="Edit tree dimensions"
              >
                <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                Edit
              </button>
            )}
            {onDeleteTree && (
              <button
                type="button"
                className="btn btn--subtle-danger"
                onClick={() => onDeleteTree(selectedTree.id)}
                title="Delete this tree"
              >
                <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {/* 3. SOLAR PANEL / PANEL SET DETAILS */}
      {selectedPanelInfo && (() => {
        const set = panelSets.find((s) => s.id === selectedPanelInfo.setId) ?? panelSets[0];
        const panel = set?.panels[selectedPanelInfo.panelIndex];
        const typeDef = PANEL_TYPES.find((p) => p.id === set?.config.panelTypeId) ?? PANEL_TYPES[1];
        const dims = set ? effectivePanelDims(set.config) : { widthM: typeDef.widthM, lengthM: typeDef.lengthM };
        const watts = typeDef.watts ?? 550;
        const totalKw = set ? (set.panels.length * watts) / 1000 : 0;

        return (
          <>
            <div className="object-details-hud__header">
              <div className="object-details-hud__title-group">
                <span className="object-details-hud__icon" aria-hidden="true">
                  <Sun size={16} />
                </span>
                <div>
                  <h4 className="object-details-hud__title">
                    {set?.name ?? "Panel Set"} · Module #{selectedPanelInfo.panelIndex + 1}
                  </h4>
                  <p className="object-details-hud__subtitle">Photovoltaic solar module</p>
                </div>
              </div>
              <button
                type="button"
                className="object-details-hud__close"
                onClick={onClose}
                title="Close details"
                aria-label="Close details"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>

            <div className="object-details-hud__badge-row">
              <span className="object-details-hud__badge object-details-hud__badge--select">
                <MousePointer2 size={11} aria-hidden="true" /> Select Mode · Module Inspected
              </span>
            </div>

            <dl className="object-details-hud__grid">
              <div>
                <dt>Module Model</dt>
                <dd>{typeDef.label}</dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd>{dims.widthM.toFixed(2)} m × {dims.lengthM.toFixed(2)} m</dd>
              </div>
              <div>
                <dt>Tilt Angle</dt>
                <dd>{set?.config.tiltDeg ?? 25}°</dd>
              </div>
              <div>
                <dt>Azimuth</dt>
                <dd>{set?.config.azimuthDeg ?? 180}° ({compassDirection(set?.config.azimuthDeg ?? 180)})</dd>
              </div>
              <div>
                <dt>Mounting</dt>
                <dd style={{ textTransform: "capitalize" }}>
                  {set?.config.mounting.replace("ground_", "").replace("_", " ") ?? "Tilted"}
                </dd>
              </div>
              <div>
                <dt>Array Total</dt>
                <dd>{set?.panels.length ?? 0} modules ({totalKw.toFixed(2)} kWp)</dd>
              </div>
              {panel && (
                <div style={{ gridColumn: "span 2" }}>
                  <dt>Position (Local)</dt>
                  <dd>E {panel.x.toFixed(2)} m, N {panel.y.toFixed(2)} m</dd>
                </div>
              )}
            </dl>
          </>
        );
      })()}

      {/* 4. BUILDING / SITE DETAILS */}
      {selectedBuilding && (
        <>
          <div className="object-details-hud__header">
            <div className="object-details-hud__title-group">
              <span className="object-details-hud__icon" aria-hidden="true">
                <Building2 size={16} />
              </span>
              <div>
                <h4 className="object-details-hud__title">
                  {installationType === "ground" ? "Usable Land Area" : "Building Rooftop"}
                </h4>
                <p className="object-details-hud__subtitle">Primary installation surface</p>
              </div>
            </div>
            <button
              type="button"
              className="object-details-hud__close"
              onClick={onClose}
              title="Close details"
              aria-label="Close details"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          <div className="object-details-hud__badge-row">
            <span className="object-details-hud__badge object-details-hud__badge--select">
              <MousePointer2 size={11} aria-hidden="true" /> Select Mode · Site Inspected
            </span>
          </div>

          <dl className="object-details-hud__grid">
            {installationType !== "ground" && (
              <div>
                <dt>Building Height</dt>
                <dd>{buildingHeightM.toFixed(1)} m</dd>
              </div>
            )}
            <div>
              <dt>Usable Area</dt>
              <dd>{formatArea(metrics?.areaM2 ?? 0)}</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{(metrics?.perimeterM ?? 0).toFixed(1)} m</dd>
            </div>
            {installationType !== "ground" && (
              <div>
                <dt>Parapet Height</dt>
                <dd>{parapetHeightM.toFixed(1)} m</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}

export default ObjectDetailsHUD;
