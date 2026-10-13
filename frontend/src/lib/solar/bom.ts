/**
 * Bill of Materials (BOM) & Turnkey Cost Estimation for Indian Solar Installations
 *
 * Grounded in MNRE (Ministry of New and Renewable Energy) benchmark costs,
 * PM Surya Ghar: Muft Bijli Yojana subsidy regulations, and ALMM domestic
 * market pricing for modules, inverters, cables, and mounting structures.
 */

import { panelTypeDefinition, type InstallationType, type MountingType, type PanelTypeId } from "../3d/panels";

export interface BillOfMaterialsItem {
  category: string;
  item: string;
  specification: string;
  quantity: number;
  unit: string;
  unitRateInr: number;
  totalAmountInr: number;
}

export interface BillOfMaterialsSummary {
  items: BillOfMaterialsItem[];
  totalCapacityKwp: number;
  moduleCount: number;
  grossTotalInr: number;
  subsidyInr: number;
  netPayableInr: number;
  generatedDate: string;
}

export interface GenerateBOMOptions {
  panelCount: number;
  panelTypeId: PanelTypeId;
  mountingType: MountingType;
  installationType?: InstallationType;
  areaM2?: number;
}

/**
 * Calculate Central Financial Assistance (CFA / Subsidy) under PM Surya Ghar:
 * - Up to 2 kWp: Rs. 30,000 per kWp (max Rs. 60,000)
 * - 3rd kWp: Rs. 18,000
 * - Systems >= 3 kWp: Capped at Rs. 78,000
 */
export function calculatePmSuryaGharSubsidy(capacityKwp: number, isGround: boolean = false): number {
  if (isGround || capacityKwp <= 0) return 0;
  if (capacityKwp <= 2.0) {
    return Math.round(capacityKwp * 30000);
  }
  if (capacityKwp < 3.0) {
    return Math.round(60000 + (capacityKwp - 2.0) * 18000);
  }
  return 78000;
}

/**
 * Generate an authentic Indian market Bill of Materials for the specified solar system.
 */
