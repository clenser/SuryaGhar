import { useEffect, useState } from "react";
import { analyzeShadows, analyzeSurroundings, type ShadowResult, type SurroundingsResult } from "../../services/analysis";
import type { LngLat } from "../../lib/geo";

interface SitePanelProps {
  vertices: LngLat[];
  onShadows: (shadows: GeoJSON.FeatureCollection | null) => void;
}

/** Stage 5: surroundings + shadow estimate. */
export function SitePanel({ vertices, onShadows }: SitePanelProps) {
  const [surroundings, setSurroundings] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: SurroundingsResult }
  >({ kind: "idle" });
  const [shadows, setShadows] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; result: ShadowResult }
  >({ kind: "idle" });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [localHour, setLocalHour] = useState(12);

  const runSurroundings = () => {
    setSurroundings({ kind: "loading" });
    analyzeSurroundings(vertices)
      .then((result) => setSurroundings({ kind: "ok", result }))
      .catch((err) => setSurroundings({ kind: "error", message: err instanceof Error ? err.message : "Surroundings analysis failed" }));
  };

  const runShadows = () => {
    setShadows({ kind: "loading" });
    const hourUtc = localHour - 5.5; // India Standard Time offset; documented in the UI
    analyzeShadows(vertices, date, hourUtc)
      .then((result) => {
        setShadows({ kind: "ok", result });
        onShadows(result.shadow_geojson);
      })
      .catch((err) => setShadows({ kind: "error", message: err instanceof Error ? err.message : "Shadow analysis failed" }));
  };

  useEffect(() => {
    setSurroundings({ kind: "idle" });
    setShadows({ kind: "idle" });
    onShadows(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices]);

  return (
    <div className="stage-card">
      <p className="stage-card__eyebrow">Stage 5 of 5</p>
      <h2 className="stage-card__title">Site context</h2>

      <div className="stage-card__actions">
        <button type="button" className="btn" onClick={runSurroundings} disabled={surroundings.kind === "loading"}>
          {surroundings.kind === "loading" ? (
            <><span className="spinner" aria-hidden="true" /> Scanning surroundings…</>
          ) : (
            "Scan surroundings"
          )}
        </button>
      </div>

      {surroundings.kind === "error" && <p className="stage-card__warning" role="alert">{surroundings.message}</p>}

      {surroundings.kind === "ok" && (
        <>
          <dl className="metric-list" style={{ marginTop: 12 }}>
            <div>
              <dt>Buildings nearby</dt>
              <dd>{surroundings.result.building_count}</dd>
            </div>
            <div>
              <dt>With height tag</dt>
              <dd>{surroundings.result.buildings_with_height_tag}</dd>
            </div>
            <div>
              <dt>Median height</dt>
              <dd>{surroundings.result.median_height_m ? `${surroundings.result.median_height_m} m` : "—"}</dd>
            </div>
            <div>
              <dt>Tallest tagged</dt>
              <dd>{surroundings.result.max_height_m ? `${surroundings.result.max_height_m} m` : "—"}</dd>
            </div>
            <div>
              <dt>Trees</dt>
              <dd>{surroundings.result.tree_count}</dd>
            </div>
          </dl>
          {surroundings.result.warnings.map((w) => (
            <p className="result-note" key={w}>{w}</p>
          ))}
        </>
      )}

      <hr style={{ border: 0, borderTop: "1px solid var(--color-border)", margin: "12px 0" }} />

      <div className="field-grid">
        <div className="field">
          <label htmlFor="shadow-date">Date</label>
          <input id="shadow-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="shadow-hour">Local hour (IST)</label>
          <input id="shadow-hour" type="number" min={6} max={18} step={0.5} value={localHour} onChange={(e) => setLocalHour(Number(e.target.value))} />
        </div>
      </div>
      <div className="stage-card__actions">
        <button type="button" className="btn" onClick={runShadows} disabled={shadows.kind === "loading"}>
          {shadows.kind === "loading" ? (
            <><span className="spinner" aria-hidden="true" /> Projecting shadows…</>
          ) : (
            "Estimate shadows"
          )}
        </button>
      </div>

      {shadows.kind === "error" && <p className="stage-card__warning" role="alert">{shadows.message}</p>}

      {shadows.kind === "ok" && (
        <>
          <div className="result-hero" style={{ marginTop: 12 }}>
            <span className="result-hero__value">{Math.round(shadows.result.hour_shading_fraction * 100)}% shaded</span>
            <span className="result-hero__label">
              Sun altitude {shadows.result.sun_altitude_deg}°, azimuth {shadows.result.sun_azimuth_deg}°
            </span>
          </div>
          <div className="chart" aria-label="Hourly shading">
            {shadows.result.hourly.map((h) => (
              <div className="chart__row" key={h.hour_utc}>
                <span>{`${String(Math.floor(h.hour_utc + 5.5) % 24).padStart(2, "0")}:30`}</span>
                <span className="chart__bar" style={{ width: `${Math.round(h.shaded_fraction * 100)}%` }} />
                <span>{Math.round(h.shaded_fraction * 100)}%</span>
              </div>
            ))}
          </div>
          {shadows.result.warnings.map((w) => (
            <p className="result-note" key={w}>{w}</p>
          ))}
        </>
      )}
    </div>
  );
}
