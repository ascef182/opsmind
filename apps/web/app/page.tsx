'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getStoredTokens } from '@/lib/auth/token-storage';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (getStoredTokens() !== null) {
      router.replace('/organizations');
    }
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">OpsMind</h1>
        <p className="mt-2 max-w-md text-slate-600">
          CRM com um assistente de IA que conhece o seu workspace de verdade.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/login">
          <Button variant="primary">Entrar</Button>
        </Link>
        <Link href="/register">
          <Button variant="secondary">Criar conta</Button>
        </Link>
      </div>
    </main>
  );
}
