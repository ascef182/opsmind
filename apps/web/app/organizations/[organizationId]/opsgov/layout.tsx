'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { OPSGOV_FINANCE_ROLES } from '@/lib/opsgov/types';
import { cn } from '@/lib/utils';

// Abas crescem a cada fase do OpsGov. `finance` = só MANAGER+ (a API é quem barra).
const TABS = [
  { segment: 'empresa', label: 'Empresa', finance: false },
  { segment: 'receita', label: 'Receita', finance: true },
  { segment: 'simulador', label: 'Simulador do Simples', finance: false },
];

export default function OpsGovLayout({ children }: { children: React.ReactNode }) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const pathname = usePathname();
  const { membership } = useCurrentMembership(organizationId);
  const seesFinance = Boolean(membership && OPSGOV_FINANCE_ROLES.includes(membership.role));
  const basePath = `/organizations/${organizationId}/opsgov`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">OpsGov</h1>
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Seções do OpsGov">
          {TABS.filter((tab) => !tab.finance || seesFinance).map((tab) => {
            const href = `${basePath}/${tab.segment}`;
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={tab.segment}
                href={href}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                  active ? 'border-accent-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
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
