import { MapPin, X } from "lucide-react";

interface SelectedPlaceCardProps {
  name: string;
  context: string;
  latitude: number;
  longitude: number;
  onClear: () => void;
}

export function SelectedPlaceCard({ name, context, latitude, longitude, onClear }: SelectedPlaceCardProps) {
  return (
    <section className="place-card" aria-label="Selected location">
      <span className="place-card__icon" aria-hidden="true"><MapPin size={16} strokeWidth={1.75} /></span>
      <div className="place-card__text">
        <h2 className="place-card__name">{name}</h2>
        {context && <p className="place-card__context">{context}</p>}
        <p className="place-card__coords mono">
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </p>
      </div>
      <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear location">
        <X size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </section>
  );
}
