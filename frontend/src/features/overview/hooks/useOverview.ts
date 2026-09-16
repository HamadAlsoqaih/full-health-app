/** Overview data. One endpoint, one query (spec rule 5). */
import { useQuery } from '@tanstack/react-query';
import type { OverviewSummary } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { todayIso } from '@/shared/lib/dates';
import { overviewApi } from '../api';

export function useOverview() {
  const { client } = useApi();
  // Part of the key, so the cached summary is not reused across midnight — the
  // app is usually resumed rather than reloaded, so the day can change under it.
  const date = todayIso();

  return useQuery<OverviewSummary>({
    queryKey: queryKeys.overviewFor(date),
    queryFn: () => overviewApi(client).summary(date),
    // Short: this is the first thing seen on open and should reflect today.
    staleTime: 30_000,
  });
}
