/**
 * One-time exercise seed from Free Exercise DB (public domain, ~876 exercises).
 *
 * Run with:
 *   npm run seed:exercises --workspace backend            (writes to Supabase)
 *   npm run seed:exercises --workspace backend -- --dry-run  (parses only, no DB)
 *
 * --dry-run needs no credentials and no database, which is what makes the parsing
 * and URL construction verifiable in an environment that has neither.
 *
 * Media is stored as a URL string, never as binary in the database or committed to
 * the repository (spec rule 9). The upstream `images` array holds repo-relative
 * paths, so the raw-content base below is prepended.
 */
import { upsertExercises } from '../repositories/supabase/admin-writes.js';
import type { Exercise, ExerciseCategory, ExerciseLevel, MuscleGroup } from '@app/shared-types';

const DATA_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const MEDIA_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

/** The upstream record, as published. Every field is treated as optional. */
interface UpstreamExercise {
  id?: string;
  name?: string;
  force?: string | null;
  level?: string;
  mechanic?: string | null;
  equipment?: string | null;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  instructions?: string[];
  category?: string;
  images?: string[];
}

const MUSCLE_GROUPS = new Set<string>([
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
]);

const CATEGORIES = new Set<string>([
  'strength',
  'stretching',
  'plyometrics',
  'strongman',
  'powerlifting',
  'cardio',
  'olympic weightlifting',
]);

const LEVELS = new Set<string>(['beginner', 'intermediate', 'expert']);

export interface SeedRecord extends Omit<Exercise, 'id'> {
  externalId: string;
}

export interface MapResult {
  records: SeedRecord[];
  /** Records dropped because they could not be mapped, with the reason. */
  skipped: Array<{ id: string; reason: string }>;
  /** Mapped but with no image, so the UI needs a placeholder. */
  withoutMedia: string[];
}

/**
 * Maps upstream records to seed rows, dropping anything unusable.
 *
 * Unknown muscle groups, categories and levels are treated as fatal for that
 * record rather than coerced to a default: a squat filed under the wrong muscle
 * group is worse than a squat that is missing.
 */
export function mapExercises(raw: unknown): MapResult {
  const input: UpstreamExercise[] = Array.isArray(raw) ? (raw as UpstreamExercise[]) : [];
  const records: SeedRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const withoutMedia: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    const externalId = item.id?.trim();
    const name = item.name?.trim();

    if (!externalId || !name) {
      skipped.push({ id: externalId ?? '(no id)', reason: 'missing id or name' });
      continue;
    }
    if (seen.has(externalId)) {
      skipped.push({ id: externalId, reason: 'duplicate id' });
      continue;
    }

    const primary = item.primaryMuscles?.[0];
    if (!primary || !MUSCLE_GROUPS.has(primary)) {
      skipped.push({ id: externalId, reason: `unknown muscle group "${primary ?? ''}"` });
      continue;
    }
    if (!item.category || !CATEGORIES.has(item.category)) {
      skipped.push({ id: externalId, reason: `unknown category "${item.category ?? ''}"` });
      continue;
    }
    if (!item.level || !LEVELS.has(item.level)) {
      skipped.push({ id: externalId, reason: `unknown level "${item.level ?? ''}"` });
      continue;
    }

    const firstImage = item.images?.find((i) => typeof i === 'string' && i.length > 0);
    if (!firstImage) withoutMedia.push(externalId);

    seen.add(externalId);
    records.push({
      externalId,
      name,
      muscleGroup: primary as MuscleGroup,
      // Filtered rather than mapped: an unrecognised secondary muscle is dropped,
      // which loses a detail, whereas an unrecognised primary loses the record.
      secondaryMuscles: (item.secondaryMuscles ?? []).filter((m): m is MuscleGroup =>
        MUSCLE_GROUPS.has(m),
      ),
      category: item.category as ExerciseCategory,
      level: item.level as ExerciseLevel,
      instructions: (item.instructions ?? []).map((i) => i.trim()).filter(Boolean),
      ...(item.equipment ? { equipment: item.equipment } : {}),
      ...(firstImage ? { mediaUrl: `${MEDIA_BASE}/${firstImage}` } : {}),
    });
  }

  return { records, skipped, withoutMedia };
}

export async function fetchUpstream(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<unknown> {
  const response = await fetchImpl(DATA_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Free Exercise DB responded ${response.status}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`Fetching ${DATA_URL}`);
  const raw = await fetchUpstream();

  const { records, skipped, withoutMedia } = mapExercises(raw);

  console.log(`Parsed ${records.length} exercises.`);
  if (withoutMedia.length > 0) {
    console.log(
      `${withoutMedia.length} have no image and will fall back to a placeholder: ${withoutMedia.join(', ')}`,
    );
  }
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s.id}: ${s.reason}`);
  }

  if (records.length === 0) {
    throw new Error(
      'Refusing to continue: nothing was parsed. The upstream format may have changed.',
    );
  }

  if (dryRun) {
    const sample = records[0];
    console.log('\nDry run — nothing was written. First record:');
    console.log(JSON.stringify(sample, null, 2));
    return;
  }

  // Chunked: a single upsert of ~900 rows with array columns and long instruction
  // text is large enough to be worth splitting.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    written += await upsertExercises(chunk);
    console.log(`Upserted ${Math.min(i + CHUNK, records.length)}/${records.length}`);
  }
  console.log(`Done. ${written} exercises upserted (idempotent on external_id).`);
}

// Only runs when executed directly, so the mapping functions stay importable
// from a test without triggering a network call.
if (process.argv[1]?.includes('seed-exercises')) {
  main().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
}
