/**
 * Cable Specification Advisor
 *
 * Provides preliminary engineering recommendations for electrical cable sizing across:
 * 1. DC String Circuits: PV module series strings to String Combiner / Junction Boxes.
 * 2. DC Main Array Circuits: Combiner / Array Junction Boxes to Central / String Inverter.
 * 3. Inverter AC Output Circuits: Rooftop Inverter AC terminals to Main LT Distribution Board.
 *
 * Calculations follow established solar PV standards:
 * - IS 732: Code of practice for electrical wiring installations.
 * - IS/IEC 60364-7-712: Requirements for special installations or locations - Solar PV power supply systems.
 * - IS 17293 / EN 50618: Electric cables for photovoltaic systems (1.5 kV DC solar cables).
 * - CEA (Technical Standards for Connectivity of Distributed Generation Resources) Regulations.
 *
 * DISCLAIMER:
 * Preliminary planning aid only. Not an electrical compliance or safety certification.
 * Final cable sizing, protective device ratings (fuses, MCBs, SPDs), and containment must
 * be verified by a licensed electrical engineer against site conditions and local DISCOM norms.
 */

import type { PanelFlowData, ElectricalTopology } from "./electricityFlow";
import { panelTypeDefinition, type PanelLayoutConfig } from "./panels";

export type ConductorMaterial = "copper" | "aluminum";

export interface CableStandardSize {
  sizeMm2: number;
  /** Nominal continuous current rating in air (30°C) per IS/IEC tables, Amperes */
  ampacityAirA: number;
  /** Nominal continuous current rating in conduit / enclosed tray (30°C), Amperes */
  ampacityConduitA: number;
}

/** Standard metric cross-sectional conductor sizes (IS 8130 / IEC 60228), mm² */
export const STANDARD_CABLE_SIZES_MM2: readonly number[] = [
  1.5, 2.5, 4.0, 6.0, 10.0, 16.0, 25.0, 35.0, 50.0, 70.0, 95.0, 120.0, 150.0, 185.0, 240.0,
];

/** Minimum recommended size for dedicated PV DC string cable (standard practice in IS/IEC) */
export const MIN_PV_DC_CABLE_SIZE_MM2 = 4.0;

/** Minimum recommended size for building wiring with aluminum conductor (IS 732) */
export const MIN_ALUMINUM_CABLE_SIZE_MM2 = 10.0;

/**
 * Conductor resistivity table at standard elevated operating temperature (75°C),
 * accounting for continuous rooftop solar heating (Ω·mm²/m).
 * Cu @ 20°C = 0.0175, @ 75°C = 0.0213
 * Al @ 20°C = 0.0282, @ 75°C = 0.0345
 */
export const CONDUCTOR_RESISTIVITY: Record<ConductorMaterial, number> = {
  copper: 0.0213,
  aluminum: 0.0345,
};

/**
 * Base ampacity table for single-core / multi-core XLPO/XLPE cables at 30°C ambient.
 * (Based on IEC 60364-5-52 Table B.52.12 / EN 50618 for Cu, IS 7098 for Al).
 */
export const BASE_AMPACITY_TABLE: Record<
  ConductorMaterial,
  Record<number, { airA: number; conduitA: number }>
> = {
  copper: {
    1.5: { airA: 24, conduitA: 18 },
    2.5: { airA: 33, conduitA: 24 },
    4.0: { airA: 45, conduitA: 33 },
    6.0: { airA: 58, conduitA: 42 },
    10.0: { airA: 80, conduitA: 58 },
    16.0: { airA: 107, conduitA: 78 },
    25.0: { airA: 138, conduitA: 102 },
    35.0: { airA: 171, conduitA: 126 },
    50.0: { airA: 209, conduitA: 154 },
    70.0: { airA: 269, conduitA: 198 },
    95.0: { airA: 328, conduitA: 241 },
    120.0: { airA: 382, conduitA: 280 },
    150.0: { airA: 441, conduitA: 324 },
    185.0: { airA: 506, conduitA: 371 },
    240.0: { airA: 599, conduitA: 439 },
  },
  aluminum: {
    1.5: { airA: 18, conduitA: 14 },
    2.5: { airA: 25, conduitA: 19 },
    4.0: { airA: 35, conduitA: 26 },
    6.0: { airA: 45, conduitA: 33 },
    10.0: { airA: 62, conduitA: 45 },
    16.0: { airA: 84, conduitA: 61 },
    25.0: { airA: 108, conduitA: 80 },
    35.0: { airA: 133, conduitA: 98 },
    50.0: { airA: 163, conduitA: 120 },
    70.0: { airA: 210, conduitA: 154 },
    95.0: { airA: 256, conduitA: 188 },
    120.0: { airA: 298, conduitA: 218 },
    150.0: { airA: 344, conduitA: 253 },
    185.0: { airA: 395, conduitA: 289 },
    240.0: { airA: 467, conduitA: 342 },
  },
};

