/** Nutrition endpoints. */
import type {
  CustomFood,
  CustomFoodInput,
  FoodLogEntry,
  FoodLogInput,
  NutritionSearchResult,
  PhotoScanResult,
} from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export const nutritionApi = (client: ApiClient) => ({
  search: (query: string, signal?: AbortSignal) =>
    client.request<NutritionSearchResult>(
      `/api/nutrition/search?q=${encodeURIComponent(query)}`,
      signal ? { signal } : {},
    ),

  customFoods: () => client.get<CustomFood[]>('/api/nutrition/custom-foods'),
  createCustomFood: (input: CustomFoodInput) =>
    client.post<CustomFood>('/api/nutrition/custom-foods', input),

  dailyLog: (date: string) => client.get<FoodLogEntry[]>(`/api/nutrition/log?date=${date}`),
  logFood: (input: FoodLogInput) => client.post<FoodLogEntry>('/api/nutrition/log', input),
  deleteLogEntry: (id: string) => client.del(`/api/nutrition/log/${id}`),

  /**
   * Synchronous, and takes a few seconds — the caller shows a spinner.
   * The result is NEVER logged automatically: the user confirms it first.
   */
  scanPhoto: (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return client.request<PhotoScanResult>('/api/nutrition/scan-photo', {
      method: 'POST',
      formData,
    });
  },
});
