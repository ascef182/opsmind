import { SearchDocumentsTool } from './search-documents.tool';

describe('SearchDocumentsTool', () => {
  it('embeda a pergunta e busca chunks por similaridade, escopado pela organização do contexto', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const embeddingGateway = { embed: jest.fn() };
    const results = [
      { documentId: 'doc-1', filename: 'contrato.pdf', content: 'Cláusula de rescisão...', chunkIndex: 2, similarity: 0.91 },
    ];
    embeddingGateway.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    prisma.$queryRaw.mockResolvedValue(results);

    const tool = new SearchDocumentsTool(prisma as never, embeddingGateway as never);
    const result = await tool.execute(
      { query: 'qual a cláusula de rescisão?' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(embeddingGateway.embed).toHaveBeenCalledWith(['qual a cláusula de rescisão?']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toBe(results);
  });
});
