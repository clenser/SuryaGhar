const STEPS = ["Location", "Select", "Validate", "Design", "Analyse", "Results"];

interface WorkflowStepperProps {
  /** Index of the current workflow step (0..5). Steps before it are complete. */
  step: number;
}

/**
 * Compact inline workflow stepper rendered at the top of the left stage panel.
 * It reports progress only; stage navigation lives in the stage tabs below.
 */
export function WorkflowStepper({ step }: WorkflowStepperProps) {
  return (
    <ol className="workflow" aria-label="Analysis workflow">
      {STEPS.map((name, index) => {
        const state = index === step ? " is-current" : index < step ? " is-complete" : "";
        return (
          <li key={name} className={`workflow__step${state}`} aria-current={index === step ? "step" : undefined}>
            <span className="workflow__index">{index + 1}</span>
            <span className="workflow__label">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}