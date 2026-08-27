import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(LoginDto, input);
  return validate(dto);
}

describe('LoginDto', () => {
  it('aceita email e senha válidos', async () => {
    const errors = await validateInput({ email: 'a@b.com', password: 'anything' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita email mal formado', async () => {
    const errors = await validateInput({ email: 'not-an-email', password: 'anything' });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejeita senha vazia', async () => {
    const errors = await validateInput({ email: 'a@b.com', password: '' });

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
