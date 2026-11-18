import { normalizeCnae, normalizeCnpj } from './opsgov';

describe('normalizeCnae', () => {
  it('aceita com ou sem pontuação e devolve no formato da Receita', () => {
    expect(normalizeCnae('8219-9/99')).toBe('8219-9/99');
    expect(normalizeCnae('82.19-9-99')).toBe('8219-9/99');
    expect(normalizeCnae('8230001')).toBe('8230-0/01');
  });

  it('recusa tamanho errado', () => {
    expect(normalizeCnae('8219-9/9')).toBeNull();
  });
});

describe('normalizeCnpj', () => {
  it('valida dígitos verificadores e devolve só dígitos', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('recusa dígito verificador errado e sequência repetida', () => {
    expect(normalizeCnpj('11.222.333/0001-82')).toBeNull();
    expect(normalizeCnpj('11111111111111')).toBeNull();
  });
});
