import { isSafeHttpUrl } from './safe-url';

describe('isSafeHttpUrl', () => {
  it('aceita http e https', () => {
    expect(isSafeHttpUrl('https://instagram.com/fulano')).toBe(true);
    expect(isSafeHttpUrl('http://exemplo.com.br/contato?x=1#y')).toBe(true);
  });

  it('rejeita esquemas que viram XSS num href', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejeita esquema inseguro que CONTÉM um domínio conhecido — o furo do match por substring', () => {
    // `/instagram\.com/i.test(...)` devolveria true para esta string; é
    // exatamente por isso que o corte é por `protocol`, não por substring.
    expect(isSafeHttpUrl('javascript:alert(1)//instagram.com')).toBe(false);
    expect(isSafeHttpUrl('javascript:alert(1)//wa.me/5511999999999')).toBe(false);
  });

  it('rejeita entrada não-parseável, vazia ou que não é string', () => {
    expect(isSafeHttpUrl('não é uma url')).toBe(false);
    expect(isSafeHttpUrl('/caminho/relativo')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('   ')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
  });
});
