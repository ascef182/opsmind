import { ForbiddenException, Injectable } from '@nestjs/common';
import type { ScrapeSourceType } from '@opsmind/database';
import { ScrapeJobsService } from '../../leads/scrape-jobs.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface FindLeadsInput {
  city: string;
  state: string;
  businessType: string;
  sourceType?: ScrapeSourceType;
  onlyWithoutWebsite?: boolean;
  limit?: number;
}

export interface FindLeadsOutput {
  scrapeJobId: string;
  status: string;
}

/**
 * Cria um `ScrapeJob` e enfileira via `ScrapeJobsService.create` (mesmo
 * caminho de `POST .../scrape-jobs`), mas NUNCA espera o job terminar antes
 * de retornar — quem processa é `apps/worker/src/lead-scrape-processor.ts`,
 * de forma assíncrona, e pode levar de segundos a minutos dependendo da
 * fonte (Apify/Explorium/Camoufox) e do `limit` pedido. Bloquear a resposta
 * da tool até o job terminar prenderia a chamada de chat inteira (e o
 * `MAX_ITERATIONS` de `AiService.chat`) por tempo indeterminado; em vez
 * disso a tool devolve `{scrapeJobId, status}` imediatamente (`status`
 * sempre `'QUEUED'` neste ponto) para o modelo poder informar o usuário e,
 * se quiser, checar o progresso depois via `GET .../scrape-jobs/:id`
 * (fora do escopo das AI tools desta fase). Gated por `WRITE_ROLES` — disparar
 * um scrape job real (custo de API externa) é uma ação de escrita, mesmo
 * padrão de `CreateTaskTool`.
 */
@Injectable()
export class FindLeadsTool implements AiTool<FindLeadsInput> {
  readonly name = 'find_leads';
  readonly description =
    'Dispara uma busca assíncrona de leads (negócios locais) por cidade/estado/tipo de negócio. Não espera o resultado — retorna o id do job para acompanhamento.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      city: { type: 'string' },
      state: { type: 'string' },
      businessType: { type: 'string' },
      sourceType: {
        type: 'string',
        enum: [
          'APIFY_GOOGLE_MAPS',
          'EXPLORIUM_BUSINESS_SEARCH',
          'CAMOFOX_GOOGLE_SEARCH',
          'CAMOFOX_REDDIT_SEARCH',
        ],
        default: 'APIFY_GOOGLE_MAPS',
      },
      onlyWithoutWebsite: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['city', 'state', 'businessType'],
    additionalProperties: false,
  };

  constructor(private readonly scrapeJobsService: ScrapeJobsService) {}

  async execute(input: FindLeadsInput, context: AiToolContext): Promise<FindLeadsOutput> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite disparar buscas de leads — peça a um administrador.',
      );
    }

    const job = await this.scrapeJobsService.create(
      context.organizationId,
      {
        sourceType: input.sourceType ?? 'APIFY_GOOGLE_MAPS',
        city: input.city,
        state: input.state,
        businessType: input.businessType,
        onlyWithoutWebsite: input.onlyWithoutWebsite,
        limit: input.limit,
      },
      context.userId,
    );

    return { scrapeJobId: job.id, status: job.status };
  }
}
