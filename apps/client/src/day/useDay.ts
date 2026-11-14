import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DayResponse,
  MealInput,
  ParsedFood,
  TimeOfDay,
  WellbeingView,
} from '@trektren/shared';
import { api } from '../api/http';
import { sendOrQueue } from '../offline/outbox';

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

/**
 * Вес, шаги и сон: без сети запись ложится в очередь, а день в кэше правим сразу,
 * чтобы экран показал введённое. queued — ждёт сети.
 */
function useQueuedDayMutation<T>(
  date: string,
  request: (input: T) => { key: string; path: string; json: unknown },
  patch: (day: DayResponse, input: T) => DayResponse,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      const r = request(input);
      return sendOrQueue<DayResponse>(r.key, r.path, 'PUT', r.json);
    },
    onSuccess: (res, input) => {
      if (!res.queued) queryClient.setQueryData(dayKey(date), res.data);
      else queryClient.setQueryData<DayResponse>(dayKey(date), (old) => old && patch(old, input));
    },
  });
}

export const usePutWeight = (date: string) =>
  useQueuedDayMutation(
    date,
    (input: { timeOfDay: TimeOfDay; weightKg: number }) => ({
      key: `weight:${date}:${input.timeOfDay}`,
      path: '/weights',
      json: { date, ...input },
    }),
    (day, input) => ({ ...day, weights: { ...day.weights, [input.timeOfDay]: input.weightKg } }),
  );

export const useDeleteWeight = (date: string) =>
  useDayMutation(date, (timeOfDay: TimeOfDay) =>
    api<DayResponse>(`/weights/${date}/${timeOfDay}`, { method: 'DELETE' }),
  );

export const usePutSteps = (date: string) =>
  useQueuedDayMutation(
    date,
    (steps: number) => ({ key: `steps:${date}`, path: `/steps/${date}`, json: { steps } }),
    (day, steps) => ({ ...day, steps }),
  );

export const usePutWellbeing = (date: string) =>
  useQueuedDayMutation(
    date,
    (input: WellbeingView) => ({
      key: `wellbeing:${date}`,
      path: `/wellbeing/${date}`,
      json: input,
    }),
    (day, wellbeing) => ({ ...day, wellbeing }),
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
