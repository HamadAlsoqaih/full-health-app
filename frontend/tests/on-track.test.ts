import { describe, expect, it } from 'vitest';
import type { ComputedTrend, Goals } from '@app/shared-types';
import { macroTargets } from '@/shared/lib/macroTargets';
import { onTrackVerdict } from '@/features/body-composition/lib/onTrack';

const cut: Goals = {
  goal: 'cut',
  targetCalories: 2200,
  targetProteinG: 170,
  targetRateKgPerWeek: -0.5,
};

function trend(ratePerWeekKg: number, avgDailyCalories = 2000): ComputedTrend {
  return {
    status: 'ok',
    fromDate: '2026-09-16',
    toDate: '2026-10-16',
    days: 30,
    startWeightKg: 86,
    endWeightKg: 84,
    weightChangeKg: -2,
    ratePerWeekKg,
    direction: ratePerWeekKg < 0 ? 'losing' : 'gaining',
    avgDailyCalories,
    avgDailyProteinG: 150,
    daysWithFoodLogs: 14,
    estimatedMaintenanceCalories: 2500,
    recommendation: {
      action: 'hold-calories',
      secondaryActions: [],
      calorieDeltaPerDay: 0,
      rationale: '',
    },
  };
}

describe('macroTargets', () => {
  it('gives fat 25% of calories and carbs the remainder', () => {
    // 2200 kcal: fat 550 kcal = 61 g; protein 680 kcal; carbs 2200-680-549 = 971 kcal = 243 g.
    expect(macroTargets(2200, 170)).toEqual({
      calories: 2200,
      proteinG: 170,
      carbsG: 243,
      fatG: 61,
    });
  });

  it('never returns negative carbs', () => {
    expect(macroTargets(1000, 250).carbsG).toBe(0);
  });
});

describe('onTrackVerdict', () => {
  it('is on track within 0.15 kg/week of the target, suggesting actual intake', () => {
    const v = onTrackVerdict(trend(-0.45, 1950), cut);
    expect(v.status).toBe('on-track');
    expect(v.suggested.calories).toBe(1950);
  });

  it('suggests eating more when losing too fast', () => {
    const v = onTrackVerdict(trend(-1.1, 1300), cut);
    expect(v.status).toBe('too-fast');
    // Maintenance 2500 − 550 for −0.5 kg/week.
    expect(v.suggested.calories).toBe(1950);
  });

  it('suggests eating less when losing too slowly', () => {
    const v = onTrackVerdict(trend(-0.2, 2280), cut);
    expect(v.status).toBe('too-slow');
    expect(v.suggested.calories).toBe(1950);
  });

  it('never suggests more than the target when gaining on a cut', () => {
    const v = onTrackVerdict(trend(0.35, 2800), cut);
    expect(v.suggested.calories).toBeLessThan(cut.targetCalories!);
    expect(v.suggested.calories).toBe(1950);
  });

  it('flags a stall and a gain on a cut as going the wrong way', () => {
    expect(onTrackVerdict(trend(0), cut).title).toBe('Weight has stalled');
    expect(onTrackVerdict(trend(0.35), cut).title).toBe('Gaining instead of losing');
  });

  it('keeps a protein target above the 1.6 g/kg floor', () => {
    expect(onTrackVerdict(trend(-0.5), cut).suggested.proteinG).toBe(170);
    expect(onTrackVerdict(trend(-0.5), { ...cut, targetProteinG: 100 }).suggested.proteinG).toBe(
      134,
    );
  });
});
