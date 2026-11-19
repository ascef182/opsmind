import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { recordCampaignLead } from '@opsmind/database';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { registerUser } from './helpers/auth';

// Campanhas de prospecção contra Postgres/Redis reais. Nenhum teste aqui
// dispara busca em provedor externo: alvos são criados inativos e a ingestão
// é simulada pelo mesmo helper que o worker usa (recordCampaignLead).
describe('Campanhas de prospecção (e2e)', () => {
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

  async function setupOrg(label: string) {
    const owner = await registerUser(app, `campaigns-${label}-${randomUUID()}@opsmind.test`);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set(auth)
      .send({ name: `Campanhas ${label}`, slug: `campanhas-${label}-${randomUUID()}` })
      .expect(201);
    return { auth, organizationId: res.body.id as string, base: `/organizations/${res.body.id}`, userId: owner.userId };
  }

  async function seedLead(organizationId: string, data: { name: string; website?: string; phone?: string; city?: string }) {
    return prisma.lead.create({
      data: { organizationId, sourceType: 'APIFY_GOOGLE_MAPS', actorType: 'SYSTEM', status: 'QUALIFIED', score: 70, ...data },
    });
  }

  it('alvos com a mesma identidade (maiúsculas, acento, estado por extenso) caem na mesma campanha', async () => {
    const { auth, base } = await setupOrg('identity');
    const first = await request(app.getHttpServer())
      .post(`${base}/prospecting-targets`)
      .set(auth)
      .send({ businessType: 'Metalúrgica', city: 'Presidente Prudente', state: 'SP', isActive: false })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`${base}/prospecting-targets`)
      .set(auth)
      .send({
        businessType: 'metalurgica',
        city: 'presidente prudente',
        state: 'São Paulo',
        sourceType: 'CAMOFOX_GOOGLE_SEARCH',
        isActive: false,
      })
      .expect(201);
    expect(second.body.campaignId).toBe(first.body.campaignId);

    const campaign = await request(app.getHttpServer()).get(`${base}/revenue/campaigns/${first.body.campaignId}`).set(auth).expect(200);
    expect(campaign.body).toEqual(
      expect.objectContaining({
        name: 'Metalúrgica — Presidente Prudente/SP',
        kind: 'STANDARD',
        creationSource: 'AUTO_FROM_SEARCH',
        targetCount: 2,
        timezone: 'America/Sao_Paulo',
      }),
    );

    // Criar na mão a mesma campanha viva é recusado.
    await request(app.getHttpServer())
      .post(`${base}/revenue/campaigns`)
      .set(auth)
      .send({ segment: 'Metalurgica', city: 'Presidente Prudente', state: 'SP' })
      .expect(409);
  });

  it('ciclo de vida: pausar, retomar, finalizar, reabrir, arquivar; busca avulsa não reabre finalizada sozinha', async () => {
    const { auth, base } = await setupOrg('lifecycle');
    const created = await request(app.getHttpServer())
      .post(`${base}/revenue/campaigns`)
      .set(auth)
      .send({ segment: 'Padaria', city: 'Santos', state: 'SP' })
      .expect(201);
    const url = `${base}/revenue/campaigns/${created.body.id}`;
    expect(created.body.creationSource).toBe('USER');

    expect((await request(app.getHttpServer()).post(`${url}/pause`).set(auth).expect(201)).body.status).toBe('PAUSED');
    await request(app.getHttpServer()).post(`${url}/pause`).set(auth).expect(409);
    expect((await request(app.getHttpServer()).post(`${url}/resume`).set(auth).expect(201)).body.status).toBe('ACTIVE');
    expect((await request(app.getHttpServer()).post(`${url}/complete`).set(auth).expect(201)).body.status).toBe('COMPLETED');

    await request(app.getHttpServer())
      .post(`${base}/prospecting-targets`)
      .set(auth)
      .send({ businessType: 'padaria', city: 'Santos', state: 'SP', isActive: false })
      .expect(409);

    expect((await request(app.getHttpServer()).post(`${url}/reopen`).set(auth).expect(201)).body.status).toBe('PAUSED');
    expect((await request(app.getHttpServer()).post(`${url}/archive`).set(auth).expect(201)).body.status).toBe('ARCHIVED');
    await request(app.getHttpServer()).post(`${url}/resume`).set(auth).expect(409);
    await request(app.getHttpServer()).post(`${url}/explode`).set(auth).expect(400);

    const overview = await request(app.getHttpServer()).get(`${base}/revenue/campaigns/overview`).set(auth).expect(200);
    expect(overview.body.items.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
    const archived = await request(app.getHttpServer())
      .get(`${base}/revenue/campaigns/overview?status=ARCHIVED`)
      .set(auth)
      .expect(200);
    expect(archived.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
  });

  it('a mesma empresa em duas campanhas é um lead só, com histórico de participação preservado', async () => {
    const { auth, base, organizationId } = await setupOrg('participation');
    const a = (await request(app.getHttpServer()).post(`${base}/revenue/campaigns`).set(auth).send({ segment: 'Clínica', city: 'Campinas', state: 'SP' }).expect(201)).body;
    const b = (await request(app.getHttpServer()).post(`${base}/revenue/campaigns`).set(auth).send({ segment: 'Clínica médica', city: 'Campinas', state: 'SP' }).expect(201)).body;
    const lead = await seedLead(organizationId, { name: 'Clínica Para Família', city: 'Campinas' });
    const job = (id: string) =>
      prisma.scrapeJob.create({
        data: {
          organizationId,
          campaignId: id,
          sourceType: 'APIFY_GOOGLE_MAPS',
          city: 'Campinas',
          state: 'SP',
          businessType: 'Clínica',
          status: 'COMPLETED',
          actorType: 'SYSTEM',
        },
      });
    const job1 = await job(a.id);
    const job2 = await job(a.id);
    const jobB = await job(b.id);
    const firstAt = new Date('2026-11-01T10:00:00Z');

    await recordCampaignLead(prisma, { organizationId, campaignId: a.id, leadId: lead.id, origin: 'SEARCH', scrapeJobId: job1.id, foundAt: firstAt });
    // Reprocessar a mesma busca (retry) não conta de novo.
    await recordCampaignLead(prisma, { organizationId, campaignId: a.id, leadId: lead.id, origin: 'SEARCH', scrapeJobId: job1.id });
    await recordCampaignLead(prisma, { organizationId, campaignId: a.id, leadId: lead.id, origin: 'MANUAL', scrapeJobId: job2.id });
    await recordCampaignLead(prisma, { organizationId, campaignId: b.id, leadId: lead.id, origin: 'SEARCH', scrapeJobId: jobB.id });

    const rows = await prisma.campaignLead.findMany({ where: { leadId: lead.id }, orderBy: { firstFoundAt: 'asc' } });
    expect(rows).toHaveLength(2);
    const inA = rows.find((row) => row.campaignId === a.id)!;
    expect(inA).toEqual(
      expect.objectContaining({ origin: 'SEARCH', firstScrapeJobId: job1.id, lastScrapeJobId: job2.id, timesFound: 2, firstFoundAt: firstAt }),
    );
    expect(await prisma.lead.count({ where: { organizationId, name: 'Clínica Para Família' } })).toBe(1);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).campaignId).toBe(b.id);

    const leadsOfA = await request(app.getHttpServer()).get(`${base}/revenue/campaigns/${a.id}/leads?qualification=qualified`).set(auth).expect(200);
    expect(leadsOfA.body).toEqual(expect.objectContaining({ total: 1 }));
    expect(leadsOfA.body.items[0]).toEqual(
      expect.objectContaining({ id: lead.id, participation: expect.objectContaining({ timesFound: 2 }) }),
    );
    const detail = await request(app.getHttpServer()).get(`${base}/revenue/campaigns/${a.id}`).set(auth).expect(200);
    expect(detail.body.stats).toEqual(expect.objectContaining({ leadsFound: 1, qualified: 1, disqualified: 0 }));

    const participations = await request(app.getHttpServer()).get(`${base}/leads/${lead.id}/campaigns`).set(auth).expect(200);
    expect(participations.body.map((p: { campaign: { id: string } }) => p.campaign.id)).toEqual([a.id, b.id]);
  });

  it('lead manual entra em "Cadastro manual" e mensagem nova sem campanha é recusada pelo banco', async () => {
    const { auth, base, organizationId } = await setupOrg('manual');
    const lead = await request(app.getHttpServer()).post(`${base}/leads`).set(auth).send({ name: 'Voltluz' }).expect(201);
    const campaign = await prisma.salesCampaign.findUniqueOrThrow({ where: { id: lead.body.campaignId } });
    expect(campaign.kind).toBe('MANUAL_ENTRY');
    expect(await prisma.campaignLead.count({ where: { leadId: lead.body.id, origin: 'MANUAL' } })).toBe(1);

    const base_ = { organizationId, leadId: lead.body.id, channel: 'EMAIL' as const, body: 'Oi', evidenceQuotes: [], actorType: 'AI' as const };
    await expect(prisma.outreachMessage.create({ data: base_ })).rejects.toThrow(/outreach_messages_campaign_required_check/);
    await expect(
      prisma.outreachMessage.create({ data: { ...base_, campaignAttribution: 'UNIDENTIFIED_LEGACY' } }),
    ).rejects.toThrow(/outreach_messages_campaign_required_check/);
    const ok = await prisma.outreachMessage.create({ data: { ...base_, campaignId: campaign.id } });
    expect(ok.campaignAttribution).toBe('DRAFT_CONTEXT');

    const messages = await request(app.getHttpServer()).get(`${base}/revenue/campaigns/${campaign.id}/outreach-messages?status=DRAFT`).set(auth).expect(200);
    expect(messages.body.items.map((m: { id: string }) => m.id)).toEqual([ok.id]);
  });

  it('duplicatas viram candidatos para revisão; confirmar só marca, e pode ser desfeito', async () => {
    const { auth, base, organizationId } = await setupOrg('duplicates');
    const a = await seedLead(organizationId, { name: 'Consultare Centro', website: 'https://www.consultare.com.br/', city: 'Campinas' });
    const b = await seedLead(organizationId, { name: 'Consultare Shopping', website: 'consultare.com.br?utm_source=maps', city: 'Campinas' });
    await seedLead(organizationId, { name: 'Outra', website: 'https://outra.com.br', city: 'Campinas' });

    expect((await request(app.getHttpServer()).post(`${base}/lead-duplicates/refresh`).set(auth).expect(201)).body).toEqual({ created: 1 });
    expect((await request(app.getHttpServer()).post(`${base}/lead-duplicates/refresh`).set(auth).expect(201)).body).toEqual({ created: 0 });
    const [candidate] = (await request(app.getHttpServer()).get(`${base}/lead-duplicates`).set(auth).expect(200)).body;
    expect(candidate.reasons).toEqual(['SAME_WEBSITE']);

    await request(app.getHttpServer())
      .post(`${base}/lead-duplicates/${candidate.id}/confirm`)
      .set(auth)
      .send({ duplicateLeadId: b.id })
      .expect(201);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: b.id } })).duplicateOfLeadId).toBe(a.id);
    expect(await prisma.lead.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
    // Revisado não volta a pendente num novo cálculo.
    await request(app.getHttpServer()).post(`${base}/lead-duplicates/refresh`).set(auth).expect(201);
    expect((await request(app.getHttpServer()).get(`${base}/lead-duplicates`).set(auth)).body).toEqual([]);

    await request(app.getHttpServer()).post(`${base}/lead-duplicates/${candidate.id}/reopen`).set(auth).expect(201);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: b.id } })).duplicateOfLeadId).toBeNull();
  });

  it('outra organização não vê campanhas, leads da campanha nem duplicatas alheias, nem via RLS', async () => {
    const owner = await setupOrg('tenant-a');
    const outsider = await setupOrg('tenant-b');
    const campaign = (
      await request(app.getHttpServer()).post(`${owner.base}/revenue/campaigns`).set(owner.auth).send({ segment: 'Academia', city: 'Campinas', state: 'SP' }).expect(201)
    ).body;
    const lead = await seedLead(owner.organizationId, { name: 'Academia X', website: 'https://x.com.br', city: 'Campinas' });
    const other = await seedLead(owner.organizationId, { name: 'Academia X 2', website: 'x.com.br', city: 'Campinas' });
    await recordCampaignLead(prisma, { organizationId: owner.organizationId, campaignId: campaign.id, leadId: lead.id, origin: 'SEARCH' });
    await request(app.getHttpServer()).post(`${owner.base}/lead-duplicates/refresh`).set(owner.auth).expect(201);

    for (const path of [
      `/revenue/campaigns/overview`,
      `/revenue/campaigns/${campaign.id}`,
      `/revenue/campaigns/${campaign.id}/leads`,
      `/revenue/campaigns/${campaign.id}/outreach-messages`,
      `/leads/${lead.id}/campaigns`,
      `/lead-duplicates`,
    ]) {
      await request(app.getHttpServer()).get(`${owner.base}${path}`).set(outsider.auth).expect(403);
    }
    // Pela própria organização, o id da campanha alheia não existe.
    await request(app.getHttpServer()).get(`${outsider.base}/revenue/campaigns/${campaign.id}/leads`).set(outsider.auth).expect(404);
    await request(app.getHttpServer()).post(`${outsider.base}/revenue/campaigns/${campaign.id}/pause`).set(outsider.auth).expect(404);

    const visible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${outsider.organizationId}, true)`;
      return {
        participations: await tx.campaignLead.count({ where: { organizationId: owner.organizationId } }),
        candidates: await tx.leadDuplicateCandidate.count({ where: { organizationId: owner.organizationId } }),
      };
    });
    expect(visible).toEqual({ participations: 0, candidates: 0 });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${outsider.organizationId}, true)`;
        await tx.campaignLead.create({
          data: {
            organizationId: owner.organizationId,
            campaignId: campaign.id,
            leadId: other.id,
            origin: 'SEARCH',
            firstFoundAt: new Date(),
            lastFoundAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/row-level security/);
  });
});