export interface CircuitCableRecommendation {
  circuitId: string;
  circuitName: string;
  circuitType: "dc-string" | "dc-main" | "ac-output";
  endpoints: {
    from: string;
    to: string;
  };
  recommendedSizeMm2: number;
  conductorMaterial: ConductorMaterial;
  insulationType: string;
  standardReference: string;

  // Electrical operating & design parameters
  nominalVoltageV: number;
  voltageType: "DC" | "AC 1-Phase (230V)" | "AC 3-Phase (415V)";
  operatingCurrentA: number;
  designCurrentA: number;

  // Length & voltage drop
  estimatedLengthM: number;
  voltageDropV: number;
  voltageDropPercent: number;
  maxAllowableDropPercent: number;

  // Capacity & derating
  baseAmpacityA: number;
  deratedAmpacityA: number;
  deratingFactor: number;

  // Status & limitations
  isProvisional: boolean;
  assumptions: string[];
  missingInputs?: string[];
}

export interface CableSpecificationReport {
  timestamp: string;
  totalSystemKw: number;
  totalPanels: number;
  totalStrings: number;
  panelsPerStringTypical: number;
  inverterCapacityKw: number;
  circuits: CircuitCableRecommendation[];
  disclaimer: string;
}

export interface CableAdvisorOptions {
  maxDcStringDropPercent?: number; // default: 1.5%
  maxDcMainDropPercent?: number;   // default: 1.5%
  maxAcDropPercent?: number;       // default: 2.0%
  rooftopAmbientTempC?: number;    // default: 45°C
  inConduit?: boolean;             // default: true (cables routed in tray / UV conduit)
}

/**
 * Calculates ambient temperature derating factor for 90°C rated cables.
 * Rating basis is 30°C; Indian rooftop ambient commonly reaches 45°C - 50°C.
 */
export function calculateTempDerating(ambientC = 45, maxConductorTempC = 90): number {
  if (ambientC <= 30) return 1.0;
  if (ambientC >= maxConductorTempC) return 0.2;
  return Math.sqrt((maxConductorTempC - ambientC) / (maxConductorTempC - 30));
}

/**
 * Calculates voltage drop across a two-conductor DC / Single-Phase AC circuit.
 * Delta V = (2 * L * I * rho) / A
 */
export function calculateDcVoltageDrop(
  lengthM: number,
  currentA: number,
  sizeMm2: number,
  material: ConductorMaterial = "copper",
): { dropV: number; requiredAreaForDrop: (maxDropV: number) => number } {
  const rho = CONDUCTOR_RESISTIVITY[material];
  const dropV = (2 * lengthM * currentA * rho) / Math.max(0.1, sizeMm2);
  const requiredAreaForDrop = (maxDropV: number) => (2 * lengthM * currentA * rho) / Math.max(0.01, maxDropV);
  return { dropV, requiredAreaForDrop };
}

/**
 * Calculates voltage drop across a 3-Phase balanced AC circuit (line-to-line).
 * Delta V_LL = (sqrt(3) * L * I * rho) / A
 */
export function calculateThreePhaseAcVoltageDrop(
  lengthM: number,
  currentA: number,
  sizeMm2: number,
  material: ConductorMaterial = "copper",
): { dropV: number; requiredAreaForDrop: (maxDropV: number) => number } {
  const rho = CONDUCTOR_RESISTIVITY[material];
  const dropV = (Math.sqrt(3) * lengthM * currentA * rho) / Math.max(0.1, sizeMm2);
  const requiredAreaForDrop = (maxDropV: number) => (Math.sqrt(3) * lengthM * currentA * rho) / Math.max(0.01, maxDropV);
  return { dropV, requiredAreaForDrop };
}

/**
 * Selects the smallest standard cable size meeting code minimum, ampacity, and voltage drop requirements.
 */
