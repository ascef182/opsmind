import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { APIFY_GATEWAY, CAMOFOX_GATEWAY, EXPLORIUM_GATEWAY } from '@opsmind/integrations';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AI_GATEWAY, type AiGateway } from '../src/modules/ai/gateway/ai-gateway.interface';
import { registerUser } from './helpers/auth';

async function createOrg(app: INestApplication, accessToken: string, name = 'Leads Co') {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name, slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

function endTurn(text: string, inputTokens = 100, outputTokens = 50) {
  return {
    id: `msg_${randomUUID()}`,
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
      endTurn('Olá! Vi que a Padaria da Esquina ainda não tem site — podemos ajudar.'),
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
});
