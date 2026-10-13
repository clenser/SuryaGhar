/**
 * SunControls — date, local time, azimuth/elevation readout and Play/Pause
 * for the visual sun simulation (Phase 4).
 *
 * Compact and consistent with the existing workspace sections: the same
 * toolbar/label/button patterns as the obstacle editor, with a 44 px touch
 * target for the play button on mobile (AGENTS.md §46/§48).
 *
 * The readout states the sun's position only — AGENTS.md §24/§53: Three.js
 * shadows are a visual simulation, never a quantitative energy-loss figure,
 * so the note below says exactly that.
 */

import { Calendar, Clock, Moon, Pause, Play, Sun } from "lucide-react";
import { compassDirection } from "../../services/analysis";
import { formatClockTime, type SunState, SUN_PLAYBACK_SPEED } from "../../lib/solar";

export interface SunControlsProps {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Simulated local minute-of-day, 0…1440. */
  timeMinutes: number;
  playing: boolean;
  /** Interpolated sun state, or null when the date could not be sampled. */
  state: SunState | null;
  /** e.g. `Asia/Kolkata (UTC+05:30)`. */
  timezoneLabel: string;
  /** e.g. `10 Oct 2026 · 15:30 IST` — explicit site date/time, or null. */
  dateTimeLabel?: string | null;
  /** Simulated minutes per real second. */
  speed?: number;
  onSpeedChange?: (speed: number) => void;
  onDateChange: (date: string) => void;
  onTimeChange: (minutes: number) => void;
  onTogglePlay: () => void;
}

