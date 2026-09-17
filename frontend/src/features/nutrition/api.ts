/** Nutrition endpoints. */
import type {
  CustomFood,
  CustomFoodInput,
  FoodLogEntry,
  FoodLogInput,
  NutritionSearchResult,
  PhotoRefineResult,
  PhotoScanResult,
  ScanAnswer,
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

  /**
   * Second pass: the same photo, with the follow-up questions answered.
   *
   * The file is uploaded again rather than held server-side between calls, which
   * is what keeps the never-persisted guarantee intact — the browser still has
   * it. Telling the model "8 pieces" is only useful if it can look at the bucket
   * while recalculating, so a text-only second pass was not an option.
   */
  refineScan: (
    file: File,
    input: { previousEstimateId: string; answers: ScanAnswer[]; note?: string },
  ) => {
    const formData = new FormData();
    formData.append('photo', file);
    // One JSON field, because the photo makes this multipart regardless.
    formData.append('answers', JSON.stringify(input));
    return client.request<PhotoRefineResult>('/api/nutrition/scan-photo/refine', {
      method: 'POST',
      formData,
    });
  },
});
