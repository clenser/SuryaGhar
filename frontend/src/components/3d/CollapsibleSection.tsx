/**
 * CollapsibleSection - Reusable collapsible panel for the inspector
 *
 * Consistent with the existing Accordion pattern but designed for
 * the inspector's section stacking. Each section remembers its
 * open/closed state independently.
 *
 * AGENTS.md §48: professional, minimal, clear hierarchy.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  /** Section title */
  title: string;
  /** Optional icon */
  icon?: React.ReactNode;
  /** Whether the section is initially open */
  defaultOpen?: boolean;
  /** Unique ID for persistence */
  id: string;
  /** Children content */
  children: React.ReactNode;
  /** Optional badge/count */
  badge?: string | number;
  /** Optional action buttons in the header */
  actions?: React.ReactNode;
  /** Additional className */
  className?: string;
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  id,
  children,
  badge,
  actions,
  className = "",
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`collapsible-section${open ? " is-open" : " is-closed"} ${className}`} data-section-id={id}>
      <button
        type="button"
        className="collapsible-section__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`section-content-${id}`}
      >
        <div className="collapsible-section__title-group">
          {icon && <span className="collapsible-section__icon" aria-hidden="true">{icon}</span>}
          <span className="collapsible-section__title">{title}</span>
          {badge !== undefined && (
            <span className="collapsible-section__badge" aria-label={`${badge} items`}>
              {badge}
            </span>
          )}
        </div>
        <div
          className="collapsible-section__header-actions"
          onClick={(e) => {
            if (actions) e.stopPropagation();
          }}
        >
          {actions}
          <ChevronDown
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className={`collapsible-section__chevron${open ? " is-open" : ""}`}
          />
        </div>
      </button>
      <div
        id={`section-content-${id}`}
        className="collapsible-section__panel"
        role="region"
        aria-labelledby={`section-header-${id}`}
      >
        <div className="collapsible-section__content">{children}</div>
      </div>
    </section>
  );
}

export default CollapsibleSection;