export function SunControls({
  date,
  timeMinutes,
  playing,
  state,
  timezoneLabel,
  dateTimeLabel = null,
  speed = SUN_PLAYBACK_SPEED,
  onSpeedChange,
  onDateChange,
  onTimeChange,
  onTogglePlay,
}: SunControlsProps) {
  const unavailable = state === null;
  const clock = formatClockTime(timeMinutes);

  return (
    <section className="sun-section" aria-label="Sun and shadows">
      {/* 1. Header Toolbar with Play button and Speed selector */}
      <div className="sun-toolbar">
        <div className="sun-toolbar__labels">
          <h3 className="sun-section__title">Sun &amp; shadows</h3>
          <p className="sun-clock">
            <span className="sun-clock__time">{clock}</span>
            <span className="sun-clock__suffix"> local</span>
          </p>
          {dateTimeLabel && (
            <p className="sun-datetime" data-testid="sun-datetime">
              {dateTimeLabel}
            </p>
          )}
        </div>

        <div className="sun-toolbar__actions">
          {onSpeedChange && (
            <div className="sun-speed-group" role="group" aria-label="Simulation speed">
              <span className="sun-speed-label">Speed</span>
              {[
                { label: "0.5×", val: 10 },
                { label: "1×", val: 20 },
                { label: "2×", val: 40 },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={`sun-speed-btn ${speed === s.val ? "sun-speed-btn--active" : ""}`}
                  onClick={() => onSpeedChange(s.val)}
                  title={`${s.label} speed (${s.val} min/sec)`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className={`btn ${playing ? "btn--primary" : "btn--secondary"} sun-play`}
            onClick={onTogglePlay}
            disabled={unavailable}
            aria-pressed={playing}
          >
            {playing ? (
              <Pause size={15} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Play size={15} strokeWidth={2} aria-hidden="true" />
            )}
            {playing ? "Pause" : "Play day"}
          </button>
        </div>
      </div>

      <div className="sun-fields">
        {/* 2. Date row (shifted UP above the time slider) */}
        <div className="sun-field sun-field--date">
          <div className="sun-field__header">
            <label className="sun-field__label" htmlFor="sun-date">
              <Calendar size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />
              Date
            </label>
            <div className="sun-date-presets">
              <button
                type="button"
                className="sun-preset-btn"
                onClick={() => onDateChange("2026-06-21")}
                title="Summer Solstice (Jun 21) - High sun elevation"
              >
                Summer
              </button>
              <button
                type="button"
                className="sun-preset-btn"
                onClick={() => onDateChange("2026-03-21")}
                title="Spring Equinox (Mar 21)"
              >
                Equinox
              </button>
              <button
                type="button"
                className="sun-preset-btn"
                onClick={() => onDateChange("2026-12-21")}
                title="Winter Solstice (Dec 21) - Low sun elevation / longest shadows"
              >
                Winter
              </button>
            </div>
          </div>
          <input
            id="sun-date"
            className="sun-field__input"
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>

        {/* 3. Local Time Simulator Slider (placed BELOW the date, spanning FULL width with large length) */}
        <div className="sun-field sun-field--time">
          <div className="sun-field__header">
            <label className="sun-field__label" htmlFor="sun-time">
              <Clock size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />
              Local time
            </label>
            <div className="sun-time-display">
              <span className="sun-field__value">{clock}</span>
              {state && (
                <span className={`sun-state-chip ${state.night ? "sun-state-chip--night" : "sun-state-chip--day"}`}>
                  {state.night ? (
                    <>
                      <Moon size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                      Night
                    </>
                  ) : (
                    <>
                      <Sun size={11} style={{ marginRight: 3, verticalAlign: "middle" }} />
                      Daylight
                    </>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="sun-slider-wrapper">
            <input
              id="sun-time"
              className="sun-time-slider"
              type="range"
              min={0}
              max={1440}
              step={1}
              value={Math.min(1440, Math.round(timeMinutes))}
              onChange={(event) => onTimeChange(Number(event.target.value))}
              disabled={unavailable}
              aria-valuetext={`${clock} local time`}
            />
          </div>

          {/* Timeline markers across the full length */}
          <div className="sun-timeline-markers" aria-hidden="true">
            <button
              type="button"
              className="sun-marker-btn"
              onClick={() => onTimeChange(0)}
              title="Jump to 00:00 (Midnight)"
            >
              <span>00:00</span>
              <span className="sun-marker-sub">Night</span>
            </button>
            <button
              type="button"
              className="sun-marker-btn"
              onClick={() => onTimeChange(360)}
              title="Jump to 06:00 (Dawn)"
            >
              <span>06:00</span>
              <span className="sun-marker-sub">Dawn</span>
            </button>
            <button
              type="button"
              className="sun-marker-btn"
              onClick={() => onTimeChange(720)}
              title="Jump to 12:00 (Solar Noon)"
            >
              <span>12:00</span>
              <span className="sun-marker-sub">Noon</span>
            </button>
            <button
              type="button"
              className="sun-marker-btn"
              onClick={() => onTimeChange(1080)}
              title="Jump to 18:00 (Dusk)"
            >
              <span>18:00</span>
              <span className="sun-marker-sub">Dusk</span>
            </button>
            <button
              type="button"
              className="sun-marker-btn"
              onClick={() => onTimeChange(1440)}
              title="Jump to 24:00 (Midnight)"
            >
              <span>24:00</span>
              <span className="sun-marker-sub">Night</span>
            </button>
          </div>
        </div>
      </div>

      <p
        className={[
          "sun-readout",
          unavailable ? "sun-readout--error" : "",
          state && state.night && !unavailable ? "sun-readout--night" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="status"
      >
        {state === null ? (
          "Sun position unavailable — enter a valid date and site location."
        ) : state.night ? (
          <>
            <Moon size={14} strokeWidth={1.75} aria-hidden="true" />
            Night — sun below the horizon, no direct sunlight
          </>
        ) : (
          <>
            Azimuth <strong>{state.azimuthDeg.toFixed(1)}°</strong>{" "}
            {compassDirection(state.azimuthDeg)} · Elevation{" "}
            <strong>{state.elevationDeg.toFixed(1)}°</strong>
          </>
        )}
      </p>

      <p className="sun-meta">
        <span>Site time zone · {timezoneLabel}</span>
        <span className="sun-meta__note">
          Visual shadow simulation — not an energy-loss calculation
        </span>
      </p>
    </section>
  );
}

export default SunControls;
