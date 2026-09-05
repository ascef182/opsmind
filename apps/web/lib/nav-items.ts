import type { LucideIcon } from 'lucide-react';
import { Building2, Gauge, LayoutDashboard, ListTodo, Send, Sparkles, Users, UsersRound } from 'lucide-react';

export interface NavItem {
  label: string;
  segment: string;
  icon: LucideIcon;
  group: 'workspace' | 'intelligence' | null;
}

// Array tipado (não JSX por item) — permite empurrar uma nova seção
// (Automations/Documents/Analytics/Audit Log, sem página no frontend ainda)
// sem reestruturar o AppSidebar quando essas páginas existirem.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', segment: 'dashboard', icon: LayoutDashboard, group: 'workspace' },
  { label: 'Leads', segment: 'leads', icon: Users, group: 'workspace' },
  { label: 'Aprovações', segment: 'outreach', icon: Send, group: 'workspace' },
  { label: 'Clientes', segment: 'customers', icon: Building2, group: 'workspace' },
  { label: 'Tarefas', segment: 'tasks', icon: ListTodo, group: 'workspace' },
  { label: 'Assistente IA', segment: 'ai', icon: Sparkles, group: 'intelligence' },
  { label: 'Uso de IA', segment: 'ai/usage', icon: Gauge, group: 'intelligence' },
  { label: 'Equipe', segment: 'team', icon: UsersRound, group: null },
];

export const NAV_GROUPS: Array<{ id: 'workspace' | 'intelligence'; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'intelligence', label: 'Inteligência' },
];
