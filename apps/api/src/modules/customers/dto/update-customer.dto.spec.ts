import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCustomerDto } from './update-customer.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateCustomerDto, input);
  return validate(dto);
}

describe('UpdateCustomerDto', () => {
  it('aceita objeto vazio — toda atualização é parcial', async () => {
    const errors = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('aceita um subconjunto de campos', async () => {
    const errors = await validateInput({ status: 'INACTIVE', tags: ['churn-risk'] });

    expect(errors).toHaveLength(0);
  });

  it('rejeita email mal formado quando informado', async () => {
    const errors = await validateInput({ email: 'not-an-email' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
