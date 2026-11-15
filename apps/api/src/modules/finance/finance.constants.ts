// Acesso a dados financeiros é mais restrito que o resto do CRM: o CRM é
// trabalho operacional de toda a equipe (WRITE_ROLES = todos menos VIEWER),
// mas "quanto a empresa fatura, deve e gasta" não é. Hierarquia linear do
// RolesGuard: `@Roles('MANAGER')` admite MANAGER, ADMIN e OWNER.
//
//   leitura (KPIs, listas, relatórios, rentabilidade, CSV) -> MANAGER ou acima
//   escrita (lançar, pagar, estornar, contratos)           -> ADMIN ou acima
//
// MEMBER e VIEWER não enxergam nem os números agregados.
export const FINANCE_READ_ROLE = 'MANAGER' as const;
export const FINANCE_WRITE_ROLE = 'ADMIN' as const;

// Teto de centavos por lançamento: INT4 do Postgres (~R$ 21,4 mi). Validado
// no DTO para falhar com 400 legível em vez de estourar no banco.
export const MAX_AMOUNT_CENTS = 2_000_000_000;

export const DEFAULT_LIST_LIMIT = 200;
export const MAX_LIST_LIMIT = 500;
