import type { Role } from '@opsmind/shared-types';

/**
 * O que uma tool de IA pode enxergar sobre quem a invocou. Deliberadamente
 * NUNCA vem do input do modelo (Claude não escolhe `organizationId`/`userId`/
 * `role` — só o texto que o usuário digitou pode influenciar isso) — sempre
 * injetado pelo `AiService` a partir do request HTTP autenticado, do mesmo
 * jeito que `TenantGuard`/`@CurrentMembership()` fazem para rotas normais.
 * Esta é a fronteira de "a IA nunca pode exceder o que o usuário que a
 * invocou já podia fazer" (diretriz de segurança da Fase 3).
 */
export interface AiToolContext {
  organizationId: string;
  userId: string;
  role: Role;
}

/**
 * Uma tool exposta ao modelo. `inputSchema` vira o `input_schema` JSON Schema
 * enviado à API da Anthropic; `execute` nunca deve confiar em nada do input
 * além do que o schema declara — nenhuma tool declara `organizationId` ou
 * `userId` como propriedade, exatamente para não abrir uma forma de o modelo
 * (ou um prompt malicioso dentro dos dados de um cliente) pedir para agir
 * fora do tenant do usuário.
 */
export interface AiTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(input: TInput, context: AiToolContext): Promise<unknown>;
}

export const AI_TOOLS = Symbol('AI_TOOLS');
