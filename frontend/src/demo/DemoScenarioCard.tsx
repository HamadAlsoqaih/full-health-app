/**
 * TEMPORARY. Picks which sample-data story the demo shows, so every outcome of
 * the Body tab's on-track check can be seen without weeks of real logging.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { DEMO_SCENARIOS, getDemoScenario, resetDemoData, type DemoScenario } from './demoBackend';

export function DemoScenarioCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState<DemoScenario>(getDemoScenario);

  const choose = (id: DemoScenario) => {
    resetDemoData(id);
    setCurrent(id);
    // Every screen reads the swapped data, so every cached query is stale.
    void queryClient.invalidateQueries();
    toast.show('Sample data switched. Open the Body tab to see the result.', 'success');
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-text-muted">Demo scenario</h2>
          <p className="text-sm text-text-muted">
            Swaps the sample weigh-ins and meals for a cut at −0.5 kg/week. Switching resets
            anything you logged.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {DEMO_SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={current === s.id}
              onClick={() => choose(s.id)}
              className={[
                'flex min-h-touch items-center justify-between rounded-lg border px-3 text-left text-sm active:opacity-70',
                current === s.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface-raised text-text',
              ].join(' ')}
            >
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-text-muted">
                {s.ratePerWeekKg > 0 ? '+' : ''}
                {s.ratePerWeekKg} kg/week
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
