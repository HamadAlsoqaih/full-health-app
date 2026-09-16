/**
 * Weight over time. The Recharts implementation.
 *
 * Loaded lazily by TrendChart.tsx — see the note there. Charting is the single
 * heaviest dependency in the bundle and only one of five tabs renders it.
 *
 * Deliberate choices, because a weight chart is easy to make misleading:
 *
 *  - The y-axis is NOT forced to zero. A 2kg change on a 0–90kg axis is invisible,
 *    and the point of this chart is to make a real change legible. The axis is
 *    padded around the actual range instead.
 *  - Points are the latest entry per day, matching the trend engine, so the chart
 *    and the numbers beside it cannot disagree.
 *  - Colours come from the theme tokens via CSS variables, so the chart follows
 *    dark mode like everything else.
 */
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BodyMeasurement, UnitSystem } from '@app/shared-types';
import { kgToLb } from '@/shared/lib/units';

interface TrendChartProps {
  measurements: BodyMeasurement[];
  units: UnitSystem;
}

export default function TrendChartImpl({ measurements, units }: TrendChartProps) {
  const data = useMemo(() => {
    // Latest entry per day, the same rule the trend engine applies.
    const byDay = new Map<string, BodyMeasurement>();
    for (const m of measurements) {
      const existing = byDay.get(m.date);
      if (!existing || m.createdAt >= existing.createdAt) byDay.set(m.date, m);
    }

    return [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({
        date: m.date,
        weight: units === 'metric' ? m.weightKg : Number(kgToLb(m.weightKg).toFixed(1)),
      }));
  }, [measurements, units]);

  if (data.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        Log at least two weigh-ins to see a chart.
      </p>
    );
  }

  const values = data.map((d) => d.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Padded rather than zero-based, so a real change is actually visible.
  const pad = Math.max(0.5, (max - min) * 0.15);

  return (
    <div className="h-56 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--fh-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--fh-text-muted)', fontSize: 11 }}
            stroke="var(--fh-border)"
            // Only the first and last label: a month of dates will not fit.
            ticks={[data[0]?.date ?? '', data.at(-1)?.date ?? '']}
            tickFormatter={(value: string) =>
              new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })
            }
          />
          <YAxis
            domain={[Number((min - pad).toFixed(1)), Number((max + pad).toFixed(1))]}
            tick={{ fill: 'var(--fh-text-muted)', fontSize: 11 }}
            stroke="var(--fh-border)"
            width={44}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--fh-surface-raised)',
              border: '1px solid var(--fh-border)',
              borderRadius: 8,
              color: 'var(--fh-text)',
              fontSize: 12,
            }}
            // Recharts types the value loosely, so it is stringified rather
            // than asserted to a number.
            formatter={(value) => [
              `${String(value)} ${units === 'metric' ? 'kg' : 'lb'}`,
              'Weight',
            ]}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke="var(--fh-accent)"
            strokeWidth={2}
            dot={{ r: 2, fill: 'var(--fh-accent)' }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
