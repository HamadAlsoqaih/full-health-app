/** Body-composition endpoints. */
import type {
  BodyCompEvaluation,
  BodyMeasurement,
  BodyMeasurementInput,
  TrendResult,
} from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export const bodyCompositionApi = (client: ApiClient) => ({
  list: () => client.get<BodyMeasurement[]>('/api/body-composition'),

  createEntry: (input: BodyMeasurementInput) =>
    client.post<BodyMeasurement>('/api/body-composition/entry', input),

  /** Deterministic arithmetic; never AI. */
  trend: (days = 30) => client.get<TrendResult>(`/api/body-composition/trend?days=${days}`),

  /** Polled while an evaluation is pending; the server re-fires a stale one. */
  evaluation: () => client.get<BodyCompEvaluation>('/api/body-composition/evaluation'),
});
