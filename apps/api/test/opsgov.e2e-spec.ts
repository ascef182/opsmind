import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { registerUser } from './helpers/auth';

// OpsGov contra Postgres real: histórico por vigência (nunca sobrescrito),
// barreira de sobreposição no banco e isolamento entre organizações (RLS).
describe('OpsGov (e2e)', () => {
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

  // Dois usuários para o arquivo inteiro: /auth/register tem limite de 10/min
  // por instância. "alice" é dona das organizações de cada teste; "bob" é dono
  // das organizações de fora, que nunca podem enxergar as da alice.
  const users: Record<'alice' | 'bob', { Authorization: string }> = {} as never;

  async function newOrg(label: string, owner: 'alice' | 'bob' = 'alice') {
    if (!users[owner]) {
      const registered = await registerUser(app, `opsgov-${owner}-${randomUUID()}@opsmind.test`);
      users[owner] = { Authorization: `Bearer ${registered.accessToken}` };
    }
    const auth = users[owner];
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set(auth)
      .send({ name: `OpsGov ${label}`, slug: `opsgov-${label}-${randomUUID()}` })
      .expect(201);
    return { auth, organizationId: res.body.id as string, base: `/organizations/${res.body.id}/opsgov/company` };
  }

  it('MEI → ME: troca de regime e cadastro fecha o anterior e mantém o histórico', async () => {
    const { auth, base } = await newOrg('flow');
    const http = () => request(app.getHttpServer());

    await http().put(`${base}/profile`).set(auth).send({ razaoSocial: 'CazaTech', municipio: 'São Paulo', uf: 'sp' }).expect(200);
    await http()
      .post(`${base}/registrations`)
      .set(auth)
      .send({ naturezaJuridica: 'MEI', cnpj: '11.222.333/0001-81', validFrom: '2024-03-01' })
      .expect(201);
    await http().post(`${base}/regimes`).set(auth).send({ regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2024-03-01' }).expect(201);
    await http()
      .post(`${base}/activities`)
      .set(auth)
      .send({ cnae: '8219-9/99', description: 'Preparação de documentos', isPrimary: true, validFrom: '2024-03-01' })
      .expect(201);

    await http()
      .post(`${base}/regimes`)
      .set(auth)
      .send({ regime: 'SIMPLES_NACIONAL', ibsCbsMode: 'DENTRO_DAS', validFrom: '2027-01-01' })
      .expect(201);
    await http()
      .post(`${base}/registrations`)
      .set(auth)
      .send({ naturezaJuridica: 'SLU', cnpj: '11444777000161', validFrom: '2027-01-01' })
      .expect(201);

    // Retroativo é recusado e nada muda.
    await http().post(`${base}/regimes`).set(auth).send({ regime: 'LUCRO_PRESUMIDO', ibsCbsMode: 'REGULAR', validFrom: '2026-06-01' }).expect(409);

    const overview = await http().get(base).set(auth).expect(200);
    expect(overview.body.profile).toEqual(expect.objectContaining({ razaoSocial: 'CazaTech', uf: 'SP', cnpj: '11444777000161' }));
    expect(overview.body.taxRegimePeriods).toEqual([
      expect.objectContaining({ regime: 'SIMPLES_NACIONAL', validFrom: '2027-01-01', validTo: null }),
      expect.objectContaining({ regime: 'SIMEI', validFrom: '2024-03-01', validTo: '2027-01-01' }),
    ]);

    const before = await http().get(`${base}/snapshot?date=2026-12-31`).set(auth).expect(200);
    expect(before.body.regime.regime).toBe('SIMEI');
    expect(before.body.registration.naturezaJuridica).toBe('MEI');
    expect(before.body.activities).toHaveLength(1);
    const after = await http().get(`${base}/snapshot?date=2027-01-01`).set(auth).expect(200);
    expect(after.body.regime.regime).toBe('SIMPLES_NACIONAL');
    expect(after.body.registration.cnpj).toBe('11444777000161');
  });

  it('mudanças concorrentes: uma vence, a outra recebe 409, e o banco barra sobreposição direta', async () => {
    const { auth, organizationId, base } = await newOrg('race');
    await request(app.getHttpServer())
      .post(`${base}/regimes`)
      .set(auth)
      .send({ regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2024-03-01' })
      .expect(201);

    const results = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`${base}/regimes`)
          .set(auth)
          .send({ regime: 'SIMPLES_NACIONAL', ibsCbsMode: 'DENTRO_DAS', validFrom: '2027-01-01' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.taxRegimePeriod.count({ where: { organizationId } })).toBe(2);

    await expect(
      prisma.taxRegimePeriod.create({
        data: {
          organizationId,
          regime: 'LUCRO_REAL',
          ibsCbsMode: 'REGULAR',
          validFrom: new Date('2026-01-01'),
          validTo: new Date('2028-01-01'),
          actorType: 'SYSTEM',
        },
      }),
    ).rejects.toThrow(/tax_regime_periods_no_overlap/);
  });

  it('outra organização não lê o cadastro alheio, nem via RLS', async () => {
    const a = await newOrg('tenant-a');
    const b = await newOrg('tenant-b', 'bob');
    await request(app.getHttpServer())
      .post(`${a.base}/regimes`)
      .set(a.auth)
      .send({ regime: 'SIMEI', ibsCbsMode: 'NAO_SE_APLICA', validFrom: '2024-03-01' })
      .expect(201);
    await request(app.getHttpServer()).put(`${a.base}/profile`).set(a.auth).send({ razaoSocial: 'Org A' }).expect(200);

    await request(app.getHttpServer()).get(a.base).set(b.auth).expect(403);
    const own = await request(app.getHttpServer()).get(b.base).set(b.auth).expect(200);
    expect(own.body).toEqual({ profile: null, registrationPeriods: [], taxRegimePeriods: [], activities: [] });

    const counts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${b.organizationId}, true)`;
      return Promise.all([
        tx.companyProfile.count({ where: { organizationId: a.organizationId } }),
        tx.taxRegimePeriod.count({ where: { organizationId: a.organizationId } }),
        tx.companyRegistrationPeriod.count({ where: { organizationId: a.organizationId } }),
        tx.companyActivity.count({ where: { organizationId: a.organizationId } }),
      ]);
    });
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  describe('Fase 2 — receita por atividade', () => {
    async function entry(org: { auth: Record<string, string>; organizationId: string }, body: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${org.organizationId}/finance/entries`)
        .set(org.auth)
        .send({ direction: 'INCOME', category: 'PROJECT', ...body })
        .expect(201);
      return res.body.id as string;
    }

    it('classifica em lote pela versão vigente, separa por grupo e calcula o RBT12 sem PERSONAL', async () => {
      const org = await newOrg('revenue');
      const company = org.base;
      const revenue = `/organizations/${org.organizationId}/opsgov/revenue`;
      const http = () => request(app.getHttpServer());

      await http()
        .post(`${company}/registrations`)
        .set(org.auth)
        .send({ naturezaJuridica: 'MEI', cnpj: '11222333000181', validFrom: '2024-03-01' })
        .expect(201);
      const trad = await http()
        .post(`${company}/activities`)
        .set(org.auth)
        .send({ cnae: '8219-9/99', description: 'Tradução', isPrimary: true, revenueGroup: 'TRADUCAO_LEGENDAGEM', validFrom: '2024-03-01' })
        .expect(201);
      const dev = await http()
        .post(`${company}/activities`)
        .set(org.auth)
        .send({ cnae: '6201-5/01', description: 'Software', revenueGroup: 'TECNOLOGIA', validFrom: '2026-01-01' })
        .expect(201);

      const e1 = await entry(org, { description: 'Legendas', amountCents: 300_000, issueDate: '2026-05-10', dueDate: '2026-05-20' });
      const e2 = await entry(org, { description: 'Site', amountCents: 1_200_000, issueDate: '2026-06-10', dueDate: '2026-06-20' });
      const loose = await entry(org, { description: 'Avulso', amountCents: 50_000, issueDate: '2026-06-15', dueDate: '2026-06-25' });
      const personal = await entry(org, { description: 'Pessoal', amountCents: 999_000, scope: 'PERSONAL', issueDate: '2026-06-01', dueDate: '2026-06-05' });

      const pending = await http().get(`${revenue}/unclassified`).set(org.auth).expect(200);
      expect(pending.body.map((e: { id: string }) => e.id).sort()).toEqual([e1, e2, loose].sort());

      // Lote com um lançamento pessoal é recusado por inteiro.
      await http().patch(`${revenue}/classify`).set(org.auth).send({ entryIds: [e1, personal], companyActivityId: trad.body.id }).expect(400);
      // CNAE de tecnologia só vale a partir de 2026-01: receita anterior não pode ir para ele.
      const old = await entry(org, { description: 'Antigo', amountCents: 10_000, issueDate: '2025-11-10', dueDate: '2025-11-20' });
      await http().patch(`${revenue}/classify`).set(org.auth).send({ entryIds: [old], companyActivityId: dev.body.id }).expect(400);

      await http().patch(`${revenue}/classify`).set(org.auth).send({ entryIds: [e1], companyActivityId: trad.body.id }).expect(200);
      await http().patch(`${revenue}/classify`).set(org.auth).send({ entryIds: [e2], companyActivityId: dev.body.id }).expect(200);

      const report = await http().get(`${revenue}/by-activity?from=2026-05&to=2026-06`).set(org.auth).expect(200);
      expect(report.body.rows).toEqual([
        expect.objectContaining({ cnae: '6201-5/01', monthsCents: [0, 1_200_000] }),
        expect.objectContaining({ cnae: '8219-9/99', monthsCents: [300_000, 0] }),
      ]);
      expect(report.body.unclassified.totalCents).toBe(50_000);
      expect(report.body.totals.totalCents).toBe(1_550_000);
      expect(Object.fromEntries(report.body.groups.map((g: { revenueGroup: string; totalCents: number }) => [g.revenueGroup, g.totalCents]))).toEqual({
        TECNOLOGIA: 1_200_000,
        TRADUCAO_LEGENDAGEM: 300_000,
        OUTROS: 0,
      });

      const rbt12 = await http().get(`${revenue}/rbt12?month=2027-01`).set(org.auth).expect(200);
      expect(rbt12.body).toEqual(expect.objectContaining({ rbt12Cents: 1_550_000, method: 'TWELVE_MONTHS', activityStartMonth: '2024-03' }));

      // O banco também recusa classificar receita pessoal, mesmo fora do service.
      await expect(
        prisma.financialEntry.update({ where: { id: personal }, data: { companyActivityId: trad.body.id } }),
      ).rejects.toThrow(/financial_entries_activity_only_business_income_chk/);
    });

    it('outra organização não classifica nem lê a receita alheia', async () => {
      const a = await newOrg('rev-a');
      const b = await newOrg('rev-b', 'bob');
      await request(app.getHttpServer())
        .post(`${a.base}/activities`)
        .set(a.auth)
        .send({ cnae: '8219-9/99', description: 'Tradução', validFrom: '2024-03-01' })
        .expect(201);
      const entryA = await entry(a, { description: 'Receita A', amountCents: 100_000, issueDate: '2026-05-10', dueDate: '2026-05-20' });
      const bActivity = await request(app.getHttpServer())
        .post(`${b.base}/activities`)
        .set(b.auth)
        .send({ cnae: '8219-9/99', description: 'Tradução', validFrom: '2024-03-01' })
        .expect(201);

      const bRevenue = `/organizations/${b.organizationId}/opsgov/revenue`;
      await request(app.getHttpServer()).patch(`${bRevenue}/classify`).set(b.auth).send({ entryIds: [entryA], companyActivityId: bActivity.body.id }).expect(404);
      await request(app.getHttpServer()).get(`/organizations/${a.organizationId}/opsgov/revenue/rbt12`).set(b.auth).expect(403);
      const own = await request(app.getHttpServer()).get(`${bRevenue}/by-activity?from=2026-05&to=2026-05`).set(b.auth).expect(200);
      expect(own.body.totals.totalCents).toBe(0);

      const stillUnclassified = await prisma.financialEntry.findUniqueOrThrow({ where: { id: entryA } });
      expect(stillUnclassified.companyActivityId).toBeNull();
    });
  });

  describe('Fase 3 — simulador do Simples', () => {
    it('cenário livre reproduz os valores conhecidos e o real usa o RBT12 da organização', async () => {
      const org = await newOrg('simples');
      const simples = `/organizations/${org.organizationId}/opsgov/simples`;

      const free = await request(app.getHttpServer())
        .get(`${simples}/simulation?faturamentoMensalCents=2000000&inssSocioRateBp=1100`)
        .set(org.auth)
        .expect(200);
      expect(free.body).toEqual(
        expect.objectContaining({
          anexoIII: { aliquotaEfetivaPpm: 73_000, dasCents: 146_000 },
          anexoV: { aliquotaEfetivaPpm: 161_250, dasCents: 322_500 },
          proLaboreMinimoCents: 560_000,
          economiaMensalCents: 114_900,
        }),
      );
      await request(app.getHttpServer()).get(`${simples}/simulation?faturamentoMensalCents=-5`).set(org.auth).expect(400);

      const empty = await request(app.getHttpServer()).get(`${simples}/real`).set(org.auth).expect(200);
      expect(empty.body.simulation).toBeNull();

      const lastMonth = new Date();
      lastMonth.setUTCDate(1);
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      const day = lastMonth.toISOString().slice(0, 10);
      await request(app.getHttpServer())
        .post(`/organizations/${org.organizationId}/finance/entries`)
        .set(org.auth)
        .send({ direction: 'INCOME', category: 'PROJECT', description: 'Projeto', amountCents: 6_000_000, issueDate: day, dueDate: day })
        .expect(201);

      const real = await request(app.getHttpServer()).get(`${simples}/real`).set(org.auth).expect(200);
      expect(real.body.rbt12.rbt12Cents).toBe(6_000_000);
      expect(real.body.simulation).toEqual(expect.objectContaining({ rbt12Cents: 6_000_000, faturamentoMensalCents: 500_000 }));

      const outsider = await newOrg('simples-out', 'bob');
      await request(app.getHttpServer()).get(`${simples}/real`).set(outsider.auth).expect(403);
    });
  });

  describe('Fase 4 — obrigações e certidões', () => {
    it('cumprir guarda o histórico e avança; certidão tem status calculado; outra org não enxerga', async () => {
      const org = await newOrg('compliance');
      const base = `/organizations/${org.organizationId}/opsgov/compliance`;
      const http = () => request(app.getHttpServer());

      const das = await http()
        .post(`${base}/obligations`)
        .set(org.auth)
        .send({ type: 'DAS', title: 'DAS mensal', recurrence: 'MONTHLY', dueDay: 20, firstDueDate: '2026-12-20' })
        .expect(201);
      await http().post(`${base}/obligations`).set(org.auth).send({ type: 'DEFIS', title: 'DEFIS', recurrence: 'YEARLY', dueDay: 31 }).expect(400);

      const done = await http()
        .post(`${base}/obligations/${das.body.id}/complete`)
        .set(org.auth)
        .send({ completedOn: '2026-12-18' })
        .expect(201);
      expect(done.body).toEqual(
        expect.objectContaining({ nextDueDate: '2027-01-20', status: 'PENDENTE', lastCompletion: expect.objectContaining({ dueDate: '2026-12-20' }) }),
      );
      expect(await prisma.complianceObligationCompletion.count({ where: { obligationId: das.body.id } })).toBe(1);

      // Dois cliques ao mesmo tempo cumprem um vencimento só.
      const both = await Promise.all(
        [0, 1].map(() => http().post(`${base}/obligations/${das.body.id}/complete`).set(org.auth).send({})),
      );
      expect(both.map((r) => r.status)).toEqual([201, 201]);
      const completions = await prisma.complianceObligationCompletion.findMany({ where: { obligationId: das.body.id }, orderBy: { dueDate: 'asc' } });
      expect(completions.map((c) => c.dueDate.toISOString().slice(0, 10))).toEqual(['2026-12-20', '2027-01-20', '2027-02-20']);

      await http()
        .post(`${base}/certificates`)
        .set(org.auth)
        .send({ type: 'CND_FEDERAL', issuedOn: '2020-01-01', validUntil: '2020-06-29' })
        .expect(201);
      await http()
        .post(`${base}/certificates`)
        .set(org.auth)
        .send({ type: 'CND_FEDERAL', issuedOn: '2026-01-01', validUntil: '2099-12-31' })
        .expect(201);
      const certs = await http().get(`${base}/certificates`).set(org.auth).expect(200);
      expect(certs.body.map((c: { status: string; isCurrent: boolean }) => [c.status, c.isCurrent])).toEqual([
        ['VALIDA', true],
        ['VENCIDA', false],
      ]);

      const other = await newOrg('compliance-b', 'bob');
      await http().get(`${base}/obligations`).set(other.auth).expect(403);
      await http()
        .post(`/organizations/${other.organizationId}/opsgov/compliance/obligations/${das.body.id}/complete`)
        .set(other.auth)
        .send({})
        .expect(404);
      const rls = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${other.organizationId}, true)`;
        return Promise.all([
          tx.complianceObligation.count({ where: { organizationId: org.organizationId } }),
          tx.complianceObligationCompletion.count({ where: { organizationId: org.organizationId } }),
          tx.certificate.count({ where: { organizationId: org.organizationId } }),
        ]);
      });
      expect(rls).toEqual([0, 0, 0]);
    });
  });
});
