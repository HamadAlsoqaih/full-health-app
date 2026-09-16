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
  summary: () => client.get<OverviewSummary>('/api/overview'),
});
