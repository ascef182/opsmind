'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { FINANCE_READ_ROLES } from '@/lib/finance/types';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/finance/finance-ui';
import { cn } from '@/lib/utils';

const TABS = [
  { segment: '', label: 'Visão geral' },
  { segment: 'entries', label: 'Lançamentos' },
  { segment: 'contracts', label: 'Contratos' },
  { segment: 'recurring', label: 'Recorrências' },
  { segment: 'reports', label: 'Relatórios' },
];

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const pathname = usePathname();
  const { membership, isLoading } = useCurrentMembership(organizationId);
  const basePath = `/organizations/${organizationId}/finance`;

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  if (!membership || !FINANCE_READ_ROLES.includes(membership.role)) {
    return (
      <EmptyState
        title="Sem acesso ao Financeiro"
        description="Os dados financeiros ficam disponíveis para gerentes, administradores e donos da organização."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Financeiro</h1>
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Seções do financeiro">
          {TABS.map((tab) => {
            const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
            const active = tab.segment ? pathname?.startsWith(href) : pathname === basePath;
            return (
              <Link
                key={tab.label}
                href={href}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-accent-500 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </div>
  );
}
