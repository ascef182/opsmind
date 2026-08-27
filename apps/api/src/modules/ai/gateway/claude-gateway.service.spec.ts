import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeGatewayService } from './claude-gateway.service';

const mockCreate = jest.fn();

// Mocka o SDK inteiro: nenhum teste unitário deve bater na API real da
// Anthropic (não há ANTHROPIC_API_KEY real neste ambiente, e testes não devem
// depender de rede/custar dinheiro de verdade).
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

describe('ClaudeGatewayService', () => {
  let configService: { get: jest.Mock };

  beforeEach(() => {
    mockCreate.mockReset();
    configService = { get: jest.fn() };
  });

  async function build(): Promise<ClaudeGatewayService> {
    const module = await Test.createTestingModule({
      providers: [
        ClaudeGatewayService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    return module.get(ClaudeGatewayService);
  }

  it('lança um erro claro ao enviar mensagem sem ANTHROPIC_API_KEY configurada', async () => {
    configService.get.mockReturnValue(undefined);
    const service = await build();

    await expect(
      service.sendMessage({ system: 'system prompt', messages: [], tools: [] }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('chama messages.create com model, thinking adaptativo e os parâmetros do request quando a chave existe', async () => {
    configService.get.mockReturnValue('sk-ant-test-key');
    mockCreate.mockResolvedValue({ id: 'msg_1', stop_reason: 'end_turn', content: [] });
    const service = await build();

    const messages = [{ role: 'user' as const, content: 'oi' }];
    const tools = [{ name: 'get_customer', description: 'x', input_schema: { type: 'object' as const } }];

    const result = await service.sendMessage({ system: 'system prompt', messages, tools });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-5',
        thinking: { type: 'adaptive' },
        system: 'system prompt',
        messages,
        tools,
      }),
    );
    expect(result).toEqual({ id: 'msg_1', stop_reason: 'end_turn', content: [] });
  });

  it('reutiliza a mesma instância do client Anthropic entre chamadas (não recria a cada mensagem)', async () => {
    configService.get.mockReturnValue('sk-ant-test-key');
    mockCreate.mockResolvedValue({ id: 'msg_1', stop_reason: 'end_turn', content: [] });
    const service = await build();
    const AnthropicCtor = jest.requireMock('@anthropic-ai/sdk').default;
    AnthropicCtor.mockClear();

    await service.sendMessage({ system: 's', messages: [], tools: [] });
    await service.sendMessage({ system: 's', messages: [], tools: [] });

    expect(AnthropicCtor).toHaveBeenCalledTimes(1);
  });
});
