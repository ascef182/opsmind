import { ServiceUnavailableException } from '@nestjs/common';
import { OpenAiEmbeddingGateway } from './openai-embedding.gateway';

const mockCreate = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: { create: mockCreate },
    })),
  };
});

describe('OpenAiEmbeddingGateway', () => {
  let configService: { get: jest.Mock };

  beforeEach(() => {
    mockCreate.mockReset();
    configService = { get: jest.fn() };
  });

  function build(): OpenAiEmbeddingGateway {
    return new OpenAiEmbeddingGateway(configService as never);
  }

  it('lança um erro claro ao embedar sem OPENAI_API_KEY configurada', async () => {
    configService.get.mockReturnValue(undefined);
    const gateway = build();

    await expect(gateway.embed(['oi'])).rejects.toThrow(ServiceUnavailableException);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('chama embeddings.create com o modelo e os textos, devolvendo os vetores na ordem original', async () => {
    configService.get.mockReturnValue('sk-test-key');
    mockCreate.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2, 0.2] },
        { index: 0, embedding: [0.1, 0.1] },
      ],
    });
    const gateway = build();

    const result = await gateway.embed(['primeiro', 'segundo']);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['primeiro', 'segundo'],
    });
    // reordenado por `index`, não pela ordem bruta da resposta da API.
    expect(result).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
  });

  it('reutiliza a mesma instância do client entre chamadas', async () => {
    configService.get.mockReturnValue('sk-test-key');
    mockCreate.mockResolvedValue({ data: [{ index: 0, embedding: [0.1] }] });
    const gateway = build();
    const OpenAICtor = jest.requireMock('openai').default;
    OpenAICtor.mockClear();

    await gateway.embed(['a']);
    await gateway.embed(['b']);

    expect(OpenAICtor).toHaveBeenCalledTimes(1);
  });
});
