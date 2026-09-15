// Espelha o model Notification de apps/api (@opsmind/database) — mesma
// decisão de tipos duplicados ao front que o resto de lib/*/types.ts.
export interface Notification {
  id: string;
  organizationId: string;
  userId: string;
  // Livre (ex.: "task.assigned", "automation.customer_inactive",
  // "outreach.followup_due") — nunca um enum fechado no backend, ver
  // comentário em NotificationsService.
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
