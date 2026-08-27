import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AI_GATEWAY, type AiGateway } from '../src/modules/ai/gateway/ai-gateway.interface';
import { registerUser } from './helpers/auth';

/** Extrai o token bruto do convite logado pelo ConsoleEmailProvider (dev). */
function extractInvitationToken(logSpy: jest.SpyInstance): string {
  const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  const token = /token: (\S+)/.exec(logged)?.at(1);
  if (!token) {
    throw new Error(`Token de convite não encontrado no log: ${logged}`);
  }
  return token;
}

async function createOrg(app: INestApplication, accessToken: string) {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'AI Co', slug: `ai-co-${randomUUID()}` })
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

function toolUse(toolName: string, input: Record<string, unknown>, inputTokens = 100, outputTokens = 50) {
  return {
    id: `msg_${randomUUID()}`,
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `tool_${randomUUID()}`, name: toolName, input }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// Fase 3 (docs/planning/PRD.md §17): chat com IA + tool calling. Sem chave
// real da Anthropic neste ambiente — AI_GATEWAY é sobrescrito por um mock
// (Test.overrideProvider), exatamente como a interface AiGateway foi desenhada
// para permitir. O resto do fluxo (RBAC das tools, orçamento, auditoria,
// persistência de AIRequest) roda contra a app real (Postgres via Docker
// Compose), sem mocks.
describe('AI assistant flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: { sendMessage: jest.Mock };

  beforeAll(async () => {
    gateway = { sendMessage: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    gateway.sendMessage.mockReset();
  });

  it('responde sem tools, persiste o AIRequest e credita o gasto no orçamento do mês', async () => {
    const owner = await registerUser(app, `ai-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    gateway.sendMessage.mockResolvedValueOnce(endTurn('Olá! Como posso ajudar?', 1000, 500));

    const chatRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/ai/chat`)
      .set(auth)
      .send({ message: 'oi' })
      .expect(201);

    expect(chatRes.body.reply).toBe('Olá! Como posso ajudar?');
    expect(chatRes.body.aiRequestId).toBeTruthy();

    // custo = (1000/1e6)*5 + (500/1e6)*25 = 0.0175
    const usageRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/ai/usage`)
      .set(auth)
      .expect(200);
    expect(usageRes.body.monthSpend).toBeCloseTo(0.0175, 6);
  });

  it('executa create_task via tool calling, persiste a tarefa com actorType AI e audita a chamada', async () => {
    const owner = await registerUser(app, `ai-owner2-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    gateway.sendMessage
      .mockResolvedValueOnce(toolUse('create_task', { title: 'Ligar para o cliente' }))
      .mockResolvedValueOnce(endTurn('Criei a tarefa "Ligar para o cliente" para você.'));

    const chatRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/ai/chat`)
      .set(auth)
      .send({ message: 'crie uma tarefa para ligar para o cliente' })
      .expect(201);
    expect(chatRes.body.reply).toContain('Ligar para o cliente');

    const tasksRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/tasks`)
      .set(auth)
      .expect(200);
    const created = tasksRes.body.find((t: { title: string }) => t.title === 'Ligar para o cliente');
    expect(created).toBeTruthy();
    expect(created.actorType).toBe('AI');
    expect(created.actorId).toBe(owner.userId);

    const auditRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/audit-logs`)
      .set(auth)
      .expect(200);
    const toolAudit = auditRes.body.find((log: { action: string }) => log.action === 'ai.tool.create_task');
    expect(toolAudit).toBeTruthy();
    expect(toolAudit.actorType).toBe('AI');
    expect(toolAudit.actorId).toBe(owner.userId);
  });

  it('um membro VIEWER pedindo pra IA criar uma tarefa é recusado pela tool (RBAC), nenhuma tarefa é criada', async () => {
    const owner = await registerUser(app, `ai-owner3-${randomUUID()}@opsmind.test`);
    const viewer = await registerUser(app, `ai-viewer-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const viewerAuth = { Authorization: `Bearer ${viewer.accessToken}` };

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const invitationToken = extractInvitationToken(logSpy);
    logSpy.mockRestore();
    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set(viewerAuth)
      .expect(201);

    gateway.sendMessage
      .mockResolvedValueOnce(toolUse('create_task', { title: 'Tarefa indevida' }))
      .mockResolvedValueOnce(endTurn('Não consigo criar tarefas: seu papel não permite.'));

    const chatRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/ai/chat`)
      .set(viewerAuth)
      .send({ message: 'crie uma tarefa' })
      .expect(201);
    expect(chatRes.body.reply).toContain('não permite');

    const tasksRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/tasks`)
      .set(ownerAuth)
      .expect(200);
    expect(tasksRes.body.find((t: { title: string }) => t.title === 'Tarefa indevida')).toBeUndefined();
  });

  it('corta a conversa com 403 quando o orçamento mensal de IA da organização já foi atingido', async () => {
    const owner = await registerUser(app, `ai-owner4-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    // Sem endpoint HTTP para configurar orçamento ainda — grava direto via
    // Prisma (fora de qualquer request HTTP, mesmo padrão já usado pelos
    // helpers de teste desta suíte para o RLS: ver tenant-context.interceptor
    // "no contexto = allow", só alcançável fora de uma request autenticada).
    await prisma.organization.update({
      where: { id: organizationId },
      data: { aiMonthlyBudget: 0 },
    });

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/ai/chat`)
      .set(auth)
      .send({ message: 'oi' })
      .expect(403);

    expect(gateway.sendMessage).not.toHaveBeenCalled();
  });
});
