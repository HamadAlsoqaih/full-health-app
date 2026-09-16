/**
 * Tests for the deterministic trend engine.
 *
 * This is the app's only real algorithm, and the one place a silent arithmetic
 * error would produce confident, plausible, wrong health advice. So these tests
 * assert the numbers, not merely that a result came back.
 */
import { describe, expect, it } from 'vitest';
import type { BodyMeasurement, FoodLogEntry, Goals } from '@app/shared-types';
import {
  THRESHOLDS,
  computeTrend,
  latestPerDay,
  weeklyRate,
} from '../../src/services/body-composition/trend-rules.js';

const NOW = new Date('2026-03-01T12:00:00Z');

/** Days before NOW, as a calendar date. */
const dayBefore = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

function measurement(daysAgo: number, weightKg: number, createdAtSuffix = '00'): BodyMeasurement {
  const date = dayBefore(daysAgo);
  return {
    id: `m-${daysAgo}-${createdAtSuffix}`,
    clientId: `c-${daysAgo}-${createdAtSuffix}`,
    date,
    weightKg,
    createdAt: `${date}T10:${createdAtSuffix}:00.000Z`,
  };
}

function foodDay(daysAgo: number, calories: number, proteinG = 100): FoodLogEntry {
  const date = dayBefore(daysAgo);
  return {
    id: `f-${daysAgo}`,
    clientId: `fc-${daysAgo}`,
    date,
    foodItemId: 'manual:',
    foodName: 'Test food',
    source: 'manual',
    servingLabel: '1 serving',
    servingMultiplier: 1,
    baseCalories: calories,
    baseProteinG: proteinG,
    baseCarbsG: 0,
    baseFatG: 0,
    calories,
    proteinG,
    carbsG: 0,
    fatG: 0,
    loggedAt: `${date}T20:00:00.000Z`,
  };
}

/**
 * A 28-day window of daily weigh-ins losing a steady 0.5 kg/week, fully logged.
 *
 * Protein is 150 g against a finishing weight of ~88 kg, i.e. above the 1.6 g/kg
 * floor — otherwise the engine would (correctly) lead with protein advice and these
 * fixtures would not isolate the calorie logic.
 */
function steadyCut(): { measurements: BodyMeasurement[]; foodLog: FoodLogEntry[] } {
  const measurements: BodyMeasurement[] = [];
  const foodLog: FoodLogEntry[] = [];
  for (let d = 28; d >= 0; d -= 1) {
    const elapsed = 28 - d;
    measurements.push(measurement(d, 90 - (0.5 / 7) * elapsed));
    foodLog.push(foodDay(d, 2000, 150));
  }
  return { measurements, foodLog };
}

describe('latestPerDay', () => {
  it('keeps the most recently recorded entry for a day, not the lowest weight', () => {
    // Deliberately out of order, and the later record is the heavier one.
    const rows = [
      measurement(3, 80.1, '30'),
      measurement(3, 80.9, '45'),
      measurement(2, 80.5, '10'),
    ];
    const result = latestPerDay(rows);

    expect(result).toHaveLength(2);
    expect(result[0]?.weightKg).toBe(80.9);
    expect(result.map((r) => r.date)).toEqual([dayBefore(3), dayBefore(2)]);
  });

  it('returns entries sorted by date ascending', () => {
    const result = latestPerDay([measurement(1, 80), measurement(10, 82), measurement(5, 81)]);
    expect(result.map((r) => r.date)).toEqual([dayBefore(10), dayBefore(5), dayBefore(1)]);
  });
});

describe('weeklyRate', () => {
  it('returns 0 for a single point rather than dividing by zero', () => {
    expect(weeklyRate([measurement(0, 80)])).toBe(0);
  });

  it('returns 0 when every entry is on the same day (no time span)', () => {
    expect(weeklyRate([measurement(0, 80, '10'), measurement(0, 81, '20')])).toBe(0);
  });

  it('recovers a known slope', () => {
    // Exactly -1 kg per week over four weeks.
    const points = [0, 7, 14, 21, 28].map((d) => measurement(28 - d, 90 - d / 7));
    expect(weeklyRate(points)).toBeCloseTo(-1, 6);
  });

  it('is robust to a single noisy weigh-in, unlike endpoint differencing', () => {
    const clean = [0, 7, 14, 21, 28].map((d) => measurement(28 - d, 90 - d / 7));
    // Spike the final day by 1.5kg, as water retention would.
    const noisy = [...clean.slice(0, -1), measurement(0, 86 + 1.5)];

    const endpointEstimate = ((noisy.at(-1)!.weightKg - noisy[0]!.weightKg) / 28) * 7;
    const regression = weeklyRate(noisy);

    // The regression stays nearer the true -1 than naive endpoint differencing.
    expect(Math.abs(regression - -1)).toBeLessThan(Math.abs(endpointEstimate - -1));
  });
});

