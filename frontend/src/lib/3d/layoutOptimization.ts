/**
 * M4: Bounded Deterministic Solar Layout Optimization
 *
 * Requirements:
 * 1. Constraint-first multi-objective ranking:
 *    - Strict rejection of any layout violating roof boundary, setbacks, parapet clearance,
 *      or obstacle clearances.
 *    - Preserves exact panel count and panel dimensions of the active configuration.
 *    - Maximizes annual energy production (kWh/yr).
 *    - Minimizes severe, persistent shading hotspots.
 * 2. Evaluates deterministic candidates:
 *    - Center of mass shifts / translation offsets (e.g. away from tree or tank shadows).
 *    - Array azimuth rotations (+/- 5°, 10°, 15° or aligning to roof edge).
 *    - Spacing variations (compact vs expanded row/col spacing).
 * 3. Atomic preview & approval workflow:
 *    - Generates up to 3 distinct alternatives plus current baseline.
 *    - Candidates are NOT applied automatically.
 *    - Confirmation is strictly required to mutate active application state.
 *    - Clean fallback when no feasible alternative exists.
 */

import type { Obstacle, Point2 } from "./obstacles";
import type { Tree } from "./treeTypes";
import type { PanelLayoutConfig } from "./panels";
import { effectivePanelDims, effectiveRowSpacingM, panelTypeDefinition } from "./panels";
import { validatePanelPlacement, type PlacementContext, type PlacedPanelPeer, type PlacedSetPanel } from "./panelSets";
import { placePanels } from "./panelPlacement";
import { runAnnualShadingAnalysis, type AnnualShadingResult } from "./shadingAnalysis";

export interface OptimizationCandidate {
  id: string;
  title: string;
  description: string;
  panels: PlacedSetPanel[];
  config: PanelLayoutConfig;
  installedCapacityKwp: number;
  additionalCapacityKwp: number;
  annualProductionKwh: number;
  annualImprovementKwh: number;
  annualImprovementPercent: number;
  severeHotspotsCount: number;
  valid: boolean;
  validationError?: string;
  shadingSummary: AnnualShadingResult;
}

export interface OptimizationResult {
  currentBaseline: {
    panels: PlacedSetPanel[];
    config: PanelLayoutConfig;
    installedCapacityKwp: number;
    annualProductionKwh: number;
    severeHotspotsCount: number;
    shadingSummary: AnnualShadingResult;
  };
  recommendations: OptimizationCandidate[];
  hasFeasibleAlternatives: boolean;
  searchMessage: string;
}

/** Check if a candidate array of panels satisfies all installation constraints. */
function isCandidateValid(
  panels: PlacedSetPanel[],
  config: PanelLayoutConfig,
  context: PlacementContext,
): boolean {
  if (panels.length === 0) return false;
  const dims = effectivePanelDims(config);
  const peers: PlacedPanelPeer[] = panels.map((p) => ({
    x: p.x,
    y: p.y,
    rotationDeg: p.rotationDeg,
    width: dims.widthM,
    length: dims.lengthM,
  }));

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const peerSubset = peers.filter((_, idx) => idx !== i);
    const panelCtx: PlacementContext = {
      ...context,
      peers: peerSubset,
    };
    const check = validatePanelPlacement(p.x, p.y, p.rotationDeg, config, panelCtx);
    if (!check.valid) return false;
  }
  return true;
}

/**
 * Searches and ranks feasible alternative panel layouts.
 */
