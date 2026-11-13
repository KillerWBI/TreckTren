import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DayResponse, MealInput, ParsedFood, TimeOfDay } from '@trektren/shared';
import { api } from '../api/http';

export const dayKey = (date: string) => ['day', date] as const;

export const useDay = (date: string) =>
  useQuery({ queryKey: dayKey(date), queryFn: () => api<DayResponse>(`/day/${date}`) });

/** Все правки дня возвращают свежий день целиком — кладём его в кэш. */
function useDayMutation<T>(date: string, fn: (input: T) => Promise<DayResponse | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(dayKey(date), data);
      else void queryClient.invalidateQueries({ queryKey: dayKey(date) });
    },
  });
}

export const usePutWeight = (date: string) =>
  useDayMutation(date, (input: { timeOfDay: TimeOfDay; weightKg: number }) =>
    api<DayResponse>('/weights', { method: 'PUT', json: { date, ...input } }),
  );

export const useDeleteWeight = (date: string) =>
  useDayMutation(date, (timeOfDay: TimeOfDay) =>
    api<DayResponse>(`/weights/${date}/${timeOfDay}`, { method: 'DELETE' }),
  );

export const usePutSteps = (date: string) =>
  useDayMutation(date, (steps: number) =>
    api<DayResponse>(`/steps/${date}`, { method: 'PUT', json: { steps } }),
  );

export const useAddMeal = (date: string) =>
  useDayMutation(date, (input: Omit<MealInput, 'date'>) =>
    api<DayResponse>('/meals', { method: 'POST', json: { date, ...input } }),
  );

export const useDeleteMeal = (date: string) =>
  useDayMutation(date, (id: string) => api<void>(`/meals/${id}`, { method: 'DELETE' }));

export const useSetAdjust = (date: string) =>
  useDayMutation(date, (kcal: number) =>
    api<void>('/nutrition/adjust', { method: 'PUT', json: { kcal } }),
  );

export const useParseMeal = () =>
  useMutation({
    mutationFn: (text: string) =>
      api<ParsedFood & { cached: boolean }>('/meals/parse', { method: 'POST', json: { text } }),
  });
