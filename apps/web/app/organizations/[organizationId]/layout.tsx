'use client';

import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { useOrganization } from '@/lib/organizations/use-organizations';
import { AppHeader } from '@/components/app-header';
import { AppNav } from '@/components/app-nav';

/**
 * Layout compartilhado por dashboard/customers/tasks/ai — centraliza a
 * proteção de rota (useRequireAuth) e o cabeçalho/nav em vez de repetir nas
 * 4 páginas. `/organizations` (a lista/criação, um nível acima) não usa este
 * layout — ainda não há uma organização "atual" pra mostrar no header/nav.
 */
export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const { checked } = useRequireAuth();
  const { organizationId } = useParams<{ organizationId: string }>();
  const organization = useOrganization(organizationId);

  if (!checked) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title={organization.data?.name ?? '…'} />
      <AppNav organizationId={organizationId} />
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
    </div>
  );
}
