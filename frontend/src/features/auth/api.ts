/** Auth endpoints. */
import type { AuthResult, AuthUser, Goals, UserUpdateInput } from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export const authApi = (client: ApiClient) => ({
  register: (email: string, password: string) =>
    client.post<AuthResult>('/api/auth/register', { email, password }, { anonymous: true }),

  login: (email: string, password: string) =>
    client.post<AuthResult>('/api/auth/login', { email, password }, { anonymous: true }),

  logout: () => client.post<void>('/api/auth/logout'),

  me: () => client.get<AuthUser>('/api/users/me'),

  updateMe: (patch: UserUpdateInput) => client.put<AuthUser>('/api/users/me', patch),

  submitOnboarding: (goals: Goals) => client.post<AuthUser>('/api/users/me/onboarding', { goals }),
});
