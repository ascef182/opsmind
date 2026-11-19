import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { OutreachAutodraftConsumer } from '../src/modules/leads/outreach-autodraft.consumer';
import { OutreachDispatchService } from '../src/modules/leads/outreach-dispatch.service';
import { HarveyEventsPublisher } from '../src/modules/harvey/harvey-events.publisher';
import { OutreachService } from '../src/modules/leads/outreach.service';
import { registerUser } from './helpers/auth';

// Harvey Fase 1 contra Postgres/Redis reais: comandos, pausa respeitada pelo
// backend, operador humano livre, RBAC, isolamento entre organizações (RLS) e
// entrega em tempo real. Nenhum fluxo aqui chama IA ou provedor externo.
describe('Harvey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

  async function createCampaign(auth: { Authorization: string }, base: string, segment = 'Dentista') {
    const res = await request(app.getHttpServer())
      .post(`${base}/revenue/campaigns`)
      .set(auth)
      .send({ segment, city: 'Campinas', state: 'SP' })
      .expect(201);
    return res.body as { id: string; name: string };
  }

  async function command(auth: { Authorization: string }, base: string, cmd: string, expected = 201) {
    return request(app.getHttpServer()).post(`${base}/revenue/harvey/commands`).set(auth).send({ command: cmd }).expect(expected);
  }

  it('nova organização nasce sem campanhas e com o Harvey parado', async () => {
    const owner = await registerUser(app, `harvey-new-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Harvey New');
    const base = `/organizations/${organizationId}`;

    const snapshot = await request(app.getHttpServer()).get(`${base}/revenue/harvey`).set(auth).expect(200);
    expect(snapshot.body).toEqual(expect.objectContaining({ status: 'IDLE', controlState: 'STOPPED' }));
    expect(snapshot.body.runs).toHaveLength(0);
    const empty = await request(app.getHttpServer()).get(`${base}/revenue/campaigns`).set(auth).expect(200);
    expect(empty.body).toEqual([]);

    await createCampaign(auth, base);
    const after = await request(app.getHttpServer()).get(`${base}/revenue/harvey`).set(auth).expect(200);
    expect(after.body.runs[0]).toEqual(expect.objectContaining({ campaignName: 'Dentista — Campinas/SP', status: null }));
    const campaigns = await request(app.getHttpServer()).get(`${base}/revenue/campaigns`).set(auth).expect(200);
    expect(campaigns.body).toEqual([
      expect.objectContaining({ kind: 'STANDARD', dailyResearchGoal: 30, enabledChannels: ['EMAIL'], timezone: 'America/Sao_Paulo' }),
    ]);
  });

  it('iniciar → pausar bloqueia trabalho automático, operador humano segue livre → retomar → parar', async () => {
    const owner = await registerUser(app, `harvey-flow-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Harvey Flow');
    const base = `/organizations/${organizationId}`;

    const started = await command(auth, base, 'START');
    expect(started.body.controlState).toBe('ACTIVE');
    await command(auth, base, 'START', 409);

    const paused = await command(auth, base, 'PAUSE');
    expect(paused.body).toEqual(expect.objectContaining({ controlState: 'PAUSED', status: 'PAUSED' }));

    const lead = await request(app.getHttpServer())
      .post(`${base}/leads`)
      .set(auth)
      .send({ name: 'Smile Dental', email: 'owner@smile.test', whatsapp: '5511999999999' })
      .expect(201);
    await prisma.lead.update({ where: { id: lead.body.id }, data: { status: 'QUALIFIED' } });

    // Rascunho automático é adiado com o Harvey pausado — e a IA nem é chamada.
    const outreachService = app.get(OutreachService);
    const generateDraft = jest.spyOn(outreachService, 'generateDraft');
    await app.get(OutreachAutodraftConsumer).process({
      id: 'e2e-job',
      data: { organizationId, leadId: lead.body.id, channel: 'WHATSAPP', trigger: 'AUTOMATIC' },
      opts: {},
    } as never);
    expect(generateDraft).not.toHaveBeenCalled();
    generateDraft.mockRestore();
    const skipped = await prisma.harveyActivity.findFirst({
      where: { organizationId, type: 'outreach.draft', status: 'SKIPPED' },
    });
    expect(skipped?.result).toEqual({ reason: 'AGENT_PAUSED' });

    // Envio iniciado pelo Harvey é recusado na verificação final e volta a APPROVED.
    await request(app.getHttpServer()).patch(`${base}/revenue/settings`).set(auth).send({ outreachPaused: false }).expect(200);
    await prisma.organization.update({ where: { id: organizationId }, data: { outreachPhysicalAddress: 'Rua X, 1' } });
    const message = await prisma.outreachMessage.create({
      data: {
        organizationId,
        leadId: lead.body.id,
        campaignId: lead.body.campaignId,
        channel: 'EMAIL',
        subject: 'Oi',
        body: 'Olá',
        evidenceQuotes: [],
        status: 'APPROVED',
        actorType: 'AI',
      },
    });
    await expect(
      app.get(OutreachDispatchService).dispatch(organizationId, message.id, { type: 'HARVEY' }),
    ).rejects.toThrow(/Harvey pausado/);
    const afterBlock = await prisma.outreachMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(afterBlock.status).toBe('APPROVED');
    expect(afterBlock.sendClaimedAt).toBeNull();

    // O mesmo envio feito por uma pessoa não depende do Harvey (provedor de e-mail
    // de teste = console): sai uma vez e não sai de novo.
    await request(app.getHttpServer()).post(`${base}/outreach-messages/${message.id}/send`).set(auth).expect(201);
    const sent = await prisma.outreachMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(sent.status).toBe('SENT');
    await request(app.getHttpServer()).post(`${base}/outreach-messages/${message.id}/send`).set(auth).expect(409);

    const resumed = await command(auth, base, 'RESUME');
    expect(resumed.body.controlState).toBe('ACTIVE');

    const stopped = await command(auth, base, 'STOP');
    expect(stopped.body).toEqual(expect.objectContaining({ controlState: 'STOPPED', status: 'STOPPED' }));
    await command(auth, base, 'PAUSE', 409);

    const audit = await prisma.auditLog.findMany({
      where: { organizationId, action: { startsWith: 'harvey.command.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((row) => row.action)).toEqual([
      'harvey.command.start',
      'harvey.command.pause',
      'harvey.command.resume',
      'harvey.command.stop',
    ]);

    const activities = await request(app.getHttpServer()).get(`${base}/revenue/harvey/activities`).set(auth).expect(200);
    expect(activities.body.items.map((item: { type: string }) => item.type)).toEqual(
      expect.arrayContaining(['control.command', 'outreach.draft', 'outreach.send_blocked', 'outreach.sent']),
    );
  });

  it('SEND_UNKNOWN: pessoa resolve como não enviado e a mensagem volta a poder ser enviada', async () => {
    const owner = await registerUser(app, `harvey-unknown-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Harvey Unknown');
    const base = `/organizations/${organizationId}`;
    const lead = await request(app.getHttpServer()).post(`${base}/leads`).set(auth).send({ name: 'Arena Fit' }).expect(201);
    const message = await prisma.outreachMessage.create({
      data: {
        organizationId,
        leadId: lead.body.id,
        campaignId: lead.body.campaignId,
        channel: 'EMAIL',
        body: 'x',
        evidenceQuotes: [],
        status: 'SEND_UNKNOWN',
        sendClaimedAt: new Date(),
        actorType: 'AI',
      },
    });

    await request(app.getHttpServer())
      .post(`${base}/outreach-messages/${message.id}/resolve-unknown`)
      .set(auth)
      .send({ outcome: 'MAYBE' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/outreach-messages/${message.id}/resolve-unknown`)
      .set(auth)
      .send({ outcome: 'NOT_SENT' })
      .expect(201);
    const resolved = await prisma.outreachMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(resolved.status).toBe('APPROVED');
  });

  it('só OWNER/ADMIN comandam o Harvey e editam campanhas; membros leem', async () => {
    const owner = await registerUser(app, `harvey-rbac-owner-${randomUUID()}@opsmind.test`);
    const member = await registerUser(app, `harvey-rbac-member-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(owner.accessToken, 'Harvey RBAC');
    await prisma.membership.create({ data: { organizationId, userId: member.userId, role: 'MEMBER' } });
    const memberAuth = { Authorization: `Bearer ${member.accessToken}` };
    const base = `/organizations/${organizationId}`;

    await request(app.getHttpServer()).get(`${base}/revenue/harvey`).set(memberAuth).expect(200);
    await command(memberAuth, base, 'START', 403);
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const campaign = await createCampaign(ownerAuth, base);
    await request(app.getHttpServer()).get(`${base}/revenue/campaigns`).set(memberAuth).expect(200);
    await request(app.getHttpServer())
      .post(`${base}/revenue/campaigns`)
      .set(memberAuth)
      .send({ segment: 'Padaria', city: 'Santos', state: 'SP' })
      .expect(403);
    await request(app.getHttpServer()).post(`${base}/revenue/campaigns/${campaign.id}/pause`).set(memberAuth).expect(403);
    await request(app.getHttpServer())
      .patch(`${base}/revenue/campaigns/${campaign.id}`)
      .set(memberAuth)
      .send({ dailyResearchGoal: 5 })
      .expect(403);
  });

  it('valida campanha: fuso inválido, janela invertida e canal não conectado', async () => {
    const owner = await registerUser(app, `harvey-camp-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const organizationId = await createOrg(owner.accessToken, 'Harvey Campaign');
    const base = `/organizations/${organizationId}/revenue/campaigns`;
    const campaign = await createCampaign(auth, `/organizations/${organizationId}`);

    await request(app.getHttpServer()).patch(`${base}/${campaign.id}`).set(auth).send({ timezone: 'Mars/Base' }).expect(400);
    await request(app.getHttpServer()).patch(`${base}/${campaign.id}`).set(auth).send({ workEndMinute: 300 }).expect(400);
    await request(app.getHttpServer())
      .patch(`${base}/${campaign.id}`)
      .set(auth)
      .send({ enabledChannels: ['EMAIL', 'WHATSAPP'] })
      .expect(400);
    const ok = await request(app.getHttpServer())
      .patch(`${base}/${campaign.id}`)
      .set(auth)
      .send({ dailyResearchGoal: 12, timezone: 'America/Sao_Paulo', workingDays: [1, 2, 3] })
      .expect(200);
    expect(ok.body).toEqual(expect.objectContaining({ dailyResearchGoal: 12, workingDays: [1, 2, 3] }));
  });

  it('outra organização não lê nem comanda o Harvey alheio, nem via RLS', async () => {
    const owner = await registerUser(app, `harvey-a-${randomUUID()}@opsmind.test`);
    const outsider = await registerUser(app, `harvey-b-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(owner.accessToken, 'Harvey Tenant A');
    const otherOrgId = await createOrg(outsider.accessToken, 'Harvey Tenant B');
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const outsiderAuth = { Authorization: `Bearer ${outsider.accessToken}` };
    const base = `/organizations/${organizationId}`;

    await command(ownerAuth, base, 'START');
    const campaign = await createCampaign(ownerAuth, base);

    await request(app.getHttpServer()).get(`${base}/revenue/harvey`).set(outsiderAuth).expect(403);
    await request(app.getHttpServer()).get(`${base}/revenue/harvey/activities`).set(outsiderAuth).expect(403);
    await request(app.getHttpServer()).get(`${base}/revenue/harvey/stream`).set(outsiderAuth).expect(403);
    await command(outsiderAuth, base, 'PAUSE', 403);
    await request(app.getHttpServer()).get(`${base}/revenue/campaigns`).set(outsiderAuth).expect(403);
    // A campanha de A não pode ser usada num alvo de B (a FK aceitaria o id).
    await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/prospecting-targets`)
      .set(outsiderAuth)
      .send({ city: 'Austin', state: 'TX', businessType: 'dentist', campaignId: campaign.id, isActive: false })
      .expect(404);

    await prisma.harveyRun.create({
      data: { organizationId, campaignId: campaign.id, cycleDate: new Date('2026-01-05'), goals: {} },
    });
    // RLS: com o contexto de B, as 4 tabelas do Harvey de A ficam invisíveis.
    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${otherOrgId}, true)`;
      return {
        campaigns: await tx.salesCampaign.count({ where: { organizationId } }),
        agents: await tx.harveyAgent.count({ where: { organizationId } }),
        runs: await tx.harveyRun.count({ where: { organizationId } }),
        activities: await tx.harveyActivity.count({ where: { organizationId } }),
      };
    });
    expect(visible).toEqual({ campaigns: 0, agents: 0, runs: 0, activities: 0 });
    const own = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
      return tx.harveyActivity.count({ where: { organizationId } });
    });
    expect(own).toBeGreaterThan(0);
  });

  it('stream entrega em tempo real só os eventos da própria organização', async () => {
    const owner = await registerUser(app, `harvey-sse-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(owner.accessToken, 'Harvey Stream');
    const otherOrgId = randomUUID();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/organizations/${organizationId}/revenue/harvey/stream`, {
      headers: { Authorization: `Bearer ${owner.accessToken}`, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();

    const publisher = app.get(HarveyEventsPublisher);
    // A assinatura Redis é criada na abertura do stream: espera ela ficar pronta.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await publisher.publish(otherOrgId, { kind: 'status.changed' });
    await publisher.publish(organizationId, {
      kind: 'activity',
      activity: { id: 'evt-own', organizationId, title: 'Pesquisando dentistas' } as never,
    });

    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('evt-own')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    controller.abort();
    expect(received).toContain('event: activity');
    expect(received).toContain('id: evt-own');
    expect(received).not.toContain('status.changed');
  });
});
