import { describe, expect, it } from "vitest";
import {
  BASE_AMPACITY_TABLE,
  MIN_ALUMINUM_CABLE_SIZE_MM2,
  MIN_PV_DC_CABLE_SIZE_MM2,
  STANDARD_CABLE_SIZES_MM2,
  calculateDcVoltageDrop,
  calculateTempDerating,
  calculateThreePhaseAcVoltageDrop,
  computeCableRecommendations,
  selectStandardConductorSize,
} from "../lib/3d/cableAdvisor";
import { PANEL_TYPES, panelTypeDefinition } from "../lib/3d/panels";
import type { ElectricalTopology, PanelFlowData } from "../lib/3d/electricityFlow";
import * as THREE from "three";

describe("Cable Specification Advisor Engine", () => {
  describe("1. Panel Specifications and STC Electrical Ratings", () => {
    it("provides genuine STC electrical ratings for each standard panel type", () => {
      for (const panel of PANEL_TYPES) {
        const def = panelTypeDefinition(panel.id);
        expect(def.vmpV).toBeDefined();
        expect(def.impA).toBeDefined();
        expect(def.vocV).toBeDefined();
        expect(def.iscA).toBeDefined();

        // Physical and electrical sanity checks
        expect(def.vmpV!).toBeGreaterThan(30);
        expect(def.vmpV!).toBeLessThan(60);
        expect(def.impA!).toBeGreaterThan(8);
        expect(def.impA!).toBeLessThan(20);
        expect(def.vocV!).toBeGreaterThan(def.vmpV!);
        expect(def.iscA!).toBeGreaterThan(def.impA!);

        // Calculated nominal power should closely match catalog wattage (P = Vmp * Imp)
        const calcWatts = def.vmpV! * def.impA!;
        expect(Math.abs(calcWatts - def.watts) / def.watts).toBeLessThan(0.05);
      }
    });

    it("identifies 550W module specifications correctly", () => {
      const p550 = panelTypeDefinition("panel-550w");
      expect(p550.watts).toBe(550);
      expect(p550.vmpV).toBe(42.0);
      expect(p550.impA).toBe(13.1);
      expect(p550.vocV).toBe(50.0);
      expect(p550.iscA).toBe(14.0);
    });
  });

  describe("2. Voltage Drop Physics Calculations", () => {
    it("calculates DC two-wire voltage drop accurately using Ohm's law and resistivity", () => {
      // Loop length = 2 * lengthM * I * rho / A
      // length = 20m, current = 10A, area = 4.0 mm², copper rho = 0.0213
      // drop = 2 * 20 * 10 * 0.0213 / 4.0 = 2.13 V
      const drop = calculateDcVoltageDrop(20, 10, 4.0, "copper");
      expect(drop.dropV).toBeCloseTo(2.13, 2);
      expect(drop.requiredAreaForDrop(2.13)).toBeCloseTo(4.0, 1);
    });

    it("calculates aluminum DC voltage drop accounting for higher resistivity", () => {
      // aluminum rho = 0.0345
      // drop = 2 * 20 * 10 * 0.0345 / 10.0 = 1.38 V
      const drop = calculateDcVoltageDrop(20, 10, 10.0, "aluminum");
      expect(drop.dropV).toBeCloseTo(1.38, 2);
      expect(drop.requiredAreaForDrop(1.38)).toBeCloseTo(10.0, 1);
    });

    it("calculates Three-Phase AC voltage drop using sqrt(3) line-to-line factor", () => {
      // drop = sqrt(3) * lengthM * I * rho / A
      // length = 25m, current = 20A, area = 16.0 mm², copper rho = 0.0213
      // drop = 1.73205 * 25 * 20 * 0.0213 / 16 = 1.1528 V
      const drop = calculateThreePhaseAcVoltageDrop(25, 20, 16.0, "copper");
      expect(drop.dropV).toBeCloseTo(1.15, 2);
    });
  });

  describe("3. Temperature Derating and Ampacity Standards", () => {
    it("calculates ambient temperature derating factor for elevated rooftop heat (45°C)", () => {
      // IS/IEC formula: sqrt((90 - 45) / (90 - 30)) = sqrt(45 / 60) = sqrt(0.75) ≈ 0.866
      const factor45 = calculateTempDerating(45, 90);
      expect(factor45).toBeCloseTo(0.866, 3);

      // At baseline 30°C, derating factor must be exactly 1.0
      const factor30 = calculateTempDerating(30, 90);
      expect(factor30).toBeCloseTo(1.0, 3);
    });

    it("provides ampacity ratings for standard metric cross-sections", () => {
      expect(STANDARD_CABLE_SIZES_MM2).toContain(4.0);
      expect(STANDARD_CABLE_SIZES_MM2).toContain(6.0);
      expect(STANDARD_CABLE_SIZES_MM2).toContain(16.0);
      expect(STANDARD_CABLE_SIZES_MM2).toContain(25.0);

      // Ampacities must strictly increase with conductor size
      const cuTable = BASE_AMPACITY_TABLE.copper;
      let prevConduitA = 0;
      for (const size of STANDARD_CABLE_SIZES_MM2) {
        const rating = cuTable[size];
        expect(rating).toBeDefined();
        expect(rating.conduitA).toBeGreaterThan(prevConduitA);
        expect(rating.airA).toBeGreaterThan(rating.conduitA);
        prevConduitA = rating.conduitA;
      }
    });
  });

  describe("4. Standard Conductor Sizing Selection", () => {
    it("enforces minimum 4.0 mm² for solar PV DC strings even when 1.5/2.5 mm² would carry current", () => {
      const selected = selectStandardConductorSize({
        material: "copper",
        designCurrentA: 5.0, // Very small current
        operatingCurrentA: 4.0,
        lengthM: 5.0,
        nominalVoltageV: 400,
        maxDropPercent: 1.5,
        minCodeSizeMm2: MIN_PV_DC_CABLE_SIZE_MM2, // 4.0 mm²
        inConduit: true,
        ambientTempC: 45,
      });

      expect(selected.sizeMm2).toBeGreaterThanOrEqual(MIN_PV_DC_CABLE_SIZE_MM2);
      expect(selected.sizeMm2).toBe(4.0);
      expect(selected.voltageDropPercent).toBeLessThanOrEqual(1.5);
    });

    it("enforces minimum 10.0 mm² for aluminum building wiring per IS 732", () => {
      const selected = selectStandardConductorSize({
        material: "aluminum",
        designCurrentA: 10.0,
        operatingCurrentA: 8.0,
        lengthM: 10.0,
        nominalVoltageV: 415,
        maxDropPercent: 2.0,
        minCodeSizeMm2: MIN_ALUMINUM_CABLE_SIZE_MM2, // 10.0 mm²
        inConduit: true,
        ambientTempC: 45,
      });

      expect(selected.sizeMm2).toBeGreaterThanOrEqual(MIN_ALUMINUM_CABLE_SIZE_MM2);
    });

    it("upsizes conductor to satisfy allowable voltage drop constraint on long cable runs", () => {
      // 15A over 150 metres at 100V with 1.5% max drop (max drop = 1.5 V)
      const selected = selectStandardConductorSize({
        material: "copper",
        designCurrentA: 18.75, // 1.25 * 15A
        operatingCurrentA: 15.0,
        lengthM: 150.0,
        nominalVoltageV: 100,
        maxDropPercent: 1.5,
        minCodeSizeMm2: 4.0,
        inConduit: true,
        ambientTempC: 45,
      });

      expect(selected.voltageDropPercent).toBeLessThanOrEqual(1.5);
      // For this long distance, 4 mm² would have drop = 2 * 150 * 15 * 0.0213 / 4 = 23.9V (23.9%).
      // Sizing must upsize to a substantial cable size (e.g. >= 50 mm²) to meet 1.5% drop.
      expect(selected.sizeMm2).toBeGreaterThanOrEqual(50.0);
    });
  });

  describe("5. System Report Generation (computeCableRecommendations)", () => {
    it("generates representative recommendations when panels are enabled but unplaced", () => {
      const emptyTopology: ElectricalTopology = {
        strings: [],
        combinerPositions: [],
        mainJunctionPosition: new THREE.Vector3(0, 0, 10),
        endpointPosition: new THREE.Vector3(0, 0, 10),
        routes: [],
        isValidRouting: true,
      };

      const flowData: PanelFlowData[] = [
        {
          config: {
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
          },
          panels: [],
        },
      ];

      const report = computeCableRecommendations({
        panelLayers: flowData,
        topology: emptyTopology,
        buildingHeightM: 12,
      });

      expect(report).toBeDefined();
      expect(report.circuits).toHaveLength(3);

      const dcString = report.circuits.find((c) => c.circuitType === "dc-string");
      const dcMain = report.circuits.find((c) => c.circuitType === "dc-main");
      const acOutput = report.circuits.find((c) => c.circuitType === "ac-output");

      expect(dcString).toBeDefined();
      expect(dcMain).toBeDefined();
      expect(acOutput).toBeDefined();

      // Unplaced system must clearly flag provisional status
      expect(dcString!.isProvisional).toBe(true);
      expect(dcString!.missingInputs).toBeDefined();
      expect(dcString!.missingInputs!.length).toBeGreaterThan(0);

      expect(report.disclaimer).toContain("Preliminary planning aid only");
      expect(report.disclaimer).toContain("IS 732");
    });

    it("calculates exact circuit sizing with placed panels and 3D topology routes", () => {
      const p1 = new THREE.Vector3(0, 0, 10);
      const p2 = new THREE.Vector3(5, 5, 10);
      const p3 = new THREE.Vector3(12, 8, 10);

      const topology: ElectricalTopology = {
        strings: [
          { id: "s-0", panelIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], combinerPosition: p2, intensity: 1.0 },
          { id: "s-1", panelIndices: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], combinerPosition: p2, intensity: 1.0 },
        ],
        combinerPositions: [p2],
        mainJunctionPosition: p2,
        endpointPosition: p3,
        routes: [
          {
            id: "r-str-0",
            type: "string-branch",
            points: [p1, p2],
            cumulativeDistances: [0, 7.07],
            totalLength: 7.07,
            flowIntensity: 1.0,
          },
          {
            id: "r-trunk-0",
            type: "combiner-trunk",
            points: [p2, p3],
            cumulativeDistances: [0, 7.61],
            totalLength: 7.61,
            flowIntensity: 1.0,
          },
        ],
        isValidRouting: true,
      };

      const flowData: PanelFlowData[] = [
        {
          config: {
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
          },
          panels: Array.from({ length: 20 }, (_, i) => ({
            index: i,
            x: i * 1.5,
            y: (i % 2) * 2.5,
            rotationDeg: 0,
          })),
        },
      ];

      const report = computeCableRecommendations({
        panelLayers: flowData,
        topology,
        buildingHeightM: 15,
      });

      expect(report.totalSystemKw).toBe(11.0); // 20 * 550W = 11 kWp
      expect(report.totalStrings).toBe(2);

      const dcString = report.circuits.find((c) => c.circuitType === "dc-string")!;
      // 10 modules * 42.0 Vmp = 420.0 V
      expect(dcString.nominalVoltageV).toBe(420.0);
      expect(dcString.operatingCurrentA).toBe(13.1);
      // Design current = 1.25 * Isc (1.25 * 14.0 = 17.5 A)
      expect(dcString.designCurrentA).toBe(17.5);
      expect(dcString.standardReference).toBe("IS 17293 / EN 50618");
      expect(dcString.recommendedSizeMm2).toBeGreaterThanOrEqual(4.0);
      expect(dcString.voltageDropPercent).toBeLessThanOrEqual(1.5);

      const dcMain = report.circuits.find((c) => c.circuitType === "dc-main")!;
      // 2 strings in parallel: total design current = 2 * 17.5 = 35.0 A
      expect(dcMain.designCurrentA).toBe(35.0);
      expect(dcMain.operatingCurrentA).toBeCloseTo(26.2, 1);
      expect(dcMain.recommendedSizeMm2).toBeGreaterThanOrEqual(4.0);
      expect(dcMain.voltageDropPercent).toBeLessThanOrEqual(1.5);

      const acOutput = report.circuits.find((c) => c.circuitType === "ac-output")!;
      expect(acOutput.voltageType).toBe("AC 3-Phase (415V)");
      expect(acOutput.nominalVoltageV).toBe(415.0);
      expect(acOutput.voltageDropPercent).toBeLessThanOrEqual(2.0);
      // AC circuit includes provisional vertical riser warning
      expect(acOutput.isProvisional).toBe(true);
      expect(acOutput.missingInputs).toBeDefined();
    });
  });
});
