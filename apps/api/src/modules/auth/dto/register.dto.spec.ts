import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, input);
  return validate(dto);
}

describe('RegisterDto', () => {
  it('aceita email, senha (>= 8 caracteres) e nome válidos', async () => {
    const errors = await validateInput({
      email: 'a@b.com',
      password: 'correct horse',
      name: 'Ada Lovelace',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejeita email mal formado', async () => {
    const errors = await validateInput({
      email: 'not-an-email',
      password: 'correct horse',
      name: 'Ada Lovelace',
    });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejeita senha com menos de 8 caracteres', async () => {
    const errors = await validateInput({
      email: 'a@b.com',
      password: 'short',
      name: 'Ada Lovelace',
    });

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejeita nome vazio', async () => {
    const errors = await validateInput({
      email: 'a@b.com',
      password: 'correct horse',
      name: '',
    });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
