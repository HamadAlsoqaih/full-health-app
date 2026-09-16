/**
 * Session state and the auth actions.
 *
 * This is the only place that writes the session, and the only place that submits
 * the held onboarding answers after signup. Feature screens never re-check auth —
 * AppRouter owns that decision entirely (spec §1).
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, Goals } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { authApi } from '../api';
import { clearDraft } from '../state/onboardingStore';
import { clear as clearOutbox } from '@/shared/lib/offlineQueue';

export function useMe(enabled: boolean) {
  const { client } = useApi();
  return useQuery<AuthUser>({
    queryKey: queryKeys.me,
    queryFn: () => authApi(client).me(),
    enabled,
    // The onboarding decision tree reads this, so a stale copy would route the
    // user to a step they already finished.
    staleTime: 0,
  });
}

export function useAuthActions() {
  const { client, sessions } = useApi();
  const queryClient = useQueryClient();
  const api = authApi(client);

  const login = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (result) => {
      sessions.set(result.session);
      queryClient.setQueryData(queryKeys.me, result.user);
    },
  });

  const register = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.register(email, password),
    onSuccess: (result) => {
      sessions.set(result.session);
      queryClient.setQueryData(queryKeys.me, result.user);
    },
  });

  const submitGoals = useMutation({
    mutationFn: (goals: Goals) => api.submitOnboarding(goals),
    onSuccess: (user) => queryClient.setQueryData(queryKeys.me, user),
  });

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // A failed server-side logout must not trap the user in the app; clearing
      // the local session is what actually signs them out of this device.
    }
    sessions.set(null);
    // Both hold health data and must not outlive the session on a shared device.
    clearDraft();
    await clearOutbox();
    queryClient.clear();
  }, [api, sessions, queryClient]);

  return { login, register, submitGoals, logout };
}
