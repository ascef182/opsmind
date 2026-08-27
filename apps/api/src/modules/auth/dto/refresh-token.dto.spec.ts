import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefreshTokenDto } from './refresh-token.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(RefreshTokenDto, input);
  return validate(dto);
}

describe('RefreshTokenDto', () => {
  it('aceita um refreshToken string não vazio', async () => {
    const errors = await validateInput({ refreshToken: 'some-opaque-token' });

    expect(errors).toHaveLength(0);
  });

  it('rejeita refreshToken vazio', async () => {
    const errors = await validateInput({ refreshToken: '' });

    expect(errors.some((e) => e.property === 'refreshToken')).toBe(true);
  });

  it('rejeita ausência de refreshToken', async () => {
    const errors = await validateInput({});

    expect(errors.some((e) => e.property === 'refreshToken')).toBe(true);
  });
});
