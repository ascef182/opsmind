import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { APIFY_GATEWAY, CAMOFOX_GATEWAY, EXPLORIUM_GATEWAY } from '@opsmind/integrations';
import { WEBSITE_PROFILE_QUEUE, type WebsiteProfileJobData } from '@opsmind/shared-types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AI_GATEWAY, type AiGateway } from '../src/modules/ai/gateway/ai-gateway.interface';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { registerUser } from './helpers/auth';

async function createOrg(app: INestApplication, accessToken: string, name = 'Leads Co') {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

// `/auth/register` tem throttle de 10/60s (AuthController) e este arquivo já
// soma 9 chamadas reais a `registerUser` nos testes acima — qualquer teste
// novo que precise de 2+ usuários a mais estoura esse orçamento (visto
// empiricamente: 429 no primeiro `registerUser` extra). `/auth/login` tem seu
// próprio balde de throttle (chave inclui o nome do handler), ainda intacto
// nesta suíte, então os testes de RBAC de signal-codes abaixo criam o usuário
// direto via Prisma (mesmo hash de senha do fluxo real, via `PasswordService`)
// e autenticam por login — sem contorno de regra de negócio, só evita o
// endpoint de registro já perto do limite.
async function createLoggedInUser(
  app: INestApplication,
  prisma: PrismaService,
  email: string,
): Promise<{ accessToken: string; userId: string; email: string }> {
  const password = 'correct horse battery staple';
  const passwordHash = await app.get(PasswordService).hash(password);
  const user = await prisma.user.create({ data: { email, name: 'E2E User', passwordHash } });

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return { accessToken: loginRes.body.accessToken as string, userId: user.id, email };
}

function endTurn(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    id: `msg_${randomUUID()}`,
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// Fluxo completo de Leads/Prospecção (Task 5, docs/superpowers/sdd/
// 2026-09-02-leads-prospecting-dashboard): offering → scrape-job → lead
// pontuado → enrich manual → outreach draft → aprovação → mark-sent →
// convert-to-customer → isolamento cross-tenant, contra a app real (Postgres
// via Docker Compose). APIFY_GATEWAY/EXPLORIUM_GATEWAY/CAMOFOX_GATEWAY e
// AI_GATEWAY são sobrescritos por mocks (Test.overrideProvider), mesmo
// padrão de ai.e2e-spec.ts — nenhum teste bate em API externa real.
//
// POST /scrape-jobs só é exercitado até o ponto de enfileirar (o
// `LeadScrapeQueueService` real grava na fila BullMQ/Redis real, mas nada
// consome — `apps/worker` é um processo separado, fora do escopo desta
// task/e2e, e Task 6 não depende de rodar o worker de verdade aqui). Para
// exercitar "lead aparece com score" o teste cria um lead MANUAL (mesmo
// endpoint que qualquer usuário usaria para cadastrar um lead achado fora do
// scraping automatizado) e pontua via POST /leads/:id/score — o cálculo em
// si (`scoreLead()`) já tem cobertura própria em
// packages/shared-types/src/lead-scoring.spec.ts e no unit test de
// `LeadsService.score`.
describe('Leads/Prospecção (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let apifyGateway: { searchBusinesses: jest.Mock };
  let exploriumGateway: { searchBusinesses: jest.Mock; matchBusiness: jest.Mock };
  let camofoxGateway: { search: jest.Mock };
  let gateway: { sendMessage: jest.Mock };

  beforeAll(async () => {
    apifyGateway = { searchBusinesses: jest.fn() };
    exploriumGateway = { searchBusinesses: jest.fn(), matchBusiness: jest.fn() };
    camofoxGateway = { search: jest.fn() };
    gateway = { sendMessage: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APIFY_GATEWAY)
      .useValue(apifyGateway)
      .overrideProvider(EXPLORIUM_GATEWAY)
      .useValue(exploriumGateway)
      .overrideProvider(CAMOFOX_GATEWAY)
      .useValue(camofoxGateway)
      .overrideProvider(AI_GATEWAY)
      .useValue(gateway satisfies AiGateway)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    apifyGateway.searchBusinesses.mockReset();
    exploriumGateway.searchBusinesses.mockReset();
    exploriumGateway.matchBusiness.mockReset();
    camofoxGateway.search.mockReset();
    gateway.sendMessage.mockReset();
  });

  it('fluxo completo: offering → scrape-job → lead pontuado → enrich → outreach draft → approve → mark-sent → convert', async () => {
    const owner = await registerUser(app, `leads-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    // 1. ServiceOffering com ICP simples (sem site é o sinal central da
    // feature, já embutido em `scoreLead()`).
    const offeringRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/service-offerings`)
      .set(auth)
      .send({
        name: 'Presença Online',
        description: 'Criamos site simples para negócios locais sem site.',
        signals: ['sem site'],
        targetIndustries: ['padaria'],
      })
      .expect(201);
    expect(offeringRes.body.id).toBeTruthy();
    expect(offeringRes.body.targetIndustries).toEqual(['padaria']);
    const offeringId = offeringRes.body.id as string;

    // 2. ScrapeJob — só até o ponto de "foi criado e enfileirado" (ver
    // comentário de topo desta suíte).
    const scrapeJobRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/scrape-jobs`)
      .set(auth)
      .send({
        sourceType: 'APIFY_GOOGLE_MAPS',
        city: 'São Paulo',
        state: 'SP',
        businessType: 'padaria',
      })
      .expect(201);
    expect(scrapeJobRes.body.status).toBe('QUEUED');

    // Rejeita MANUAL (não é uma fonte automatizável) com 400.
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/scrape-jobs`)
      .set(auth)
      .send({ sourceType: 'MANUAL', city: 'São Paulo', state: 'SP', businessType: 'padaria' })
      .expect(400);

    const scrapeJobListRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/scrape-jobs`)
      .set(auth)
      .expect(200);
    expect(scrapeJobListRes.body.some((j: { id: string }) => j.id === scrapeJobRes.body.id)).toBe(true);

    // 3. Lead manual (business sem site, categoria batendo com a offering).
    const leadRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads`)
      .set(auth)
      .send({
        name: 'Padaria da Esquina',
        city: 'São Paulo',
        state: 'SP',
        phone: '+55 11 90000-0000',
        googleCategory: 'padaria',
        rating: 4.6,
        reviewCount: 30,
        // Sem firmographics ainda (só depois do enrich no passo 5) — o
        // fallback de keyword-match de `scoreLead()` precisa de texto bruto
        // pra casar contra `ServiceOffering.signals` até lá.
        rawContent: 'Padaria tradicional do bairro, sem site próprio, muito bem avaliada.',
      })
      .expect(201);
    expect(leadRes.body.status).toBe('DISCOVERED');
    expect(leadRes.body.sourceType).toBe('MANUAL');
    const leadId = leadRes.body.id as string;

    const listRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/leads`)
      .set(auth)
      .expect(200);
    expect(listRes.body.some((l: { id: string }) => l.id === leadId)).toBe(true);

    // 4. Score — sem site (50) + industry match contra a offering (10+) >=
    // threshold(50) => QUALIFIED, suggestedOfferingId aponta pra offering.
    const scoreRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/score`)
      .set(auth)
      .expect(201);
    expect(scoreRes.body.score).toBeGreaterThanOrEqual(50);
    expect(scoreRes.body.status).toBe('QUALIFIED');
    expect(scoreRes.body.suggestedOfferingId).toBe(offeringId);

    // 5. Enrich manual — Explorium mockada encontra firmografia; score é
    // recalculado automaticamente ao final do enrich.
    exploriumGateway.matchBusiness.mockResolvedValueOnce({
      name: 'Padaria da Esquina',
      website: null,
      industry: 'padaria',
      employeeCount: 8,
      revenueUsd: 200_000,
      matchConfidence: 0.9,
      raw: {},
    });

    const enrichRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/enrich`)
      .set(auth)
      .expect(201);
    expect(exploriumGateway.matchBusiness).toHaveBeenCalledWith('Padaria da Esquina', null, null);
    expect(enrichRes.body.score).toBeGreaterThanOrEqual(50);
    expect(enrichRes.body.status).toBe('QUALIFIED');

    const enrichmentsInDb = await prisma.leadEnrichment.findMany({ where: { organizationId, leadId } });
    expect(enrichmentsInDb.some((e) => e.type === 'explorium_firmographics')).toBe(true);

    // 6. Análise de IA opt-in — AI_GATEWAY mockado, sem tools, grava
    // LeadEnrichment{type: ai_analysis} sem mutar o Lead.
    gateway.sendMessage.mockResolvedValueOnce(
      endTurn('Bom lead: não tem site e tem avaliação alta na categoria padaria.'),
    );
    const analyzeRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/analyze`)
      .set(auth)
      .expect(201);
    expect(analyzeRes.body.type).toBe('ai_analysis');
    expect(analyzeRes.body.data.text).toContain('não tem site');
    const analyzeCall = gateway.sendMessage.mock.calls.at(-1)?.[0];
    expect(analyzeCall.tools).toEqual([]);

    // 7. Outreach draft — AI_GATEWAY mockado, sem tools.
    gateway.sendMessage.mockResolvedValueOnce(
      endTurn('Olá! Vi que a Padaria da Esquina ainda não tem site, podemos ajudar.'),
    );
    const draftRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`)
      .set(auth)
      .send({ channel: 'WHATSAPP' })
      .expect(201);
    expect(draftRes.body.status).toBe('DRAFT');
    expect(draftRes.body.channel).toBe('WHATSAPP');
    const messageId = draftRes.body.id as string;

    const draftCall = gateway.sendMessage.mock.calls.at(-1)?.[0];
    expect(draftCall.tools).toEqual([]);

    const leadAfterDraftRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/leads/${leadId}`)
      .set(auth)
      .expect(200);
    expect(leadAfterDraftRes.body.status).toBe('OUTREACH_DRAFTED');

    const listForLeadRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`)
      .set(auth)
      .expect(200);
    expect(listForLeadRes.body.some((m: { id: string }) => m.id === messageId)).toBe(true);

    const globalQueueRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/outreach-messages?status=DRAFT`)
      .set(auth)
      .expect(200);
    expect(globalQueueRes.body.some((m: { id: string }) => m.id === messageId)).toBe(true);

    // 8. mark-sent ANTES de approve → 400 (viola a máquina de estado; hits
    // applyTransition -> updateMany com status = APPROVED, count 0).
    const prematureSentRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${messageId}/mark-sent`)
      .set(auth)
      .expect(400);
    expect(prematureSentRes.body.message).toMatch(/DRAFT/);

    const stillDraftRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/outreach-messages/${messageId}`)
      .set(auth)
      .expect(200);
    expect(stillDraftRes.body.status).toBe('DRAFT');

    // 9. approve → APPROVED + AuditLog actorType USER.
    const approveRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${messageId}/approve`)
      .set(auth)
      .expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.approvedByUserId).toBe(owner.userId);

    const approveAudit = await prisma.auditLog.findFirst({
      where: { organizationId, action: 'outreach.approve', resource: messageId },
    });
    expect(approveAudit).toBeTruthy();
    expect(approveAudit?.actorType).toBe('USER');
    expect(approveAudit?.actorId).toBe(owner.userId);

    // 10. mark-sent → SENT; Lead reflete CONTACTED.
    const sentRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${messageId}/mark-sent`)
      .set(auth)
      .expect(201);
    expect(sentRes.body.status).toBe('SENT');
    expect(sentRes.body.sentAt).toBeTruthy();

    const sentAudit = await prisma.auditLog.findFirst({
      where: { organizationId, action: 'outreach.mark-sent', resource: messageId },
    });
    expect(sentAudit).toBeTruthy();

    const leadAfterSentRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/leads/${leadId}`)
      .set(auth)
      .expect(200);
    expect(leadAfterSentRes.body.status).toBe('CONTACTED');

    // 11. convert-to-customer.
    const convertRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/convert`)
      .set(auth)
      .expect(201);
    expect(convertRes.body.name).toBe('Padaria da Esquina');
    expect(convertRes.body.company).toBe('Padaria da Esquina');
    expect(convertRes.body.status).toBe('LEAD');
    expect(convertRes.body.phone).toBe('+55 11 90000-0000');
    const customerId = convertRes.body.id as string;

    const leadAfterConvertRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/leads/${leadId}`)
      .set(auth)
      .expect(200);
    expect(leadAfterConvertRes.body.status).toBe('CONVERTED');
    expect(leadAfterConvertRes.body.convertedCustomerId).toBe(customerId);

    const convertAudit = await prisma.auditLog.findFirst({
      where: { organizationId, action: 'lead.converted', resource: `Lead:${leadId}` },
    });
    expect(convertAudit).toBeTruthy();

    // Converter de novo o mesmo lead é rejeitado com 409 (double-conversion).
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/convert`)
      .set(auth)
      .expect(409);

    const customerInDb = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
    expect(customerInDb).toBeTruthy();

    // 12. Isolamento multi-tenant: uma segunda organização, de outro dono,
    // não enxerga nenhum recurso da primeira nem acessa por ID direto.
    const otherOwner = await registerUser(app, `leads-owner2-${randomUUID()}@opsmind.test`);
    const otherOrganizationId = await createOrg(app, otherOwner.accessToken, 'Other Leads Co');
    expect(otherOrganizationId).not.toBe(organizationId);
    const otherAuth = { Authorization: `Bearer ${otherOwner.accessToken}` };

    const otherLeadsListRes = await request(app.getHttpServer())
      .get(`/organizations/${otherOrganizationId}/leads`)
      .set(otherAuth)
      .expect(200);
    expect(otherLeadsListRes.body).toEqual([]);

    await request(app.getHttpServer())
      .get(`/organizations/${otherOrganizationId}/leads/${leadId}`)
      .set(otherAuth)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/organizations/${otherOrganizationId}/service-offerings/${offeringId}`)
      .set(otherAuth)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/organizations/${otherOrganizationId}/outreach-messages/${messageId}`)
      .set(otherAuth)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/organizations/${otherOrganizationId}/scrape-jobs/${scrapeJobRes.body.id}`)
      .set(otherAuth)
      .expect(404);
  });

  it('reject bloqueia uma mensagem já APPROVED e regenerate cria um novo DRAFT a partir de uma mensagem rejeitada', async () => {
    const owner = await registerUser(app, `leads-owner3-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken, 'Leads Co Regenerate');
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const offeringRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/service-offerings`)
      .set(auth)
      .send({ name: 'Oferta X', signals: ['sinal-x'] })
      .expect(201);
    const offeringId = offeringRes.body.id as string;

    const leadRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads`)
      .set(auth)
      .send({ name: 'Oficina do Zé' })
      .expect(201);
    const leadId = leadRes.body.id as string;

    gateway.sendMessage.mockResolvedValueOnce(endTurn('rascunho 1'));
    const draftRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`)
      .set(auth)
      .send({ channel: 'EMAIL', serviceOfferingId: offeringId })
      .expect(201);
    const messageId = draftRes.body.id as string;

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${messageId}/approve`)
      .set(auth)
      .expect(201);

    // reject de uma mensagem já APPROVED → 400.
    const rejectRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${messageId}/reject`)
      .set(auth)
      .send({ reason: 'não relevante' })
      .expect(400);
    expect(rejectRes.body.message).toMatch(/APPROVED/);

    // Um segundo draft (mensagem nova) pode ser rejeitado normalmente, e
    // regenerate cria um terceiro DRAFT a partir dele.
    gateway.sendMessage.mockResolvedValueOnce(endTurn('rascunho 2'));
    const draft2Res = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/outreach-messages`)
      .set(auth)
      .send({ channel: 'EMAIL', serviceOfferingId: offeringId })
      .expect(201);
    const message2Id = draft2Res.body.id as string;

    gateway.sendMessage.mockResolvedValueOnce(endTurn('rascunho regenerado'));
    const regenerateRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/outreach-messages/${message2Id}/regenerate`)
      .set(auth)
      .expect(201);
    expect(regenerateRes.body.status).toBe('DRAFT');
    expect(regenerateRes.body.id).not.toBe(message2Id);

    const originalAfterRegenerate = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/outreach-messages/${message2Id}`)
      .set(auth)
      .expect(200);
    expect(originalAfterRegenerate.body.status).toBe('REJECTED');
  });

  // Fase 5b (2026-09) — descarte em lote por busca. Leads com scrapeJobId
  // real só existem via o worker (fora do escopo deste e2e, ver comentário
  // de topo do arquivo) — semeados direto via Prisma aqui (fora de contexto
  // de request HTTP, então sem `app.current_org_id` setado; RLS trata isso
  // como "sem contexto" e permite, mesma classe de exceção documentada em
  // `enable_row_level_security/migration.sql` para scripts/seed).
  it('discard-by-scrape-job: descarta só os leads pré-qualificação da própria organização, nunca de outra', async () => {
    const ownerA = await registerUser(app, `leads-discard-a-${randomUUID()}@opsmind.test`);
    const orgA = await createOrg(app, ownerA.accessToken, 'Leads Co Discard A');
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };

    const ownerB = await registerUser(app, `leads-discard-b-${randomUUID()}@opsmind.test`);
    const orgB = await createOrg(app, ownerB.accessToken, 'Leads Co Discard B');
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    const scrapeJobRes = await request(app.getHttpServer())
      .post(`/organizations/${orgA}/scrape-jobs`)
      .set(authA)
      .send({ sourceType: 'CAMOFOX_GOOGLE_SEARCH', city: 'São Paulo', state: 'SP', businessType: 'imobiliaria' })
      .expect(201);
    const scrapeJobId = scrapeJobRes.body.id as string;

    const [qualifiedLead, disqualifiedLead, alreadyDraftedLead] = await Promise.all([
      prisma.lead.create({
        data: { organizationId: orgA, scrapeJobId, name: 'Portal Lixo 1', status: 'QUALIFIED', actorType: 'USER' },
      }),
      prisma.lead.create({
        data: {
          organizationId: orgA,
          scrapeJobId,
          name: 'Portal Lixo 2',
          status: 'DISQUALIFIED',
          actorType: 'USER',
        },
      }),
      // Já avançou além da qualificação — nunca deve ser tocado pelo
      // descarte em lote, mesmo pertencendo à mesma busca.
      prisma.lead.create({
        data: {
          organizationId: orgA,
          scrapeJobId,
          name: 'Lead Já Em Andamento',
          status: 'OUTREACH_DRAFTED',
          actorType: 'USER',
        },
      }),
    ]);

    // Org B tentando descartar uma busca que não é dela: organizationId no
    // WHERE garante count 0, nenhum lead da org A é tocado.
    const crossTenantRes = await request(app.getHttpServer())
      .post(`/organizations/${orgB}/leads/discard-by-scrape-job`)
      .set(authB)
      .send({ scrapeJobId })
      .expect(201);
    expect(crossTenantRes.body.count).toBe(0);

    const stillQualified = await prisma.lead.findUnique({ where: { id: qualifiedLead.id } });
    expect(stillQualified?.status).toBe('QUALIFIED');

    // Org A descartando a própria busca: só os 2 leads pré-qualificação.
    const discardRes = await request(app.getHttpServer())
      .post(`/organizations/${orgA}/leads/discard-by-scrape-job`)
      .set(authA)
      .send({ scrapeJobId })
      .expect(201);
    expect(discardRes.body.count).toBe(2);

    const [afterQualified, afterDisqualified, afterDrafted] = await Promise.all([
      prisma.lead.findUnique({ where: { id: qualifiedLead.id } }),
      prisma.lead.findUnique({ where: { id: disqualifiedLead.id } }),
      prisma.lead.findUnique({ where: { id: alreadyDraftedLead.id } }),
    ]);
    expect(afterQualified?.status).toBe('DISQUALIFIED');
    expect(afterDisqualified?.status).toBe('DISQUALIFIED');
    // Nunca regride um lead que já passou de OUTREACH_DRAFTED+.
    expect(afterDrafted?.status).toBe('OUTREACH_DRAFTED');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { organizationId: orgA, action: 'lead.bulk_discarded', resource: `ScrapeJob:${scrapeJobId}` },
    });
    expect(auditEntry).toBeTruthy();

    // VIEWER não pode disparar a ação (WRITE_ROLES only).
    const viewer = await registerUser(app, `leads-discard-viewer-${randomUUID()}@opsmind.test`);
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/invite`)
      .set(authA)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const invitationToken = /token: (\S+)/.exec(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))?.at(1);
    logSpy.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set({ Authorization: `Bearer ${viewer.accessToken}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/leads/discard-by-scrape-job`)
      .set({ Authorization: `Bearer ${viewer.accessToken}` })
      .send({ scrapeJobId })
      .expect(403);
  });

  // Sinais de investigação de site (docs/planning/2026-11-06-harvey-inteligencia-comercial.md):
  // o profiler real roda em apps/worker (fora do escopo deste e2e, mesma
  // decisão já tomada para POST /scrape-jobs) — aqui gravamos um LeadSignal
  // direto via Prisma pra exercitar GET .../signals e checar isolamento
  // cross-tenant; POST .../investigate é exercitado só até o ponto de
  // enfileirar.
  it('GET .../signals lista sinais só da própria organização; POST .../investigate exige site e respeita WRITE_ROLES', async () => {
    const ownerA = await registerUser(app, `leads-signals-a-${randomUUID()}@opsmind.test`);
    const orgA = await createOrg(app, ownerA.accessToken, 'Leads Co Signals A');
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };

    const ownerB = await registerUser(app, `leads-signals-b-${randomUUID()}@opsmind.test`);
    const orgB = await createOrg(app, ownerB.accessToken, 'Leads Co Signals B');
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    const leadWithWebsite = await prisma.lead.create({
      data: { organizationId: orgA, name: 'Padaria com site', website: 'https://padaria-exemplo.com.br', status: 'DISCOVERED', actorType: 'USER' },
    });
    const leadWithoutWebsite = await prisma.lead.create({
      data: { organizationId: orgA, name: 'Padaria sem site', status: 'DISCOVERED', actorType: 'USER' },
    });

    await prisma.leadSignal.create({
      data: {
        organizationId: orgA,
        leadId: leadWithWebsite.id,
        signalCode: 'website.no_ssl',
        confidence: '1.0',
        collector: 'WEBSITE_PROFILER',
        evidenceUrl: leadWithWebsite.website,
        runId: randomUUID(),
      },
    });

    // Org A vê o próprio sinal.
    const listRes = await request(app.getHttpServer())
      .get(`/organizations/${orgA}/leads/${leadWithWebsite.id}/signals`)
      .set(authA)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].signalCode).toBe('website.no_ssl');

    // Org B pedindo o MESMO leadId pelo próprio path (:organizationId=orgB)
    // nunca encontra o lead — TenantGuard/findByIdOrThrow já filtram por
    // organizationId, isolamento valendo antes mesmo de chegar em LeadSignal.
    await request(app.getHttpServer())
      .get(`/organizations/${orgB}/leads/${leadWithWebsite.id}/signals`)
      .set(authB)
      .expect(404);

    // Investigar um lead sem site conhecido é rejeitado (nada a buscar).
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/leads/${leadWithoutWebsite.id}/investigate`)
      .set(authA)
      .expect(404);

    // Investigar um lead com site enfileira (não espera o worker rodar).
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/leads/${leadWithWebsite.id}/investigate`)
      .set(authA)
      .expect(201);

    // VIEWER não pode disparar investigação (WRITE_ROLES only), mas pode listar sinais (leitura).
    const viewer = await registerUser(app, `leads-signals-viewer-${randomUUID()}@opsmind.test`);
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/invite`)
      .set(authA)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const invitationToken = /token: (\S+)/.exec(logSpy.mock.calls.map((c) => c.join(' ')).join('\n'))?.at(1);
    logSpy.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set({ Authorization: `Bearer ${viewer.accessToken}` })
      .expect(201);
    const viewerAuth = { Authorization: `Bearer ${viewer.accessToken}` };

    await request(app.getHttpServer())
      .get(`/organizations/${orgA}/leads/${leadWithWebsite.id}/signals`)
      .set(viewerAuth)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgA}/leads/${leadWithWebsite.id}/investigate`)
      .set(viewerAuth)
      .expect(403);
  });

  // Harvey Fase 7 (docs/superpowers/sdd/2026-11-16-harvey-fase7-gatilho-qualificacao):
  // `LeadsService.score()` dispara um enqueue real em `website-profile`
  // quando um lead cruza pra QUALIFIED com site nunca investigado — a
  // bifurcação em si (mockada) já tem cobertura unitária em
  // `leads.service.spec.ts`; este teste prova que, contra o Postgres+Redis
  // reais deste e2e, o job realmente chega na fila BullMQ `website-profile`,
  // não uma dublagem. Mesma fixture de keyword-match (offering com
  // `signals: ['sem site']` + `rawContent` batendo) do teste de fluxo
  // completo acima, só com `website` preenchido — nenhum outro teste desta
  // suíte consome `website-profile` (o worker real é processo separado, ver
  // comentário de topo do arquivo), então o job fica parado em "waiting" até
  // a asserção abaixo rodar.
  it('POST /leads/:id/score que qualifica um lead com site nunca investigado enfileira um job real em website-profile', async () => {
    const owner = await registerUser(app, `leads-queue-trigger-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken, 'Leads Co Queue Trigger');
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const offeringRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/service-offerings`)
      .set(auth)
      .send({
        name: 'Presença Online',
        description: 'Criamos site simples para negócios locais sem site.',
        signals: ['sem site'],
        targetIndustries: ['padaria'],
      })
      .expect(201);
    const offeringId = offeringRes.body.id as string;

    const leadRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads`)
      .set(auth)
      .send({
        name: 'Padaria com Site e Sinal',
        website: 'https://padaria-com-site.example.com',
        googleCategory: 'padaria',
        rating: 4.6,
        reviewCount: 30,
        // Mesmo rawContent do teste de fluxo completo: casa com
        // `signals: ['sem site']` da offering via keyword-fallback
        // (`website` preenchido não afeta esse cálculo — só desabilita o
        // bucket `hasNoWebsitePoints`, que já não se aplica a fonte MANUAL).
        rawContent: 'Padaria tradicional do bairro, sem site próprio, muito bem avaliada.',
      })
      .expect(201);
    const leadId = leadRes.body.id as string;

    const scoreRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/leads/${leadId}/score`)
      .set(auth)
      .expect(201);
    expect(scoreRes.body.score).toBeGreaterThanOrEqual(50);
    expect(scoreRes.body.status).toBe('QUALIFIED');
    expect(scoreRes.body.suggestedOfferingId).toBe(offeringId);

    // Conexão BullMQ própria só pra inspecionar a fila real de teste (mesmo
    // Redis do `.env` de teste, via `WebsiteProfileQueueService` dentro da
    // app) — fechada no finally, nunca deixada aberta pro processo de teste.
    const connection = new IORedis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    const websiteProfileQueue = new Queue<WebsiteProfileJobData>(WEBSITE_PROFILE_QUEUE, { connection });
    try {
      const jobs = await websiteProfileQueue.getJobs(['waiting', 'active']);
      expect(jobs.some((job) => job.data.leadId === leadId)).toBe(true);
    } finally {
      await websiteProfileQueue.close();
      connection.disconnect();
    }
  });

  // Governança de vocabulário de SignalCode (docs/superpowers/sdd/
  // 2026-11-16-signal-codes-e-reddit-watch-ui): propor é WRITE_ROLES comum,
  // mas confirmar (promover PROPOSED -> CONFIRMED, efeito dura em todo o
  // scoring da organização) exige MANAGER ou acima — mais restrito que o
  // resto do módulo de leads.
  it('POST /signal-codes — MEMBER consegue propor, VIEWER recebe 403', async () => {
    const owner = await createLoggedInUser(app, prisma, `sc-rbac-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken, 'Leads Co Signal Codes RBAC');
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };

    const member = await createLoggedInUser(app, prisma, `sc-rbac-member-${randomUUID()}@opsmind.test`);
    const logSpyMember = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    const memberInvitationToken = /token: (\S+)/.exec(
      logSpyMember.mock.calls.map((c) => c.join(' ')).join('\n'),
    )?.at(1);
    logSpyMember.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${memberInvitationToken}/accept`)
      .set({ Authorization: `Bearer ${member.accessToken}` })
      .expect(201);
    const memberToken = member.accessToken;

    const viewer = await createLoggedInUser(app, prisma, `sc-rbac-viewer-${randomUUID()}@opsmind.test`);
    const logSpyViewer = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const viewerInvitationToken = /token: (\S+)/.exec(
      logSpyViewer.mock.calls.map((c) => c.join(' ')).join('\n'),
    )?.at(1);
    logSpyViewer.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${viewerInvitationToken}/accept`)
      .set({ Authorization: `Bearer ${viewer.accessToken}` })
      .expect(201);
    const viewerToken = viewer.accessToken;

    // Código único por execução — `SignalCode.code` é globalmente único
    // (não escopado por organização), então um literal fixo colidiria entre
    // reexecuções locais contra o mesmo Postgres persistente.
    const memberResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/signal-codes`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ code: `TESTE_RBAC_${randomUUID()}`, label: 'Teste RBAC', category: 'teste' });
    expect(memberResponse.status).toBe(201);

    const viewerResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/signal-codes`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ code: `TESTE_RBAC_${randomUUID()}`, label: 'Teste', category: 'teste' });
    expect(viewerResponse.status).toBe(403);
  });

  it('POST /signal-codes/:code/confirm — exige MANAGER ou acima, MEMBER recebe 403', async () => {
    const owner = await createLoggedInUser(
      app,
      prisma,
      `sc-confirm-owner-${randomUUID()}@opsmind.test`,
    );
    const organizationId = await createOrg(app, owner.accessToken, 'Leads Co Signal Codes Confirm');
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const ownerToken = owner.accessToken;

    const member = await createLoggedInUser(
      app,
      prisma,
      `sc-confirm-member-${randomUUID()}@opsmind.test`,
    );
    const logSpyMember = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: member.email, role: 'MEMBER' })
      .expect(201);
    const memberInvitationToken = /token: (\S+)/.exec(
      logSpyMember.mock.calls.map((c) => c.join(' ')).join('\n'),
    )?.at(1);
    logSpyMember.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${memberInvitationToken}/accept`)
      .set({ Authorization: `Bearer ${member.accessToken}` })
      .expect(201);
    const memberToken = member.accessToken;

    const manager = await createLoggedInUser(
      app,
      prisma,
      `sc-confirm-mgr-${randomUUID()}@opsmind.test`,
    );
    const logSpyManager = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: manager.email, role: 'MANAGER' })
      .expect(201);
    const managerInvitationToken = /token: (\S+)/.exec(
      logSpyManager.mock.calls.map((c) => c.join(' ')).join('\n'),
    )?.at(1);
    logSpyManager.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${managerInvitationToken}/accept`)
      .set({ Authorization: `Bearer ${manager.accessToken}` })
      .expect(201);
    const managerToken = manager.accessToken;

    // Mesmo motivo do teste anterior: código único por execução.
    const code = `TESTE_CONFIRM_${randomUUID()}`;
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/signal-codes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ code, label: 'Teste', category: 'teste' });

    const memberResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/signal-codes/${code}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(memberResponse.status).toBe(403);

    const managerResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/signal-codes/${code}/confirm`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerResponse.status).toBe(200);
    expect(managerResponse.body.status).toBe('CONFIRMED');
  });

  // C1 — `SignalCode.code` é PK global no Postgres, mas RLS esconde da
  // organização B um código já proposto pela organização A: sem o fix
  // (createMany + skipDuplicates), a tentativa da org B estourava a
  // constraint única real (P2002) como 500 bruto. Usa `createLoggedInUser`
  // (não `registerUser`) pelo mesmo motivo documentado no topo do arquivo —
  // dois donos de organização a mais estourariam o throttle de /auth/register.
  it('POST /signal-codes — código colidindo entre organizações diferentes dá erro claro (não 500) e não revela o código da outra organização', async () => {
    const ownerA = await createLoggedInUser(app, prisma, `sc-collide-a-${randomUUID()}@opsmind.test`);
    const organizationA = await createOrg(app, ownerA.accessToken, 'Leads Co Collide A');
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };

    const ownerB = await createLoggedInUser(app, prisma, `sc-collide-b-${randomUUID()}@opsmind.test`);
    const organizationB = await createOrg(app, ownerB.accessToken, 'Leads Co Collide B');
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    const code = `TESTE_COLLIDE_${randomUUID()}`;

    const firstResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationA}/signal-codes`)
      .set(authA)
      .send({ code, label: 'Rótulo da organização A', category: 'teste' });
    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.status).toBe('PROPOSED');

    const collisionResponse = await request(app.getHttpServer())
      .post(`/organizations/${organizationB}/signal-codes`)
      .set(authB)
      .send({ code, label: 'Rótulo da organização B', category: 'teste' });

    expect(collisionResponse.status).toBeGreaterThanOrEqual(400);
    expect(collisionResponse.status).toBeLessThan(500);
    const collisionMessage = JSON.stringify(collisionResponse.body);
    expect(collisionMessage).not.toContain('PROPOSED');
    expect(collisionMessage).not.toContain('CONFIRMED');
    expect(collisionMessage).not.toContain('status:');

    // Org B nunca vê o código que a org A propôs (RLS continua escondendo).
    const listB = await request(app.getHttpServer())
      .get(`/organizations/${organizationB}/signal-codes`)
      .set(authB)
      .expect(200);
    expect(listB.body.find((sc: { code: string }) => sc.code === code)).toBeUndefined();
  });
});
