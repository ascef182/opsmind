import { redirect } from 'next/navigation';

// Até o painel "Prontidão geral" (Fase 6), a entrada do OpsGov é o cadastro da empresa.
export default function OpsGovIndex({ params }: { params: { organizationId: string } }) {
  redirect(`/organizations/${params.organizationId}/opsgov/empresa`);
}
