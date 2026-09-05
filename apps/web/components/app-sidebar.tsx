'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_GROUPS, NAV_ITEMS } from '@/lib/nav-items';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export function AppSidebar({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();

  // O antigo app-nav.tsx tentava evitar que "Assistente IA" (/ai) e "Uso de
  // IA" (/ai/usage) acendessem juntos comparando `startsWith(href + '/')`,
  // mas isso não resolve o problema: '/ai/usage'.startsWith('/ai/') também é
  // true, então os dois continuavam acendendo ao mesmo tempo. A correção de
  // verdade é achar o segmento MAIS ESPECÍFICO que bate com a rota atual (o
  // de maior tamanho) e marcar só esse como ativo.
  const activeSegment = [...NAV_ITEMS]
    .filter((item) => {
      const href = `/organizations/${organizationId}/${item.segment}`;
      return pathname === href || (pathname?.startsWith(href + '/') ?? false);
    })
    .sort((a, b) => b.segment.length - a.segment.length)[0]?.segment;

  const isActive = (segment: string) => segment === activeSegment;

  const footerItems = NAV_ITEMS.filter((item) => item.group === null);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/organizations"
          className="flex h-9 items-center gap-2 px-2 text-sm font-semibold text-foreground"
        >
          OpsMind
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((item) => item.group === group.id);
          return (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = isActive(item.segment);
                    return (
                      <SidebarMenuItem key={item.segment}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link
                            href={`/organizations/${organizationId}/${item.segment}`}
                            className={cn(active && 'border-l-2 border-sidebar-primary pl-[calc(0.5rem-2px)]')}
                          >
                            <item.icon className={cn(active && 'text-sidebar-primary')} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {footerItems.map((item) => {
            const active = isActive(item.segment);
            return (
              <SidebarMenuItem key={item.segment}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link href={`/organizations/${organizationId}/${item.segment}`}>
                    <item.icon className={cn(active && 'text-sidebar-primary')} />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
