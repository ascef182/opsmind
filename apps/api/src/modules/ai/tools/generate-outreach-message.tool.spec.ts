import { ForbiddenException } from '@nestjs/common';
import { GenerateOutreachMessageTool } from './generate-outreach-message.tool';

describe('GenerateOutreachMessageTool', () => {
  it('chama OutreachService.generateDraft com o channel/serviceOfferingId informados e retorna o rascunho', async () => {
    const message = { id: 'outreach-1', status: 'DRAFT', channel: 'EMAIL' };
    const outreachService = { generateDraft: jest.fn().mockResolvedValue(message) };
    const tool = new GenerateOutreachMessageTool(outreachService as never);

    const result = await tool.execute(
      { leadId: 'lead-1', channel: 'EMAIL', serviceOfferingId: 'offering-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(message);
    expect(outreachService.generateDraft).toHaveBeenCalledWith(
      'org-1',
      'lead-1',
      { channel: 'EMAIL', serviceOfferingId: 'offering-1' },
      'user-1',
    );
  });

  it('funciona sem serviceOfferingId (OutreachService cai para lead.suggestedOfferingId)', async () => {
    const message = { id: 'outreach-2', status: 'DRAFT', channel: 'WHATSAPP' };
    const outreachService = { generateDraft: jest.fn().mockResolvedValue(message) };
    const tool = new GenerateOutreachMessageTool(outreachService as never);

    await tool.execute(
      { leadId: 'lead-1', channel: 'WHATSAPP' },
      { organizationId: 'org-1', userId: 'user-1', role: 'OWNER' },
    );

    expect(outreachService.generateDraft).toHaveBeenCalledWith(
      'org-1',
      'lead-1',
      { channel: 'WHATSAPP', serviceOfferingId: undefined },
      'user-1',
    );
  });

  it('recusa gerar rascunho de outreach quando o papel do usuário é VIEWER', async () => {
    const outreachService = { generateDraft: jest.fn() };
    const tool = new GenerateOutreachMessageTool(outreachService as never);

    await expect(
      tool.execute(
        { leadId: 'lead-1', channel: 'EMAIL' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(outreachService.generateDraft).not.toHaveBeenCalled();
  });
});
