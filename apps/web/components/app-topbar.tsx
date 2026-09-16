'use client';

import { useRouter } from 'next/navigation';
import { Bell, LogOut, Search } from 'lucide-react';
import { useLogout } from '@/lib/auth/use-auth';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useMarkNotificationRead, useNotifications } from '@/lib/notifications/use-notifications';
import type { Notification } from '@/lib/notifications/types';
import type { OrganizationDto } from '@opsmind/shared-types';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

// `type` é string livre no backend (ver NotificationsService) — mapa de
// rótulos amigáveis pros tipos conhecidos hoje, com fallback pro tipo cru
// pra qualquer tipo novo não listado aqui (nunca quebra, só fica menos
// bonito até alguém adicionar o rótulo).
function describeNotification(notification: Notification): string {
  const payload = notification.payload ?? {};
  switch (notification.type) {
    case 'task.assigned':
      return `Nova tarefa atribuída${typeof payload.title === 'string' ? `: ${payload.title}` : ''}`;
    case 'automation.customer_inactive':
      return `Cliente inativo${typeof payload.customerName === 'string' ? `: ${payload.customerName}` : ''}`;
    case 'outreach.followup_due':
      return `Sem resposta ainda${typeof payload.leadName === 'string' ? ` — ${payload.leadName}` : ''}`;
    case 'task.due_reminder':
      return `Tarefa vencida${typeof payload.title === 'string' ? `: ${payload.title}` : ''}`;
    case 'meeting.reminder':
      return `Reunião em breve${typeof payload.title === 'string' ? `: ${payload.title}` : ''}`;
    case 'deal.signed':
      return `Contrato assinado${typeof payload.dealTitle === 'string' ? `: ${payload.dealTitle}` : ''} — mova para Ganho`;
    default:
      return notification.type;
  }
}

function NotificationsMenu({ organizationId }: { organizationId: string }) {
  const notifications = useNotifications(organizationId);
  const markRead = useMarkNotificationRead(organizationId);
  const unreadCount = notifications.data?.filter((n) => !n.readAt).length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notificações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.isLoading && <p className="px-2 py-3 text-sm text-muted-foreground">Carregando…</p>}
        {notifications.isSuccess && notifications.data.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">Nenhuma notificação ainda.</p>
        )}
        {notifications.data?.slice(0, 15).map((notification) => (
          <DropdownMenuItem
            key={notification.id}
            className="flex flex-col items-start gap-0.5 whitespace-normal"
            onClick={() => {
              if (!notification.readAt) {
                markRead.mutate(notification.id);
              }
            }}
          >
            <span className={notification.readAt ? 'text-muted-foreground' : 'font-medium text-foreground'}>
              {describeNotification(notification)}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(notification.createdAt).toLocaleString('pt-BR')}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppTopbar({
  organizationId,
  organization,
}: {
  organizationId: string;
  organization?: OrganizationDto;
}) {
  const router = useRouter();
  const logout = useLogout();
  const { membership } = useCurrentMembership(organizationId);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <SidebarTrigger />

      <div className="relative max-w-xs flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar…" disabled className="pl-8" />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <NotificationsMenu organizationId={organizationId} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2">
              <Avatar size="sm">
                <AvatarFallback>{organization ? initials(organization.name) : ''}</AvatarFallback>
              </Avatar>
              {organization ? (
                <span className="max-w-[10rem] truncate text-sm">{organization.name}</span>
              ) : (
                <Skeleton className="h-4 w-20" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <p className="truncate">{organization?.name ?? '…'}</p>
              {membership && <p className="text-xs font-normal text-muted-foreground">{membership.role}</p>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => logout.mutate(undefined, { onSuccess: () => router.push('/login') })}
            >
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
