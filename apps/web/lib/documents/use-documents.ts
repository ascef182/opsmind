'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiFetch } from '../api-client';
import type { Document } from './types';

export function useDocuments(organizationId: string) {
  return useQuery({
    queryKey: ['organizations', organizationId, 'documents'],
    queryFn: () => apiFetch<Document[]>(`/organizations/${organizationId}/documents`),
    enabled: Boolean(organizationId),
    // PROCESSING é transitório (o upload processa síncrono no servidor e já
    // volta READY/FAILED na resposta) — sem polling especial necessário,
    // mas um refetch leve não faz mal caso a lista fique aberta.
    refetchInterval: (query) =>
      query.state.data?.some((doc) => doc.status === 'PROCESSING') ? 2000 : false,
  });
}

export function useUploadDocument(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, customerId }: { file: File; customerId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (customerId) {
        formData.append('customerId', customerId);
      }
      return apiFetch<Document>(`/organizations/${organizationId}/documents`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', organizationId, 'documents'] }),
  });
}

export async function downloadDocument(organizationId: string, documentId: string): Promise<void> {
  const { blob, filename } = await apiDownload(`/organizations/${organizationId}/documents/${documentId}/download`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
