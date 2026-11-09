// Job `website-profile` — investiga o site público já conhecido de um lead
// (`Lead.website`) e grava sinais estruturados (`LeadSignal`). Ver
// docs/planning/2026-11-06-harvey-inteligencia-comercial.md §3/§5.
//
// Deliberadamente SEM chamada de IA e SEM depender de Apify/Explorium/
// Camoufox: a investigação desta feature confirmou que 3 dos 4 gateways
// existentes estão marcados no próprio código como "não verificados ao
// vivo" — apostar a capacidade inteira de investigação de site nessas
// integrações seria arriscado. Este profiler usa só `ssrfSafeFetch`
// (requisição HTTP direta e segura) + `extractWebsiteSignals` (regex sobre
// o HTML já buscado), exatamente a mesma composição do próprio profiler do
// Harvey (`harvey/collectors/profile.py`).
import type { Lead, PrismaClient, Prisma } from '@opsmind/database';
import {
  QUALIFICATION_THRESHOLD,
  STRUCTURED_WEBSITE_SOURCES,
  scoreLead,
  type LeadScoringInput,
  type LeadSignalForScoring,
  type OutreachAutodraftJobData,
  type ServiceOfferingIcp,
  type WebsiteProfileJobData,
} from '@opsmind/shared-types';
import * as Sentry from '@sentry/node';
import { randomUUID } from 'node:crypto';
import { withTenantContext } from './tenant-context';
import { ssrfSafeFetch, SsrfSafeFetchError } from './ssrf-safe-fetch';
import { extractWebsiteSignals, type FetchedPage } from './signal-extractors';
import { resolveAutodraftChannel } from './lead-scrape-processor';

// Mesmo racional de `PRE_QUALIFICATION_STATUSES` em `leads.service.ts`
// (apps/api) — duplicada aqui, não importada, pelo mesmo motivo de
// `loadFirmographics` acima: `apps/worker` não pode importar `apps/api`.
const PRE_QUALIFICATION_STATUSES: Lead['status'][] = ['DISCOVERED', 'QUALIFIED', 'DISQUALIFIED'];

function toOfferingIcp(o: {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}): ServiceOfferingIcp {
  return {
    id: o.id,
    signals: o.signals,
    targetIndustries: o.targetIndustries,
    minEmployees: o.minEmployees,
    maxEmployees: o.maxEmployees,
    minRevenueUsd: o.minRevenueUsd,
    maxRevenueUsd: o.maxRevenueUsd,
  };
}

interface ExploriumFirmographicsData {
  industry?: string | null;
  employeeCount?: number | null;
  revenueUsd?: number | null;
}

// Mesma consulta de `LeadsService.getFirmographics` (apps/api) — duplicada
// aqui de propósito, não importada: `apps/worker` não pode importar
// `apps/api` (arquitetura do monorepo, ver CLAUDE.md).
async function loadFirmographics(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
): Promise<LeadScoringInput['firmographics']> {
  const enrichment = await tx.leadEnrichment.findFirst({
    where: { organizationId, leadId, type: 'explorium_firmographics' },
    orderBy: { createdAt: 'desc' },
  });
  if (!enrichment) {
    return null;
  }
  const data = enrichment.data as unknown as ExploriumFirmographicsData;
  return {
    industry: data.industry ?? null,
    employeeCount: data.employeeCount ?? null,
    revenueUsd: data.revenueUsd ?? null,
  };
}

// Carrega, por `signalCode`, só a observação MAIS RECENTE de cada sinal
// determinístico (`WEBSITE_PROFILER`/`MANUAL` — nunca `AI_ANALYSIS`, ver
// restrição do usuário sobre nunca contar inferência de IA como fato
// confirmado) cujo vocabulário ainda está `CONFIRMED`. "Mais recente" (não
// "todas as linhas") evita inflar o score a cada reprocessamento do mesmo
// site — o histórico continua intacto em `lead_signals`, só a pontuação
// usa o estado atual.
//
// Exportada (não privada): `lead-scrape-processor.ts` também precisa disto
// — um lead re-raspado que já tem sinais de uma investigação anterior deve
// ter esses sinais contados no re-score, mesmo sem reinvestigar o site de
// novo nesta passada. Mesmo app (`apps/worker`), então importar em vez de
// duplicar pela terceira vez é a escolha certa aqui (diferente do
// racional de `loadFirmographics`/`PRE_QUALIFICATION_STATUSES` acima, que
// duplicam porque cruzam a fronteira apps/worker-não-importa-apps/api).
export async function loadConfirmedSignalsForScoring(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
): Promise<LeadSignalForScoring[]> {
  const rows = await tx.leadSignal.findMany({
    where: { organizationId, leadId, collector: { in: ['WEBSITE_PROFILER', 'MANUAL'] } },
    orderBy: { observedAt: 'desc' },
    include: { signalCodeRef: { select: { status: true, defaultServiceOfferingId: true } } },
  });

  const latestByCode = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByCode.has(row.signalCode)) {
      latestByCode.set(row.signalCode, row);
    }
  }

  return Array.from(latestByCode.values())
    .filter((row) => row.signalCodeRef.status === 'CONFIRMED')
    .map((row) => ({ signalCode: row.signalCode, matchedOfferingId: row.signalCodeRef.defaultServiceOfferingId }));
}

