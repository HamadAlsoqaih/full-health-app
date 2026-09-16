/**
 * The Overview tab's only data source.
 *
 * One endpoint, aggregated server-side (spec rule 5). OverviewDashboard must not
 * import any other feature's api module — the point is a single request and a
 * single consistent snapshot, not five requests stitched together on a phone.
 */
import type { OverviewSummary } from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export const overviewApi = (client: ApiClient) => ({
  /**
   * `date` is the caller's own calendar date. The server defaults to its UTC
   * date when it is omitted, which is the wrong day for anyone not in UTC.
   */
  summary: (date: string) =>
    client.get<OverviewSummary>(`/api/overview?date=${encodeURIComponent(date)}`),
});
