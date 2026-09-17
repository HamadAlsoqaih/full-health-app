/**
 * The follow-up questions, answered.
 *
 * These exist because a photograph does not contain what dominates the error in
 * a calorie estimate. Air-fried and deep-fried chicken look nearly identical
 * and differ by the oil the coating absorbed; a bucket shows its top layer only;
 * oil, butter and dressing are invisible. Two or three answers fix more than any
 * amount of better guessing at the pixels.
 *
 * The UX rules here are not decoration — each one is what keeps the feature from
 * being abandoned after a week:
 *
 * - **One card, not a wizard.** Three questions on one scrollable card, one
 *   button at the bottom. Separate screens per question would mean more taps and
 *   a back button that nobody knows the meaning of.
 * - **"Not sure" is a real option on every question.** Forcing a guess between
 *   air fried and deep fried produces WORSE data than an honest unknown, which
 *   the model answers with a midpoint and a lowered confidence. Bad data that
 *   looks confident is worse than stated uncertainty.
 * - **Skip is always there.** Some meals deserve five seconds, not thirty. A
 *   flow that demands three answers every time is a flow that stops being used.
 * - **Options are tap targets, not a dropdown.** One tap per question, no typing
 *   in the common case, 44px minimum.
 * - **The free-text box is collapsed.** Present when needed, invisible when not.
 */
import { useState } from 'react';
import type { ScanAnswer, ScanQuestion } from '@app/shared-types';
import { Button } from '@/shared/components/Field';

interface ScanQuestionsProps {
  questions: ScanQuestion[];
  /** Called with every question, answered or not, plus any free-text note. */
  onSubmit: (answers: ScanAnswer[], note: string) => void;
  onSkip: () => void;
  busy: boolean;
}

export function ScanQuestions({ questions, onSubmit, onSkip, busy }: ScanQuestionsProps) {
  /** Question id → chosen option. Absent means unanswered. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const answeredCount = Object.keys(chosen).length;

  const submit = () => {
    const answers: ScanAnswer[] = questions.map((question) => ({
      questionId: question.id,
      // Sent so the model reads the question rather than its slug.
      question: question.question,
      option: chosen[question.id] ?? null,
    }));
    onSubmit(answers, note);
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-text">A few things the photo cannot show</h3>
        <p className="text-xs text-text-muted">
          Answering these usually changes the estimate by more than anything else. Skip any you do
          not know.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {questions.map((question) => (
          <li key={question.id} className="flex flex-col gap-2">
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">{question.question}</legend>

              <div className="flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const selected = chosen[question.id] === option;
                  const isNotSure = option === 'Not sure';

                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setChosen((current) =>
                          // Tapping the chosen option again clears it, so a
                          // mis-tap is undoable without reloading the scan.
                          current[question.id] === option
                            ? Object.fromEntries(
                                Object.entries(current).filter(([id]) => id !== question.id),
                              )
                            : { ...current, [question.id]: option },
                        )
                      }
                      className={[
                        'min-h-touch rounded-lg border px-3 text-sm font-medium active:opacity-70',
                        selected
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border text-text',
                        // "Not sure" is deliberately not de-emphasised. It is a
                        // real answer, and making it look like a lesser option
                        // pushes people into guessing.
                        !selected && isNotSure ? 'text-text-muted' : '',
                      ].join(' ')}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ul>

      {noteOpen ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="scan-note" className="text-sm font-medium text-text">
            Anything else
          </label>
          <textarea
            id="scan-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. the rice had butter mixed through it"
            // 16px, or iOS zooms the viewport when this is focused.
            className="w-full rounded-lg border border-border bg-surface p-3 text-base text-text"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="min-h-touch self-start text-sm font-medium text-accent active:opacity-70"
        >
          Add details
        </button>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={submit} loading={busy}>
          {answeredCount === 0 && note.trim() === ''
            ? 'Update the estimate'
            : `Update the estimate (${answeredCount} answered)`}
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          Skip — use the first estimate
        </Button>
      </div>
    </div>
  );
}