describe('computeTrend — insufficient data', () => {
  it('reports insufficient data for a brand new user with nothing logged', () => {
    const result = computeTrend({ measurements: [], foodLog: [], now: NOW, windowDays: 30 });

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') throw new Error('unreachable');
    expect(result.reasons).toContain('not-enough-weight-entries');
    expect(result.reasons).toContain('span-too-short');
    expect(result.reasons).toContain('not-enough-food-logs');
    expect(result.weightEntryCount).toBe(0);
    expect(result.daysWithFoodLogs).toBe(0);
  });

  it('refuses a span shorter than the minimum even with plenty of entries', () => {
    const measurements = Array.from({ length: 8 }, (_, i) => measurement(i, 90 - i * 0.1));
    const foodLog = Array.from({ length: 8 }, (_, i) => foodDay(i, 2000));

    const result = computeTrend({ measurements, foodLog, now: NOW, windowDays: 30 });

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') throw new Error('unreachable');
    expect(result.reasons).toContain('span-too-short');
    expect(result.reasons).not.toContain('not-enough-weight-entries');
    expect(result.daysNeeded).toBeGreaterThan(0);
  });

  it('refuses when weight is logged but food is not — the garbage-in case', () => {
    // 30 days of weigh-ins, zero food logged.
    const measurements = Array.from({ length: 30 }, (_, i) => measurement(i, 90 - i * 0.05));

    const result = computeTrend({ measurements, foodLog: [], now: NOW, windowDays: 30 });

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') throw new Error('unreachable');
    expect(result.reasons).toEqual(['not-enough-food-logs']);
    expect(result.daysNeeded).toBe(THRESHOLDS.minDaysWithFoodLogs);
  });

  it('counts only entries inside the window', () => {
    // Ample history, but all of it older than the 30-day window.
    const measurements = Array.from({ length: 20 }, (_, i) => measurement(60 + i, 95));
    const foodLog = Array.from({ length: 20 }, (_, i) => foodDay(60 + i, 2000));

    const result = computeTrend({ measurements, foodLog, now: NOW, windowDays: 30 });

    expect(result.status).toBe('insufficient-data');
    if (result.status !== 'insufficient-data') throw new Error('unreachable');
    expect(result.weightEntryCount).toBe(0);
  });
});

describe('computeTrend — a steady cut', () => {
  const { measurements, foodLog } = steadyCut();
  const goals: Goals = { goal: 'cut', targetRateKgPerWeek: -0.5 };
  const result = computeTrend({ measurements, foodLog, goals, now: NOW, windowDays: 30 });

  it('computes the window, direction and rate', () => {
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');

    expect(result.days).toBe(28);
    expect(result.direction).toBe('losing');
    expect(result.ratePerWeekKg).toBeCloseTo(-0.5, 2);
    expect(result.weightChangeKg).toBeCloseTo(-2, 1);
    expect(result.daysWithFoodLogs).toBe(29);
  });

  it('averages intake over days that have food logged', () => {
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.avgDailyCalories).toBe(2000);
    expect(result.avgDailyProteinG).toBe(150);
  });

  it('estimates maintenance above intake while losing weight', () => {
    if (result.status !== 'ok') throw new Error('unreachable');
    // Losing 2kg over 28 days is a deficit of 2 x 7700 / 28 = 550 kcal/day,
    // so maintenance is intake + 550.
    expect(result.estimatedMaintenanceCalories).toBe(2550);
  });

  it('holds calories when the rate already matches the target', () => {
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.action).toBe('hold-calories');
    expect(result.recommendation.calorieDeltaPerDay).toBe(0);
  });
});

