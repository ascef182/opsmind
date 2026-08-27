'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function Providers({ children }: { children: React.ReactNode }) {
  // Uma instância por sessão de árvore de componentes, não um módulo top-level
  // — evita cache compartilhado entre requests diferentes no ambiente de
  // desenvolvimento do Next.js (Fast Refresh) e é o padrão recomendado do
  // React Query para o App Router.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
