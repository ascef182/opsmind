'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import { openAuthenticatedStream } from '../sse';
import { harveyKey } from './use-harvey';
import type { HarveyActivity } from './types';

type ActivitiesPage = { items: HarveyActivity[]; nextCursor: string | null };

// Mantém a timeline e o snapshot atualizados em tempo real. Ao reconectar,
// busca no banco o que mudou desde o último evento visto: nada se perde se o
// stream cair ou o servidor reiniciar.
export function useHarveyStream(organizationId: string): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;

    const merge = (incoming: HarveyActivity[]) => {
      if (incoming.length === 0) return;
      queryClient.setQueriesData<InfiniteData<ActivitiesPage>>(
        { queryKey: harveyKey(organizationId, 'activities') },
        (data) => {
          if (!data) return data;
          const byId = new Map(incoming.map((activity) => [activity.id, activity]));
          const pages = data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => byId.get(item.id) ?? item),
          }));
          const known = new Set(pages.flatMap((page) => page.items.map((item) => item.id)));
          const fresh = incoming.filter((activity) => !known.has(activity.id));
          if (fresh.length > 0 && pages[0]) {
            pages[0] = { ...pages[0], items: [...fresh.reverse(), ...pages[0].items] };
          }
          return { ...data, pages };
        },
      );
      void queryClient.invalidateQueries({ queryKey: harveyKey(organizationId, 'snapshot') });
    };

    const catchUp = async () => {
      if (!lastSeen.current) return;
      const page = await apiFetch<ActivitiesPage>(
        `/organizations/${organizationId}/revenue/harvey/activities?after=${encodeURIComponent(lastSeen.current)}`,
      ).catch(() => null);
      if (page) merge(page.items);
    };

    const close = openAuthenticatedStream(`/organizations/${organizationId}/revenue/harvey/stream`, {
      onOpen: () => {
        setConnected(true);
        void catchUp();
        if (!lastSeen.current) lastSeen.current = new Date().toISOString();
      },
      onDisconnect: () => setConnected(false),
      onMessage: (message) => {
        if (message.event === 'ping') return;
        lastSeen.current = new Date().toISOString();
        if (message.event === 'status.changed') {
          void queryClient.invalidateQueries({ queryKey: harveyKey(organizationId, 'snapshot') });
          return;
        }
        if (message.event === 'activity') {
          const payload = JSON.parse(message.data) as { activity: HarveyActivity };
          merge([payload.activity]);
        }
      },
    });
    return close;
  }, [organizationId, queryClient]);

  return { connected };
}
