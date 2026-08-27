import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMemberRoleDto } from './update-member-role.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateMemberRoleDto, input);
  return validate(dto);
}

describe('UpdateMemberRoleDto', () => {
  it('aceita um papel dentre os cinco existentes', async () => {
    const errors = await validateInput({ role: 'ADMIN' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita papel fora da lista de papéis válidos', async () => {
    const errors = await validateInput({ role: 'SUPERADMIN' });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('rejeita ausência de papel', async () => {
    const errors = await validateInput({});

    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
