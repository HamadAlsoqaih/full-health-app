/** Training endpoints. */
import type {
  Exercise,
  Routine,
  RoutineInput,
  WorkoutLog,
  WorkoutLogInput,
} from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export const trainingApi = (client: ApiClient) => ({
  exercises: (filter?: { muscleGroup?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (filter?.muscleGroup) params.set('muscleGroup', filter.muscleGroup);
    if (filter?.q) params.set('q', filter.q);
    const query = params.toString();
    return client.get<Exercise[]>(`/api/exercises${query ? `?${query}` : ''}`);
  },

  routines: () => client.get<Routine[]>('/api/routines'),
  createRoutine: (input: RoutineInput) => client.post<Routine>('/api/routines', input),
  updateRoutine: (id: string, patch: Partial<RoutineInput>) =>
    client.put<Routine>(`/api/routines/${id}`, patch),
  deleteRoutine: (id: string) => client.del(`/api/routines/${id}`),

  workoutLogs: () => client.get<WorkoutLog[]>('/api/workout-logs'),
  logWorkout: (input: WorkoutLogInput) => client.post<WorkoutLog>('/api/workout-logs', input),
});
