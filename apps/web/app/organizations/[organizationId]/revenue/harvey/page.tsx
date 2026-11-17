'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HarveyStatusHeader } from '@/components/harvey/harvey-status-header';
import { HarveyGoals } from '@/components/harvey/harvey-goals';
import { HarveyTimeline } from '@/components/harvey/harvey-timeline';
import { CampaignSettingsDialog } from '@/components/harvey/campaign-settings-dialog';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCampaigns, useHarveySnapshot } from '@/lib/harvey/use-harvey';
import { useHarveyStream } from '@/lib/harvey/use-harvey-stream';
import { HARVEY_CONTROL_ROLES } from '@/lib/harvey/types';
import type { ApiError } from '@/lib/api-client';

export default function HarveyControlCenterPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const snapshot = useHarveySnapshot(organizationId);
  const campaigns = useCampaigns(organizationId);
  const { connected } = useHarveyStream(organizationId);
  const { membership } = useCurrentMembership(organizationId);
  const canControl = membership ? (HARVEY_CONTROL_ROLES as readonly string[]).includes(membership.role) : false;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = campaigns.data?.find((campaign) => campaign.id === editingId) ?? null;

  if (snapshot.isLoading) return <Skeleton className="h-96 w-full" />;
  if (snapshot.isError) return <FormError message={(snapshot.error as ApiError).message} />;
  if (!snapshot.data) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-4">
        <HarveyStatusHeader
          organizationId={organizationId}
          snapshot={snapshot.data}
          canControl={canControl}
          connected={connected}
        />
        <HarveyGoals
          organizationId={organizationId}
          snapshot={snapshot.data}
          canConfigure={canControl}
          onConfigure={setEditingId}
        />
        {!canControl && (
          <p className="text-xs text-muted-foreground">Somente donos e administradores comandam o Harvey.</p>
        )}
      </div>
      <HarveyTimeline organizationId={organizationId} />
      <CampaignSettingsDialog organizationId={organizationId} campaign={editing} onClose={() => setEditingId(null)} />
    </div>
  );
}
