'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useDocuments, useUploadDocument, downloadDocument } from '@/lib/documents/use-documents';
import { useCustomers } from '@/lib/customers/use-customers';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, FormError } from '@/components/ui/card';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const documents = useDocuments(organizationId);
  const customers = useCustomers(organizationId);
  const uploadDocument = useUploadDocument(organizationId);
  const [customerId, setCustomerId] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onUpload = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    uploadDocument.mutate(
      { file, customerId: customerId || undefined },
      {
        onSuccess: () => {
          if (fileInputRef.current) fileInputRef.current.value = '';
        },
      },
    );
  };

  const onDownload = async (documentId: string) => {
    setDownloadError(null);
    try {
      await downloadDocument(organizationId, documentId);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : 'Não foi possível baixar o arquivo.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="font-medium text-slate-900">Enviar documento</h2>
        <p className="mt-1 text-sm text-slate-500">
          Só PDF por enquanto — o texto é extraído e indexado automaticamente pro assistente de IA
          conseguir responder perguntas citando o trecho de origem.
        </p>
        <form onSubmit={onUpload} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="flex-1 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="sm:w-56">
            <option value="">Sem cliente vinculado</option>
            {customers.data?.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
          <Button type="submit" isLoading={uploadDocument.isPending}>
            Enviar
          </Button>
        </form>
        <FormError message={uploadDocument.isError ? (uploadDocument.error as ApiError).message : null} />
      </Card>

      <FormError message={downloadError} />

      {documents.isLoading && <p className="text-slate-500">Carregando documentos…</p>}
      {documents.isSuccess && documents.data.length === 0 && (
        <p className="text-slate-600">Nenhum documento enviado ainda.</p>
      )}

      <div className="flex flex-col gap-2">
        {documents.data?.map((doc) => (
          <Card key={doc.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">{doc.filename}</p>
              <p className="text-xs text-slate-400">
                {formatSize(doc.sizeBytes)} · enviado em {new Date(doc.createdAt).toLocaleString('pt-BR')}
              </p>
              {doc.status === 'FAILED' && doc.errorMessage && (
                <p className="mt-1 text-xs text-red-600">{doc.errorMessage}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge value={doc.status} />
              <Button variant="ghost" onClick={() => onDownload(doc.id)}>
                Baixar
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
