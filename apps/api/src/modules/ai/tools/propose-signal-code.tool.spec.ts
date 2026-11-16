import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProposeSignalCodeTool } from './propose-signal-code.tool';

describe('ProposeSignalCodeTool', () => {
  it('propõe o código e retorna o SignalCode criado', async () => {
    const signalCodesService = {
      propose: jest.fn().mockResolvedValue({ code: 'HIRING_SURGE', status: 'PROPOSED' }),
    };
    const tool = new ProposeSignalCodeTool(signalCodesService as never);

    const result = await tool.execute(
      { code: 'HIRING_SURGE', label: 'Contratando em massa', category: 'crescimento' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toEqual({ code: 'HIRING_SURGE', status: 'PROPOSED' });
    expect(signalCodesService.propose).toHaveBeenCalledWith(
      'org-1',
      { code: 'HIRING_SURGE', label: 'Contratando em massa', category: 'crescimento' },
      'user-1',
    );
  });

  it('recusa propor quando o papel do usuário que invocou é VIEWER', async () => {
    const signalCodesService = { propose: jest.fn() };
    const tool = new ProposeSignalCodeTool(signalCodesService as never);

    await expect(
      tool.execute(
        { code: 'X', label: 'Y', category: 'Z' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(signalCodesService.propose).not.toHaveBeenCalled();
  });

  it('recusa um `code` vazio antes de chamar o service (mesma validação do CreateSignalCodeDto da rota HTTP)', async () => {
    const signalCodesService = { propose: jest.fn() };
    const tool = new ProposeSignalCodeTool(signalCodesService as never);

    await expect(
      tool.execute(
        { code: '', label: 'Contratando em massa', category: 'crescimento' },
        { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(signalCodesService.propose).not.toHaveBeenCalled();
  });
});
