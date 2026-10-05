interface OnboardingCardProps {
  visible: boolean;
  step: number; // 0..5, current stage; steps before it are complete
  title: string;
  subtitle: string;
}

const STEPS = ["Location", "Select area", "Validate", "Design", "Analyse", "Results"];

/** Workflow status card: reflects the actual stage, not a hard-coded view. */
export function OnboardingCard({ visible, step, title, subtitle }: OnboardingCardProps) {
  return (
    <section className={`onboarding${visible ? " is-visible" : ""}`} aria-hidden={!visible} aria-label="Getting started">
      <h1 className="onboarding__title">{title}</h1>
      <p className="onboarding__body">{subtitle}</p>
      <ol className="workflow" aria-label="Analysis workflow">
        {STEPS.map((name, index) => (
          <li
            key={name}
            className={`workflow__step${index === step ? " is-current" : index < step ? " is-complete" : ""}`}
          >
            <span className="workflow__index">{index + 1}</span>
            <span>{name}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

