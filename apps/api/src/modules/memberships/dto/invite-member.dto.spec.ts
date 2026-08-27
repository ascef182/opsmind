import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteMemberDto } from './invite-member.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(InviteMemberDto, input);
  return validate(dto);
}

describe('InviteMemberDto', () => {
  it('aceita email válido e um papel dentre os cinco existentes', async () => {
    const errors = await validateInput({ email: 'b@b.com', role: 'MEMBER' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita email mal formado', async () => {
    const errors = await validateInput({ email: 'not-an-email', role: 'MEMBER' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejeita papel fora da lista de papéis válidos', async () => {
    const errors = await validateInput({ email: 'b@b.com', role: 'SUPERADMIN' });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
