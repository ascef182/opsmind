import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeadDto } from './create-lead.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateLeadDto, input);
  return validate(dto);
}

describe('CreateLeadDto', () => {
  it('aceita apenas o nome (demais campos opcionais)', async () => {
    const errors = await validateInput({ name: 'Padaria Central' });

    expect(errors).toHaveLength(0);
  });

  it('aceita whatsapp/contactName/socialLinks válidos', async () => {
    const errors = await validateInput({
      name: 'Padaria Central',
      whatsapp: '+55 11 90000-0000',
      contactName: 'Maria Silva',
      socialLinks: [
        { platform: 'INSTAGRAM', url: 'https://instagram.com/padariacentral' },
        { platform: 'WHATSAPP', url: 'https://wa.me/5511900000000' },
      ],
    });

    expect(errors).toHaveLength(0);
  });

  it('rejeita platform fora de SOCIAL_PLATFORMS', async () => {
    const errors = await validateInput({
      name: 'Padaria Central',
      socialLinks: [{ platform: 'MYSPACE', url: 'https://myspace.com/padaria' }],
    });

    const socialLinksError = errors.find((e) => e.property === 'socialLinks');
    expect(socialLinksError).toBeDefined();
    const nested = socialLinksError?.children?.[0]?.children ?? [];
    expect(nested.some((e) => e.property === 'platform')).toBe(true);
  });

  it('rejeita url inválida em socialLinks', async () => {
    const errors = await validateInput({
      name: 'Padaria Central',
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

    const errors = await validateInput({ name: 'Padaria Central', socialLinks });

    expect(errors.some((e) => e.property === 'socialLinks')).toBe(true);
  });

  it('aceita exatamente 10 entradas em socialLinks', async () => {
    const socialLinks = Array.from({ length: 10 }, (_, i) => ({
      platform: 'INSTAGRAM',
      url: `https://instagram.com/lead-${i}`,
    }));

    const errors = await validateInput({ name: 'Padaria Central', socialLinks });

    expect(errors).toHaveLength(0);
  });

  it('rejeita nome vazio', async () => {
    const errors = await validateInput({ name: '' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
