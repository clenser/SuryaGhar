import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search, X, MapPin, AlertTriangle, RotateCw, Loader2 } from "lucide-react";
import { formatPlaceContext, GeocodeError, searchLocations } from "../../services/geocode";
import type { LocationResult } from "../../types";

interface LocationSearchProps {
  onSelect: (place: LocationResult) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; results: LocationResult[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 600;
const MIN_QUERY = 3;

export function LocationSearch({ onSelect }: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const statusId = useId();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setStatus({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchLocations(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        setActive(results.length ? 0 : -1);
        setStatus(results.length ? { kind: "results", results } : { kind: "empty" });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof GeocodeError ? err.message : "Search failed. Try again.";
        setStatus({ kind: "error", message });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, attempt]);

  const results = status.kind === "results" ? status.results : [];
  const showList = open && query.trim().length >= MIN_QUERY && status.kind !== "idle";

  const choose = (place: LocationResult) => {
    onSelect(place);
    setQuery(place.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) setOpen(false);
      else clear();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      choose(results[active]);
    }
  };

  const clear = () => {
    setQuery("");
    setStatus({ kind: "idle" });
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="search" role="search">
      <div className="search__field">
        <Search className="search__icon" size={16} aria-hidden="true" strokeWidth={1.75} />
        <input
          ref={inputRef}
          id="location-search-input"
          className="search__input"
          type="search"
          inputMode="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search address, locality or city in India"
          aria-label="Search location"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={statusId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button type="button" className="search__clear" onClick={clear} aria-label="Clear search">
            <X size={14} aria-hidden="true" strokeWidth={2} />
          </button>
        )}
      </div>

      {showList && (
        <div
          className="search__panel"
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          // Keep focus in the input while interacting with the panel, so blur does not close it mid-click.
          onMouseDown={(e) => e.preventDefault()}
        >
          {status.kind === "loading" && (
            <div className="search__state" id={statusId} aria-live="polite">
              <Loader2 size={14} className="spin" aria-hidden="true" /> Searching India…
            </div>
          )}
          {status.kind === "empty" && (
            <div className="search__state" id={statusId} aria-live="polite">
              <MapPin size={14} aria-hidden="true" /> No places found for “{query.trim()}”. Try a locality or a nearby landmark.
            </div>
          )}
          {status.kind === "error" && (
            <div className="search__state search__state--error" id={statusId} role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{status.message}</span>
              <button type="button" className="search__retry" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw size={12} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {status.kind === "results" &&
            results.map((place, index) => {
              const context = formatPlaceContext(place);
              const isActive = index === active;
              return (
                <div
                  key={`${place.latitude},${place.longitude},${index}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  className={`search__option${isActive ? " is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(place);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <MapPin size={15} aria-hidden="true" className="search__option-icon" />
                  <span className="search__option-text">
                    <span className="search__option-name">{place.name}</span>
                    {context && <span className="search__option-context">{context}</span>}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
