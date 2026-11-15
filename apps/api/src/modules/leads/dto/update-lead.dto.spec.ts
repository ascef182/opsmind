import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLeadDto } from './update-lead.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateLeadDto, input);
  return validate(dto);
}

describe('UpdateLeadDto', () => {
  it('aceita objeto vazio (todos os campos opcionais)', async () => {
    const errors = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('aceita whatsapp/contactName/socialLinks válidos', async () => {
    const errors = await validateInput({
      whatsapp: '+55 11 90000-0000',
      contactName: 'Maria Silva',
      socialLinks: [{ platform: 'LINKEDIN', url: 'https://linkedin.com/company/padaria' }],
    });

    expect(errors).toHaveLength(0);
  });

  it('rejeita platform fora de SOCIAL_PLATFORMS', async () => {
    const errors = await validateInput({
      socialLinks: [{ platform: 'MYSPACE', url: 'https://myspace.com/padaria' }],
    });

    const socialLinksError = errors.find((e) => e.property === 'socialLinks');
    expect(socialLinksError).toBeDefined();
    const nested = socialLinksError?.children?.[0]?.children ?? [];
    expect(nested.some((e) => e.property === 'platform')).toBe(true);
  });

  it('rejeita url inválida em socialLinks', async () => {
    const errors = await validateInput({
      socialLinks: [{ platform: 'INSTAGRAM', url: 'not-a-url' }],
    });

    const socialLinksError = errors.find((e) => e.property === 'socialLinks');
    expect(socialLinksError).toBeDefined();
    const nested = socialLinksError?.children?.[0]?.children ?? [];
    expect(nested.some((e) => e.property === 'url')).toBe(true);
  });

  it('rejeita mais de 10 entradas em socialLinks', async () => {
    const socialLinks = Array.from({ length: 11 }, (_, i) => ({
      platform: 'INSTAGRAM',
      url: `https://instagram.com/lead-${i}`,
    }));

    const errors = await validateInput({ socialLinks });

    expect(errors.some((e) => e.property === 'socialLinks')).toBe(true);
  });

  it('rejeita status fora da lista de valores válidos', async () => {
    const errors = await validateInput({ status: 'ARCHIVED' });

    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