describe('computeTrend — recommendations', () => {
  it('tells a bulking user who is losing weight to eat more', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 80 - (0.4 / 7) * (28 - d)));
      foodLog.push(foodDay(d, 2200, 160));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'bulk', targetRateKgPerWeek: 0.25 },
      now: NOW,
      windowDays: 30,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.action).toBe('increase-calories');
    expect(result.recommendation.calorieDeltaPerDay).toBeGreaterThan(0);
  });

  it('tells a cutting user who is gaining to eat less', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 80 + (0.3 / 7) * (28 - d)));
      foodLog.push(foodDay(d, 3000, 170));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'cut' },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.action).toBe('reduce-calories');
    expect(result.recommendation.calorieDeltaPerDay).toBeLessThan(0);
  });

  it('never suggests a change beyond the safety clamp', () => {
    // Absurd rate: 3 kg/week gain against a cut target.
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 80 + (3 / 7) * (28 - d)));
      foodLog.push(foodDay(d, 5000, 200));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'cut', targetRateKgPerWeek: -0.5 },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.calorieDeltaPerDay).toBe(-500);
  });

  it('rounds any suggested change to 25 kcal, not a false-precision figure', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 80 - (0.37 / 7) * (28 - d)));
      foodLog.push(foodDay(d, 2150, 150));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'bulk', targetRateKgPerWeek: 0.25 },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.calorieDeltaPerDay % 25).toBe(0);
  });

  it('flags low protein even when the weight trend is on target', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 90 - (0.5 / 7) * (28 - d)));
      // 60g for a ~88kg user is well under the 1.6 g/kg floor.
      foodLog.push(foodDay(d, 2000, 60));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'cut', targetRateKgPerWeek: -0.5 },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.action).toBe('increase-protein');
    expect(result.recommendation.proteinTargetG).toBeGreaterThan(130);
    // Protein advice must not smuggle in a calorie change.
    expect(result.recommendation.calorieDeltaPerDay).toBe(0);
  });

  it('asks for more consistent logging when the window is sparsely logged', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 90 - (0.5 / 7) * (28 - d)));
      // Only every third day logged: passes the minimum, still thin.
      if (d % 3 === 0) foodLog.push(foodDay(d, 2000, 150));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'cut', targetRateKgPerWeek: -0.5 },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.recommendation.secondaryActions).toContain('log-more-consistently');
  });

  it('defaults to a maintain target when no goals are set', () => {
    const { measurements, foodLog } = steadyCut();
    const result = computeTrend({ measurements, foodLog, now: NOW, windowDays: 30 });

    if (result.status !== 'ok') throw new Error('unreachable');
    // Losing 0.5 kg/week against an implicit maintain target of 0 is drift upward
    // in intake terms, so the advice is to eat more.
    expect(result.recommendation.action).toBe('increase-calories');
  });

  it('reports holding when weight is flat', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      measurements.push(measurement(d, 80));
      foodLog.push(foodDay(d, 2500, 150));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'maintain' },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.direction).toBe('holding');
    expect(result.ratePerWeekKg).toBe(0);
    // Flat weight means intake already equals maintenance.
    expect(result.estimatedMaintenanceCalories).toBe(2500);
    expect(result.recommendation.action).toBe('hold-calories');
  });

  it('collapses duplicate same-day entries before computing', () => {
    const measurements: BodyMeasurement[] = [];
    const foodLog: FoodLogEntry[] = [];
    for (let d = 28; d >= 0; d -= 1) {
      const w = 90 - (0.5 / 7) * (28 - d);
      measurements.push(measurement(d, w + 5, '05'));
      // Recorded later, so this is the one that counts.
      measurements.push(measurement(d, w, '45'));
      foodLog.push(foodDay(d, 2000, 150));
    }

    const result = computeTrend({
      measurements,
      foodLog,
      goals: { goal: 'cut', targetRateKgPerWeek: -0.5 },
      now: NOW,
      windowDays: 30,
    });

    if (result.status !== 'ok') throw new Error('unreachable');
    // The +5kg decoys would wreck the rate had they not been collapsed away.
    expect(result.ratePerWeekKg).toBeCloseTo(-0.5, 2);
    expect(result.endWeightKg).toBeCloseTo(90 - 2, 1);
  });
});
