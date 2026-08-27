'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredTokens } from './token-storage';

/**
 * Auth por localStorage não dá pra checar no servidor (Next App Router não
 * vê localStorage em SSR) — então a proteção de rota é client-side: renderiza
 * nada até confirmar que há token, redireciona pra /login se não houver.
 * Um flash de conteúdo protegido não acontece porque `checked` só vira true
 * depois da checagem, e o caller só renderiza a página quando `checked` é true.
 */
export function useRequireAuth(): { checked: boolean } {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (getStoredTokens() === null) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router]);

  return { checked };
}
