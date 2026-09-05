'use client';

import { useRouter } from 'next/navigation';
import { Bell, LogOut, Search } from 'lucide-react';
import { useLogout } from '@/lib/auth/use-auth';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
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
        <Button variant="ghost" size="icon" disabled aria-label="Notificações">
          <Bell className="size-4" />
        </Button>

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
