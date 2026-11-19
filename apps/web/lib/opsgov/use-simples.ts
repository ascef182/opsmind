'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { opsgovRoot } from './use-company';
import type { RealSimulation } from './types';

export function useRealSimulation(
  organizationId: string,
  params: { folhaMensalCents: number; inssSocioRateBp: number },
  enabled = true,
) {
  return useQuery({
    queryKey: [...opsgovRoot(organizationId), 'revenue', 'simples-real', params],
    queryFn: () =>
      apiFetch<RealSimulation>(
        `/organizations/${organizationId}/opsgov/simples/real?folhaMensalCents=${params.folhaMensalCents}&inssSocioRateBp=${params.inssSocioRateBp}`,
      ),
    enabled: Boolean(organizationId) && enabled,
  });
}
