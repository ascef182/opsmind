'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const TABS = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'customers', label: 'Clientes' },
  { path: 'tasks', label: 'Tarefas' },
  { path: 'ai', label: 'Assistente IA' },
  { path: 'ai/usage', label: 'Uso de IA' },
  { path: 'team', label: 'Equipe' },
];

export function AppNav({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-slate-200 bg-white px-6">
      {TABS.map((tab) => {
        const href = `/organizations/${organizationId}/${tab.path}`;
        const active = pathname?.startsWith(href) ?? false;
        return (
          <Link
            key={tab.path}
            href={href}
            className={clsx(
              'border-b-2 px-3 py-3 text-sm font-medium transition-colors',
              active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
