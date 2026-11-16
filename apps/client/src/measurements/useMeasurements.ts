import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeasurementInput, MeasurementsResponse } from '@trektren/shared';
import { api } from '../api/http';

export const MEASUREMENTS_KEY = ['measurements'] as const;

export const useMeasurements = () =>
  useQuery({
    queryKey: MEASUREMENTS_KEY,
    queryFn: () => api<MeasurementsResponse>('/measurements'),
  });

/** После замера портрет перерисовывается: манекен подгоняется под новые цифры. */
function useRefresh() {
  const queryClient = useQueryClient();
  return (data: MeasurementsResponse) => {
    queryClient.setQueryData(MEASUREMENTS_KEY, data);
    void queryClient.invalidateQueries({ queryKey: ['portrait'] });
  };
}

export function useSaveMeasurement() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: MeasurementInput) =>
      api<MeasurementsResponse>('/measurements', { method: 'PUT', json: input }),
    onSuccess: refresh,
  });
}

export function useDeleteMeasurement() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      api<MeasurementsResponse>(`/measurements/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
