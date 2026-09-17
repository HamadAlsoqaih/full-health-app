/**
 * Meal photo → calorie estimate.
 *
 * The rule this component exists to enforce: **the estimate is never logged
 * automatically** (spec rule 3). The scan returns numbers, the user sees them,
 * adjusts the serving if the model misjudged the portion, and only then logs. An
 * AI guess written silently into a food diary would corrupt the trend analysis
 * that diary feeds.
 *
 * Also honest about what it is: confidence is shown prominently, the detected
 * items are listed so the user can see whether the model understood the photo at
 * all, and the copy says "estimate".
 *
 * Online-only, unavoidably — it needs the model.
 */
import { useRef, useState } from 'react';
import type { PhotoScanResult } from '@app/shared-types';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { useApi } from '@/shared/lib/ApiProvider';
import { Button, Card, NumberField } from '@/shared/components/Field';
import { ErrorState } from '@/shared/components/ErrorState';
import { useToast } from '@/shared/components/Toast';
import { nutritionApi } from '../api';
import { useLogFood } from '../hooks/useDailyLog';
import { todayIso } from '@/shared/lib/dates';

const MAX_BYTES = 8 * 1024 * 1024;

interface PhotoScanProps {
  onDone: () => void;
}

export function PhotoScan({ onDone }: PhotoScanProps) {
  const { client } = useApi();
  const toast = useToast();
  const logFood = useLogFood(todayIso());
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<PhotoScanResult | null>(null);
  const [multiplier, setMultiplier] = useState('1');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /**
   * The chosen photo, kept so a failure does not cost the user the photo.
   *
   * Previously only a preview URL was held, and Retry reopened the file picker
   * — so a scan that failed because Google was momentarily busy made you find
   * and select your lunch photo again. The file is already in the page; there is
   * no reason to ask for it twice.
   *
   * It stays in the browser. The server holds it only for the length of one
   * request and never writes it anywhere.
   */
  const [file, setFile] = useState<File | null>(null);

  const scan = async (chosen: File) => {
    // Checked client-side too, so the user is not made to upload 12MB over mobile
    // data before being told it is too large.
    if (chosen.size > MAX_BYTES) {
      setError(
        new ApiRequestError(413, 'PAYLOAD_TOO_LARGE', 'That image is too large. Try another.'),
      );
      return;
    }

    setError(undefined);
    setBusy(true);
    setResult(null);
    setFile(chosen);

    // Local preview only; the file is never uploaded anywhere but the scan call.
    const url = URL.createObjectURL(chosen);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    try {
      setResult(await nutritionApi(client).scanPhoto(chosen));
      setMultiplier('1');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  /** Re-sends the photo already on screen. Only falls back to the picker if
   *  there somehow isn't one — an oversized file, say, which was never kept. */
  const retry = () => {
    if (file) void scan(file);
    else inputRef.current?.click();
  };

  const confirm = async () => {
    if (!result) return;
    const parsed = Number.parseFloat(multiplier);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    try {
      // Goes through the ordinary log endpoint: the server re-resolves the macros
      // from the stored estimate rather than trusting numbers sent back.
      await logFood.mutateAsync({
        foodItemId: result.estimate.id,
        date: todayIso(),
        servingMultiplier: parsed,
      });
      toast.show('Logged.', 'success');
      onDone();
    } catch {
      toast.show('Could not log that. Try again.', 'error');
    }
  };

  const servings = Number.parseFloat(multiplier) || 0;
  const scaled = (value: number) => Math.round(value * servings);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">Scan a meal</h2>
        <p className="text-sm text-text-muted">
          Take a photo and we will estimate the calories. You confirm before anything is logged.
        </p>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone rather than the file browser.
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void scan(file);
          // Reset, so picking the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      {previewUrl ? (
        <img
          src={previewUrl}
          alt="The meal you photographed"
          className="max-h-64 w-full rounded-lg object-cover"
        />
      ) : null}

      {!result && !busy ? (
        <Button onClick={() => inputRef.current?.click()}>Take or choose a photo</Button>
      ) : null}

      {busy ? (
        <Card>
          <p role="status" aria-live="polite" className="text-sm text-text-muted">
            Analysing your photo… this takes a few seconds.
          </p>
        </Card>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-2">
          <ErrorState error={error} onRetry={retry} />
          {file ? (
            <Button variant="ghost" onClick={() => inputRef.current?.click()}>
              Use a different photo
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-text">{result.estimate.name}</p>
                <span
                  className={[
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                    result.confidence === 'medium'
                      ? 'border-warning/40 text-warning'
                      : 'border-border text-text-muted',
                  ].join(' ')}
                >
                  {result.confidence} confidence
                </span>
              </div>

              {result.detectedItems.length > 0 ? (
                <p className="text-sm text-text-muted">
                  Detected: {result.detectedItems.join(', ')}
                </p>
              ) : null}

              <p className="text-xs text-text-muted">
                This is an estimate. Adjust the servings or edit it after logging if it looks wrong.
              </p>
            </div>

            <NumberField
              label="Servings"
              hint={`One serving is ${result.estimate.servingLabel}.`}
              value={multiplier}
              onChange={(event) => setMultiplier(event.target.value)}
            />

            <dl className="grid grid-cols-4 gap-2 rounded-lg bg-surface-raised p-3 text-center">
              {[
                ['kcal', scaled(result.estimate.calories)],
                ['Protein', scaled(result.estimate.proteinG)],
                ['Carbs', scaled(result.estimate.carbsG)],
                ['Fat', scaled(result.estimate.fatG)],
              ].map(([label, value]) => (
                <div key={label as string} className="flex flex-col">
                  <dt className="text-xs text-text-muted">{label as string}</dt>
                  <dd className="font-semibold text-text">{value as number}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-2">
              <Button onClick={() => void confirm()} loading={logFood.isPending}>
                Log this
              </Button>
              <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                Retake photo
              </Button>
              <Button variant="ghost" onClick={onDone}>
                Discard
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
