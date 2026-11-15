import { extractWebsiteSignals } from './signal-extractors';

const currentYear = new Date().getUTCFullYear();

function page(url: string, html: string) {
  return { url, html };
}

describe('extractWebsiteSignals', () => {
  it('devolve nenhum sinal quando não há páginas', () => {
    expect(extractWebsiteSignals([])).toEqual([]);
  });

  it('sinaliza website.no_ssl quando a homepage não é https', () => {
    const signals = extractWebsiteSignals([page('http://exemplo.com.br/', '<html></html>')]);
    expect(signals).toContainEqual(
      expect.objectContaining({ signalCode: 'website.no_ssl', confidence: 1 }),
    );
  });

  it('não sinaliza website.no_ssl quando a homepage é https', () => {
    const signals = extractWebsiteSignals([page('https://exemplo.com.br/', '<html></html>')]);
    expect(signals.find((s) => s.signalCode === 'website.no_ssl')).toBeUndefined();
  });

  it('sinaliza website.no_contact_form só quando NENHUMA página tem form ou mailto', () => {
    const noForm = extractWebsiteSignals([page('https://a.com/', '<html>sem nada</html>')]);
    expect(noForm).toContainEqual(expect.objectContaining({ signalCode: 'website.no_contact_form' }));

    const withFormOnSecondPage = extractWebsiteSignals([
      page('https://a.com/', '<html>home</html>'),
      page('https://a.com/contato', '<form action="/enviar"><input/></form>'),
    ]);
    expect(withFormOnSecondPage.find((s) => s.signalCode === 'website.no_contact_form')).toBeUndefined();

    const withMailto = extractWebsiteSignals([page('https://a.com/', '<a href="mailto:oi@a.com">fale</a>')]);
    expect(withMailto.find((s) => s.signalCode === 'website.no_contact_form')).toBeUndefined();
  });

  it('sinaliza website.no_mobile_viewport quando a meta viewport não existe em nenhuma página', () => {
    const missing = extractWebsiteSignals([page('https://a.com/', '<head></head>')]);
    expect(missing).toContainEqual(expect.objectContaining({ signalCode: 'website.no_mobile_viewport' }));

    const present = extractWebsiteSignals([
      page('https://a.com/', '<meta name="viewport" content="width=device-width">'),
    ]);
    expect(present.find((s) => s.signalCode === 'website.no_mobile_viewport')).toBeUndefined();
  });

  it('sinaliza ausência de Instagram/WhatsApp com confiança reduzida (ausência de evidência != evidência de ausência)', () => {
    const signals = extractWebsiteSignals([page('https://a.com/', '<html>nada aqui</html>')]);
    const instagram = signals.find((s) => s.signalCode === 'social.no_instagram');
    const whatsapp = signals.find((s) => s.signalCode === 'social.no_whatsapp_link');
    expect(instagram?.confidence).toBeLessThan(0.6);
    expect(whatsapp?.confidence).toBeLessThan(0.6);
  });

  it('não sinaliza ausência de Instagram quando o link existe em qualquer página buscada', () => {
    const signals = extractWebsiteSignals([page('https://a.com/', '<a href="https://instagram.com/empresa">ig</a>')]);
    expect(signals.find((s) => s.signalCode === 'social.no_instagram')).toBeUndefined();
  });

  it('sinaliza social.has_whatsapp_link (presença, não ausência) com a URL real capturada como evidência, em vez de social.no_whatsapp_link', () => {
    const signals = extractWebsiteSignals([
      page('https://a.com/', '<html>nada aqui</html>'),
      page('https://a.com/contato', '<a href="https://wa.me/5511999999999">fale no whats</a>'),
    ]);
    const found = signals.find((s) => s.signalCode === 'social.has_whatsapp_link');
    expect(found).toBeDefined();
    expect(found?.value).toBe('https://wa.me/5511999999999');
    expect(found?.evidenceUrl).toBe('https://a.com/contato');
    expect(found?.confidence).toBeGreaterThan(0.6); // evidência positiva concreta, confiança mais alta que sinais de ausência
    expect(signals.find((s) => s.signalCode === 'social.no_whatsapp_link')).toBeUndefined();
  });

  it('reconhece link de api.whatsapp.com também, não só wa.me', () => {
    const signals = extractWebsiteSignals([
      page('https://a.com/', '<a href="https://api.whatsapp.com/send?phone=5511999999999">whats</a>'),
    ]);
    expect(signals.find((s) => s.signalCode === 'social.has_whatsapp_link')?.value).toBe(
      'https://api.whatsapp.com/send?phone=5511999999999',
    );
  });

  it('sinaliza copyright desatualizado (mais de 1 ano) com evidência truncada e capada', () => {
    const oldYear = currentYear - 3;
    const html = `<footer>© ${oldYear} Empresa Exemplo Ltda. Todos os direitos reservados.</footer>`;
    const signals = extractWebsiteSignals([page('https://a.com/', html)]);
    const signal = signals.find((s) => s.signalCode === 'website.outdated_copyright_year');
    expect(signal).toBeDefined();
    expect(signal?.value).toBe(String(oldYear));
    expect(signal?.evidenceQuote).toContain(String(oldYear));
    expect(signal?.evidenceQuote?.length).toBeLessThanOrEqual(201); // 200 + "…"
  });

  it('não sinaliza copyright do ano corrente ou do ano passado (ainda dentro da janela aceitável)', () => {
    const thisYear = extractWebsiteSignals([page('https://a.com/', `<footer>© ${currentYear}</footer>`)]);
    expect(thisYear.find((s) => s.signalCode === 'website.outdated_copyright_year')).toBeUndefined();

    const lastYear = extractWebsiteSignals([page('https://a.com/', `<footer>© ${currentYear - 1}</footer>`)]);
    expect(lastYear.find((s) => s.signalCode === 'website.outdated_copyright_year')).toBeUndefined();
  });

  it('nunca inclui o trecho inteiro da página como evidenceQuote (minimização de dado)', () => {
    const longHtml = `<p>${'conteúdo irrelevante '.repeat(50)}</p><footer>© ${currentYear - 5} Empresa</footer>`;
    const signals = extractWebsiteSignals([page('https://a.com/', longHtml)]);
    const signal = signals.find((s) => s.signalCode === 'website.outdated_copyright_year');
    expect(signal?.evidenceQuote?.length ?? 0).toBeLessThan(longHtml.length);
  });
});
