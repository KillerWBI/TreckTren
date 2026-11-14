import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProgressResponse, WeeklyReview } from '@trektren/shared';
import { api } from '../api/http';

export const progressKey = (days: number) => ['progress', days] as const;
export const WEEKLY_KEY = ['weekly-review'] as const;

export const useProgress = (days: number) =>
  useQuery({
    queryKey: progressKey(days),
    queryFn: () => api<ProgressResponse>(`/progress?days=${days}`),
    placeholderData: (prev) => prev,
  });

export const useWeeklyReview = () =>
  useQuery({
    queryKey: WEEKLY_KEY,
    queryFn: () => api<{ review: WeeklyReview | null }>('/ai/weekly-review'),
  });

export function useCreateWeeklyReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ review: WeeklyReview }>('/ai/weekly-review', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(WEEKLY_KEY, data),
  });
}
