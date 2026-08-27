/**
 * Abstração sobre onde os bytes de um documento ficam guardados — PRD §16
 * decide Google Cloud Storage pra produção, mas dev/CI não tem (nem deveria
 * precisar de) um bucket real. Mesmo espírito de EMAIL_SERVICE
 * (console local vs. Resend real): a interface é pequena o bastante pra um
 * provider `gcs` (Fase 6) implementar depois sem tocar em DocumentsService.
 */
export interface StorageService {
  /** `key` é gerado por quem chama (DocumentsService), nunca pelo usuário. */
  save(key: string, data: Buffer): Promise<string>;
  read(key: string): Promise<Buffer>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
