/**
 * STUB — the future AI guide.
 *
 * Returns a disabled state rather than throwing, so a caller added later fails
 * visibly in review instead of at runtime. No conversation logic exists yet.
 */
export interface MascotState {
  enabled: false;
  reason: string;
}

export function useMascot(): MascotState {
  return { enabled: false, reason: 'The AI guide is not implemented yet.' };
}
