import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateCustomerDto, input);
  return validate(dto);
}

describe('CreateCustomerDto', () => {
  it('aceita apenas o nome (demais campos opcionais)', async () => {
    const errors = await validateInput({ name: 'Acme Corp' });

    expect(errors).toHaveLength(0);
  });

  it('aceita todos os campos opcionais preenchidos', async () => {
    const errors = await validateInput({
      name: 'Acme Corp',
      company: 'Acme',
      email: 'contact@acme.com',
      phone: '+55 11 90000-0000',
      status: 'ACTIVE',
      tags: ['vip', 'saas'],
    });

    expect(errors).toHaveLength(0);
  });

  it('rejeita nome vazio', async () => {
    const errors = await validateInput({ name: '' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejeita email mal formado quando informado', async () => {
    const errors = await validateInput({ name: 'Acme', email: 'not-an-email' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejeita status fora da lista de valores válidos', async () => {
    const errors = await validateInput({ name: 'Acme', status: 'ARCHIVED' });

    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
