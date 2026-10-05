import { useState } from "react";
import { RotateCcw } from "lucide-react";

interface ResetControlProps {
  /** True when any selection/analysis state exists worth confirming over. */
  hasData: boolean;
  onReset: () => void;
}

/** Secondary, non-primary workspace reset with inline confirmation. */
export function ResetControl({ hasData, onReset }: ResetControlProps) {
  const [confirming, setConfirming] = useState(false);

  const commit = () => {
    setConfirming(false);
    onReset();
  };

  if (confirming) {
    return (
      <div className="reset-confirm" role="alertdialog" aria-label="Confirm reset">
        <p className="reset-confirm__title">Reset analysis?</p>
        <p className="reset-confirm__body">This will clear the current selection and analysis results.</p>
        <div className="reset-confirm__actions">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--subtle-danger" onClick={commit} autoFocus>
            Reset
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-row">
      <button
        type="button"
        className="btn btn--subtle"
        aria-label="Reset analysis"
        onClick={() => {
          if (hasData) setConfirming(true);
          else onReset();
        }}
      >
        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
        Reset
      </button>
    </div>
  );
}
