import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import type {
  CreateSignatureRequestParams,
  CreateSignatureRequestResult,
  ExternalSignatureStatus,
  SignatureService,
  SignatureStatusResult,
} from './signature.service';

interface ClicksignResource {
  data: { id: string };
}

interface ClicksignEnvelopeResponse {
  data: { id: string; attributes: { status: ExternalSignatureStatus } };
  included?: Array<{ type: string; attributes?: { signed_file_url?: string } }>;
}

/**
 * Implementação via API REST v3 da Clicksign (developers.clicksign.com,
 * foco PT-BR — mais barato que DocuSign para este porte). Sem SDK oficial
 * em Node.js (verificado nesta sessão — só existem wrappers não-oficiais no
 * npm), então fala direto com a API via `fetch`.
 *
 * Fluxo pra criar uma solicitação de assinatura, confirmado contra a
 * documentação pública (não contra uma execução real — sem conta sandbox
 * nesta sessão, ver comentário em `createRequirement` sobre a parte mais
 * incerta):
 *   1. POST /envelopes                  → cria o envelope (rascunho)
 *   2. POST /envelopes/:id/documents    → sobe o PDF (base64)
 *   3. POST /envelopes/:id/signers      → cadastra o signatário
 *   4. POST /envelopes/:id/requirements → vincula signatário + documento
 *   5. PATCH /envelopes/:id             → ativa (status: running), dispara
 *      o email de assinatura pro signatário
 *
 * `CLICKSIGN_API_TOKEN` é opcional no schema de env (mesmo racional de
 * `ANTHROPIC_API_KEY`/`ClaudeGatewayService`) — a feature de assinatura não
 * existe em toda instância; falha aqui, alto e claro, só no primeiro uso.
 */
@Injectable()
export class ClicksignSignatureProvider implements SignatureService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  async createSignatureRequest(params: CreateSignatureRequestParams): Promise<CreateSignatureRequestResult> {
    const envelopeId = await this.createEnvelope(params.envelopeName);
    const documentId = await this.uploadDocument(envelopeId, params.documentFilename, params.documentBase64);
    const signerId = await this.createSigner(envelopeId, params.signerName, params.signerEmail);
    await this.createRequirement(envelopeId, documentId, signerId);
    await this.activateEnvelope(envelopeId);
    return { externalEnvelopeId: envelopeId, externalDocumentId: documentId };
  }

  async getStatus(externalEnvelopeId: string): Promise<SignatureStatusResult> {
    const body = await this.request<ClicksignEnvelopeResponse>(
      'GET',
      `/envelopes/${externalEnvelopeId}?include=documents`,
    );
    const documentUrl = body.included?.find((r) => r.type === 'documents')?.attributes?.signed_file_url ?? null;
    return { status: body.data.attributes.status, documentUrl };
  }

  private async createEnvelope(name: string): Promise<string> {
    const body = await this.request<ClicksignResource>('POST', '/envelopes', {
      data: { type: 'envelopes', attributes: { name, locale: 'pt-BR', auto_close: true } },
    });
    return body.data.id;
  }

  private async uploadDocument(envelopeId: string, filename: string, contentBase64: string): Promise<string> {
    const body = await this.request<ClicksignResource>('POST', `/envelopes/${envelopeId}/documents`, {
      data: { type: 'documents', attributes: { filename, content_base64: contentBase64 } },
    });
    return body.data.id;
  }

  private async createSigner(envelopeId: string, name: string, email: string): Promise<string> {
    const body = await this.request<ClicksignResource>('POST', `/envelopes/${envelopeId}/signers`, {
      data: {
        type: 'signers',
        attributes: {
          name,
          email,
          communicate_events: {
            signature_request: 'email',
            signature_reminder: 'email',
            document_signed: 'email',
          },
        },
      },
    });
    return body.data.id;
  }

  // Vínculo signatário <-> documento — CONFIRMADO contra a documentação
  // pública (`POST /envelopes/:id/requirements`, `action`+`role` mais
  // relationships pra document/signer), NÃO confirmado contra uma execução
  // real. A doc também exige "pelo menos um critério de autenticação
  // configurado" por signatário antes de ativar o envelope; assumindo aqui
  // que o canal de comunicação por email já configurado em `createSigner`
  // satisfaz esse critério. Se `activateEnvelope` falhar reclamando de
  // autenticação ausente, é aqui que precisa de um requirement adicional
  // (ex.: `action: 'provide_evidence'`) — verificar contra uma conta
  // sandbox real (`sandbox.clicksign.com/signup`, grátis) antes de produção.
  private async createRequirement(envelopeId: string, documentId: string, signerId: string): Promise<void> {
    await this.request('POST', `/envelopes/${envelopeId}/requirements`, {
      data: {
        type: 'requirements',
        attributes: { action: 'agree', role: 'sign' },
        relationships: {
          document: { data: { type: 'documents', id: documentId } },
          signer: { data: { type: 'signers', id: signerId } },
        },
      },
    });
  }

  private async activateEnvelope(envelopeId: string): Promise<void> {
    await this.request('PATCH', `/envelopes/${envelopeId}`, {
      data: { id: envelopeId, type: 'envelopes', attributes: { status: 'running' } },
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const apiToken = this.configService.get('CLICKSIGN_API_TOKEN', { infer: true });
    if (!apiToken) {
      throw new ServiceUnavailableException(
        'Assinatura eletrônica não está configurada nesta instância (CLICKSIGN_API_TOKEN ausente).',
      );
    }
    const baseUrl = this.configService.get('CLICKSIGN_BASE_URL', { infer: true });

    const response = await fetch(`${baseUrl}/api/v3${path}`, {
      method,
      headers: { Authorization: apiToken, 'Content-Type': 'application/vnd.api+json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ServiceUnavailableException(`Clicksign respondeu ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }
}
