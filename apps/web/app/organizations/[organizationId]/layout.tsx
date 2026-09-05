'use client';

import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { useOrganization } from '@/lib/organizations/use-organizations';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

/**
 * Layout compartilhado por dashboard/leads/outreach/customers/tasks/ai/team —
 * centraliza a proteção de rota (useRequireAuth) e o shell (sidebar + topbar)
 * em vez de repetir em cada página. `/organizations` (a lista/criação, um
 * nível acima) não usa este layout — ainda não há uma organização "atual"
 * pra mostrar na sidebar.
 */
export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const { checked } = useRequireAuth();
  const { organizationId } = useParams<{ organizationId: string }>();
  const organization = useOrganization(organizationId);

  if (!checked) {
    return null;
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '15rem' } as React.CSSProperties}>
      <AppSidebar organizationId={organizationId} />
      <SidebarInset>
        <AppTopbar organizationId={organizationId} organization={organization.data} />
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
