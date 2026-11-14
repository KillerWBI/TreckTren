import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CardResponse } from '@trektren/shared';
import { api } from '../api/http';

export const CARD_KEY = ['card'] as const;
export const VERSIONS_KEY = ['card-versions'] as const;

interface SaveInput {
  patch: Record<string, unknown>;
  baseVersion: number;
  reason?: string;
}

export function useSaveCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveInput) =>
      api<CardResponse & { changed: boolean }>('/card', { method: 'PATCH', json: input }),
    onSuccess: (data) => {
      queryClient.setQueryData<CardResponse>(CARD_KEY, {
        card: data.card,
        version: data.version,
        updatedAt: data.updatedAt,
      });
      void queryClient.invalidateQueries({ queryKey: VERSIONS_KEY });
      // Норма калорий зависит от карточки.
      void queryClient.invalidateQueries({ queryKey: ['day'] });
    },
  });
}