export function generateBillOfMaterials(options: GenerateBOMOptions): BillOfMaterialsSummary {
  const { panelCount, panelTypeId, mountingType, installationType = "rooftop" } = options;
  const isGround = installationType === "ground";
  const def = panelTypeDefinition(panelTypeId);
  const panelWatts = def.watts;
  const count = Math.max(1, panelCount);
  const totalCapacityKwp = Math.round(((count * panelWatts) / 1000) * 100) / 100;

  const items: BillOfMaterialsItem[] = [];

  // 1. Solar PV Modules
  const moduleRatePerWatt = 22.0; // Rs. 22/W for DCR ALMM-listed Mono PERC/TOPCon
  const moduleUnitRate = Math.round(panelWatts * moduleRatePerWatt);
  const moduleTotal = moduleUnitRate * count;
  items.push({
    category: "Photovoltaic Modules",
    item: `Solar PV Module (${def.label})`,
    specification: `Mono PERC / N-Type TOPCon, Half-Cut, ALMM DCR Compliant, ${panelWatts}Wp, Eff > 21%`,
    quantity: count,
    unit: "Nos",
    unitRateInr: moduleUnitRate,
    totalAmountInr: moduleTotal,
  });

  // 2. Module Mounting Structure (MMS)
  let mmsRatePerKwp = 3800;
  let mmsSpec = "Hot-Dip Galvanized (HDG) / Anodized Aluminium, SS304 Fasteners, Wind class 150 km/h";
  if (isGround) {
    if (mountingType === "ground_tracker_single") {
      mmsRatePerKwp = 7800;
      mmsSpec = "Single-Axis Tracker (HSAT): Continuous Torque Tube, Slewing Drive & Motor, Heavy Piers";
    } else if (mountingType === "ground_elevated") {
      mmsRatePerKwp = 6800;
      mmsSpec = "Elevated Agrivoltaic Portal Frame: 3.0m High-Clearance Columns, Cross Girders, Rafters";
    } else if (mountingType === "ground_pole") {
      mmsRatePerKwp = 5600;
      mmsSpec = "Central Steel Mast Pipe Mount: Concrete Footing, Azimuth Collar, Elevation Truss Arms";
    } else if (mountingType === "ground_adjustable") {
      mmsRatePerKwp = 4800;
      mmsSpec = "Seasonal Adjustable Ground Table: Telescoping Rear Struts, Pivot Pin Plates (10°-45°)";
    } else {
      mmsRatePerKwp = 4400;
      mmsSpec = "Fixed-Tilt Ground Mount: Driven Pile Foundations, Front/Rear Posts, Rafters, Purlins & Knee Braces";
    }
  }
  const mmsTotal = Math.round(totalCapacityKwp * mmsRatePerKwp);
  items.push({
    category: "Mounting Structure",
    item: isGround ? "Ground Mounting Structural System" : "Rooftop Mounting Structure",
    specification: mmsSpec,
    quantity: totalCapacityKwp,
    unit: "kWp",
    unitRateInr: mmsRatePerKwp,
    totalAmountInr: mmsTotal,
  });

  // 3. Grid-Tied Solar Inverter
  const inverterRatePerKwp = 7200;
  const inverterCapacity = Math.ceil(totalCapacityKwp);
  const inverterTotal = Math.round(totalCapacityKwp * inverterRatePerKwp);
  items.push({
    category: "Power Conditioning",
    item: "On-Grid String Inverter",
    specification: `Transformerless Solar Inverter with Dual MPPT, WiFi/4G Datalogger, IP65, Grid Synchronization (~${inverterCapacity} kW)`,
    quantity: 1,
    unit: "Set",
    unitRateInr: inverterTotal,
    totalAmountInr: inverterTotal,
  });

  // 4. DC Solar Cable & Connectors
  const dcCableMeters = Math.max(30, Math.round(count * 6.5));
  const dcCableRate = 85; // Rs. 85 per meter for 4/6 sq mm XLPO
  const dcCableTotal = dcCableMeters * dcCableRate;
  items.push({
    category: "Electrical Balance of System",
    item: "Solar DC Cable (4 sq mm / 6 sq mm)",
    specification: "Tinned Copper, Electron-beam cross-linked XLPO insulation, UV & Ozone Resistant, EN 50618",
    quantity: dcCableMeters,
    unit: "Meters",
    unitRateInr: dcCableRate,
    totalAmountInr: dcCableTotal,
  });

  // 5. MC4 Connectors
  const mc4Pairs = Math.max(4, Math.round(count * 1.2));
  const mc4Rate = 120;
  items.push({
    category: "Electrical Balance of System",
    item: "MC4 Connectors (Male/Female Pairs)",
    specification: "IP68 Waterproof, 1000V DC rated, Flame Retardant UL94-V0",
    quantity: mc4Pairs,
    unit: "Pairs",
    unitRateInr: mc4Rate,
    totalAmountInr: mc4Pairs * mc4Rate,
  });

  // 6. Distribution Boxes (DCDB & ACDB)
  const dcdbRate = Math.round(2200 + totalCapacityKwp * 350);
  items.push({
    category: "Protection & Switchgear",
    item: "DC Distribution Box (DCDB)",
    specification: "IP65 Enclosure, 1000V DC Type-II Surge Protection Device (SPD), 1000V DC Fuses & Isolator",
    quantity: 1,
    unit: "Nos",
    unitRateInr: dcdbRate,
    totalAmountInr: dcdbRate,
  });

  const acdbRate = Math.round(2800 + totalCapacityKwp * 450);
  items.push({
    category: "Protection & Switchgear",
    item: "AC Distribution Box (ACDB)",
    specification: "IP65 Enclosure, Class II AC SPD, 4-Pole MCB / MCCB, Terminal Blocks",
    quantity: 1,
    unit: "Nos",
    unitRateInr: acdbRate,
    totalAmountInr: acdbRate,
  });

  // 7. AC Armoured Cable to LT Panel
  const acCableMeters = 25;
  const acCableRate = 240;
  items.push({
    category: "Electrical Balance of System",
    item: "AC Armoured Cable",
    specification: "4-Core Copper/Aluminium XLPE Insulated Armoured Cable (Inverter to Main LT Board)",
    quantity: acCableMeters,
    unit: "Meters",
    unitRateInr: acCableRate,
    totalAmountInr: acCableMeters * acCableRate,
  });

  // 8. Earthing System & Chemical Pits
  const earthingPits = totalCapacityKwp <= 5 ? 2 : 3;
  const earthingPitRate = 3800;
  items.push({
    category: "Safety & Grounding",
    item: "Chemical Earthing Pits",
    specification: "Copper-Bonded Rod (14.2mm dia, 3m length) with Carbon Conductive Earth Compound & Pit Chamber",
    quantity: earthingPits,
    unit: "Sets",
    unitRateInr: earthingPitRate,
    totalAmountInr: earthingPits * earthingPitRate,
  });

  // 9. Lightning Protection Arrester
  const laRate = 4200;
  items.push({
    category: "Safety & Grounding",
    item: "Lightning Protection Arrester",
    specification: "Conventional / Early Streamer Emission (ESE) Terminal with 25x3mm GI Earth Strip Conductor",
    quantity: 1,
    unit: "Set",
    unitRateInr: laRate,
    totalAmountInr: laRate,
  });

  // 10. Net Metering Liaison, Civil Works & Installation
  const installationRatePerKwp = 4800;
  const installationTotal = Math.round(totalCapacityKwp * installationRatePerKwp);
  items.push({
    category: "Installation & Commissioning",
    item: "EPC Installation, Civil Works & Commissioning",
    specification: "Mechanical Assembly, Grouting/Piling, DC/AC Wiring, Testing, Discom Net Meter Inspection",
    quantity: totalCapacityKwp,
    unit: "kWp",
    unitRateInr: installationRatePerKwp,
    totalAmountInr: installationTotal,
  });

  const grossTotalInr = items.reduce((sum, item) => sum + item.totalAmountInr, 0);
  const subsidyInr = calculatePmSuryaGharSubsidy(totalCapacityKwp, isGround);
  const netPayableInr = Math.max(0, grossTotalInr - subsidyInr);

  return {
    items,
    totalCapacityKwp,
    moduleCount: count,
    grossTotalInr,
    subsidyInr,
    netPayableInr,
    generatedDate: new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

/**
 * Generate CSV string with UTF-8 BOM encoding and standard currency formatting.
 */
export function generateBillOfMaterialsCSV(summary: BillOfMaterialsSummary): string {
  const rows: string[] = [];

  // Header Metadata
  rows.push("==========================================================================================");
  rows.push("SURYA-GHAR SOLAR PLANNING APPLICATION - BILL OF MATERIALS (BOM) & COST ESTIMATE");
  rows.push("==========================================================================================");
  rows.push(`Date Generated,${summary.generatedDate}`);
  rows.push(`Total System Capacity,${summary.totalCapacityKwp} kWp`);
  rows.push(`Total PV Modules,${summary.moduleCount} Units`);
  rows.push(`Currency,Indian Rupee (INR / Rs.)`);
  rows.push("");

  // Table Columns
  rows.push("Item No.,Category,Item Description,Technical Specification,Quantity,Unit,Unit Rate (Rs.),Total Amount (Rs.)");

  summary.items.forEach((it, idx) => {
    const escapedItem = `"${it.item.replace(/"/g, '""')}"`;
    const escapedSpec = `"${it.specification.replace(/"/g, '""')}"`;
    const escapedCat = `"${it.category.replace(/"/g, '""')}"`;
    rows.push(
      `${idx + 1},${escapedCat},${escapedItem},${escapedSpec},${it.quantity},${it.unit},${it.unitRateInr},${it.totalAmountInr}`,
    );
  });

  rows.push("");
  rows.push("==========================================================================================");
  rows.push("FINANCIAL SUMMARY & SUBSIDY BREAKDOWN");
  rows.push("==========================================================================================");
  rows.push(`Gross Turnkey Project Cost (Rs.),,,,,,,${summary.grossTotalInr}`);
  rows.push(`PM Surya Ghar Central Financial Assistance (Subsidy) (Rs.),,,,,,,-${summary.subsidyInr}`);
  rows.push(`Net Estimated Customer Payable (Rs.),,,,,,,${summary.netPayableInr}`);
  rows.push("");
  rows.push("Notes:");
  rows.push("1. Pricing is indicative based on prevailing Indian solar EPC market benchmarks and ALMM-listed DCR components.");
  rows.push("2. PM Surya Ghar subsidy eligibility is subject to DISCOM approval and portal registration under national guidelines.");
  rows.push("3. Structure calculations account for wind speeds up to 150 km/h with SS304 fasteners and hot-dip galvanization.");

  return rows.join("\r\n");
}

/**
 * Trigger local machine download of the CSV file.
 */
export function downloadBillOfMaterialsCSV(options: GenerateBOMOptions): void {
  const summary = generateBillOfMaterials(options);
  const csvText = generateBillOfMaterialsCSV(summary);

  // Prepend UTF-8 BOM (\uFEFF) so Excel and CSV viewers properly decode text and symbols
  const blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const timestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `SuryaGhar_Bill_Of_Materials_${summary.totalCapacityKwp}kWp_${timestamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
