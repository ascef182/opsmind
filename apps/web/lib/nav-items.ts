import type { LucideIcon } from 'lucide-react';
import { Building2, Gauge, Handshake, LayoutDashboard, Lightbulb, ListTodo, MessageCircle, Send, Sparkles, Tag, Target, Users, UsersRound, Wallet, Zap } from 'lucide-react';
import type { Role } from '@opsmind/shared-types';

export interface NavItem {
  label: string;
  segment: string;
  icon: LucideIcon;
  group: 'workspace' | 'intelligence' | null;
  /** Papéis que enxergam o item. Omitido = todos. Só esconde UI; a API é quem barra. */
  roles?: Role[];
}

// Array tipado (não JSX por item) — permite empurrar uma nova seção
// (Automations/Documents/Analytics/Audit Log, sem página no frontend ainda)
// sem reestruturar o AppSidebar quando essas páginas existirem.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', segment: 'dashboard', icon: LayoutDashboard, group: 'workspace' },
  { label: 'Leads', segment: 'leads', icon: Users, group: 'workspace' },
  { label: 'Aprovações', segment: 'outreach', icon: Send, group: 'workspace' },
  { label: 'Alvos de prospecção', segment: 'prospecting-targets', icon: Target, group: 'workspace' },
  { label: 'Oportunidades', segment: 'market-opportunities', icon: Lightbulb, group: 'workspace' },
  { label: 'Clientes', segment: 'customers', icon: Building2, group: 'workspace' },
  { label: 'Negócios', segment: 'deals', icon: Handshake, group: 'workspace' },
  { label: 'Tarefas', segment: 'tasks', icon: ListTodo, group: 'workspace' },
  { label: 'Automações', segment: 'automations', icon: Zap, group: 'workspace' },
  { label: 'Códigos de sinal', segment: 'signal-codes', icon: Tag, group: 'workspace' },
  { label: 'Monitoramento de tópicos', segment: 'reddit-watch-topics', icon: MessageCircle, group: 'workspace' },
  { label: 'Financeiro', segment: 'finance', icon: Wallet, group: 'workspace', roles: ['OWNER', 'ADMIN', 'MANAGER'] },
  { label: 'Assistente IA', segment: 'ai', icon: Sparkles, group: 'intelligence' },
  { label: 'Uso de IA', segment: 'ai/usage', icon: Gauge, group: 'intelligence' },
  { label: 'Equipe', segment: 'team', icon: UsersRound, group: null },
];

export const NAV_GROUPS: Array<{ id: 'workspace' | 'intelligence'; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'intelligence', label: 'Inteligência' },
];
