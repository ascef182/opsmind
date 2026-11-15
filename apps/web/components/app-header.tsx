'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLogout } from '@/lib/auth/use-auth';
import { Button } from './ui/button';

export function AppHeader({ title }: { title: string }) {
  const router = useRouter();
  const logout = useLogout();

  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
      <Link href="/organizations" className="text-lg font-semibold text-foreground">
        OpsMind
      </Link>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{title}</span>
        <Button
          variant="ghost"
          onClick={() => logout.mutate(undefined, { onSuccess: () => router.push('/login') })}
        >
          Sair
        </Button>
      </div>
    </header>
  );
}
