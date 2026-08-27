import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrganizationDto } from './create-organization.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateOrganizationDto, input);
  return validate(dto);
}

describe('CreateOrganizationDto', () => {
  it('aceita apenas o nome, sem slug (gerado pelo service)', async () => {
    const errors = await validateInput({ name: 'Acme Inc.' });

    expect(errors).toHaveLength(0);
  });

  it('aceita nome e um slug explícito válido', async () => {
    const errors = await validateInput({ name: 'Acme Inc.', slug: 'acme-inc' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita nome vazio', async () => {
    const errors = await validateInput({ name: '' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejeita slug com letras maiúsculas ou espaços', async () => {
    const errors = await validateInput({ name: 'Acme', slug: 'Acme Inc' });

    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });
});
