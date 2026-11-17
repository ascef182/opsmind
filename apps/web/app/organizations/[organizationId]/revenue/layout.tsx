'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { segment: '', label: 'Visão geral' },
  { segment: 'pipeline', label: 'Funil' },
  { segment: 'costs', label: 'Custos' },
  { segment: 'settings', label: 'Configurações' },
];

// Leitura aberta a todo membro (mesmo padrão do dashboard); só a aba de
// configurações restringe edição a OWNER/ADMIN.
export default function RevenueLayout({ children }: { children: React.ReactNode }) {
  const { organizationId } = useParams<{ organizationId: string }>();
  const pathname = usePathname();
  const basePath = `/organizations/${organizationId}/revenue`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div>
          <p className="text-label text-accent-500">CazaTech</p>
          <h1 className="text-h1">Revenue Engine</h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Seções do Revenue Engine">
          {TABS.map((tab) => {
            const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
            const active = tab.segment ? pathname?.startsWith(href) : pathname === basePath;
            return (
              <Link
                key={tab.label}
                href={href}
                aria-current={active ? 'page' : undefined}
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
