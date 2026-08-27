import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { AppModule } from '../src/app.module';
import { AI_GATEWAY, type AiGateway } from '../src/modules/ai/gateway/ai-gateway.interface';
import {
  EMBEDDING_GATEWAY,
  type EmbeddingGateway,
} from '../src/modules/documents/gateway/embedding-gateway.interface';
import { registerUser } from './helpers/auth';

/** PDF de verdade (via pdfkit), não um fixture hand-rolled — extractPdfText roda contra bytes reais. */
function buildTestPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.text(text);
    doc.end();
  });
}

// Vetor fixo não-zero — irrelevante pro conteúdo do teste (só há um chunk no
// workspace, então qualquer vetor de consulta encontra ele), mas um vetor
// zero faria a distância de cosseno do pgvector indefinida.
const FIXED_EMBEDDING = new Array(1536).fill(0);
FIXED_EMBEDDING[0] = 1;

async function createOrg(app: INestApplication, accessToken: string) {
  const res = await request(app.getHttpServer())
    .post('/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Docs Co', slug: `docs-co-${randomUUID()}` })
    .expect(201);
  return res.body.id as string;
}

function endTurn(text: string) {
  return {
    id: `msg_${randomUUID()}`,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function toolUse(toolName: string, input: Record<string, unknown>) {
  return {
    id: `msg_${randomUUID()}`,
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `tool_${randomUUID()}`, name: toolName, input }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

// Fase 4 (docs/planning/PRD.md §17): upload de PDF, extração, chunking,
// embeddings, pgvector, busca semântica com citação de fonte. Critério de
// aceitação: "perguntar sobre o conteúdo de um contrato enviado retorna
// resposta correta citando o trecho/documento de origem." Contra a app real
// (Postgres/pgvector via Docker Compose) — só EMBEDDING_GATEWAY e AI_GATEWAY
// são mocks (sem OPENAI_API_KEY/ANTHROPIC_API_KEY reais neste ambiente).
describe('Documents + RAG flow (e2e)', () => {
  let app: INestApplication;
  let gateway: { sendMessage: jest.Mock };
  let embeddingGateway: { embed: jest.Mock };

  beforeAll(async () => {
    gateway = { sendMessage: jest.fn() };
    embeddingGateway = {
      embed: jest.fn().mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => FIXED_EMBEDDING))),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_GATEWAY)
      .useValue(gateway satisfies AiGateway)
      .overrideProvider(EMBEDDING_GATEWAY)
      .useValue(embeddingGateway satisfies EmbeddingGateway)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.sendMessage.mockReset();
    embeddingGateway.embed.mockClear();
  });

  it('faz upload de um PDF, extrai/chunka/embeda de verdade, e o arquivo baixado bate byte a byte com o original', async () => {
    const owner = await registerUser(app, `docs-owner-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const pdfBuffer = await buildTestPdf('Clausula 1: rescisao em 30 dias.');

    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/documents`)
      .set(auth)
      .attach('file', pdfBuffer, { filename: 'contrato.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(uploadRes.body.status).toBe('READY');
    expect(uploadRes.body.filename).toBe('contrato.pdf');
    const documentId = uploadRes.body.id;

    // embedding chamado com o texto de verdade extraído do PDF (não um mock
    // de extração — o pipeline pdf-parse -> chunkText rodou de verdade).
    const embeddedTexts = embeddingGateway.embed.mock.calls.flat(2) as string[];
    expect(embeddedTexts.some((text) => text.includes('rescisao em 30 dias'))).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/documents`)
      .set(auth)
      .expect(200);
    expect(listRes.body.map((d: { id: string }) => d.id)).toContain(documentId);

    const downloadRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/documents/${documentId}/download`)
      .set(auth)
      .expect(200);
    expect(Buffer.compare(downloadRes.body, pdfBuffer)).toBe(0);
  });

  it('rejeita upload de arquivo que não é PDF (400)', async () => {
    const owner = await registerUser(app, `docs-owner2-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/documents`)
      .set(auth)
      .attach('file', Buffer.from('não é um pdf'), { filename: 'nota.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('cenário do critério de aceitação da Fase 4: pergunta sobre o contrato retorna resposta citando o documento', async () => {
    const owner = await registerUser(app, `docs-owner3-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const pdfBuffer = await buildTestPdf('Clausula de rescisao: aviso previo de 30 dias.');

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/documents`)
      .set(auth)
      .attach('file', pdfBuffer, { filename: 'contrato-importante.pdf', contentType: 'application/pdf' })
      .expect(201);

    gateway.sendMessage
      .mockResolvedValueOnce(toolUse('search_documents', { query: 'qual a clausula de rescisao?' }))
      .mockResolvedValueOnce(
        endTurn('A cláusula de rescisão prevê aviso prévio de 30 dias (contrato-importante.pdf).'),
      );

    const chatRes = await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/ai/chat`)
      .set(auth)
      .send({ message: 'qual a cláusula de rescisão do contrato?' })
      .expect(201);

    expect(chatRes.body.reply).toContain('contrato-importante.pdf');

    // O tool_result devolvido pro "modelo" (2ª chamada ao gateway) precisa
    // conter o trecho de verdade recuperado via busca por similaridade —
    // prova de que o pipeline inteiro (embed da pergunta -> pgvector
    // <=> -> chunk certo) funcionou, não só que o mock foi chamado.
    const secondCallMessages = gateway.sendMessage.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[2];
    const toolResultContent = toolResultMessage.content[0].content as string;
    expect(toolResultContent).toContain('aviso previo de 30 dias');
    expect(toolResultContent).toContain('contrato-importante.pdf');

    const auditRes = await request(app.getHttpServer())
      .get(`/organizations/${organizationId}/audit-logs`)
      .set(auth)
      .expect(200);
    expect(auditRes.body.map((log: { action: string }) => log.action)).toEqual(
      expect.arrayContaining(['document.uploaded', 'ai.tool.search_documents']),
    );
  });

  it('recusa upload por um membro VIEWER (RBAC)', async () => {
    const owner = await registerUser(app, `docs-owner4-${randomUUID()}@opsmind.test`);
    const viewer = await registerUser(app, `docs-viewer-${randomUUID()}@opsmind.test`);
    const organizationId = await createOrg(app, owner.accessToken);
    const ownerAuth = { Authorization: `Bearer ${owner.accessToken}` };
    const viewerAuth = { Authorization: `Bearer ${viewer.accessToken}` };

    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/invite`)
      .set(ownerAuth)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    const invitationToken = /token: (\S+)/.exec(logged)?.at(1);
    await request(app.getHttpServer())
      .post(`/invitations/${invitationToken}/accept`)
      .set(viewerAuth)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${organizationId}/documents`)
      .set(viewerAuth)
      .attach('file', await buildTestPdf('conteúdo qualquer'), {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      })
      .expect(403);
  });
});
