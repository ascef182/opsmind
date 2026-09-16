export const SIGNATURE_SERVICE = Symbol('SIGNATURE_SERVICE');

export interface CreateSignatureRequestParams {
  envelopeName: string;
  documentFilename: string;
  documentBase64: string;
  signerName: string;
  signerEmail: string;
}

export interface CreateSignatureRequestResult {
  externalEnvelopeId: string;
  externalDocumentId: string;
}

// Status cru do provider (Clicksign: draft/running/closed/canceled) — mapeado
// para `SignatureRequestStatus` (Prisma) por quem consome esta interface
// (`DealSignatureService`), nunca aqui: esta camada não conhece o schema.
export type ExternalSignatureStatus = 'draft' | 'running' | 'closed' | 'canceled';

export interface SignatureStatusResult {
  status: ExternalSignatureStatus;
  // URL do documento assinado — só populada quando `status = 'closed'`.
  documentUrl: string | null;
}

/**
 * Interface de assinatura eletrônica — troca de implementação isolada
 * (Clicksign hoje, DocuSign amanhã para clientes fora do Brasil) sem tocar
 * em `DealSignatureService`. Único provider concreto por ora:
 * `ClicksignSignatureProvider`.
 */
export interface SignatureService {
  createSignatureRequest(params: CreateSignatureRequestParams): Promise<CreateSignatureRequestResult>;
  getStatus(externalEnvelopeId: string): Promise<SignatureStatusResult>;
}
