import { MapPin } from "lucide-react";

interface LocationCardProps {
  name: string;
  context: string;
  latitude: number;
  longitude: number;
}

/** Compact sidebar location card. "Change location" focuses the header search. */
export function LocationCard({ name, context, latitude, longitude }: LocationCardProps) {
  const focusSearch = () => {
    document.getElementById("location-search-input")?.focus();
  };

  return (
    <section className="location-card" aria-label="Location">
      <span className="location-card__icon" aria-hidden="true"><MapPin size={16} strokeWidth={1.75} /></span>
      <div className="location-card__text">
        <h2 className="location-card__name">{name}</h2>
        {context && <p className="location-card__context">{context}</p>}
        <p className="location-card__coords mono">
          Lat {latitude.toFixed(4)}, Lon {longitude.toFixed(4)}
        </p>
        <button type="button" className="location-card__change" onClick={focusSearch}>
          Change location
        </button>
      </div>
    </section>
  );
}
