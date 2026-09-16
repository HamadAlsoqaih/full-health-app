/** Overview data. One endpoint, one query (spec rule 5). */
import { useQuery } from '@tanstack/react-query';
import type { OverviewSummary } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { overviewApi } from '../api';

export function useOverview() {
  const { client } = useApi();
  return useQuery<OverviewSummary>({
    queryKey: queryKeys.overview,
    queryFn: () => overviewApi(client).summary(),
    // Short: this is the first thing seen on open and should reflect today.
    staleTime: 30_000,
  });
}
