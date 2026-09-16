/**
 * Lazy boundary around the weight chart.
 *
 * Recharts is by far the heaviest dependency in the app, and exactly one of the
 * five tabs renders a chart. Loading it eagerly put the initial bundle over 800kB
 * — a real cost on mobile data, and the first thing a user pays before seeing
 * anything at all.
 *
 * Splitting it here means the chart arrives when the Body tab is opened, behind a
 * placeholder that reserves the same height so nothing jumps when it lands.
 */
import { Suspense, lazy } from 'react';
import type { BodyMeasurement, UnitSystem } from '@app/shared-types';

const TrendChartImpl = lazy(() => import('./TrendChartImpl'));

interface TrendChartProps {
  measurements: BodyMeasurement[];
  units: UnitSystem;
}

export function TrendChart(props: TrendChartProps) {
  return (
    <Suspense
      fallback={
        // Same height as the chart, so the card does not resize on arrival.
        <div
          role="status"
          aria-label="Loading chart"
          className="h-56 w-full animate-pulse rounded-lg bg-surface-raised"
        />
      }
    >
      <TrendChartImpl {...props} />
    </Suspense>
  );
}