async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const result = await ssrfSafeFetch(url);
    return { url: result.finalUrl, html: result.body };
  } catch (err) {
    if (err instanceof SsrfSafeFetchError) {
      // Bloqueio de SSRF, timeout, teto de tamanho, DNS não resolvido etc.
      // — nunca derruba o job inteiro; só esta página fica sem sinal.
      return null;
    }
    throw err;
  }
}

/**
 * Processa um job `website-profile`: busca a homepage (+ melhor esforço de
 * `/contato`) do `Lead.website`, extrai sinais, grava (dedup por
 * `(leadId, signalCode, runId)` — ver schema) e recalcula o score do lead
 * incluindo os sinais confirmados. Nunca lança por falha de rede/SSRF —
 * essas são condições esperadas (site fora do ar, lead com URL inválida),
 * não erros de job.
 */
export async function processWebsiteProfileJob(
  prisma: PrismaClient,
  data: WebsiteProfileJobData,
  enqueueAutodraft: (job: OutreachAutodraftJobData) => Promise<unknown> = async () => undefined,
): Promise<void> {
  const lead: Lead | null = await prisma.lead.findFirst({
    where: { id: data.leadId, organizationId: data.organizationId },
  });
  if (!lead) {
    throw new Error(`lead ${data.leadId} não encontrado na organização ${data.organizationId}`);
  }
  if (!lead.website) {
    // Nada a investigar — não é erro, só não há site conhecido ainda.
    return;
  }

  const runId = randomUUID();
  const pages: FetchedPage[] = [];

  const homepage = await fetchPage(lead.website);
  if (!homepage) {
    // Falha ao buscar a própria homepage é terminal para este lead nesta
    // execução — sem página, sem sinal possível.
    return;
  }
  pages.push(homepage);

  // Melhor esforço: tenta `/contato` também, mas uma falha aqui não aborta
  // (já temos a homepage) — mesma disciplina de "falha de uma etapa não
  // derruba o job inteiro" de `lead-scrape-processor.ts`.
  try {
    const contactUrl = new URL('/contato', homepage.url).toString();
    const contactPage = await fetchPage(contactUrl);
    if (contactPage) {
      pages.push(contactPage);
    }
  } catch (err) {
    Sentry.captureException(err, {
      extra: { leadId: data.leadId, organizationId: data.organizationId, phase: 'website-profiler-contact-page' },
    });
  }

  const extractedAll = extractWebsiteSignals(pages);

  const autodraftJob = await withTenantContext(prisma, data.organizationId, async (tx) => {
    // Governança do vocabulário: a FK real `lead_signals.signal_code ->
    // signal_codes.code` já rejeita um código que nunca existiu, mas NÃO
    // sabe distinguir CONFIRMED/PROPOSED de DEPRECATED (FK só checa
    // existência). Esse filtro é o que efetivamente implementa "nunca
    // grava um sinal DEPRECATED" — sem ele, um código global marcado
    // DEPRECATED (ex.: `social.no_instagram`, ver migration
    // 20261107_signal_codes_whatsapp_and_deprecate_instagram) continuaria
    // sendo gravado normalmente pra sempre, e um código desconhecido (nunca
    // proposto) derrubaria o job inteiro com um erro de FK não tratado em
    // vez de simplesmente pular aquele sinal.
    const candidateCodes = [...new Set(extractedAll.map((s) => s.signalCode))];
    const governedCodes = await tx.signalCode.findMany({
      where: {
        code: { in: candidateCodes },
        OR: [{ organizationId: null }, { organizationId: data.organizationId }],
        status: { not: 'DEPRECATED' },
      },
      select: { code: true },
    });
    const writableCodes = new Set(governedCodes.map((c) => c.code));
    const extracted = extractedAll.filter((s) => writableCodes.has(s.signalCode));

    for (const signal of extracted) {
      // `upsert` só por segurança contra retry do BullMQ reexecutando o
      // MESMO job (mesmo `runId` nunca se repetiria numa execução nova,
      // já que é gerado uma vez por chamada desta função) — o
      // `@@unique([leadId, signalCode, runId])` é quem de fato garante que
      // reprocessar a mesma execução nunca duplica.
      await tx.leadSignal.upsert({
        where: { leadId_signalCode_runId: { leadId: data.leadId, signalCode: signal.signalCode, runId } },
        create: {
          organizationId: data.organizationId,
          leadId: data.leadId,
          signalCode: signal.signalCode,
          value: signal.value,
          confidence: signal.confidence,
          collector: 'WEBSITE_PROFILER',
          evidenceUrl: signal.evidenceUrl,
          evidenceQuote: signal.evidenceQuote,
          runId,
        },
        update: {},
      });
    }

    await tx.leadEnrichment.create({
      data: {
        organizationId: data.organizationId,
        leadId: data.leadId,
        type: 'website_profile',
        data: {
          runId,
          pagesFetched: pages.map((page) => page.url),
          signalsFound: extracted.map((signal) => signal.signalCode),
        } as Prisma.InputJsonValue,
        sourceUrl: homepage.url,
        actorType: data.actorType,
        actorId: data.actorId ?? null,
      },
    });

    const offerings = await tx.serviceOffering.findMany({
      where: { organizationId: data.organizationId, isActive: true },
    });
    const firmographics = await loadFirmographics(tx, data.organizationId, data.leadId);
    const confirmedSignals = await loadConfirmedSignalsForScoring(tx, data.organizationId, data.leadId);

    const scoreInput: LeadScoringInput = {
      website: lead.website,
      // Sempre `false` aqui: só chegamos até este ponto porque
      // `lead.website` já é truthy (checado acima) — este campo existe
      // pra distinguir "nunca capturado" de "confirmado ausente", nenhum
      // dos dois é o caso quando o site existe e acabou de ser buscado.
      websiteConfirmedAbsent: false,
      googleCategory: lead.googleCategory,
      rating: lead.rating ? Number(lead.rating) : null,
      reviewCount: lead.reviewCount,
      rawContent: lead.rawContent,
      firmographics,
      confirmedSignals,
    };
    const breakdown = scoreLead(scoreInput, offerings.map(toOfferingIcp));
    const computedStatus = breakdown.total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED' : 'DISQUALIFIED';
    // Nunca regride um lead que já avançou além da qualificação inicial só
    // porque uma investigação de site rodou depois.
    const canUpdateStatus = PRE_QUALIFICATION_STATUSES.includes(lead.status);
    const effectiveStatus = canUpdateStatus ? computedStatus : lead.status;

    await tx.lead.update({
      where: { id: data.leadId },
      data: {
        score: breakdown.total,
        scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        suggestedOfferingId: breakdown.matchedOfferingId,
        ...(canUpdateStatus ? { status: computedStatus } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: data.organizationId,
        actorType: data.actorType,
        actorId: data.actorId ?? null,
        action: 'website_profile.finished',
        resource: `Lead:${data.leadId}`,
        metadata: { runId, signalsFound: extracted.length, score: breakdown.total },
      },
    });

    // Gatilho de autodraft PÓS-investigação (ver racional em
    // `lead-scrape-processor.ts`, Passo 3): esta é a continuação do lead que
    // foi desviado pra cá em vez de ganhar rascunho imediato, agora com
    // sinais reais disponíveis pra citar. Mesmas condições de lá —
    // QUALIFIED, oferta sugerida, canal resolvível, zero outreach existente
    // — só que avaliadas com o `effectiveStatus`/`breakdown` recém-
    // calculados aqui. Sem teto por job (diferente de
    // `AUTODRAFT_MAX_PER_ORG_PER_JOB`): este job processa UM lead só, nunca
    // um lote — não há "avalanche" possível dum job de investigação
    // individual.
    let autodraftJob: OutreachAutodraftJobData | null = null;
    if (effectiveStatus === 'QUALIFIED' && breakdown.matchedOfferingId) {
      const existingOutreachCount = await tx.outreachMessage.count({ where: { leadId: data.leadId } });
      if (existingOutreachCount === 0) {
        const channel = resolveAutodraftChannel(lead);
        if (channel) {
          autodraftJob = {
            organizationId: data.organizationId,
            leadId: data.leadId,
            channel,
            serviceOfferingId: breakdown.matchedOfferingId,
          };
        }
      }
    }
    return autodraftJob;
  });

  // Fora da tx — mesma disciplina de "rede nunca dentro da tx Postgres" de
  // `lead-scrape-processor.ts`. Best-effort: uma falha ao enfileirar nunca
  // desfaz a investigação/score já persistidos acima.
  if (autodraftJob) {
    try {
      await enqueueAutodraft(autodraftJob);
    } catch (enqueueError) {
      Sentry.captureException(enqueueError, {
        extra: { leadId: data.leadId, organizationId: data.organizationId, phase: 'outreach-autodraft-enqueue' },
      });
      // eslint-disable-next-line no-console -- visibilidade mínima mesmo sem SENTRY_DSN configurado (SDK vira no-op nesse caso)
      console.error(
        `[website-profiler-processor] falha ao enfileirar rascunho automático de outreach para o lead ${data.leadId}:`,
        enqueueError,
      );
    }
  }
}
