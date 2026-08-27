// Reexporta a hierarquia definida em @opsmind/shared-types para que apps/web
// e apps/api consultem a mesma ordem de papéis, sem duplicar a lista.
export { ROLE_HIERARCHY } from '@opsmind/shared-types';
export type { Role } from '@opsmind/shared-types';
