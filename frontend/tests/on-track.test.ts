import { describe, expect, it } from 'vitest';
import type { BodyMeasurement, ComputedTrend, Goals } from '@app/shared-types';
import { macroTargets } from '@/shared/lib/macroTargets';
import {
  bodyInsights,
  loggingReliability,
  onTrackVerdict,
  startingTargets,
} from '@/features/body-composition/lib/onTrack';
import { formulaMaintenance } from '@/shared/lib/maintenanceFormula';

const cut: Goals = {
  goal: 'cut',
  targetCalories: 2200,
  targetProteinG: 170,
  targetRateKgPerWeek: -0.5,
};

/** One logged day per date from 16 Sep to 16 Oct 2026. */
function everyDay(calories: number, skip: (date: Date) => boolean = () => false) {
  const out: Array<{ date: string; calories: number }> = [];
  for (
    let t = Date.parse('2026-09-16T00:00:00Z');
    t <= Date.parse('2026-10-16T00:00:00Z');
    t += 86_400_000
  ) {
    const d = new Date(t);
    if (!skip(d)) out.push({ date: d.toISOString().slice(0, 10), calories });
  }
  return out;
}

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
    daysWithFoodLogs: 31,
    // What the server computes: intake − fitted rate × 7700 / 7.
    estimatedMaintenanceCalories: Math.round(avgDailyCalories - (ratePerWeekKg * 7700) / 7),
    dailyCalories: everyDay(avgDailyCalories),
    partialDays: [],
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
    // Goal: maintenance 1300 + 1.1 × 1100 = 2510, minus 550.
    expect(v.goal.calories).toBe(1950);
    // This week: at most 500 above the 1300 eaten now.
    expect(v.suggested.calories).toBe(1800);
    expect(v.weeksToGoal).toBe(2);
  });

  it('suggests eating less when losing too slowly', () => {
    const v = onTrackVerdict(trend(-0.2, 2280), cut);
    expect(v.status).toBe('too-slow');
    expect(v.suggested.calories).toBe(1950);
  });

  it('never suggests more than the target when gaining on a cut', () => {
    const v = onTrackVerdict(trend(0.35, 2800), cut);
    // Maintenance 2800 − 0.35 × 1100 = 2415, minus 550.
    expect(v.goal.calories).toBeLessThan(cut.targetCalories!);
    expect(v.goal.calories).toBe(1875);
    expect(v.suggested.calories).toBe(2300);
    expect(v.weeksToGoal).toBe(2);
  });

  it('flags a stall and a gain on a cut as going the wrong way', () => {
    expect(onTrackVerdict(trend(0), cut).title).toBe('Weight has stalled');
    expect(onTrackVerdict(trend(0.35), cut).title).toBe('Gaining instead of losing');
  });

  it('keeps a protein target inside 1.6–2.2 g/kg, otherwise uses 1.8', () => {
    // 170 g at 84 kg is 2.0 g/kg.
    expect(onTrackVerdict(trend(-0.5), cut).suggested.proteinG).toBe(170);
    expect(onTrackVerdict(trend(-0.5), { ...cut, targetProteinG: 100 }).suggested.proteinG).toBe(
      151,
    );
  });

  it('sets fat to 0.8 g/kg and carbs to the remainder', () => {
    const v = onTrackVerdict(trend(-0.5, 1950), cut);
    // 84 kg × 0.8 = 67 g fat; (1950 − 170×4 − 67×9) ÷ 4 = 167 g carbs.
    expect(v.suggested.fatG).toBe(67);
    expect(v.suggested.carbsG).toBe(167);
  });
});

function m(date: string, weightKg: number, bodyFatPct?: number, waist?: number): BodyMeasurement {
  return {
    id: date,
    clientId: date,
    date,
    weightKg,
    ...(bodyFatPct !== undefined ? { bodyFatPct } : {}),
    ...(waist !== undefined ? { tapeCm: { waist } } : {}),
    createdAt: `${date}T08:00:00Z`,
  };
}

describe('bodyInsights', () => {
  const texts = (t: ComputedTrend, ms: BodyMeasurement[]) =>
    bodyInsights(t, ms, onTrackVerdict(t, cut)).map((i) => i.text);

  it('warns when a large share of the loss is lean mass', () => {
    // 86 kg at 21% (18.1 kg fat) → 82 kg at 19.6% (16.1 kg fat): 2 kg of 4 kg was lean.
    const out = texts(trend(-1), [m('2026-09-16', 86, 21), m('2026-10-16', 82, 19.6)]);
    expect(out.some((t) => t.includes('lean mass, not fat'))).toBe(true);
  });

  it('spots recomposition: weight flat, waist down', () => {
    const out = texts(trend(0), [
      m('2026-09-16', 85, undefined, 92),
      m('2026-10-16', 85.2, undefined, 90),
    ]);
    expect(out.some((t) => t.includes('recomposition'))).toBe(true);
  });
});

describe('maintenance blend and starting targets', () => {
  it('leans on the formula while the trend is young', () => {
    // A 14-day trend counts half: (2510 + 2000) / 2.
    const young = { ...trend(-1.1, 1300), days: 14 };
    const v = onTrackVerdict(young, cut, { formulaMaintenance: 2000 });
    expect(v.blendWeight).toBe(0.5);
    expect(v.maintenanceCalories).toBe(2255);
  });

  it('ignores the formula once the trend is four weeks old', () => {
    const v = onTrackVerdict(trend(-1.1, 1300), cut, { formulaMaintenance: 2000 });
    expect(v.maintenanceCalories).toBe(v.measuredMaintenanceCalories);
  });

  it('computes Mifflin-St Jeor × activity for a new user', () => {
    const body = {
      heightCm: 178,
      birthYear: 1996,
      sex: 'male' as const,
      activityLevel: 'light' as const,
    };
    // 10×86 + 6.25×178 − 5×30 + 5 = 1827.5, × 1.375 = 2512.8.
    expect(formulaMaintenance(body, 86, new Date('2026-10-16'))).toBe(2513);
    expect(startingTargets(2513, 86, cut).targets.calories).toBe(1975);
  });
});

describe('loggingReliability', () => {
  it('is high for complete, plausible logs', () => {
    const t = trend(-0.5, 1950);
    expect(loggingReliability(t, 2500, 2500).level).toBe('high');
  });

  it('notices gaps that fall on Fridays and Saturdays', () => {
    const weekendGaps = everyDay(1950, (d) => d.getUTCDay() === 5 || d.getUTCDay() === 6);
    const t = {
      ...trend(-0.5, 1950),
      dailyCalories: weekendGaps,
      daysWithFoodLogs: weekendGaps.length,
    };
    const r = loggingReliability(t, 2500, 2500);
    expect(r.reasons.some((x) => x.includes('Fridays or Saturdays'))).toBe(true);
  });

  it('flags likely under-logging and widens the range', () => {
    const r = loggingReliability(trend(-0.5, 1300), 2500, 1850);
    expect(r.level).toBe('low');
    expect(r.rangeKcal).toBe(350);
  });

  it('warns when food was logged on fewer than ~4 days a week', () => {
    const sparse = { ...trend(-0.5), daysWithFoodLogs: 10 };
    const r = loggingReliability(sparse, undefined, 2500);
    expect(r.reasons.some((x) => x.includes('shaky'))).toBe(true);
  });
});
