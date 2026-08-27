'use client';

import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { useOrganization } from '@/lib/organizations/use-organizations';
import { useDashboard } from '@/lib/dashboard/use-dashboard';
import { AppHeader } from '@/components/app-header';
import { Card } from '@/components/ui/card';

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export default function OrganizationDashboardPage() {
  const { checked } = useRequireAuth();
  const { organizationId } = useParams<{ organizationId: string }>();
  const organization = useOrganization(organizationId);
  const dashboard = useDashboard(organizationId);

  if (!checked) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title={organization.data?.name ?? '…'} />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
        {dashboard.isLoading && <p className="text-slate-500">Carregando dashboard…</p>}
        {dashboard.isError && (
          <p className="text-red-700">Não foi possível carregar o dashboard desta organização.</p>
        )}

        {dashboard.isSuccess && (
          <>
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Clientes" value={dashboard.data.customers.total} />
              <StatCard
                label="Inativos"
                value={dashboard.data.customers.inactiveByRule}
                hint="sem contato há tempo demais"
              />
              <StatCard label="Tarefas" value={dashboard.data.tasks.total} />
              <StatCard label="Em aberto" value={dashboard.data.tasks.byStatus.OPEN} />
            </section>

            <Card>
              <h2 className="font-medium text-slate-900">Atividade recente</h2>
              {dashboard.data.recentActivity.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Nenhuma atividade registrada ainda.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {dashboard.data.recentActivity.map((activity) => (
                    <li key={activity.id} className="flex justify-between text-sm">
                      <span className="text-slate-700">{activity.type}</span>
                      <span className="text-slate-400">
                        {new Date(activity.createdAt).toLocaleString('pt-BR')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
