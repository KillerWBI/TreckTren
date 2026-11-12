import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardResponse, ExerciseView, PlanResponse, StrengthUpdate } from '@trektren/shared';
import { api } from '../api/http';
import { CARD_KEY, VERSIONS_KEY } from '../card/useSaveCard';

export const PLAN_KEY = ['plan'] as const;
export const EXERCISES_KEY = ['exercises'] as const;

export const usePlan = () =>
  useQuery({ queryKey: PLAN_KEY, queryFn: () => api<PlanResponse>('/plan') });

export const useExercises = () =>
  useQuery({
    queryKey: EXERCISES_KEY,
    queryFn: () => api<ExerciseView[]>('/exercises'),
    staleTime: Infinity,
  });

export const useCard = () =>
  useQuery({ queryKey: CARD_KEY, queryFn: () => api<CardResponse>('/card') });

export function useGeneratePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { dates: string[]; comment?: string }) =>
      api<PlanResponse>('/plan/generate', { method: 'POST', json: input }),
    onSuccess: (data) => queryClient.setQueryData(PLAN_KEY, data),
  });
}

export function useReschedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dates: string[]) =>
      api<PlanResponse>('/plan/schedule', { method: 'PUT', json: { dates } }),
    onSuccess: (data) => queryClient.setQueryData(PLAN_KEY, data),
  });
}

export function useSaveStrength() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: StrengthUpdate) =>
      api<CardResponse>('/strength', { method: 'PUT', json: update }),
    onSuccess: (data) => {
      queryClient.setQueryData<CardResponse>(CARD_KEY, {
        card: data.card,
        version: data.version,
        updatedAt: data.updatedAt,
      });
      void queryClient.invalidateQueries({ queryKey: VERSIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: PLAN_KEY });
    },
  });
}
