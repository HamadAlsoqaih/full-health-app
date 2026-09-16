/**
 * Premium placeholder.
 *
 * Non-functional on purpose: no payment gateway is integrated. The card is honest
 * about that rather than dangling a dead "Upgrade" button — tapping it says the
 * feature is not available yet instead of opening a checkout that does not exist.
 *
 * A fake purchase flow would be worse than no flow: it teaches the user the button
 * does nothing, and it is the kind of thing that ships to production by accident.
 */
import { useState } from 'react';
import { Card } from '@/shared/components/Field';

const FEATURES = [
  'Unlimited AI meal photo scans',
  'Deeper body-composition analysis and longer history',
  'Custom macro targets per day of the week',
  'Export your data',
];

export function PremiumUpsell() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between gap-3 text-left active:opacity-70"
      >
        <span className="flex flex-col">
          <span className="font-medium text-text">Full Health Premium</span>
          <span className="text-sm text-text-muted">Not available yet — a preview of plans</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-text-muted">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          <ul className="flex flex-col gap-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex gap-2 text-sm text-text-muted">
                <span aria-hidden="true" className="text-accent">
                  ·
                </span>
                {feature}
              </li>
            ))}
          </ul>

          <p className="rounded-lg bg-surface-raised p-3 text-xs text-text-muted">
            There is no paid plan yet and nothing here can be purchased. Everything in the app today
            is free to use.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
