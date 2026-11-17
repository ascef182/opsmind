import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { registerUser } from './helpers/auth';

// Revenue Engine, Fase 1: histórico de estágios gravado por toda mudança de
// status, leituras do painel, configuração (outreach nasce pausado) e
// isolamento entre organizações das tabelas novas — contra Postgres/Redis
// reais, sem gateways externos (nenhum fluxo aqui chama IA ou scraping).
describe('Revenue Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOrg(accessToken: string, name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set({ Authorization: `Bearer ${accessToken}` })
      .send({ name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}` })
      .expect(201);
    return res.body.id;
  }

  it('grava uma transição por mudança de estágio e o funil reflete lead → deal → WON', async () => {
    const owner = await registerUser(app, `revenue-owner-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Revenue Co');
    const base = `/organizations/${organizationId}`;

    const lead = await request(app.getHttpServer())
      .post(`${base}/leads`)
      .set(auth)
      .send({ name: 'Smile Dental', city: 'Austin', state: 'TX' })
      .expect(201);
    const leadId = lead.body.id;

    await request(app.getHttpServer()).patch(`${base}/leads/${leadId}`).set(auth).send({ status: 'QUALIFIED' }).expect(200);
    // Mesmo status de novo: não é transição.
    await request(app.getHttpServer()).patch(`${base}/leads/${leadId}`).set(auth).send({ status: 'QUALIFIED' }).expect(200);
    await request(app.getHttpServer()).post(`${base}/leads/${leadId}/convert`).set(auth).send({}).expect(201);

    const deal = await prisma.deal.findFirstOrThrow({ where: { organizationId, originLeadId: leadId } });
    await request(app.getHttpServer())
      .post(`${base}/deals/${deal.id}/move-stage`)
      .set(auth)
      .send({ stage: 'PROPOSAL' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/deals/${deal.id}/move-stage`)
      .set(auth)
      .send({ stage: 'NEGOTIATION' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/deals/${deal.id}/move-stage`)
      .set(auth)
      .send({ stage: 'WON' })
      .expect(201);

    const transitions = await prisma.pipelineStageTransition.findMany({
      where: { organizationId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(transitions.map((t) => t.toStage)).toEqual([
      'DISCOVERED',
      'QUALIFIED',
      'MEETING_SCHEDULED',
      'PROPOSAL_SENT',
      'NEGOTIATION',
      'WON',
    ]);
    expect(transitions.every((t) => t.leadId === leadId)).toBe(true);

    const pipeline = await request(app.getHttpServer()).get(`${base}/revenue/pipeline`).set(auth).expect(200);
    expect(pipeline.body.stages).toHaveLength(15);
    const byStage = Object.fromEntries(
      pipeline.body.stages.map((s: { stage: string }) => [s.stage, s]),
    ) as Record<string, { current: number; entered: number; conversionRate: number | null }>;
    expect(byStage.WON!.current).toBe(1);
    expect(byStage.QUALIFIED!.current).toBe(0);
    expect(byStage.QUALIFIED!.entered).toBe(1);
    expect(byStage.QUALIFIED!.conversionRate).toBe(1);

    const overview = await request(app.getHttpServer())
      .get(`${base}/revenue/overview?period=day`)
      .set(auth)
      .expect(200);
    expect(overview.body.kpis.discovered.current).toBe(1);
    expect(overview.body.kpis.qualified.current).toBe(1);
    expect(overview.body.kpis.dealsWon.current).toBe(1);
    expect(overview.body.kpis.positiveReplies.availableFromPhase).toBe(4);

    await request(app.getHttpServer()).get(`${base}/revenue/overview?period=year`).set(auth).expect(400);

    const costs = await request(app.getHttpServer()).get(`${base}/revenue/costs`).set(auth).expect(200);
    expect(costs.body.daily).toHaveLength(30);
    expect(costs.body.totalUsd).toBe(0);
  });

  it('outreach nasce pausado: envio real é recusado até um OWNER liberar', async () => {
    const owner = await registerUser(app, `revenue-pause-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Pause Co');
    const base = `/organizations/${organizationId}`;

    const settings = await request(app.getHttpServer()).get(`${base}/revenue/settings`).set(auth).expect(200);
    expect(settings.body).toEqual(
      expect.objectContaining({ outreachPaused: true, dailySendLimit: 20, engineMonthlyBudgetUsd: 50 }),
    );

    const lead = await request(app.getHttpServer())
      .post(`${base}/leads`)
      .set(auth)
      .send({ name: 'Green Lawn Care', email: 'owner@greenlawn.test' })
      .expect(201);
    const message = await prisma.outreachMessage.create({
      data: {
        organizationId,
        leadId: lead.body.id,
        channel: 'EMAIL',
        subject: 'Hi',
        body: 'Hello',
        evidenceQuotes: [],
        status: 'APPROVED',
        actorType: 'AI',
      },
    });

    const refused = await request(app.getHttpServer())
      .post(`${base}/outreach-messages/${message.id}/send`)
      .set(auth)
      .expect(403);
    expect(refused.body.message).toMatch(/pausado/);
    const unchanged = await prisma.outreachMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(unchanged.status).toBe('APPROVED');

    const updated = await request(app.getHttpServer())
      .patch(`${base}/revenue/settings`)
      .set(auth)
      .send({ outreachPaused: false, dailySendLimit: 5 })
      .expect(200);
    expect(updated.body).toEqual(expect.objectContaining({ outreachPaused: false, dailySendLimit: 5 }));

    await request(app.getHttpServer())
      .patch(`${base}/revenue/settings`)
      .set(auth)
      .send({ dailySendLimit: 100000 })
      .expect(400);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId, action: 'revenue.settings_updated' },
    });
    expect(audit).not.toBeNull();
  });

  it('outra organização não lê nem altera o Revenue Engine alheio', async () => {
    const owner = await registerUser(app, `revenue-a-${randomUUID()}@opsmind.test`);
    const outsider = await registerUser(app, `revenue-b-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(owner.accessToken, 'Tenant A');
    await createOrg(outsider.accessToken, 'Tenant B');
    const outsiderAuth = { Authorization: `Bearer ${outsider.accessToken}` };
    const base = `/organizations/${organizationId}/revenue`;

    await request(app.getHttpServer()).get(`${base}/overview`).set(outsiderAuth).expect(403);
    await request(app.getHttpServer()).get(`${base}/pipeline`).set(outsiderAuth).expect(403);
    await request(app.getHttpServer()).get(`${base}/costs`).set(outsiderAuth).expect(403);
    await request(app.getHttpServer())
      .patch(`${base}/settings`)
      .set(outsiderAuth)
      .send({ outreachPaused: false })
      .expect(403);
  });
});
