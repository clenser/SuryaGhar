import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { analyzeSolar, compassDirection, type SolarResult } from "../../services/analysis";

function compassFor(azimuth: number | string | undefined): string {
  const n = Number(azimuth);
  return Number.isFinite(n) ? compassDirection(n) : "—";
}

interface SolarPanelProps {
  latitude: number;
  longitude: number;
  capacityKwp: number;
  onContinue?: () => void;
}

/** Stage 4: annual energy estimate via pvlib + PVGIS. */
export function SolarPanel({ latitude, longitude, capacityKwp, onContinue }: SolarPanelProps) {
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: SolarResult }
  >({ kind: "idle" });

  const run = () => {
    setState({ kind: "loading" });
    analyzeSolar(latitude, longitude, capacityKwp)
      .then((result) => setState({ kind: "ok", result }))
      .catch((err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Solar analysis failed" }));
  };

  useEffect(() => {
    setState({ kind: "idle" });
  }, [latitude, longitude, capacityKwp]);

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 4 of 5</p>
      <h2 className="stage-card__title">Solar potential</h2>
      <p className="stage-card__body">
        {capacityKwp} kWp system at {latitude.toFixed(4)}°, {longitude.toFixed(4)}°. Different tilt/azimuth combos are
        compared — there is no single universal "best angle".
      </p>
      <div className="stage-card__actions">
        <button type="button" className="btn btn--primary" onClick={run} disabled={state.kind === "loading"}>
          {state.kind === "loading" ? (
            <><Zap size={15} strokeWidth={2} aria-hidden="true" /> Analysing solar yield…</>
          ) : (
            <><Zap size={15} strokeWidth={2} aria-hidden="true" /> Estimate annual yield</>
          )}
        </button>
      </div>
      {state.kind === "loading" && (
        <div className="stage-loading" aria-live="polite">
          <div className="progress-indeterminate" aria-hidden="true"><span /></div>
          <p className="stage-loading__body">Comparing tilt and azimuth combinations…</p>
        </div>
      )}

      {state.kind === "error" && <p className="stage-card__warning" role="alert">{state.message}</p>}

      {state.kind === "ok" && (
        <>
          {state.result.annual_kwh === null ? (
            <p className="stage-card__warning">{state.result.warnings[0] ?? "Estimate unavailable."}</p>
          ) : (
            <div className="result-hero" style={{ marginTop: 12 }}>
              <span className="result-hero__value">≈ {Math.round(state.result.annual_kwh).toLocaleString()} kWh/yr</span>
              <span className="result-hero__label">
                {Math.round(state.result.specific_yield_kwh_kwp ?? 0)} kWh per kWp · {Math.round(state.result.poa_kwh_m2 ?? 0)} kWh/m² on
                the panel plane per year
              </span>
            </div>
          )}
          <dl className="metric-list" aria-label="Recommended orientation">
            <div>
              <dt>Recommended orientation</dt>
              <dd>
                {compassFor(state.result.selected.azimuth_deg)} · {state.result.selected.azimuth_deg}°
              </dd>
            </div>
            <div>
              <dt>Recommended tilt</dt>
              <dd>{state.result.selected.tilt_deg}°</dd>
            </div>
          </dl>
          <p className="result-note">
            Confidence: {state.result.confidence} · Source: {state.result.resource_provider}
          </p>
          {state.result.candidates.length > 0 && (
            <div className="bar-list" aria-label="Tilt and azimuth comparison">
              {[...state.result.candidates].sort((a, b) => (b.annual_kwh as number) - (a.annual_kwh as number)).slice(0, 8).map((c, i) => (
                <div className="bar-list__row" key={i}>
                  <span>
                    {c.tilt_deg}° / {c.azimuth_deg}°
                  </span>
                  <span className="bar-list__track">
                    <span
                      className="bar-list__fill"
                      style={{
                        width: `${Math.round(((c.annual_kwh as number) / Math.max(...state.result.candidates.map((x) => x.annual_kwh as number))) * 100)}%`,
                        display: "block",
                      }}
                    />
                  </span>
                  <span>{Math.round((c.annual_kwh as number) / 1000)}k</span>
                </div>
              ))}
            </div>
          )}
          {state.result.warnings.map((w) => (
            <p className="result-note" key={w}>{w}</p>
          ))}
          {onContinue && (
            <div className="stage-card__actions">
              <button type="button" className="btn btn--primary" onClick={onContinue}>
                Continue to site context
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