export function selectStandardConductorSize(params: {
  material: ConductorMaterial;
  designCurrentA: number;
  operatingCurrentA: number;
  lengthM: number;
  nominalVoltageV: number;
  maxDropPercent: number;
  isThreePhaseAc?: boolean;
  minCodeSizeMm2?: number;
  inConduit?: boolean;
  ambientTempC?: number;
}): {
  sizeMm2: number;
  voltageDropV: number;
  voltageDropPercent: number;
  baseAmpacityA: number;
  deratedAmpacityA: number;
  deratingFactor: number;
} {
  const {
    material,
    designCurrentA,
    operatingCurrentA,
    lengthM,
    nominalVoltageV,
    maxDropPercent,
    isThreePhaseAc = false,
    minCodeSizeMm2 = 1.5,
    inConduit = true,
    ambientTempC = 45,
  } = params;

  // Derating: ambient temperature factor * grouping/tray factor (0.80)
  const tempFactor = calculateTempDerating(ambientTempC, 90);
  const groupingFactor = 0.80;
  const deratingFactor = Number((tempFactor * groupingFactor).toFixed(3));

  const maxDropV = nominalVoltageV * (maxDropPercent / 100);
  const vdropCalc = isThreePhaseAc
    ? calculateThreePhaseAcVoltageDrop(lengthM, operatingCurrentA, 1.0, material)
    : calculateDcVoltageDrop(lengthM, operatingCurrentA, 1.0, material);

  const minAreaForDrop = vdropCalc.requiredAreaForDrop(maxDropV);
  const table = BASE_AMPACITY_TABLE[material];

  let selectedSize = STANDARD_CABLE_SIZES_MM2[STANDARD_CABLE_SIZES_MM2.length - 1];
  let baseAmp = 0;
  let deratedAmp = 0;

  for (const size of STANDARD_CABLE_SIZES_MM2) {
    if (size < minCodeSizeMm2) continue;
    if (size < minAreaForDrop) continue;

    const entry = table[size] ?? { airA: size * 4, conduitA: size * 3 };
    const base = inConduit ? entry.conduitA : entry.airA;
    const derated = base * deratingFactor;

    if (derated >= designCurrentA) {
      selectedSize = size;
      baseAmp = base;
      deratedAmp = derated;
      break;
    }
  }

  // Calculate final actual drop with selected size
  const finalDrop = isThreePhaseAc
    ? calculateThreePhaseAcVoltageDrop(lengthM, operatingCurrentA, selectedSize, material)
    : calculateDcVoltageDrop(lengthM, operatingCurrentA, selectedSize, material);

  const dropPercent = (finalDrop.dropV / nominalVoltageV) * 100;

  return {
    sizeMm2: selectedSize,
    voltageDropV: Number(finalDrop.dropV.toFixed(2)),
    voltageDropPercent: Number(dropPercent.toFixed(2)),
    baseAmpacityA: baseAmp,
    deratedAmpacityA: Number(deratedAmp.toFixed(1)),
    deratingFactor,
  };
}

/**
 * Computes preliminary cable specifications for the modeled solar PV installation.
 */
