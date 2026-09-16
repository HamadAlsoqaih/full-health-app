/**
 * Wire types shared by frontend and backend — the single source of truth.
 * Backend-only fields extend these in backend/src/models/.
 * Filled in by task #2; the placeholder keeps the workspace typecheckable.
 */
export type ApiErrorCode = string;

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}
