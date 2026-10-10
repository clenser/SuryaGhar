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

import { Moon, Pause, Play } from "lucide-react";
import { compassDirection } from "../../services/analysis";
import { formatClockTime, type SunState } from "../../lib/solar";

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
  onDateChange,
  onTimeChange,
  onTogglePlay,
}: SunControlsProps) {
  const unavailable = state === null;
  const clock = formatClockTime(timeMinutes);

  return (
    <section className="sun-section" aria-label="Sun and shadows">
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
        <button
          type="button"
          className="btn btn--secondary sun-play"
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

      <div className="sun-fields">
        <div className="sun-field">
          <label className="sun-field__label" htmlFor="sun-date">
            Date
          </label>
          <input
            id="sun-date"
            className="sun-field__input"
            type="date"
            value={date}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>

        <div className="sun-field sun-field--time">
          <label className="sun-field__label" htmlFor="sun-time">
            Local time
            <span className="sun-field__value">{clock}</span>
          </label>
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
