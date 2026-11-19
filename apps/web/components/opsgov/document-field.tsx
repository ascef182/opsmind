'use client';

import { useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { downloadDocument, uploadDocument, type UploadedDocument } from '@/lib/documents/files';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/card';

/**
 * Comprovante opcional (PDF): envia na hora em que o arquivo é escolhido e
 * devolve o documento ao formulário, que só manda o `documentId` à API.
 */
export function DocumentField({
  organizationId,
  value,
  onChange,
  label = 'Comprovante (PDF, opcional)',
}: {
  organizationId: string;
  value: UploadedDocument | null;
  onChange: (document: UploadedDocument | null) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      onChange(await uploadDocument(organizationId, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{value.filename}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remover comprovante"
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="w-fit" isLoading={uploading} onClick={() => input.current?.click()}>
          <Paperclip className="size-4" aria-hidden /> Anexar PDF
        </Button>
      )}
      <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={pick} />
      <FormError message={error} />
    </div>
  );
}

/** Link para baixar um comprovante já vinculado. */
export function DocumentLink({ organizationId, documentId, label = 'comprovante' }: { organizationId: string; documentId: string; label?: string }) {
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline"
      onClick={() => {
        setError(false);
        downloadDocument(organizationId, documentId).catch(() => setError(true));
      }}
    >
      <FileText className="size-3" aria-hidden />
      {error ? 'não foi possível baixar' : label}
    </button>
  );
}