export function computeCableRecommendations(params: {
  panelLayers: PanelFlowData[];
  topology: ElectricalTopology;
  buildingHeightM?: number | null;
  options?: CableAdvisorOptions;
}): CableSpecificationReport {
  const { panelLayers, topology, buildingHeightM = null, options = {} } = params;

  const {
    maxDcStringDropPercent = 1.5,
    maxDcMainDropPercent = 1.5,
    maxAcDropPercent = 2.0,
    rooftopAmbientTempC = 45,
    inConduit = true,
  } = options;

  // 1. Gather all placed panels and representative config
  const totalPanels = panelLayers.reduce((sum, l) => sum + l.panels.length, 0);
  const primaryConfig: PanelLayoutConfig =
    panelLayers[0]?.config ?? {
      panelTypeId: "panel-550w",
      mounting: "flat",
      tiltDeg: 15,
      azimuthDeg: 180,
      spacingM: 0.2,
      rowSpacingM: null,
      colSpacingM: null,
      setbackM: 0.2,
      mountHeightM: 0.4,
      orientation: "portrait",
      customWidthM: null,
      customLengthM: null,
      legRows: 2,
      legCols: 2,
      setRows: 2,
      setCols: 5,
    };

  const panelDef = panelTypeDefinition(primaryConfig.panelTypeId);
  const panelWatts = panelDef.watts;

  // Genuine electrical specifications or conservative standard model
  const hasGenuineSpecs =
    panelDef.vmpV != null && panelDef.impA != null && panelDef.vocV != null && panelDef.iscA != null;

  const vmpV = panelDef.vmpV ?? 42.0;
  const impA = panelDef.impA ?? Number((panelWatts / vmpV).toFixed(2));
  const vocV = panelDef.vocV ?? Number((vmpV * 1.20).toFixed(2));
  const iscA = panelDef.iscA ?? Number((impA * 1.07).toFixed(2));

  const totalSystemKw = Number(((totalPanels * panelWatts) / 1000).toFixed(2));
  const inverterCapacityKw = Math.max(1, Math.ceil(totalSystemKw));

  // Topology details
  const strings = topology.strings;
  const totalStrings = strings.length > 0 ? strings.length : (totalPanels > 0 ? Math.ceil(totalPanels / 10) : 1);
  const typicalStringPanels =
    strings.length > 0
      ? Math.round(strings.reduce((s, str) => s + str.panelIndices.length, 0) / strings.length)
      : Math.min(10, Math.max(1, totalPanels));

  const circuits: CircuitCableRecommendation[] = [];

  // =========================================================================
  // Circuit 1: DC String Cable (Panel String to String Combiner / Junction Box)
  // =========================================================================
  const stringVoltageV = Number((typicalStringPanels * vmpV).toFixed(1));
  const stringVocV = Number((typicalStringPanels * vocV).toFixed(1));
  const stringOperatingCurrentA = impA;
  const stringDesignCurrentA = Number((1.25 * iscA).toFixed(2)); // 1.25 * Isc safety margin

  // Route length from topology branch route or provisional default
  const stringBranchRoutes = topology.routes.filter((r) => r.type === "string-branch");
  const longestBranchRoute = stringBranchRoutes.reduce(
    (max, r) => Math.max(max, r.totalLength),
    0,
  );

  const hasModeledBranchRoutes = longestBranchRoute > 0;
  const stringLengthM = hasModeledBranchRoutes
    ? Number((longestBranchRoute + 1.5).toFixed(1)) // +1.5m for junction terminations & drip loop
    : 16.0;

  const stringSizing = selectStandardConductorSize({
    material: "copper",
    designCurrentA: stringDesignCurrentA,
    operatingCurrentA: stringOperatingCurrentA,
    lengthM: stringLengthM,
    nominalVoltageV: Math.max(50, stringVoltageV),
    maxDropPercent: maxDcStringDropPercent,
    minCodeSizeMm2: MIN_PV_DC_CABLE_SIZE_MM2, // 4.0 mm² minimum for solar PV DC strings
    inConduit,
    ambientTempC: rooftopAmbientTempC,
  });

  const stringMissing: string[] = [];
  if (!hasGenuineSpecs) {
    stringMissing.push("Manufacturer panel STC datasheet (Vmp/Imp/Voc/Isc estimated from nominal wattage).");
  }
  if (!hasModeledBranchRoutes) {
    stringMissing.push("String cable route not yet placed; using 16.0 m provisional rooftop run.");
  }

  circuits.push({
    circuitId: "dc-string",
    circuitName: "DC String Cable (Modules to Combiner)",
    circuitType: "dc-string",
    endpoints: {
      from: `PV String (${typicalStringPanels} modules in series)`,
      to: "String Combiner Box / DC Junction Box",
    },
    recommendedSizeMm2: stringSizing.sizeMm2,
    conductorMaterial: "copper",
    insulationType: "Cross-Linked Polyolefin (XLPO) double-insulated, 1.5 kV DC, UV-resistant, halogen-free",
    standardReference: "IS 17293 / EN 50618",
    nominalVoltageV: stringVoltageV,
    voltageType: "DC",
    operatingCurrentA: stringOperatingCurrentA,
    designCurrentA: stringDesignCurrentA,
    estimatedLengthM: stringLengthM,
    voltageDropV: stringSizing.voltageDropV,
    voltageDropPercent: stringSizing.voltageDropPercent,
    maxAllowableDropPercent: maxDcStringDropPercent,
    baseAmpacityA: stringSizing.baseAmpacityA,
    deratedAmpacityA: stringSizing.deratedAmpacityA,
    deratingFactor: stringSizing.deratingFactor,
    isProvisional: stringMissing.length > 0,
    assumptions: [
      `Tinned flexible stranded copper conductor (Class 5).`,
      `Design current rated at 1.25 × Isc (${stringDesignCurrentA} A) per IS/IEC 60364-7-712.`,
      `Open-circuit string voltage: ${stringVocV} V DC.`,
      `Derating applies ${rooftopAmbientTempC}°C ambient summer rooftop temperature.`,
    ],
    missingInputs: stringMissing.length > 0 ? stringMissing : undefined,
  });

  // =========================================================================
  // Circuit 2: DC Array Main Trunk (Combiner Box to Central/String Inverter)
  // =========================================================================
  const mainArrayOperatingCurrentA = Number((totalStrings * impA).toFixed(2));
  const mainArrayDesignCurrentA = Number((totalStrings * 1.25 * iscA).toFixed(2));
  const mainArrayVoltageV = stringVoltageV;

  const combinerRoutes = topology.routes.filter((r) => r.type === "combiner-trunk");
  const mainDcRoutes = topology.routes.filter((r) => r.type === "main-dc");

  const longestCombinerRoute = combinerRoutes.reduce((max, r) => Math.max(max, r.totalLength), 0);
  const mainDcRouteLength = mainDcRoutes.reduce((max, r) => Math.max(max, r.totalLength), 0);
  const totalMainDcRun = longestCombinerRoute + mainDcRouteLength;

  const hasModeledTrunk = totalMainDcRun > 0;
  const mainDcLengthM = hasModeledTrunk
    ? Number((totalMainDcRun + 2.0).toFixed(1))
    : 22.0;

  // For small arrays (1 string), trunk is simply the string homerun. For multi-string, main bus.
  const trunkSizing = selectStandardConductorSize({
    material: "copper",
    designCurrentA: mainArrayDesignCurrentA,
    operatingCurrentA: mainArrayOperatingCurrentA,
    lengthM: mainDcLengthM,
    nominalVoltageV: Math.max(50, mainArrayVoltageV),
    maxDropPercent: maxDcMainDropPercent,
    minCodeSizeMm2: MIN_PV_DC_CABLE_SIZE_MM2,
    inConduit,
    ambientTempC: rooftopAmbientTempC,
  });

  const mainMissing: string[] = [];
  if (!hasModeledTrunk) {
    mainMissing.push("DC collection trunk route not yet placed; using 22.0 m provisional run.");
  }

  circuits.push({
    circuitId: "dc-main",
    circuitName: "DC Main Trunk (Combiner to Inverter)",
    circuitType: "dc-main",
    endpoints: {
      from: totalStrings > 1 ? "Array Combiner Box / DC Bus" : "String DC Junction Box",
      to: "Inverter DC Terminals",
    },
    recommendedSizeMm2: trunkSizing.sizeMm2,
    conductorMaterial: "copper",
    insulationType: "Heavy-duty XLPO/XLPE armored solar DC cable, 1.5 kV DC rating",
    standardReference: "IS 17293 / IS 7098",
    nominalVoltageV: mainArrayVoltageV,
    voltageType: "DC",
    operatingCurrentA: mainArrayOperatingCurrentA,
    designCurrentA: mainArrayDesignCurrentA,
    estimatedLengthM: mainDcLengthM,
    voltageDropV: trunkSizing.voltageDropV,
    voltageDropPercent: trunkSizing.voltageDropPercent,
    maxAllowableDropPercent: maxDcMainDropPercent,
    baseAmpacityA: trunkSizing.baseAmpacityA,
    deratedAmpacityA: trunkSizing.deratedAmpacityA,
    deratingFactor: trunkSizing.deratingFactor,
    isProvisional: mainMissing.length > 0,
    assumptions: [
      `Carries parallel combined current of ${totalStrings} string${totalStrings === 1 ? "" : "s"}.`,
      `Design current rated at ${totalStrings} × 1.25 × Isc (${mainArrayDesignCurrentA} A).`,
      `Max cumulative DC voltage drop (string + trunk) targeted ≤ 3.0%.`,
    ],
    missingInputs: mainMissing.length > 0 ? mainMissing : undefined,
  });

  // =========================================================================
  // Circuit 3: Inverter AC Output Cable (Inverter to Main LT Switchboard)
  // =========================================================================
  // Indian practice: <= 5 kW is 1-phase 230V, > 5 kW is 3-phase 415V
  const isThreePhase = totalSystemKw > 5.0;
  const acVoltageV = isThreePhase ? 415 : 230;
  const acVoltageType = isThreePhase ? "AC 3-Phase (415V)" : "AC 1-Phase (230V)";

  const acOperatingCurrentA = isThreePhase
    ? Number(((totalSystemKw * 1000) / (Math.sqrt(3) * 415 * 1.0)).toFixed(2))
    : Number(((totalSystemKw * 1000) / (230 * 1.0)).toFixed(2));

  const acDesignCurrentA = Number((1.25 * acOperatingCurrentA).toFixed(2));

  // The 3D model routes to the rooftop inverter. Vertical drop to ground-floor LT panel is not in roof mesh:
  const heightM = buildingHeightM != null && buildingHeightM > 0 ? buildingHeightM : 12.0;
  const acEstimatedLengthM = Number((heightM + 15.0).toFixed(1)); // Vertical riser + 15m horizontal to LT panel

  // Multi-core copper for <= 15 kW, armored aluminum commonly used in India > 15 kW
  const acMaterial: ConductorMaterial = totalSystemKw > 15.0 ? "aluminum" : "copper";
  const minAcCodeSize = acMaterial === "aluminum" ? MIN_ALUMINUM_CABLE_SIZE_MM2 : 2.5;

  const acSizing = selectStandardConductorSize({
    material: acMaterial,
    designCurrentA: Math.max(1, acDesignCurrentA),
    operatingCurrentA: Math.max(0.5, acOperatingCurrentA),
    lengthM: acEstimatedLengthM,
    nominalVoltageV: acVoltageV,
    maxDropPercent: maxAcDropPercent,
    isThreePhaseAc: isThreePhase,
    minCodeSizeMm2: minAcCodeSize,
    inConduit,
    ambientTempC: 40,
  });

  circuits.push({
    circuitId: "ac-output",
    circuitName: "Inverter AC Output Cable",
    circuitType: "ac-output",
    endpoints: {
      from: `Inverter AC Terminals (${inverterCapacityKw} kW)`,
      to: "Main LT Switchboard / Net Meter",
    },
    recommendedSizeMm2: acSizing.sizeMm2,
    conductorMaterial: acMaterial,
    insulationType:
      acMaterial === "aluminum"
        ? "1.1 kV XLPE insulated, PVC inner sheath, galvanized steel wire/strip armored (AYFY/A2XFY)"
        : "1.1 kV Multi-core Copper XLPE/PVC armored or flexible Cu in conduit (YFY/2XFY)",
    standardReference: "IS 7098 (Part 1) / IS 1554 / IS 732",
    nominalVoltageV: acVoltageV,
    voltageType: acVoltageType,
    operatingCurrentA: acOperatingCurrentA,
    designCurrentA: acDesignCurrentA,
    estimatedLengthM: acEstimatedLengthM,
    voltageDropV: acSizing.voltageDropV,
    voltageDropPercent: acSizing.voltageDropPercent,
    maxAllowableDropPercent: maxAcDropPercent,
    baseAmpacityA: acSizing.baseAmpacityA,
    deratedAmpacityA: acSizing.deratedAmpacityA,
    deratingFactor: acSizing.deratingFactor,
    isProvisional: true,
    assumptions: [
      `System configuration: ${isThreePhase ? "415V 3-Phase 4-Wire (R-Y-B-N) + PE" : "230V 1-Phase (Phase + Neutral + PE)"}, 50 Hz.`,
      `Design current accounts for 1.25 safety factor for continuous duty (${acDesignCurrentA} A).`,
      `Unity power factor (cos φ = 1.0) assumed at nominal inverter output.`,
    ],
    missingInputs: [
      `Building vertical riser and LT distribution board run are not modeled in 3D geometry.`,
      `Provisional length based on building height (${heightM.toFixed(1)} m) + 15 m horizontal run. Exact length must be measured on-site.`,
    ],
  });

  return {
    timestamp: new Date().toISOString(),
    totalSystemKw,
    totalPanels,
    totalStrings,
    panelsPerStringTypical: typicalStringPanels,
    inverterCapacityKw,
    circuits,
    disclaimer: "",
  };
}
