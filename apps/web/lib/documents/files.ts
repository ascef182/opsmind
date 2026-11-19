'use client';

import { apiRequestRaw } from '../api-client';

export interface UploadedDocument {
  id: string;
  filename: string;
  status: 'PROCESSING' | 'READY' | 'FAILED';
}

// Mesmos limites da API (DocumentsController): PDF de até 10 MB.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export async function uploadDocument(organizationId: string, file: File): Promise<UploadedDocument> {
  if (file.type !== 'application/pdf') throw new Error('Envie o comprovante em PDF.');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('O arquivo passa de 10 MB.');
  const body = new FormData();
  body.append('file', file);
  const response = await apiRequestRaw(`/organizations/${organizationId}/documents`, { method: 'POST', body });
  return (await response.json()) as UploadedDocument;
}

/** Baixa o arquivo pelo endpoint autenticado (nunca um link direto ao storage). */
export async function downloadDocument(organizationId: string, documentId: string, fallbackName = 'comprovante.pdf'): Promise<void> {
  const response = await apiRequestRaw(`/organizations/${organizationId}/documents/${documentId}/download`);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? decodeURIComponent(match[1]!) : fallbackName;
  link.click();
  URL.revokeObjectURL(url);
}