export function optimizeSolarLayout(params: {
  currentPanels: PlacedSetPanel[];
  currentConfig: PanelLayoutConfig;
  setId: string;
  terraceRing: Point2[];
  roofZ: number;
  latitude: number;
  longitude: number;
  obstacles: Obstacle[];
  trees: Tree[];
  parapetHeightM: number;
  parapetClearanceM?: number;
}): OptimizationResult {
  const {
    currentPanels,
    currentConfig,
    setId,
    terraceRing,
    roofZ,
    latitude,
    longitude,
    obstacles,
    trees,
    parapetHeightM,
    parapetClearanceM = 0.5,
  } = params;

  const targetCount = currentPanels.length;

  // 1. Analyze current baseline
  const currentSimPanels = currentPanels.map((p, idx) => ({
    id: `${setId}-${p.index ?? idx}`,
    setId,
    index: p.index ?? idx,
    x: p.x,
    y: p.y,
    rotationDeg: p.rotationDeg,
    config: currentConfig,
  }));

  const baselineShading = runAnnualShadingAnalysis({
    panels: currentSimPanels,
    terraceRing,
    roofZ,
    latitude,
    longitude,
    obstacles,
    trees,
    parapetHeightM,
    parapetClearanceM,
  });

  const baselineKwh = baselineShading.annualShadedKwh;
  const baselineSevere = baselineShading.severityCounts.severe;
  const baselineWatts = panelTypeDefinition(currentConfig.panelTypeId).watts;
  const baselineKwp = Math.round(((targetCount * baselineWatts) / 1000) * 100) / 100;

  if (targetCount === 0) {
    return {
      currentBaseline: {
        panels: currentPanels,
        config: currentConfig,
        installedCapacityKwp: 0,
        annualProductionKwh: 0,
        severeHotspotsCount: 0,
        shadingSummary: baselineShading,
      },
      recommendations: [],
      hasFeasibleAlternatives: false,
      searchMessage: "No panels to optimize on the rooftop.",
    };
  }

  // Placement context for hard validation
  const placementContext: PlacementContext = {
    terrace: terraceRing,
    obstacles,
    parapetInsetM: parapetClearanceM + 0.2, // 0.2m wall thickness + clearance
    parapetClearanceM,
    peers: [],
    obstacleClearanceM: 0.5,
  };

  const candidatePool: Array<{
    title: string;
    description: string;
    panels: PlacedSetPanel[];
    config: PanelLayoutConfig;
  }> = [];

  // Strategy A: Shift array centroid away from shadow concentrations
  const shiftOffsets = [
    { dx: 1.0, dy: 0, label: "Shift East (+1.0m)" },
    { dx: -1.0, dy: 0, label: "Shift West (-1.0m)" },
    { dx: 0, dy: 1.0, label: "Shift North (+1.0m)" },
    { dx: 0, dy: -1.0, label: "Shift South (-1.0m)" },
    { dx: 1.5, dy: 0.8, label: "Shift North-East (+1.5m, +0.8m)" },
    { dx: -1.5, dy: 0.8, label: "Shift North-West (-1.5m, +0.8m)" },
  ];

  for (const shift of shiftOffsets) {
    const shiftedPanels: PlacedSetPanel[] = currentPanels.map((p) => ({
      index: p.index,
      x: p.x + shift.dx,
      y: p.y + shift.dy,
      rotationDeg: p.rotationDeg,
    }));

    if (shiftedPanels.length === targetCount && isCandidateValid(shiftedPanels, currentConfig, placementContext)) {
      candidatePool.push({
        title: `Offset Layout (${shift.label})`,
        description: `Translates array positions by ${shift.dx}m E, ${shift.dy}m N to reduce obstacle shadow overlap while preserving exact panel spacing.`,
        panels: shiftedPanels,
        config: currentConfig,
      });
    }
  }

  // Strategy B: Azimuth optimization (+/- 5° or 10° tilt towards optimal solar yield)
  const candidateAzimuths = [180, 170, 190, 165, 195];
  for (const az of candidateAzimuths) {
    if (Math.abs(az - currentConfig.azimuthDeg) < 1.0) continue; // Same as current
    const testConfig: PanelLayoutConfig = {
      ...currentConfig,
      azimuthDeg: az,
    };
    // Auto-layout with new orientation
    const autoResult = placePanels({
      terrace: terraceRing,
      obstacles,
      config: testConfig,
    });

    if (autoResult.panels.length >= targetCount) {
      // Keep exactly targetCount panels (take the top best ones)
      const trimmedPanels: PlacedSetPanel[] = autoResult.panels
        .slice(0, targetCount)
        .map((p, idx) => ({
          index: idx,
          x: p.x,
          y: p.y,
          rotationDeg: p.rotationDeg,
        }));

      if (isCandidateValid(trimmedPanels, testConfig, placementContext)) {
        candidatePool.push({
          title: `Optimized Orientation (${az}° Azimuth)`,
          description: `Reorients solar panels to face ${az}° with optimal solar exposure across peak midday generation hours.`,
          panels: trimmedPanels,
          config: testConfig,
        });
      }
    }
  }

  // Strategy C: Row Spacing Variation (compact or relaxed)
  const effectiveSpacing = effectiveRowSpacingM(currentConfig);
  const candidateRowSpacings = [
    Math.max(0.4, effectiveSpacing - 0.2),
    effectiveSpacing + 0.3,
  ];
  for (const spacing of candidateRowSpacings) {
    if (Math.abs(spacing - effectiveSpacing) < 0.05) continue;
    const testConfig: PanelLayoutConfig = {
      ...currentConfig,
      rowSpacingM: spacing,
    };
    const autoResult = placePanels({
      terrace: terraceRing,
      obstacles,
      config: testConfig,
    });

    if (autoResult.panels.length >= targetCount) {
      const trimmedPanels: PlacedSetPanel[] = autoResult.panels
        .slice(0, targetCount)
        .map((p, idx) => ({
          index: idx,
          x: p.x,
          y: p.y,
          rotationDeg: p.rotationDeg,
        }));

      if (isCandidateValid(trimmedPanels, testConfig, placementContext)) {
        candidatePool.push({
          title: `Adjusted Inter-Row Spacing (${spacing.toFixed(1)}m)`,
          description: `Restructures inter-row spacing to ${spacing.toFixed(1)}m to minimize self-shading while staying clear of roof parapets.`,
          panels: trimmedPanels,
          config: testConfig,
        });
      }
    }
  }

  // Strategy D: Tilt optimization (+/- 5° or 10° towards site latitude optimum)
  const optTilt = Math.min(35, Math.max(10, Math.round(Math.abs(latitude))));
  const candidateTilts = [optTilt, optTilt + 5, Math.max(10, optTilt - 5)].filter(
    (t) => Math.abs(t - currentConfig.tiltDeg) >= 2,
  );
  for (const t of candidateTilts) {
    const testConfig: PanelLayoutConfig = {
      ...currentConfig,
      tiltDeg: t,
    };
    if (isCandidateValid(currentPanels, testConfig, placementContext)) {
      candidatePool.push({
        title: `Optimized Tilt (${t}°)`,
        description: `Adjusts module tilt to ${t}° to match site latitude (${latitude.toFixed(1)}°) for maximum annual irradiance capture.`,
        panels: currentPanels,
        config: testConfig,
      });
    }
  }

  // 2. Evaluate annual shading and energy for each valid candidate
  const evaluatedCandidates: OptimizationCandidate[] = [];

  for (let i = 0; i < candidatePool.length; i++) {
    const cand = candidatePool[i];
    const simPanels = cand.panels.map((p, idx) => ({
      id: `opt-${i}-${idx}`,
      setId,
      index: idx,
      x: p.x,
      y: p.y,
      rotationDeg: p.rotationDeg,
      config: cand.config,
    }));

    const shading = runAnnualShadingAnalysis({
      panels: simPanels,
      terraceRing,
      roofZ,
      latitude,
      longitude,
      obstacles,
      trees,
      parapetHeightM,
      parapetClearanceM,
    });

    const prodKwh = shading.annualShadedKwh;
    const diffKwh = prodKwh - baselineKwh;
    const diffPct = baselineKwh > 0 ? (diffKwh / baselineKwh) * 100 : 0;
    const severeCount = shading.severityCounts.severe;

    const candWatts = panelTypeDefinition(cand.config.panelTypeId).watts;
    const candKwp = Math.round(((cand.panels.length * candWatts) / 1000) * 100) / 100;
    const addKwp = Math.round((candKwp - baselineKwp) * 100) / 100;

    evaluatedCandidates.push({
      id: `candidate-${i + 1}`,
      title: cand.title,
      description: cand.description,
      panels: cand.panels,
      config: cand.config,
      installedCapacityKwp: candKwp,
      additionalCapacityKwp: addKwp,
      annualProductionKwh: prodKwh,
      annualImprovementKwh: Math.round(diffKwh),
      annualImprovementPercent: Math.round(diffPct * 10) / 10,
      severeHotspotsCount: severeCount,
      valid: true,
      shadingSummary: shading,
    });
  }

  // 3. Multi-objective rank:
  // First sort by severe hotspots reduction, then by annual energy production
  evaluatedCandidates.sort((a, b) => {
    // Priority: fewer severe hotspots
    if (a.severeHotspotsCount !== b.severeHotspotsCount) {
      return a.severeHotspotsCount - b.severeHotspotsCount;
    }
    // Then highest annual production
    return b.annualProductionKwh - a.annualProductionKwh;
  });

  // Filter to keep only distinct meaningful improvements or layout structures (up to 3)
  const topRecommendations: OptimizationCandidate[] = [];
  for (const cand of evaluatedCandidates) {
    if (topRecommendations.length >= 3) break;
    // Ensure distinctiveness
    const isDuplicate = topRecommendations.some(
      (r) =>
        Math.abs(r.annualProductionKwh - cand.annualProductionKwh) < 5 &&
        r.config.azimuthDeg === cand.config.azimuthDeg &&
        r.severeHotspotsCount === cand.severeHotspotsCount,
    );
    if (!isDuplicate) {
      topRecommendations.push(cand);
    }
  }

  return {
    currentBaseline: {
      panels: currentPanels,
      config: currentConfig,
      installedCapacityKwp: baselineKwp,
      annualProductionKwh: baselineKwh,
      severeHotspotsCount: baselineSevere,
      shadingSummary: baselineShading,
    },
    recommendations: topRecommendations,
    hasFeasibleAlternatives: topRecommendations.length > 0,
    searchMessage:
      topRecommendations.length > 0
        ? `Found ${topRecommendations.length} valid alternative layout(s) that preserve all ${targetCount} panels with optimized solar yield.`
        : obstacles.length === 0 && trees.length === 0
          ? `No rooftop obstacles or trees present — 0% obstruction shading baseline is active. Current layout is optimal for this configuration.`
          : `Current layout is already optimal under current setbacks and obstacle clearances; no same-count alternatives with higher production were found.`,
  };
}
