// Reexporta a hierarquia definida em @opsmind/shared-types para que apps/web
// e apps/api consultem a mesma ordem de papéis, sem duplicar a lista.
export { ROLE_HIERARCHY } from '@opsmind/shared-types';
export type { Role } from '@opsmind/shared-types';

// Extraído depois de aparecer duplicado em customers/tasks.controller.ts —
// todo papel exceto VIEWER pode escrever (CRM/tarefas/tools de IA são
// trabalho operacional, não administração de conta).
export const WRITE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] as const;
