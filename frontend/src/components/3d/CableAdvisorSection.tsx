/**
 * CableAdvisorSection - UI component for Cable Specification Recommendations
 *
 * Renders preliminary, engineering-grounded cable sizing recommendations for:
 * 1. DC String Circuits (Modules to Combiner Box)
 * 2. DC Main Array Circuit (Combiner Box to Inverter)
 * 3. Inverter AC Output Circuit (Inverter to Main LT Switchboard)
 *
 * Displays conductor material, standard metric sizes, design current, operating voltage,
 * estimated lengths, and percentage voltage drops. Clearly marks provisional values and
 * lists all applicable assumptions.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Info } from "lucide-react";
import type { CableSpecificationReport } from "../../lib/3d/cableAdvisor";

export interface CableAdvisorSectionProps {
  report: CableSpecificationReport;
  hasPlacedPanels: boolean;
}

export function CableAdvisorSection({ report, hasPlacedPanels }: CableAdvisorSectionProps) {
  const [expandedCircuit, setExpandedCircuit] = useState<string | null>("dc-string");

  const toggleCircuit = (id: string) => {
    setExpandedCircuit((prev) => (prev === id ? null : id));
  };

  return (
    <div className="cable-advisor" role="region" aria-label="Cable Specification Recommendations">
      {/* Header Summary */}
      <div className="cable-advisor__summary">
        <div className="cable-advisor__summary-item">
          <span className="cable-advisor__summary-label">System Size</span>
          <span className="cable-advisor__summary-value">{report.totalSystemKw.toFixed(2)} kWp</span>
        </div>
        <div className="cable-advisor__summary-item">
          <span className="cable-advisor__summary-label">Array Strings</span>
          <span className="cable-advisor__summary-value">
            {report.totalStrings} string{report.totalStrings === 1 ? "" : "s"}
          </span>
        </div>
        <div className="cable-advisor__summary-item">
          <span className="cable-advisor__summary-label">Inverter Rating</span>
          <span className="cable-advisor__summary-value">{report.inverterCapacityKw} kW</span>
        </div>
      </div>

      {!hasPlacedPanels && (
        <p className="cable-advisor__note" role="note">
          <Info size={14} aria-hidden="true" />
          <span>
            Showing representative recommendations for the configured module type. Place panels on the roof to compute
            exact 3D route lengths.
          </span>
        </p>
      )}

      {/* Circuits List */}
      <div className="cable-advisor__circuits" role="list">
        {report.circuits.map((circuit) => {
          const isExpanded = expandedCircuit === circuit.circuitId;
          return (
            <div
              key={circuit.circuitId}
              className={`cable-card ${circuit.isProvisional ? "cable-card--provisional" : ""}`}
              role="listitem"
            >
              {/* Card Header & Recommended Size Badge */}
              <button
                type="button"
                className="cable-card__header"
                onClick={() => toggleCircuit(circuit.circuitId)}
                aria-expanded={isExpanded}
              >
                <div className="cable-card__title-wrap">
                  <div className="cable-card__tag-row">
                    <span className="cable-card__badge-type">{circuit.voltageType}</span>
                    {circuit.isProvisional && (
                      <span className="cable-card__badge-warn" title="Contains provisional assumptions">
                        Provisional
                      </span>
                    )}
                  </div>
                  <h4 className="cable-card__title">{circuit.circuitName}</h4>
                  <p className="cable-card__endpoints">
                    {circuit.endpoints.from} → {circuit.endpoints.to}
                  </p>
                </div>

                <div className="cable-card__size-badge">
                  <span className="cable-card__size-num">{circuit.recommendedSizeMm2} mm²</span>
                  <span className="cable-card__size-mat">
                    {circuit.conductorMaterial === "copper" ? "Copper (Cu)" : "Aluminum (Al)"}
                  </span>
                </div>

                <div className="cable-card__toggle-icon" aria-hidden="true">
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>

              {/* Expanded Circuit Details */}
              {isExpanded && (
                <div className="cable-card__body">
                  <div className="cable-card__grid">
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Operating Voltage</span>
                      <span className="cable-card__cell-val">{circuit.nominalVoltageV.toFixed(1)} V</span>
                    </div>
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Operating Current</span>
                      <span className="cable-card__cell-val">{circuit.operatingCurrentA.toFixed(2)} A</span>
                    </div>
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Design Current (1.25×)</span>
                      <span className="cable-card__cell-val">{circuit.designCurrentA.toFixed(2)} A</span>
                    </div>
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Est. Route Length</span>
                      <span className="cable-card__cell-val">{circuit.estimatedLengthM.toFixed(1)} m</span>
                    </div>
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Voltage Drop</span>
                      <span
                        className={`cable-card__cell-val ${
                          circuit.voltageDropPercent <= circuit.maxAllowableDropPercent ? "text-success" : "text-warn"
                        }`}
                      >
                        {circuit.voltageDropV.toFixed(2)} V ({circuit.voltageDropPercent.toFixed(2)}%)
                      </span>
                      <span className="cable-card__cell-sub">Max: {circuit.maxAllowableDropPercent}%</span>
                    </div>
                    <div className="cable-card__cell">
                      <span className="cable-card__cell-label">Derated Ampacity</span>
                      <span className="cable-card__cell-val">{circuit.deratedAmpacityA.toFixed(1)} A</span>
                      <span className="cable-card__cell-sub">Base: {circuit.baseAmpacityA} A (45°C)</span>
                    </div>
                  </div>

                  <div className="cable-card__spec-row">
                    <span className="cable-card__spec-title">Insulation & Standard:</span>
                    <span className="cable-card__spec-text">
                      {circuit.insulationType} · <em>{circuit.standardReference}</em>
                    </span>
                  </div>

                  {/* Assumptions */}
                  <div className="cable-card__assumptions">
                    <span className="cable-card__assumptions-title">Design Assumptions:</span>
                    <ul className="cable-card__list">
                      {circuit.assumptions.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Missing inputs / provisional notice */}
                  {circuit.missingInputs && circuit.missingInputs.length > 0 && (
                    <div className="cable-card__missing-alert" role="status">
                      <AlertTriangle size={14} aria-hidden="true" />
                      <div>
                        <strong>Provisional inputs needed for final specification:</strong>
                        <ul className="cable-card__list">
                          {circuit.missingInputs.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
