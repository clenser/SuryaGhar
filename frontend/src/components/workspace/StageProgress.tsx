import { Check } from "lucide-react";

export interface StageProgressStep {
  id: string;
  label: string;
  disabled: boolean;
}

interface StageProgressProps {
  steps: StageProgressStep[];
  currentId: string;
  onSelect: (id: string) => void;
}

/**
 * Five-stage workflow header: numbered circles, animated connectors, check
 * marks for completed stages. Buttons behave exactly like the previous
 * stage tabs (same disabled rules), only the presentation is richer.
 */
export function StageProgress({ steps, currentId, onSelect }: StageProgressProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === currentId),
  );
  return (
    <ol className="stage-progress" role="tablist" aria-label="Analysis stages">
      {steps.map((step, index) => {
        const state = index === currentIndex ? "current" : index < currentIndex ? "done" : "todo";
        return (
          <li key={step.id} className={`stage-progress__item stage-progress__item--${state}`}>
            <button
              type="button"
              role="tab"
              aria-selected={index === currentIndex}
              className="stage-progress__btn"
              disabled={step.disabled}
              onClick={() => onSelect(step.id)}
              aria-label={`${step.label}${state === "done" ? " (completed)" : state === "current" ? " (current)" : ""}`}
            >
              <span className="stage-progress__circle" aria-hidden="true">
                {state === "done" ? <Check size={13} strokeWidth={3} /> : <span>{index + 1}</span>}
              </span>
              <span className="stage-progress__label">{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <span
                className={`stage-progress__link${index < currentIndex ? " is-complete" : ""}`}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
